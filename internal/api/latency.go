package api

import "net/http"

// GET /api/latency: control to ear, measured in use (tape/latency.go;
// docs/plan/the-instrument.md, step 1). Each way a control comes in, to
// each ear, with its rolling median, 95th percentile and worst, the buffer
// settings they were taken with, and the underflows so far. Kept on the
// Pi: the Rig's line and the dev overlay read it, nothing sends it on.
func (a *API) handleLatency(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	writeJSON(w, http.StatusOK, a.tape.Latency())
}
