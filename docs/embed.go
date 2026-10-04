// Package docs carries the user guide inside the binary, so the app can serve
// it at /guide.md from a checkout or a release alike, with nothing to copy
// next to the UI.
package docs

import _ "embed"

// Guide is docs/guide.md.
//
//go:embed guide.md
var Guide []byte
