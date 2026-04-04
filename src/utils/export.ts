import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Module } from "../types";

// ── Shared Types ──────────────────────────────────────────────
export interface FlatData {
  module: string; test: string; serial: number;
  action: string; expected: string; remarks: string; status: string;
  isDivider?: boolean;
}

export interface ModuleSummary {
  name: string; description?: string;
  testCount?: number; // ← NEW: number of tests in this module
  total: number; pass: number; fail: number; pending: number; passRate: number;
}

// ── Palette ───────────────────────────────────────────────────
const ACCENT     = [37,  99,  235] as [number,number,number];
const DARK       = [15,  23,  42]  as [number,number,number];
const MID        = [51,  65,  85]  as [number,number,number];
const MUTED      = [100, 116, 139] as [number,number,number];
const RULE       = [203, 213, 225] as [number,number,number];
const WHITE      = [255, 255, 255] as [number,number,number];
const ROW_ALT    = [248, 250, 252] as [number,number,number];
const GREEN      = [22,  163,  74] as [number,number,number];
const RED        = [220,  38,  38] as [number,number,number];
const AMBER      = [161,  98,   7] as [number,number,number];

const PASS_BG    = [240, 253, 244] as [number,number,number]; // green-50
const FAIL_BG    = [254, 242, 242] as [number,number,number]; // red-50
const DIVIDER_BG = [255, 247, 237] as [number,number,number]; // orange-50
const DIVIDER_TXT= [180,  83,   9] as [number,number,number]; // orange-800
const MODULE_BG  = [239, 246, 255] as [number,number,number]; // blue-50
const MODULE_TXT = [29,   78, 216] as [number,number,number]; // blue-700
const TEST_BG    = [245, 245, 255] as [number,number,number]; // indigo-50
const TEST_TXT   = [67,  56,  202] as [number,number,number]; // indigo-700

const statusColor = (s: string): [number,number,number] =>
  s === "pass" ? GREEN : s === "fail" ? RED : AMBER;

const statusLabel = (s: string) =>
  s === "pass" ? "PASS" : s === "fail" ? "FAIL" : "PENDING";

// ── Shared utilities ──────────────────────────────────────────
const drawHeader = (doc: jsPDF, title: string, subtitle?: string) => {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, W, 2.5, "F");
  doc.setFillColor(...ACCENT);
  doc.rect(14, 7, 2, 18, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...DARK);
  doc.text("TestPro", 20, 17);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text("QA TEST MANAGEMENT", 20, 22);
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
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text(`Generated: ${new Date().toLocaleString()}`, W - 14, 26, { align: "right" });
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.4);
  doc.line(14, 29, W - 14, 29);
};

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

