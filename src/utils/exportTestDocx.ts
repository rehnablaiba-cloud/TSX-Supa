// src/utils/exportTestDocx.ts
// Generates a DOCX test-execution sheet for a single test.
// Layout: S.N. | Action [images] | Expected Result [images] | Result (OK ☐ / KO ☐) | Remarks

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  WidthType,
  BorderStyle,
  VerticalAlign,
  CheckBox,
  ImageRun,
} from "docx";

// ── Types ──────────────────────────────────────────────────────────────────
export interface StepRow {
  action:               string;
  expected_result:      string;
  serial_no?:           number | null;
  /** 0 / null = normal row; 1 = first-level divider; 2 = second-level; … */
  is_divider?:          number | null;
  /** step_status enum from step_results: "pass" | "fail" | "pending" | null */
  status?:              string | null;
  /** R2 presigned URLs for action-column images */
  action_image_urls?:   string[];
  /** R2 presigned URLs for expected-result-column images */
  expected_image_urls?: string[];
}

export interface ExportTestDocxOptions {
  moduleName: string;
  testName:   string;
  steps:      StepRow[];
}

// ── Serial numbers (skip divider rows) ────────────────────────────────────
function computeSerialNumbers(steps: StepRow[]): (number | null)[] {
  let counter = 0;
  return steps.map((s) => (s.is_divider ? null : ++counter));
}

// ── Image fetching ─────────────────────────────────────────────────────────

interface FetchedImage {
  data:   ArrayBuffer;
  width:  number;
  height: number;
}

/**
 * Fetch a single image URL → ArrayBuffer + natural dimensions.
 * Returns null on any failure so one bad image never blocks the export.
 */
async function fetchImage(url: string): Promise<FetchedImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.arrayBuffer();

    // Decode dimensions via ImageBitmap (no canvas needed)
    const blob   = new Blob([data]);
    const bitmap = await createImageBitmap(blob);
    const width  = bitmap.width;
    const height = bitmap.height;
    bitmap.close();

    return { data, width, height };
  } catch {
    return null;
  }
}

/**
 * Fetch all images for a URL list in parallel.
 * Skips nulls silently — bad URLs just produce no image in the DOCX.
 */
async function fetchImages(urls: string[]): Promise<FetchedImage[]> {
  if (!urls?.length) return [];
  const results = await Promise.all(urls.map(fetchImage));
  return results.filter((r): r is FetchedImage => r !== null);
}

/**
 * Scale image to fit within maxWidth × maxHeight while preserving aspect ratio.
 * All values in EMU (English Metric Units; 1 px ≈ 9144 EMU at 96 dpi).
 */
function scaleImage(
  naturalW: number,
  naturalH: number,
  maxW:     number,
  maxH:     number
): { width: number; height: number } {
  const ratio  = Math.min(maxW / naturalW, maxH / naturalH, 1);
  return {
    width:  Math.round(naturalW * ratio),
    height: Math.round(naturalH * ratio),
  };
}

// ── Dimensions ────────────────────────────────────────────────────────────
const TEXT_BLACK = "000000";
const BORDER_CLR = "000000";

const PAGE_W = 11906, PAGE_H = 16838;
const MAR_L  = 426,   MAR_R  = 567, MAR_T = 1418, MAR_B = 426;

const colWidths = [500, 3897, 2873, 1690, 900] as const;
const tableWidth = colWidths.reduce((a, b) => a + b, 0);

const TABLE_INDENT        = 709;   // 1.25 cm in DXA
const DIV_INDENT_PER_LEVEL = 283;  // 0.5 cm per level in DXA

const cellMar = { top: 80, bottom: 80, left: 115, right: 115 };
const border  = { style: BorderStyle.SINGLE, size: 4, color: BORDER_CLR };
const borders = { top: border, bottom: border, left: border, right: border };

// Max image dimensions inside a cell (pixels — docx ImageRun uses px)
// Action col (3897 DXA) and Expected col (2873 DXA) — keep images comfortably inside
const IMG_MAX_W_ACTION   = 180; // px
const IMG_MAX_W_EXPECTED = 130; // px
const IMG_MAX_H          = 120; // px

