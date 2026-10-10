package hub

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const testName = "mike.hindsight.leetserve.com"

// bundle is a self-signed certificate for name and its key, as the hub
// answers them: the chain, then the key.
func bundle(t *testing.T, name string) []byte {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: name},
		DNSNames:     []string{name},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(90 * 24 * time.Hour),
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	kder, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	var b bytes.Buffer
	_ = pem.Encode(&b, &pem.Block{Type: "CERTIFICATE", Bytes: der})
	_ = pem.Encode(&b, &pem.Block{Type: "EC PRIVATE KEY", Bytes: kder})
	return b.Bytes()
}

// fakeHub answers /v1/heartbeat and /v1/certificate the way the hub does.
type fakeHub struct {
	t     *testing.T
	token string

	mu        sync.Mutex
	beats     []map[string]string
	beatTimes []time.Time
	auths     []string
	fail      bool // heartbeat answers 500
	ready     bool
	bundle    []byte
	etag      string
	ifNone    []string // If-None-Match on each certificate request
	certCalls int
	beatCh    chan map[string]string
}

func newFakeHub(t *testing.T) (*fakeHub, *httptest.Server) {
	h := &fakeHub{t: t, token: "s3cret", beatCh: make(chan map[string]string, 100)}
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return h, srv
}

func (h *fakeHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.auths = append(h.auths, r.Header.Get("Authorization"))
	if r.Header.Get("Authorization") != "Bearer "+h.token {
		http.Error(w, `{"error":"unknown device"}`, http.StatusUnauthorized)
		return
	}
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/v1/heartbeat":
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		h.beats = append(h.beats, body)
		h.beatTimes = append(h.beatTimes, time.Now())
		h.beatCh <- body
		if h.fail {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"name": testName, "cert_ready": h.ready, "cert_not_after": ""})
	case r.Method == http.MethodGet && r.URL.Path == "/v1/certificate":
		h.certCalls++
		h.ifNone = append(h.ifNone, r.Header.Get("If-None-Match"))
		if h.bundle == nil {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("If-None-Match") == h.etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", h.etag)
		_, _ = w.Write(h.bundle)
	default:
		http.NotFound(w, r)
	}
}

func (h *fakeHub) wait(t *testing.T) map[string]string {
	t.Helper()
	select {
	case b := <-h.beatCh:
		return b
	case <-time.After(3 * time.Second):
		t.Fatal("no heartbeat")
		return nil
	}
}

type ipVar struct{ v atomic.Value }

func newIP(s string) *ipVar           { i := &ipVar{}; i.v.Store(s); return i }
func (i *ipVar) set(s string)         { i.v.Store(s) }
func (i *ipVar) get() (string, error) { return i.v.Load().(string), nil }

func newClient(t *testing.T, srv *httptest.Server, o Options) *Client {
	t.Helper()
	o.URL, o.Version = srv.URL, "v2026.10.10.2"
	if o.Token == "" {
		o.Token = "s3cret"
	}
	if o.Dir == "" {
		o.Dir = filepath.Join(t.TempDir(), "tls")
	}
	if o.LocalIP == nil {
		o.LocalIP = newIP("192.168.1.55").get
	}
	if o.ProbeHTTPS == nil {
		// Never the real network: 192.168.1.55 may well be a Pi.
		o.ProbeHTTPS = func(context.Context, string, string) error { return nil }
	}
	c, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func eventually(t *testing.T, what string, f func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !f() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestHeartbeatBodyAndAuth(t *testing.T) {
	h, srv := newFakeHub(t)
	c := newClient(t, srv, Options{Every: time.Hour})
	if s := c.Status(); s.Name != "" || s.URL != "" || s.LastHeartbeat != nil {
		t.Fatalf("before any heartbeat: %+v", s)
	}
	c.Start()
	defer c.Stop()
	b := h.wait(t)
	if b["lan_ip"] != "192.168.1.55" || b["version"] != "v2026.10.10.2" || len(b) != 2 {
		t.Fatalf("heartbeat body = %v", b)
	}
	h.mu.Lock()
	auth := h.auths[0]
	h.mu.Unlock()
	if auth != "Bearer s3cret" {
		t.Fatalf("Authorization = %q", auth)
	}
	eventually(t, "status", func() bool { return c.Status().LastHeartbeat != nil })
	s := c.Status()
	if s.Name != testName || s.URL != "https://"+testName {
		t.Fatalf("status = %+v", s)
	}
	if s.Error != "the hub is still getting a certificate for "+testName {
		t.Fatalf("error = %q", s.Error)
	}
}

func TestBadTokenIsShown(t *testing.T) {
	h, srv := newFakeHub(t)
	c := newClient(t, srv, Options{Token: "wrong", Every: time.Hour})
	c.Start()
	defer c.Stop()
	eventually(t, "error", func() bool { return c.Status().Error != "" })
	if e := c.Status().Error; e != "hub rejected the token (HUB_TOKEN)" {
		t.Fatalf("error = %q", e)
	}
	_ = h
}

// 400 and 401 can't be fixed by retrying: back off all the way at once.
func TestRefusalBacksOffLong(t *testing.T) {
	for _, code := range []int{http.StatusBadRequest, http.StatusUnauthorized} {
		var n atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			n.Add(1)
			w.WriteHeader(code)
			_, _ = w.Write([]byte(`{"error":"lan_ip must be private"}`))
		}))
		c := newClient(t, srv, Options{Every: time.Hour, Check: 5 * time.Millisecond,
			MinBackoff: 10 * time.Millisecond, MaxBackoff: time.Hour})
		c.Start()
		eventually(t, "error", func() bool { return c.Status().Error != "" })
		time.Sleep(100 * time.Millisecond)
		c.Stop()
		srv.Close()
		if got := n.Load(); got != 1 {
			t.Errorf("%d: %d heartbeats, want 1", code, got)
		}
		if code == http.StatusBadRequest && !strings.Contains(c.Status().Error, "lan_ip must be private") {
			t.Errorf("400 error = %q", c.Status().Error)
		}
	}
}

