// Package hub is the Pi's side of the hub
// (docs/superpowers/specs/2026-10-09-hub-certificates-design.md): it tells
// the hub this Hindsight's LAN address, keeps the certificate the hub has for
// its name in ~/hindsight/tls, and hands that certificate to Caddy on a
// loopback-only listener.
//
// Nothing here may hold up capture: Start returns at once, every network call
// happens in the background, and failures are logged, backed off and shown on
// /api/status.
package hub

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Defaults for Options left zero.
const (
	DefaultEvery      = 10 * time.Minute
	DefaultPending    = time.Minute
	DefaultCheck      = 30 * time.Second
	DefaultMinBackoff = 30 * time.Second
	DefaultMaxBackoff = 10 * time.Minute
)

// Options configures a Client. URL, Token and Dir are required.
type Options struct {
	URL     string // the hub, e.g. https://hub.hindsight.leetserve.com
	Token   string // this device's bearer token
	Version string // reported in each heartbeat
	Dir     string // where cert.pem and key.pem live (~/hindsight/tls)
	// TLSAddr is the loopback address Caddy's get_certificate asks;
	// "" means no listener (tests that use TLSHandler directly).
	TLSAddr string

	Every time.Duration // between heartbeats when nothing changes
	// Pending is between heartbeats while no certificate is held: a new
	// device's is usually issued a minute or two after its first heartbeat,
	// and waiting a whole Every for it leaves the sheet without an address.
	Pending    time.Duration
	Check      time.Duration // how often the LAN address is looked at
	MinBackoff time.Duration // first wait after a failure
	MaxBackoff time.Duration // longest wait after repeated failures

	HTTP *http.Client // nil: a client with a 30 s timeout
	// LocalIP finds the address this machine reaches the hub from; nil
	// uses the route to the hub's host (sourceIP).
	LocalIP func() (string, error)
}

// Status is what /api/status and /api/settings report as "hub".
type Status struct {
	Name          string     `json:"name"`
	URL           string     `json:"url"`
	LastHeartbeat *time.Time `json:"last_heartbeat"`
	Error         string     `json:"error"`
	CertNotAfter  *time.Time `json:"cert_not_after"`
}

// Client is the hub client. The zero value is not usable; see New.
type Client struct {
	o     Options
	store *Store

	mu       sync.Mutex
	name     string // the hub's name for this device
	lastBeat time.Time
	lastErr  string

	ln     net.Listener
	srv    *http.Server
	cancel context.CancelFunc
	done   chan struct{}
	// kick asks the loop to look at the address now (tests).
	kick chan struct{}
}

// New checks the options and loads any certificate already on disk, so the
// secure address works from the first handshake even with no internet.
func New(o Options) (*Client, error) {
	if o.URL == "" || o.Token == "" {
		return nil, errors.New("hub: URL and token are both needed")
	}
	u, err := url.Parse(o.URL)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") {
		return nil, fmt.Errorf("hub: HUB_URL %q is not an http(s) address", o.URL)
	}
	o.URL = strings.TrimRight(o.URL, "/")
	if o.Dir == "" {
		return nil, errors.New("hub: no certificate directory")
	}
	if o.TLSAddr != "" {
		if err := loopbackOnly(o.TLSAddr); err != nil {
			return nil, err
		}
	}
	if o.Every <= 0 {
		o.Every = DefaultEvery
	}
	if o.Pending <= 0 {
		o.Pending = DefaultPending
	}
	if o.Check <= 0 {
		o.Check = DefaultCheck
	}
	if o.MinBackoff <= 0 {
		o.MinBackoff = DefaultMinBackoff
	}
	if o.MaxBackoff <= 0 {
		o.MaxBackoff = DefaultMaxBackoff
	}
	if o.HTTP == nil {
		o.HTTP = &http.Client{Timeout: 30 * time.Second}
	}
	if o.LocalIP == nil {
		host, port := u.Hostname(), u.Port()
		if port == "" {
			port = "443"
		}
		addr := net.JoinHostPort(host, port)
		o.LocalIP = func() (string, error) { return sourceIP(addr) }
	}
	c := &Client{o: o, store: NewStore(o.Dir), kick: make(chan struct{}, 1)}
	if err := c.store.Load(); err != nil {
		log.Printf("[!] hub: %v", err)
	} else if n := c.store.Name(); n != "" {
		c.name = n
		log.Printf("[*] hub: certificate for %s on disk, valid until %s", n, c.store.NotAfter().Format(time.DateOnly))
	}
	return c, nil
}

// loopbackOnly refuses a listen address that isn't loopback: the listener
// answers a private key.
func loopbackOnly(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("hub: HUB_TLS_ADDR %q: %v", addr, err)
	}
	if host == "localhost" {
		return nil
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return nil
	}
	return fmt.Errorf("hub: HUB_TLS_ADDR %q must be a loopback address; it hands out the private key", addr)
}