const drawStatsBar = (
  doc: jsPDF,
  total: number, pass: number, fail: number, pending: number,
  startY: number,
  extraCards?: { label: string; value: string; color: [number,number,number] }[]
): number => {
  const W = doc.internal.pageSize.getWidth();
  const usableW = W - 28;
  const cards = [
    { label: "Total Steps", value: String(total),   color: DARK  },
    { label: "Passed",      value: String(pass),    color: GREEN },
    { label: "Failed",      value: String(fail),    color: RED   },
    { label: "Pending",     value: String(pending), color: AMBER },
    ...(extraCards ?? []),
  ];
  const cardW = (usableW - (cards.length - 1) * 3) / cards.length;
  const cardH = 20;

  cards.forEach((s, i) => {
    const x = 14 + i * (cardW + 3);
    doc.setDrawColor(...RULE); doc.setLineWidth(0.3);
    doc.setFillColor(...WHITE);
    doc.roundedRect(x, startY, cardW, cardH, 2, 2, "FD");
    doc.setFillColor(...s.color);
    doc.roundedRect(x, startY, cardW, 1.5, 1, 1, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.setTextColor(...s.color);
    doc.text(s.value, x + cardW / 2, startY + 11, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text(s.label.toUpperCase(), x + cardW / 2, startY + 17, { align: "center" });
  });

  const rate = total > 0 ? Math.round((pass / total) * 100) : 0;
  const barY = startY + cardH + 5;
  const barH = 2.5;
  doc.setDrawColor(...RULE); doc.setLineWidth(0.3);
  doc.setFillColor(...WHITE);
  doc.roundedRect(14, barY, usableW, barH, 1, 1, "FD");
  if (rate > 0) {
    doc.setFillColor(...GREEN);
    doc.roundedRect(14, barY, (usableW * rate) / 100, barH, 1, 1, "F");
  }
  doc.setFont("helvetica", "bold"); doc.setFontSize(7);
  doc.setTextColor(...MID);
  doc.text(`${rate}% pass rate`, W - 14, barY + 2, { align: "right" });
  return barY + barH + 6;
};

const tableDefaults = (doc: jsPDF, startY: number) => ({
  startY,
  styles: { fontSize: 8, cellPadding: 4, textColor: DARK, lineColor: RULE, lineWidth: 0.25, fillColor: WHITE } as any,
  headStyles: { fillColor: WHITE, textColor: ACCENT, fontStyle: "bold" as const, lineColor: ACCENT, lineWidth: 0.5 },
  alternateRowStyles: { fillColor: ROW_ALT },
  margin: { top: 33, left: 14, right: 14, bottom: 16 },
});

// ─────────────────────────────────────────────────────────────
// 1. DASHBOARD EXPORTS  — +testCount column
// ─────────────────────────────────────────────────────────────
export const exportDashboardCSV = (summaries: ModuleSummary[]) => {
  const headers = "Module,Description,Tests,Total Steps,Pass,Fail,Pending,Pass Rate (%)\n";
  const rows = summaries.map(s =>
    `"${s.name}","${s.description || ""}",${s.testCount ?? ""},${s.total},${s.pass},${s.fail},${s.pending},${s.passRate}`
  ).join("\n");
  download(new Blob(["\uFEFF" + headers + rows], { type: "text/csv" }),
    `TestPro_Dashboard_${today()}.csv`);
};

export const exportDashboardPDF = (summaries: ModuleSummary[]) => {
  const doc = new jsPDF({ orientation: "landscape" });
  drawHeader(doc, "Dashboard Report", "All Modules Summary");

  const total      = summaries.reduce((a, s) => a + s.total,            0);
  const pass       = summaries.reduce((a, s) => a + s.pass,             0);
  const fail       = summaries.reduce((a, s) => a + s.fail,             0);
  const pending    = summaries.reduce((a, s) => a + s.pending,          0);
  const totalTests = summaries.reduce((a, s) => a + (s.testCount ?? 0), 0);

  const afterStats = drawStatsBar(doc, total, pass, fail, pending, 34, [
    { label: "Total Tests", value: String(totalTests), color: ACCENT },
  ]);

  autoTable(doc, {
    ...tableDefaults(doc, afterStats + 2),
    head: [["Module", "Description", "Tests", "Total Steps", "Pass", "Fail", "Pending", "Pass Rate"]],
    body: summaries.map(s => [
      s.name, s.description || "—", s.testCount ?? "—",
      s.total, s.pass, s.fail, s.pending, `${s.passRate}%`,
    ]),
    columnStyles: {
      0: { cellWidth: 38, fontStyle: "bold" },
      1: { cellWidth: 55 },
      2: { halign: "center", textColor: ACCENT as any, fontStyle: "bold" },
      3: { halign: "center" },
      4: { halign: "center", textColor: GREEN as any },
      5: { halign: "center", textColor: RED   as any },
      6: { halign: "center", textColor: AMBER as any },
      7: { halign: "center", fontStyle: "bold" },
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
      <td align="center" style="color:#2563eb"><b>${s.testCount ?? ""}</b></td>
      <td align="center">${s.total}</td>
      <td align="center" style="color:#16a34a"><b>${s.pass}</b></td>
      <td align="center" style="color:#dc2626"><b>${s.fail}</b></td>
      <td align="center" style="color:#d97706"><b>${s.pending}</b></td>
      <td align="center"><b>${s.passRate}%</b></td>
    </tr>`).join("");
  const html = docxWrapper("Dashboard Report — All Modules", `
    <table border="1" style="border-collapse:collapse;width:100%">
      <thead><tr style="background:#3b82f6;color:white">
        <th>Module</th><th>Description</th><th>Tests</th><th>Total Steps</th>
        <th>Pass</th><th>Fail</th><th>Pending</th><th>Pass Rate</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`);
  downloadDocx(html, `TestPro_Dashboard_${today()}.doc`);
};

// ─────────────────────────────────────────────────────────────
// 2. REPORT PAGE EXPORTS  — summary per test, no step rows
// ─────────────────────────────────────────────────────────────
interface TestSummaryRow {
  module: string; test: string;
  total: number; pass: number; fail: number; pending: number; passRate: number;
}

const buildTestSummaries = (data: FlatData[]): TestSummaryRow[] => {
  const map = new Map<string, TestSummaryRow>();
  for (const d of data) {
    if (d.isDivider) continue;
    const key = `${d.module}|||${d.test}`;
    if (!map.has(key)) map.set(key, { module: d.module, test: d.test, total: 0, pass: 0, fail: 0, pending: 0, passRate: 0 });
    const row = map.get(key)!;
    row.total++;
    if      (d.status === "pass") row.pass++;
    else if (d.status === "fail") row.fail++;
    else                          row.pending++;
  }
  for (const row of map.values())
    row.passRate = row.total > 0 ? Math.round((row.pass / row.total) * 100) : 0;
  return Array.from(map.values());
};

export const exportReportCSV = (_modules: Module[], data: FlatData[]) => {
  const summaries = buildTestSummaries(data);
  const headers   = "Module,Test,Total Steps,Pass,Fail,Pending,Pass Rate (%)\n";
  const rows      = summaries.map(s =>
    [`"${s.module}"`, `"${s.test}"`, s.total, s.pass, s.fail, s.pending, `${s.passRate}%`].join(",")
  ).join("\n");
  download(new Blob(["\uFEFF" + headers + rows], { type: "text/csv" }),
    `TestPro_Report_${today()}.csv`);
};

export const exportReportPDF = (_modules: Module[], data: FlatData[]) => {
  const doc       = new jsPDF({ orientation: "landscape" });
  const summaries = buildTestSummaries(data);

  drawHeader(doc, "Test Report", "All Modules · Test Summary");

  const total   = summaries.reduce((a, s) => a + s.total,   0);
  const pass    = summaries.reduce((a, s) => a + s.pass,    0);
  const fail    = summaries.reduce((a, s) => a + s.fail,    0);
  const pending = summaries.reduce((a, s) => a + s.pending, 0);

  const afterStats = drawStatsBar(doc, total, pass, fail, pending, 34, [
    { label: "Total Tests", value: String(summaries.length), color: ACCENT },
  ]);

  const body: any[] = [];
  let lastModule    = "";

  for (const s of summaries) {
    if (s.module !== lastModule) {
      lastModule = s.module;
      body.push([{
        content: s.module.toUpperCase(),
        colSpan: 7,
        styles: {
          fillColor: MODULE_BG, textColor: MODULE_TXT,
          fontStyle: "bold" as const, fontSize: 8,
          cellPadding: { top: 4, bottom: 4, left: 8, right: 4 },
        },
      }]);
    }
    const bg = s.fail > 0 ? FAIL_BG : s.pass === s.total && s.total > 0 ? PASS_BG : WHITE;
    body.push([
      { content: s.module,          styles: { fillColor: bg, textColor: MUTED, fontSize: 7 } },
      { content: s.test,            styles: { fillColor: bg, textColor: DARK, fontStyle: "bold" as const } },
      { content: String(s.total),   styles: { fillColor: bg, textColor: DARK,  halign: "center" as const } },
      { content: String(s.pass),    styles: { fillColor: bg, textColor: GREEN, halign: "center" as const, fontStyle: "bold" as const } },
      { content: String(s.fail),    styles: { fillColor: bg, textColor: RED,   halign: "center" as const, fontStyle: "bold" as const } },
      { content: String(s.pending), styles: { fillColor: bg, textColor: AMBER, halign: "center" as const } },
      {
        content: `${s.passRate}%`,
        styles: {
          fillColor:  bg,
          textColor:  s.passRate === 100 ? GREEN : s.passRate === 0 && s.total > 0 ? RED : DARK,
          halign:     "center" as const,
          fontStyle:  "bold" as const,
        },
      },
    ]);
  }

  autoTable(doc, {
    startY: afterStats + 2,
    head: [["Module", "Test Name", "Total", "Pass", "Fail", "Pending", "Pass Rate"]],
    body,
    styles: { fontSize: 8, cellPadding: 4, textColor: DARK, lineColor: RULE, lineWidth: 0.25, fillColor: WHITE } as any,
    headStyles: { fillColor: WHITE, textColor: ACCENT, fontStyle: "bold", lineColor: ACCENT, lineWidth: 0.5 },
    alternateRowStyles: { fillColor: WHITE },
    columnStyles: {
      0: { cellWidth: 36 },
      1: { cellWidth: 80 },
      2: { cellWidth: 22, halign: "center" },
      3: { cellWidth: 22, halign: "center" },
      4: { cellWidth: 22, halign: "center" },
      5: { cellWidth: 22, halign: "center" },
      6: { cellWidth: 24, halign: "center" },
    },
    margin: { top: 33, left: 14, right: 14, bottom: 16 },
  });

  drawFooter(doc);
  doc.save(`TestPro_Report_${today()}.pdf`);
};

// backward-compat aliases
export const exportAllCSV    = exportReportCSV;
export const exportAllPDF    = exportReportPDF;
export const exportModuleCSV = (_name: string, data: FlatData[]) => exportReportCSV([], data);
export const exportModulePDF = (_name: string, data: FlatData[]) => exportReportPDF([], data);

// ─────────────────────────────────────────────────────────────
// 3. MODULE DETAIL EXPORTS  — module sections → test sub-sections
//    → full step rows (new export for module dashboard button)
// ─────────────────────────────────────────────────────────────
export const exportModuleDetailCSV = (data: FlatData[]) => {
  const lines: string[] = ["Module,Test,#,Action,Expected Result,Remarks,Status"];
  let lastModule = "";
  let lastTest   = "";

  for (const d of data) {
    if (d.isDivider) continue;
    if (d.module !== lastModule) {
      if (lastModule !== "") lines.push(""); // blank line between modules
      lines.push(`"=== ${d.module} ===","","","","","",""`);
      lastModule = d.module; lastTest = "";
    }
    if (d.test !== lastTest) {
      lines.push(`"","--- ${d.test} ---","","","","",""`);
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
  const doc = new jsPDF({ orientation: "landscape" });
  drawHeader(doc, "Module Detail Report", "All Modules · Full Step Results");

  const nd      = data.filter(d => !d.isDivider);
  const pass    = nd.filter(d => d.status === "pass").length;
  const fail    = nd.filter(d => d.status === "fail").length;
  const pending = nd.filter(d => d.status === "pending").length;
  const afterStats = drawStatsBar(doc, nd.length, pass, fail, pending, 34);

  // ── Group: module → test → steps ──────────────────────────
  type TestBlock   = { name: string; steps: FlatData[] };
  type ModuleBlock = { name: string; tests: TestBlock[] };

  const modules: ModuleBlock[] = [];
  const modIdx  = new Map<string, number>();
  const testIdx = new Map<string, number>();

  for (const d of nd) {
    if (!modIdx.has(d.module)) {
      modIdx.set(d.module, modules.length);
      modules.push({ name: d.module, tests: [] });
    }
    const mod  = modules[modIdx.get(d.module)!];
    const tkey = `${d.module}|||${d.test}`;
    if (!testIdx.has(tkey)) {
      testIdx.set(tkey, mod.tests.length);
      mod.tests.push({ name: d.test, steps: [] });
    }
    mod.tests[testIdx.get(tkey)!].steps.push(d);
  }

  // ── Build body ─────────────────────────────────────────────
  const body: any[] = [];

  for (const mod of modules) {
    const allSteps  = mod.tests.flatMap(t => t.steps);
    const mPass     = allSteps.filter(s => s.status === "pass").length;
    const mFail     = allSteps.filter(s => s.status === "fail").length;
    const mPending  = allSteps.filter(s => s.status === "pending").length;
    const mRate     = allSteps.length > 0 ? Math.round((mPass / allSteps.length) * 100) : 0;

    // ── Module header ──
    body.push([{
      content: `${mod.name.toUpperCase()}    \u00B7    ${mod.tests.length} test${mod.tests.length !== 1 ? "s" : ""}  \u00B7  ${allSteps.length} steps  \u00B7  ${mRate}% pass rate`,
      colSpan: 5,
      styles: {
        fillColor: MODULE_BG, textColor: MODULE_TXT,
        fontStyle: "bold" as const, fontSize: 8.5,
        cellPadding: { top: 5, bottom: 5, left: 10, right: 6 },
      },
    }]);

    for (const test of mod.tests) {
      const tPass    = test.steps.filter(s => s.status === "pass").length;
      const tFail    = test.steps.filter(s => s.status === "fail").length;
      const tPending = test.steps.filter(s => s.status === "pending").length;
      const tRate    = test.steps.length > 0 ? Math.round((tPass / test.steps.length) * 100) : 0;

      // ── Test sub-header ──
      body.push([{
        content: `  ${test.name}    \u2713 ${tPass}   \u2717 ${tFail}   \u25CB ${tPending}   \u00B7   ${tRate}% pass`,
        colSpan: 5,
        styles: {
          fillColor: TEST_BG, textColor: TEST_TXT,
          fontStyle: "bold" as const, fontSize: 7.5,
          cellPadding: { top: 3.5, bottom: 3.5, left: 18, right: 6 },
        },
      }]);

      // ── Step rows ──
      for (const step of test.steps) {
        const bg = step.status === "pass" ? PASS_BG : step.status === "fail" ? FAIL_BG : WHITE;
        const sc = statusColor(step.status);
        body.push([
          { content: String(step.serial),      styles: { halign: "center" as const, fillColor: bg, textColor: MUTED } },
          { content: step.action,              styles: { fillColor: bg, textColor: DARK } },
          { content: step.expected,            styles: { fillColor: bg, textColor: MID } },
          { content: step.remarks,             styles: { fillColor: bg, textColor: MID } },
          { content: statusLabel(step.status), styles: { halign: "right" as const, fillColor: bg, textColor: sc, fontStyle: "bold" as const, fontSize: 8 } },
        ]);
      }
    }
  }

  autoTable(doc, {
    startY: afterStats + 2,
    head: [["S.NO", "ACTION", "EXPECTED RESULT", "REMARKS", "STATUS"]],
    body,
    styles: { fontSize: 8, cellPadding: 4, textColor: DARK, lineColor: RULE, lineWidth: 0.25, fillColor: WHITE } as any,
    headStyles: { fillColor: WHITE, textColor: ACCENT, fontStyle: "bold", lineColor: ACCENT, lineWidth: 0.5, fontSize: 7.5 },
    alternateRowStyles: { fillColor: WHITE },
    columnStyles: {
      0: { cellWidth: 14 },
      1: { cellWidth: 80 },
      2: { cellWidth: 80 },
      3: { cellWidth: 62 },
      4: { cellWidth: 32 },
    },
    margin: { top: 33, left: 14, right: 14, bottom: 16 },
  });

  drawFooter(doc);
  doc.save(`TestPro_ModuleDetail_${today()}.pdf`);
};

// ─────────────────────────────────────────────────────────────
// 4. TEST EXECUTION EXPORTS  (unchanged)
// ─────────────────────────────────────────────────────────────
export const exportExecutionCSV = (moduleName: string, testName: string, data: FlatData[]) => {
  const headers = "#,Action,Expected Result,Remarks,Status\n";
  const rows = data.map(d => {
    if (d.isDivider) return `,"${d.action.replace(/"/g, '""')}",,,""`; // section label row
    return [d.serial, `"${d.action.replace(/"/g,'""')}"`, `"${d.expected.replace(/"/g,'""')}"`, `"${d.remarks.replace(/"/g,'""')}"`, d.status].join(",");
  }).join("\n");
  download(new Blob(["\uFEFF" + headers + rows], { type: "text/csv" }),
    `${moduleName}_${testName}_${today()}.csv`);
};

export const exportExecutionPDF = (moduleName: string, testName: string, data: FlatData[]) => {
  const doc = new jsPDF({ orientation: "landscape" });
  const W   = doc.internal.pageSize.getWidth();

  doc.setFillColor(...ACCENT); doc.rect(0, 0, W, 2.5, "F");
  doc.setFillColor(...ACCENT); doc.rect(14, 7, 2, 18, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...DARK);
  doc.text("TestPro", 20, 17);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...MUTED);
  doc.text("QA TEST MANAGEMENT", 20, 22);

  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(...DARK);
  doc.text(`${moduleName}  \u203A  ${testName}`, W / 2, 15, { align: "center" });

  const nd      = data.filter(d => !d.isDivider);
  const pass    = nd.filter(d => d.status === "pass").length;
  const fail    = nd.filter(d => d.status === "fail").length;
  const pending = nd.filter(d => d.status === "pending").length;

  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...MUTED);
  doc.text(`\u221A${pass}   X${fail}   O${pending}   \u00B7   Generated ${new Date().toLocaleString()}`, W / 2, 23, { align: "center" });
  doc.setDrawColor(...RULE); doc.setLineWidth(0.4); doc.line(14, 29, W - 14, 29);

  const body = data.map(d => {
    if (d.isDivider) return [{
      content: d.action.toUpperCase(), colSpan: 5,
      styles: { fillColor: DIVIDER_BG, textColor: DIVIDER_TXT, fontStyle: "bold" as const, fontSize: 7.5, cellPadding: { top: 4, bottom: 4, left: 10, right: 4 } },
    }];
    const bg = d.status === "pass" ? PASS_BG : d.status === "fail" ? FAIL_BG : WHITE;
    const sc = statusColor(d.status);
    return [
      { content: String(d.serial),      styles: { halign: "center" as const, fillColor: bg, textColor: MUTED } },
      { content: d.action,              styles: { fillColor: bg, textColor: DARK } },
      { content: d.expected,            styles: { fillColor: bg, textColor: MID } },
      { content: d.remarks,             styles: { fillColor: bg, textColor: MID } },
      { content: statusLabel(d.status), styles: { halign: "right" as const, fillColor: bg, textColor: sc, fontStyle: "bold" as const, fontSize: 8 } },
    ];
  });

  autoTable(doc, {
    startY: 34,
    head: [["S.NO", "ACTION", "EXPECTED RESULT", "REMARKS", "STATUS"]],
    body,
    styles: { fontSize: 8, cellPadding: 4, lineColor: RULE, lineWidth: 0.25, fillColor: WHITE, textColor: DARK } as any,
    headStyles: { fillColor: WHITE, textColor: ACCENT, fontStyle: "bold", lineColor: ACCENT, lineWidth: 0.5, fontSize: 7.5 },
    alternateRowStyles: { fillColor: WHITE },
    columnStyles: { 0: { cellWidth: 14 }, 1: { cellWidth: 80 }, 2: { cellWidth: 80 }, 3: { cellWidth: 62 }, 4: { cellWidth: 32 } },
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
    <h1>\uD83D\uDCCA TestPro \u2014 ${title}</h1>
    <p style="color:#64748b">Generated: ${new Date().toLocaleString()}</p>
    ${body}
  </body></html>`;

const downloadDocx = (html: string, filename: string) =>
  download(new Blob(["\uFEFF", html], { type: "application/msword" }), filename);