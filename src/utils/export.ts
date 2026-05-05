import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ─── Imported cache types — never fetch inside this file ──────────────────────
import type {
  DashboardModuleSummary,   // Dashboard
  ModuleData,               // Module Dashboard
  TrimmedStepResult,        // Module Dashboard (step detail, lazy)
  RawStepResult,            // Test Execution
  SessionHistoryEntry,      // Test Report
} from "src/lib/hooks.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Internal palette
// ─────────────────────────────────────────────────────────────────────────────

const DARK    = [20,  20,  20]  as [number, number, number];
const MID     = [70,  70,  70]  as [number, number, number];
const MUTED   = [130, 130, 130] as [number, number, number];
const FAINT   = [200, 200, 200] as [number, number, number];

const GREENINK = [16,  100, 45]  as [number, number, number];
const REDINK   = [160, 22,  22]  as [number, number, number];
const PENDINK  = [60,  60,  60]  as [number, number, number];

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

const statusColor = (s: string): [number, number, number] =>
  s === "pass" ? GREENINK : s === "fail" ? REDINK : PENDINK;

const statusLabel = (s: string) =>
  s === "pass" ? "PASS" : s === "fail" ? "FAIL" : "PENDING";

const rateColor = (rate: number, total: number): [number, number, number] =>
  rate === 100 ? GREENINK : rate === 0 && total > 0 ? REDINK : DARK;

const pad2  = (n: number) => String(n).padStart(2, "0");
const today = new Date().toISOString().split("T")[0];

const download = (blob: Blob, filename: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
};

