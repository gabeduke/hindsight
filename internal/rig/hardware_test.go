package rig

import (
	"encoding/json"
	"os"
	"path"
	"strings"
	"testing"
)

// The "hardware" block of a profile is notes for people, and for a later
// registry (docs/superpowers/specs/2026-10-15-device-profiles-design.md). The
// loader ignores it, so nothing else would notice it rotting. These checks
// hold it to the few rules that keep it honest.

type hwFact struct {
	Status string `json:"status"`
}

type hwBlock struct {
	USB []struct {
		VID    *string `json:"vid"`
		PID    *string `json:"pid"`
		Status string  `json:"status"`
	} `json:"usb"`
	Audio    *hwFact `json:"audio"`
	MIDI     *hwFact `json:"midi"`
	Storage  *hwFact `json:"storage"`
	Controls *hwFact `json:"controls"`
	Quirks   []struct {
		Text   string `json:"text"`
		Status string `json:"status"`
	} `json:"quirks"`
	Unknowns []struct {
		Question string `json:"question"`
		How      string `json:"how"`
	} `json:"unknowns"`
	Images []string `json:"images"`
	Refs   map[string]struct {
		Title string `json:"title"`
		URL   string `json:"url"`
	} `json:"refs"`
}

var factStatus = map[string]bool{"sourced": true, "owner": true, "unconfirmed": true, "to-capture": true}
var usbStatus = map[string]bool{"captured": true, "hinted": true, "to-capture": true}

func TestHardwareNotesStayHonest(t *testing.T) {
	images, err := os.ReadFile("../../docs/hardware/images.md")
	if err != nil {
		t.Fatalf("docs/hardware/images.md: %v", err)
	}
	entries, err := profileFS.ReadDir("profiles")
	if err != nil {
		t.Fatal(err)
	}
	withNotes := 0
	for _, e := range entries {
		b, err := profileFS.ReadFile(path.Join("profiles", e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		var p struct {
			ID    string   `json:"id"`
			Match Match    `json:"match"`
			HW    *hwBlock `json:"hardware"`
		}
		if err := json.Unmarshal(b, &p); err != nil {
			t.Fatalf("%s: %v", e.Name(), err)
		}
		if p.HW == nil {
			continue // the Sidekick's profile is measured, and has no notes block
		}
		withNotes++
		h := p.HW

		// An id nobody read off a unit must never be matched on.
		captured := false
		for _, u := range h.USB {
			if !usbStatus[u.Status] {
				t.Errorf("%s: usb status %q is not one of captured, hinted, to-capture", p.ID, u.Status)
			}
			if u.Status == "captured" {
				captured = true
				if u.VID == nil || u.PID == nil {
					t.Errorf("%s: a captured usb id needs both a vid and a pid", p.ID)
				}
			}
		}
		if p.Match.USB != "" && !captured {
			t.Errorf("%s matches USB id %q but no usb entry is 'captured': an id nobody read off a unit must not be matched on", p.ID, p.Match.USB)
		}

		for name, f := range map[string]*hwFact{"audio": h.Audio, "midi": h.MIDI, "storage": h.Storage, "controls": h.Controls} {
			if f != nil && !factStatus[f.Status] {
				t.Errorf("%s: %s status %q is not one of sourced, owner, unconfirmed, to-capture", p.ID, name, f.Status)
			}
		}
		for _, q := range h.Quirks {
			if !factStatus[q.Status] {
				t.Errorf("%s: quirk %q has status %q", p.ID, q.Text, q.Status)
			}
		}
		for _, u := range h.Unknowns {
			if strings.TrimSpace(u.Question) == "" || strings.TrimSpace(u.How) == "" {
				t.Errorf("%s: an unknown needs a question and the check that would settle it", p.ID)
			}
		}
		for tag, r := range h.Refs {
			if !strings.HasPrefix(r.URL, "https://") || r.Title == "" {
				t.Errorf("%s: ref %q needs a title and an https url", p.ID, tag)
			}
		}
		if len(h.Images) == 0 {
			t.Errorf("%s: no image ids; list the ones in docs/hardware/images.md", p.ID)
		}
		for _, id := range h.Images {
			if !strings.Contains(string(images), "`"+id+"`") {
				t.Errorf("%s: image %q is not in docs/hardware/images.md", p.ID, id)
			}
		}
	}
	if withNotes == 0 {
		t.Fatal("no profile has a hardware block: the test is checking nothing")
	}
}

// The two new profiles that match by a MIDI port name must find their own
// device and not a neighbour's: "MPC" alone would claim any MPC.
func TestNewProfilesMatchByNameOnly(t *testing.T) {
	for name, want := range map[string]string{
		"MPC Sample MIDI 1": "mpc-sample",
		"SMK-37 Elite":      "smk-37-elite",
		"Bento":             "bento",
	} {
		p, ok := ForMIDI(name)
		if !ok || p.ID != want {
			t.Errorf("ForMIDI(%q) = %q, %v; want %q", name, p.ID, ok, want)
		}
	}
	if p, ok := ForMIDI("MPC Live II"); ok && p.ID == "mpc-sample" {
		t.Errorf("an MPC Live II was taken for an MPC Sample")
	}
	for _, id := range []string{"mpc-sample", "smk-37-elite", "scarlett-solo-4g", "zoom-r20"} {
		for _, p := range Profiles() {
			if p.ID == id && !p.Placeholder {
				t.Errorf("%s names ports nobody has read off a unit, so it must stay a placeholder", id)
			}
		}
	}
}
