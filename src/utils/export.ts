import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Module } from "../types";

// ─── Shared Types ──────────────────────────────────────────────────────────────
export interface TestSummary {
  name: string;
  total: number;
  pass: number;
  fail: number;
  pending: number;
  passRate: number;
}

export interface FlatData {
  module: string;
  test: string;
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

// ─── Color Palette ─────────────────────────────────────────────────────────────
const DARK = [20, 20, 20] as [number, number, number];
const MID = [70, 70, 70] as [number, number, number];
const MUTED = [130, 130, 130] as [number, number, number];
const FAINT = [200, 200, 200] as [number, number, number];
const WHITE = [255, 255, 255] as [number, number, number];

const HDRBG = [35, 35, 35] as [number, number, number];
const HDRTXT = [255, 255, 255] as [number, number, number];
const ROWALT = [246, 246, 246] as [number, number, number];
const DIVBG = [220, 220, 220] as [number, number, number];
const DIVTXT = [25, 25, 25] as [number, number, number];
const MODBG = [45, 45, 45] as [number, number, number];
const MODTXT = [255, 255, 255] as [number, number, number];
const TESTBG = [210, 210, 210] as [number, number, number];
const TESTTXT = [25, 25, 25] as [number, number, number];

const PASSBG = [230, 248, 236] as [number, number, number];
const FAILBG = [252, 234, 234] as [number, number, number];
const GREENINK = [16, 100, 45] as [number, number, number];
const REDINK = [160, 22, 22] as [number, number, number];
const PENDINK = [90, 90, 90] as [number, number, number];

const GREEN_ON_DARK = [144, 238, 144] as [number, number, number];
const RED_ON_DARK = [255, 160, 160] as [number, number, number];
const GREY_ON_DARK = [180, 180, 180] as [number, number, number];

// ─── Utilities ─────────────────────────────────────────────────────────────────
const statusBg = (s: string): [number, number, number] =>
  s === "pass" ? PASSBG : s === "fail" ? FAILBG : WHITE;
const statusColor = (s: string): [number, number, number] =>
  s === "pass" ? GREENINK : s === "fail" ? REDINK : PENDINK;
const statusLabel = (s: string) =>
  s === "pass" ? "PASS" : s === "fail" ? "FAIL" : "PENDING";
const rateColor = (rate: number, total: number): [number, number, number] =>
  rate === 100 ? GREENINK : rate === 0 && total > 0 ? REDINK : DARK;
const rateColorOnDark = (
  rate: number,
  total: number
): [number, number, number] =>
  rate === 100 ? GREEN_ON_DARK : rate === 0 && total > 0 ? RED_ON_DARK : HDRTXT;
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

// ─── Table Defaults ────────────────────────────────────────────────────────────
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
    fillColor: HDRBG,
    textColor: HDRTXT,
    fontStyle: "bold" as const,
    lineColor: HDRBG,
    lineWidth: 0,
    fontSize: 7.5,
    cellPadding: { top: 4.5, bottom: 4.5, left: 4, right: 4 },
  },
  alternateRowStyles: { fillColor: ROWALT },
  margin: { top: 34, left: 14, right: 14, bottom: 18 },
});