const openPrintPreview = (doc: jsPDF, filename: string) => {
  const pdfData = doc.output("datauristring");
  const html = `<!DOCTYPE html>
<html><head>
  <title>${filename.replace(/</g, "&lt;")}</title>
  <meta charset="utf-8" />
  <style>body,html{margin:0;padding:0;height:100%;overflow:hidden}</style>
</head>
<body>
  <iframe src="${pdfData}" width="100%" height="100%" style="border:none"></iframe>
</body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, "_blank");
  if (!win) {
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared PDF primitives
// ─────────────────────────────────────────────────────────────────────────────

const drawHeader = (doc: jsPDF, title: string, subtitle?: string): number => {
  const W = doc.internal.pageSize.getWidth();
  doc.setDrawColor(...DARK); doc.setLineWidth(0.8);
  doc.line(14, 5, W - 14, 5);

  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...DARK);
  doc.text((title || "Report").trim(), W / 2, 15, { align: "center" });

  let y = 20;
  if (subtitle?.trim()) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...MID);
    doc.text(subtitle.trim(), W / 2, 22, { align: "center" });
    y = 27;
  }
  doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(...MUTED);
  doc.text(`Generated: ${new Date().toLocaleString()}`, W - 14, y - 1, { align: "right" });
  doc.setDrawColor(...FAINT); doc.setLineWidth(0.25);
  doc.line(14, y + 2, W - 14, y + 2);
  return y + 7;
};

const drawStatsText = (
  doc:     jsPDF,
  total:   number,
  pass:    number,
  fail:    number,
  pending: number,
  startY:  number,
  extra?:  { label: string; value: string | number }[]
): number => {
  const W = doc.internal.pageSize.getWidth();
  const rate = total > 0 ? Math.round((pass / total) * 100) : 0;
  let cx = 14;
  const cy = startY + 4;

  const segments: { label: string; value: string; valueColor: [number,number,number] }[] = [
    { label: "Total:",    value: String(total),   valueColor: DARK      },
    { label: "Pass:",     value: String(pass),    valueColor: GREENINK  },
    { label: "Fail:",     value: String(fail),    valueColor: REDINK    },
    { label: "Pending:",  value: String(pending), valueColor: PENDINK   },
    { label: "Pass Rate:", value: `${rate}%`,     valueColor: rateColor(rate, total) },
    ...(extra ?? []).map(e => ({ label: `${e.label}:`, value: String(e.value), valueColor: DARK as [number,number,number] })),
  ];

  doc.setFontSize(8);
  segments.forEach((seg, i) => {
    doc.setFont("helvetica", "normal"); doc.setTextColor(...MUTED);
    doc.text(seg.label, cx, cy);
    cx += doc.getTextWidth(seg.label) + 1.5;
    doc.setFont("helvetica", "bold"); doc.setTextColor(...seg.valueColor);
    doc.text(seg.value, cx, cy);
    cx += doc.getTextWidth(seg.value) + (i < segments.length - 1 ? 6 : 0);
  });
  doc.setDrawColor(...FAINT); doc.setLineWidth(0.2);
  doc.line(14, cy + 3, W - 14, cy + 3);
  return cy + 9;
};

const drawFooter = (doc: jsPDF) => {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const pages = (doc.internal as any).getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...FAINT); doc.setLineWidth(0.25);
    doc.line(14, H - 12, W - 14, H - 12);
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(...MUTED);
    doc.text("Confidential QA Report", 14, H - 6);
    doc.text(`Page ${i} of ${pages}`, W - 14, H - 6, { align: "right" });
  }
};

const baseTableStyles = () => ({
  styles: {
    fontSize: 8,
    cellPadding: { top: 3.5, bottom: 3.5, left: 5, right: 5 },
    textColor: DARK, lineColor: DARK, lineWidth: 0.3,
    fontStyle: "normal" as const,
  } as any,
  headStyles: {
    fillColor: false as any, textColor: DARK, fontStyle: "bold" as const,
    lineColor: DARK, lineWidth: 0.3, fontSize: 10,
    halign: "center" as const,
    cellPadding: { top: 6, bottom: 6, left: 5, right: 5 },
    overflow: "hidden" as const,
  },
  alternateRowStyles: { fillColor: false as any },
  margin: { top: 34, bottom: 18 },
});

const moduleBannerRow = (content: string, colSpan: number) => [{
  content, colSpan,
  styles: {
    textColor: DARK, fontStyle: "bold" as const, fontSize: 9.5,
    halign: "left" as const,
    lineColor: DARK as [number, number, number], lineWidth: 0.5,
    cellPadding: { top: 6, bottom: 6, left: 5, right: 5 },
  },
}];

// ─────────────────────────────────────────────────────────────────────────────
// DOCX helper
// ─────────────────────────────────────────────────────────────────────────────

const docxWrapper = (title: string, body: string) => `
<html xmlns:o='urn:schemas-microsoft-com:office:office'
      xmlns:w='urn:schemas-microsoft-com:office:word'
      xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><style>
  body{font-family:Calibri,Arial,sans-serif;margin:24px}
  h1{border-bottom:1px solid #333;padding-bottom:8px;font-size:18px}
  p{font-size:11px;margin:4px 0 14px}
  th{background:#141414;color:#fff;font-weight:bold;padding:8px 10px;font-size:11px;border:1px solid #141414}
  td{padding:7px 10px;border:1px solid #ddd;font-size:11px}
</style></head>
<body><h1>${title}</h1><p>Generated: ${new Date().toLocaleString()}</p>${body}</body>
</html>`;

const downloadDocx = (html: string, filename: string) =>
  download(new Blob([html], { type: "application/msword" }), filename);

// ═════════════════════════════════════════════════════════════════════════════
// 1.  DASHBOARD
//     Source: useDashboardSummaries() → DashboardModuleSummary[]
//     Available: name · description · test_count · pass · fail · pending · total
//     NOT available: per-test breakdown (not in dashboard cache)
// ═════════════════════════════════════════════════════════════════════════════

export const exportDashboardCSV = (summaries: DashboardModuleSummary[]): void => {
  const lines = ["#,Module,Description,Tests,Steps,Pass,Fail,Pending,Pass Rate"];
  summaries.forEach((s, i) => {
    const rate = s.total > 0 ? Math.round((s.pass / s.total) * 100) : 0;
    lines.push([
      pad2(i + 1),
      `"${s.name}"`,
      `"${s.description ?? ""}"`,
      s.test_count,
      s.total,
      s.pass,
      s.fail,
      s.pending,
      `${rate}%`,
    ].join(","));
  });
  download(
    new Blob([lines.join("\n")], { type: "text/csv" }),
    `TestPro-Fleet-${today}.csv`
  );
};

export const exportDashboardPDF = (summaries: DashboardModuleSummary[]): void => {
  const doc = new jsPDF({ orientation: "landscape" });

  const total   = summaries.reduce((a, s) => a + s.total,   0);
  const pass    = summaries.reduce((a, s) => a + s.pass,    0);
  const fail    = summaries.reduce((a, s) => a + s.fail,    0);
  const pending = summaries.reduce((a, s) => a + s.pending, 0);
  const tests   = summaries.reduce((a, s) => a + s.test_count, 0);

  let y = drawHeader(doc, "Fleet Report", `${summaries.length} Modules`);
  y = drawStatsText(doc, total, pass, fail, pending, y, [
    { label: "Modules",     value: summaries.length },
    { label: "Total Tests", value: tests },
  ]);

  const body: any[] = summaries.map((s, i) => {
    const rate = s.total > 0 ? Math.round((s.pass / s.total) * 100) : 0;
    const tc   = rateColor(rate, s.total);
    return [
      { content: pad2(i + 1), styles: { halign: "center" as const, textColor: DARK } },
      { content: s.name,             styles: { textColor: DARK } },
      { content: s.description ?? "—", styles: { textColor: DARK } },
      { content: String(s.test_count), styles: { textColor: DARK, halign: "center" as const } },
      { content: String(s.total),    styles: { textColor: DARK,    halign: "center" as const } },
      { content: String(s.pass),     styles: { textColor: GREENINK, halign: "center" as const } },
      { content: String(s.fail),     styles: { textColor: REDINK,   halign: "center" as const } },
      { content: String(s.pending),  styles: { textColor: PENDINK,  halign: "center" as const } },
      { content: `${rate}%`,         styles: { textColor: tc,       halign: "center" as const, fontStyle: "bold" as const } },
    ];
  });

  // Fleet total footer row
  const fleetRate = total > 0 ? Math.round((pass / total) * 100) : 0;
  const ftCell = (content: string, tc: [number,number,number] = DARK) => ({
    content,
    styles: { textColor: tc, fontStyle: "bold" as const, fontSize: 10, halign: "center" as const, lineColor: DARK as [number,number,number], lineWidth: 0.5 },
  });
  body.push([
    ftCell(""),
    ftCell("FLEET TOTAL"),
    ftCell(`${summaries.length} modules`),
    ftCell(`${tests} tests`),
    ftCell(String(total)),
    ftCell(String(pass),    GREENINK),
    ftCell(String(fail),    REDINK),
    ftCell(String(pending), PENDINK),
    ftCell(`${fleetRate}%`, rateColor(fleetRate, total)),
  ]);

  autoTable(doc, {
    ...baseTableStyles(),
    startY: y,
    margin: { top: 34, left: 14, right: 14, bottom: 18 },
    head: [["#", "Module", "Description", "Tests", "Steps", "Pass", "Fail", "Pending", "Pass Rate"]],
    body,
    columnStyles: {
      0: { cellWidth: 14, halign: "center" },
      1: { cellWidth: 42 },
      2: { cellWidth: 50 },
      3: { cellWidth: 22, halign: "center" },
      4: { cellWidth: 22, halign: "center" },
      5: { cellWidth: 22, halign: "center" },
      6: { cellWidth: 22, halign: "center" },
      7: { cellWidth: 26, halign: "center" },
      8: { cellWidth: 26, halign: "center" },
    },
  });

  drawFooter(doc);
  openPrintPreview(doc, `TestPro-Fleet-${today}.pdf`);
};

export const exportDashboardDocx = (summaries: DashboardModuleSummary[]): void => {
  const total   = summaries.reduce((a, s) => a + s.total,   0);
  const pass    = summaries.reduce((a, s) => a + s.pass,    0);
  const fail    = summaries.reduce((a, s) => a + s.fail,    0);
  const pending = summaries.reduce((a, s) => a + s.pending, 0);
  const fleetRate = total > 0 ? Math.round((pass / total) * 100) : 0;

  const rows = summaries.map((s, i) => {
    const rate = s.total > 0 ? Math.round((s.pass / s.total) * 100) : 0;
    return `<tr>
      <td align="center">${pad2(i + 1)}</td>
      <td>${s.name}</td>
      <td>${s.description ?? "—"}</td>
      <td align="center">${s.test_count}</td>
      <td align="center">${s.total}</td>
      <td align="center" style="color:#10642d">${s.pass}</td>
      <td align="center" style="color:#a01616">${s.fail}</td>
      <td align="center">${s.pending}</td>
      <td align="center">${rate}%</td>
    </tr>`;
  }).join("");

  const html = docxWrapper("Fleet Report", `
    <p>
      Total: <b>${total}</b> &nbsp;|&nbsp;
      Pass: <b style="color:#10642d">${pass}</b> &nbsp;|&nbsp;
      Fail: <b style="color:#a01616">${fail}</b> &nbsp;|&nbsp;
      Pending: <b>${pending}</b> &nbsp;|&nbsp;
      Pass Rate: <b>${fleetRate}%</b>
    </p>
    <table border="1" style="border-collapse:collapse;width:100%">
      <thead><tr>
        <th>#</th><th>Module</th><th>Description</th><th>Tests</th>
        <th>Steps</th><th>Pass</th><th>Fail</th><th>Pending</th><th>Pass Rate</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`);
  downloadDocx(html, `TestPro-Fleet-${today}.doc`);
};

// ═════════════════════════════════════════════════════════════════════════════
// 2.  MODULE DASHBOARD
//     Source: useModuleData() → ModuleData
//             useModuleStepDetails() → Record<string, TrimmedStepResult[]>  (optional)
//     Available: ModuleTestRow per test (serial_no · name · pass · fail · pending · total)
//     Step detail: only if stepDetails is passed in (already loaded by export modal)
// ═════════════════════════════════════════════════════════════════════════════

export const exportModuleDashboardCSV = (
  moduleName:  string,
  data:        ModuleData,
  stepDetails?: Record<string, TrimmedStepResult[]>   // keyed by tests_serial_no
): void => {
  const lines: string[] = [];

  if (stepDetails) {
    // ── Step-level export ──────────────────────────────────────────────────────
    lines.push("Module,Test Serial,Test Name,Step Serial,Action,Expected Result,Status");
    const tests = [...data.module_tests].sort((a, b) =>
      (a.test?.serial_no ?? "").localeCompare(b.test?.serial_no ?? "", undefined, { numeric: true })
    );
    for (const mt of tests) {
      if (!mt.test) continue;
      const steps = (stepDetails[mt.test.serial_no] ?? [])
        .filter(s => s.step)
        .sort((a, b) => (a.step!.serial_no ?? 0) - (b.step!.serial_no ?? 0));
      for (const sr of steps) {
        if (sr.step!.is_divider) continue;
        lines.push([
          `"${moduleName}"`,
          mt.test.serial_no,
          `"${mt.test.name}"`,
          sr.step!.serial_no,
          `"${sr.step!.action.replace(/"/g, '""')}"`,
          `"${sr.step!.expected_result.replace(/"/g, '""')}"`,
          sr.status,
        ].join(","));
      }
    }
  } else {
    // ── Test-level summary (no step details loaded) ───────────────────────────
    lines.push("#,Serial,Test Name,Steps,Pass,Fail,Pending,Pass Rate");
    const tests = [...data.module_tests].sort((a, b) =>
      (a.test?.serial_no ?? "").localeCompare(b.test?.serial_no ?? "", undefined, { numeric: true })
    );
    tests.forEach((mt, i) => {
      const rate = mt.total > 0 ? Math.round((mt.pass / mt.total) * 100) : 0;
      lines.push([
        pad2(i + 1),
        mt.test?.serial_no ?? "—",
        `"${mt.test?.name ?? mt.tests_name}"`,
        mt.total, mt.pass, mt.fail, mt.pending,
        `${rate}%`,
      ].join(","));
    });
  }

  download(
    new Blob([lines.join("\n")], { type: "text/csv" }),
    `TestPro-${moduleName.replace(/\s+/g, "_")}-${today}.csv`
  );
};

