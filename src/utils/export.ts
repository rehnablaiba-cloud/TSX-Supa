import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Module } from "../types";

// ── Shared Types ──────────────────────────────────────────────
export interface FlatData {
  module: string; test: string; serial: number;
  action: string; expected: string; remarks: string; status: string;
  is_divider?: boolean;
  dividerLevel?: number; // 1 | 2 | 3
}

export interface ModuleSummary {
  name: string; description?: string;
  testCount?: number;
  total: number; pass: number; fail: number; pending: number; passRate: number;
}

// ── Palette ───────────────────────────────────────────────────
const DARK        = [30,  30,  30 ] as [number, number, number];
const MID         = [80,  80,  80 ] as [number, number, number];
const MUTED       = [130, 130, 130] as [number, number, number];
const FAINT       = [190, 190, 190] as [number, number, number];
const WHITE       = [255, 255, 255] as [number, number, number];

const HDR_BG      = [235, 235, 237] as [number, number, number];
const HDR_TXT     = [55,  55,  65 ] as [number, number, number];

const PASS_BG     = [232, 247, 237] as [number, number, number];
const FAIL_BG     = [254, 235, 235] as [number, number, number];
const ROW_ALT     = [249, 249, 251] as [number, number, number];

// Divider backgrounds — distinct per level
const DIV1_BG     = [255, 243, 224] as [number, number, number]; // orange-tint  (level 1)
const DIV2_BG     = [227, 242, 253] as [number, number, number]; // blue-tint    (level 2)
const DIV3_BG     = [232, 245, 233] as [number, number, number]; // green-tint   (level 3)

const GREEN_INK   = [20,  110,  50] as [number, number, number];
const RED_INK     = [180,  30,  30] as [number, number, number];
const AMBER_INK   = [130,  80,   0] as [number, number, number];
const BLUE_INK    = [20,   70, 180] as [number, number, number];
const ORANGE_INK  = [190,  80,   0] as [number, number, number];
const GREEN_DIV   = [27,  94,  32 ] as [number, number, number]; // text for level 3

const MOD_BG      = [232, 240, 254] as [number, number, number];
const MOD_TXT     = [20,   60, 160] as [number, number, number];
const TEST_BG     = [240, 240, 255] as [number, number, number];
const TEST_TXT    = [55,  50, 180] as [number, number, number];

// ── Utilities ─────────────────────────────────────────────────
const statusColor = (s: string): [number, number, number] =>
  s === "pass" ? GREEN_INK : s === "fail" ? RED_INK : AMBER_INK;

const statusLabel = (s: string) =>
  s === "pass" ? "PASS" : s === "fail" ? "FAIL" : "PENDING";

const statusBg = (s: string): [number, number, number] =>
  s === "pass" ? PASS_BG : s === "fail" ? FAIL_BG : WHITE;

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Returns bg + text colour for a divider level.
 * Level is determined in this order:
 *   1. d.dividerLevel  (explicit, set by data layer)
 *   2. parseInt(d.expected, 10)  (legacy: level stored in expected column)
 *   3. Falls back to 1
 *
 * Level 1 → orange   (main section header)
 * Level 2 → blue     (sub-section)
 * Level 3 → green    (sub-sub-section)
 */
const dividerStyle = (level: number) => {
  if (level === 2) return { bg: DIV2_BG, txt: BLUE_INK   };
  if (level === 3) return { bg: DIV3_BG, txt: GREEN_DIV  };
  return              { bg: DIV1_BG, txt: ORANGE_INK };  // level 1 default
};

/** Resolves the true divider level from a FlatData row */
const resolveDividerLevel = (d: FlatData): number => {
  if (d.dividerLevel && d.dividerLevel >= 1 && d.dividerLevel <= 3)
    return d.dividerLevel;
  const fromExpected = parseInt(d.expected, 10);
  if (!isNaN(fromExpected) && fromExpected >= 1 && fromExpected <= 3)
    return fromExpected;
  return 1;
};

