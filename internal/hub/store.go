package hub

import (
	"bytes"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Store keeps the certificate in dir: cert.pem (the chain), key.pem and etag,
// the directory 0700 and the files 0600, each replaced by a rename so a
// reader never sees half a file.
type Store struct {
	dir string

	mu       sync.RWMutex
	certPEM  []byte
	keyPEM   []byte
	names    []string // the leaf's DNS names, lowercased
	notAfter time.Time
	etag     string
}

// NewStore is a store in dir; nothing is read until Load.
func NewStore(dir string) *Store { return &Store{dir: dir} }

func (s *Store) path(name string) string { return filepath.Join(s.dir, name) }

// Load reads the certificate left by an earlier run. Nothing there is not an
// error; a pair that doesn't parse is, and is left unused.
func (s *Store) Load() error {
	certPEM, err := os.ReadFile(s.path("cert.pem"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	keyPEM, err := os.ReadFile(s.path("key.pem"))
	if err != nil {
		return err
	}
	names, notAfter, err := check(certPEM, keyPEM)
	if err != nil {
		return fmt.Errorf("%s: %v", s.dir, err)
	}
	etag, _ := os.ReadFile(s.path("etag"))
	s.mu.Lock()
	s.certPEM, s.keyPEM, s.names, s.notAfter = certPEM, keyPEM, names, notAfter
	s.etag = strings.TrimSpace(string(etag))
	s.mu.Unlock()
	return nil
}

// Put splits the hub's bundle into the chain and the key, checks they are a
// pair and that the certificate is for name, and only then replaces what is
// on disk and in memory.
func (s *Store) Put(bundle []byte, name, etag string) error {
	certPEM, keyPEM, err := split(bundle)
	if err != nil {
		return err
	}
	names, notAfter, err := check(certPEM, keyPEM)
	if err != nil {
		return err
	}
	if name != "" && !covers(names, name) {
		return fmt.Errorf("the certificate is for %s, not %s", strings.Join(names, ", "), name)
	}
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return err
	}
	// MkdirAll leaves an existing directory's mode alone.
	if err := os.Chmod(s.dir, 0o700); err != nil {
		return err
	}
	// The key first: a crash between the two renames leaves a new key with
	// the old certificate, which Load refuses as a mismatch, rather than a
	// silently wrong pair.
	if err := writeAtomic(s.path("key.pem"), keyPEM); err != nil {
		return err
	}
	if err := writeAtomic(s.path("cert.pem"), certPEM); err != nil {
		return err
	}
	_ = writeAtomic(s.path("etag"), []byte(etag+"\n"))
	s.mu.Lock()
	s.certPEM, s.keyPEM, s.names, s.notAfter, s.etag = certPEM, keyPEM, names, notAfter, etag
	s.mu.Unlock()
	return nil
}

// ETag is the hub's ETag for the certificate held, or "".
func (s *Store) ETag() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.etag
}

// Name is the certificate's first DNS name, or "" without one.
func (s *Store) Name() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if len(s.names) == 0 {
		return ""
	}
	return s.names[0]
}

// NotAfter is when the certificate held expires; zero without one.
func (s *Store) NotAfter() time.Time {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.notAfter
}

// PEMFor is the chain then the key, as Caddy's get_certificate http reads
// them, when the certificate covers serverName; nil otherwise.
func (s *Store) PEMFor(serverName string) []byte {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.certPEM == nil || serverName == "" || !covers(s.names, serverName) {
		return nil
	}
	out := make([]byte, 0, len(s.certPEM)+len(s.keyPEM)+1)
	out = append(out, s.certPEM...)
	if len(out) > 0 && out[len(out)-1] != '\n' {
		out = append(out, '\n')
	}
	return append(out, s.keyPEM...)
}

// covers says whether one of names is host. The hub issues for exactly one
// name, so there are no wildcards to match.
func covers(names []string, host string) bool {
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	for _, n := range names {
		if n == host {
			return true
		}
	}
	return false
}

// split separates a PEM bundle into its CERTIFICATE blocks and its one
// private key.
func split(bundle []byte) (certPEM, keyPEM []byte, err error) {
	var certs, key bytes.Buffer
	rest := bundle
	for {
		var b *pem.Block
		b, rest = pem.Decode(rest)
		if b == nil {
			break
		}
		switch {
		case b.Type == "CERTIFICATE":
			_ = pem.Encode(&certs, b)
		case strings.HasSuffix(b.Type, "PRIVATE KEY"):
			if key.Len() > 0 {
				return nil, nil, errors.New("the bundle has more than one private key")
			}
			_ = pem.Encode(&key, b)
		}
	}
	if certs.Len() == 0 {
		return nil, nil, errors.New("the bundle has no certificate")
	}
	if key.Len() == 0 {
		return nil, nil, errors.New("the bundle has no private key")
	}
	return certs.Bytes(), key.Bytes(), nil
}

// check parses the pair and returns the leaf's names and expiry.
func check(certPEM, keyPEM []byte) ([]string, time.Time, error) {
	pair, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("not a certificate and its key: %v", err)
	}
	leaf, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil {
		return nil, time.Time{}, err
	}
	names := make([]string, 0, len(leaf.DNSNames))
	for _, n := range leaf.DNSNames {
		names = append(names, strings.ToLower(n))
	}
	if len(names) == 0 {
		return nil, time.Time{}, errors.New("the certificate names no host")
	}
	return names, leaf.NotAfter, nil
}

// writeAtomic writes b to a temporary file beside path, 0600, and renames it
// over path.
func writeAtomic(path string, b []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp) // a no-op once renamed
	if err := f.Chmod(0o600); err != nil {
		f.Close()
		return err
	}
	if _, err := f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