// sourceIP is the local address of the route to addr. A UDP "connection"
// sends nothing; it only asks the kernel which interface it would use.
func sourceIP(addr string) (string, error) {
	conn, err := net.Dial("udp", addr)
	if err != nil {
		return "", fmt.Errorf("no route to the hub: %v", err)
	}
	defer conn.Close()
	ua, ok := conn.LocalAddr().(*net.UDPAddr)
	if !ok || ua.IP == nil || ua.IP.IsUnspecified() {
		return "", errors.New("no LAN address")
	}
	return ua.IP.String(), nil
}

// Start opens the loopback listener (if configured) and starts heartbeating.
// It never blocks on the network.
func (c *Client) Start() {
	if c.o.TLSAddr != "" {
		ln, err := net.Listen("tcp", c.o.TLSAddr)
		if err != nil {
			log.Printf("[!] hub: certificate listener: %v", err)
			c.setErr(fmt.Sprintf("Caddy's certificate listener on %s: %v", c.o.TLSAddr, err))
		} else {
			c.ln = ln
			c.srv = &http.Server{Handler: c.TLSHandler(), ReadHeaderTimeout: 5 * time.Second}
			go func() {
				if err := c.srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
					log.Printf("[!] hub: certificate listener: %v", err)
				}
			}()
			log.Printf("[*] hub: certificates for Caddy on http://%s/tls", ln.Addr())
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	c.cancel = cancel
	c.done = make(chan struct{})
	go func() {
		defer close(c.done)
		c.run(ctx)
	}()
}

// Stop ends the heartbeats and closes the listener, so a self-restart can
// bind it again.
func (c *Client) Stop() {
	if c.cancel != nil {
		c.cancel()
		<-c.done
		c.cancel = nil
	}
	if c.srv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_ = c.srv.Shutdown(ctx)
		cancel()
		c.srv = nil
	}
}

// Addr is the listener's address, or nil without one.
func (c *Client) Addr() net.Addr {
	if c.ln == nil {
		return nil
	}
	return c.ln.Addr()
}

// Status is the hub's state for the UI. Safe for concurrent use.
func (c *Client) Status() *Status {
	c.mu.Lock()
	defer c.mu.Unlock()
	s := &Status{Name: c.name, Error: c.lastErr}
	if c.name != "" {
		s.URL = "https://" + c.name
	}
	if !c.lastBeat.IsZero() {
		t := c.lastBeat.UTC()
		s.LastHeartbeat = &t
	}
	if na := c.store.NotAfter(); !na.IsZero() {
		t := na.UTC()
		s.CertNotAfter = &t
	}
	return s
}

func (c *Client) setErr(e string) {
	c.mu.Lock()
	c.lastErr = e
	c.mu.Unlock()
}

// run heartbeats at start, every Every, and when the LAN address changes
// (looked at every Check), backing off after failures.
func (c *Client) run(ctx context.Context) {
	var (
		due     = time.Now()
		sent    string // the address the last good heartbeat carried
		backoff time.Duration
		said    string // the last error logged, so a retry loop logs once
	)
	for {
		ip, ipErr := c.o.LocalIP()
		if ipErr == nil && sent != "" && ip != sent && backoff == 0 {
			log.Printf("[*] hub: LAN address changed from %s to %s", sent, ip)
			due = time.Now()
		}
		if !time.Now().Before(due) {
			err := ipErr
			if err == nil {
				err = c.beat(ctx, ip)
			}
			if ctx.Err() != nil {
				return
			}
			if err != nil {
				var he *hubError
				switch {
				case errors.As(err, &he) && he.retryAfter > 0:
					// 429: the hub says when; asking sooner only earns another.
					backoff = he.retryAfter
				case errors.As(err, &he) && he.long:
					// 400/401: retrying soon can't help; someone has to fix it.
					backoff = c.o.MaxBackoff
				default:
					backoff = min(max(2*backoff, c.o.MinBackoff), c.o.MaxBackoff)
				}
				due = time.Now().Add(backoff)
				c.setErr(err.Error())
				if err.Error() != said {
					log.Printf("[!] hub: %v (retrying in %s)", err, backoff)
					said = err.Error()
				}
			} else {
				backoff, said, sent = 0, "", ip
				every := c.o.Every
				if c.store.Name() == "" {
					every = min(every, c.o.Pending)
				}
				due = time.Now().Add(every)
			}
		}
		wait := min(time.Until(due), c.o.Check)
		if wait < 0 {
			wait = 0
		}
		t := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			t.Stop()
			return
		case <-c.kick:
			t.Stop()
		case <-t.C:
		}
	}
}

