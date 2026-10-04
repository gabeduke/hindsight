// web/static/lib/help/tips.js
// Every control's tip, in one place. The same rows are the table in
// docs/guide.md §9 ("Tips in the app"), and help.test.js fails if the two
// disagree, or if a control in the HTML names a tip that isn't here.
//
// `control` is how the guide's table names the control; `ids` are the
// data-tip values that show this tip. Rows for the tape page are here too,
// ahead of it, so the guide's table and this file stay one list.

export const TIPS = [
  // Every page's header
  { control: 'Hindsight', ids: ['home'], tip: 'Back to Capture, from anywhere' },
  { control: 'Capture (tab)', ids: ['nav-capture'], tip: 'The ribbon, the meters and Capture. The lamp is the ring: green while it records' },
  { control: 'Takes (tab)', ids: ['nav-takes'], tip: 'Every take, to search, filter, sort and open' },
  { control: 'Tape (tab)', ids: ['nav-tape'], tip: 'The tape: layer loops caught from what you just played' },
  // The main page
  { control: 'Capture', ids: ['capture'], tip: 'Save the last 30 s, 2 m, 7 m or all of what you just played as a take' },
  { control: 'Flag now', ids: ['flag-now'], tip: 'Mark this moment. Any take that includes it gets a flag here' },
  { control: 'Ribbon', ids: ['ribbon'], tip: 'The last 15 minutes, recent end stretched. Hold and drag to select a span; tap a flag for its options' },
  { control: 'Save as take (ribbon)', ids: ['ribbon-save'], tip: 'Save exactly the span you selected on the ribbon as a take' },
  { control: '× (ribbon)', ids: ['ribbon-clear'], tip: 'Forget the span selected on the ribbon' },
  { control: 'Save from here to now', ids: ['flag-save-from'], tip: 'Save a take that starts at this flag and runs to now' },
  { control: 'Delete flag (ribbon)', ids: ['flag-remove'], tip: 'Remove this flag. Takes saved later won\'t carry it' },
  { control: 'Phone', ids: ['phone'], tip: "Record from this phone's mic or a plugged-in input, straight into Hindsight" },
  // The takes page
  { control: 'All takes', ids: ['all-takes'], tip: 'Every take, on a page of its own, to search, filter and sort' },
  { control: 'Search', ids: ['search'], tip: 'Find a take by its name, its time or its tempo' },
  { control: 'Filters', ids: ['filter'], tip: 'Show only starred takes, takes with MIDI, takes from a phone, or tape mixdowns' },
  { control: 'Newest / Longest', ids: ['sort'], tip: 'Newest groups the takes by the day they were made; Longest puts the longest first' },
  { control: 'Open', ids: ['open'], tip: 'Open the take to select, loop, save or share part of it' },
  { control: 'Select', ids: ['select'], tip: 'Pick several takes to star, export or delete together. Holding a take does the same' },
  { control: '★ Star (selecting)', ids: ['bulk-star'], tip: 'Star the picked takes, or unstar them if they all are' },
  { control: 'Export', ids: ['bulk-export'], tip: 'One zip of the picked takes: each WAV, its name and flags, and its MIDI' },
  { control: 'Delete (selecting)', ids: ['bulk-delete'], tip: 'Move the picked takes to the trash' },
  { control: 'Done', ids: ['select-done'], tip: 'Stop selecting' },
  { control: 'Restore', ids: ['restore'], tip: 'Put this take back in the list, starred' },
  { control: '× (Recently deleted)', ids: ['delete-forever'], tip: 'Delete this take for good' },
  { control: 'Empty', ids: ['trash-empty'], tip: 'Delete everything in the trash for good' },
  // A take, on either page
  { control: '★', ids: ['star'], tip: 'Star the takes worth keeping: they are pruned last, and the Starred filter shows them alone' },
  { control: 'Name', ids: ['rename'], tip: 'Tap to rename the take' },
  { control: 'BPM', ids: ['bpm'], tip: 'Tap to set the tempo. It draws the bar grid and makes Snap possible' },
  { control: 'Download WAV', ids: ['dl-wav'], tip: 'The whole take, as recorded' },
  { control: 'Download MIDI', ids: ['dl-midi'], tip: "The take's MIDI file" },
  { control: 'Delete take', ids: ['delete'], tip: 'Move this take to the trash. Recently deleted, under the list, keeps it a week' },
  // The take page
  { control: '‹', ids: ['back'], tip: 'Back to the list, where you left it' },
  { control: '◂ ▸', ids: ['take-prev', 'take-next'], tip: 'The previous or next take in the list' },
  { control: 'from …', ids: ['source'], tip: 'This take was saved from another one. Tap to open that one' },
  { control: '↶', ids: ['undo'], tip: 'Undo your last change to this take: a flag, the selection, the name, tempo, downbeat or lanes' },
  { control: '?', ids: ['help'], tip: 'Help mode: tap anything to read what it does, instead of doing it' },
  { control: '⋯', ids: ['menu'], tip: 'Reset the downbeat, or open this guide' },
  { control: 'Reset the downbeat', ids: ['downbeat-reset'], tip: 'Put bar 1 back at the start of the take' },
  { control: 'The guide', ids: ['guide'], tip: 'How Hindsight works, in plain words' },
  { control: 'Overview', ids: ['overview'], tip: 'The whole take. Drag the window to move along it; double-tap to see it all' },
  { control: 'Waveform', ids: ['waveform'], tip: 'Drag to move along, pinch to zoom. Hold, then drag, to select. Tap to move the playhead; tap twice to flag' },
  { control: '▶', ids: ['play'], tip: 'Play from the playhead' },
  { control: '⟲ Loop', ids: ['loop'], tip: 'Repeat the selection instead of playing straight through' },
  { control: 'In', ids: ['in'], tip: 'Start the selection at the playhead' },
  { control: 'Out', ids: ['out'], tip: 'End the selection at the playhead' },
  { control: '⚑', ids: ['flag'], tip: 'Drop a flag at the playhead' },
  { control: '◂⚑ ⚑▸', ids: ['flag-prev', 'flag-next'], tip: 'Jump to the previous or next flag' },
  { control: 'Delete flag', ids: ['flag-delete'], tip: 'Remove this flag' },
  { control: '◂ ▸ beside In and Out', ids: ['nudge'], tip: 'Move that end of the selection to the next snap line, or by 10 ms' },
  { control: 'Clear', ids: ['clear'], tip: 'Forget the selection. The take itself is untouched' },
  { control: 'Snap', ids: ['snap'], tip: 'Make the selection, In, Out and the nudges land on bars, beats or 8ths' },
  { control: 'Practice speed', ids: ['speed'], tip: 'Slow down or speed up without changing pitch' },
  { control: 'Save as take', ids: ['save-take'], tip: 'Make a new take of just the selection' },
  { control: 'Share', ids: ['share'], tip: 'Send the selection from your phone as an MP3' },
  { control: 'More', ids: ['more'], tip: 'The DAW bundle, the WAV and MIDI downloads, and delete' },
  { control: 'DAW bundle', ids: ['bundle'], tip: "The selection's WAV and MIDI, lined up, in a zip for a DAW" },
  { control: 'Notes', ids: ['notes-open'], tip: "Watch the take's MIDI rise out of a keyboard as it plays" },
  { control: 'Lane', ids: ['lane'], tip: "Tap for this lane's menu: collapse, show as drums or notes, or hide" },
  // Later steps
  { control: 'Send to tape', ids: ['send-to-tape'], tip: 'Put the selection on the loaded tape at its playhead, or make it the first loop of an empty tape' },
  // The tape page
  { control: 'Tape name', ids: ['tape-menu'], tip: 'Your tapes: load one, or make a new one' },
  { control: '⋯ (tape)', ids: ['tape-more'], tip: 'This tape: clone it, mix it down, export its stems, or delete a tape' },
  { control: 'A tape in the list', ids: ['tape-load'], tip: 'Load this tape: the transport plays the loaded one' },
  { control: 'New tape', ids: ['tape-new'], tip: 'Start an empty tape. Its first loop sets the tempo' },
  { control: 'Delete a tape', ids: ['tape-delete'], tip: 'Delete another tape. Audio it shares with others stays' },
  { control: 'BPM, Bars (empty tape)', ids: ['tape-bpm'], tip: 'Start from a tempo instead of a first loop' },
  { control: '↶ ↷ (tape)', ids: ['tape-undo', 'tape-redo'], tip: 'Undo or redo the last change to the tape: up to 100 steps. Keys: ⌘Z or Ctrl-Z, with ⇧ to redo' },
  { control: 'Tape overview', ids: ['tape-overview'], tip: 'The whole tape, six minutes a track; the loop in amber, and a dashed box round what the lanes show once you zoom' },
  { control: 'A lane', ids: ['tape-lane'], tip: 'Tap a clip for its sheet. Hold a clip, then drag, to slide it. Tap elsewhere to move the playhead there. Drag sideways to pan, pinch to zoom (⌘ or Ctrl with a scroll on a computer). A punch shows in red as it records' },
  { control: 'A track header', ids: ['track'], tip: 'Tap the number to pick the track catches go onto. Keys: 1–4, or ↑ ↓' },
  { control: 'M, S', ids: ['track-mute', 'track-solo'], tip: 'Mute this track, or solo it: only soloed tracks play' },
  { control: 'Track level', ids: ['track-gain'], tip: 'The track\'s level into its bus, -30 to +6 dB. Tracks start at -6' },
  { control: '▶ (tape)', ids: ['tape-play'], tip: 'Play or stop the tape. Key: Space' },
  { control: 'Ruler (tape)', ids: ['tape-ruler'], tip: 'Tap: the playhead to that bar. Hold, then drag: loop those bars. Drag sideways to pan, pinch to zoom' },
  { control: 'Fit', ids: ['view-fit'], tip: 'Back to the loop and a bar either side, after a pinch, a pan, or the playhead paging the view along' },
  { control: 'Layer / Replace', ids: ['catch-mode'], tip: 'Onto audio already there: layer on top of it, or replace it' },
  { control: 'Clipboard', ids: ['clipboard'], tip: 'What you copied last, from a take or the ribbon. Tap to hear it' },
  { control: '× (clipboard)', ids: ['clipboard-clear'], tip: 'Empty the clipboard' },
  { control: 'Repeat to the loop’s end', ids: ['clip-tile'], tip: 'Copies of this clip end to end, to the end of the loop: one bar through four' },
  { control: 'Track name', ids: ['track-name'], tip: 'What’s on this track, for you: chords, bass…' },
  { control: 'Pan', ids: ['track-pan'], tip: 'Where this track sits between left and right' },
  { control: 'Copy (ribbon)', ids: ['ribbon-copy'], tip: 'Put the span you selected on the clipboard, to drop onto a tape' },
  { control: '● Rec (tape)', ids: ['tape-rec'], tip: 'Records from the source it names (chosen under Record from). Stopped: arm the selected track, then ▶ counts in a bar. Playing: record from the next bar. Tap again to keep it. Key: R' },
  { control: 'RECORDING', ids: ['rec-sign'], tip: 'Lit while a punch is recording onto the tape' },
  { control: '♩ Click', ids: ['tape-click'], tip: 'A click on every beat, on bus A. On by itself only while the tape is empty. Key: K' },
  { control: 'Tap (empty tape)', ids: ['tape-tap'], tip: 'Tap where the loop starts, then where it comes round: each tap snaps to the strongest attack near it' },
  { control: 'Tempo (tape)', ids: ['tape-tempo'], tip: 'Call the loop more bars or fewer: the same length, so nothing is stretched' },
  { control: '⟲ Loop (tape)', ids: ['tape-loop'], tip: 'Loop the bracket, or play on to the end of what’s recorded. Key: L' },
  { control: '1 bar, 2, 4', ids: ['catch-bars'], tip: 'Catch the last bars you played, ending on the last bar line, where they were played' },
  { control: 'Clip level', ids: ['clip-gain'], tip: 'This clip\'s level within its track' },
  { control: 'Nudge', ids: ['clip-nudge'], tip: 'Move the clip a few milliseconds, for a part a little early or late' },
  { control: 'Reverse (clip)', ids: ['clip-reverse'], tip: 'Play this clip backwards, or forwards again. Undo puts it back' },
  { control: 'Share as WAV (clip)', ids: ['clip-share'], tip: 'Send just this clip, at its level, to another app; a long one downloads' },
  { control: 'Remove (clip)', ids: ['clip-remove'], tip: 'Take this clip off the tape. Undo brings it back' },
  { control: 'Catch', ids: ['catch'], tip: 'Put what you just played onto the selected track: the last bars, or a pass' },
  { control: 'Passes', ids: ['passes'], tip: 'Every time round the loop, kept. Tap one to put it on the selected track' },
  { control: 'Track / All (edit)', ids: ['edit-scope'], tip: 'What Lift and Copy take: the loop’s bars on the selected track, or on all four, kept apart' },
  { control: 'Lift', ids: ['lift'], tip: 'Cut the loop’s bars into the clipboard, leaving silence' },
  { control: 'Copy', ids: ['copy'], tip: 'Put the selection on the clipboard, to drop onto a tape' },
  { control: 'Drop', ids: ['drop'], tip: 'The clipboard onto the selected track at the playhead, replacing what’s there. Drop again to lay another copy after it' },
  { control: 'Merge drop', ids: ['merge-drop'], tip: 'Drop every track on the clipboard onto the selected one, layered, each clip at its own level' },
  { control: 'Split', ids: ['split'], tip: 'Cut the clips on the selected track in two at the playhead' },
  { control: 'Join', ids: ['join'], tip: 'Join this clip and the half that was split from it back into one' },
  { control: 'Multiply', ids: ['multiply'], tip: "Double the loop, copying what's in it over what follows" },
  { control: 'Slide snaps to', ids: ['tape-snap'], tip: 'Where a clip you slide can land: on a bar, a beat, an eighth, or anywhere' },
  { control: 'Clone', ids: ['clone'], tip: 'Copy this whole tape. Costs no disk space' },
  { control: 'Mix down', ids: ['mixdown'], tip: 'Play the loop, or the whole tape, once and save what came out of the mixer as a take: FX and live playing included' },
  { control: 'Export stems', ids: ['export-stems'], tip: 'Download a zip with a WAV per track from bar 1, and a .mid with the tempo, for a DAW' },
  { control: 'Bus A / B', ids: ['bus'], tip: 'Which Sidekick channel this track plays through, for its EQ and FX' },
  { control: 'Source chip', ids: ['source-chip'], tip: 'Which input ● Rec and a catch take from; its meter shows what is coming in. ● clean: none of the tape is in it. ○ the tape is in it too' },
  { control: '🎧 Overdub on this device', ids: ['away'], tip: 'Play the tape here, not in the jam room, and record a part over it that goes onto the selected track where you played it' },
  { control: 'The loop / The whole tape (overdub)', ids: ['away-span'], tip: 'Play the loop round and round, or the whole tape once' },
  { control: '♩ Click (overdub)', ids: ['away-click'], tip: 'A click on every beat, in what plays here' },
  { control: 'Round trip (overdub)', ids: ['away-rt'], tip: 'How late what you play reaches the recording, from hearing the tape: a part lands that much earlier. −5 and +5 move it by hand, e.g. for Bluetooth headphones' },
  { control: 'Calibrate (overdub)', ids: ['away-cal'], tip: 'Measure the round trip: six clicks through the speaker, heard through the mic. Headphones off, somewhere quiet' },
  { control: '▶ Listen (overdub)', ids: ['away-play'], tip: 'Play it here, without recording' },
  { control: '● Record (overdub)', ids: ['away-rec'], tip: 'Record over it; Stop keeps the last full pass, as a punch does, and puts it on the track. The recording is saved as a take too' },
  { control: 'Clock → (tape)', ids: ['tape-clock'], tip: 'Who follows the tape\'s MIDI clock (TAPE_CLOCK=lead); ● while they\'re running' },
  { control: 'Lock dot', ids: ['lock-dot'], tip: 'How playback and recording line up. Green: to the sample. Amber: by the clocks, nudge if off. Red: not yet' },
];

const byId = new Map();
for (const t of TIPS) for (const id of t.ids) byId.set(id, t);

/** tipFor is the tip for a data-tip id, or '' when there is none. */
export function tipFor(id) {
  return byId.get(id)?.tip || '';
}

/** controlFor is how the guide names the control with this id. */
export function controlFor(id) {
  return byId.get(id)?.control || '';
}