// ── Line icon set ─────────────────────────────────────────────
type IconType = "total" | "pass" | "fail" | "pending" | "tests";

const drawLineIcon = (
  doc: jsPDF,
  cx: number, cy: number, r: number,
  color: [number, number, number],
  icon: IconType
) => {
  doc.setDrawColor(...color);
  doc.setLineWidth(0.55);
  switch (icon) {
    case "total": {
      const lx = cx - r * 0.55, rx = cx + r * 0.55;
      [-0.55, 0, 0.55].forEach(oy => doc.line(lx, cy + r * oy, rx, cy + r * oy));
      break;
    }
    case "pass":
      doc.line(cx - r*0.6, cy, cx - r*0.05, cy + r*0.55);
      doc.line(cx - r*0.05, cy + r*0.55, cx + r*0.65, cy - r*0.55);
      break;
    case "fail":
      doc.line(cx - r*0.55, cy - r*0.55, cx + r*0.55, cy + r*0.55);
      doc.line(cx + r*0.55, cy - r*0.55, cx - r*0.55, cy + r*0.55);
      break;
    case "pending":
      doc.circle(cx, cy, r * 0.7, "S");
      doc.line(cx, cy - r*0.45, cx, cy);
      doc.line(cx, cy, cx + r*0.35, cy + r*0.2);
      break;
    case "tests": {
      const g = r * 0.38;
      doc.line(cx - g, cy - r*0.55, cx - g, cy + r*0.55);
      doc.line(cx + g, cy - r*0.55, cx + g, cy + r*0.55);
      doc.line(cx - r*0.55, cy - g, cx + r*0.55, cy - g);
      doc.line(cx - r*0.55, cy + g, cx + r*0.55, cy + g);
      break;
    }
  }
};

// ── Shared header ─────────────────────────────────────────────
const drawHeader = (doc: jsPDF, title: string, subtitle?: string): number => {
  const W = doc.internal.pageSize.getWidth();

  doc.setDrawColor(...DARK);
  doc.setLineWidth(0.6);
  doc.line(14, 5, W - 14, 5);

  // Guard: ensure title is never empty
  const safeTitle    = (title    && title.trim())    ? title.trim()    : "Unnamed Test";
  const safeSubtitle = (subtitle && subtitle.trim()) ? subtitle.trim() : undefined;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...DARK);
  doc.text(safeTitle, W / 2, 14, { align: "center" });

  let lineY = 19;

  if (safeSubtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(safeSubtitle, W / 2, 21, { align: "center" });
    lineY = 26;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text(`Generated: ${new Date().toLocaleString()}`, W - 14, lineY - 1, { align: "right" });

  doc.setDrawColor(...FAINT);
  doc.setLineWidth(0.25);
  doc.line(14, lineY + 2, W - 14, lineY + 2);

  return lineY + 7;
};

// ── Shared footer ─────────────────────────────────────────────
const drawFooter = (doc: jsPDF) => {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const pages = (doc.internal as any).getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...FAINT);
    doc.setLineWidth(0.25);
    doc.line(14, H - 12, W - 14, H - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text("Confidential QA Report", 14, H - 6);
    doc.text(`Page ${i} of ${pages}`, W - 14, H - 6, { align: "right" });
  }
};

// ── Stats bar ─────────────────────────────────────────────────
interface ExtraCard {
  label: string; value: string;
  color: [number, number, number];
  icon: IconType;
}