// heartbeatResponse is the hub's answer to POST /v1/heartbeat.
type heartbeatResponse struct {
	Name         string `json:"name"`
	CertReady    bool   `json:"cert_ready"`
	CertNotAfter string `json:"cert_not_after"`
}

// beat sends one heartbeat and, if the hub says the certificate is ready,
// fetches it (a 304 when it hasn't changed).
func (c *Client) beat(ctx context.Context, ip string) error {
	body, _ := json.Marshal(map[string]string{"lan_ip": ip, "version": c.o.Version})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.o.URL+"/v1/heartbeat", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.o.Token)
	resp, err := c.o.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("heartbeat: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return heartbeatErr(resp)
	}
	var hb heartbeatResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&hb); err != nil {
		return fmt.Errorf("heartbeat: unreadable answer: %v", err)
	}
	if hb.Name == "" {
		return errors.New("heartbeat: the hub sent no name")
	}
	c.mu.Lock()
	if c.name != hb.Name {
		log.Printf("[*] hub: this Hindsight is %s (%s)", hb.Name, ip)
	}
	c.name = hb.Name
	c.lastBeat = time.Now()
	c.lastErr = ""
	c.mu.Unlock()

	if !hb.CertReady {
		if c.store.Name() == "" {
			c.setErr("the hub is still getting a certificate for " + hb.Name)
		}
		return nil
	}
	if err := c.fetchCert(ctx, hb.Name); err != nil {
		// The heartbeat itself worked; a failed fetch is shown but doesn't
		// back off the heartbeats -- the next one tries again.
		c.setErr(err.Error())
		log.Printf("[!] hub: %v", err)
	}
	return nil
}

// fetchCert asks for the certificate, with the ETag of the one held, and
// stores a new one.
func (c *Client) fetchCert(ctx context.Context, name string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.o.URL+"/v1/certificate", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.o.Token)
	if et := c.store.ETag(); et != "" {
		req.Header.Set("If-None-Match", et)
	}
	resp, err := c.o.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("certificate: %v", err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusNotModified:
		return nil
	case http.StatusNotFound:
		if c.store.Name() == "" {
			c.setErr("the hub is still getting a certificate for " + name)
		}
		return nil
	case http.StatusOK:
	default:
		return fmt.Errorf("certificate: %s", httpErr(resp))
	}
	bundle, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("certificate: %v", err)
	}
	if err := c.store.Put(bundle, name, resp.Header.Get("ETag")); err != nil {
		return fmt.Errorf("certificate: %v", err)
	}
	log.Printf("[*] hub: new certificate for %s, valid until %s", name, c.store.NotAfter().Format(time.DateOnly))
	return nil
}

// hubError is a heartbeat the hub refused, with how long to leave it.
type hubError struct {
	msg        string
	long       bool          // back off as far as it goes (400, 401)
	retryAfter time.Duration // the hub's Retry-After (429)
}

func (e *hubError) Error() string { return e.msg }

// heartbeatErr reads a refused heartbeat: 401 a token the hub doesn't know,
// 400 an address it won't publish, 429 too soon after the last new address
// (with Retry-After), 503 the cluster unreachable.
func heartbeatErr(resp *http.Response) error {
	e := &hubError{msg: "heartbeat: " + httpErr(resp)}
	switch resp.StatusCode {
	case http.StatusUnauthorized:
		e.msg, e.long = "hub rejected the token (HUB_TOKEN)", true
	case http.StatusBadRequest:
		e.long = true
	case http.StatusTooManyRequests:
		e.retryAfter = time.Minute
		if n, err := strconv.Atoi(strings.TrimSpace(resp.Header.Get("Retry-After"))); err == nil && n > 0 {
			e.retryAfter = time.Duration(n) * time.Second
		}
	}
	return e
}

// httpErr is "401 Unauthorized: <the body's first line>".
func httpErr(resp *http.Response) string {
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	msg := strings.TrimSpace(string(b))
	var j struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(b, &j) == nil && j.Error != "" {
		msg = j.Error
	}
	if i := strings.IndexByte(msg, '\n'); i >= 0 {
		msg = msg[:i]
	}
	if msg == "" {
		return resp.Status
	}
	return resp.Status + ": " + msg
}

// TLSHandler answers Caddy's get_certificate http module: GET
// /tls?server_name=… gets 200 and the PEM chain then the key when the
// certificate covers server_name, else 204 No Content, which Caddy reads as
// "not mine, fall back" (modules/caddytls/certmanagers.go, HTTPCertGetter).
// It is served only on the loopback listener, never on :5000.
func (c *Client) TLSHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /tls", func(w http.ResponseWriter, r *http.Request) {
		pem := c.store.PEMFor(r.URL.Query().Get("server_name"))
		if pem == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(pem)
	})
	return mux
}
