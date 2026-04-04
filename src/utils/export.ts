import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Module } from "../types";

// ── Shared Types ──────────────────────────────────────────────
export interface FlatData {
  module: string; test: string; serial: number;
  action: string; expected: string; remarks: string; status: string;
}

export interface ModuleSummary {
  name: string; description?: string;
  total: number; pass: number; fail: number; pending: number; passRate: number;
}

// ── Palette — line-only, printer-safe ─────────────────────────
const ACCENT  = [37,  99,  235] as [number,number,number]; // brand blue
const DARK    = [15,  23,  42]  as [number,number,number];
const MID     = [51,  65,  85]  as [number,number,number];
const MUTED   = [100, 116, 139] as [number,number,number];
const RULE    = [203, 213, 225] as [number,number,number]; // light slate border
const WHITE   = [255, 255, 255] as [number,number,number];
const ROW_ALT = [248, 250, 252] as [number,number,number];

const GREEN   = [22,  163,  74] as [number,number,number];
const RED     = [220,  38,  38] as [number,number,number];
const AMBER   = [161,  98,   7] as [number,number,number]; // darker for print legibility

const statusColor = (s: string): [number,number,number] =>
  s === "pass" ? GREEN : s === "fail" ? RED : AMBER;

const statusLabel = (s: string) =>
  s === "pass" ? "Pass" : s === "fail" ? "Fail" : "Pending";

// ── Header ────────────────────────────────────────────────────
const drawHeader = (doc: jsPDF, title: string, subtitle?: string) => {
  const W = doc.internal.pageSize.getWidth();

  // Top accent rule
  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, W, 2.5, "F");

  // Left brand mark — vertical accent bar
  doc.setFillColor(...ACCENT);
  doc.rect(14, 7, 2, 18, "F");

  // Brand name
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...DARK);
  doc.text("TestPro", 20, 17);

  // Brand sub-label
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text("QA TEST MANAGEMENT", 20, 22);

  // Title (right-aligned)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...DARK);
  doc.text(title, W - 14, 15, { align: "right" });

  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(subtitle, W - 14, 21, { align: "right" });
  }

  // Generated date
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text(`Generated: ${new Date().toLocaleString()}`, W - 14, 26, { align: "right" });

  // Bottom header rule
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.4);
  doc.line(14, 29, W - 14, 29);
};

// ── Footer ────────────────────────────────────────────────────
const drawFooter = (doc: jsPDF) => {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const pages = (doc.internal as any).getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.3);
    doc.line(14, H - 12, W - 14, H - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text("TestPro — Confidential QA Report", 14, H - 6);
    doc.text(`Page ${i} of ${pages}`, W - 14, H - 6, { align: "right" });
  }
};

// ── Stats Bar — outlined cards, no fills ──────────────────────
const drawStatsBar = (
  doc: jsPDF,
  total: number, pass: number, fail: number, pending: number,
  startY: number
): number => {
  const W = doc.internal.pageSize.getWidth();
  const usableW = W - 28;
  const cardW = (usableW - 9) / 4; // 3 gaps × 3px
  const cardH = 20;

  const stats = [
    { label: "Total Steps", value: String(total),   color: DARK  },
    { label: "Passed",      value: String(pass),    color: GREEN },
    { label: "Failed",      value: String(fail),    color: RED   },
    { label: "Pending",     value: String(pending), color: AMBER },
  ];

  stats.forEach((s, i) => {
    const x = 14 + i * (cardW + 3);

    // Card outline
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.3);
    doc.setFillColor(...WHITE);
    doc.roundedRect(x, startY, cardW, cardH, 2, 2, "FD");

    // Top accent line per card
    doc.setFillColor(...s.color);
    doc.roundedRect(x, startY, cardW, 1.5, 1, 1, "F");

    // Value
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...s.color);
    doc.text(s.value, x + cardW / 2, startY + 11, { align: "center" });

    // Label
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text(s.label.toUpperCase(), x + cardW / 2, startY + 17, { align: "center" });
  });

  // Pass-rate progress track
  const rate = total > 0 ? Math.round((pass / total) * 100) : 0;
  const barY = startY + cardH + 5;
  const barH = 2.5;

  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  doc.setFillColor(...WHITE);
  doc.roundedRect(14, barY, usableW, barH, 1, 1, "FD");

  if (rate > 0) {
    doc.setFillColor(...GREEN);
    doc.roundedRect(14, barY, (usableW * rate) / 100, barH, 1, 1, "F");
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...MID);
  doc.text(`${rate}% pass rate`, W - 14, barY + 2, { align: "right" });

  return barY + barH + 6;
};