// ── Cell builders ──────────────────────────────────────────────────────────
function mkHeaderCell(lines: string[], width: number): TableCell {
  return new TableCell({
    width:         { size: width, type: WidthType.DXA },
    borders,
    margins:       cellMar,
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing:   { line: 276, lineRule: "auto" },
        children: lines.map(
          (txt, i) =>
            new TextRun({
              text:  txt,
              bold:  true,
              size:  24,
              color: TEXT_BLACK,
              font:  { name: "Helvetica" },
              ...(i > 0 ? { break: 1 } : {}),
            })
        ),
      }),
    ],
  });
}

function mkSnCell(text: string, width: number): TableCell {
  return new TableCell({
    width:         { size: width, type: WidthType.DXA },
    borders,
    margins:       cellMar,
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing:   { line: 276, lineRule: "auto" },
        children: [
          new TextRun({
            text,
            size:  20,
            color: TEXT_BLACK,
            font:  { name: "Helvetica" },
          }),
        ],
      }),
    ],
  });
}

/**
 * Text cell with optional inline images appended below the text.
 * Each image sits in its own Paragraph so layout stays clean.
 */
function mkTextCell(
  text:    string,
  width:   number,
  images?: FetchedImage[],
  maxImgW = IMG_MAX_W_ACTION
): TableCell {
  const lines = (text || "").split("\n");
  const runs:  TextRun[] = [];
  lines.forEach((line, i) => {
    if (i > 0) runs.push(new TextRun({ break: 1 }));
    runs.push(
      new TextRun({
        text:  line,
        size:  20,
        color: TEXT_BLACK,
        font:  { name: "Helvetica" },
      })
    );
  });

  const paragraphs: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing:   { before: 0, after: 0 },
      children:  runs,
    }),
  ];

  if (images?.length) {
    for (const img of images) {
      const { width: w, height: h } = scaleImage(
        img.width, img.height, maxImgW, IMG_MAX_H
      );
      paragraphs.push(
        new Paragraph({
          spacing: { before: 60, after: 0 },
          children: [
            new ImageRun({
              data:          img.data,
              transformation: { width: w, height: h },
              type: "png",
            }),
          ],
        })
      );
    }
  }

  return new TableCell({
    width:         { size: width, type: WidthType.DXA },
    borders,
    margins:       cellMar,
    verticalAlign: VerticalAlign.CENTER,
    children:      paragraphs,
  });
}

/**
 * Result cell.
 * status === "pass"  → OK ☑  KO ☐
 * status === "fail"  → OK ☐  KO ☑
 * anything else      → OK ☐  KO ☐
 */
function mkResultCell(width: number, status?: string | null): TableCell {
  const okChecked = status === "pass";
  const koChecked = status === "fail";

  return new TableCell({
    width:         { size: width, type: WidthType.DXA },
    borders,
    margins:       cellMar,
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing:   { before: 0, after: 0 },
        children: [
          new TextRun({
            text:  "OK ",
            size:  20,
            bold:  true,
            color: TEXT_BLACK,
            font:  { name: "Helvetica" },
          }),
          new CheckBox({
            checked:        okChecked,
            checkedState:   { value: "2612", font: "MS Gothic" },
            uncheckedState: { value: "2610", font: "MS Gothic" },
          }),
          new TextRun({
            text:  "   KO ",
            size:  20,
            bold:  true,
            color: TEXT_BLACK,
            font:  { name: "Helvetica" },
          }),
          new CheckBox({
            checked:        koChecked,
            checkedState:   { value: "2612", font: "MS Gothic" },
            uncheckedState: { value: "2610", font: "MS Gothic" },
          }),
        ],
      }),
    ],
  });
}

function mkEmptyCell(width: number): TableCell {
  return new TableCell({
    width:         { size: width, type: WidthType.DXA },
    borders,
    margins:       cellMar,
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        children: [new TextRun({ text: "", size: 20, font: { name: "Helvetica" } })],
      }),
    ],
  });
}

/**
 * Divider row — spans all 5 columns.
 * level 1 → left indent 0.5 cm  (283 DXA)
 * level 2 → left indent 1.0 cm  (566 DXA)
 */
