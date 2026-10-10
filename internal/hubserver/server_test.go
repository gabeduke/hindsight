package hubserver

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeKube is the API server: Secrets by name, and every apply recorded.
type fakeKube struct {
	mu         sync.Mutex
	secrets    map[string]map[string][]byte
	applied    []applied
	secretGets int
	applyErr   error
}

type applied struct {
	plural string
	obj    Object
}

func (f *fakeKube) GetSecret(_ context.Context, name string) (map[string][]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.secretGets++
	d, ok := f.secrets[name]
	if !ok {
		return nil, ErrNotFound
	}
	return d, nil
}

func (f *fakeKube) Apply(_ context.Context, plural string, obj Object) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.applyErr != nil {
		return f.applyErr
	}
	f.applied = append(f.applied, applied{plural, obj})
	return nil
}

func hashHex(token string) []byte {
	s := sha256.Sum256([]byte(token))
	return []byte(hex.EncodeToString(s[:]))
}

const mikeToken = "mike-secret-token"

type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

func newTestServer(t *testing.T) (*Server, *fakeKube, *clock) {
	t.Helper()
	fk := &fakeKube{secrets: map[string]map[string][]byte{
		"hindsight-devices": {
			"mike":   hashHex(mikeToken),
			"anna":   hashHex("anna-token"),
			"Bad_Nm": hashHex("bad-name-token"), // not a DNS label: ignored
			"hub":    hashHex("hub-token"),      // reserved: ignored
		},
	}}
	c := &clock{t: time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)}
	s := New(Config{Namespace: "hindsight", Now: c.now}, fk)
	return s, fk, c
}

func do(t *testing.T, h http.Handler, method, path, token, body string, hdr ...string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

const beat = `{"lan_ip": "192.168.1.55", "version": "v2026.10.10.2"}`

func TestHeartbeatAuth(t *testing.T) {
	s, fk, _ := newTestServer(t)
	h := s.Handler()
	cases := []struct {
		name, token, header string
		want                int
	}{
		{"good", mikeToken, "", http.StatusOK},
		{"bad token", "nope", "", http.StatusUnauthorized},
		{"missing header", "", "", http.StatusUnauthorized},
		{"not bearer", "", "Basic bWlrZTpwdw==", http.StatusUnauthorized},
		{"invalid name in secret", "bad-name-token", "", http.StatusUnauthorized},
		{"reserved name in secret", "hub-token", "", http.StatusUnauthorized},
	}
	for _, tc := range cases {
		var w *httptest.ResponseRecorder
		if tc.header != "" {
			w = do(t, h, "POST", "/v1/heartbeat", "", beat, "Authorization", tc.header)
		} else {
			w = do(t, h, "POST", "/v1/heartbeat", tc.token, beat)
		}
		if w.Code != tc.want {
			t.Errorf("%s: got %d, want %d (%s)", tc.name, w.Code, tc.want, w.Body)
		}
	}
	if len(fk.applied) != 2 {
		t.Errorf("only the good heartbeat should apply (2 objects), got %d", len(fk.applied))
	}
}

func TestUnknownDeviceWhenNoSecret(t *testing.T) {
	fk := &fakeKube{secrets: map[string]map[string][]byte{}}
	s := New(Config{Namespace: "hindsight"}, fk)
	if w := do(t, s.Handler(), "POST", "/v1/heartbeat", mikeToken, beat); w.Code != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401", w.Code)
	}
}

func TestDevicesCached(t *testing.T) {
	s, fk, c := newTestServer(t)
	for i := 0; i < 3; i++ {
		s.devices.lookup(context.Background(), mikeToken)
	}
	if fk.secretGets != 1 {
		t.Fatalf("devices Secret read %d times inside the TTL, want 1", fk.secretGets)
	}
	c.t = c.t.Add(31 * time.Second)
	s.devices.lookup(context.Background(), mikeToken)
	if fk.secretGets != 2 {
		t.Fatalf("devices Secret not re-read after the TTL")
	}
}

func TestPublicIPRefused(t *testing.T) {
	s, fk, _ := newTestServer(t)
	for _, ip := range []string{"8.8.8.8", "172.32.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1",
		"2001:db8::1", "fe80::1", "::1", "::ffff:8.8.8.8", "not-an-ip", ""} {
		w := do(t, s.Handler(), "POST", "/v1/heartbeat", mikeToken, `{"lan_ip":"`+ip+`"}`)
		if w.Code != http.StatusBadRequest {
			t.Errorf("lan_ip %q: got %d, want 400", ip, w.Code)
		}
	}
	if len(fk.applied) != 0 {
		t.Fatalf("a refused address applied %d objects", len(fk.applied))
	}
}

