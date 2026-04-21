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
  ShadingType,
  VerticalAlign,
  CheckBox,
} from "docx";

// ── Types ──────────────────────────────────────────────────────────────────
export interface StepRow {
  action: string;
  expected_result: string;
  /** Optional — set to null/undefined for divider rows */
  step_order?: number | null;
}

export interface ExportTestDocxOptions {
  moduleName: string;
  testName: string;
  steps: StepRow[];
}

// ── Helpers ────────────────────────────────────────────────────────────────
function isDivider(expected: string | null | undefined): boolean {
  if (!expected) return false;
  const t = expected.trim();
  return t === "1" || t === "2" || t === "3";
}

/** Build sequential S.N. values, skipping divider rows */
function computeSerialNumbers(steps: StepRow[]): (number | null)[] {
  let counter = 0;
  return steps.map((s) => {
    if (isDivider(s.expected_result)) return null;
    return ++counter;
  });
}

// ── Colours / dimensions (kept identical to the HTML reference) ────────────
const HEADER_BG = "F79646";
const HEADER_FG = "000000";
const DIV_H1_BG = "FEE9D6";
const DIV_H2_BG = "FEF2E9";
const DIV_H3_BG = "FEF8F3";
const TEXT_BLACK = "000000";
const BORDER_CLR = "000000";

// A4 Portrait, same margins as reference DOCX
const PAGE_W = 11906,
  PAGE_H = 16838;
const MAR_L = 426,
  MAR_R = 567,
  MAR_T = 1418,
  MAR_B = 426;

// Column widths (DXA) — sum = 9860
const colWidths = [500, 3897, 2873, 1690, 900] as const;
const tableWidth = colWidths.reduce((a, b) => a + b, 0);

const cellMar = { top: 80, bottom: 80, left: 115, right: 115 };
const border = { style: BorderStyle.SINGLE, size: 4, color: BORDER_CLR };
const borders = { top: border, bottom: border, left: border, right: border };

// ── Cell builders ──────────────────────────────────────────────────────────
function mkHeaderCell(lines: string[], width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    margins: cellMar,
    shading: { fill: HEADER_BG, type: ShadingType.CLEAR },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { line: 276, lineRule: "auto" },
        children: lines.map(
          (txt, i) =>
            new TextRun({
              text: txt,
              bold: true,
              size: 24,
              color: HEADER_FG,
              font: { name: "Helvetica" },
              ...(i > 0 ? { break: 1 } : {}),
            })
        ),
      }),
    ],
  });
}

function mkSnCell(text: string, width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    margins: cellMar,
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { line: 276, lineRule: "auto" },
        children: [
          new TextRun({
            text,
            size: 20,
            color: TEXT_BLACK,
            font: { name: "Helvetica" },
          }),
        ],
      }),
    ],
  });
}

function mkTextCell(text: string, width: number): TableCell {
  const lines = (text || "").split("\n");
  const runs: TextRun[] = [];
  lines.forEach((line, i) => {
    if (i > 0) runs.push(new TextRun({ break: 1 }));
    runs.push(
      new TextRun({
        text: line,
        size: 20,
        color: TEXT_BLACK,
        font: { name: "Helvetica" },
      })
    );
  });
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    margins: cellMar,
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 0, after: 0 },
        children: runs,
      }),
    ],
  });
}

function mkResultCell(width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    margins: cellMar,
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        children: [
          new TextRun({
            text: "OK ",
            size: 20,
            bold: true,
            color: TEXT_BLACK,
            font: { name: "Helvetica" },
          }),
          new CheckBox({
            checked: false,
            checkedState: { value: "2612", font: "MS Gothic" },
            uncheckedState: { value: "2610", font: "MS Gothic" },
          }),
          new TextRun({
            text: "   KO ",
            size: 20,
            bold: true,
            color: TEXT_BLACK,
            font: { name: "Helvetica" },
          }),
          new CheckBox({
            checked: false,
            checkedState: { value: "2612", font: "MS Gothic" },
            uncheckedState: { value: "2610", font: "MS Gothic" },
          }),
        ],
      }),
    ],
  });
}

function mkEmptyCell(width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    margins: cellMar,
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: "", size: 20, font: { name: "Helvetica" } }),
        ],
      }),
    ],
  });
}

function mkDividerRow(text: string, bg: string, indent: number): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: 5,
        width: { size: tableWidth, type: WidthType.DXA },
        borders,
        margins: cellMar,
        shading: { fill: bg, type: ShadingType.CLEAR },
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { line: 276, lineRule: "auto" },
            indent: { left: indent },
            children: (() => {
              const dlines = (text || "").split("\n");
              const druns: TextRun[] = [];
              dlines.forEach((dl, i) => {
                if (i > 0) druns.push(new TextRun({ break: 1 }));
                druns.push(
                  new TextRun({
                    text: dl,
                    bold: true,
                    size: 20,
                    color: TEXT_BLACK,
                    font: { name: "Helvetica" },
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

  const tableRows: TableRow[] = [];

  // Header row
  tableRows.push(
    new TableRow({
      tableHeader: true,
      children: [
        mkHeaderCell(["S.N."], colWidths[0]),
        mkHeaderCell(["Action"], colWidths[1]),
        mkHeaderCell(["Expected Result"], colWidths[2]),
        mkHeaderCell(["Result", "(OK/KO)"], colWidths[3]),
        mkHeaderCell(["Remarks"], colWidths[4]),
      ],
    })
  );

  // Data rows
  steps.forEach((row, idx) => {
    const sn = sns[idx];
    const divider = isDivider(row.expected_result);
    const divLv = divider ? parseInt(row.expected_result.trim(), 10) : 0;

    if (divider) {
      const bg = divLv === 1 ? DIV_H1_BG : divLv === 2 ? DIV_H2_BG : DIV_H3_BG;
      const indent = divLv === 1 ? 283 : divLv === 2 ? 567 : 850;
      tableRows.push(mkDividerRow(row.action || "", bg, indent));
    } else {
      tableRows.push(
        new TableRow({
          children: [
            mkSnCell(sn !== null ? String(sn) : "", colWidths[0]),
            mkTextCell(row.action || "", colWidths[1]),
            mkTextCell(row.expected_result || "", colWidths[2]),
            mkResultCell(colWidths[3]),
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
            size: { width: PAGE_W, height: PAGE_H },
            margin: { top: MAR_T, bottom: MAR_B, left: MAR_L, right: MAR_R },
          },
        },
        children: [
          // Title block above table
          new Paragraph({
            spacing: { before: 0, after: 200 },
            children: [
              new TextRun({
                text: `${moduleName} — ${testName}`,
                bold: true,
                size: 26,
                color: TEXT_BLACK,
                font: { name: "Helvetica" },
              }),
            ],
          }),
          new Table({
            width: { size: tableWidth, type: WidthType.DXA },
            columnWidths: [...colWidths],
            indent: { size: 0, type: WidthType.DXA },
            rows: tableRows,
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  // Sanitise filename
  const safe = (s: string) => s.replace(/[^a-z0-9_\-]/gi, "_");
  a.href = url;
  a.download = `${safe(moduleName)}_${safe(testName)}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}
