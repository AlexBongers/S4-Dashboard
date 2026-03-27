'use strict';

const mammoth = require('mammoth');

// Pre-compiled patterns for metadata table detection.
// These are labels commonly found in document info/property tables
// (key-value tables like "Auteur: Jan", "Datum: 01-01") that should NOT
// be mistaken for version history data rows.
const METADATA_LABELS_RE = /^(titel|document(naam)?|versie|version|datum|date|auteur|author|opdrachtgever|klant|client|project(naam)?|status|opleiding|cursus|vak|module|klas|groep|team|coach|docent|begeleider|bedrijf|organisatie|locatie|afdeling|referentie|kenmerk|bestandsnaam|classificatie)\b/i;

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
 * Convert a DOCX buffer to plain text using mammoth.
 * Returns the text string or null on failure.
 */
async function docxToText(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || null;
  } catch {
    return null;
  }
}

/**
 * Strip HTML tags and decode common entities to plain text.
 */
function htmlToPlainText(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
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
        cells.push(htmlToPlainText(cm[1]));
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
    /gemaakt\s+door/i,      // Dutch: made by (common in student/corporate templates)
    /opgesteld\s+door/i,    // Dutch: compiled by
    /^gemaakt$/i,           // standalone "gemaakt" header cell (exact match to avoid false positives)
    /opsteller/i,           // Dutch: originator / author (common in corporate templates)
    /^naam$/i,              // standalone "naam" header (exact match to avoid matching "naam" in data cells)
    /student/i,
    /bijdrager/i,           // contributor
    /persoon/i,             // person
    /medewerker/i,          // Dutch: colleague / employee (common in company templates)
    /initialen/i,           // Dutch: initials (used when only initials are recorded)
    /verantwoordelijke/i,   // Dutch: responsible person
    /bewerkt\s+door/i,      // Dutch: edited by
    /aangepast\s+door/i,    // Dutch: adjusted by
    /bijgedragen\s+door/i,  // Dutch: contributed by
    /^door$/i,              // standalone "door" (by)
    /^by$/i,                // English: by
    /eigenaar/i,            // Dutch: owner
    /schrijver/i,           // Dutch: writer
    /redacteur/i,           // Dutch: editor
    /toegewezen(\s+aan)?/i, // Dutch: assigned (to) — common in sprint planning docs
    /teamlid/i,             // Dutch: team member
    /groepslid/i,           // Dutch: group member
    /uitvoerder/i,          // Dutch: executor
    /uitgevoerd\s+door/i,   // Dutch: performed by
    /assigned\s+to/i,       // English: assigned to
    /^owner$/i,             // English: owner (exact match)
    /^lid$/i,               // Dutch: member (exact match to avoid false positives)
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
    /^taak$/i,              // Dutch: task — used in "Versie | Taak | Gemaakt door" layout
    /user\s*stor(y|ies)/i,  // English: user story — common in sprint planning docs
    /activiteit/i,          // Dutch: activity (variant of taak)
    /sectie/i,              // Dutch: section (sometimes used instead of taak)
    /onderdeel/i,           // Dutch: part / component
    /toelichting/i,         // Dutch: explanation / clarification
    /notitie/i,             // Dutch: note
    /reden/i,               // Dutch: reason
    /comment/i,             // English: comment
    /details/i,             // English/Dutch: details
    /samenvatting/i,        // Dutch: summary
    /werkzaamheden/i,       // Dutch: activities / work performed
    /uitgevoerd/i,          // Dutch: performed
    /bijdrage/i,            // Dutch: contribution
    /^taken$/i,             // Dutch: tasks (plural)
    /resultaat/i,           // Dutch: result
    /^item$/i,              // Generic: item
  ];
  for (let i = 0; i < headerRow.length; i++) {
    if (candidates.some((re) => re.test(headerRow[i]))) return i;
  }
  // Fallback: last column if there are ≥3 columns (not ≥2, to avoid overlap
  // with the author column when both author and description share a 2-col table)
  return headerRow.length >= 3 ? headerRow.length - 1 : -1;
}

