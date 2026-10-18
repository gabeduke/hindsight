package tape

import (
	"testing"
	"time"
)

func TestCueAddRemove(t *testing.T) {
	now := time.Now()
	tp := NewTape("t1", "Cue Test", 48000, 48000*60, 4, now)

	clip, err := tp.CueAdd(now, CueClip{
		File:   "audio/take_a.wav",
		Frames: 48000 * 2,
		Loop:   true,
		GainDB: -2.5,
		Name:   "A funky take",
	})
	if err != nil {
		t.Fatalf("CueAdd failed: %v", err)
	}
	if clip.ID == "" {
		t.Errorf("expected non-empty clip ID")
	}
	if tp.State.Cue == nil || len(tp.State.Cue.Clips) != 1 {
		t.Fatalf("expected 1 cue clip, got %v", tp.State.Cue)
	}
	if tp.State.Cue.Clips[0].Name != "A funky take" {
		t.Errorf("expected name 'A funky take', got %q", tp.State.Cue.Clips[0].Name)
	}

	// Undo CueAdd
	if err := tp.Undo(); err != nil {
		t.Fatalf("Undo failed: %v", err)
	}
	if tp.State.Cue != nil && len(tp.State.Cue.Clips) != 0 {
		t.Errorf("expected 0 clips after undo, got %d", len(tp.State.Cue.Clips))
	}

	// Redo CueAdd
	if err := tp.Redo(); err != nil {
		t.Fatalf("Redo failed: %v", err)
	}
	if tp.State.Cue == nil || len(tp.State.Cue.Clips) != 1 {
		t.Fatalf("expected 1 clip after redo, got %v", tp.State.Cue)
	}

	// Remove clip
	if err := tp.CueRemove(now.Add(time.Second), clip.ID); err != nil {
		t.Fatalf("CueRemove failed: %v", err)
	}
	if len(tp.State.Cue.Clips) != 0 {
		t.Errorf("expected 0 clips after remove, got %d", len(tp.State.Cue.Clips))
	}
}

func TestCueSetAndSolo(t *testing.T) {
	now := time.Now()
	tp := NewTape("t1", "Cue Solo Test", 48000, 48000*60, 4, now)

	clip, err := tp.CueAdd(now, CueClip{
		File:   "audio/take_b.wav",
		Frames: 48000,
	})
	if err != nil {
		t.Fatalf("CueAdd failed: %v", err)
	}

	// Update clip
	clip.Loop = true
	clip.GainDB = 3.0
	clip.FadeIn = 480
	if _, err := tp.CueSet(now.Add(time.Second), clip); err != nil {
		t.Fatalf("CueSet failed: %v", err)
	}
	if !tp.State.Cue.Clips[0].Loop || tp.State.Cue.Clips[0].GainDB != 3.0 || tp.State.Cue.Clips[0].FadeIn != 480 {
		t.Errorf("unexpected cue clip after set: %+v", tp.State.Cue.Clips[0])
	}

	// Solo toggle
	if err := tp.CueSetSolo(now.Add(2*time.Second), true); err != nil {
		t.Fatalf("CueSetSolo failed: %v", err)
	}
	if !tp.State.Cue.Solo {
		t.Errorf("expected Cue.Solo to be true")
	}

	if err := tp.CueSetSolo(now.Add(3*time.Second), false); err != nil {
		t.Fatalf("CueSetSolo failed: %v", err)
	}
	if tp.State.Cue.Solo {
		t.Errorf("expected Cue.Solo to be false")
	}
}

func TestCueToTrack(t *testing.T) {
	now := time.Now()
	tp := NewTape("t1", "Cue To Track Test", 48000, 48000*60, 4, now)

	cueClip, err := tp.CueAdd(now, CueClip{
		File:   "audio/take_c.wav",
		Src:    2400,
		Frames: 48000,
		GainDB: -1.5,
		Source: "take",
	})
	if err != nil {
		t.Fatalf("CueAdd failed: %v", err)
	}

	placed, err := tp.CueToTrack(now.Add(time.Second), cueClip.ID, 2, 96000)
	if err != nil {
		t.Fatalf("CueToTrack failed: %v", err)
	}
	if placed.At != 96000 || placed.File != cueClip.File || placed.Src != 2400 || placed.Frames != 48000 {
		t.Errorf("unexpected placed clip: %+v", placed)
	}

	// Check track 2 has the clip
	if len(tp.State.Tracks[1].Clips) != 1 {
		t.Fatalf("expected 1 clip on track 2, got %d", len(tp.State.Tracks[1].Clips))
	}
	// Check cue lane still keeps the cue clip
	if len(tp.State.Cue.Clips) != 1 {
		t.Errorf("expected cue lane to keep its clip, got %d clips", len(tp.State.Cue.Clips))
	}
}

func TestCueEditOps(t *testing.T) {
	e, _, tp := newEngine(t)

	// cue-add
	addRes, err := e.EditOp(tp.ID, EditRequest{
		Op: "cue-add",
		CueClip: &CueClip{
			File:   "audio/cue1.wav",
			Frames: 48000,
			Name:   "Staged Lead",
		},
	})
	if err != nil {
		t.Fatalf("cue-add failed: %v", err)
	}
	if addRes.CueClip == nil || addRes.CueClip.ID == "" {
		t.Fatalf("cue-add expected CueClip result, got %+v", addRes)
	}
	clipID := addRes.CueClip.ID

	// cue-set
	setRes, err := e.EditOp(tp.ID, EditRequest{
		Op: "cue-set",
		CueClip: &CueClip{
			ID:     clipID,
			Loop:   true,
			GainDB: -4.0,
		},
	})
	if err != nil {
		t.Fatalf("cue-set failed: %v", err)
	}
	if setRes.CueClip == nil || !setRes.CueClip.Loop {
		t.Errorf("cue-set expected updated CueClip")
	}

	// cue-solo
	soloTrue := true
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "cue-solo", Solo: &soloTrue}); err != nil {
		t.Fatalf("cue-solo failed: %v", err)
	}
	if !e.Loaded().State.Cue.Solo {
		t.Errorf("expected Cue.Solo to be true")
	}

	// cue-to-track
	atPos := int64(24000)
	toTrackRes, err := e.EditOp(tp.ID, EditRequest{
		Op:    "cue-to-track",
		Clip:  clipID,
		Track: 1,
		At:    &atPos,
	})
	if err != nil {
		t.Fatalf("cue-to-track failed: %v", err)
	}
	if toTrackRes.Clip == nil || toTrackRes.Clip.At != 24000 {
		t.Errorf("cue-to-track expected Clip at 24000, got %+v", toTrackRes)
	}

	// cue-remove
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "cue-remove", Clip: clipID}); err != nil {
		t.Fatalf("cue-remove failed: %v", err)
	}
	if len(e.Loaded().State.Cue.Clips) != 0 {
		t.Errorf("expected 0 cue clips after remove")
	}
}
