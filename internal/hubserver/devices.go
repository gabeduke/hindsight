package hubserver

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"log"
	"net/netip"
	"regexp"
	"strings"
	"sync"
	"time"
)

var labelRE = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)

// reserved names are taken by the hub itself, or would collide with one of
// its objects: hub.<domain> is its Ingress, whose certificate lives in the
// Secret hindsight-hub-tls; a device called hindsight-hub would aim a second
// Certificate at that Secret. find is kept for the spec's "Later".
var reserved = map[string]bool{
	"hub": true, "find": true, "www": true, "hindsight-hub": true, "hindsight-devices": true,
}

// ValidName reports whether name can be a device: a lowercase DNS label that
// is not one of the hub's own.
func ValidName(name string) bool {
	return labelRE.MatchString(name) && !reserved[name]
}

// devices is the enrolment Secret, cached so a heartbeat is one API call at
// most. Each value is the hex SHA-256 of a device's token.
type devices struct {
	kube   Kube
	secret string
	ttl    time.Duration
	now    func() time.Time

	mu     sync.Mutex
	hashes map[string][]byte // name -> sha256(token)
	read   time.Time
}

func (d *devices) load(ctx context.Context) (map[string][]byte, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.hashes != nil && d.now().Sub(d.read) < d.ttl {
		return d.hashes, nil
	}
	data, err := d.kube.GetSecret(ctx, d.secret)
	if errors.Is(err, ErrNotFound) {
		data, err = map[string][]byte{}, nil // nobody enrolled yet
	}
	if err != nil {
		if d.hashes != nil {
			log.Printf("[!] devices: %v; using the copy from %s", err, d.read.Format(time.RFC3339))
			return d.hashes, nil
		}
		return nil, err
	}
	hashes := make(map[string][]byte, len(data))
	for name, v := range data {
		if !ValidName(name) {
			log.Printf("[!] devices: ignoring %q, not a valid device name", name)
			continue
		}
		h, err := hex.DecodeString(strings.TrimSpace(string(v)))
		if err != nil || len(h) != sha256.Size {
			log.Printf("[!] devices: ignoring %q, value is not a hex SHA-256", name)
			continue
		}
		hashes[name] = h
	}
	d.hashes, d.read = hashes, d.now()
	return hashes, nil
}

// lookup answers the device a token belongs to, or "". Every enrolled hash is
// compared, in constant time, so neither the answer's timing nor its
// position in the map says how close a guess came.
func (d *devices) lookup(ctx context.Context, token string) (string, error) {
	hashes, err := d.load(ctx)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(token))
	found := ""
	for name, h := range hashes {
		if subtle.ConstantTimeCompare(sum[:], h) == 1 {
			found = name
		}
	}
	return found, nil
}

var privatePrefixes = []netip.Prefix{
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("fc00::/7"),
}

// parseLANIP answers a private (RFC 1918 or ULA) address and its record type,
// or ok=false. The hub must never point a leetserve.com name at somebody's
// public address.
func parseLANIP(s string) (addr netip.Addr, recordType string, ok bool) {
	a, err := netip.ParseAddr(strings.TrimSpace(s))
	if err != nil || a.Zone() != "" {
		return netip.Addr{}, "", false
	}
	a = a.Unmap()
	for _, p := range privatePrefixes {
		if p.Contains(a) {
			if a.Is4() {
				return a, "A", true
			}
			return a, "AAAA", true
		}
	}
	return netip.Addr{}, "", false
}