/**
 * Determine whether a table looks like a versiegeschiednis (version history)
 * table by scanning the first few rows. Many Dutch student documents start
 * the table with a spanning title row ("Versiegeschiednis") before the actual
 * column headers, so we probe up to the first 10 rows instead of only row 0.
 * Corporate/company templates (e.g. Axians) sometimes add additional info rows
 * before the actual header, which is why we scan more rows.
 *
 * Returns the index of the header row (0-based), or -1 if not found.
 */
function findVersionTableHeader(rows) {
  if (rows.length < 2) return -1;

  // First pass: strict match — require author AND (version OR date OR sprint/taak) column
  for (let rowIndex = 0; rowIndex < Math.min(10, rows.length - 1); rowIndex++) {
    const row = rows[rowIndex];
    const hasAuthorCol = findAuthorColumn(row) !== -1;
    const hasVersionCol = row.some((c) => /versie|version|v\.\s*\d|^v$/i.test(c));
    const hasDatumCol = row.some((c) => /datum|date|deadline/i.test(c));
    const hasSprintCol = row.some((c) => /^sprint$/i.test(c));
    const hasTaskCol = row.some((c) => /^taak$|^task$|^user\s*stor(y|ies)$/i.test(c));
    if (hasAuthorCol && (hasVersionCol || hasDatumCol || hasSprintCol || hasTaskCol)) return rowIndex;
  }

  // Second pass: lenient match — require only author column, but the table
  // must appear near a "versiegeschiednis" / "version history" title row or
  // the table itself must have a version-related title in a spanning row.
  for (let rowIndex = 0; rowIndex < Math.min(10, rows.length - 1); rowIndex++) {
    const row = rows[rowIndex];
    // Check if this row is a title row mentioning version history
    const isTitleRow = row.length <= 2 && row.some((c) =>
      /versie\s*geschied|version\s*hist|wijzigings?\s*(log|geschied|overzicht)/i.test(c)
    );
    if (isTitleRow) {
      // The next row with an author column is the header
      for (let j = rowIndex + 1; j < Math.min(rowIndex + 3, rows.length - 1); j++) {
        if (findAuthorColumn(rows[j]) !== -1) return j;
      }
    }
  }

  // Third pass: only require author column (no version/date needed)
  // Useful for minimal tables with just author + description columns
  for (let rowIndex = 0; rowIndex < Math.min(10, rows.length - 1); rowIndex++) {
    const row = rows[rowIndex];
    if (row.length >= 2 && findAuthorColumn(row) !== -1) {
      // Verify there are at least 2 data rows below to avoid false positives
      if (rows.length - rowIndex > 2) return rowIndex;
    }
  }

  return -1;
}

/**
 * Check whether a table might be a version history or contribution table by
 * scanning the full text content of the table for relevant keywords.
 * Returns true if the table likely contains version history or task/contribution data.
 */