const drawStatsBar = (
  doc: jsPDF,
  total: number, pass: number, fail: number, pending: number,
  startY: number,
  extraCards?: ExtraCard[]
): number => {
  const W       = doc.internal.pageSize.getWidth();
  const usableW = W - 28;

  const cards: ExtraCard[] = [
    { label: "Total Steps", value: String(total),   color: DARK,      icon: "total"   },
    { label: "Passed",      value: String(pass),    color: GREEN_INK, icon: "pass"    },
    { label: "Failed",      value: String(fail),    color: RED_INK,   icon: "fail"    },
    { label: "Pending",     value: String(pending), color: AMBER_INK, icon: "pending" },
    ...(extraCards ?? []),
  ];

  const cardW = (usableW - (cards.length - 1) * 3) / cards.length;
  const cardH = 22;

  cards.forEach((card, i) => {
    const x = 14 + i * (cardW + 3);
    const y = startY;

    doc.setFillColor(...WHITE);
    doc.setDrawColor(...FAINT);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, cardW, cardH, 2, 2, "FD");

    doc.setDrawColor(...card.color);
    doc.setLineWidth(1.2);
    doc.line(x + 1.5, y + 3, x + 1.5, y + cardH - 3);
    doc.setLineWidth(0.3);

    drawLineIcon(doc, x + cardW - 8, y + 7.5, 3.5, card.color, card.icon);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...card.color);
    doc.text(card.value, x + 7, y + 13);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(...MUTED);
    doc.text(card.label.toUpperCase(), x + 7, y + 19);
  });

  const rate  = total > 0 ? Math.round((pass / total) * 100) : 0;
  const barY  = startY + cardH + 4;
  const barH  = 3;

  doc.setDrawColor(...FAINT);
  doc.setFillColor(...WHITE);
  doc.setLineWidth(0.25);
  doc.roundedRect(14, barY, usableW, barH, 1.5, 1.5, "FD");

  if (rate > 0) {
    doc.setFillColor(...GREEN_INK);
    doc.setDrawColor(...GREEN_INK);
    doc.roundedRect(14, barY, (usableW * rate) / 100, barH, 1.5, 1.5, "F");
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...GREEN_INK);
  doc.text(`${rate}% pass rate`, 14, barY + barH + 5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text(
    `${pass} passed  |  ${fail} failed  |  ${pending} pending  |  ${total} total`,
    W - 14, barY + barH + 5, { align: "right" }
  );

  return barY + barH + 11;
};

// ── Table defaults ────────────────────────────────────────────
const tableDefaults = (doc: jsPDF, startY: number) => ({
  startY,
  styles: {
    fontSize: 8,
    cellPadding: { top: 3.5, bottom: 3.5, left: 4, right: 4 },
    textColor: DARK,
    lineColor: FAINT,
    lineWidth: 0.2,
    fillColor: WHITE,
  } as any,
  headStyles: {
    fillColor: HDR_BG,
    textColor: HDR_TXT,
    fontStyle: "bold" as const,
    lineColor: FAINT,
    lineWidth: 0.35,
    fontSize: 7,
    cellPadding: { top: 4, bottom: 4, left: 4, right: 4 },
  },
  alternateRowStyles: { fillColor: ROW_ALT },
  margin: { top: 34, left: 14, right: 14, bottom: 16 },
});

// ── Step row builder ──────────────────────────────────────────
const buildStepRow = (step: FlatData) => {
  const bg = statusBg(step.status);
  const sc = statusColor(step.status);
  return [
    {
      content: String(step.serial),
      styles: {
        halign:    "center" as const,
        fillColor: bg,
        textColor: DARK,
        fontStyle: "bold" as const,
        fontSize:  8.5,
      },
    },
    { content: step.action,   styles: { fillColor: bg, textColor: DARK } },
    { content: step.expected, styles: { fillColor: bg, textColor: MID  } },
    { content: step.remarks,  styles: { fillColor: bg, textColor: MID  } },
    {
      content: statusLabel(step.status),
      styles: {
        halign:    "center" as const,
        fillColor: bg,
        textColor: sc,
        fontStyle: "bold" as const,
        fontSize:  7.5,
      },
    },
  ];
};

// ── Divider row builder ───────────────────────────────────────
/**
 * Builds a full-width divider row with correct per-level colour.
 *
 * Colour mapping (ASCII prefixes — jsPDF built-in fonts are Latin-1 only):
 *   Level 1  >>  orange bg / orange text  (main section)
 *   Level 2   >  blue   bg / blue   text  (sub-section)
 *   Level 3   -  green  bg / green  text  (detail)
 */