export const exportModuleDashboardPDF = (
  moduleName:   string,
  data:         ModuleData,
  stepDetails?: Record<string, TrimmedStepResult[]>
): void => {
  const doc  = new jsPDF({ orientation: "landscape" });
  const tests = [...data.module_tests].sort((a, b) =>
    (a.test?.serial_no ?? "").localeCompare(b.test?.serial_no ?? "", undefined, { numeric: true })
  );

  const total   = tests.reduce((a, t) => a + t.total,   0);
  const pass    = tests.reduce((a, t) => a + t.pass,    0);
  const fail    = tests.reduce((a, t) => a + t.fail,    0);
  const pending = tests.reduce((a, t) => a + t.pending, 0);

  let y = drawHeader(doc, moduleName, `${tests.length} Tests`);
  y = drawStatsText(doc, total, pass, fail, pending, y);

  if (stepDetails) {
    // ── Step-level: one page per test ─────────────────────────────────────────
    let pageIndex = 0;
    for (const mt of tests) {
      if (!mt.test) continue;
      const steps = (stepDetails[mt.test.serial_no] ?? [])
        .filter(s => s.step)
        .sort((a, b) => (a.step!.serial_no ?? 0) - (b.step!.serial_no ?? 0));
      if (!steps.length) continue;

      if (pageIndex > 0) doc.addPage();
      const startY = pageIndex === 0 ? y : 20;
      pageIndex++;

      const rate    = mt.total > 0 ? Math.round((mt.pass / mt.total) * 100) : 0;
      const body: any[] = [];

      // Banner
      body.push([{
        content: `${mt.test.serial_no}. ${mt.test.name}   ·   Pass: ${mt.pass}  Fail: ${mt.fail}  Pending: ${mt.pending}  (${rate}%)`,
        colSpan: 4,
        styles: {
          textColor: DARK, fontStyle: "bold" as const, fontSize: 9.5,
          halign: "left" as const, lineColor: DARK as [number,number,number],
          lineWidth: 0.5, cellPadding: { top: 6, bottom: 6, left: 5, right: 5 },
        },
      }]);
      // Manual header
      body.push(["S/N", "ACTION", "EXPECTED RESULT", "STATUS"].map(h => ({
        content: h,
        styles: { fontStyle: "bold" as const, fontSize: 10, halign: "center" as const },
      })));

      let stepIdx = 0;
      for (const sr of steps) {
        const s = sr.step!;
        if (s.is_divider) {
          body.push([{ content: s.action, colSpan: 4, styles: { fontStyle: "italic" as const, textColor: MUTED, fontSize: 8, cellPadding: { top: 3, bottom: 3, left: 14, right: 5 } } }]);
          continue;
        }
        stepIdx++;
        const sc = statusColor(sr.status);
        body.push([
          { content: String(s.serial_no > 0 ? s.serial_no : stepIdx), styles: { halign: "center" as const, textColor: DARK } },
          { content: s.action,          styles: { textColor: DARK, fontSize: 8 } },
          { content: s.expected_result, styles: { textColor: DARK, fontSize: 8 } },
          { content: statusLabel(sr.status), styles: { halign: "center" as const, textColor: sc, fontStyle: "bold" as const } },
        ]);
      }

      autoTable(doc, {
        ...baseTableStyles(),
        startY,
        margin: { top: 20, left: 14, right: 14, bottom: 18 },
        body,
        columnStyles: {
          0: { cellWidth: 16,  halign: "center" },
          1: { cellWidth: 100 },
          2: { cellWidth: 100 },
          3: { cellWidth: 36,  halign: "center" },
        },
      });
    }
  } else {
    // ── Test-level summary ────────────────────────────────────────────────────
    const body: any[] = tests.map((mt, i) => {
      const rate = mt.total > 0 ? Math.round((mt.pass / mt.total) * 100) : 0;
      const tc   = rateColor(rate, mt.total);
      return [
        { content: pad2(i + 1), styles: { halign: "center" as const, textColor: DARK } },
        { content: mt.test?.serial_no ?? "—",        styles: { textColor: DARK } },
        { content: mt.test?.name ?? mt.tests_name,   styles: { textColor: DARK } },
        { content: String(mt.total),   styles: { textColor: DARK,    halign: "center" as const } },
        { content: String(mt.pass),    styles: { textColor: GREENINK, halign: "center" as const } },
        { content: String(mt.fail),    styles: { textColor: REDINK,   halign: "center" as const } },
        { content: String(mt.pending), styles: { textColor: PENDINK,  halign: "center" as const } },
        { content: `${rate}%`,         styles: { textColor: tc, fontStyle: "bold" as const, halign: "center" as const } },
      ];
    });

    autoTable(doc, {
      ...baseTableStyles(),
      startY: y,
      margin: { top: 34, left: 14, right: 14, bottom: 18 },
      head: [["#", "Serial", "Test Name", "Steps", "Pass", "Fail", "Pending", "Pass Rate"]],
      body,
      columnStyles: {
        0: { cellWidth: 14, halign: "center" },
        1: { cellWidth: 26 },
        2: { cellWidth: 90 },
        3: { cellWidth: 22, halign: "center" },
        4: { cellWidth: 22, halign: "center" },
        5: { cellWidth: 22, halign: "center" },
        6: { cellWidth: 26, halign: "center" },
        7: { cellWidth: 26, halign: "center" },
      },
    });
  }

  drawFooter(doc);
  const safe = moduleName.replace(/[^a-zA-Z0-9_-]/g, "_");
  openPrintPreview(doc, `TestPro-${safe}-${today}.pdf`);
};

