import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Module } from "../types";

// ─── Shared Types ──────────────────────────────────────────────────────────────
export interface TestSummary {
  name: string;
  serialno?: string | null;
  total: number;
  pass: number;
  fail: number;
  pending: number;
  passRate: number;
}

export interface FlatData {
  module: string;
  test: string;
  test_serial_no?: string;
  serial: number;
  action: string;
  expected: string;
  remarks: string;
  status: string;
  isdivider?: boolean;
  dividerLevel?: number;
}

export interface ModuleSummary {
  name: string;
  description?: string;
  testCount?: number;
  total: number;
  pass: number;
  fail: number;
  pending: number;
  passRate: number;
  tests?: TestSummary[];
}

// ─── Color Palette (text/ink only — no fills) ───────────────────────────────────
const DARK = [20, 20, 20] as [number, number, number];
const MID = [70, 70, 70] as [number, number, number];
const MUTED = [130, 130, 130] as [number, number, number];
const FAINT = [200, 200, 200] as [number, number, number];
const WHITE = [255, 255, 255] as [number, number, number];

const GREENINK = [16, 100, 45] as [number, number, number];
const REDINK = [160, 22, 22] as [number, number, number];
const PENDINK = [60, 60, 60] as [number, number, number];

// ─── Utilities ─────────────────────────────────────────────────────────────────
const statusColor = (s: string): [number, number, number] =>
  s === "pass" ? GREENINK : s === "fail" ? REDINK : PENDINK;

const statusLabel = (s: string) =>
  s === "pass" ? "PASS" : s === "fail" ? "FAIL" : "PENDING";

const rateColor = (rate: number, total: number): [number, number, number] =>
  rate === 100 ? GREENINK : rate === 0 && total > 0 ? REDINK : DARK;

const pad2 = (n: number) => String(n).padStart(2, "0");
const today = new Date().toISOString().split("T")[0];

const resolveDividerLevel = (d: FlatData): number => {
  if (d.dividerLevel && d.dividerLevel >= 1 && d.dividerLevel <= 3)
    return d.dividerLevel;
  const n = parseInt(d.expected, 10);
  return !isNaN(n) && n >= 1 && n <= 3 ? n : 1;
};

const download = (blob: Blob, filename: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
};

// ← CHANGED: opens an HTML wrapper with proper <title> so the tab shows the filename
const openPrintPreview = (doc: jsPDF, filename: string) => {
  const pdfData = doc.output("datauristring");
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>${filename.replace(/</g, "&lt;")}</title>
  <meta charset="utf-8" />
  <style>body,html{margin:0;padding:0;height:100%;overflow:hidden}</style>
</head>
<body>
  <iframe src="${pdfData}" width="100%" height="100%" style="border:none"></iframe>
</body>
</html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 120000);
};

// ─── Page Header ───────────────────────────────────────────────────────────────
const drawHeader = (doc: jsPDF, title: string, subtitle?: string): number => {
  const W = doc.internal.pageSize.getWidth();

  doc.setDrawColor(...DARK);
  doc.setLineWidth(0.8);
  doc.line(14, 5, W - 14, 5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...DARK);
  doc.text((title || "Report").trim(), W / 2, 15, { align: "center" });

  let y = 20;
  if (subtitle?.trim()) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MID);
    doc.text(subtitle.trim(), W / 2, 22, { align: "center" });
    y = 27;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text(`Generated: ${new Date().toLocaleString()}`, W - 14, y - 1, {
    align: "right",
  });

  doc.setDrawColor(...FAINT);
  doc.setLineWidth(0.25);
  doc.line(14, y + 2, W - 14, y + 2);

  return y + 7;
};

