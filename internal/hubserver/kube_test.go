package hubserver

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRESTClient(t *testing.T) {
	type seen struct{ method, path, query, ctype, auth, body string }
	var got []seen
	ts := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		got = append(got, seen{r.Method, r.URL.Path, r.URL.RawQuery, r.Header.Get("Content-Type"), r.Header.Get("Authorization"), string(b)})
		switch r.URL.Path {
		case "/api/v1/namespaces/hindsight/secrets/hindsight-devices":
			w.Write([]byte(`{"kind":"Secret","data":{"mike":"YWJj"}}`))
		case "/api/v1/namespaces/hindsight/secrets/forbidden":
			w.WriteHeader(http.StatusForbidden)
			w.Write([]byte(`{"kind":"Status","message":"secrets \"forbidden\" is forbidden"}`))
		case "/apis/cert-manager.io/v1/namespaces/hindsight/certificates/mike":
			w.Write([]byte(`{}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer ts.Close()

	tokenPath := filepath.Join(t.TempDir(), "token")
	os.WriteFile(tokenPath, []byte("tok-1\n"), 0o600)
	c := &RESTClient{base: ts.URL, namespace: "hindsight", tokenPath: tokenPath, http: ts.Client()}
	ctx := context.Background()

	data, err := c.GetSecret(ctx, "hindsight-devices")
	if err != nil || string(data["mike"]) != "abc" {
		t.Fatalf("GetSecret: %v %v", data, err)
	}
	if _, err := c.GetSecret(ctx, "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing: %v", err)
	}
	if _, err := c.GetSecret(ctx, "forbidden"); err == nil || errors.Is(err, ErrNotFound) {
		t.Fatalf("forbidden: %v", err)
	}

	// A rotated token is picked up once the cached one is old enough.
	os.WriteFile(tokenPath, []byte("tok-2\n"), 0o600)
	c.tokenRead = time.Now().Add(-2 * tokenTTL)
	err = c.Apply(ctx, "certificates", Object{APIVersion: "cert-manager.io/v1", Kind: "Certificate", Metadata: ObjectMeta{Name: "mike"}, Spec: map[string]string{}})
	if err != nil {
		t.Fatal(err)
	}
	last := got[len(got)-1]
	if last.method != "PATCH" || last.ctype != "application/apply-patch+yaml" ||
		last.query != "fieldManager=hindsight-hub&force=true" || last.auth != "Bearer tok-2" {
		t.Fatalf("apply request: %+v", last)
	}
	var body Object
	json.Unmarshal([]byte(last.body), &body)
	if body.Metadata.Namespace != "hindsight" || body.Kind != "Certificate" {
		t.Fatalf("apply body: %s", last.body)
	}
	if got[0].auth != "Bearer tok-1" {
		t.Fatalf("first token: %q", got[0].auth)
	}
}
