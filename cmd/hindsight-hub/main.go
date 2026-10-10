// Command hindsight-hub gives every enrolled Hindsight a public name for its
// LAN address and a real certificate for it. It runs in the homelab cluster;
// see docs/hub.md.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gabeduke/hindsight/internal/hubserver"
)

// version is stamped at build time with -ldflags "-X main.version=v2026.10.10.1".
var version = "dev"

func main() {
	log.SetFlags(log.Ltime)
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}

	kube, err := hubserver.InCluster()
	if err != nil {
		log.Fatalf("kubernetes: %v", err)
	}
	cfg := hubserver.Config{
		Namespace:     kube.Namespace(),
		Domain:        os.Getenv("HUB_DOMAIN"),
		Issuer:        os.Getenv("HUB_ISSUER"),
		IssuerKind:    os.Getenv("HUB_ISSUER_KIND"),
		DevicesSecret: os.Getenv("HUB_DEVICES_SECRET"),
	}
	if v := os.Getenv("HUB_HEARTBEAT_WINDOW"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d < 0 {
			log.Fatalf("HUB_HEARTBEAT_WINDOW=%q: want a duration like 30s", v)
		}
		cfg.HeartbeatWindow = d
	}
	addr := os.Getenv("HUB_ADDR")
	if addr == "" {
		addr = ":8080"
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           hubserver.New(cfg, kube).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
	go func() {
		ch := make(chan os.Signal, 1)
		signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM)
		<-ch
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()
	log.Printf("[*] hindsight-hub %s — namespace %s, listening on %s", version, kube.Namespace(), addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("listen: %v", err)
	}
}
