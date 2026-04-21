// src/utils/exportTestDocx.ts
// Generates a DOCX test-execution sheet for a single test.
// Layout: S.N. | Action | Expected Result | Result (OK ☐ / KO ☐) | Remarks

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
} from "docx";

// ── Types ──────────────────────────────────────────────────────────────────
export interface StepRow {
  action: string;
  expected_result: string;
  serial_no?: number | null;
  /** 0 / null = normal row; 1 = first-level divider; 2 = second-level; … */
  is_divider?: number | null;
  /** step_status enum from step_results: "pass" | "fail" | "pending" | null */
  status?: string | null;
}

export interface ExportTestDocxOptions {
  moduleName: string;
  testName: string;
  steps: StepRow[];
}

// ── Serial numbers (skip divider rows) ────────────────────────────────────
function computeSerialNumbers(steps: StepRow[]): (number | null)[] {
  let counter = 0;
  return steps.map((s) => (s.is_divider ? null : ++counter));
}

// ── Dimensions ────────────────────────────────────────────────────────────
const TEXT_BLACK = "000000";
const BORDER_CLR = "000000";

const PAGE_W = 11906,
  PAGE_H = 16838;
const MAR_L = 426,
  MAR_R = 567,
  MAR_T = 1418,
  MAR_B = 426;

const colWidths = [500, 3897, 2873, 1690, 900] as const;
const tableWidth = colWidths.reduce((a, b) => a + b, 0);

// 1.25 cm  =  1.25 × (1440 / 2.54)  ≈  709 DXA
const TABLE_INDENT = 709;

// 0.5 cm per divider level  =  0.5 × (1440 / 2.54)  ≈  283 DXA
const DIV_INDENT_PER_LEVEL = 283;

const cellMar = { top: 80, bottom: 80, left: 115, right: 115 };
const border = { style: BorderStyle.SINGLE, size: 4, color: BORDER_CLR };
const borders = { top: border, bottom: border, left: border, right: border };

// ── Cell builders ──────────────────────────────────────────────────────────
function mkHeaderCell(lines: string[], width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    margins: cellMar,
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
              color: TEXT_BLACK,
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
            checked: okChecked,
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
            checked: koChecked,
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
        columnSpan: 5,
        width: { size: tableWidth, type: WidthType.DXA },
        borders,
        margins: { ...cellMar, left: cellMar.left + indentDxa },
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { line: 276, lineRule: "auto" },
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

  const tableRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        mkHeaderCell(["S.N."], colWidths[0]),
        mkHeaderCell(["Action"], colWidths[1]),
        mkHeaderCell(["Expected Result"], colWidths[2]),
        mkHeaderCell(["Result", "(OK/KO)"], colWidths[3]),
        mkHeaderCell(["Remarks"], colWidths[4]),
      ],
    }),
  ];

  steps.forEach((row, idx) => {
    if (row.is_divider) {
      const level = typeof row.is_divider === "number" ? row.is_divider : 1;
      tableRows.push(mkDividerRow(row.action || "", level));
    } else {
      const sn = sns[idx];
      tableRows.push(
        new TableRow({
          children: [
            mkSnCell(sn !== null ? String(sn) : "", colWidths[0]),
            mkTextCell(row.action || "", colWidths[1]),
            mkTextCell(row.expected_result || "", colWidths[2]),
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
            size: { width: PAGE_W, height: PAGE_H },
            margin: { top: MAR_T, bottom: MAR_B, left: MAR_L, right: MAR_R },
          },
        },
        children: [
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
            indent: { size: TABLE_INDENT, type: WidthType.DXA },
            rows: tableRows,
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = (s: string) => s.replace(/[^a-z0-9_\-]/gi, "_");
  a.href = url;
  a.download = `${safe(moduleName)}_${safe(testName)}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}