func TestParseLANIP(t *testing.T) {
	cases := map[string]string{
		"10.1.2.3":            "A",
		"172.16.0.1":          "A",
		"172.31.255.254":      "A",
		"192.168.1.55":        "A",
		"::ffff:192.168.1.55": "A",
		"fd12:3456:789a::1":   "AAAA",
		"fc00::1":             "AAAA",
	}
	for ip, want := range cases {
		_, rt, ok := parseLANIP(ip)
		if !ok || rt != want {
			t.Errorf("%s: got %q ok=%v, want %s", ip, rt, ok, want)
		}
	}
}

func TestApplyPayload(t *testing.T) {
	s, fk, _ := newTestServer(t)
	w := do(t, s.Handler(), "POST", "/v1/heartbeat", mikeToken, beat)
	if w.Code != http.StatusOK {
		t.Fatalf("got %d: %s", w.Code, w.Body)
	}
	if len(fk.applied) != 2 {
		t.Fatalf("applied %d objects, want 2", len(fk.applied))
	}
	// Through JSON, as the API server sees it.
	var got []map[string]any
	for _, a := range fk.applied {
		b, _ := json.Marshal(a.obj)
		var m map[string]any
		json.Unmarshal(b, &m)
		got = append(got, m)
	}
	dns, cert := got[0], got[1]
	if fk.applied[0].plural != "dnsendpoints" || fk.applied[1].plural != "certificates" {
		t.Errorf("plurals %q, %q", fk.applied[0].plural, fk.applied[1].plural)
	}
	if dns["apiVersion"] != "externaldns.k8s.io/v1alpha1" || dns["kind"] != "DNSEndpoint" {
		t.Errorf("DNSEndpoint type: %v %v", dns["apiVersion"], dns["kind"])
	}
	if cert["apiVersion"] != "cert-manager.io/v1" || cert["kind"] != "Certificate" {
		t.Errorf("Certificate type: %v %v", cert["apiVersion"], cert["kind"])
	}
	for _, o := range got {
		md := o["metadata"].(map[string]any)
		if md["name"] != "mike" || md["namespace"] != "hindsight" {
			t.Errorf("%v: name/namespace %v/%v", o["kind"], md["name"], md["namespace"])
		}
		labels := md["labels"].(map[string]any)
		if labels["app.kubernetes.io/managed-by"] != "hindsight-hub" || labels["hindsight.leetserve.com/device"] != "mike" {
			t.Errorf("%v: labels %v", o["kind"], labels)
		}
		ann := md["annotations"].(map[string]any)
		if ann["hindsight.leetserve.com/last-heartbeat"] != "2026-10-09T12:00:00Z" || ann["hindsight.leetserve.com/version"] != "v2026.10.10.2" {
			t.Errorf("%v: annotations %v", o["kind"], ann)
		}
	}
	ep := dns["spec"].(map[string]any)["endpoints"].([]any)
	if len(ep) != 1 {
		t.Fatalf("endpoints: %v", ep)
	}
	e := ep[0].(map[string]any)
	if e["dnsName"] != "mike.hindsight.leetserve.com" || e["recordType"] != "A" ||
		e["recordTTL"] != float64(60) || e["targets"].([]any)[0] != "192.168.1.55" {
		t.Errorf("endpoint: %v", e)
	}
	spec := cert["spec"].(map[string]any)
	if spec["secretName"] != "mike-tls" || spec["dnsNames"].([]any)[0] != "mike.hindsight.leetserve.com" {
		t.Errorf("certificate spec: %v", spec)
	}
	ir := spec["issuerRef"].(map[string]any)
	if ir["name"] != "letsencrypt-aws-prod" || ir["kind"] != "ClusterIssuer" {
		t.Errorf("issuerRef: %v", ir)
	}

	var resp HeartbeatResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Name != "mike.hindsight.leetserve.com" || resp.CertReady || resp.CertNotAfter != "" {
		t.Errorf("response before issue: %+v", resp)
	}
}

