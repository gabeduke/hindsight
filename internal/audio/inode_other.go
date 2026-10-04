//go:build !unix

package audio

import "io/fs"

// inodeOf is 0 where there are no inodes; the takes cache then keys on size
// and modification time alone.
func inodeOf(fs.FileInfo) uint64 { return 0 }