// ─── Stats Text Line ───────────────────────────────────────────────────────────
const drawStatsText = (
  doc: jsPDF,
  total: number,
  pass: number,
  fail: number,
  pending: number,
  startY: number,
  extra?: { label: string; value: string | number }[]
): number => {
  const W = doc.internal.pageSize.getWidth();
  const rate = total > 0 ? Math.round((pass / total) * 100) : 0;
  let cx = 14;
  const cy = startY + 4;

  const segments: {
    label: string;
    value: string;
    valueColor: [number, number, number];
  }[] = [
    { label: "Total:", value: String(total), valueColor: DARK },
    { label: "Pass:", value: String(pass), valueColor: GREENINK },
    { label: "Fail:", value: String(fail), valueColor: REDINK },
    { label: "Pending:", value: String(pending), valueColor: PENDINK },
    {
      label: "Pass Rate:",
      value: `${rate}%`,
      valueColor: rateColor(rate, total),
    },
    ...(extra ?? []).map((e) => ({
      label: `${e.label}:`,
      value: String(e.value),
      valueColor: DARK as [number, number, number],
    })),
  ];

  doc.setFontSize(8);
  segments.forEach((seg, i) => {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(seg.label, cx, cy);
    cx += doc.getTextWidth(seg.label) + 1.5;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...seg.valueColor);
    doc.text(seg.value, cx, cy);
    cx += doc.getTextWidth(seg.value) + (i < segments.length - 1 ? 6 : 0);
  });

  doc.setDrawColor(...FAINT);
  doc.setLineWidth(0.2);
  doc.line(14, cy + 3, W - 14, cy + 3);

  return cy + 9;
};

// ─── Page Footer ───────────────────────────────────────────────────────────────
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

// ─── Base Table Styles — NO FILLS ANYWHERE ─────────────────────────────────────
const baseTableStyles = () => ({
  styles: {
    fontSize: 8,
    cellPadding: { top: 3.5, bottom: 3.5, left: 5, right: 5 },
    textColor: DARK,
    lineColor: DARK,
    lineWidth: 0.3,
    fontStyle: "normal" as const,
  } as any,
  headStyles: {
    fillColor: false as any,
    textColor: DARK,
    fontStyle: "bold" as const,
    lineColor: DARK,
    lineWidth: 0.3,
    fontSize: 10,
    halign: "center" as const,
    cellPadding: { top: 6, bottom: 6, left: 5, right: 5 },
    overflow: "hidden" as const,
  },
  alternateRowStyles: { fillColor: false as any },
  margin: { top: 34, bottom: 18 },
});

// ─── Module Banner Row — NO FILL, left aligned ─────────────────────────────────
const moduleBannerRow = (content: string, colSpan: number) => [
  {
    content,
    colSpan,
    styles: {
      textColor: DARK,
      fontStyle: "bold" as const,
      fontSize: 9.5,
      halign: "left" as const,
      lineColor: DARK as [number, number, number],
      lineWidth: 0.5,
      cellPadding: { top: 6, bottom: 6, left: 5, right: 5 },
    },
  },
];

// ─── Divider Row — NO FILL, left aligned ───────────────────────────────────────
const buildDividerRow = (d: FlatData, colSpan: number) => {
  const level = resolveDividerLevel(d);
  const label = d.action.replace(/^[^a-zA-Z0-9]+/, "");
  return {
    content: label,
    colSpan,
    styles: {
      textColor: DARK,
      fontStyle: "bold" as const,
      fontSize: 8,
      halign: "left" as const,
      lineColor: FAINT as [number, number, number],
      lineWidth: 0.3,
      cellPadding: {
        top: level === 1 ? 4 : 3,
        bottom: level === 1 ? 4 : 3,
        left: level === 1 ? 10 : level === 2 ? 22 : 34,
        right: 5,
      },
    },
  };
};

// ─── Step Row ──────────────────────────────────────────────────────────────────
const buildStepRow = (step: FlatData, fallbackIndex?: number) => {
  const sc = statusColor(step.status);
  return [
    {
      content: String(
        step.serial > 0 ? step.serial : fallbackIndex ?? step.serial
      ),
      styles: { halign: "center" as const, textColor: DARK, fontSize: 8 },
    },
    { content: step.action ?? "", styles: { textColor: DARK, fontSize: 8 } },
    { content: step.expected ?? "", styles: { textColor: DARK, fontSize: 8 } },
    { content: step.remarks ?? "", styles: { textColor: DARK, fontSize: 8 } },
    {
      content: statusLabel(step.status),
      styles: {
        halign: "center" as const,
        textColor: sc,
        fontStyle: "bold" as const,
        fontSize: 8,
      },
    },
  ];
};

// ═══════════════════════════════════════════════════════════════════════════════
// 1. DASHBOARD EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

