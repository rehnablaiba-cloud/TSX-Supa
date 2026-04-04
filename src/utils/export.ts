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
  testCount?: number;
  total: number; pass: number; fail: number; pending: number; passRate: number;
}

// ── Palette ───────────────────────────────────────────────────
const ACCENT     = [37,  99, 235] as [number, number, number]; // blue-600
const DARK       = [15,  23,  42] as [number, number, number];
const MID        = [51,  65,  85] as [number, number, number];
const MUTED      = [100,116, 139] as [number, number, number];
const RULE       = [226,232, 240] as [number, number, number];
const WHITE      = [255,255, 255] as [number, number, number];
const ROW_ALT    = [248,250, 252] as [number, number, number];
const GREEN      = [22, 163,  74] as [number, number, number];
const RED        = [220,  38,  38] as [number, number, number];
const AMBER      = [161,  98,   7] as [number, number, number];

const PASS_BG    = [240,253, 244] as [number, number, number];
const FAIL_BG    = [254,242, 242] as [number, number, number];
const DIVIDER_BG = [255,247, 237] as [number, number, number];
const DIVIDER_TXT= [180, 83,   9] as [number, number, number];
const MODULE_BG  = [239,246, 255] as [number, number, number];
const MODULE_TXT = [29,  78, 216] as [number, number, number];
const TEST_BG    = [245,245, 255] as [number, number, number];
const TEST_TXT   = [67,  56, 202] as [number, number, number];

// ── Utilities ─────────────────────────────────────────────────
const statusColor = (s: string): [number, number, number] =>
  s === "pass" ? GREEN : s === "fail" ? RED : AMBER;

const statusLabel = (s: string) =>
  s === "pass" ? "PASS" : s === "fail" ? "FAIL" : "PENDING";

const pad2 = (n: number) => String(n).padStart(2, "0");

// ── Draw filled circle with letter icon ───────────────────────
const drawCircleIcon = (
  doc: jsPDF,
  cx: number, cy: number, r: number,
  color: [number, number, number],
  letter: string
) => {
  doc.setFillColor(...color);
  doc.circle(cx, cy, r, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(r * 1.7);
  doc.setTextColor(255, 255, 255);
  doc.text(letter, cx, cy + r * 0.52, { align: "center" });
};

// ── Shared header (no branding) ───────────────────────────────
// Returns the Y position where body content should begin
const drawHeader = (doc: jsPDF, title: string, subtitle?: string): number => {
  const W = doc.internal.pageSize.getWidth();

  // Thin top accent stripe only
  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, W, 1.5, "F");

  // Centered title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...DARK);
  doc.text(title, W / 2, 15, { align: "center" });

  let lineY = 20;

  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(subtitle, W / 2, 22, { align: "center" });
    lineY = 27;
  }

  // Generated timestamp right-aligned
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text(`Generated: ${new Date().toLocaleString()}`, W - 14, lineY - 1, { align: "right" });

  // Horizontal rule
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  doc.line(14, lineY + 2, W - 14, lineY + 2);

  return lineY + 7; // content start Y
};

// ── Shared footer ─────────────────────────────────────────────
const drawFooter = (doc: jsPDF) => {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const pages = (doc.internal as any).getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.25);
    doc.line(14, H - 12, W - 14, H - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text("Confidential QA Report", 14, H - 6);
    doc.text(`Page ${i} of ${pages}`, W - 14, H - 6, { align: "right" });
  }
};

// ── Stats cards with icon circles ────────────────────────────
interface ExtraCard {
  label: string;
  value: string;
  color: [number, number, number];
  icon: string;
}