function tableContainsVersionKeywords(rows) {
  const text = rows.map((r) => r.join(' ')).join(' ');
  const patterns = [
    /versie\s*geschied/i,
    /version\s*hist/i,
    /wijzigings?\s*(log|geschied|overzicht)/i,
    /sprint\s*planning/i,
    /sprint\s*backlog/i,
    /taken\s*verdel/i,
    /bijdrage/i,
    /contributie/i,
    /taakverdelingen/i,
  ];
  return patterns.some((p) => p.test(text));
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
 * Tries exact match, last-name match, first-name match, substring,
 * prefix, and initials matching (e.g. "JJ" → "Jan Jansen").
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

  // 4. Prefix match (abbreviated first names, e.g. "Tao" → "Taoufik")
  if (f.length >= 3) {
    for (const name of studentNames) {
      const parts = name.toLowerCase().split(/\s+/);
      if (parts.some((p) => p.startsWith(f))) return name;
    }
  }

  // 5. Initials match (e.g. "JJ" → "Jan Jansen", "PP" → "Piet Pietersen")
  // Only attempt for short uppercase-only fragments (2-5 chars)
  if (/^[A-Z]{2,5}$/i.test(fragment.trim())) {
    const initials = f;
    // Dutch name particles to skip when computing initials
    const particles = new Set(['de', 'van', 'den', 'het', 'der', 'ten', 'ter']);
    for (const name of studentNames) {
      const allParts = name.split(/\s+/);
      // Try both: with particles filtered out, and with all parts included
      const filteredParts = allParts.filter((p) => !particles.has(p.toLowerCase()));
      const filteredInitials = filteredParts.map((p) => p[0]).join('').toLowerCase();
      const allInitials = allParts.map((p) => p[0]).join('').toLowerCase();
      if (filteredInitials === initials || allInitials === initials) return name;
    }
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

  // Fairness score: how evenly are contributions distributed? (0–100)
  // 100 = perfectly equal, lower = more skewed. Uses normalized entropy.
  let fairnessScore = null;
  if (items.length >= 2) {
    const entryCounts = items.map((it) => it.entries);
    const total = entryCounts.reduce((s, c) => s + c, 0);
    if (total > 0) {
      const n = entryCounts.length;
      // Shannon entropy
      let entropy = 0;
      for (const c of entryCounts) {
        if (c > 0) {
          const p = c / total;
          entropy -= p * Math.log2(p);
        }
      }
      // Normalise by max entropy (uniform distribution)
      const maxEntropy = Math.log2(n);
      fairnessScore = maxEntropy > 0 ? Math.round((entropy / maxEntropy) * 100) : 100;
    }
  }

  return { items, totalEntries, unmatched, fairnessScore };
}

/**
 * Try to extract version-history entries from tables in mammoth-produced HTML.
 * Returns an array of { authors, description } entries, or null if no
 * recognisable version history table was found.
 */
function parseTablesFromHtml(html) {
  const tables = extractTables(html);
  if (tables.length === 0) return null;

  // Try every table — version history is not always the first table in the document.
  for (const table of tables) {
    const entries = tryParseVersionTable(table);
    if (entries && entries.length > 0) return entries;
  }

  // Fallback 1: if any table contains version/planning keywords, try harder
  for (const table of tables) {
    if (!tableContainsVersionKeywords(table)) continue;
    if (isMetadataTable(table, 0)) continue;
    const entries = tryParseVersionTableLenient(table);
    if (entries && entries.length > 0) return entries;
  }

  // Fallback 2: try lenient parsing on ALL tables with at least 3 rows.
  // This catches contribution/task tables that don't contain version keywords
  // but still have recognisable name-like columns (e.g. sprint planning docs).
  for (const table of tables) {
    if (table.length < 3) continue;
    if (isMetadataTable(table, 0)) continue;
    const entries = tryParseVersionTableLenient(table);
    if (entries && entries.length > 0) return entries;
  }

  return null;
}

/**
 * Check whether a table looks like a document metadata / property table
 * rather than a version history table. Metadata tables are 2-column
 * key-value tables (e.g. "Auteur | Jan Jansen", "Datum | 01-01-2024")
 * that should not be mistaken for version history.
 *
 * Returns true if the table is likely a metadata table.
 */
function isMetadataTable(table, headerIdx) {
  // Only suspect 2-column tables (key-value layout)
  const maxCols = Math.max(...table.map((r) => r.length));
  if (maxCols > 2) return false;

  // Check the data rows below the header: if most first-column cells are
  // known metadata labels, this is a metadata/property table.
  let labelCount = 0;
  let dataRows = 0;
  for (let i = headerIdx + 1; i < table.length; i++) {
    const cell = (table[i][0] || '').trim();
    if (!cell) continue;
    dataRows++;
    if (METADATA_LABELS_RE.test(cell)) labelCount++;
  }
  // If ≥ 50% of data rows have metadata labels in column 0, it's metadata
  return dataRows > 0 && labelCount / dataRows >= 0.5;
}

/**
 * Attempt to extract version entries from a single table using recognized
 * header detection.
 */
function tryParseVersionTable(table) {
  const headerIdx = findVersionTableHeader(table);
  if (headerIdx === -1) return null;

  const header = table[headerIdx];
  const authorCol = findAuthorColumn(header);
  const descCol = findDescriptionColumn(header);

  if (authorCol === -1) return null;

  // Reject document metadata tables (2-col key-value tables)
  if (isMetadataTable(table, headerIdx)) return null;

  const entries = [];
  for (let i = headerIdx + 1; i < table.length; i++) {
    const row = table[i];
    const authors = row[authorCol] || '';
    const description = descCol !== -1 ? (row[descCol] || '') : '';

    // Skip entirely empty or separator rows
    if (!authors.trim()) continue;

    entries.push({ authors: authors.trim(), description: description.trim() });
  }

  return entries.length > 0 ? entries : null;
}

/**
 * Lenient version table parser: used when the table contains version keywords
 * but no recognized header was found. Tries to identify the author column by
 * checking which column has the most "name-like" cell values (capitalized
 * words, 1-4 words per cell, tolerating lowercase Dutch particles like
 * "de", "van", "den", "het").
 */
function tryParseVersionTableLenient(table) {
  if (table.length < 2) return null;

  // Score each column on how "name-like" its values are
  const numCols = Math.max(...table.map((r) => r.length));
  const colScores = new Array(numCols).fill(0);

  // Common Dutch name particles that are lowercase in multi-word names
  const particles = new Set(['de', 'van', 'den', 'het', 'der', 'ten', 'ter', 'op', 'in']);

  for (let col = 0; col < numCols; col++) {
    for (let row = 1; row < table.length; row++) {
      const cell = (table[row][col] || '').trim();
      if (!cell) continue;
      const words = cell.split(/\s+/);
      // Name-like: 1-4 words, each starting with uppercase (or is a lowercase
      // particle like "de", "van" common in Dutch surnames)
      if (words.length >= 1 && words.length <= 4) {
        // \u00C0-\u024F covers Latin Extended characters (accented letters
        // common in Dutch/French names: é, ë, ü, ö, etc.)
        const allNameLike = words.every(
          (w) => (/^[A-Z\u00C0-\u024F]/.test(w) && w.length >= 2) || particles.has(w.toLowerCase())
        );
        // At least one word must be capitalized (not all particles)
        const hasCapitalized = words.some((w) => /^[A-Z\u00C0-\u024F]/.test(w) && w.length >= 2);
        if (allNameLike && hasCapitalized) colScores[col]++;
      }
    }
  }

  // Pick the column with the highest name-like score (min 2 matches)
  let bestCol = -1;
  let bestScore = 1;
  for (let col = 0; col < numCols; col++) {
    if (colScores[col] > bestScore) {
      bestScore = colScores[col];
      bestCol = col;
    }
  }

  if (bestCol === -1) return null;

  // Use the last column (that isn't the author col) as description
  const descCol = numCols > 1
    ? (bestCol === numCols - 1 ? numCols - 2 : numCols - 1)
    : -1;

  // Skip the first row (likely a header or title)
  const entries = [];
  for (let i = 1; i < table.length; i++) {
    const row = table[i];
    const authors = (row[bestCol] || '').trim();
    const description = descCol !== -1 ? (row[descCol] || '').trim() : '';
    if (!authors) continue;
    entries.push({ authors, description });
  }

  return entries.length > 0 ? entries : null;
}

/**
 * Attempt to extract version-history entries from plain text (mammoth raw
 * text extraction). This is a fallback for documents where the version
 * history is not in a proper table, or when mammoth's HTML conversion loses
 * the table structure.
 *
 * Looks for common patterns:
 * - "Versie X.Y <tab/pipe> Date <tab/pipe> Author <tab/pipe> Description"
 * - "Versie 1.0 - Date - Author - Description" (handles dates containing dashes)
 * - Lines starting with "v1", "v2", etc.
 * - Sections under a "Versiegeschiednis" / "Wijzigingslog" heading
 *
 * Returns an array of { authors, description } entries, or null.
 */
function parseVersieFromRawText(text) {
  if (!text) return null;

  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);

  // Find the section that starts with a version history heading
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/versie\s*geschied|version\s*hist|wijzigings?\s*(log|geschied|overzicht)/i.test(lines[i])) {
      startIdx = i + 1;
      break;
    }
  }

  // If no explicit heading found, scan the entire document
  if (startIdx === -1) startIdx = 0;

  const entries = [];
  // Common date pattern (used to strip dates from author fields)
  const dateRe = /\d{1,4}[\-\/\.]\d{1,2}[\-\/\.]\d{1,4}/;

  // Pattern 1: Tab/pipe-delimited rows — "Versie\tDatum\tAuteur\tOmschrijving"
  // or "1.0 | 2024-01-15 | Jan Jansen | Initial version"
  const delimRe = /^(?:v?\.?\s*\d[\d.]*)\s*[\t|]\s*(\d{1,4}[\-\/\.]\d{1,2}[\-\/\.]\d{1,4})?\s*[\t|]\s*(.+?)(?:\s*[\t|]\s*(.+))?$/i;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(delimRe);
    if (m) {
      const authors = (m[2] || '').trim();
      const description = (m[3] || '').trim();
      if (authors) entries.push({ authors, description });
      continue;
    }

    // Pattern 2: "Versie 1.0 - Date - Author - Description"
    // Uses a smarter approach: first extract the version prefix, then split
    // the remainder on dash/en-dash/em-dash separators while preserving
    // dates that contain hyphens (dd-mm-yyyy).
    const versionPrefixRe = /^(?:versie|v)\s*\.?\s*\d[\d.]*\s*[-–—:]\s*/i;
    const prefixMatch = line.match(versionPrefixRe);
    if (prefixMatch) {
      const remainder = line.slice(prefixMatch[0].length);
      // Split on " - " / " – " / " — " (space-dash-space) to avoid splitting dates
      const parts = remainder.split(/\s+[-–—]\s+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 1) {
        // Find the first part that is NOT a date — that's the author
        let authorIdx = -1;
        for (let j = 0; j < parts.length; j++) {
          if (!dateRe.test(parts[j])) {
            authorIdx = j;
            break;
          }
        }
        if (authorIdx !== -1) {
          const authors = parts[authorIdx];
          const description = parts.slice(authorIdx + 1).join(' — ');
          entries.push({ authors, description });
        }
      }
    }
  }

  return entries.length > 0 ? entries : null;
}