export const exportDashboardCSV = (summaries: ModuleSummary[]) => {
  const lines = [
    "#,Module,Description,Test Name,Steps,Pass,Fail,Pending,Pass Rate",
  ];
  summaries.forEach((s, i) => {
    if (s.tests && s.tests.length > 0) {
      lines.push(
        [
          pad2(i + 1),
          s.name,
          s.description ?? "",
          `[${s.tests.length} tests]`,
          s.total,
          s.pass,
          s.fail,
          s.pending,
          `${s.passRate}%`,
        ].join(",")
      );
      s.tests.forEach((t, ti) => {
        const testLabel = t.serialno ? `${t.serialno}. ${t.name}` : t.name;
        lines.push(
          [
            `${pad2(i + 1)}.${pad2(ti + 1)}`,
            s.name,
            "",
            testLabel,
            t.total,
            t.pass,
            t.fail,
            t.pending,
            `${t.passRate}%`,
          ].join(",")
        );
      });
    } else {
      lines.push(
        [
          pad2(i + 1),
          s.name,
          s.description ?? "",
          "—",
          s.total,
          s.pass,
          s.fail,
          s.pending,
          `${s.passRate}%`,
        ].join(",")
      );
    }
  });
  download(
    new Blob([lines.join("\n")], { type: "text/csv" }),
    `TestPro-Fleet-${today}.csv`
  );
};

const DASH_COL_WIDTHS: Record<number, number> = {
  0: 16,
  1: 30,
  2: 36,
  3: 52,
  4: 22,
  5: 22,
  6: 22,
  7: 26,
  8: 26,
};
const DASH_TABLE_W = Object.values(DASH_COL_WIDTHS).reduce((a, b) => a + b, 0);
const DASH_MARGIN = Math.round((297 - DASH_TABLE_W) / 2);