// 429 waits exactly as long as Retry-After says.
func TestTooManyHonoursRetryAfter(t *testing.T) {
	var times []time.Time
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		times = append(times, time.Now())
		first := len(times) == 1
		mu.Unlock()
		if first {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"name": testName, "cert_ready": false})
	}))
	defer srv.Close()
	ip := newIP("192.168.1.55")
	c := newClient(t, srv, Options{Every: time.Hour, Check: 5 * time.Millisecond,
		MinBackoff: 10 * time.Millisecond, MaxBackoff: time.Hour, LocalIP: ip.get})
	c.Start()
	defer c.Stop()
	eventually(t, "the retry", func() bool { mu.Lock(); defer mu.Unlock(); return len(times) == 2 })
	mu.Lock()
	gap := times[1].Sub(times[0])
	mu.Unlock()
	if gap < 950*time.Millisecond || gap > 1500*time.Millisecond {
		t.Fatalf("retried after %s, want 1s", gap)
	}
}

func TestBackoffDoublesAndCaps(t *testing.T) {
	h, srv := newFakeHub(t)
	h.fail = true
	min, max := 40*time.Millisecond, 160*time.Millisecond
	c := newClient(t, srv, Options{Every: time.Hour, Check: 5 * time.Millisecond, MinBackoff: min, MaxBackoff: max})
	c.Start()
	for i := 0; i < 6; i++ {
		h.wait(t)
	}
	c.Stop()
	h.mu.Lock()
	ts := append([]time.Time(nil), h.beatTimes...)
	h.mu.Unlock()
	want := []time.Duration{min, 2 * min, max, max, max}
	for i, w := range want {
		gap := ts[i+1].Sub(ts[i])
		if gap < w-5*time.Millisecond {
			t.Errorf("gap %d = %s, want at least %s", i, gap, w)
		}
		if gap > w+150*time.Millisecond {
			t.Errorf("gap %d = %s, want about %s", i, gap, w)
		}
	}
	if !strings.Contains(c.Status().Error, "500") {
		t.Fatalf("error = %q", c.Status().Error)
	}
}

func TestAddressChangeHeartbeats(t *testing.T) {
	h, srv := newFakeHub(t)
	ip := newIP("192.168.1.55")
	c := newClient(t, srv, Options{Every: time.Hour, Check: 10 * time.Millisecond, LocalIP: ip.get})
	c.Start()
	defer c.Stop()
	if b := h.wait(t); b["lan_ip"] != "192.168.1.55" {
		t.Fatalf("first = %v", b)
	}
	// Unchanged: nothing more within a few checks.
	select {
	case b := <-h.beatCh:
		t.Fatalf("heartbeat with no change: %v", b)
	case <-time.After(60 * time.Millisecond):
	}
	ip.set("10.0.0.7")
	if b := h.wait(t); b["lan_ip"] != "10.0.0.7" {
		t.Fatalf("after the change = %v", b)
	}
}

