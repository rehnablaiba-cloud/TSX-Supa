import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Module } from "../types";

// Shared Types
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
}

// Palette
const DARK = [30, 30, 30] as [number, number, number];
const MID = [80, 80, 80] as [number, number, number];
const MUTED = [130, 130, 130] as [number, number, number];
const FAINT = [190, 190, 190] as [number, number, number];
const WHITE = [255, 255, 255] as [number, number, number];

const HDRBG = [235, 235, 237] as [number, number, number];
const HDRTXT = [55, 55, 65] as [number, number, number];

const PASSBG = [232, 247, 237] as [number, number, number];
const FAILBG = [254, 235, 235] as [number, number, number];
const PENDBG = [255, 247, 237] as [number, number, number];
const ROWALT = [249, 249, 251] as [number, number, number];

const BLUEINK = [37, 99, 235] as [number, number, number];
const GREENINK = [22, 163, 74] as [number, number, number];
const REDINK = [220, 38, 38] as [number, number, number];
const AMBERINK = [217, 119, 6] as [number, number, number];

const MODBG = [241, 245, 249] as [number, number, number];
const MODTXT = [71, 85, 105] as [number, number, number];

const TESTBG = [239, 246, 255] as [number, number, number];
const TESTTXT = [30, 64, 175] as [number, number, number];

const DIV1BG = [255, 247, 237] as [number, number, number];
const DIV2BG = [239, 246, 255] as [number, number, number];
const DIV3BG = [240, 253, 244] as [number, number, number];

const ORANGEINK = [234, 88, 12] as [number, number, number];
const BLUEDIV = [37, 99, 235] as [number, number, number];
const GREENDIV = [22, 163, 74] as [number, number, number];

// Helpers
const today = new Date().toISOString().split("T")[0];

const pad2 = (n: number) => String(n).padStart(2, "0");

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

const statusBg = (status: string): [number, number, number] => {
  if (status === "pass") return PASSBG;
  if (status === "fail") return FAILBG;
  if (status === "pending") return PENDBG;
  return WHITE;
};

const statusColor = (status: string): [number, number, number] => {
  if (status === "pass") return GREENINK;
  if (status === "fail") return REDINK;
  if (status === "pending") return AMBERINK;
  return DARK;
};

const statusLabel = (status: string) => {
  if (status === "pass") return "PASS";
  if (status === "fail") return "FAIL";
  if (status === "pending") return "PENDING";
  return "";
};

const dividerStyle = (
  level: number
): { bg: [number, number, number]; txt: [number, number, number] } => {
  if (level === 2) return { bg: DIV2BG, txt: BLUEDIV };
  if (level === 3) return { bg: DIV3BG, txt: GREENDIV };
  return { bg: DIV1BG, txt: ORANGEINK };
};

const resolveDividerLevel = (d: FlatData): number => {
  if (d.dividerLevel && d.dividerLevel >= 1 && d.dividerLevel <= 3) {
    return d.dividerLevel;
  }
  const fromExpected = parseInt(d.expected, 10);
  if (!isNaN(fromExpected) && fromExpected >= 1 && fromExpected <= 3) {
    return fromExpected;
  }
  return 1;
};

type IconType = "total" | "pass" | "fail" | "pending" | "tests";

const drawLineIcon = (
  doc: jsPDF,
  cx: number,
  cy: number,
  r: number,
  color: [number, number, number],
  icon: IconType
) => {
  doc.setDrawColor(...color);
  doc.setLineWidth(0.55);

  switch (icon) {
    case "total": {
      const lx = cx - r * 0.55;
      const rx = cx + r * 0.55;
      [-0.55, 0, 0.55].forEach((oy) =>
        doc.line(lx, cy + r * oy, rx, cy + r * oy)
      );
      break;
    }
    case "pass":
      doc.line(cx - r * 0.6, cy, cx - r * 0.05, cy + r * 0.55);
      doc.line(cx - r * 0.05, cy + r * 0.55, cx + r * 0.65, cy - r * 0.55);
      break;
    case "fail":
      doc.line(cx - r * 0.55, cy - r * 0.55, cx + r * 0.55, cy + r * 0.55);
      doc.line(cx + r * 0.55, cy - r * 0.55, cx - r * 0.55, cy + r * 0.55);
      break;
    case "pending":
      doc.circle(cx, cy, r * 0.7, "S");
      doc.line(cx, cy - r * 0.45, cx, cy);
      doc.line(cx, cy, cx + r * 0.35, cy + r * 0.2);
      break;
    case "tests": {
      const g = r * 0.38;
      doc.line(cx - g, cy - r * 0.55, cx - g, cy + r * 0.55);
      doc.line(cx + g, cy - r * 0.55, cx + g, cy + r * 0.55);
      doc.line(cx - r * 0.55, cy - g, cx + r * 0.55, cy - g);
      doc.line(cx - r * 0.55, cy + g, cx + r * 0.55, cy + g);
      break;
    }
  }
};