// ═════════════════════════════════════════════════════════════════════════════
// 3.  TEST EXECUTION
//     Source: useTestExecutionStepResults() → RawStepResult[]
//     Available: serial_no · action · expected_result · is_divider ·
//                status · remarks · display_name
// ═════════════════════════════════════════════════════════════════════════════

export const exportExecutionCSV = (
  moduleName: string,
  testName:   string,
  steps:      RawStepResult[]
): void => {
  const lines = ["#,Action,Expected Result,Remarks,Status,Updated By"];
  let idx = 0;
  for (const r of steps) {
    const s = r.step;
    if (!s) continue;
    if (s.is_divider) {
      lines.push(`,"${s.action.replace(/"/g, '""')}",,,,`);
      continue;
    }
    idx++;
    lines.push([
      idx,
      `"${s.action.replace(/"/g, '""')}"`,
      `"${s.expected_result.replace(/"/g, '""')}"`,
      `"${r.remarks.replace(/"/g, '""')}"`,
      r.status,
      `"${r.display_name}"`,
    ].join(","));
  }
  download(
    new Blob([lines.join("\n")], { type: "text/csv" }),
    `${moduleName.replace(/\s+/g, "_")}-${testName.replace(/\s+/g, "_")}-${today}.csv`
  );
};

export const exportExecutionPDF = (
  moduleName: string,
  testName:   string,
  steps:      RawStepResult[]
): void => {
  const doc = new jsPDF({ orientation: "landscape" });

  const nonDiv = steps.filter(r => r.step && !r.step.is_divider);
  const pass    = nonDiv.filter(r => r.status === "pass").length;
  const fail    = nonDiv.filter(r => r.status === "fail").length;
  const pending = nonDiv.filter(r => r.status === "pending").length;

  let y = drawHeader(doc, testName?.trim() || "Unnamed Test", moduleName?.trim() || "");
  y = drawStatsText(doc, nonDiv.length, pass, fail, pending, y);

  const body: any[] = [];
  let idx = 0;
  for (const r of steps) {
    const s = r.step;
    if (!s) continue;
    if (s.is_divider) {
      body.push([{
        content: s.action.replace(/^[^a-zA-Z0-9]+/, ""),
        colSpan: 5,
        styles: {
          fontStyle: "italic" as const, textColor: MUTED, fontSize: 8,
          cellPadding: { top: 3, bottom: 3, left: 14, right: 5 },
        },
      }]);
      continue;
    }
    idx++;
    const sc = statusColor(r.status);
    body.push([
      { content: String(s.serial_no > 0 ? s.serial_no : idx), styles: { halign: "center" as const, textColor: DARK } },
      { content: s.action,          styles: { textColor: DARK, fontSize: 8 } },
      { content: s.expected_result, styles: { textColor: DARK, fontSize: 8 } },
      { content: r.remarks,         styles: { textColor: DARK, fontSize: 8 } },
      { content: statusLabel(r.status), styles: { halign: "center" as const, textColor: sc, fontStyle: "bold" as const } },
    ]);
  }

  autoTable(doc, {
    ...baseTableStyles(),
    startY: y,
    margin: { top: 34, left: 14, right: 14, bottom: 18 },
    head: [["S/N", "ACTION", "EXPECTED RESULT", "REMARKS", "STATUS"]],
    body,
    columnStyles: {
      0: { cellWidth: 14, halign: "center" },
      1: { cellWidth: 80 },
      2: { cellWidth: 78 },
      3: { cellWidth: 60 },
      4: { cellWidth: 36, halign: "center" },
    },
  });

  drawFooter(doc);
  const safe = `${moduleName}-${testName}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  openPrintPreview(doc, `TestPro-${safe}-${today}.pdf`);
};

// ═════════════════════════════════════════════════════════════════════════════
// 4.  TEST REPORT
//     Source: useSessionHistory() → SessionHistoryEntry[]
//     Available: module_name · test_name · tests_serial_no · status ·
//                updated_at · revision · is_divider
//     NOT available: action / expected_result (not stored in step_results)
// ═════════════════════════════════════════════════════════════════════════════

/** Group session entries by module → test, preserving update order */
type SessionGroup = {
  module_name:     string;
  tests_serial_no: string;
  test_name:       string;
  revision:        string | null;
  entries:         SessionHistoryEntry[];
  pass:    number;
  fail:    number;
  pending: number;
};

const groupSessionEntries = (entries: SessionHistoryEntry[]): SessionGroup[] => {
  const map  = new Map<string, SessionGroup>();
  const keys: string[] = [];
  for (const e of entries) {
    if (e.is_divider) continue;
    const k = `${e.module_name}\x00${e.tests_serial_no}`;
    if (!map.has(k)) {
      keys.push(k);
      map.set(k, { module_name: e.module_name, tests_serial_no: e.tests_serial_no, test_name: e.test_name, revision: e.revision, entries: [], pass: 0, fail: 0, pending: 0 });
    }
    const g = map.get(k)!;
    g.entries.push(e);
    if (e.status === "pass")    g.pass++;
    else if (e.status === "fail") g.fail++;
    else                          g.pending++;
  }
  return keys.map(k => map.get(k)!);
};

export const exportReportCSV = (entries: SessionHistoryEntry[]): void => {
  const groups = groupSessionEntries(entries);
  const lines  = ["Module,Test Serial,Test Name,Revision,Pass,Fail,Pending,Pass Rate,Last Updated"];
  groups.forEach(g => {
    const total = g.pass + g.fail + g.pending;
    const rate  = total > 0 ? Math.round((g.pass / total) * 100) : 0;
    const last  = g.entries[0]?.updated_at ?? "";
    lines.push([
      `"${g.module_name}"`,
      g.tests_serial_no,
      `"${g.test_name}"`,
      g.revision ?? "—",
      g.pass, g.fail, g.pending,
      `${rate}%`,
      last,
    ].join(","));
  });
  download(
    new Blob([lines.join("\n")], { type: "text/csv" }),
    `TestPro-Session-${today}.csv`
  );
};

export const exportReportPDF = (entries: SessionHistoryEntry[]): void => {
  const doc    = new jsPDF({ orientation: "landscape" });
  const groups = groupSessionEntries(entries);

  const totalPass    = groups.reduce((a, g) => a + g.pass,    0);
  const totalFail    = groups.reduce((a, g) => a + g.fail,    0);
  const totalPending = groups.reduce((a, g) => a + g.pending, 0);
  const totalSteps   = totalPass + totalFail + totalPending;
  const moduleCount  = new Set(groups.map(g => g.module_name)).size;

  let y = drawHeader(doc, "Session Report", "Steps updated in this session");
  y = drawStatsText(doc, totalSteps, totalPass, totalFail, totalPending, y, [
    { label: "Modules", value: moduleCount },
    { label: "Tests",   value: groups.length },
  ]);

  const body: any[] = [];
  let lastModule = "";

  for (const g of groups) {
    const total = g.pass + g.fail + g.pending;
    const rate  = total > 0 ? Math.round((g.pass / total) * 100) : 0;
    const tc    = rateColor(rate, total);

    if (g.module_name !== lastModule) {
      lastModule = g.module_name;
      body.push(moduleBannerRow(g.module_name, 7));
    }

    // Test header row
    const testLabel = `${g.tests_serial_no}. ${g.test_name}${g.revision ? `  (rev ${g.revision})` : ""}`;
    body.push([{
      content: testLabel,
      colSpan: 7,
      styles: {
        fontStyle: "bold" as const, fontSize: 8.5, textColor: DARK,
        halign: "center" as const,
        lineColor: DARK as [number,number,number], lineWidth: 0.3,
        cellPadding: { top: 4, bottom: 4, left: 5, right: 5 },
      },
    }]);

    // Step entries — no action/expected (not in cache)
    for (const e of g.entries) {
      const sc = statusColor(e.status);
      body.push([
        { content: e.module_name,     styles: { textColor: MUTED, fontSize: 7 } },
        { content: g.tests_serial_no, styles: { textColor: MUTED, fontSize: 7, halign: "center" as const } },
        { content: g.test_name,       styles: { textColor: DARK,  fontSize: 8 } },
        { content: g.revision ?? "—", styles: { textColor: MUTED, fontSize: 7, halign: "center" as const } },
        { content: String(g.pass),    styles: { textColor: GREENINK, halign: "center" as const } },
        { content: String(g.fail),    styles: { textColor: REDINK,   halign: "center" as const } },
        {
          content: statusLabel(e.status),
          styles: { halign: "center" as const, textColor: sc, fontStyle: "bold" as const, fontSize: 8 },
        },
      ]);
    }

    // Per-test summary row
    body.push([
      { content: g.module_name, styles: { textColor: MUTED, fontSize: 7 } },
      { content: g.tests_serial_no, styles: { textColor: MUTED, fontSize: 7, halign: "center" as const } },
      { content: g.test_name, styles: { textColor: DARK, fontStyle: "bold" as const, fontSize: 8 } },
      { content: g.revision ?? "—", styles: { textColor: MUTED, fontSize: 7, halign: "center" as const } },
      { content: String(g.pass),    styles: { textColor: GREENINK, fontStyle: "bold" as const, halign: "center" as const } },
      { content: String(g.fail),    styles: { textColor: REDINK,   fontStyle: "bold" as const, halign: "center" as const } },
      { content: `${rate}%`,        styles: { textColor: tc,       fontStyle: "bold" as const, halign: "center" as const } },
    ]);
  }

  autoTable(doc, {
    ...baseTableStyles(),
    startY: y,
    margin: { top: 34, left: 14, right: 14, bottom: 18 },
    head: [["Module", "Serial", "Test Name", "Revision", "Pass", "Fail", "Status"]],
    body,
    columnStyles: {
      0: { cellWidth: 50 },
      1: { cellWidth: 22, halign: "center" },
      2: { cellWidth: 80 },
      3: { cellWidth: 24, halign: "center" },
      4: { cellWidth: 20, halign: "center" },
      5: { cellWidth: 20, halign: "center" },
      6: { cellWidth: 36, halign: "center" },
    },
  });

  drawFooter(doc);
  openPrintPreview(doc, `TestPro-Session-${today}.pdf`);
};

export const exportReportDocx = (entries: SessionHistoryEntry[]): void => {
  const groups = groupSessionEntries(entries);
  const totalPass    = groups.reduce((a, g) => a + g.pass,    0);
  const totalFail    = groups.reduce((a, g) => a + g.fail,    0);
  const totalPending = groups.reduce((a, g) => a + g.pending, 0);
  const totalSteps   = totalPass + totalFail + totalPending;
  const fleetRate    = totalSteps > 0 ? Math.round((totalPass / totalSteps) * 100) : 0;

  let lastModule = "";
  const rows = groups.map(g => {
    const total = g.pass + g.fail + g.pending;
    const rate  = total > 0 ? Math.round((g.pass / total) * 100) : 0;
    const moduleHeader = g.module_name !== lastModule
      ? (lastModule = g.module_name,
         `<tr style="background:#141414;color:#fff;"><td colspan="7" style="font-size:12px;font-weight:bold;padding:8px 10px">${g.module_name}</td></tr>`)
      : "";
    return `${moduleHeader}
    <tr>
      <td>${g.module_name}</td>
      <td align="center">${g.tests_serial_no}</td>
      <td>${g.test_name}</td>
      <td align="center">${g.revision ?? "—"}</td>
      <td align="center" style="color:#10642d">${g.pass}</td>
      <td align="center" style="color:#a01616">${g.fail}</td>
      <td align="center">${rate}%</td>
    </tr>`;
  }).join("");

  const html = docxWrapper("Session Report", `
    <p>
      Total: <b>${totalSteps}</b> &nbsp;|&nbsp;
      Pass: <b style="color:#10642d">${totalPass}</b> &nbsp;|&nbsp;
      Fail: <b style="color:#a01616">${totalFail}</b> &nbsp;|&nbsp;
      Pending: <b>${totalPending}</b> &nbsp;|&nbsp;
      Pass Rate: <b>${fleetRate}%</b>
    </p>
    <table border="1" style="border-collapse:collapse;width:100%">
      <thead><tr>
        <th>Module</th><th>Serial</th><th>Test Name</th><th>Revision</th>
        <th>Pass</th><th>Fail</th><th>Pass Rate</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`);
  downloadDocx(html, `TestPro-Session-${today}.doc`);
};