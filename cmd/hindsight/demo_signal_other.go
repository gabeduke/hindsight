//go:build !unix

package main

// overflowOnSignal: there's no SIGUSR1 to listen for here.
func overflowOnSignal(any) {}
