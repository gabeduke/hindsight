package audio

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"
)

// Fifty writers each add one flag at the same moment. Without the lock, most
// of them read the sidecar before another's write lands and write back a list
// missing it; with it, every flag survives.
func TestUpdateMetaKeepsEveryConcurrentChange(t *testing.T) {
	wav := filepath.Join(t.TempDir(), "jam_x.wav")
	const n = 50
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := UpdateMeta(wav, func(m *Meta) error {
				m.Flags = append(m.Flags, Flag{ID: fmt.Sprintf("r%08d", i), Frame: int64(i)})
				return nil
			})
			if err != nil {
				t.Errorf("UpdateMeta %d: %v", i, err)
			}
		}(i)
	}
	wg.Wait()
	if got := len(ReadMeta(wav).Flags); got != n {
		t.Errorf("flags = %d, want %d: concurrent writers overwrote each other", got, n)
	}
}

func TestUpdateMetaAbortsWithoutWritingOnError(t *testing.T) {
	wav := filepath.Join(t.TempDir(), "jam_x.wav")
	if err := WriteMeta(wav, Meta{Label: "before"}); err != nil {
		t.Fatal(err)
	}
	_, err := UpdateMeta(wav, func(m *Meta) error {
		m.Label = "after"
		return fmt.Errorf("no")
	})
	if err == nil {
		t.Fatal("want the callback's error")
	}
	if got := ReadMeta(wav).Label; got != "before" {
		t.Errorf("label = %q, want the sidecar untouched", got)
	}
}

func TestLockTakeIsPerTake(t *testing.T) {
	dir := t.TempDir()
	unlockA := LockTake(filepath.Join(dir, "a.wav"))
	defer unlockA()
	done := make(chan struct{})
	go func() {
		unlock := LockTake(filepath.Join(dir, "b.wav"))
		unlock()
		close(done)
	}()
	<-done // would hang if one lock covered every take
}