const drawHeader = (doc: jsPDF, title: string, subtitle?: string): number => {
  const W = doc.internal.pageSize.getWidth();

  doc.setDrawColor(...DARK);
  doc.setLineWidth(0.6);
  doc.line(14, 5, W - 14, 5);

  const safeTitle = title && title.trim() ? title.trim() : "Unnamed Test";
  const safeSubtitle =
    subtitle && subtitle.trim() ? subtitle.trim() : undefined;

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
  doc.text(`Generated ${new Date().toLocaleString()}`, W - 14, lineY - 1, {
    align: "right",
  });

  doc.setDrawColor(...FAINT);
  doc.setLineWidth(0.25);
  doc.line(14, lineY + 2, W - 14, lineY + 2);

  return lineY + 7;
};

interface ExtraCard {
  label: string;
  value: string;
  color: [number, number, number];
  icon: IconType;
}

const drawStatsBar = (
  doc: jsPDF,
  total: number,
  pass: number,
  fail: number,
  pending: number,
  startY: number,
  extraCards?: ExtraCard[]
): number => {
  const W = doc.internal.pageSize.getWidth();
  const usableW = W - 28;

  const cards: ExtraCard[] = [
    { label: "Total Steps", value: String(total), color: DARK, icon: "total" },
    { label: "Passed", value: String(pass), color: GREENINK, icon: "pass" },
    { label: "Failed", value: String(fail), color: REDINK, icon: "fail" },
    {
      label: "Pending",
      value: String(pending),
      color: AMBERINK,
      icon: "pending",
    },
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

  const rate = total > 0 ? Math.round((pass / total) * 100) : 0;
  const barY = startY + cardH + 4;
  const barH = 3;

  doc.setDrawColor(...FAINT);
  doc.setFillColor(...WHITE);
  doc.setLineWidth(0.25);
  doc.roundedRect(14, barY, usableW, barH, 1.5, 1.5, "FD");

  if (rate > 0) {
    doc.setFillColor(...GREENINK);
    doc.setDrawColor(...GREENINK);
    doc.roundedRect(14, barY, (usableW * rate) / 100, barH, 1.5, 1.5, "F");
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...GREENINK);
  doc.text(`${rate}% pass rate`, 14, barY + barH + 5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text(
    `${pass} passed   ${fail} failed   ${pending} pending   ${total} total`,
    W - 14,
    barY + barH + 5,
    { align: "right" }
  );

  return barY + barH + 11;
};

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
    lineColor: FAINT,
    lineWidth: 0.35,
    fontSize: 7,
    cellPadding: { top: 4, bottom: 4, left: 4, right: 4 },
  },
  alternateRowStyles: { fillColor: ROWALT },
  margin: { top: 34, left: 14, right: 14, bottom: 16 },
});

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
    {
      content: step.action,
      styles: { fillColor: bg, textColor: DARK },
    },
    {
      content: step.expected,
      styles: { fillColor: bg, textColor: MID },
    },
    {
      content: step.remarks,
      styles: { fillColor: bg, textColor: MID },
    },
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