export const exportDashboardPDF = (summaries: ModuleSummary[]) => {
  const doc = new jsPDF({ orientation: "landscape" });

  const fleetTotal = summaries.reduce((a, s) => a + s.total, 0);
  const fleetPass = summaries.reduce((a, s) => a + s.pass, 0);
  const fleetFail = summaries.reduce((a, s) => a + s.fail, 0);
  const fleetPending = summaries.reduce((a, s) => a + s.pending, 0);
  const totalTests = summaries.reduce(
    (a, s) => a + (s.tests?.length ?? s.testCount ?? 0),
    0
  );
  const totalModules = summaries.length;

  let y = drawHeader(
    doc,
    "Fleet Report",
    `${totalModules} Module${totalModules !== 1 ? "s" : ""}`
  );
  y = drawStatsText(doc, fleetTotal, fleetPass, fleetFail, fleetPending, y, [
    { label: "Modules", value: totalModules },
    { label: "Total Tests", value: totalTests },
  ]);

  const body: any[] = [];

  for (const s of summaries) {
    const testCount = s.tests?.length ?? s.testCount ?? 0;
    body.push(
      moduleBannerRow(
        `${s.name}   ·   ${testCount} test${
          testCount !== 1 ? "s" : ""
        }   Steps: ${s.total}   Pass: ${s.pass}   Fail: ${s.fail}   Pending: ${
          s.pending
        }   (${s.passRate}%)`,
        9
      )
    );

    if (s.tests && s.tests.length > 0) {
      const tCount = s.tests.length;
      s.tests.forEach((t, ti) => {
        const tc = rateColor(t.passRate, t.total);
        const testLabel = t.serialno ? `${t.serialno}. ${t.name}` : t.name;
        const row: any[] = [
          {
            content: pad2(ti + 1),
            styles: { textColor: DARK, halign: "center" as const },
          },
        ];
        if (ti === 0) {
          row.push(
            {
              content: s.name,
              rowSpan: tCount,
              styles: { textColor: DARK, valign: "middle" as const },
            },
            {
              content: s.description ?? "—",
              rowSpan: tCount,
              styles: { textColor: DARK, valign: "middle" as const },
            }
          );
        }
        row.push(
          { content: testLabel, styles: { textColor: DARK } },
          {
            content: String(t.total),
            styles: { textColor: DARK, halign: "center" as const },
          },
          {
            content: String(t.pass),
            styles: { textColor: GREENINK, halign: "center" as const },
          },
          {
            content: String(t.fail),
            styles: { textColor: REDINK, halign: "center" as const },
          },
          {
            content: String(t.pending),
            styles: { textColor: DARK, halign: "center" as const },
          },
          {
            content: `${t.passRate}%`,
            styles: { textColor: tc, halign: "center" as const },
          }
        );
        body.push(row);
      });
    } else {
      const mc = rateColor(s.passRate, s.total);
      body.push([
        {
          content: "—",
          styles: { textColor: DARK, halign: "center" as const },
        },
        { content: s.name, styles: { textColor: DARK } },
        { content: s.description ?? "—", styles: { textColor: DARK } },
        {
          content: "—",
          styles: { textColor: DARK, halign: "center" as const },
        },
        {
          content: String(s.total),
          styles: { textColor: DARK, halign: "center" as const },
        },
        {
          content: String(s.pass),
          styles: { textColor: GREENINK, halign: "center" as const },
        },
        {
          content: String(s.fail),
          styles: { textColor: REDINK, halign: "center" as const },
        },
        {
          content: String(s.pending),
          styles: { textColor: DARK, halign: "center" as const },
        },
        {
          content: `${s.passRate}%`,
          styles: { textColor: mc, halign: "center" as const },
        },
      ]);
    }
  }

  const fleetRate =
    fleetTotal > 0 ? Math.round((fleetPass / fleetTotal) * 100) : 0;
  const ftCell = (content: string, tc: [number, number, number] = DARK) => ({
    content,
    styles: {
      textColor: tc,
      fontStyle: "bold" as const,
      fontSize: 10,
      halign: "center" as const,
      lineColor: DARK as [number, number, number],
      lineWidth: 0.5,
    },
  });
  body.push([
    ftCell(""),
    ftCell("FLEET TOTAL"),
    ftCell(`${totalModules} modules`),
    ftCell(`${totalTests} tests`),
    ftCell(String(fleetTotal)),
    ftCell(String(fleetPass), GREENINK),
    ftCell(String(fleetFail), REDINK),
    ftCell(String(fleetPending)),
    ftCell(`${fleetRate}%`, rateColor(fleetRate, fleetTotal)),
  ]);

  autoTable(doc, {
    ...baseTableStyles(),
    startY: y,
    margin: { top: 34, left: DASH_MARGIN, right: DASH_MARGIN, bottom: 18 },
    head: [
      [
        "#",
        "Module",
        "Description",
        "Test Name",
        "Steps",
        "Pass",
        "Fail",
        "Pending",
        "Pass Rate",
      ],
    ],
    body,
    columnStyles: {
      0: { cellWidth: DASH_COL_WIDTHS[0], halign: "center" },
      1: { cellWidth: DASH_COL_WIDTHS[1] },
      2: { cellWidth: DASH_COL_WIDTHS[2] },
      3: { cellWidth: DASH_COL_WIDTHS[3] },
      4: { cellWidth: DASH_COL_WIDTHS[4], halign: "center" },
      5: { cellWidth: DASH_COL_WIDTHS[5], halign: "center" },
      6: { cellWidth: DASH_COL_WIDTHS[6], halign: "center" },
      7: { cellWidth: DASH_COL_WIDTHS[7], halign: "center" },
      8: { cellWidth: DASH_COL_WIDTHS[8], halign: "center" },
    },
  });

  drawFooter(doc);
  openPrintPreview(doc, `TestPro-Fleet-${today}.pdf`);
};

