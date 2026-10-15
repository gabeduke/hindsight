package rig

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Labels are the jacks you draw: what's plugged into a socket, by its id
// ("ep-136.in1": "guitar"). Hindsight sees signal, not cables, so a label
// names and never routes. They live in rig.json beside settings.json, so
// they stay with the kit and not with a tape.

// LabelsPath is rig.json beside the settings file.
func LabelsPath(settingsFile string) string {
	return filepath.Join(filepath.Dir(settingsFile), "rig.json")
}

type labelsFile struct {
	Labels map[string]string `json:"labels"`
}

// ReadLabels reads rig.json; a missing file is no labels.
func ReadLabels(path string) (map[string]string, error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, err
	}
	var f labelsFile
	if err := json.Unmarshal(b, &f); err != nil {
		return nil, fmt.Errorf("%s: %w", filepath.Base(path), err)
	}
	if f.Labels == nil {
		f.Labels = map[string]string{}
	}
	return f.Labels, nil
}

// WriteLabels replaces rig.json atomically.
func WriteLabels(path string, labels map[string]string) error {
	b, err := json.MarshalIndent(labelsFile{Labels: labels}, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".rig-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

var socketID = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$`)

// MaxLabel is the longest a label can be, in characters.
const MaxLabel = 40

// CleanLabel checks a socket id and tidies its label: one line, at most
// MaxLabel characters. "" removes it.
func CleanLabel(id, label string) (string, error) {
	if !socketID.MatchString(id) || len(id) > 80 {
		return "", fmt.Errorf("%q isn't a socket", id)
	}
	label = strings.Join(strings.Fields(label), " ")
	if utf8.RuneCountInString(label) > MaxLabel {
		r := []rune(label)
		label = string(r[:MaxLabel])
	}
	return label, nil
}