const buildDividerRow = (d: FlatData, colSpan: number) => {
  const level = resolveDividerLevel(d);
  const { bg, txt } = dividerStyle(level);

  const prefix = level === 1 ? "" : level === 2 ? "- " : "- - ";
  const label = d.action.replace(/^#{1,3}\s*/, "").toUpperCase();

  return {
    content: `${prefix}${label}`,
    colSpan,
    styles: {
      fillColor: bg,
      textColor: txt,
      fontStyle: "bold" as const,
      fontSize: 8,
      lineColor: FAINT as [number, number, number],
      lineWidth: 0.3,
      cellPadding: {
        top: level === 1 ? 4.5 : level === 2 ? 3.5 : 3,
        bottom: level === 1 ? 4.5 : level === 2 ? 3.5 : 3,
        left: level === 1 ? 10 : level === 2 ? 16 : 22,
        right: 4,
      },
    },
  };
};

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

const docxWrapper = (title: string, body: string) => `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: Calibri, Arial, sans-serif; margin: 24px; }
    h1 { color: #1e3a8a; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; font-size: 18px; }
    p { color: #64748b; font-size: 11px; margin: 4px 0 16px; }
    table { border-collapse: collapse; width: 100%; }
    th { background: #f1f5f9; color: #475569; padding: 8px 10px; text-align: left; font-size: 10px; border: 1px solid #e2e8f0; }
    td { padding: 7px 10px; border: 1px solid #e2e8f0; font-size: 11px; }
    tr:nth-child(even) td { background: #f8fafc; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>Generated ${new Date().toLocaleString()}</p>
  ${body}
</body>
</html>
`;

const downloadDocx = (html: string, filename: string) =>
  download(new Blob([html], { type: "application/msword" }), filename);

// 1. DASHBOARD EXPORTS
export const exportDashboardCSV = (summaries: ModuleSummary[]) => {
  const headers =
    "S.No,Module,Description,Tests,Total Steps,Pass,Fail,Pending,Pass Rate";
  const rows = summaries.map((s, i) =>
    [
      pad2(i + 1),
      s.name,
      s.description ?? "",
      s.testCount ?? "",
      s.total,
      s.pass,
      s.fail,
      s.pending,
      s.passRate,
    ].join(",")
  );

  download(
    new Blob([headers, ...rows].join("\n"), { type: "text/csv" }),
    `TestProDashboard${today}.csv`
  );
};

export const exportDashboardPDF = (summaries: ModuleSummary[]) => {
  const doc = new jsPDF({ orientation: "landscape" });

  const contentY = drawHeader(doc, "Dashboard Report", "All Modules Summary");

  const total = summaries.reduce((a, s) => a + s.total, 0);
  const pass = summaries.reduce((a, s) => a + s.pass, 0);
  const fail = summaries.reduce((a, s) => a + s.fail, 0);
  const pending = summaries.reduce((a, s) => a + s.pending, 0);
  const totalTests = summaries.reduce((a, s) => a + (s.testCount ?? 0), 0);

  const afterStats = drawStatsBar(doc, total, pass, fail, pending, contentY, [
    {
      label: "Total Tests",
      value: String(totalTests),
      color: BLUEINK,
      icon: "tests",
    },
  ]);

  autoTable(doc, {
    ...tableDefaults(doc, afterStats),
    head: [
      [
        "#",
        "Module",
        "Description",
        "Tests",
        "Total Steps",
        "Pass",
        "Fail",
        "Pending",
        "Pass Rate",
      ],
    ],
    body: summaries.map((s, i) => [
      pad2(i + 1),
      s.name,
      s.description ?? "-",
      s.testCount ?? "-",
      s.total,
      s.pass,
      s.fail,
      s.pending,
      `${s.passRate}%`,
    ]),
    columnStyles: {
      0: { cellWidth: 10, halign: "center", textColor: MUTED as any },
      1: { cellWidth: 36, fontStyle: "bold" },
      2: { cellWidth: 52 },
      3: {
        cellWidth: 18,
        halign: "center",
        textColor: BLUEINK as any,
        fontStyle: "bold",
      },
      4: { cellWidth: 22, halign: "center" },
      5: {
        cellWidth: 18,
        halign: "center",
        textColor: GREENINK as any,
        fontStyle: "bold",
      },
      6: {
        cellWidth: 18,
        halign: "center",
        textColor: REDINK as any,
        fontStyle: "bold",
      },
      7: { cellWidth: 18, halign: "center", textColor: AMBERINK as any },
      8: { halign: "center", fontStyle: "bold" },
    },
  });

  drawFooter(doc);
  openPrintPreview(doc);
};

export const exportDashboardDocx = (summaries: ModuleSummary[]) => {
  const rows = summaries
    .map(
      (s, i) => `
      <tr>
        <td align="center" style="color:#64748b">${pad2(i + 1)}</td>
        <td><b>${s.name}</b></td>
        <td>${s.description ?? ""}</td>
        <td align="center" style="color:#2563eb"><b>${
          s.testCount ?? "-"
        }</b></td>
        <td align="center">${s.total}</td>
        <td align="center" style="color:#16a34a"><b>${s.pass}</b></td>
        <td align="center" style="color:#dc2626"><b>${s.fail}</b></td>
        <td align="center" style="color:#d97706"><b>${s.pending}</b></td>
        <td align="center"><b>${s.passRate}%</b></td>
      </tr>
    `
    )
    .join("");

  const html = docxWrapper(
    "Dashboard Report - All Modules",
    `
    <table border="1" style="border-collapse:collapse;width:100%">
      <thead>
        <tr style="background:#f1f5f9;color:#475569">
          <th>#</th>
          <th>Module</th>
          <th>Description</th>
          <th>Tests</th>
          <th>Total Steps</th>
          <th>Pass</th>
          <th>Fail</th>
          <th>Pending</th>
          <th>Pass Rate</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `
  );

  downloadDocx(html, `TestProDashboard${today}.doc`);
};

// 2. REPORT PAGE EXPORTS
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

    const key = `${d.module}__${d.test}`;

    if (!map.has(key)) {
      map.set(key, {
        module: d.module,
        test: d.test,
        total: 0,
        pass: 0,
        fail: 0,
        pending: 0,
        passRate: 0,
      });
    }

    const row = map.get(key)!;
    row.total += 1;

    if (d.status === "pass") row.pass += 1;
    else if (d.status === "fail") row.fail += 1;
    else row.pending += 1;
  }

  for (const row of map.values()) {
    row.passRate = row.total > 0 ? Math.round((row.pass / row.total) * 100) : 0;
  }

  return Array.from(map.values());
};

