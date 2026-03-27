'use strict';

const mammoth = require('mammoth');

/**
 * Convert a DOCX buffer to a plain HTML string using mammoth.
 * Returns the HTML string or null on failure.
 */
async function docxToHtml(buffer) {
  try {
    const result = await mammoth.convertToHtml({ buffer });
    return result.value || null;
  } catch {
    return null;
  }
}

/**
 * Extract all tables from mammoth-produced HTML.
 * Returns an array of tables, each table being an array of rows,
 * each row being an array of plain-text cell strings.
 */
function extractTables(html) {
  const tables = [];
  // Use [^>]* to tolerate any attributes mammoth may add to <table> tags
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tm;
  while ((tm = tableRe.exec(html)) !== null) {
    const tableHtml = tm[1];
    const rows = [];
    // Use [^>]* to tolerate any attributes on <tr> tags
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm;
    while ((rm = rowRe.exec(tableHtml)) !== null) {
      const rowHtml = rm[1];
      const cells = [];
      // Match both <td> and <th>, with any attributes
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cm;
      while ((cm = cellRe.exec(rowHtml)) !== null) {
        // Strip HTML tags, then decode entities. &amp; must be decoded last to
        // avoid double-decoding (e.g. &amp;lt; → &lt; → <).
        const text = cm[1]
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim();
        cells.push(text);
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length > 0) tables.push(rows);
  }
  return tables;
}

/**
 * Detect which column index is likely the "author" column.
 * Returns the column index or -1 if not found.
 */
function findAuthorColumn(headerRow) {
  const candidates = [
    /auteur/i,
    /author/i,
    /door\s*wie/i,
    /^wie$/i,               // very common Dutch shorthand for "wie heeft het gedaan"
    /geschreven\s+door/i,
    /opgesteld\s+door/i,    // Dutch: compiled by
    /opsteller/i,           // Dutch: originator / author (common in corporate templates)
    /naam/i,
    /student/i,
    /bijdrager/i,           // contributor
    /persoon/i,             // person
    /medewerker/i,          // Dutch: colleague / employee (common in company templates)
    /initialen/i,           // Dutch: initials (used when only initials are recorded)
  ];
  for (let i = 0; i < headerRow.length; i++) {
    if (candidates.some((re) => re.test(headerRow[i]))) return i;
  }
  return -1;
}

/**
 * Detect which column index is likely the "description/changes" column.
 * Returns the column index or -1 if not found.
 */
function findDescriptionColumn(headerRow) {
  const candidates = [
    /omschrijving/i,
    /beschrijving/i,
    /wijziging/i,
    /verandering/i,
    /aanpassing/i,
    /inhoud/i,
    /opmerking/i,
    /description/i,
    /change/i,
    /what/i,
  ];
  for (let i = 0; i < headerRow.length; i++) {
    if (candidates.some((re) => re.test(headerRow[i]))) return i;
  }
  // Fallback: last column if there are ≥3 columns
  return headerRow.length >= 3 ? headerRow.length - 1 : -1;
}

/**
 * Determine whether a table looks like a versiegeschiednis (version history)
 * table by scanning the first few rows. Many Dutch student documents start
 * the table with a spanning title row ("Versiegeschiednis") before the actual
 * column headers, so we probe up to the first 5 rows instead of only row 0.
 * Corporate/company templates (e.g. Axians) sometimes add additional info rows
 * before the actual header, which is why we scan up to 5 rows.
 *
 * Returns the index of the header row (0-based), or -1 if not found.
 */
function findVersionTableHeader(rows) {
  if (rows.length < 2) return -1;
  for (let rowIndex = 0; rowIndex < Math.min(5, rows.length - 1); rowIndex++) {
    const row = rows[rowIndex];
    const hasAuthorCol = findAuthorColumn(row) !== -1;
    const hasVersionCol = row.some((c) => /versie|version|v\./i.test(c));
    const hasDatumCol = row.some((c) => /datum|date/i.test(c));
    if (hasAuthorCol && (hasVersionCol || hasDatumCol)) return rowIndex;
  }
  return -1;
}

/**
 * Split an author cell value into individual author name fragments.
 * Handles "Jan & Lena", "Jan, Lena", "Jan en Lena", "Jan / Lena",
 * "Allen" (everyone), and similar patterns.
 */
function parseAuthors(authorCell) {
  if (!authorCell) return [];

  // Normalise "everyone" entries — treat as no-attribution (skip).
  // Only match explicit "whole group" phrases, not the standalone word 'groep'
  // which could appear as part of a legitimate team or project name.
  if (/\b(allen|everyone|iedereen|all|hele\s*groep|de\s*groep)\b/i.test(authorCell)) {
    return ['__all__'];
  }

  return authorCell
    .split(/\s*(?:[&,/]|\ben\b)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Find the Canvas student name that best matches a raw author fragment.
 * Tries exact match, last-name match, first-name match, then substring.
 * Returns the matched Canvas name string, or null if no match.
 */
function matchStudentName(fragment, studentNames) {
  if (!fragment || fragment === '__all__') return null;
  const f = fragment.toLowerCase().trim();
  if (f.length < 2) return null;

  // 1. Exact match
  for (const name of studentNames) {
    if (name.toLowerCase() === f) return name;
  }

  // 2. Full-name contains the fragment (e.g. "Taoufik" → "Taoufik Amghar")
  for (const name of studentNames) {
    const parts = name.toLowerCase().split(/\s+/);
    // First name match
    if (parts[0] === f) return name;
    // Last name match (last word)
    if (parts[parts.length - 1] === f) return name;
  }

  // 3. Substring match (fragment appears as a word boundary within the name)
  const wordRe = new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  for (const name of studentNames) {
    if (wordRe.test(name)) return name;
  }

  return null;
}

/**
 * Given parsed version-history entries and the full list of Canvas student
 * names, compute per-student contribution metrics.
 *
 * Returns:
 *   {
 *     items: [{ name, entries, words, sharePercent }],
 *     totalEntries: number,
 *     unmatched: number,   // entries where no student could be matched
 *   }
 */
function computeContributions(entries, studentNames) {
  const counts = {}; // name → { entries, words }
  let unmatched = 0;

  for (const entry of entries) {
    const authors = parseAuthors(entry.authors);

    // "__all__" entries count as contributing nothing individually
    const isAll = authors.includes('__all__');
    if (isAll) continue;

    const matched = [...new Set(
      authors.map((a) => matchStudentName(a, studentNames)).filter(Boolean)
    )];

    if (matched.length === 0) {
      unmatched++;
      continue;
    }

    const words = entry.description
      ? entry.description.split(/\s+/).filter(Boolean).length
      : 0;

    for (const name of matched) {
      if (!counts[name]) counts[name] = { entries: 0, words: 0 };
      counts[name].entries++;
      counts[name].words += words;
    }
  }

  const totalEntries = entries.length;
  const items = Object.entries(counts).map(([name, data]) => ({
    name,
    entries: data.entries,
    words: data.words,
    sharePercent:
      totalEntries > 0 ? Math.round((data.entries / totalEntries) * 1000) / 10 : 0,
  }));

  items.sort((a, b) => b.entries - a.entries || b.words - a.words);

  return { items, totalEntries, unmatched };
}

/**
 * Parse a DOCX buffer and extract versiegeschiednis (version history) entries.
 *
 * Returns an array of { authors: string, description: string } objects,
 * or null if no versiegeschiednis table could be found.
 */
async function parseVersiegeschiedenis(buffer) {
  const html = await docxToHtml(buffer);
  if (!html) return null;

  const tables = extractTables(html);
  if (tables.length === 0) return null;

  // Try every table — version history is not always the first table in the document.
  for (const table of tables) {
    const headerIdx = findVersionTableHeader(table);
    if (headerIdx === -1) continue;

    const header = table[headerIdx];
    const authorCol = findAuthorColumn(header);
    const descCol = findDescriptionColumn(header);

    if (authorCol === -1) continue;

    // Skip the header row (and any title rows above it); parse data rows
    const entries = [];
    for (let i = headerIdx + 1; i < table.length; i++) {
      const row = table[i];
      const authors = row[authorCol] || '';
      const description = descCol !== -1 ? (row[descCol] || '') : '';

      // Skip entirely empty or separator rows
      if (!authors.trim()) continue;

      entries.push({ authors: authors.trim(), description: description.trim() });
    }

    if (entries.length > 0) return entries;
  }

  return null;
}

module.exports = { parseVersiegeschiedenis, computeContributions };
