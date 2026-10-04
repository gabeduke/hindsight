//go:build !cgo

package audio

import "github.com/gabeduke/hindsight/internal/config"

// NewDeviceSink without cgo has no PortAudio to play through: the tape runs
// without an output.
func NewDeviceSink(_ *config.Config, _ func() string) Sink { return nil }
