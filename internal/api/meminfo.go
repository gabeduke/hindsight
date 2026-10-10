package api

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

// totalMemory is the machine's RAM in bytes, from /proc/meminfo, or 0 where
// there is none (a Mac running the demo). The sheet weighs the buffer
// length against it.
func totalMemory() uint64 {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) >= 2 && fields[0] == "MemTotal:" {
			kb, err := strconv.ParseUint(fields[1], 10, 64)
			if err != nil {
				return 0
			}
			return kb * 1024
		}
	}
	return 0
}
