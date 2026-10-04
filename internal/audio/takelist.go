package audio

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// TakeList serves the takes list without rereading every take on every poll.
//
// The main page polls /api/jams every five seconds. ListTakes opens every
// WAV to read its header and every sidecar to parse it, so a quiet hour cost
// thousands of file reads for a list that never changed. TakeList does one
// directory listing per call and an lstat per entry -- every sidecar sits in
// the same directory, so one listing describes them all -- and builds a
// signature per take from those facts alone: the WAV's and the sidecar's
// size and modification time, and whether the preview, peaks and MIDI exist.
// A take whose signature is unchanged is served from the cache. The ETag is a
// hash of the signatures, so an unchanged list is answered with a 304 before
// any JSON is built.
//
// The modification time is fine as a cache key even though it no longer
// decides a take's place in the list (see TakeCreated): here it only has to
// change when the file does.
type TakeList struct {
	dir string

	mu    sync.Mutex
	cache map[string]cachedTake
}

type cachedTake struct {
	sig  takeSig
	take Take
}

type takeSig struct {
	wavSize, wavMod   int64
	metaSize, metaMod int64 // -1 when there is no sidecar
	// The sidecar's inode. Every sidecar write is a new file renamed into
	// place, so this changes on every write even when the size and the
	// modification time don't: two same-size label edits inside one tick of
	// a coarse filesystem clock would otherwise be cached as one.
	metaIno        uint64
	preview, peaks bool
	midi           bool
}

func NewTakeList(dir string) *TakeList {
	return &TakeList{dir: dir, cache: map[string]cachedTake{}}
}

// List returns the takes in list order and an ETag for them.
func (l *TakeList) List() ([]Take, string, error) {
	entries, err := os.ReadDir(l.dir)
	if err != nil {
		return nil, "", err
	}
	infos := make(map[string]fs.FileInfo, len(entries))
	var wavs []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue // removed between the listing and the lstat
		}
		infos[e.Name()] = info
		if filepath.Ext(e.Name()) == ".wav" {
			wavs = append(wavs, e.Name())
		}
	}
	sort.Strings(wavs)

	h := sha1.New()
	sigs := make(map[string]takeSig, len(wavs))
	for _, name := range wavs {
		s := sigFor(name, infos)
		sigs[name] = s
		fmt.Fprintf(h, "%s|%v\n", name, s)
	}
	etag := hex.EncodeToString(h.Sum(nil)[:8])

	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]Take, 0, len(wavs))
	for _, name := range wavs {
		s := sigs[name]
		if c, ok := l.cache[name]; ok && c.sig == s {
			out = append(out, c.take)
			continue
		}
		t := takeFromFile(l.dir, name, infos[name])
		l.cache[name] = cachedTake{sig: s, take: t}
		out = append(out, t)
	}
	for name := range l.cache {
		if _, ok := sigs[name]; !ok {
			delete(l.cache, name)
		}
	}
	SortTakes(out)
	return out, etag, nil
}

func sigFor(wav string, infos map[string]fs.FileInfo) takeSig {
	stem := strings.TrimSuffix(wav, ".wav")
	s := takeSig{metaSize: -1, metaMod: -1}
	if i := infos[wav]; i != nil {
		s.wavSize, s.wavMod = i.Size(), i.ModTime().UnixNano()
	}
	if i := infos[stem+".meta.json"]; i != nil {
		s.metaSize, s.metaMod = i.Size(), i.ModTime().UnixNano()
		s.metaIno = inodeOf(i)
	}
	_, s.preview = infos[stem+"_preview.mp3"]
	_, s.peaks = infos[stem+".peaks.json"]
	_, s.midi = infos[stem+".mid"]
	return s
}