export const exportDashboardDocx = (summaries: ModuleSummary[]) => {
  const fleetTotal = summaries.reduce((a, s) => a + s.total, 0);
  const fleetPass = summaries.reduce((a, s) => a + s.pass, 0);
  const fleetFail = summaries.reduce((a, s) => a + s.fail, 0);
  const fleetPending = summaries.reduce((a, s) => a + s.pending, 0);
  const fleetRate =
    fleetTotal > 0 ? Math.round((fleetPass / fleetTotal) * 100) : 0;

  const rows: string[] = [];
  summaries.forEach((s) => {
    const testCount = s.tests?.length ?? s.testCount ?? 0;
    rows.push(`<tr style="background:#141414;color:#fff;">
      <td colspan="9" style="font-size:12px;font-weight:bold;padding:8px 10px;">
        ${s.name}  ·  ${testCount} tests  ·  Pass: ${s.pass}  Fail: ${s.fail}  Pending: ${s.pending}  (${s.passRate}%)
      </td>
    </tr>`);
    if (s.tests && s.tests.length > 0) {
      s.tests.forEach((t, ti) => {
        const testLabel = t.serialno ? `${t.serialno}. ${t.name}` : t.name;
        rows.push(`<tr>
          <td align="center">${pad2(ti + 1)}</td>
          <td>${s.name}</td><td>${s.description ?? "—"}</td>
          <td>${testLabel}</td>
          <td align="center">${t.total}</td>
          <td align="center" style="color:#10642d">${t.pass}</td>
          <td align="center" style="color:#a01616">${t.fail}</td>
          <td align="center">${t.pending}</td>
          <td align="center">${t.passRate}%</td>
        </tr>`);
      });
    } else {
      rows.push(`<tr>
        <td align="center">—</td>
        <td>${s.name}</td><td>${s.description ?? "—"}</td><td>—</td>
        <td align="center">${s.total}</td>
        <td align="center" style="color:#10642d">${s.pass}</td>
        <td align="center" style="color:#a01616">${s.fail}</td>
        <td align="center">${s.pending}</td>
        <td align="center">${s.passRate}%</td>
      </tr>`);
    }
  });
  rows.push(`<tr style="background:#141414;color:#fff;">
    <td></td><td><b>FLEET TOTAL</b></td>
    <td><b>${summaries.length} modules</b></td>
    <td><b>${summaries.reduce(
      (a, s) => a + (s.tests?.length ?? s.testCount ?? 0),
      0
    )} tests</b></td>
    <td align="center"><b>${fleetTotal}</b></td>
    <td align="center" style="color:#4ade80"><b>${fleetPass}</b></td>
    <td align="center" style="color:#f87171"><b>${fleetFail}</b></td>
    <td align="center"><b>${fleetPending}</b></td>
    <td align="center"><b>${fleetRate}%</b></td>
  </tr>`);

  const html = docxWrapper(
    "Fleet Report",
    `<p style="font-size:11px;color:#333">
      Total: <b>${fleetTotal}</b> &nbsp;|&nbsp;
      Pass: <b style="color:#10642d">${fleetPass}</b> &nbsp;|&nbsp;
      Fail: <b style="color:#a01616">${fleetFail}</b> &nbsp;|&nbsp;
      Pending: <b>${fleetPending}</b> &nbsp;|&nbsp;
      Pass Rate: <b>${fleetRate}%</b>
    </p>
    <table border="1" style="border-collapse:collapse;width:100%">
      <thead><tr style="background:#141414;">
        <th>#</th><th>Module</th><th>Description</th><th>Test Name</th>
        <th>Steps</th><th>Pass</th><th>Fail</th><th>Pending</th><th>Pass Rate</th>
      </tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>`
  );
  downloadDocx(html, `TestPro-Fleet-${today}.doc`);
};

// ═══════════════════════════════════════════════════════════════════════════════
// 2. REPORT PAGE EXPORTS  —  SESSION LOG (detailed steps, no fills)
// ═══════════════════════════════════════════════════════════════════════════════

interface TestSummaryRow {
  module: string;
  test: string;
  total: number;
  pass: number;
  fail: number;
  pending: number;
  passRate: number;
}