export const exportReportCSV = (modules: Module[], data: FlatData[]) => {
  const summaries = buildTestSummaries(data);

  const headers = "S.No,Module,Test,Total Steps,Pass,Fail,Pending,Pass Rate";
  const rows = summaries.map((s, i) =>
    [
      pad2(i + 1),
      s.module,
      s.test,
      s.total,
      s.pass,
      s.fail,
      s.pending,
      s.passRate,
    ].join(",")
  );

  download(
    new Blob([headers, ...rows].join("\n"), { type: "text/csv" }),
    `TestProReport${today}.csv`
  );
};

export const exportReportPDF = (modules: Module[], data: FlatData[]) => {
  const doc = new jsPDF({ orientation: "landscape" });
  const summaries = buildTestSummaries(data);

  const contentY = drawHeader(doc, "Test Report", "All Modules - Test Summary");

  const total = summaries.reduce((a, s) => a + s.total, 0);
  const pass = summaries.reduce((a, s) => a + s.pass, 0);
  const fail = summaries.reduce((a, s) => a + s.fail, 0);
  const pending = summaries.reduce((a, s) => a + s.pending, 0);

  const afterStats = drawStatsBar(doc, total, pass, fail, pending, contentY, [
    {
      label: "Total Tests",
      value: String(summaries.length),
      color: BLUEINK,
      icon: "tests",
    },
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
            lineWidth: 0.3,
            cellPadding: { top: 3.5, bottom: 3.5, left: 8, right: 4 },
          },
        },
      ]);
    }

    globalSerial += 1;
    const passRateColor = s.passRate === 100 ? GREENINK : DARK;

    body.push([
      {
        content: pad2(globalSerial),
        styles: { halign: "center" as const, textColor: MUTED },
      },
      { content: s.test, styles: { fontStyle: "bold" as const } },
      { content: String(s.total), styles: { halign: "center" as const } },
      {
        content: String(s.pass),
        styles: {
          halign: "center" as const,
          textColor: GREENINK,
          fontStyle: "bold" as const,
        },
      },
      {
        content: String(s.fail),
        styles: {
          halign: "center" as const,
          textColor: REDINK,
          fontStyle: "bold" as const,
        },
      },
      {
        content: String(s.pending),
        styles: { halign: "center" as const, textColor: AMBERINK },
      },
      {
        content: `${s.passRate}%`,
        styles: {
          halign: "center" as const,
          textColor: passRateColor,
          fontStyle: "bold" as const,
        },
      },
    ]);
  }

  autoTable(doc, {
    ...tableDefaults(doc, afterStats),
    head: [
      ["#", "Test", "Total Steps", "Pass", "Fail", "Pending", "Pass Rate"],
    ],
    body,
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 115 },
      2: { cellWidth: 24 },
      3: { cellWidth: 18 },
      4: { cellWidth: 18 },
      5: { cellWidth: 20 },
      6: { cellWidth: 22 },
    },
  });

  drawFooter(doc);
  openPrintPreview(doc);
};

// 3. MODULE DETAIL EXPORTS
export const exportModuleDetailCSV = (data: FlatData[]) => {
  const lines: string[] = [
    "Module,Test,S.No,Action,Expected Result,Remarks,Status",
  ];

  let lastModule = "";
  let lastTest = "";
  let testSerial = 0;

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
      testSerial += 1;
      lines.push(`,--- ${pad2(testSerial)}. ${d.test} ---,,,,,`);
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
    `TestProModuleDetail${today}.csv`
  );
};

