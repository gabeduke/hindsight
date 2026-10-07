//go:build unix

package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"
)

// overflowOnSignal makes the demo's audio report an overflow, as an
// interface does when the Pi falls behind it, each time the process gets
// SIGUSR1 -- `kill -USR1 <pid>` -- so a take's dropouts can be seen without
// a rig. Only the demo listens.
func overflowOnSignal(src any) {
	o, ok := src.(interface{ Overflow() })
	if !ok {
		return
	}
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGUSR1)
	go func() {
		for range ch {
			o.Overflow()
			log.Printf("[*] demo: an overflow, as on SIGUSR1")
		}
	}()
}
