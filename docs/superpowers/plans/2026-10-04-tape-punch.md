# Punch, arm, click and free loops — step 6c of the editing-model roadmap

**Spec:** [tape](../specs/2026-10-03-tape-design.md): "Arm and punch", "The
click", the *Free* and *Punch* rows of "Catching". **Checks:**
[guide](../../guide.md) §8.3–8.4. **Branch:** `tape-punch`, stacked on
`tape-sidekick`.

## Decisions taken while building

- **A punch is a deferred catch.** The ring always records, so Rec only
  notes when it was asked; ending it catches what it covered. No recording
  state in the render path, nothing to lose if it's interrupted.
- **What a punch keeps:** with the loop on, the last full pass inside it
  (the spec's "a punch left running keeps the last full one; the others are
  passes"); otherwise, or with no full pass, the bars from its first bar line
  to the last complete one ("stopping during a punch ends it at the last
  complete bar"). It runs until Rec again or ■, rather than ending itself at
  the loop's end, so you can keep playing until a pass is right.
- **Punch in at the next bar line** while playing, loop or not: the spec's
  "next bar or loop start" -- a full pass from the loop start is preferred
  when there is one.
- **Count-in** is transport state: a bar of click with the tape standing at
  the playhead's bar line, then play. ▶ with a track armed asks for it; the
  transport API takes `count_in` for anyone else.
- **The click** is a 25 ms sine blip, 1 kHz on beats and 1.6 kHz on the bar,
  at -12 dBFS on bus A. "On by default only while the tape is empty" is a
  setting that starts on and goes off with the first catch or drop; you can
  turn it back on.
- **Free loops** snap by energy rise (128-frame hops) then a threshold;
  MIDI note-ons aren't used yet. The bar count is the power of two nearest
  the last tape's tempo, or 90; the tempo under the name offers the others.
- **BarAt** now agrees with BarStart's rounding, so a bar line belongs to
  the bar it starts (an old off-by-one that put a catch a bar early when a
  bar line rounded down).

## Tasks

1. Transport: count-in, the phase action; Status.count_in.
2. Mix: the click and the count-in click.
3. `record.go`: Record, Transport (armed ▶, ■ during a punch),
   EndRecording, recordedSpan; tests.
4. `tap.go`: Tap, snapAttack/attackIn, guessBarsNear; tests.
5. API: `/api/tapes/record`, `/api/tapes/tap`; transport answers a kept
   clip.
6. Page: ● Rec (armed, counting, recording), ♩ click, the Tap button,
   the tempo menu; tips.
7. Docs: guide §8.3–8.4, api.md, architecture.md.
