import { stripHtml } from '../attribution/assemble.js';
import { TABLE_CAPS, WARN } from './constants.js';

export type StructuredCell = { text: string; colspan: number; rowspan: number };
export type StructuredTable = {
  index: number;
  caption: string | null;
  classes: string[];
  headers: string[];
  rows: StructuredCell[][];
};
export type HtmlTable = { index: number; caption: string | null; html: string };

type RawTable = { openTag: string; inner: string; outer: string; nested: number };

export type ParseResult = {
  structured: StructuredTable[];
  html: HtmlTable[];
  /** Named cap warnings for the structured view, deduplicated, document order. */
  structuredWarnings: string[];
  /** Named cap warnings for the html view, deduplicated, document order. */
  htmlWarnings: string[];
  /** True when a structured cap clipped content. */
  structuredCapped: boolean;
  /** True when an html cap clipped content. */
  htmlCapped: boolean;
};

/**
 * Scan a Parsoid HTML document for top-level <table> elements in document
 * order, tracking depth so a <table> nested inside a <td> is not emitted
 * separately. Well-formed Parsoid output is assumed (report 13 §3.1).
 */
function findTopLevelTables(html: string): RawTable[] {
  const result: RawTable[] = [];
  const lower = html.toLowerCase();
  let cursor = 0;
  while (cursor < html.length) {
    const open = lower.indexOf('<table', cursor);
    if (open < 0) break;
    const tagEnd = html.indexOf('>', open);
    if (tagEnd < 0) break;
    const openTag = html.slice(open, tagEnd + 1);
    const closeTag = '</table';

    let depth = 1;
    let nested = 0;
    let scan = tagEnd + 1;
    let closeStart = -1;
    while (scan < html.length) {
      const nextOpen = lower.indexOf('<table', scan);
      const nextClose = lower.indexOf(closeTag, scan);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1;
        nested += 1;
        const nestedEnd = html.indexOf('>', nextOpen);
        scan = nestedEnd >= 0 ? nestedEnd + 1 : nextOpen + 6;
        continue;
      }
      depth -= 1;
      const closeEnd = html.indexOf('>', nextClose);
      if (depth === 0) {
        closeStart = nextClose;
        scan = closeEnd >= 0 ? closeEnd + 1 : nextClose + 7;
        break;
      }
      scan = closeEnd >= 0 ? closeEnd + 1 : nextClose + 7;
    }
    if (closeStart < 0) break; // malformed/unclosed table: stop cleanly
    const closeEnd = html.indexOf('>', closeStart);
    const end = closeEnd >= 0 ? closeEnd + 1 : html.length;
    result.push({
      openTag,
      inner: html.slice(tagEnd + 1, closeStart),
      outer: html.slice(open, end),
      nested,
    });
    cursor = end;
  }
  return result;
}

function classesOf(openTag: string): string[] {
  const double = /\bclass\s*=\s*"([^"]*)"/i.exec(openTag);
  const single = /\bclass\s*=\s*'([^']*)'/i.exec(openTag);
  const value = double?.[1] ?? single?.[1];
  return value === undefined ? [] : value.trim().split(/\s+/).filter((token) => token.length > 0);
}

/** Remove every nested <table> block (innermost first) from cell/caption text. */
function stripNestedTables(fragment: string): string {
  let out = fragment;
  let previous: string;
  do {
    previous = out;
    out = out.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, '');
  } while (out !== previous);
  return out;
}

function captionOf(inner: string): string | null {
  const match = /<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(inner);
  if (match === null) return null;
  return stripHtml(stripNestedTables(match[1] ?? ''));
}

