// Overlaps and sizes that are meant, so the layout checks (layout.mjs)
// don't fail a flow on them. Each entry names the rule, the control (el)
// and what's over it (by) as regexps against the finding's names, says
// why, and either lets it pass ("allowed") or keeps it as a warning on the
// storyboard ("warn"). Add one only for a design decision, never to quiet a
// finding nobody looked at.
export const ALLOW = [
  { rule: 'covered', by: /\btoast\b|toast-/, as: 'warn', why: 'a toast, gone in a few seconds' },
];