const drawStatsBar = (
  doc: jsPDF,
  total: number, pass: number, fail: number, pending: number,
  startY: number,
  extraCards?: ExtraCard[]
): number => {
  const W = doc.internal.pageSize.getWidth();
  const usableW = W - 28;

  const cards: ExtraCard[] = [
    { label: "Total Steps", value: String(total),   color: DARK,  icon: "T" },
    { label: "Passed",      value: String(pass),    color: GREEN, icon: "P" },
    { label: "Failed",      value: String(fail),    color: RED,   icon: "F" },
    { label: "Pending",     value: String(pending), color: AMBER, icon: "N" },
    ...(extraCards ?? []),
  ];

  const cardW = (usableW - (cards.length - 1) * 3) / cards.length;
  const cardH = 22;

  cards.forEach((card, i) => {
    const x = 14 + i * (cardW + 3);
    const y = startY;

    // Card: white fill with light border (no heavy solid)
    doc.setFillColor(...WHITE);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, cardW, cardH, 2, 2, "FD");

    // Left accent stripe
    doc.setFillColor(...card.color);
    doc.roundedRect(x, y, 2.5, cardH, 1, 1, "F");

    // Icon circle (top-right corner)
    drawCircleIcon(doc, x + cardW - 8, y + 7, 4, card.color, card.icon);

    // Large value
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...card.color);
    doc.text(card.value, x + 7, y + 13);

    // Small label
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(...MUTED);
    doc.text(card.label.toUpperCase(), x + 7, y + 19);
  });

  // Pass-rate progress bar
  const rate    = total > 0 ? Math.round((pass / total) * 100) : 0;
  const barY    = startY + cardH + 4;
  const barH    = 3;

  doc.setFillColor(...ROW_ALT);
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.2);
  doc.roundedRect(14, barY, usableW, barH, 1.5, 1.5, "FD");

  if (rate > 0) {
    doc.setFillColor(...GREEN);
    doc.roundedRect(14, barY, (usableW * rate) / 100, barH, 1.5, 1.5, "F");
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...GREEN);
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

// ── Shared table defaults ─────────────────────────────────────
const tableDefaults = (doc: jsPDF, startY: number) => ({
  startY,
  styles: {
    fontSize: 8,
    cellPadding: { top: 3.5, bottom: 3.5, left: 4, right: 4 },
    textColor: DARK,
    lineColor: RULE,
    lineWidth: 0.2,
    fillColor: WHITE,
  } as any,
  headStyles: {
    fillColor: ROW_ALT,
    textColor: MUTED,
    fontStyle: "bold" as const,
    lineColor: RULE,
    lineWidth: 0.2,
    fontSize: 7,
    cellPadding: { top: 4, bottom: 4, left: 4, right: 4 },
  },
  alternateRowStyles: { fillColor: ROW_ALT },
  margin: { top: 34, left: 14, right: 14, bottom: 16 },
});

// ─────────────────────────────────────────────────────────────
// 1. DASHBOARD EXPORTS  — includes test count column
// ─────────────────────────────────────────────────────────────
export const exportDashboardCSV = (summaries: ModuleSummary[]) => {
  const headers = "#,Module,Description,Tests,Total Steps,Pass,Fail,Pending,Pass Rate (%)\n";
  const rows = summaries.map((s, i) =>
    [
      pad2(i + 1),
      `"${s.name}"`,
      `"${s.description || ""}"`,
      s.testCount ?? "",
      s.total,
      s.pass,
      s.fail,
      s.pending,
      `${s.passRate}%`,
    ].join(",")
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
    { label: "Total Tests", value: String(totalTests), color: ACCENT, icon: "#" },
  ]);

  autoTable(doc, {
    ...tableDefaults(doc, afterStats),
    head: [["#", "Module", "Description", "Tests", "Total Steps", "Pass", "Fail", "Pending", "Pass Rate"]],
    body: summaries.map((s, i) => [
      pad2(i + 1),
      s.name,
      s.description || "—",
      s.testCount ?? "—",
      s.total,
      s.pass,
      s.fail,
      s.pending,
      `${s.passRate}%`,
    ]),
    columnStyles: {
      0: { cellWidth: 10,  halign: "center", textColor: MUTED as any },
      1: { cellWidth: 36,  fontStyle: "bold" },
      2: { cellWidth: 52 },
      3: { cellWidth: 18,  halign: "center", textColor: ACCENT as any, fontStyle: "bold" },
      4: { cellWidth: 22,  halign: "center" },
      5: { cellWidth: 18,  halign: "center", textColor: GREEN as any, fontStyle: "bold" },
      6: { cellWidth: 18,  halign: "center", textColor: RED   as any, fontStyle: "bold" },
      7: { cellWidth: 18,  halign: "center", textColor: AMBER as any },
      8: { halign: "center", fontStyle: "bold" },
    },
  });

  drawFooter(doc);
  doc.save(`TestPro_Dashboard_${today()}.pdf`);
};

