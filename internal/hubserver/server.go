// Package hubserver is the hub: it turns a Hindsight's heartbeat into an
// external-dns DNSEndpoint and a cert-manager Certificate for
// <name>.<domain>, and hands the issued certificate back to the Pi.
//
// See docs/hub.md and docs/superpowers/specs/2026-10-09-hub-certificates-design.md.
package hubserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Config is the hub's settings; zero fields take the defaults.
type Config struct {
	Namespace     string // where every object lives (the hub's own)
	Domain        string // device names are <name>.<Domain>
	Issuer        string // cert-manager issuer
	IssuerKind    string // ClusterIssuer or Issuer
	DevicesSecret string // the enrolment Secret
	// HeartbeatWindow is the least time between two applies for one device;
	// a heartbeat inside it is answered from the last one.
	HeartbeatWindow time.Duration
	// DevicesTTL is how long the enrolment Secret is cached, so an enrolment
	// or rotation takes effect within it.
	DevicesTTL time.Duration
	Now        func() time.Time // for tests
}

func (c *Config) defaults() {
	if c.Domain == "" {
		c.Domain = "hindsight.leetserve.com"
	}
	if c.Issuer == "" {
		c.Issuer = "letsencrypt-aws-prod"
	}
	if c.IssuerKind == "" {
		c.IssuerKind = "ClusterIssuer"
	}
	if c.DevicesSecret == "" {
		c.DevicesSecret = "hindsight-devices"
	}
	if c.HeartbeatWindow == 0 {
		c.HeartbeatWindow = 30 * time.Second
	}
	if c.DevicesTTL == 0 {
		c.DevicesTTL = 30 * time.Second
	}
	if c.Now == nil {
		c.Now = time.Now
	}
	c.Domain = strings.TrimSuffix(strings.ToLower(c.Domain), ".")
}

// Server is the hub's HTTP handler.
type Server struct {
	cfg     Config
	kube    Kube
	devices *devices

	mu    sync.Mutex
	state map[string]*deviceState
}

// deviceState is a device's last successful heartbeat, for the rate limit.
type deviceState struct {
	mu      sync.Mutex // one apply at a time per device
	applied time.Time
	ip      string
	resp    HeartbeatResponse
}

// New builds a Server over kube.
func New(cfg Config, kube Kube) *Server {
	cfg.defaults()
	return &Server{
		cfg:  cfg,
		kube: kube,
		devices: &devices{
			kube: kube, secret: cfg.DevicesSecret, ttl: cfg.DevicesTTL, now: cfg.Now,
		},
		state: map[string]*deviceState{},
	}
}

// Handler answers the hub's routes.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.HandleFunc("/v1/heartbeat", s.heartbeat)
	mux.HandleFunc("/v1/certificate", s.certificate)
	return mux
}

// HeartbeatRequest is what a Pi sends.
type HeartbeatRequest struct {
	LANIP   string `json:"lan_ip"`
	Version string `json:"version"`
}

// HeartbeatResponse is what it gets back.
type HeartbeatResponse struct {
	Name         string `json:"name"`
	CertReady    bool   `json:"cert_ready"`
	CertNotAfter string `json:"cert_not_after,omitempty"` // RFC 3339, UTC
}

func (s *Server) fqdn(name string) string { return name + "." + s.cfg.Domain }

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// authenticate answers the device the request's bearer token belongs to, or
// writes the error and answers "".
func (s *Server) authenticate(w http.ResponseWriter, r *http.Request) string {
	h := r.Header.Get("Authorization")
	token, ok := strings.CutPrefix(h, "Bearer ")
	token = strings.TrimSpace(token)
	if !ok || token == "" {
		w.Header().Set("WWW-Authenticate", `Bearer realm="hindsight-hub"`)
		writeError(w, http.StatusUnauthorized, "missing bearer token")
		return ""
	}
	name, err := s.devices.lookup(r.Context(), token)
	if err != nil {
		log.Printf("[!] devices: %v", err)
		writeError(w, http.StatusServiceUnavailable, "enrolment unavailable")
		return ""
	}
	if name == "" {
		log.Printf("[!] %s %s: unknown token from %s", r.Method, r.URL.Path, clientAddr(r))
		w.Header().Set("WWW-Authenticate", `Bearer realm="hindsight-hub", error="invalid_token"`)
		writeError(w, http.StatusUnauthorized, "unknown token")
		return ""
	}
	return name
}

// clientAddr is for the log only; Traefik puts the caller in X-Forwarded-For.
func clientAddr(r *http.Request) string {
	if f := r.Header.Get("X-Forwarded-For"); f != "" {
		return strings.TrimSpace(strings.Split(f, ",")[0])
	}
	return r.RemoteAddr
}

func (s *Server) deviceState(name string) *deviceState {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.state[name]
	if st == nil {
		st = &deviceState{}
		s.state[name] = st
	}
	return st
}