function mkDividerRow(text: string, level: number): TableRow {
  const indentDxa = Math.max(1, level) * DIV_INDENT_PER_LEVEL;

  return new TableRow({
    children: [
      new TableCell({
        columnSpan:    5,
        width:         { size: tableWidth, type: WidthType.DXA },
        borders,
        margins:       { ...cellMar, left: cellMar.left + indentDxa },
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing:   { line: 276, lineRule: "auto" },
            children: (() => {
              const dlines = (text || "").split("\n");
              const druns: TextRun[] = [];
              dlines.forEach((dl, i) => {
                if (i > 0) druns.push(new TextRun({ break: 1 }));
                druns.push(
                  new TextRun({
                    text:  dl,
                    bold:  true,
                    size:  20,
                    color: TEXT_BLACK,
                    font:  { name: "Helvetica" },
                  })
                );
              });
              return druns;
            })(),
          }),
        ],
      }),
    ],
  });
}

// ── Main export function ───────────────────────────────────────────────────
export async function exportTestDocx({
  moduleName,
  testName,
  steps,
}: ExportTestDocxOptions): Promise<void> {
  if (!steps.length) throw new Error("No steps to export.");

  const sns = computeSerialNumbers(steps);

  // Pre-fetch all images in parallel before building the document.
  // Divider rows have no images, so we fetch only for normal rows.
  const allActionUrls:   string[] = steps.flatMap((s) => s.action_image_urls   ?? []);
  const allExpectedUrls: string[] = steps.flatMap((s) => s.expected_image_urls ?? []);
  const hasImages = allActionUrls.length > 0 || allExpectedUrls.length > 0;

  // Build a URL → FetchedImage map for O(1) lookup during row building
  const imageCache = new Map<string, FetchedImage>();
  if (hasImages) {
    const uniqueUrls = Array.from(new Set([...allActionUrls, ...allExpectedUrls]));
    const fetched    = await Promise.all(uniqueUrls.map(async (url) => {
      const img = await fetchImage(url);
      return [url, img] as const;
    }));
    for (const [url, img] of fetched) {
      if (img) imageCache.set(url, img);
    }
  }

  const tableRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        mkHeaderCell(["S.N."],            colWidths[0]),
        mkHeaderCell(["Action"],          colWidths[1]),
        mkHeaderCell(["Expected Result"], colWidths[2]),
        mkHeaderCell(["Result", "(OK/KO)"], colWidths[3]),
        mkHeaderCell(["Remarks"],         colWidths[4]),
      ],
    }),
  ];

  steps.forEach((row, idx) => {
    if (row.is_divider) {
      const level = typeof row.is_divider === "number" ? row.is_divider : 1;
      tableRows.push(mkDividerRow(row.action || "", level));
    } else {
      const sn = sns[idx];

      // Resolve pre-fetched images for this step
      const actionImgs: FetchedImage[] = (row.action_image_urls ?? [])
        .map((u) => imageCache.get(u))
        .filter((img): img is FetchedImage => img !== undefined);

      const expectedImgs: FetchedImage[] = (row.expected_image_urls ?? [])
        .map((u) => imageCache.get(u))
        .filter((img): img is FetchedImage => img !== undefined);

      tableRows.push(
        new TableRow({
          children: [
            mkSnCell(sn !== null ? String(sn) : "", colWidths[0]),
            mkTextCell(row.action || "",          colWidths[1], actionImgs,   IMG_MAX_W_ACTION),
            mkTextCell(row.expected_result || "", colWidths[2], expectedImgs, IMG_MAX_W_EXPECTED),
            mkResultCell(colWidths[3], row.status),
            mkEmptyCell(colWidths[4]),
          ],
        })
      );
    }
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size:   { width: PAGE_W, height: PAGE_H },
            margin: { top: MAR_T, bottom: MAR_B, left: MAR_L, right: MAR_R },
          },
        },
        children: [
          new Paragraph({
            spacing: { before: 0, after: 200 },
            children: [
              new TextRun({
                text:  `${moduleName} — ${testName}`,
                bold:  true,
                size:  26,
                color: TEXT_BLACK,
                font:  { name: "Helvetica" },
              }),
            ],
          }),
          new Table({
            width:        { size: tableWidth, type: WidthType.DXA },
            columnWidths: [...colWidths],
            indent:       { size: TABLE_INDENT, type: WidthType.DXA },
            rows:         tableRows,
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  const safe = (s: string) => s.replace(/[^a-z0-9_\-]/gi, "_");
  a.href     = url;
  a.download = `${safe(moduleName)}_${safe(testName)}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}