// ─── Divider Row ───────────────────────────────────────────────────────────────
const buildDividerRow = (d: FlatData, colSpan: number) => {
  const level = resolveDividerLevel(d);
  const prefix = level === 1 ? "> " : level === 2 ? "  >> " : "    >>> ";
  const label = d.action.replace(/^#{1,3}\s*/, "").toUpperCase();
  return {
    content: prefix + label,
    colSpan,
    styles: {
      fillColor: DIVBG,
      textColor: DIVTXT,
      fontStyle: "bold" as const,
      fontSize: 7.5,
      lineColor: FAINT as [number, number, number],
      lineWidth: 0.3,
      cellPadding: {
        top: level === 1 ? 4 : 3,
        bottom: level === 1 ? 4 : 3,
        left: level === 1 ? 10 : level === 2 ? 16 : 22,
        right: 4,
      },
    },
  };
};

// ─── Step Row ──────────────────────────────────────────────────────────────────
const buildStepRow = (step: FlatData) => {
  const bg = statusBg(step.status);
  const sc = statusColor(step.status);
  return [
    {
      content: String(step.serial),
      styles: {
        halign: "center" as const,
        fillColor: bg,
        textColor: DARK,
        fontStyle: "bold" as const,
        fontSize: 8.5,
      },
    },
    { content: step.action, styles: { fillColor: bg, textColor: DARK } },
    { content: step.expected, styles: { fillColor: bg, textColor: MID } },
    { content: step.remarks, styles: { fillColor: bg, textColor: MID } },
    {
      content: statusLabel(step.status),
      styles: {
        halign: "center" as const,
        fillColor: bg,
        textColor: sc,
        fontStyle: "bold" as const,
        fontSize: 7.5,
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
        lines.push(
          [
            `${pad2(i + 1)}.${pad2(ti + 1)}`,
            s.name,
            "",
            t.name,
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
  let moduleSerial = 0;

  for (const s of summaries) {
    moduleSerial++;
    const testCount = s.tests?.length ?? s.testCount ?? 0;

    body.push([
      {
        content: `${pad2(
          moduleSerial
        )}  ${s.name.toUpperCase()}   ·   ${testCount} test${
          testCount !== 1 ? "s" : ""
        }   Steps: ${s.total}   Pass: ${s.pass}   Fail: ${s.fail}   Pending: ${
          s.pending
        }   (${s.passRate}%)`,
        colSpan: 9,
        styles: {
          fillColor: MODBG,
          textColor: MODTXT,
          fontStyle: "bold" as const,
          fontSize: 8,
          lineColor: FAINT as [number, number, number],
          lineWidth: 0,
          cellPadding: { top: 5, bottom: 5, left: 8, right: 4 },
        },
      },
    ]);

    if (s.tests && s.tests.length > 0) {
      s.tests.forEach((t, ti) => {
        const tc = rateColor(t.passRate, t.total);
        body.push([
          {
            content: `${pad2(moduleSerial)}.${pad2(ti + 1)}`,
            styles: {
              textColor: MUTED,
              halign: "center" as const,
              fontSize: 7.5,
            },
          },
          { content: s.name, styles: { textColor: MUTED, fontSize: 7 } },
          {
            content: s.description ?? "—",
            styles: { textColor: MUTED, fontSize: 7 },
          },
          {
            content: t.name,
            styles: { textColor: DARK, fontStyle: "bold" as const },
          },
          {
            content: String(t.total),
            styles: { textColor: DARK, halign: "center" as const },
          },
          {
            content: String(t.pass),
            styles: {
              textColor: GREENINK,
              halign: "center" as const,
              fontStyle: "bold" as const,
            },
          },
          {
            content: String(t.fail),
            styles: {
              textColor: REDINK,
              halign: "center" as const,
              fontStyle: "bold" as const,
            },
          },
          {
            content: String(t.pending),
            styles: { textColor: PENDINK, halign: "center" as const },
          },
          {
            content: `${t.passRate}%`,
            styles: {
              textColor: tc,
              halign: "center" as const,
              fontStyle: "bold" as const,
            },
          },
        ]);
      });
    } else {
      const mc = rateColor(s.passRate, s.total);
      body.push([
        {
          content: pad2(moduleSerial),
          styles: { textColor: MUTED, halign: "center" as const },
        },
        {
          content: s.name,
          styles: { textColor: DARK, fontStyle: "bold" as const },
        },
        { content: s.description ?? "—", styles: { textColor: MUTED } },
        {
          content: "—",
          styles: { textColor: MUTED, halign: "center" as const },
        },
        {
          content: String(s.total),
          styles: { textColor: DARK, halign: "center" as const },
        },
        {
          content: String(s.pass),
          styles: {
            textColor: GREENINK,
            halign: "center" as const,
            fontStyle: "bold" as const,
          },
        },
        {
          content: String(s.fail),
          styles: {
            textColor: REDINK,
            halign: "center" as const,
            fontStyle: "bold" as const,
          },
        },
        {
          content: String(s.pending),
          styles: { textColor: PENDINK, halign: "center" as const },
        },
        {
          content: `${s.passRate}%`,
          styles: {
            textColor: mc,
            halign: "center" as const,
            fontStyle: "bold" as const,
          },
        },
      ]);
    }
  }

  const fleetRate =
    fleetTotal > 0 ? Math.round((fleetPass / fleetTotal) * 100) : 0;
  body.push([
    { content: "", styles: { fillColor: HDRBG, textColor: HDRTXT } },
    {
      content: "FLEET TOTAL",
      styles: {
        fillColor: HDRBG,
        textColor: HDRTXT,
        fontStyle: "bold" as const,
        fontSize: 8,
      },
    },
    {
      content: `${totalModules} modules`,
      styles: { fillColor: HDRBG, textColor: GREY_ON_DARK, fontSize: 7 },
    },
    {
      content: `${totalTests} tests`,
      styles: { fillColor: HDRBG, textColor: GREY_ON_DARK, fontSize: 7 },
    },
    {
      content: String(fleetTotal),
      styles: {
        fillColor: HDRBG,
        textColor: HDRTXT,
        halign: "center" as const,
        fontStyle: "bold" as const,
      },
    },
    {
      content: String(fleetPass),
      styles: {
        fillColor: HDRBG,
        textColor: GREEN_ON_DARK,
        halign: "center" as const,
        fontStyle: "bold" as const,
      },
    },
    {
      content: String(fleetFail),
      styles: {
        fillColor: HDRBG,
        textColor: RED_ON_DARK,
        halign: "center" as const,
        fontStyle: "bold" as const,
      },
    },
    {
      content: String(fleetPending),
      styles: {
        fillColor: HDRBG,
        textColor: GREY_ON_DARK,
        halign: "center" as const,
      },
    },
    {
      content: `${fleetRate}%`,
      styles: {
        fillColor: HDRBG,
        textColor: rateColorOnDark(fleetRate, fleetTotal),
        halign: "center" as const,
        fontStyle: "bold" as const,
      },
    },
  ]);

  autoTable(doc, {
    ...tableDefaults(doc, y),
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
    alternateRowStyles: { fillColor: ROWALT },
    columnStyles: {
      0: { cellWidth: 16, halign: "center" },
      1: { cellWidth: 34 },
      2: { cellWidth: 44 },
      3: { cellWidth: 58 },
      4: { cellWidth: 18, halign: "center" },
      5: { cellWidth: 18, halign: "center" },
      6: { cellWidth: 18, halign: "center" },
      7: { cellWidth: 20, halign: "center" },
      8: { cellWidth: 22, halign: "center" },
    },
  });

  drawFooter(doc);
  openPrintPreview(doc);
};

export const exportDashboardDocx = (summaries: ModuleSummary[]) => {
  const fleetTotal = summaries.reduce((a, s) => a + s.total, 0);
  const fleetPass = summaries.reduce((a, s) => a + s.pass, 0);
  const fleetFail = summaries.reduce((a, s) => a + s.fail, 0);
  const fleetPending = summaries.reduce((a, s) => a + s.pending, 0);
  const fleetRate =
    fleetTotal > 0 ? Math.round((fleetPass / fleetTotal) * 100) : 0;

  const rows: string[] = [];
  let moduleSerial = 0;
  summaries.forEach((s) => {
    moduleSerial++;
    const testCount = s.tests?.length ?? s.testCount ?? 0;
    rows.push(`<tr style="background:#232323;color:#fff">
      <td colspan="9"><b>${pad2(
        moduleSerial
      )}  ${s.name.toUpperCase()}  ·  ${testCount} tests  ·  Pass: ${
      s.pass
    }  Fail: ${s.fail}  Pending: ${s.pending}  (${s.passRate}%)</b></td>
    </tr>`);
    if (s.tests && s.tests.length > 0) {
      s.tests.forEach((t, ti) => {
        rows.push(`<tr>
          <td align="center" style="color:#6b7280">${pad2(moduleSerial)}.${pad2(
          ti + 1
        )}</td>
          <td style="color:#6b7280">${s.name}</td>
          <td style="color:#6b7280">${s.description ?? "—"}</td>
          <td><b>${t.name}</b></td>
          <td align="center">${t.total}</td>
          <td align="center" style="color:#10642d"><b>${t.pass}</b></td>
          <td align="center" style="color:#a01616"><b>${t.fail}</b></td>
          <td align="center" style="color:#5a5a5a">${t.pending}</td>
          <td align="center"><b>${t.passRate}%</b></td>
        </tr>`);
      });
    } else {
      rows.push(`<tr>
        <td align="center">${pad2(moduleSerial)}</td>
        <td><b>${s.name}</b></td><td>${s.description ?? "—"}</td><td>—</td>
        <td align="center">${s.total}</td>
        <td align="center" style="color:#10642d"><b>${s.pass}</b></td>
        <td align="center" style="color:#a01616"><b>${s.fail}</b></td>
        <td align="center" style="color:#5a5a5a">${s.pending}</td>
        <td align="center"><b>${s.passRate}%</b></td>
      </tr>`);
    }
  });
  rows.push(`<tr style="background:#232323;color:#fff">
    <td></td><td><b>FLEET TOTAL</b></td>
    <td style="color:#b4b4b4">${summaries.length} modules</td>
    <td style="color:#b4b4b4">${summaries.reduce(
      (a, s) => a + (s.tests?.length ?? s.testCount ?? 0),
      0
    )} tests</td>
    <td align="center"><b>${fleetTotal}</b></td>
    <td align="center" style="color:#90ee90"><b>${fleetPass}</b></td>
    <td align="center" style="color:#ffa0a0"><b>${fleetFail}</b></td>
    <td align="center" style="color:#b4b4b4">${fleetPending}</td>
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
      <thead><tr style="background:#232323;color:#fff">
        <th>#</th><th>Module</th><th>Description</th><th>Test Name</th>
        <th>Steps</th><th>Pass</th><th>Fail</th><th>Pending</th><th>Pass Rate</th>
      </tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>`
  );
  downloadDocx(html, `TestPro-Fleet-${today}.doc`);
};

// ═══════════════════════════════════════════════════════════════════════════════
// 2. REPORT PAGE EXPORTS
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
  const summaries = buildTestSummaries(data);
  const total = summaries.reduce((a, s) => a + s.total, 0);
  const pass = summaries.reduce((a, s) => a + s.pass, 0);
  const fail = summaries.reduce((a, s) => a + s.fail, 0);
  const pending = summaries.reduce((a, s) => a + s.pending, 0);

  let y = drawHeader(doc, "Test Report", "All Modules — Test Summary");
  y = drawStatsText(doc, total, pass, fail, pending, y, [
    { label: "Total Tests", value: summaries.length },
  ]);

  const body: any[] = [];
  let lastModule = "";
  let globalSerial = 0;

  for (const s of summaries) {
    if (s.module !== lastModule) {
      lastModule = s.module;
      body.push([
        {
          content: s.module.toUpperCase(),
          colSpan: 8,
          styles: {
            fillColor: MODBG,
            textColor: MODTXT,
            fontStyle: "bold" as const,
            fontSize: 7.5,
            lineColor: FAINT as [number, number, number],
            lineWidth: 0,
            cellPadding: { top: 3.5, bottom: 3.5, left: 8, right: 4 },
          },
        },
      ]);
    }
    globalSerial++;
    const rc = rateColor(s.passRate, s.total);
    body.push([
      {
        content: pad2(globalSerial),
        styles: {
          textColor: MUTED,
          halign: "center" as const,
          fontStyle: "bold" as const,
          fontSize: 8.5,
        },
      },
      { content: s.module, styles: { textColor: MUTED, fontSize: 7 } },
      {
        content: s.test,
        styles: { textColor: DARK, fontStyle: "bold" as const },
      },
      {
        content: String(s.total),
        styles: { textColor: DARK, halign: "center" as const },
      },
      {
        content: String(s.pass),
        styles: {
          textColor: GREENINK,
          halign: "center" as const,
          fontStyle: "bold" as const,
        },
      },
      {
        content: String(s.fail),
        styles: {
          textColor: REDINK,
          halign: "center" as const,
          fontStyle: "bold" as const,
        },
      },
      {
        content: String(s.pending),
        styles: { textColor: PENDINK, halign: "center" as const },
      },
      {
        content: `${s.passRate}%`,
        styles: {
          textColor: rc,
          halign: "center" as const,
          fontStyle: "bold" as const,
        },
      },
    ]);
  }

  autoTable(doc, {
    ...tableDefaults(doc, y),
    head: [
      [
        "#",
        "Module",
        "Test Name",
        "Steps",
        "Pass",
        "Fail",
        "Pending",
        "Pass Rate",
      ],
    ],
    body,
    alternateRowStyles: { fillColor: ROWALT },
    columnStyles: {
      0: { cellWidth: 12, halign: "center" },
      1: { cellWidth: 34 },
      2: { cellWidth: 80 },
      3: { cellWidth: 20, halign: "center" },
      4: { cellWidth: 20, halign: "center" },
      5: { cellWidth: 20, halign: "center" },
      6: { cellWidth: 22, halign: "center" },
      7: { cellWidth: 22, halign: "center" },
    },
  });

  drawFooter(doc);
  openPrintPreview(doc);
};

// ═══════════════════════════════════════════════════════════════════════════════
// 3. MODULE DETAIL EXPORTS
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

export const exportModuleDetailPDF = (data: FlatData[]) => {
  const doc = new jsPDF({ orientation: "landscape" });

  const nd = data.filter((d) => !d.isdivider);
  const pass = nd.filter((d) => d.status === "pass").length;
  const fail = nd.filter((d) => d.status === "fail").length;
  const pending = nd.filter((d) => d.status === "pending").length;

  let y = drawHeader(
    doc,
    "Module Detail Report",
    "All Modules — Full Step Results"
  );
  y = drawStatsText(doc, nd.length, pass, fail, pending, y);

  type TestBlock = { name: string; steps: FlatData[]; serial: number };
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
      mod.tests.push({ name: d.test, steps: [], serial: mod.tests.length + 1 });
    }
    mod.tests[tstIdx.get(tk)!].steps.push(d);
  }

  const body: any[] = [];
  for (const mod of mods) {
    const allSteps = mod.tests
      .flatMap((t) => t.steps)
      .filter((s) => !s.isdivider);
    const mPass = allSteps.filter((s) => s.status === "pass").length;
    const mFail = allSteps.filter((s) => s.status === "fail").length;
    const mPending = allSteps.filter((s) => s.status === "pending").length;
    const mRate =
      allSteps.length > 0 ? Math.round((mPass / allSteps.length) * 100) : 0;

    body.push([
      {
        content: `${mod.name.toUpperCase()}   ·   ${mod.tests.length} test${
          mod.tests.length !== 1 ? "s" : ""
        }   Steps: ${
          allSteps.length
        }   Pass: ${mPass}   Fail: ${mFail}   Pending: ${mPending}   (${mRate}%)`,
        colSpan: 5,
        styles: {
          fillColor: MODBG,
          textColor: MODTXT,
          fontStyle: "bold" as const,
          fontSize: 8,
          lineColor: FAINT as [number, number, number],
          lineWidth: 0,
          cellPadding: { top: 5, bottom: 5, left: 8, right: 4 },
        },
      },
    ]);

    for (const test of mod.tests) {
      const tSteps = test.steps.filter((s) => !s.isdivider);
      const tPass = tSteps.filter((s) => s.status === "pass").length;
      const tFail = tSteps.filter((s) => s.status === "fail").length;
      const tPending = tSteps.filter((s) => s.status === "pending").length;
      const tRate =
        tSteps.length > 0 ? Math.round((tPass / tSteps.length) * 100) : 0;

      body.push([
        {
          content: `  ${pad2(test.serial)}. ${
            test.name
          }   —   Pass: ${tPass}   Fail: ${tFail}   Pending: ${tPending}   (${tRate}%)`,
          colSpan: 5,
          styles: {
            fillColor: TESTBG,
            textColor: TESTTXT,
            fontStyle: "bold" as const,
            fontSize: 7.5,
            lineColor: FAINT as [number, number, number],
            lineWidth: 0.3,
            cellPadding: { top: 3.5, bottom: 3.5, left: 20, right: 6 },
          },
        },
      ]);

      for (const row of test.steps) {
        body.push(
          row.isdivider ? [buildDividerRow(row, 5)] : buildStepRow(row)
        );
      }
    }
  }

  autoTable(doc, {
    ...tableDefaults(doc, y),
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
    ...tableDefaults(doc, y),
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
  h1   { border-bottom: 1px solid #ccc; padding-bottom: 8px; font-size: 18px; color: #141414 }
  p    { color: #555; font-size: 11px; margin: 4px 0 14px }
  table{ border-collapse: collapse; width: 100% }
  th   { background: #232323; color: #fff; padding: 8px 10px; font-size: 10px; border: 1px solid #ccc }
  td   { padding: 7px 10px; border: 1px solid #ddd; font-size: 11px }
  tr:nth-child(even) td { background: #f6f6f6 }
</style></head>
<body><h1>${title}</h1><p>Generated: ${new Date().toLocaleString()}</p>${body}</body>
</html>`;

const downloadDocx = (html: string, filename: string) =>
  download(new Blob([html], { type: "application/msword" }), filename);

// ═══════════════════════════════════════════════════════════════════════════════
// CSV Parse Helper (used by import modals)
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