func TestCertificateFetchETagAndStore(t *testing.T) {
	h, srv := newFakeHub(t)
	h.ready, h.bundle, h.etag = true, bundle(t, testName), `"0a1b2c"`
	dir := filepath.Join(t.TempDir(), "tls")
	ip := newIP("192.168.1.55")
	c := newClient(t, srv, Options{Dir: dir, Every: time.Hour, Check: 10 * time.Millisecond, LocalIP: ip.get})
	c.Start()
	h.wait(t)
	eventually(t, "the certificate", func() bool { return c.Status().CertNotAfter != nil })
	if e := c.Status().Error; e != "" {
		t.Fatalf("error = %q", e)
	}

	// Stored privately.
	if fi, err := os.Stat(dir); err != nil || fi.Mode().Perm() != 0o700 {
		t.Fatalf("dir: %v %v", fi.Mode(), err)
	}
	for _, f := range []string{"cert.pem", "key.pem"} {
		fi, err := os.Stat(filepath.Join(dir, f))
		if err != nil || fi.Mode().Perm() != 0o600 {
			t.Fatalf("%s: %v %v", f, err, fi)
		}
	}
	if left, _ := filepath.Glob(filepath.Join(dir, ".*")); len(left) != 0 {
		t.Fatalf("temporary files left: %v", left)
	}

	// The next heartbeat asks with the ETag and gets a 304.
	ip.set("192.168.1.56")
	h.wait(t)
	eventually(t, "the second certificate request", func() bool {
		h.mu.Lock()
		defer h.mu.Unlock()
		return h.certCalls == 2
	})
	c.Stop()
	h.mu.Lock()
	if h.ifNone[0] != "" || h.ifNone[1] != `"0a1b2c"` {
		t.Fatalf("If-None-Match = %q", h.ifNone)
	}
	h.mu.Unlock()

	// A restart with no hub at all still has it, ETag and all.
	c2, err := New(Options{URL: "https://hub.invalid", Token: "x", Dir: dir})
	if err != nil {
		t.Fatal(err)
	}
	s := c2.Status()
	if s.Name != testName || s.URL != "https://"+testName || s.CertNotAfter == nil {
		t.Fatalf("after restart: %+v", s)
	}
	if c2.store.ETag() != `"0a1b2c"` {
		t.Fatalf("etag after restart = %q", c2.store.ETag())
	}
}

func TestBadPEMRejected(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "tls")
	s := NewStore(dir)
	good := bundle(t, testName)
	if err := s.Put(good, testName, "1"); err != nil {
		t.Fatal(err)
	}
	other := bundle(t, testName)
	// Its certificate with the first one's key.
	certOther, _, _ := split(other)
	_, keyGood, _ := split(good)
	cases := map[string][]byte{
		"garbage":    []byte("not pem at all"),
		"no key":     certOther,
		"no cert":    keyGood,
		"mismatch":   append(append([]byte{}, certOther...), keyGood...),
		"wrong name": bundle(t, "eve.hindsight.leetserve.com"),
	}
	for name, b := range cases {
		if err := s.Put(b, testName, "2"); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	// What was there is untouched, on disk and in memory.
	onDisk, _ := os.ReadFile(filepath.Join(dir, "cert.pem"))
	gc, gk, _ := split(good)
	if !bytes.Equal(onDisk, gc) || s.ETag() != "1" || !bytes.Equal(s.PEMFor(testName), append(gc, gk...)) {
		t.Fatal("a rejected bundle replaced the good one")
	}
}

func TestTLSHandler(t *testing.T) {
	h, srv := newFakeHub(t)
	h.ready, h.bundle, h.etag = true, bundle(t, testName), "e1"
	c := newClient(t, srv, Options{Every: time.Hour})
	ask := func(name string) *http.Response {
		rec := httptest.NewRecorder()
		c.TLSHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet,
			"/tls?server_name="+name+"&signature_schemes=403,804&cipher_suites=1301", nil))
		return rec.Result()
	}
	if r := ask(testName); r.StatusCode != http.StatusNoContent {
		t.Fatalf("no certificate yet: %d", r.StatusCode)
	}
	c.Start()
	defer c.Stop()
	eventually(t, "the certificate", func() bool { return c.Status().CertNotAfter != nil })

	r := ask(testName)
	body, _ := io.ReadAll(r.Body)
	if r.StatusCode != http.StatusOK || !strings.HasPrefix(r.Header.Get("Content-Type"), "text/plain") {
		t.Fatalf("matching name: %d %s", r.StatusCode, r.Header.Get("Content-Type"))
	}
	// Chain first, then the key, and they parse as a pair (what Caddy does).
	if i, j := bytes.Index(body, []byte("CERTIFICATE")), bytes.Index(body, []byte("PRIVATE KEY")); i < 0 || j < i {
		t.Fatalf("body order:\n%s", body)
	}
	cp, kp, err := split(body)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tls.X509KeyPair(cp, kp); err != nil {
		t.Fatal(err)
	}
	if r := ask(strings.ToUpper(testName)); r.StatusCode != http.StatusOK {
		t.Fatalf("SNI case: %d", r.StatusCode)
	}
	for _, name := range []string{"", "eve.hindsight.leetserve.com", "hindsight.local", "192.168.1.55"} {
		r := ask(name)
		b, _ := io.ReadAll(r.Body)
		if r.StatusCode != http.StatusNoContent || len(b) != 0 {
			t.Errorf("server_name %q: %d %q", name, r.StatusCode, b)
		}
	}
}