export const exportModuleDetailPDF = (
  moduleName: string,
  stats: {
    pass: number;
    fail: number;
    pending: number;
    total: number;
    passRate: number;
  },
  data: FlatData[]
) => {
  const doc = new jsPDF({ orientation: "landscape" });

  const safeModuleName =
    moduleName && moduleName.trim() ? moduleName.trim() : "Unknown Module";

  const nonDividerRows = data.filter((d) => !d.isdivider);
  const totalTests = new Set(nonDividerRows.map((d) => d.test)).size;

  const contentY = drawHeader(
    doc,
    "Module Detail Report",
    `${safeModuleName} - Full Step Results`
  );

  const afterStats = drawStatsBar(
    doc,
    stats.total,
    stats.pass,
    stats.fail,
    stats.pending,
    contentY,
    [
      {
        label: "Total Tests",
        value: String(totalTests),
        color: BLUEINK,
        icon: "tests",
      },
      {
        label: "Pass Rate",
        value: `${stats.passRate}%`,
        color: stats.passRate === 100 ? GREENINK : BLUEINK,
        icon: "pass",
      },
    ]
  );

  type TestBlock = { name: string; steps: FlatData[]; serial: number };
  const tests = new Map<string, TestBlock>();

  for (const row of data) {
    if (!tests.has(row.test)) {
      tests.set(row.test, {
        name: row.test,
        steps: [],
        serial: tests.size + 1,
      });
    }
    tests.get(row.test)!.steps.push(row);
  }

  const body: any[] = [];

  for (const test of tests.values()) {
    body.push([
      {
        content: `TEST ${pad2(test.serial)}  ${test.name}`,
        colSpan: 5,
        styles: {
          fillColor: TESTBG,
          textColor: TESTTXT,
          fontStyle: "bold" as const,
          fontSize: 7.5,
          lineColor: FAINT as [number, number, number],
          lineWidth: 0.3,
          cellPadding: { top: 3, bottom: 3, left: 20, right: 6 },
        },
      },
    ]);

    for (const row of test.steps) {
      if (row.isdivider) body.push([buildDividerRow(row, 5)]);
      else body.push(buildStepRow(row));
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

// 4. TEST EXECUTION EXPORTS
export const exportExecutionCSV = (
  moduleName: string,
  testName: string,
  data: FlatData[]
) => {
  const headers = "S.No,Action,Expected Result,Remarks,Status";
  const rows = data.map((d) => {
    if (d.isdivider) return `,${d.action.replace(/,/g, " ")},,,`;
    return [
      d.serial,
      d.action.replace(/,/g, " "),
      d.expected.replace(/,/g, " "),
      d.remarks.replace(/,/g, " "),
      d.status,
    ].join(",");
  });

  download(
    new Blob([headers, ...rows].join("\n"), { type: "text/csv" }),
    `${moduleName}${testName}${today}.csv`
  );
};

export const exportExecutionPDF = (
  moduleName: string,
  testName: string,
  data: FlatData[]
) => {
  const doc = new jsPDF({ orientation: "landscape" });

  const safeTestName =
    testName && testName.trim() ? testName.trim() : "Unnamed Test";
  const safeModuleName =
    moduleName && moduleName.trim() ? moduleName.trim() : "Unknown Module";

  const contentY = drawHeader(doc, safeTestName, safeModuleName);

  const nd = data.filter((d) => !d.isdivider);
  const pass = nd.filter((d) => d.status === "pass").length;
  const fail = nd.filter((d) => d.status === "fail").length;
  const pending = nd.filter((d) => d.status === "pending").length;

  const afterStats = drawStatsBar(
    doc,
    nd.length,
    pass,
    fail,
    pending,
    contentY
  );

  const body = data.map((d) => {
    if (d.isdivider) return buildDividerRow(d, 5);
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

// Generic helper used elsewhere
export function parseCsvToRecords(raw: string): Record<string, string>[] {
  const allRows = raw
    .trimStart()
    .split(/\r?\n/)
    .map((line) => line.split(","));

  if (allRows.length < 2) return [];

  const headers = allRows[0].map((h) => h.trim());

  return allRows.slice(1).map((cols) => {
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = (cols[i] ?? "").trim();
    });
    return record;
  });
}