const buildDividerRow = (d: FlatData, colSpan: number) => {
  const level = resolveDividerLevel(d);
  const { bg, txt } = dividerStyle(level);

  // ASCII-only prefixes: jsPDF Helvetica does not support Unicode arrows
  const prefix = level === 1 ? ">>" : level === 2 ? " >" : "  -";

  // Strip any leading markdown-style hashes from the action text
  const label = d.action.replace(/^#{1,3}\s*/, "").toUpperCase();

  return [{
    content: `${prefix}  ${label}`,
    colSpan,
    styles: {
      fillColor: bg,
      textColor: txt,
      fontStyle: "bold" as const,
      fontSize:  8,
      lineColor: FAINT as [number, number, number],
      lineWidth: 0.3,
      cellPadding: {
        top:    level === 1 ? 4.5 : level === 2 ? 3.5 : 3,
        bottom: level === 1 ? 4.5 : level === 2 ? 3.5 : 3,
        left:   level === 1 ? 10  : level === 2 ? 16  : 22,
        right:  4,
      },
    },
  }];
};

// ─────────────────────────────────────────────────────────────
// 1. DASHBOARD EXPORTS
// ─────────────────────────────────────────────────────────────
export const exportDashboardCSV = (summaries: ModuleSummary[]) => {
  const headers = "#,Module,Description,Tests,Total Steps,Pass,Fail,Pending,Pass Rate (%)\n";
  const rows = summaries.map((s, i) =>
    [pad2(i + 1), `"${s.name}"`, `"${s.description || ""}"`,
     s.testCount ?? "", s.total, s.pass, s.fail, s.pending, `${s.passRate}%`].join(",")
  ).join("\n");
  download(
    new Blob(["\uFEFF" + headers + rows], { type: "text/csv" }),
    `TestPro_Dashboard_${today()}.csv`
  );
};

export const exportDashboardPDF = (summaries: ModuleSummary[]) => {
  const doc = new jsPDF({ orientation: "landscape" });
  const contentY = drawHeader(doc, "Dashboard Report", "All Modules Summary");

  const total      = summaries.reduce((a, s) => a + s.total,            0);
  const pass       = summaries.reduce((a, s) => a + s.pass,             0);
  const fail       = summaries.reduce((a, s) => a + s.fail,             0);
  const pending    = summaries.reduce((a, s) => a + s.pending,          0);
  const totalTests = summaries.reduce((a, s) => a + (s.testCount ?? 0), 0);

  const afterStats = drawStatsBar(doc, total, pass, fail, pending, contentY, [
    { label: "Total Tests", value: String(totalTests), color: BLUE_INK, icon: "tests" },
  ]);

  autoTable(doc, {
    ...tableDefaults(doc, afterStats),
    head: [["#", "Module", "Description", "Tests", "Total Steps", "Pass", "Fail", "Pending", "Pass Rate"]],
    body: summaries.map((s, i) => [
      pad2(i + 1), s.name, s.description || "-",
      s.testCount ?? "-", s.total, s.pass, s.fail, s.pending, `${s.passRate}%`,
    ]),
    columnStyles: {
      0: { cellWidth: 10,  halign: "center", textColor: MUTED as any },
      1: { cellWidth: 36,  fontStyle: "bold" },
      2: { cellWidth: 52 },
      3: { cellWidth: 18,  halign: "center", textColor: BLUE_INK  as any, fontStyle: "bold" },
      4: { cellWidth: 22,  halign: "center" },
      5: { cellWidth: 18,  halign: "center", textColor: GREEN_INK as any, fontStyle: "bold" },
      6: { cellWidth: 18,  halign: "center", textColor: RED_INK   as any, fontStyle: "bold" },
      7: { cellWidth: 18,  halign: "center", textColor: AMBER_INK as any },
      8: { halign: "center", fontStyle: "bold" },
    },
  });

  drawFooter(doc);
  openPrintPreview(doc);
};

export const exportDashboardDocx = (summaries: ModuleSummary[]) => {
  const rows = summaries.map((s, i) => `
    <tr>
      <td align="center" style="color:#64748b">${pad2(i + 1)}</td>
      <td><b>${s.name}</b></td><td>${s.description || ""}</td>
      <td align="center" style="color:#2563eb"><b>${s.testCount ?? "-"}</b></td>
      <td align="center">${s.total}</td>
      <td align="center" style="color:#16a34a"><b>${s.pass}</b></td>
      <td align="center" style="color:#dc2626"><b>${s.fail}</b></td>
      <td align="center" style="color:#d97706"><b>${s.pending}</b></td>
      <td align="center"><b>${s.passRate}%</b></td>
    </tr>`).join("");
  const html = docxWrapper("Dashboard Report - All Modules", `
    <table border="1" style="border-collapse:collapse;width:100%">
      <thead><tr style="background:#f1f5f9;color:#475569">
        <th>#</th><th>Module</th><th>Description</th><th>Tests</th>
        <th>Total Steps</th><th>Pass</th><th>Fail</th><th>Pending</th><th>Pass Rate</th>
      </tr></thead><tbody>${rows}</tbody></table>`);
  downloadDocx(html, `TestPro_Dashboard_${today()}.doc`);
};

// ─────────────────────────────────────────────────────────────
// 2. REPORT PAGE EXPORTS
// ─────────────────────────────────────────────────────────────
interface TestSummaryRow {
  module: string; test: string;
  total: number; pass: number; fail: number; pending: number; passRate: number;
}

const buildTestSummaries = (data: FlatData[]): TestSummaryRow[] => {
  const map = new Map<string, TestSummaryRow>();
  for (const d of data) {
    if (d.is_divider) continue;
    const key = `${d.module}|||${d.test}`;
    if (!map.has(key))
      map.set(key, { module: d.module, test: d.test, total: 0, pass: 0, fail: 0, pending: 0, passRate: 0 });
    const row = map.get(key)!;
    row.total++;
    if (d.status === "pass") row.pass++;
    else if (d.status === "fail") row.fail++;
    else row.pending++;
  }
  for (const row of map.values())
    row.passRate = row.total > 0 ? Math.round((row.pass / row.total) * 100) : 0;
  return Array.from(map.values());
};

export const exportReportCSV = (_modules: Module[], data: FlatData[]) => {
  const summaries = buildTestSummaries(data);
  const headers   = "#,Module,Test,Total Steps,Pass,Fail,Pending,Pass Rate (%)\n";
  const rows      = summaries.map((s, i) =>
    [pad2(i + 1), `"${s.module}"`, `"${s.test}"`,
     s.total, s.pass, s.fail, s.pending, `${s.passRate}%`].join(",")
  ).join("\n");
  download(
    new Blob(["\uFEFF" + headers + rows], { type: "text/csv" }),
    `TestPro_Report_${today()}.csv`
  );
};

export const exportReportPDF = (_modules: Module[], data: FlatData[]) => {
  const doc       = new jsPDF({ orientation: "landscape" });
  const summaries = buildTestSummaries(data);
  const contentY  = drawHeader(doc, "Test Report", "All Modules - Test Summary");

  const total   = summaries.reduce((a, s) => a + s.total,   0);
  const pass    = summaries.reduce((a, s) => a + s.pass,    0);
  const fail    = summaries.reduce((a, s) => a + s.fail,    0);
  const pending = summaries.reduce((a, s) => a + s.pending, 0);

  const afterStats = drawStatsBar(doc, total, pass, fail, pending, contentY, [
    { label: "Total Tests", value: String(summaries.length), color: BLUE_INK, icon: "tests" },
  ]);

  const body: any[] = [];
  let lastModule   = "";
  let globalSerial = 0;

  for (const s of summaries) {
    if (s.module !== lastModule) {
      lastModule = s.module;
      body.push([{
        content: `>>  ${s.module.toUpperCase()}`,
        colSpan: 8,
        styles: {
          fillColor: MOD_BG, textColor: MOD_TXT,
          fontStyle: "bold" as const, fontSize: 7.5,
          lineColor: FAINT as [number, number, number], lineWidth: 0.3,
          cellPadding: { top: 3.5, bottom: 3.5, left: 8, right: 4 },
        },
      }]);
    }

    globalSerial++;
    const passRateColor = s.passRate === 100 ? GREEN_INK
                        : s.passRate === 0 && s.total > 0 ? RED_INK : DARK;

    body.push([
      { content: pad2(globalSerial), styles: { textColor: DARK, fontStyle: "bold" as const, halign: "center" as const, fontSize: 8.5 } },
      { content: s.module,           styles: { textColor: MUTED, fontSize: 7 } },
      { content: s.test,             styles: { textColor: DARK, fontStyle: "bold" as const } },
      { content: String(s.total),    styles: { textColor: DARK,      halign: "center" as const } },
      { content: String(s.pass),     styles: { textColor: GREEN_INK, halign: "center" as const, fontStyle: "bold" as const } },
      { content: String(s.fail),     styles: { textColor: RED_INK,   halign: "center" as const, fontStyle: "bold" as const } },
      { content: String(s.pending),  styles: { textColor: AMBER_INK, halign: "center" as const } },
      { content: `${s.passRate}%`,   styles: { textColor: passRateColor, halign: "center" as const, fontStyle: "bold" as const } },
    ]);
  }

  autoTable(doc, {
    ...tableDefaults(doc, afterStats),
    head: [["#", "Module", "Test Name", "Steps", "Pass", "Fail", "Pending", "Pass Rate"]],
    body,
    alternateRowStyles: { fillColor: ROW_ALT },
    columnStyles: {
      0: { cellWidth: 12,  halign: "center" },
      1: { cellWidth: 34 },
      2: { cellWidth: 80 },
      3: { cellWidth: 20,  halign: "center" },
      4: { cellWidth: 20,  halign: "center" },
      5: { cellWidth: 20,  halign: "center" },
      6: { cellWidth: 22,  halign: "center" },
      7: { cellWidth: 22,  halign: "center" },
    },
  });

  drawFooter(doc);
  openPrintPreview(doc);
};

export const exportAllCSV    = exportReportCSV;
export const exportAllPDF    = exportReportPDF;
export const exportModuleCSV = (_name: string, data: FlatData[]) => exportReportCSV([], data);
export const exportModulePDF = (_name: string, data: FlatData[]) => exportReportPDF([], data);

// ─────────────────────────────────────────────────────────────
// 3. MODULE DETAIL EXPORTS
// ─────────────────────────────────────────────────────────────
export const exportModuleDetailCSV = (data: FlatData[]) => {
  const lines: string[] = ["Module,Test,#,Action,Expected Result,Remarks,Status"];
  let lastModule = "";
  let lastTest   = "";
  let testSerial = 0;

  for (const d of data) {
    if (d.is_divider) continue;
    if (d.module !== lastModule) {
      if (lastModule !== "") lines.push("");
      lines.push(`"=== ${d.module} ===","","","","","",""`);
      lastModule = d.module; lastTest = ""; testSerial = 0;
    }
    if (d.test !== lastTest) {
      testSerial++;
      lines.push(`"","--- ${pad2(testSerial)}. ${d.test} ---","","","","",""`);
      lastTest = d.test;
    }
    lines.push([
      `"${d.module}"`,
      `"${d.test}"`,
      d.serial,
      `"${d.action.replace(/"/g, '""')}"`,
      `"${d.expected.replace(/"/g, '""')}"`,
      `"${d.remarks.replace(/"/g, '""')}"`,
      d.status,
    ].join(","));
  }

  download(
    new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv" }),
    `TestPro_ModuleDetail_${today()}.csv`
  );
};

export const exportModuleDetailPDF = (data: FlatData[]) => {
  const doc      = new jsPDF({ orientation: "landscape" });
  const contentY = drawHeader(doc, "Module Detail Report", "All Modules - Full Step Results");

  const nd      = data.filter(d => !d.is_divider);
  const pass    = nd.filter(d => d.status === "pass").length;
  const fail    = nd.filter(d => d.status === "fail").length;
  const pending = nd.filter(d => d.status === "pending").length;

  const afterStats = drawStatsBar(doc, nd.length, pass, fail, pending, contentY);

  type TestBlock   = { name: string; steps: FlatData[]; serial: number };
  type ModuleBlock = { name: string; tests: TestBlock[] };

  const modules: ModuleBlock[] = [];
  const modIdx  = new Map<string, number>();
  const testIdx = new Map<string, number>();
  let testGlobalSerial = 0;

  for (const d of nd) {
    if (!modIdx.has(d.module)) {
      modIdx.set(d.module, modules.length);
      modules.push({ name: d.module, tests: [] });
    }
    const mod  = modules[modIdx.get(d.module)!];
    const tkey = `${d.module}|||${d.test}`;
    if (!testIdx.has(tkey)) {
      testGlobalSerial++;
      testIdx.set(tkey, mod.tests.length);
      mod.tests.push({ name: d.test, steps: [], serial: testGlobalSerial });
    }
    mod.tests[testIdx.get(tkey)!].steps.push(d);
  }

  const body: any[] = [];

  for (const mod of modules) {
    const allSteps = mod.tests.flatMap(t => t.steps);
    const mPass    = allSteps.filter(s => s.status === "pass").length;
    const mFail    = allSteps.filter(s => s.status === "fail").length;
    const mRate    = allSteps.length > 0 ? Math.round((mPass / allSteps.length) * 100) : 0;

    body.push([{
      content: `>>  ${mod.name.toUpperCase()}   |   ${mod.tests.length} test${mod.tests.length !== 1 ? "s" : ""}   ${allSteps.length} steps   ${mRate}% pass rate`,
      colSpan: 5,
      styles: {
        fillColor: MOD_BG, textColor: MOD_TXT,
        fontStyle: "bold" as const, fontSize: 8,
        lineColor: FAINT as [number, number, number], lineWidth: 0.35,
        cellPadding: { top: 4.5, bottom: 4.5, left: 10, right: 6 },
      },
    }]);

    for (const test of mod.tests) {
      const tPass    = test.steps.filter(s => s.status === "pass").length;
      const tFail    = test.steps.filter(s => s.status === "fail").length;
      const tPending = test.steps.filter(s => s.status === "pending").length;
      const tRate    = test.steps.length > 0 ? Math.round((tPass / test.steps.length) * 100) : 0;

      body.push([{
        content: `    ${pad2(test.serial)}.  ${test.name}   |   P: ${tPass}  F: ${tFail}  N: ${tPending}   ${tRate}% pass`,
        colSpan: 5,
        styles: {
          fillColor: TEST_BG, textColor: TEST_TXT,
          fontStyle: "bold" as const, fontSize: 7.5,
          lineColor: FAINT as [number, number, number], lineWidth: 0.3,
          cellPadding: { top: 3, bottom: 3, left: 20, right: 6 },
        },
      }]);

      for (const row of data.filter(
        r => r.module === test.steps[0]?.module && r.test === test.name
      )) {
        if (row.is_divider) {
          body.push(buildDividerRow(row, 5));
        } else {
          body.push(buildStepRow(row));
        }
      }
    }
  }

  autoTable(doc, {
    ...tableDefaults(doc, afterStats),
    head: [["S.NO", "ACTION", "EXPECTED RESULT", "REMARKS", "STATUS"]],
    body,
    alternateRowStyles: { fillColor: WHITE },
    columnStyles: {
      0: { cellWidth: 14 },
      1: { cellWidth: 80 },
      2: { cellWidth: 78 },
      3: { cellWidth: 60 },
      4: { cellWidth: 36 },
    },
  });

  drawFooter(doc);
  openPrintPreview(doc);
};

// ─────────────────────────────────────────────────────────────
// 4. TEST EXECUTION EXPORTS
// ─────────────────────────────────────────────────────────────
export const exportExecutionCSV = (module_name: string, test_name: string, data: FlatData[]) => {
  const headers = "#,Action,Expected Result,Remarks,Status\n";
  const rows = data.map(d => {
    if (d.is_divider) return `,"${d.action.replace(/"/g, '""')}","","",""`;
    return [
      d.serial,
      `"${d.action.replace(/"/g, '""')}"`,
      `"${d.expected.replace(/"/g, '""')}"`,
      `"${d.remarks.replace(/"/g, '""')}"`,
      d.status,
    ].join(",");
  }).join("\n");
  download(
    new Blob(["\uFEFF" + headers + rows], { type: "text/csv" }),
    `${module_name}_${test_name}_${today()}.csv`
  );
};

export const exportExecutionPDF = (module_name: string, test_name: string, data: FlatData[]) => {
  const doc = new jsPDF({ orientation: "landscape" });

  // Guard: always show a meaningful title even if caller passes empty string
  const safetest_name   = (test_name   && test_name.trim())   ? test_name.trim()   : "Unnamed Test";
  const safemodule_name = (module_name && module_name.trim()) ? module_name.trim() : "Unknown Module";

  // title = test name (large, top), subtitle = module name (small, below title)
  const contentY = drawHeader(doc, safetest_name, safemodule_name);

  const nd      = data.filter(d => !d.is_divider);
  const pass    = nd.filter(d => d.status === "pass").length;
  const fail    = nd.filter(d => d.status === "fail").length;
  const pending = nd.filter(d => d.status === "pending").length;

  const afterStats = drawStatsBar(doc, nd.length, pass, fail, pending, contentY);

  const body = data.map(d => {
    if (d.is_divider) return buildDividerRow(d, 5);
    return buildStepRow(d);
  });

  autoTable(doc, {
    ...tableDefaults(doc, afterStats),
    head: [["S.NO", "ACTION", "EXPECTED RESULT", "REMARKS", "STATUS"]],
    body,
    alternateRowStyles: { fillColor: WHITE },
    columnStyles: {
      0: { cellWidth: 14 },
      1: { cellWidth: 80 },
      2: { cellWidth: 78 },
      3: { cellWidth: 60 },
      4: { cellWidth: 36 },
    },
  });

  drawFooter(doc);
  openPrintPreview(doc);
};

// ── Helpers ───────────────────────────────────────────────────
const openPrintPreview = (doc: jsPDF) => {
  const url = doc.output("bloburl");
  const win = window.open(url as unknown as string, "_blank");
  if (!win) {
    const a = document.createElement("a");
    a.href = url as unknown as string;
    a.download = "report.pdf";
    a.click();
  }
};

const today = () => new Date().toISOString().split("T")[0];

const download = (blob: Blob, filename: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
};

const docxWrapper = (title: string, body: string) => `
  <html xmlns:o="urn:schemas-microsoft-com:office:office"
        xmlns:w="urn:schemas-microsoft-com:office:word"
        xmlns="http://www.w3.org/TR/REC-html40">
  <head><meta charset="utf-8">
    <style>
      body  { font-family: Calibri, Arial, sans-serif; margin: 24px; }
      h1    { color: #1e3a8a; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; font-size: 18px; }
      p     { color: #64748b; font-size: 11px; margin: 4px 0 16px; }
      table { border-collapse: collapse; width: 100%; }
      th    { background: #f1f5f9; color: #475569; padding: 8px 10px; text-align: left;
              font-size: 10px; border: 1px solid #e2e8f0; }
      td    { padding: 7px 10px; border: 1px solid #e2e8f0; font-size: 11px; }
      tr:nth-child(even) td { background: #f8fafc; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <p>Generated: ${new Date().toLocaleString()}</p>
    ${body}
  </body></html>`;

const downloadDocx = (html: string, filename: string) =>
  download(new Blob(["\uFEFF", html], { type: "application/msword" }), filename);