func TestIPv6ULAIsAAAA(t *testing.T) {
	s, fk, _ := newTestServer(t)
	w := do(t, s.Handler(), "POST", "/v1/heartbeat", mikeToken, `{"lan_ip":"fd00:abcd::55","version":"x"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("got %d: %s", w.Code, w.Body)
	}
	e := fk.applied[0].obj.Spec.(DNSEndpointSpec).Endpoints[0]
	if e.RecordType != "AAAA" || e.Targets[0] != "fd00:abcd::55" {
		t.Fatalf("endpoint %+v", e)
	}
}

func TestApplyFailureIs503(t *testing.T) {
	s, fk, _ := newTestServer(t)
	fk.applyErr = errors.New("forbidden")
	if w := do(t, s.Handler(), "POST", "/v1/heartbeat", mikeToken, beat); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("got %d, want 503", w.Code)
	}
	// A failed apply does not start the window.
	fk.applyErr = nil
	if w := do(t, s.Handler(), "POST", "/v1/heartbeat", mikeToken, beat); w.Code != http.StatusOK {
		t.Fatalf("retry got %d, want 200", w.Code)
	}
}

func TestRateLimit(t *testing.T) {
	s, fk, c := newTestServer(t)
	h := s.Handler()
	do(t, h, "POST", "/v1/heartbeat", mikeToken, beat)
	if len(fk.applied) != 2 {
		t.Fatalf("first heartbeat applied %d", len(fk.applied))
	}
	// Same address inside the window: answered from the last result.
	c.t = c.t.Add(10 * time.Second)
	w := do(t, h, "POST", "/v1/heartbeat", mikeToken, beat)
	if w.Code != http.StatusOK || len(fk.applied) != 2 {
		t.Fatalf("inside the window: %d, applied %d", w.Code, len(fk.applied))
	}
	var resp HeartbeatResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Name != "mike.hindsight.leetserve.com" {
		t.Errorf("cached response %+v", resp)
	}
	// A new address inside the window: come back later.
	w = do(t, h, "POST", "/v1/heartbeat", mikeToken, `{"lan_ip":"10.0.0.9"}`)
	if w.Code != http.StatusTooManyRequests || w.Header().Get("Retry-After") != "20" {
		t.Fatalf("new address inside the window: %d Retry-After %q", w.Code, w.Header().Get("Retry-After"))
	}
	// Another device is not limited by mike.
	if w := do(t, h, "POST", "/v1/heartbeat", "anna-token", beat); w.Code != http.StatusOK || len(fk.applied) != 4 {
		t.Fatalf("anna: %d, applied %d", w.Code, len(fk.applied))
	}
	// After the window, applied again.
	c.t = c.t.Add(25 * time.Second)
	do(t, h, "POST", "/v1/heartbeat", mikeToken, `{"lan_ip":"10.0.0.9"}`)
	if len(fk.applied) != 6 || fk.applied[4].obj.Spec.(DNSEndpointSpec).Endpoints[0].Targets[0] != "10.0.0.9" {
		t.Fatalf("after the window: applied %d", len(fk.applied))
	}
}

// selfSigned makes a PEM cert and key for names, valid from nb to na.
func selfSigned(t *testing.T, serial int64, nb, na time.Time, names ...string) (crt, key []byte) {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(serial),
		Subject:      pkix.Name{CommonName: "test"},
		DNSNames:     names,
		NotBefore:    nb,
		NotAfter:     na,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &k.PublicKey, k)
	if err != nil {
		t.Fatal(err)
	}
	kb, _ := x509.MarshalECPrivateKey(k)
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kb})
}

func TestReadCert(t *testing.T) {
	now := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	fqdn := "mike.hindsight.leetserve.com"
	good, key := selfSigned(t, 0xabc, now.Add(-time.Hour), now.Add(90*24*time.Hour), fqdn)
	other, _ := selfSigned(t, 2, now.Add(-time.Hour), now.Add(time.Hour), "anna.hindsight.leetserve.com")
	expired, _ := selfSigned(t, 3, now.Add(-48*time.Hour), now.Add(-time.Hour), fqdn)

	st := readCert(map[string][]byte{"tls.crt": good, "tls.key": key}, fqdn, now)
	if !st.Ready || st.Serial != "abc" || !st.NotAfter.Equal(now.Add(90*24*time.Hour)) {
		t.Errorf("good: %+v", st)
	}
	if readCert(map[string][]byte{"tls.crt": other, "tls.key": key}, fqdn, now).Ready {
		t.Error("a cert for another name is ready")
	}
	if st := readCert(map[string][]byte{"tls.crt": expired, "tls.key": key}, fqdn, now); st.Ready || st.NotAfter.IsZero() {
		t.Errorf("expired: %+v", st)
	}
	if readCert(map[string][]byte{"tls.crt": good}, fqdn, now).Ready {
		t.Error("ready without a key")
	}
	if readCert(map[string][]byte{"tls.crt": []byte("garbage")}, fqdn, now).Ready {
		t.Error("garbage is ready")
	}
	if readCert(nil, fqdn, now).Ready {
		t.Error("nothing is ready")
	}
}

func TestCertificateEndpoint(t *testing.T) {
	s, fk, c := newTestServer(t)
	h := s.Handler()
	if w := do(t, h, "GET", "/v1/certificate", "nope", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("bad token: %d", w.Code)
	}
	if w := do(t, h, "GET", "/v1/certificate", mikeToken, ""); w.Code != http.StatusNotFound {
		t.Fatalf("before issue: %d, want 404", w.Code)
	}

	crt, key := selfSigned(t, 0x1f2e, c.t.Add(-time.Hour), c.t.Add(90*24*time.Hour), "mike.hindsight.leetserve.com")
	fk.secrets["mike-tls"] = map[string][]byte{"tls.crt": crt, "tls.key": key}

	w := do(t, h, "GET", "/v1/certificate", mikeToken, "")
	if w.Code != http.StatusOK {
		t.Fatalf("issued: %d", w.Code)
	}
	if etag := w.Header().Get("ETag"); etag != `"1f2e"` {
		t.Fatalf("ETag %q", etag)
	}
	if body := w.Body.String(); !strings.Contains(body, "BEGIN CERTIFICATE") || !strings.Contains(body, "PRIVATE KEY") {
		t.Fatalf("body is not a cert+key bundle: %q", body)
	}
	for _, inm := range []string{`"1f2e"`, `W/"1f2e"`, `"old", "1f2e"`, `1f2e`, `*`} {
		w := do(t, h, "GET", "/v1/certificate", mikeToken, "", "If-None-Match", inm)
		if w.Code != http.StatusNotModified || w.Body.Len() != 0 {
			t.Errorf("If-None-Match %s: %d, %d bytes", inm, w.Code, w.Body.Len())
		}
	}
	if w := do(t, h, "GET", "/v1/certificate", mikeToken, "", "If-None-Match", `"old"`); w.Code != http.StatusOK {
		t.Errorf("stale ETag: %d", w.Code)
	}

	// The heartbeat now says ready, with the expiry.
	w = do(t, h, "POST", "/v1/heartbeat", mikeToken, beat)
	var resp HeartbeatResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if !resp.CertReady || resp.CertNotAfter != "2027-01-07T12:00:00Z" {
		t.Fatalf("heartbeat after issue: %+v", resp)
	}

	// anna cannot have mike's certificate: hers is looked up by her token.
	if w := do(t, h, "GET", "/v1/certificate", "anna-token", ""); w.Code != http.StatusNotFound {
		t.Fatalf("anna got %d", w.Code)
	}
}

func TestValidName(t *testing.T) {
	for _, n := range []string{"mike", "a", "gift-pi-2", "0abc", strings.Repeat("a", 63)} {
		if !ValidName(n) {
			t.Errorf("%q should be valid", n)
		}
	}
	for _, n := range []string{"", "Mike", "-mike", "mike-", "mi_ke", "mi.ke", strings.Repeat("a", 64),
		"hub", "find", "hindsight-hub", "mike\n"} {
		if ValidName(n) {
			t.Errorf("%q should be invalid", n)
		}
	}
}

func TestMethodsAndHealth(t *testing.T) {
	s, _, _ := newTestServer(t)
	h := s.Handler()
	if w := do(t, h, "GET", "/v1/heartbeat", mikeToken, ""); w.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET heartbeat: %d", w.Code)
	}
	if w := do(t, h, "GET", "/healthz", "", ""); w.Code != http.StatusOK {
		t.Errorf("healthz: %d", w.Code)
	}
	if w := do(t, h, "POST", "/v1/heartbeat", mikeToken, "not json"); w.Code != http.StatusBadRequest {
		t.Errorf("bad body: %d", w.Code)
	}
}

func TestResourcePath(t *testing.T) {
	if p := resourcePath("cert-manager.io/v1", "hindsight", "certificates", "mike"); p != "/apis/cert-manager.io/v1/namespaces/hindsight/certificates/mike" {
		t.Error(p)
	}
	if p := resourcePath("v1", "hindsight", "secrets", "mike-tls"); p != "/api/v1/namespaces/hindsight/secrets/mike-tls" {
		t.Error(p)
	}
}