// ── Status cell — dot + text, no fill ────────────────────────
const applyStatusCell = (doc: jsPDF, hookData: any, rawStatus: string) => {
  if (hookData.section !== "body") return;
  const [r, g, b] = statusColor(rawStatus);
  const { x, y, width, height } = hookData.cell;
  const cx = x + 6;
  const cy = y + height / 2;

  // dot
  doc.setFillColor(r, g, b);
  doc.circle(cx, cy, 1.5, "F");

  // label
  doc.setTextColor(r, g, b);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text(statusLabel(rawStatus), cx + 4, cy + 0.9);

  hookData.cell.text = [];
};

// ── Shared table style defaults ───────────────────────────────
const tableDefaults = (doc: jsPDF, startY: number) => ({
  startY,
  styles: {
    fontSize: 8,
    cellPadding: 4,
    textColor: DARK,
    lineColor: RULE,
    lineWidth: 0.25,
    fillColor: WHITE,
  } as any,
  headStyles: {
    fillColor: WHITE,
    textColor: ACCENT,
    fontStyle: "bold" as const,
    lineColor: ACCENT,
    lineWidth: 0.5,
  },
  alternateRowStyles: { fillColor: ROW_ALT },
  margin: { top: 33, left: 14, right: 14, bottom: 16 },
});

// ─────────────────────────────────────────────────────────────
// 1. DASHBOARD EXPORTS
// ─────────────────────────────────────────────────────────────
export const exportDashboardCSV = (summaries: ModuleSummary[]) => {
  const headers = "Module,Description,Total Steps,Pass,Fail,Pending,Pass Rate (%)\n";
  const rows = summaries.map(s =>
    `"${s.name}","${s.description || ""}",${s.total},${s.pass},${s.fail},${s.pending},${s.passRate}`
  ).join("\n");
  download(new Blob(["\uFEFF" + headers + rows], { type: "text/csv" }),
    `TestPro_Dashboard_${today()}.csv`);
};

export const exportDashboardPDF = (summaries: ModuleSummary[]) => {
  const doc = new jsPDF({ orientation: "landscape" });
  drawHeader(doc, "Dashboard Report", "All Modules Summary");

  const total   = summaries.reduce((a, s) => a + s.total,   0);
  const pass    = summaries.reduce((a, s) => a + s.pass,    0);
  const fail    = summaries.reduce((a, s) => a + s.fail,    0);
  const pending = summaries.reduce((a, s) => a + s.pending, 0);
  const afterStats = drawStatsBar(doc, total, pass, fail, pending, 34);

  autoTable(doc, {
    ...tableDefaults(doc, afterStats + 2),
    head: [["Module", "Description", "Total", "Pass", "Fail", "Pending", "Pass Rate"]],
    body: summaries.map(s => [
      s.name, s.description || "—", s.total, s.pass, s.fail, s.pending, `${s.passRate}%`
    ]),
    columnStyles: {
      0: { cellWidth: 40, fontStyle: "bold" },
      1: { cellWidth: 65 },
      2: { halign: "center" },
      3: { halign: "center", textColor: GREEN as any },
      4: { halign: "center", textColor: RED as any },
      5: { halign: "center", textColor: AMBER as any },
      6: { halign: "center", fontStyle: "bold" },
    },
  });

  drawFooter(doc);
  doc.save(`TestPro_Dashboard_${today()}.pdf`);
};

export const exportDashboardDocx = (summaries: ModuleSummary[]) => {
  const rows = summaries.map(s => `
    <tr>
      <td><b>${s.name}</b></td>
      <td>${s.description || ""}</td>
      <td align="center">${s.total}</td>
      <td align="center" style="color:#16a34a"><b>${s.pass}</b></td>
      <td align="center" style="color:#dc2626"><b>${s.fail}</b></td>
      <td align="center" style="color:#d97706"><b>${s.pending}</b></td>
      <td align="center"><b>${s.passRate}%</b></td>
    </tr>`).join("");
  const html = docxWrapper("Dashboard Report — All Modules", `
    <table border="1" style="border-collapse:collapse;width:100%">
      <thead><tr style="background:#3b82f6;color:white">
        <th>Module</th><th>Description</th><th>Total</th>
        <th>Pass</th><th>Fail</th><th>Pending</th><th>Pass Rate</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`);
  downloadDocx(html, `TestPro_Dashboard_${today()}.doc`);
};

// ─────────────────────────────────────────────────────────────
// 2. REPORT PAGE EXPORTS
// ─────────────────────────────────────────────────────────────
export const exportReportCSV = (modules: Module[], data: FlatData[]) => {
  const headers = "Module,Test,#,Action,Expected,Remarks,Status\n";
  const rows = data.map(d =>
    [`"${d.module}"`, `"${d.test}"`, d.serial,
     `"${d.action.replace(/"/g,'""')}"`, `"${d.expected.replace(/"/g,'""')}"`,
     `"${d.remarks.replace(/"/g,'""')}"`, d.status].join(",")
  ).join("\n");
  download(new Blob(["\uFEFF" + headers + rows], { type: "text/csv" }),
    `TestPro_Report_${today()}.csv`);
};

