//go:build unix

package audio

import (
	"io/fs"
	"syscall"
)

// inodeOf is a file's inode number, or 0 when the platform doesn't say.
func inodeOf(fi fs.FileInfo) uint64 {
	if st, ok := fi.Sys().(*syscall.Stat_t); ok {
		return uint64(st.Ino)
	}
	return 0
}