export const exportDashboardDocx = (summaries: ModuleSummary[]) => {
  const rows = summaries.map((s, i) => `
    <tr>
      <td align="center" style="color:#64748b">${pad2(i + 1)}</td>
      <td><b>${s.name}</b></td>
      <td>${s.description || ""}</td>
      <td align="center" style="color:#2563eb"><b>${s.testCount ?? "—"}</b></td>
      <td align="center">${s.total}</td>
      <td align="center" style="color:#16a34a"><b>${s.pass}</b></td>
      <td align="center" style="color:#dc2626"><b>${s.fail}</b></td>
      <td align="center" style="color:#d97706"><b>${s.pending}</b></td>
      <td align="center"><b>${s.passRate}%</b></td>
    </tr>`).join("");

  const html = docxWrapper("Dashboard Report — All Modules", `
    <table border="1" style="border-collapse:collapse;width:100%">
      <thead><tr style="background:#f1f5f9;color:#475569">
        <th>#</th><th>Module</th><th>Description</th><th>Tests</th>
        <th>Total Steps</th><th>Pass</th><th>Fail</th><th>Pending</th><th>Pass Rate</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`);

  downloadDocx(html, `TestPro_Dashboard_${today()}.doc`);
};

// ─────────────────────────────────────────────────────────────
// 2. REPORT PAGE EXPORTS — module › test summary (no step rows)
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
    if (!map.has(key))
      map.set(key, { module: d.module, test: d.test, total: 0, pass: 0, fail: 0, pending: 0, passRate: 0 });
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
  const headers   = "#,Module,Test,Total Steps,Pass,Fail,Pending,Pass Rate (%)\n";
  const rows      = summaries.map((s, i) =>
    [pad2(i + 1), `"${s.module}"`, `"${s.test}"`, s.total, s.pass, s.fail, s.pending, `${s.passRate}%`].join(",")
  ).join("\n");
  download(
    new Blob(["\uFEFF" + headers + rows], { type: "text/csv" }),
    `TestPro_Report_${today()}.csv`
  );
};