func (s *Server) heartbeat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeError(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	name := s.authenticate(w, r)
	if name == "" {
		return
	}
	var req HeartbeatRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "body must be JSON {lan_ip, version}")
		return
	}
	addr, recordType, ok := parseLANIP(req.LANIP)
	if !ok {
		log.Printf("[!] heartbeat %s: refusing lan_ip %q, not a private address", name, req.LANIP)
		writeError(w, http.StatusBadRequest, "lan_ip must be a private address (RFC 1918 or ULA)")
		return
	}
	version := cleanVersion(req.Version)
	ip := addr.String()

	st := s.deviceState(name)
	st.mu.Lock()
	defer st.mu.Unlock()
	now := s.cfg.Now()
	if since := now.Sub(st.applied); !st.applied.IsZero() && since < s.cfg.HeartbeatWindow {
		if ip == st.ip {
			writeJSON(w, http.StatusOK, st.resp)
			return
		}
		// A new address inside the window: say when to come back rather
		// than drop it, so the Pi's retry carries it.
		wait := int(math.Ceil((s.cfg.HeartbeatWindow - since).Seconds()))
		w.Header().Set("Retry-After", fmt.Sprint(wait))
		writeError(w, http.StatusTooManyRequests, "heartbeat too soon")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	meta := s.meta(name, now, version)
	if err := s.kube.Apply(ctx, "dnsendpoints", s.dnsEndpoint(name, recordType, ip, meta)); err != nil {
		log.Printf("[!] heartbeat %s: DNSEndpoint: %v", name, err)
		writeError(w, http.StatusServiceUnavailable, "could not apply the DNS record")
		return
	}
	if err := s.kube.Apply(ctx, "certificates", s.certificateObject(name, meta)); err != nil {
		log.Printf("[!] heartbeat %s: Certificate: %v", name, err)
		writeError(w, http.StatusServiceUnavailable, "could not apply the certificate")
		return
	}

	resp := HeartbeatResponse{Name: s.fqdn(name)}
	cs, err := s.readCert(ctx, name)
	if err != nil {
		log.Printf("[!] heartbeat %s: %s-tls: %v", name, name, err)
	}
	resp.CertReady = cs.Ready
	if !cs.NotAfter.IsZero() {
		resp.CertNotAfter = cs.NotAfter.Format(time.RFC3339)
	}
	if st.ip != ip || st.resp.CertReady != resp.CertReady {
		log.Printf("[*] heartbeat %s: %s %s %s, cert ready %v", name, s.fqdn(name), recordType, ip, resp.CertReady)
	}
	st.applied, st.ip, st.resp = now, ip, resp
	writeJSON(w, http.StatusOK, resp)
}

// cleanVersion keeps a version annotation short and printable.
func cleanVersion(v string) string {
	v = strings.Map(func(r rune) rune {
		if r < 0x20 || r > 0x7e {
			return -1
		}
		return r
	}, strings.TrimSpace(v))
	if len(v) > 64 {
		v = v[:64]
	}
	return v
}

// readCert answers the state of <name>-tls; a Secret that is not there yet
// is "not ready", not an error.
func (s *Server) readCert(ctx context.Context, name string) (certStatus, error) {
	data, err := s.kube.GetSecret(ctx, name+"-tls")
	if errors.Is(err, ErrNotFound) {
		return certStatus{}, nil
	}
	if err != nil {
		return certStatus{}, err
	}
	return readCert(data, s.fqdn(name), s.cfg.Now()), nil
}

func (s *Server) certificate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		writeError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	name := s.authenticate(w, r)
	if name == "" {
		return
	}
	data, err := s.kube.GetSecret(r.Context(), name+"-tls")
	if err != nil && !errors.Is(err, ErrNotFound) {
		log.Printf("[!] certificate %s: %v", name, err)
		writeError(w, http.StatusServiceUnavailable, "could not read the certificate")
		return
	}
	cs := readCert(data, s.fqdn(name), s.cfg.Now())
	if !cs.Ready {
		writeError(w, http.StatusNotFound, "no certificate issued yet")
		return
	}
	etag := `"` + cs.Serial + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "no-store")
	if etagMatches(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	crt, key := data["tls.crt"], data["tls.key"]
	body := make([]byte, 0, len(crt)+len(key)+1)
	body = append(body, crt...)
	if len(body) > 0 && body[len(body)-1] != '\n' {
		body = append(body, '\n')
	}
	body = append(body, key...)
	w.Header().Set("Content-Type", "application/x-pem-file")
	w.Header().Set("Content-Length", fmt.Sprint(len(body)))
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodGet {
		_, _ = w.Write(body)
	}
}

// etagMatches implements If-None-Match's weak comparison: a list of tags, *
// matching anything, W/ ignored. A client that strips the quotes still
// matches.
func etagMatches(header, etag string) bool {
	for _, t := range strings.Split(header, ",") {
		t = strings.TrimPrefix(strings.TrimSpace(t), "W/")
		if t == "*" || t == etag || `"`+t+`"` == etag {
			return true
		}
	}
	return false
}