function spanOf(attrs: string, name: 'colspan' | 'rowspan'): { value: number; clamped: boolean } {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+)["']?`, 'i').exec(attrs);
  if (match === null) return { value: 1, clamped: false };
  const parsed = Number.parseInt(match[1] ?? '1', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return { value: 1, clamped: false };
  if (parsed > TABLE_CAPS.span) return { value: TABLE_CAPS.span, clamped: true };
  return { value: parsed, clamped: false };
}

type CellMatch = { tag: string; attrs: string; content: string; header: boolean };
const CELL_RE = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

function cellsOf(rowInner: string): CellMatch[] {
  const cells: CellMatch[] = [];
  let match: RegExpExecArray | null;
  CELL_RE.lastIndex = 0;
  while ((match = CELL_RE.exec(rowInner)) !== null) {
    cells.push({
      tag: match[1] ?? 'td',
      attrs: match[2] ?? '',
      content: match[3] ?? '',
      header: (match[1] ?? '').toLowerCase() === 'th',
    });
  }
  return cells;
}

function toCell(cell: CellMatch): { cell: StructuredCell; clamped: boolean; tooLong: boolean } {
  const colspan = spanOf(cell.attrs, 'colspan');
  const rowspan = spanOf(cell.attrs, 'rowspan');
  const text = stripHtml(stripNestedTables(cell.content));
  const tooLong = text.length > TABLE_CAPS.cellChars;
  return {
    cell: {
      text: tooLong ? text.slice(0, TABLE_CAPS.cellChars) : text,
      colspan: colspan.value,
      rowspan: rowspan.value,
    },
    clamped: colspan.clamped || rowspan.clamped,
    tooLong,
  };
}

/**
 * Extract both representations from the fetched HTML. Caps are applied in
 * document order; the first N survive, `capped` and named warnings record each
 * breach. Provenance is built by the caller and never truncated here.
 */
export function parseTables(html: string): ParseResult {
  const raw = findTopLevelTables(html);
  const structuredWarnings: string[] = [];
  const htmlWarnings: string[] = [];
  let structuredCapped = false;
  let htmlCapped = false;
  const note = (token: string, view: 'structured' | 'html') => {
    const list = view === 'structured' ? structuredWarnings : htmlWarnings;
    if (!list.includes(token)) list.push(token);
    if (view === 'structured') structuredCapped = true;
    else htmlCapped = true;
  };

  const structured: StructuredTable[] = [];
  const htmlTables: HtmlTable[] = [];
  let anyNested = false;
  let anySpanClamp = false;

  for (const table of raw) {
    if (table.nested > 0) anyNested = true;
    const caption = captionOf(table.inner);
    const classes = classesOf(table.openTag);

    // Structured view: operate on a copy with nested tables removed so their
    // internal <tr>/<td> rows are never mistaken for rows of the parent.
    const cleanInner = stripNestedTables(table.inner);
    const rowMatches = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    const rowInners: string[] = [];
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowMatches.exec(cleanInner)) !== null) rowInners.push(rowMatch[1] ?? '');

    let headers: string[] = [];
    const bodyInners: string[] = [];
    let headerFound = false;
    for (const rowInner of rowInners) {
      const cells = cellsOf(rowInner);
      if (!headerFound && cells.some((cell) => cell.header)) {
        headers = cells.filter((cell) => cell.header)
          .map((cell) => toCell(cell))
          .map((converted) => {
            if (converted.clamped) anySpanClamp = true;
            if (converted.tooLong) note(WARN.cellChars, 'structured');
            return converted.cell.text;
          });
        headerFound = true;
        continue;
      }
      bodyInners.push(rowInner);
    }

    const rows: StructuredCell[][] = [];
    for (const rowInner of bodyInners) {
      const converted = cellsOf(rowInner).map(toCell);
      if (converted.some((item) => item.clamped)) anySpanClamp = true;
      let cells = converted.map((item) => item.cell);
      if (cells.length > TABLE_CAPS.cells) {
        cells = cells.slice(0, TABLE_CAPS.cells);
        note(WARN.cellCap, 'structured');
      }
      if (converted.some((item) => item.tooLong)) note(WARN.cellChars, 'structured');
      rows.push(cells);
    }
    const boundedRows = rows.length > TABLE_CAPS.rows ? rows.slice(0, TABLE_CAPS.rows) : rows;
    if (rows.length > TABLE_CAPS.rows) note(WARN.rowCap, 'structured');
    structured.push({ index: 0, caption, classes, headers, rows: boundedRows });

    // Raw HTML view: keep the outerHTML verbatim, apply only the char cap.
    let outer = table.outer;
    if (outer.length > TABLE_CAPS.htmlChars) {
      outer = outer.slice(0, TABLE_CAPS.htmlChars);
      note(WARN.htmlChars, 'html');
    }
    htmlTables.push({ index: 0, caption, html: outer });
  }

  if (raw.length > TABLE_CAPS.tables) {
    note(WARN.tableCap, 'structured');
    note(WARN.tableCap, 'html');
  }
  if (anyNested) {
    if (!structuredWarnings.includes(WARN.nested)) structuredWarnings.push(WARN.nested);
    if (!htmlWarnings.includes(WARN.nested)) htmlWarnings.push(WARN.nested);
  }
  if (anySpanClamp) note(WARN.spanClamp, 'structured');

  const emittedStructured = structured.slice(0, TABLE_CAPS.tables).map((table, index) => ({ ...table, index }));
  const emittedHtml = htmlTables.slice(0, TABLE_CAPS.tables).map((table, index) => ({ ...table, index }));

  return {
    structured: emittedStructured,
    html: emittedHtml,
    structuredWarnings,
    htmlWarnings,
    structuredCapped,
    htmlCapped,
  };
}