const buildTestSummaries = (data: FlatData[]): TestSummaryRow[] => {
  const map = new Map<string, TestSummaryRow>();
  for (const d of data) {
    if (d.isdivider) continue;
    const key = `${d.module}\x00${d.test}`;
    if (!map.has(key))
      map.set(key, {
        module: d.module,
        test: d.test,
        total: 0,
        pass: 0,
        fail: 0,
        pending: 0,
        passRate: 0,
      });
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
  const lines = ["#,Module,Test,Total Steps,Pass,Fail,Pending,Pass Rate"];
  summaries.forEach((s, i) =>
    lines.push(
      [
        pad2(i + 1),
        s.module,
        s.test,
        s.total,
        s.pass,
        s.fail,
        s.pending,
        `${s.passRate}%`,
      ].join(",")
    )
  );
  download(
    new Blob([lines.join("\n")], { type: "text/csv" }),
    `TestPro-Report-${today}.csv`
  );
};

export const exportReportPDF = (_modules: Module[], data: FlatData[]) => {
  const doc = new jsPDF({ orientation: "landscape" });

  const nd = data.filter((d) => !d.isdivider);
  const pass = nd.filter((d) => d.status === "pass").length;
  const fail = nd.filter((d) => d.status === "fail").length;
  const pending = nd.filter((d) => d.status === "pending").length;
  const moduleCount = new Set(nd.map((d) => d.module)).size;
  const testCount = new Set(nd.map((d) => d.test)).size;

  let y = drawHeader(doc, "Test Report", "Session Execution Log");
  y = drawStatsText(doc, nd.length, pass, fail, pending, y, [
    { label: "Modules", value: moduleCount },
    { label: "Tests", value: testCount },
  ]);

  const body: any[] = [];
  let lastModule = "";
  let lastTest = "";
  let stepSerial = 0;

  for (const d of data) {
    if (d.isdivider) {
      body.push([buildDividerRow(d, 5)]);
      continue;
    }

    if (d.module !== lastModule) {
      lastModule = d.module;
      body.push(moduleBannerRow(d.module, 5));
      lastTest = "";
      stepSerial = 0;
    }

    if (d.test !== lastTest) {
      lastTest = d.test;
      const testLabel = d.test_serial_no
        ? `${d.test_serial_no}. ${d.test}`
        : d.test;
      body.push([
        {
          content: testLabel,
          colSpan: 5,
          styles: {
            fontStyle: "bold" as const,
            fontSize: 9,
            textColor: DARK,
            halign: "center" as const,
            lineColor: DARK as [number, number, number],
            lineWidth: 0.3,
            cellPadding: { top: 4, bottom: 4, left: 10, right: 5 },
          },
        },
      ]);
      stepSerial = 0;
    }

    stepSerial++;
    body.push(buildStepRow(d, stepSerial));
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
  openPrintPreview(doc, `TestPro-Session-${today}.pdf`);
};

// ═══════════════════════════════════════════════════════════════════════════════
// 3. MODULE DETAIL EXPORTS  —  page break per test, banner AS TABLE ROWS
// ═══════════════════════════════════════════════════════════════════════════════

export const exportModuleDetailCSV = (data: FlatData[]) => {
  const lines = ["Module,Test,#,Action,Expected Result,Remarks,Status"];
  let lastModule = "",
    lastTest = "",
    testSerial = 0;
  for (const d of data) {
    if (d.isdivider) continue;
    if (d.module !== lastModule) {
      if (lastModule !== "") lines.push("");
      lines.push(`${d.module},,,,,,`);
      lastModule = d.module;
      lastTest = "";
      testSerial = 0;
    }
    if (d.test !== lastTest) {
      testSerial++;
      lines.push(`,${pad2(testSerial)}. ${d.test},,,,,`);
      lastTest = d.test;
    }
    lines.push(
      [
        d.module,
        d.test,
        d.serial,
        d.action.replace(/,/g, " "),
        d.expected.replace(/,/g, " "),
        d.remarks.replace(/,/g, " "),
        d.status,
      ].join(",")
    );
  }
  download(
    new Blob([lines.join("\n")], { type: "text/csv" }),
    `TestPro-ModuleDetail-${today}.csv`
  );
};

// ← CHANGED: single combined banner row {serial}. {testname}
export const exportModuleDetailPDF = (
  data: FlatData[],
  moduleName?: string
) => {
  const doc = new jsPDF({ orientation: "landscape" });

  const nd = data.filter((d) => !d.isdivider);
  const pass = nd.filter((d) => d.status === "pass").length;
  const fail = nd.filter((d) => d.status === "fail").length;
  const pending = nd.filter((d) => d.status === "pending").length;

  const title = moduleName?.trim() || "Module Detail Report";
  const subtitle = moduleName?.trim()
    ? "All Test Results"
    : "All Modules — All Test Results";

  let y = drawHeader(doc, title, subtitle);
  y = drawStatsText(doc, nd.length, pass, fail, pending, y);

  type TestBlock = {
    name: string;
    steps: FlatData[];
    serial: number;
    test_serial_no: string; // ← ADDED
  };
  type ModuleBlock = { name: string; tests: TestBlock[] };
  const mods: ModuleBlock[] = [];
  const modIdx = new Map<string, number>();
  const tstIdx = new Map<string, number>();

  for (const d of data) {
    if (!modIdx.has(d.module)) {
      modIdx.set(d.module, mods.length);
      mods.push({ name: d.module, tests: [] });
    }
    const mod = mods[modIdx.get(d.module)!];
    const tk = `${d.module}\x00${d.test}`;
    if (!tstIdx.has(tk)) {
      tstIdx.set(tk, mod.tests.length);
      mod.tests.push({
        name: d.test,
        steps: [],
        serial: mod.tests.length + 1,
        test_serial_no: d.test_serial_no ?? "", // ← CAPTURE REAL SERIAL
      });
    }
    mod.tests[tstIdx.get(tk)!].steps.push(d);
  }

  let testCount = 0;

  for (const mod of mods) {
    for (const test of mod.tests) {
      testCount++;

      if (testCount > 1) {
        doc.addPage();
      }
      const startY = testCount === 1 ? y : 20;

      const tSteps = test.steps.filter((s) => !s.isdivider);
      const tPass = tSteps.filter((s) => s.status === "pass").length;
      const tFail = tSteps.filter((s) => s.status === "fail").length;
      const tPending = tSteps.filter((s) => s.status === "pending").length;
      const tRate =
        tSteps.length > 0 ? Math.round((tPass / tSteps.length) * 100) : 0;

      // ← CHANGED: use real tests.serial_no; fall back to local index only if empty
      const realSerial = test.test_serial_no?.trim();
      const displaySerial = realSerial || pad2(test.serial);

      const bannerPrefix = mods.length > 1 ? `${mod.name} › ` : "";

      // ── Build table body: combined banner + header + steps ────────────────
      const body: any[] = [];

      // Combined serial + test name — single banner row
      body.push([
        {
          content: `${bannerPrefix}${displaySerial}. ${test.name}`,
          colSpan: 5,
          styles: {
            textColor: DARK,
            fontStyle: "bold" as const,
            fontSize: 9.5,
            halign: "left" as const,
            lineColor: DARK as [number, number, number],
            lineWidth: 0.5,
            cellPadding: { top: 6, bottom: 6, left: 5, right: 5 },
          },
        },
      ]);

      // Manual header row
      body.push([
        {
          content: "S/N",
          styles: { fontStyle: "bold", fontSize: 10, halign: "center" },
        },
        {
          content: "ACTION",
          styles: { fontStyle: "bold", fontSize: 10, halign: "center" },
        },
        {
          content: "EXPECTED RESULT",
          styles: { fontStyle: "bold", fontSize: 10, halign: "center" },
        },
        {
          content: "REMARKS",
          styles: { fontStyle: "bold", fontSize: 10, halign: "center" },
        },
        {
          content: "STATUS",
          styles: { fontStyle: "bold", fontSize: 10, halign: "center" },
        },
      ]);

      let stepIndex = 0;
      for (const row of test.steps) {
        if (!row.isdivider) stepIndex++;
        body.push(
          row.isdivider
            ? [buildDividerRow(row, 5)]
            : buildStepRow(row, stepIndex)
        );
      }

      autoTable(doc, {
        ...baseTableStyles(),
        startY: startY,
        margin: { top: 20, left: 14, right: 14, bottom: 18 },
        body,
        columnStyles: {
          0: { cellWidth: 16, halign: "center" },
          1: { cellWidth: 82 },
          2: { cellWidth: 78 },
          3: { cellWidth: 60 },
          4: { cellWidth: 30, halign: "center" },
        },
      });
    }
  }

  drawFooter(doc);
  const safeModule = (moduleName || "Module").replace(/[^a-zA-Z0-9_-]/g, "_");
  openPrintPreview(doc, `TestPro-${safeModule}-${today}.pdf`);
};
// ═══════════════════════════════════════════════════════════════════════════════
// 4. TEST EXECUTION EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

export const exportExecutionCSV = (
  modulename: string,
  testname: string,
  data: FlatData[]
) => {
  const lines = ["#,Action,Expected Result,Remarks,Status"];
  data.forEach((d) => {
    lines.push(
      d.isdivider
        ? `,,${d.action.replace(/,/g, " ")},,,`
        : [
            d.serial,
            d.action.replace(/,/g, " "),
            d.expected.replace(/,/g, " "),
            d.remarks.replace(/,/g, " "),
            d.status,
          ].join(",")
    );
  });
  download(
    new Blob([lines.join("\n")], { type: "text/csv" }),
    `${modulename}-${testname}-${today}.csv`
  );
};

export const exportExecutionPDF = (
  modulename: string,
  testname: string,
  data: FlatData[]
) => {
  const doc = new jsPDF({ orientation: "landscape" });

  const nd = data.filter((d) => !d.isdivider);
  const pass = nd.filter((d) => d.status === "pass").length;
  const fail = nd.filter((d) => d.status === "fail").length;
  const pending = nd.filter((d) => d.status === "pending").length;

  let y = drawHeader(
    doc,
    testname?.trim() || "Unnamed Test",
    modulename?.trim() || "Unknown Module"
  );
  y = drawStatsText(doc, nd.length, pass, fail, pending, y);

  const body = data.map((d) =>
    d.isdivider ? [buildDividerRow(d, 5)] : buildStepRow(d)
  );

  autoTable(doc, {
    ...baseTableStyles(),
    startY: y,
    margin: { top: 34, left: 14, right: 14, bottom: 18 },
    head: [["S.NO", "ACTION", "EXPECTED RESULT", "REMARKS", "STATUS"]],
    body,
    columnStyles: {
      0: { cellWidth: 14 },
      1: { cellWidth: 80 },
      2: { cellWidth: 78 },
      3: { cellWidth: 60 },
      4: { cellWidth: 36 },
    },
  });

  drawFooter(doc);
  const safeModule = (modulename || "Module").replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeTest = (testname || "Test").replace(/[^a-zA-Z0-9_-]/g, "_");
  openPrintPreview(doc, `TestPro-${safeModule}-${safeTest}-${today}.pdf`);
};

// ═══════════════════════════════════════════════════════════════════════════════
// Re-exports & Aliases
// ═══════════════════════════════════════════════════════════════════════════════
export const exportAllCSV = exportReportCSV;
export const exportAllPDF = exportReportPDF;
export const exportModuleCSV = (_name: string, data: FlatData[]) =>
  exportReportCSV([] as Module[], data);
export const exportModulePDF = (_name: string, data: FlatData[]) =>
  exportReportPDF([] as Module[], data);

// ═══════════════════════════════════════════════════════════════════════════════
// DOCX Helpers
// ═══════════════════════════════════════════════════════════════════════════════
const docxWrapper = (title: string, body: string) => `
<html xmlns:o='urn:schemas-microsoft-com:office:office'
      xmlns:w='urn:schemas-microsoft-com:office:word'
      xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><style>
  body { font-family: Calibri, Arial, sans-serif; margin: 24px }
  h1   { border-bottom: 1px solid var(--border-color); padding-bottom: 8px; font-size: 18px; color: var(--text-primary) }
  p    { color: var(--text-secondary); font-size: 11px; margin: 4px 0 14px }
  th   { background: var(--text-primary); color: var(--bg-surface); font-weight: bold; padding: 8px 10px; font-size: 11px; border: 1px solid var(--text-primary) }
  td   { padding: 7px 10px; border: 1px solid var(--border-color); font-size: 11px; color: var(--text-primary) }
</style></head>
<body><h1>${title}</h1><p>Generated: ${new Date().toLocaleString()}</p>${body}</body>
</html>`;

const downloadDocx = (html: string, filename: string) =>
  download(new Blob([html], { type: "application/msword" }), filename);

// ═══════════════════════════════════════════════════════════════════════════════
// CSV Parse Helper
// ═══════════════════════════════════════════════════════════════════════════════
export function parseCsvToRecords(raw: string): Record<string, string>[] {
  const lines = raw
    .trimStart()
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];

  const parseRow = (line: string): string[] => {
    const cols: string[] = [];
    let cur = "",
      inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuote = !inQuote;
        continue;
      }
      if (ch === "," && !inQuote) {
        cols.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    cols.push(cur.trim());
    return cols;
  };

  const headers: string[] = parseRow(lines[0]);
  return lines.slice(1).map((line: string) => {
    const cols: string[] = parseRow(line);
    const record: Record<string, string> = {};
    headers.forEach((h: string, i: number) => {
      record[h] = cols[i] ?? "";
    });
    return record;
  });
}
