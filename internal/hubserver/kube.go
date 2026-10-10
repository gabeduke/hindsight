package hubserver

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"sync"
	"time"
)

// ErrNotFound is what Kube answers for an object that does not exist.
var ErrNotFound = errors.New("not found")

// Kube is everything the hub asks of the Kubernetes API, all of it in its own
// namespace. It is an interface so the handlers are tested with a fake; the
// real one is RESTClient, a few dozen lines of net/http rather than
// client-go, which would more than double this module's dependencies for
// two calls.
type Kube interface {
	// GetSecret answers a Secret's data, or ErrNotFound.
	GetSecret(ctx context.Context, name string) (map[string][]byte, error)
	// Apply server-side applies obj; plural names its resource
	// ("certificates", "dnsendpoints").
	Apply(ctx context.Context, plural string, obj Object) error
}

// Object is the part of a Kubernetes object the hub writes.
type Object struct {
	APIVersion string     `json:"apiVersion"`
	Kind       string     `json:"kind"`
	Metadata   ObjectMeta `json:"metadata"`
	Spec       any        `json:"spec"`
}

// ObjectMeta is the part of metadata the hub writes.
type ObjectMeta struct {
	Name        string            `json:"name"`
	Namespace   string            `json:"namespace,omitempty"`
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

const (
	saDir        = "/var/run/secrets/kubernetes.io/serviceaccount"
	fieldManager = "hindsight-hub"
	// Projected service-account tokens rotate (hourly by default, valid for
	// longer); the kubelet rewrites the file, so it is read again this often.
	tokenTTL = time.Minute
)

// RESTClient talks to the API server the pod runs under, as its service
// account.
type RESTClient struct {
	base      string // https://host:port
	namespace string
	tokenPath string
	http      *http.Client

	mu        sync.Mutex
	token     string
	tokenRead time.Time
}

// InCluster builds a RESTClient from the service account mounted into the
// pod and the KUBERNETES_SERVICE_* variables.
func InCluster() (*RESTClient, error) {
	host, port := os.Getenv("KUBERNETES_SERVICE_HOST"), os.Getenv("KUBERNETES_SERVICE_PORT")
	if host == "" || port == "" {
		return nil, errors.New("KUBERNETES_SERVICE_HOST/PORT unset: not running in a cluster")
	}
	ca, err := os.ReadFile(path.Join(saDir, "ca.crt"))
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(ca) {
		return nil, errors.New("ca.crt: no certificates")
	}
	ns, err := os.ReadFile(path.Join(saDir, "namespace"))
	if err != nil {
		return nil, err
	}
	c := &RESTClient{
		base:      "https://" + net.JoinHostPort(host, port),
		namespace: strings.TrimSpace(string(ns)),
		tokenPath: path.Join(saDir, "token"),
		http: &http.Client{
			Timeout: 15 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig:     &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12},
				MaxIdleConnsPerHost: 4,
				IdleConnTimeout:     90 * time.Second,
			},
		},
	}
	if _, err := c.bearer(); err != nil {
		return nil, err
	}
	return c, nil
}

// Namespace is the namespace the pod runs in, which is the hub's.
func (c *RESTClient) Namespace() string { return c.namespace }

func (c *RESTClient) bearer() (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.token != "" && time.Since(c.tokenRead) < tokenTTL {
		return c.token, nil
	}
	b, err := os.ReadFile(c.tokenPath)
	if err != nil {
		if c.token != "" {
			return c.token, nil // keep the last one rather than fail outright
		}
		return "", err
	}
	c.token, c.tokenRead = strings.TrimSpace(string(b)), time.Now()
	return c.token, nil
}

func (c *RESTClient) do(ctx context.Context, method, p, contentType string, body []byte) ([]byte, error) {
	token, err := c.bearer()
	if err != nil {
		return nil, err
	}
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+p, rd)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	out, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrNotFound
	}
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("%s %s: %s: %s", method, p, resp.Status, statusMessage(out))
	}
	return out, nil
}

// statusMessage pulls the message out of a metav1.Status body, or answers
// the start of whatever came back.
func statusMessage(b []byte) string {
	var st struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(b, &st) == nil && st.Message != "" {
		return st.Message
	}
	if len(b) > 200 {
		b = b[:200]
	}
	return string(b)
}

// GetSecret implements Kube.
func (c *RESTClient) GetSecret(ctx context.Context, name string) (map[string][]byte, error) {
	b, err := c.do(ctx, http.MethodGet,
		"/api/v1/namespaces/"+url.PathEscape(c.namespace)+"/secrets/"+url.PathEscape(name), "", nil)
	if err != nil {
		return nil, err
	}
	var s struct {
		Data map[string][]byte `json:"data"` // base64 in JSON; []byte decodes it
	}
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, fmt.Errorf("secret %s: %w", name, err)
	}
	return s.Data, nil
}

// Apply implements Kube, as a server-side apply that takes ownership of the
// fields it sets (force), so a repeat is a no-op and a hand edit is undone.
func (c *RESTClient) Apply(ctx context.Context, plural string, obj Object) error {
	if obj.Metadata.Namespace == "" {
		obj.Metadata.Namespace = c.namespace
	}
	body, err := json.Marshal(obj) // JSON is YAML, which apply-patch+yaml takes
	if err != nil {
		return err
	}
	p := resourcePath(obj.APIVersion, obj.Metadata.Namespace, plural, obj.Metadata.Name) +
		"?fieldManager=" + fieldManager + "&force=true"
	_, err = c.do(ctx, http.MethodPatch, p, "application/apply-patch+yaml", body)
	return err
}

// resourcePath is the URL path of a namespaced object: core types live under
// /api/v1, everything else under /apis/<group>/<version>.
func resourcePath(apiVersion, namespace, plural, name string) string {
	prefix := "/apis/" + apiVersion
	if !strings.Contains(apiVersion, "/") {
		prefix = "/api/" + apiVersion
	}
	return prefix + "/namespaces/" + url.PathEscape(namespace) + "/" + plural + "/" + url.PathEscape(name)
}
