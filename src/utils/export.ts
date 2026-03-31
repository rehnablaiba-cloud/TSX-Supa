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

// ── Colors ────────────────────────────────────────────────────
const BLUE    = [37,  99,  235] as [number,number,number];
const GREEN   = [22,  163,  74] as [number,number,number];
const RED     = [220,  38,  38] as [number,number,number];
const AMBER   = [217, 119,   6] as [number,number,number];
const DARK    = [15,   23,  42] as [number,number,number];
const GRAY    = [100, 116, 139] as [number,number,number];
const LIGHT   = [248, 250, 252] as [number,number,number];
const WHITE   = [255, 255, 255] as [number,number,number];

// ── PDF Header ────────────────────────────────────────────────
const drawHeader = (doc: jsPDF, title: string, subtitle?: string) => {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...BLUE);
  doc.rect(0, 0, W, 28, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...WHITE);
  doc.text("TestPro", 14, 12);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("QA TEST MANAGEMENT", 14, 19);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(title, W - 14, 12, { align: "right" });
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(subtitle, W - 14, 19, { align: "right" });
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(`Generated: ${new Date().toLocaleString()}`, W - 14, 25, { align: "right" });
};

// ── PDF Footer ────────────────────────────────────────────────
const drawFooter = (doc: jsPDF) => {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const pages = (doc.internal as any).getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...GRAY);
    doc.setLineWidth(0.3);
    doc.line(14, H - 12, W - 14, H - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text("TestPro — Confidential QA Report", 14, H - 6);
    doc.text(`Page ${i} of ${pages}`, W - 14, H - 6, { align: "right" });
  }
};

// ── Stats Bar ─────────────────────────────────────────────────
const drawStatsBar = (doc: jsPDF, total: number, pass: number, fail: number, pending: number, startY: number): number => {
  const W = doc.internal.pageSize.getWidth();
  const rate = total > 0 ? Math.round((pass / total) * 100) : 0;

  doc.setFillColor(...LIGHT);
  doc.roundedRect(14, startY, W - 28, 22, 3, 3, "F");
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.roundedRect(14, startY, W - 28, 22, 3, 3, "S");

  const col = (W - 28) / 4;
  const stats = [
    { label: "TOTAL STEPS", value: String(total),   color: DARK  },
    { label: "PASSED",      value: String(pass),    color: GREEN },
    { label: "FAILED",      value: String(fail),    color: RED   },
    { label: "PENDING",     value: String(pending), color: AMBER },
  ];

  stats.forEach((s, i) => {
    const x = 14 + col * i + col / 2;
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...s.color);
    doc.text(s.value, x, startY + 11, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...GRAY);
    doc.text(s.label, x, startY + 17, { align: "center" });
  });

  const barX = 14, barY = startY + 25, barW = W - 28, barH = 4;
  doc.setFillColor(226, 232, 240);
  doc.roundedRect(barX, barY, barW, barH, 2, 2, "F");
  if (rate > 0) {
    doc.setFillColor(...GREEN);
    doc.roundedRect(barX, barY, (barW * rate) / 100, barH, 2, 2, "F");
  }
  doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...GRAY);
  doc.text(`${rate}% pass rate`, W - 14, barY + 3.5, { align: "right" });

  return startY + 33;
};

// ── Status cell badge ─────────────────────────────────────────
const statusColor = (s: string): [number,number,number] =>
  s === "pass" ? GREEN : s === "fail" ? RED : AMBER;

const applyStatusBadge = (doc: jsPDF, hookData: any, rawStatus: string) => {
  if (hookData.section !== "body") return;
  const [r, g, b] = statusColor(rawStatus);
  const { x, y, width, height } = hookData.cell;
  doc.setFillColor(r, g, b, 0.12);
  doc.roundedRect(x + 1.5, y + 1.5, width - 3, height - 3, 2, 2, "F");
  doc.setTextColor(r, g, b);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text(rawStatus.toUpperCase(), x + width / 2, y + height / 2 + 1, { align: "center" });
  hookData.cell.text = [];
};