/**
 * Parse a DOCX buffer and extract versiegeschiednis (version history) entries.
 *
 * Uses a multi-strategy approach:
 * 1. Convert to HTML with mammoth and parse tables (most reliable for well-structured docs)
 * 2. If no tables found, try heuristic/lenient table parsing
 * 3. Fall back to raw text extraction and pattern-based parsing
 *
 * Returns an array of { authors: string, description: string } objects,
 * or null if no version history could be extracted.
 */
async function parseVersiegeschiedenis(buffer) {
  // Strategy 1: HTML-based table extraction (handles most documents)
  const html = await docxToHtml(buffer);
  if (html) {
    const entries = parseTablesFromHtml(html);
    if (entries && entries.length > 0) return entries;
  }

  // Strategy 2: Raw text extraction fallback (handles non-table version histories
  // and documents where mammoth's HTML conversion loses table structure)
  const text = await docxToText(buffer);
  if (text) {
    const entries = parseVersieFromRawText(text);
    if (entries && entries.length > 0) return entries;
  }

  return null;
}

/**
 * Parse a DOCX buffer and return both the parsed entries AND diagnostic info
 * (e.g. how many tables were found, which strategy succeeded). Useful for
 * debugging when documents fail to parse.
 *
 * Returns { entries: array|null, diagnostics: { tablesFound, strategy, ... } }
 */
async function parseWithDiagnostics(buffer) {
  const diagnostics = { tablesFound: 0, strategy: null, htmlLength: 0, textLength: 0 };
  let entries = null;

  const html = await docxToHtml(buffer);
  if (html) {
    diagnostics.htmlLength = html.length;
    const tables = extractTables(html);
    diagnostics.tablesFound = tables.length;

    entries = parseTablesFromHtml(html);
    if (entries && entries.length > 0) {
      diagnostics.strategy = 'html_table';
      return { entries, diagnostics };
    }
  }

  const text = await docxToText(buffer);
  if (text) {
    diagnostics.textLength = text.length;
    entries = parseVersieFromRawText(text);
    if (entries && entries.length > 0) {
      diagnostics.strategy = 'raw_text';
      return { entries, diagnostics };
    }
  }

  diagnostics.strategy = 'none';
  return { entries: null, diagnostics };
}

module.exports = { parseVersiegeschiedenis, parseWithDiagnostics, computeContributions };