export const exportReportPDF = (modules: Module[], data: FlatData[]) => {
  const doc = new jsPDF({ orientation: "landscape" });
  drawHeader(doc, "Test Report", "All Modules · All Tests");

  const pass    = data.filter(d => d.status === "pass").length;
  const fail    = data.filter(d => d.status === "fail").length;
  const pending = data.filter(d => d.status === "pending").length;
  const afterStats = drawStatsBar(doc, data.length, pass, fail, pending, 34);

  autoTable(doc, {
    ...tableDefaults(doc, afterStats + 2),
    head: [["Module", "Test", "#", "Action", "Expected Result", "Remarks", "Status"]],
    body: data.map(d => [d.module, d.test, d.serial, d.action, d.expected, d.remarks, d.status]),
    columnStyles: {
      0: { cellWidth: 30, fontStyle: "bold" },
      1: { cellWidth: 35 },
      2: { cellWidth: 10, halign: "center" },
      3: { cellWidth: 58 },
      4: { cellWidth: 58 },
      5: { cellWidth: 45 },
      6: { cellWidth: 26, halign: "left" },
    },
    didDrawCell: (h) => {
      if (h.column.index === 6) applyStatusCell(doc, h, data[h.row.index]?.status ?? "");
    },
  });

  drawFooter(doc);
  doc.save(`TestPro_Report_${today()}.pdf`);
};

// backward-compat aliases
export const exportAllCSV = exportReportCSV;
export const exportAllPDF = exportReportPDF;
export const exportModuleCSV = (_name: string, data: FlatData[]) => exportReportCSV([], data);
export const exportModulePDF = (_name: string, data: FlatData[]) => exportReportPDF([], data);

// ─────────────────────────────────────────────────────────────
// 3. TEST EXECUTION EXPORTS
// ─────────────────────────────────────────────────────────────
export const exportExecutionCSV = (moduleName: string, testName: string, data: FlatData[]) => {
  const headers = "#,Action,Expected Result,Remarks,Status\n";
  const rows = data.map(d =>
    [d.serial, `"${d.action.replace(/"/g,'""')}"`, `"${d.expected.replace(/"/g,'""')}"`,
     `"${d.remarks.replace(/"/g,'""')}"`, d.status].join(",")
  ).join("\n");
  download(new Blob(["\uFEFF" + headers + rows], { type: "text/csv" }),
    `${moduleName}_${testName}_${today()}.csv`);
};

export const exportExecutionPDF = (moduleName: string, testName: string, data: FlatData[]) => {
  const doc = new jsPDF({ orientation: "landscape" });
  drawHeader(doc, `Test: ${testName}`, `Module: ${moduleName}`);

  const pass    = data.filter(d => d.status === "pass").length;
  const fail    = data.filter(d => d.status === "fail").length;
  const pending = data.filter(d => d.status === "pending").length;
  const afterStats = drawStatsBar(doc, data.length, pass, fail, pending, 34);

  autoTable(doc, {
    ...tableDefaults(doc, afterStats + 2),
    head: [["#", "Action", "Expected Result", "Remarks", "Status"]],
    body: data.map(d => [d.serial, d.action, d.expected, d.remarks, d.status]),
    columnStyles: {
      0: { cellWidth: 14, halign: "center" },
      1: { cellWidth: 82 },
      2: { cellWidth: 82 },
      3: { cellWidth: 62 },
      4: { cellWidth: 28, halign: "left" },
    },
    didDrawCell: (h) => {
      if (h.column.index === 4) applyStatusCell(doc, h, data[h.row.index]?.status ?? "");
    },
  });

  drawFooter(doc);
  doc.save(`${moduleName}_${testName}_${today()}.pdf`);
};

// ── Helpers ───────────────────────────────────────────────────
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
      body { font-family: Calibri, Arial, sans-serif; margin: 20px; }
      h1 { color: #1e3a8a; border-bottom: 2px solid #3b82f6; padding-bottom: 6px; }
      table { border-collapse: collapse; width: 100%; }
      th { background: #3b82f6; color: white; padding: 8px 10px; text-align: left; }
      td { padding: 8px 10px; border: 1px solid #d1d5db; }
      tr:nth-child(even) td { background: #f9fafb; }
    </style>
  </head>
  <body>
    <h1>📊 TestPro — ${title}</h1>
    <p style="color:#64748b">Generated: ${new Date().toLocaleString()}</p>
    ${body}
  </body></html>`;

const downloadDocx = (html: string, filename: string) =>
  download(new Blob(["\uFEFF", html], { type: "application/msword" }), filename);