export const exportReportPDF = (_modules: Module[], data: FlatData[]) => {
  const doc       = new jsPDF({ orientation: "landscape" });
  const summaries = buildTestSummaries(data);

  const contentY = drawHeader(doc, "Test Report", "All Modules · Test Summary");

  const total   = summaries.reduce((a, s) => a + s.total,   0);
  const pass    = summaries.reduce((a, s) => a + s.pass,    0);
  const fail    = summaries.reduce((a, s) => a + s.fail,    0);
  const pending = summaries.reduce((a, s) => a + s.pending, 0);

  const afterStats = drawStatsBar(doc, total, pass, fail, pending, contentY, [
    { label: "Total Tests", value: String(summaries.length), color: ACCENT, icon: "#" },
  ]);

  const body: any[] = [];
  let lastModule = "";
  let globalSerial = 0;

  for (const s of summaries) {
    // Module section header
    if (s.module !== lastModule) {
      lastModule = s.module;
      body.push([{
        content: s.module.toUpperCase(),
        colSpan: 8,
        styles: {
          fillColor: MODULE_BG, textColor: MODULE_TXT,
          fontStyle: "bold" as const, fontSize: 7.5,
          cellPadding: { top: 3.5, bottom: 3.5, left: 8, right: 4 },
        },
      }]);
    }

    globalSerial++;
    const bg = s.fail > 0 ? FAIL_BG
             : s.pass === s.total && s.total > 0 ? PASS_BG
             : WHITE;

    body.push([
      { content: pad2(globalSerial),    styles: { fillColor: bg, textColor: MUTED,  halign: "center" as const, fontSize: 7 } },
      { content: s.module,              styles: { fillColor: bg, textColor: MUTED,  fontSize: 7 } },
      { content: s.test,                styles: { fillColor: bg, textColor: DARK,   fontStyle: "bold" as const } },
      { content: String(s.total),       styles: { fillColor: bg, textColor: DARK,   halign: "center" as const } },
      { content: String(s.pass),        styles: { fillColor: bg, textColor: GREEN,  halign: "center" as const, fontStyle: "bold" as const } },
      { content: String(s.fail),        styles: { fillColor: bg, textColor: RED,    halign: "center" as const, fontStyle: "bold" as const } },
      { content: String(s.pending),     styles: { fillColor: bg, textColor: AMBER,  halign: "center" as const } },
      {
        content: `${s.passRate}%`,
        styles: {
          fillColor:  bg,
          textColor:  s.passRate === 100 ? GREEN : s.passRate === 0 && s.total > 0 ? RED : DARK,
          halign:     "center" as const,
          fontStyle:  "bold"   as const,
        },
      },
    ]);
  }

  autoTable(doc, {
    ...tableDefaults(doc, afterStats),
    head: [["#", "Module", "Test Name", "Steps", "Pass", "Fail", "Pending", "Pass Rate"]],
    body,
    alternateRowStyles: { fillColor: WHITE }, // section headers control their own fill
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
  doc.save(`TestPro_Report_${today()}.pdf`);
};

// Backward-compat aliases
export const exportAllCSV    = exportReportCSV;
export const exportAllPDF    = exportReportPDF;
export const exportModuleCSV = (_name: string, data: FlatData[]) => exportReportCSV([], data);
export const exportModulePDF = (_name: string, data: FlatData[]) => exportReportPDF([], data);

// ─────────────────────────────────────────────────────────────
// 3. MODULE DETAIL EXPORTS — module › test › full step rows
//    (new export for module dashboard button)
// ─────────────────────────────────────────────────────────────
export const exportModuleDetailCSV = (data: FlatData[]) => {
  const lines: string[] = ["Module,Test,#,Action,Expected Result,Remarks,Status"];
  let lastModule = "";
  let lastTest   = "";
  let testSerial = 0;

  for (const d of data) {
    if (d.isDivider) continue;
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
  const doc = new jsPDF({ orientation: "landscape" });

  const contentY = drawHeader(doc, "Module Detail Report", "All Modules · Full Step Results");

  const nd      = data.filter(d => !d.isDivider);
  const pass    = nd.filter(d => d.status === "pass").length;
  const fail    = nd.filter(d => d.status === "fail").length;
  const pending = nd.filter(d => d.status === "pending").length;

  const afterStats = drawStatsBar(doc, nd.length, pass, fail, pending, contentY);

  // ── Group: module → test → steps ─────────────────────────────
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

  // ── Build body rows ───────────────────────────────────────────
  const body: any[] = [];

  for (const mod of modules) {
    const allSteps = mod.tests.flatMap(t => t.steps);
    const mPass    = allSteps.filter(s => s.status === "pass").length;
    const mFail    = allSteps.filter(s => s.status === "fail").length;
    const mPending = allSteps.filter(s => s.status === "pending").length;
    const mRate    = allSteps.length > 0 ? Math.round((mPass / allSteps.length) * 100) : 0;

    // Module header row
    body.push([{
      content: `${mod.name.toUpperCase()}   |   ${mod.tests.length} test${mod.tests.length !== 1 ? "s" : ""}   ${allSteps.length} steps   ${mRate}% pass rate`,
      colSpan: 5,
      styles: {
        fillColor: MODULE_BG, textColor: MODULE_TXT,
        fontStyle: "bold" as const, fontSize: 8,
        cellPadding: { top: 4.5, bottom: 4.5, left: 10, right: 6 },
      },
    }]);

    // Test sub-sections
    mod.tests.forEach((test, ti) => {
      const tPass    = test.steps.filter(s => s.status === "pass").length;
      const tFail    = test.steps.filter(s => s.status === "fail").length;
      const tPending = test.steps.filter(s => s.status === "pending").length;
      const tRate    = test.steps.length > 0 ? Math.round((tPass / test.steps.length) * 100) : 0;

      // Test sub-header row (with serial number)
      body.push([{
        content: `  ${pad2(ti + 1)}. ${test.name}   P: ${tPass}  F: ${tFail}  N: ${tPending}  |  ${tRate}% pass`,
        colSpan: 5,
        styles: {
          fillColor: TEST_BG, textColor: TEST_TXT,
          fontStyle: "bold" as const, fontSize: 7.5,
          cellPadding: { top: 3, bottom: 3, left: 18, right: 6 },
        },
      }]);

      // Step rows
      for (const step of test.steps) {
        const bg = step.status === "pass" ? PASS_BG
                 : step.status === "fail" ? FAIL_BG
                 : WHITE;
        const sc = statusColor(step.status);
        body.push([
          { content: String(step.serial),      styles: { halign: "center" as const, fillColor: bg, textColor: MUTED } },
          { content: step.action,              styles: { fillColor: bg, textColor: DARK } },
          { content: step.expected,            styles: { fillColor: bg, textColor: MID  } },
          { content: step.remarks,             styles: { fillColor: bg, textColor: MID  } },
          {
            content: statusLabel(step.status),
            styles: {
              halign:    "center" as const,
              fillColor: bg, textColor: sc,
              fontStyle: "bold" as const, fontSize: 7.5,
            },
          },
        ]);
      }
    });
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
  doc.save(`TestPro_ModuleDetail_${today()}.pdf`);
};

// ─────────────────────────────────────────────────────────────
// 4. TEST EXECUTION EXPORTS — single test, full step rows
// ─────────────────────────────────────────────────────────────
export const exportExecutionCSV = (moduleName: string, testName: string, data: FlatData[]) => {
  const headers = "#,Action,Expected Result,Remarks,Status\n";
  const rows = data.map(d => {
    if (d.isDivider) return `,"${d.action.replace(/"/g, '""')}",,,""`; // section label row
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
    `${moduleName}_${testName}_${today()}.csv`
  );
};

export const exportExecutionPDF = (moduleName: string, testName: string, data: FlatData[]) => {
  const doc = new jsPDF({ orientation: "landscape" });

  // Title = test name, subtitle = module name (no branding)
  const contentY = drawHeader(doc, testName, moduleName);

  const nd      = data.filter(d => !d.isDivider);
  const pass    = nd.filter(d => d.status === "pass").length;
  const fail    = nd.filter(d => d.status === "fail").length;
  const pending = nd.filter(d => d.status === "pending").length;

  const afterStats = drawStatsBar(doc, nd.length, pass, fail, pending, contentY);

  const body = data.map(d => {
    if (d.isDivider) return [{
      content: d.action.toUpperCase(),
      colSpan: 5,
      styles: {
        fillColor: DIVIDER_BG, textColor: DIVIDER_TXT,
        fontStyle: "bold" as const, fontSize: 7.5,
        cellPadding: { top: 3.5, bottom: 3.5, left: 10, right: 4 },
      },
    }];

    const bg = d.status === "pass" ? PASS_BG
             : d.status === "fail" ? FAIL_BG
             : WHITE;
    const sc = statusColor(d.status);

    return [
      { content: String(d.serial),      styles: { halign: "center" as const, fillColor: bg, textColor: MUTED } },
      { content: d.action,              styles: { fillColor: bg, textColor: DARK } },
      { content: d.expected,            styles: { fillColor: bg, textColor: MID  } },
      { content: d.remarks,             styles: { fillColor: bg, textColor: MID  } },
      {
        content: statusLabel(d.status),
        styles: {
          halign:    "center" as const,
          fillColor: bg, textColor: sc,
          fontStyle: "bold" as const, fontSize: 7.5,
        },
      },
    ];
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