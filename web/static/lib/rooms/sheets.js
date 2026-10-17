// web/static/lib/rooms/sheets.js
// Sheets that live in a <template> of shell.html are not in the document until
// a view puts them there, and getElementById cannot see inside a template.

/**
 * ensureSheets appends the template's top-level nodes to the body, skipping
 * any whose id is already there (another view may have put them). It returns
 * false when the page has no such template (the legacy pages carry their
 * sheets in the page itself).
 */
export function ensureSheets(doc, templateId) {
  const content = doc.getElementById(templateId)?.content;
  if (!content) return false;
  for (const node of [...content.cloneNode(true).children]) {
    if (!node.id || !doc.getElementById(node.id)) doc.body.append(node);
  }
  return true;
}

/** ensureStudioSheets: the phone sheet and the rest of the Studio's, for a view that is not the Studio (Capture). */
export const ensureStudioSheets = (doc) => ensureSheets(doc, 'studio-sheets-tpl');
