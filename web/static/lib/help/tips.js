// web/static/lib/help/tips.js
// Every control's tip, in one place. The same rows are the table in
// docs/guide.md §9 ("Tips in the app"), and help.test.js fails if the two
// disagree, or if a control in the HTML names a tip that isn't here.
//
// `control` is how the guide's table names the control; `ids` are the
// data-tip values that show this tip. Rows for the tape page are here too,
// ahead of it, so the guide's table and this file stay one list.

export const TIPS = [
  // The main page
  { control: 'Capture', ids: ['capture'], tip: 'Save the last 30 s, 2 m, 7 m or all of what you just played as a take' },
  { control: 'Flag now', ids: ['flag-now'], tip: 'Mark this moment. Any take that includes it gets a flag here' },
  { control: 'Ribbon', ids: ['ribbon'], tip: 'The last 15 minutes, recent end stretched. Hold and drag to select a span; tap a flag for its options' },
  { control: 'Save as take (ribbon)', ids: ['ribbon-save'], tip: 'Save exactly the span you selected on the ribbon as a take' },
  { control: '× (ribbon)', ids: ['ribbon-clear'], tip: 'Forget the span selected on the ribbon' },
  { control: 'Save from here to now', ids: ['flag-save-from'], tip: 'Save a take that starts at this flag and runs to now' },
  { control: 'Delete flag (ribbon)', ids: ['flag-remove'], tip: 'Remove this flag. Takes saved later won\'t carry it' },
  { control: 'Phone', ids: ['phone'], tip: "Record from this phone's mic or a plugged-in input, straight into Hindsight" },
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
  { control: '★', ids: ['star'], tip: 'Starred takes stay at the top and are pruned last' },
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
  { control: 'Send to tape', ids: ['send-to-tape'], tip: 'Put the selection on the loaded tape, at its playhead' },
  // The tape page
  { control: 'Rec', ids: ['rec'], tip: 'Record the next time round the loop. Stopped: arm, then ▶ counts you in' },
  { control: 'Catch', ids: ['catch'], tip: 'Put what you just played onto the selected track: the last bars, or a pass' },
  { control: 'Passes', ids: ['passes'], tip: 'Every time round the loop, kept. Tap one to put it on the selected track' },
  { control: 'Lift', ids: ['lift'], tip: 'Cut the selection into the clipboard' },
  { control: 'Copy', ids: ['copy'], tip: 'Copy the selection into the clipboard' },
  { control: 'Drop', ids: ['drop'], tip: 'Paste the clipboard at the playhead; tap again to lay another copy after it' },
  { control: 'Merge drop', ids: ['merge-drop'], tip: 'Paste a four-track clipboard onto one track, mixed' },
  { control: 'Split', ids: ['split'], tip: 'Cut the clip in two at the playhead' },
  { control: 'Join', ids: ['join'], tip: 'Rejoin two neighbouring clips' },
  { control: 'Multiply', ids: ['multiply'], tip: "Double the loop, copying what's in it" },
  { control: 'Clone', ids: ['clone'], tip: 'Copy this whole tape. Costs no disk space' },
  { control: 'Mixdown', ids: ['mixdown'], tip: 'Play In to Out once and save what came out of the mixer as a take' },
  { control: 'Bus A / B', ids: ['bus'], tip: 'Which Sidekick channel this track plays through, for its EQ and FX' },
  { control: 'Source chip', ids: ['source-chip'], tip: "Which input you'd catch from. Filled = sounding; ring = clean of the tape" },
  { control: 'Lock dot', ids: ['lock-dot'], tip: 'Playback and recording are lined up to the sample' },
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
