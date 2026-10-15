//go:build race

package tape

// raceOn is whether the tests are built with the race detector, which makes
// rendering about ten times slower: the stress tests run fewer trials there,
// enough to catch a race, and the full count in a plain `go test`.
const raceOn = true
