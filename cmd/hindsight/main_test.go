package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// existsIn returns a predicate reporting true for exactly the given paths,
// so a layout can be described without touching the filesystem.
func existsIn(paths ...string) func(string) bool {
	set := make(map[string]bool, len(paths))
	for _, p := range paths {
		set[filepath.Clean(p)] = true
	}
	return func(p string) bool { return set[filepath.Clean(p)] }
}

func TestResolveStaticDir(t *testing.T) {
	const home = "/home/pi"

	tests := []struct {
		name   string
		env    string
		exe    string
		cwd    string
		exists func(string) bool
		want   string
	}{
		{
			name: "STATIC_DIR wins over every layout",
			env:  "/srv/ui",
			exe:  "/home/pi/hindsight/bin/hindsight",
			cwd:  "/home/pi/hindsight",
			// Deliberately a real layout too: the override must still win.
			exists: existsIn("/home/pi/hindsight/web/static"),
			want:   "/srv/ui",
		},
		{
			name:   "unpacked release: web/static beside bin/",
			exe:    "/home/pi/hindsight/bin/hindsight",
			cwd:    "/home/pi",
			exists: existsIn("/home/pi/hindsight/web/static"),
			want:   "/home/pi/hindsight/web/static",
		},
		{
			name:   "flat layout: static/ beside the binary",
			exe:    "/opt/hindsight/hindsight",
			cwd:    "/",
			exists: existsIn("/opt/hindsight/static"),
			want:   "/opt/hindsight/static",
		},
		{
			name:   "go run from a checkout: only the cwd locates the UI",
			exe:    "/var/folders/T/go-build123/b001/exe/hindsight",
			cwd:    "/Users/dev/hindsight",
			exists: existsIn("/Users/dev/hindsight/web/static"),
			want:   "/Users/dev/hindsight/web/static",
		},
		{
			name:   "nothing found: the install root is the last word",
			exe:    "/usr/bin/hindsight",
			cwd:    "/tmp",
			exists: existsIn(),
			want:   "/home/pi/hindsight/web/static",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveStaticDir(tt.env, tt.exe, tt.cwd, home, tt.exists)
			if got != tt.want {
				t.Errorf("resolveStaticDir() = %q, want %q", got, tt.want)
			}
		})
	}
}

// The UI's fonts are vendored woff2 files. A Pi's mime tables may not know the
// extension, and a font served as application/octet-stream is refused by a
// browser that checks the type, so the type is registered by the binary.
func TestStaticServesWoff2AsFont(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "fonts"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "fonts", "x.woff2"), []byte("wOF2\x00\x01\x00\x00"), 0o644); err != nil {
		t.Fatal(err)
	}
	h := noCacheShell(http.FileServer(http.Dir(dir)))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/fonts/x.woff2", nil))
	if got := rec.Header().Get("Content-Type"); got != "font/woff2" {
		t.Fatalf("Content-Type = %q, want font/woff2", got)
	}
}

// An interface that doesn't fit restarts Hindsight at once when nothing is
// busy, and waits for whatever is busy to finish otherwise.
func TestFitInterface(t *testing.T) {
	misfit := make(chan string, 1)
	var mu sync.Mutex
	busy := "a take is saving"
	restarted := make(chan struct{})
	go fitInterface(misfit, func() string { mu.Lock(); defer mu.Unlock(); return busy },
		func() { close(restarted) }, time.Millisecond)

	misfit <- `"EP-136" has 8 inputs, the ring 2`
	select {
	case <-restarted:
		t.Fatal("restarted while a take was saving")
	case <-time.After(20 * time.Millisecond):
	}
	mu.Lock()
	busy = ""
	mu.Unlock()
	select {
	case <-restarted:
	case <-time.After(2 * time.Second):
		t.Fatal("never restarted once idle")
	}
}