func TestListenerIsLoopbackOnly(t *testing.T) {
	for _, addr := range []string{"0.0.0.0:5001", ":5001", "192.168.1.55:5001"} {
		if _, err := New(Options{URL: "https://hub.example", Token: "t", Dir: t.TempDir(), TLSAddr: addr}); err == nil {
			t.Errorf("%s accepted", addr)
		}
	}
	_, srv := newFakeHub(t)
	c := newClient(t, srv, Options{Every: time.Hour, TLSAddr: "127.0.0.1:0"})
	c.Start()
	defer c.Stop()
	if c.Addr() == nil {
		t.Fatal("no listener")
	}
	resp, err := http.Get("http://" + c.Addr().String() + "/tls?server_name=" + testName)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("listener: %d", resp.StatusCode)
	}
}

func TestNewNeedsURLAndToken(t *testing.T) {
	if _, err := New(Options{Token: "t", Dir: t.TempDir()}); err == nil {
		t.Error("no URL accepted")
	}
	if _, err := New(Options{URL: "https://hub.example", Dir: t.TempDir()}); err == nil {
		t.Error("no token accepted")
	}
	if _, err := New(Options{URL: "hub.example", Token: "t", Dir: t.TempDir()}); err == nil {
		t.Error("a URL with no scheme accepted")
	}
}

// Until a certificate is held the client asks again after Pending, not
// Every: a new device's certificate is issued a minute or two after its first
// heartbeat, and the sheet shouldn't wait ten minutes to show the address.
// Once it holds one, it's back to Every.
func TestHeartbeatsSoonerUntilACertificateIsHeld(t *testing.T) {
	h, srv := newFakeHub(t)
	c := newClient(t, srv, Options{Every: time.Hour, Pending: 20 * time.Millisecond, Check: 5 * time.Millisecond})
	c.Start()
	defer c.Stop()
	h.wait(t)
	h.wait(t) // not ready: asked again after Pending, well before Every

	h.mu.Lock()
	h.ready, h.bundle, h.etag = true, bundle(t, testName), `"e2"`
	h.mu.Unlock()
	eventually(t, "the certificate", func() bool { return c.Status().CertNotAfter != nil })

	select {
	case <-h.beatCh: // the beat that fetched it may still be queued
	default:
	}
	select {
	case <-h.beatCh:
		t.Fatal("heartbeat after Pending although a certificate is held")
	case <-time.After(150 * time.Millisecond):
	}
}

// A box holding a certificate that nothing serves says so, and stops saying
// so once it answers.
func TestSaysWhenTheSecureAddressDoesntAnswer(t *testing.T) {
	h, srv := newFakeHub(t)
	h.ready, h.bundle, h.etag = true, bundle(t, testName), `"e3"`
	var down atomic.Bool
	down.Store(true)
	probed := make(chan [2]string, 10)
	c := newClient(t, srv, Options{Every: 20 * time.Millisecond, Check: 5 * time.Millisecond,
		ProbeHTTPS: func(_ context.Context, ip, name string) error {
			probed <- [2]string{ip, name}
			if down.Load() {
				return errors.New("connection refused")
			}
			return nil
		}})
	c.Start()
	defer c.Stop()
	eventually(t, "the warning", func() bool { return strings.Contains(c.Status().Error, "doesn't answer on 192.168.1.55:443") })
	if p := <-probed; p != [2]string{"192.168.1.55", testName} {
		t.Fatalf("probed %v", p)
	}
	if s := c.Status(); s.CertNotAfter == nil || s.URL == "" {
		t.Fatalf("the address should still show beside the warning: %+v", s)
	}
	down.Store(false)
	eventually(t, "the warning to clear", func() bool { return c.Status().Error == "" })
}

// The probe verifies the certificate as a phone would: a self-signed one
// fails, the same one trusted passes, and a wrong name fails.
func TestProbeVerifiesTheCertificate(t *testing.T) {
	srv := httptest.NewTLSServer(http.NotFoundHandler())
	defer srv.Close()
	addr := srv.Listener.Addr().String()
	ctx := context.Background()
	if err := probeTLS(ctx, addr, "example.com", nil); err == nil {
		t.Error("an untrusted certificate passed")
	}
	pool := x509.NewCertPool()
	pool.AddCert(srv.Certificate())
	if err := probeTLS(ctx, addr, "example.com", pool); err != nil {
		t.Errorf("trusted, right name: %v", err)
	}
	if err := probeTLS(ctx, addr, "studio.hindsight.leetserve.com", pool); err == nil {
		t.Error("a certificate for another name passed")
	}
}