// ─────────────────────────────────────────────────────────────
// 1. DASHBOARD EXPORTS — Module summary (name, total, pass, fail, pending)
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
  const afterStats = drawStatsBar(doc, total, pass, fail, pending, 33);

  autoTable(doc, {
    startY: afterStats + 2,
    head: [["Module", "Description", "Total", "Pass", "Fail", "Pending", "Pass Rate"]],
    body: summaries.map(s => [
      s.name, s.description || "—", s.total, s.pass, s.fail, s.pending, `${s.passRate}%`
    ]),
    styles: { fontSize: 9, cellPadding: 4, textColor: DARK, lineColor: [226,232,240], lineWidth: 0.2 },
    headStyles: { fillColor: BLUE, textColor: WHITE, fontStyle: "bold" },
    alternateRowStyles: { fillColor: LIGHT },
    columnStyles: {
      0: { cellWidth: 40, fontStyle: "bold" },
      1: { cellWidth: 60 },
      2: { halign: "center" },
      3: { halign: "center" },
      4: { halign: "center" },
      5: { halign: "center" },
      6: { halign: "center", fontStyle: "bold" },
    },
    margin: { top: 33, left: 14, right: 14, bottom: 16 },
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
// 2. REPORT PAGE EXPORTS — Per-module table with test rows
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
  const afterStats = drawStatsBar(doc, data.length, pass, fail, pending, 33);

  autoTable(doc, {
    startY: afterStats + 2,
    head: [["Module", "Test", "#", "Action", "Expected Result", "Remarks", "Status"]],
    body: data.map(d => [d.module, d.test, d.serial, d.action, d.expected, d.remarks, d.status]),
    styles: { fontSize: 7.5, cellPadding: 3.5, textColor: DARK, lineColor: [226,232,240], lineWidth: 0.2 },
    headStyles: { fillColor: BLUE, textColor: WHITE, fontStyle: "bold" },
    alternateRowStyles: { fillColor: LIGHT },
    columnStyles: {
      0: { cellWidth: 30, fontStyle: "bold" },
      1: { cellWidth: 35 },
      2: { cellWidth: 10, halign: "center" },
      3: { cellWidth: 60 },
      4: { cellWidth: 60 },
      5: { cellWidth: 45 },
      6: { cellWidth: 22, halign: "center" },
    },
    didDrawCell: (h) => {
      if (h.column.index === 6) applyStatusBadge(doc, h, data[h.row.index]?.status ?? "");
    },
    margin: { top: 33, left: 14, right: 14, bottom: 16 },
  });
  drawFooter(doc);
  doc.save(`TestPro_Report_${today()}.pdf`);
};

// backward-compat aliases used by existing code
export const exportAllCSV = exportReportCSV;
export const exportAllPDF = exportReportPDF;
export const exportModuleCSV = (name: string, data: FlatData[]) => exportReportCSV([], data);
export const exportModulePDF = (name: string, data: FlatData[]) => exportReportPDF([], data);

// ─────────────────────────────────────────────────────────────
// 3. TEST EXECUTION EXPORTS — Single test, all steps
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
  const afterStats = drawStatsBar(doc, data.length, pass, fail, pending, 33);

  autoTable(doc, {
    startY: afterStats + 2,
    head: [["#", "Action", "Expected Result", "Remarks", "Status"]],
    body: data.map(d => [d.serial, d.action, d.expected, d.remarks, d.status]),
    styles: { fontSize: 8.5, cellPadding: 4, textColor: DARK, lineColor: [226,232,240], lineWidth: 0.2 },
    headStyles: { fillColor: BLUE, textColor: WHITE, fontStyle: "bold" },
    alternateRowStyles: { fillColor: LIGHT },
    columnStyles: {
      0: { cellWidth: 14, halign: "center" },
      1: { cellWidth: 80 },
      2: { cellWidth: 80 },
      3: { cellWidth: 60 },
      4: { cellWidth: 25, halign: "center" },
    },
    didDrawCell: (h) => {
      if (h.column.index === 4) applyStatusBadge(doc, h, data[h.row.index]?.status ?? "");
    },
    margin: { top: 33, left: 14, right: 14, bottom: 16 },
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

const downloadDocx = (html: string, filename: string) => {
  download(new Blob(["\uFEFF", html], { type: "application/msword" }), filename);
};