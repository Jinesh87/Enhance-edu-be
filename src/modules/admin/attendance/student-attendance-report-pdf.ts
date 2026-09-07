import crypto from "crypto";
import { jsPDF } from "jspdf";
import { autoTable, type HookData } from "jspdf-autotable";
import {
  DEFAULT_CLASS_TIMEZONE,
  formatInTimeZone,
} from "../../../common/utils/timezone.js";

const INSTITUTION_NAME = "Enhance Education";
const DOCUMENT_TITLE = "Student Attendance Report";
const CONFIDENTIAL = "Confidential — For authorised school use only";

const BRAND = {
  ink: [0, 44, 35] as [number, number, number],
  inkSoft: [31, 92, 80] as [number, number, number],
  amber: [219, 144, 39] as [number, number, number],
  cream: [251, 248, 243] as [number, number, number],
  creamDark: [242, 235, 227] as [number, number, number],
  muted: [124, 138, 132] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  line: [220, 211, 198] as [number, number, number],
};

export type AttendanceReportSummary = {
  expected: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  attendanceRateLabel: string;
};

export type AttendanceSubjectSummaryRow = {
  subject: string;
  expected: number;
  present: number;
  absent: number;
  late: number;
  attendanceRateLabel: string;
};

export type AttendanceDetailRow = {
  dateLabel: string;
  subject: string;
  sessionLabel: string;
  status: string;
  statusLabel: string;
  reason: string;
  note: string;
};

export type StudentAttendanceReportInput = {
  reportId: string;
  generatedAtLabel: string;
  studentName: string;
  studentIdentifier: string;
  yearLevel: string;
  classSection: string;
  academicYearLabel: string;
  termName: string;
  subjectLabel: string;
  summary: AttendanceReportSummary;
  subjectSummary: AttendanceSubjectSummaryRow[];
  details: AttendanceDetailRow[];
};

type PdfDoc = jsPDF & { lastAutoTable?: { finalY: number } };

function setFill(doc: jsPDF, color: [number, number, number]) {
  doc.setFillColor(color[0], color[1], color[2]);
}

function setText(doc: jsPDF, color: [number, number, number]) {
  doc.setTextColor(color[0], color[1], color[2]);
}

function drawPageChrome(
  doc: jsPDF,
  pageNumber: number,
  pageCount: number,
  generatedAtLabel: string,
  compact = false,
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  if (compact) {
    setFill(doc, BRAND.ink);
    doc.rect(0, 0, pageWidth, 10, "F");
    setFill(doc, BRAND.amber);
    doc.rect(0, 10, pageWidth, 1.2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setText(doc, BRAND.white);
    doc.text(INSTITUTION_NAME, margin, 6.5);
    doc.setFont("helvetica", "normal");
    setText(doc, BRAND.cream);
    doc.text(DOCUMENT_TITLE, pageWidth - margin, 6.5, { align: "right" });
  }

  const footerY = pageHeight - 8;
  doc.setDrawColor(BRAND.line[0], BRAND.line[1], BRAND.line[2]);
  doc.setLineWidth(0.2);
  doc.line(margin, footerY - 4, pageWidth - margin, footerY - 4);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  setText(doc, BRAND.muted);
  doc.text(CONFIDENTIAL, margin, footerY);
  doc.text(
    `Generated ${generatedAtLabel}  ·  Page ${pageNumber} of ${pageCount}`,
    pageWidth - margin,
    footerY,
    { align: "right" },
  );
}

function drawHeader(doc: jsPDF, input: StudentAttendanceReportInput) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const headerHeight = 28;

  setFill(doc, BRAND.ink);
  doc.rect(0, 0, pageWidth, headerHeight, "F");
  setFill(doc, BRAND.amber);
  doc.rect(0, headerHeight, pageWidth, 1.6, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  setText(doc, BRAND.white);
  doc.text(INSTITUTION_NAME, margin, 11);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setText(doc, BRAND.cream);
  doc.text(DOCUMENT_TITLE, margin, 17.5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  setText(doc, BRAND.white);
  doc.text(`Report ${input.reportId}`, pageWidth - margin, 11, {
    align: "right",
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  setText(doc, BRAND.cream);
  doc.text(input.generatedAtLabel, pageWidth - margin, 17.5, {
    align: "right",
  });

  return headerHeight + 8;
}

function drawMetaCard(
  doc: jsPDF,
  input: StudentAttendanceReportInput,
  startY: number,
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const cardHeight = 40;
  const colGap = (pageWidth - margin * 2) / 2;

  setFill(doc, BRAND.cream);
  doc.roundedRect(margin, startY, pageWidth - margin * 2, cardHeight, 2.5, 2.5, "F");
  doc.setDrawColor(BRAND.line[0], BRAND.line[1], BRAND.line[2]);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, startY, pageWidth - margin * 2, cardHeight, 2.5, 2.5, "S");

  const items = [
    { label: "Student", value: input.studentName, x: 0, row: 0 },
    { label: "Student ID", value: input.studentIdentifier, x: 1, row: 0 },
    { label: "Year level", value: input.yearLevel, x: 0, row: 1 },
    { label: "Class / section", value: input.classSection, x: 1, row: 1 },
    { label: "Academic year", value: input.academicYearLabel, x: 0, row: 2 },
    { label: "Term", value: input.termName, x: 1, row: 2 },
    { label: "Subject", value: input.subjectLabel, x: 0, row: 3 },
  ];

  for (const item of items) {
    const x = margin + 5 + item.x * colGap;
    const y = startY + 6 + item.row * 7;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6);
    setText(doc, BRAND.muted);
    doc.text(item.label.toUpperCase(), x, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setText(doc, BRAND.ink);
    doc.text(item.value || "—", x, y + 3.8, {
      maxWidth: colGap - 10,
    });
  }

  return startY + cardHeight + 6;
}

function drawSummary(
  doc: PdfDoc,
  summary: AttendanceReportSummary,
  startY: number,
) {
  const margin = 14;
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setText(doc, BRAND.ink);
  doc.text("Attendance summary", margin, startY);

  const cards: Array<{ label: string; value: string }> = [
    { label: "Expected", value: String(summary.expected) },
    { label: "Present", value: String(summary.present) },
    { label: "Absent", value: String(summary.absent) },
    { label: "Late", value: String(summary.late) },
    { label: "Excused", value: String(summary.excused) },
    { label: "Rate", value: summary.attendanceRateLabel },
  ];

  const gap = 3;
  const cardWidth = (pageWidth - margin * 2 - gap * (cards.length - 1)) / cards.length;
  const y = startY + 4;

  cards.forEach((card, index) => {
    const x = margin + index * (cardWidth + gap);
    setFill(doc, index === cards.length - 1 ? BRAND.creamDark : BRAND.cream);
    doc.roundedRect(x, y, cardWidth, 16, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    setText(doc, BRAND.muted);
    doc.text(card.label.toUpperCase(), x + 3, y + 5.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    setText(doc, BRAND.ink);
    doc.text(card.value, x + 3, y + 12);
  });

  return y + 22;
}

function sectionTitle(doc: jsPDF, title: string, y: number) {
  const margin = 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setText(doc, BRAND.ink);
  doc.text(title, margin, y);
  return y + 3;
}

export function createAttendanceReportId() {
  return `AR-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

export function formatAttendanceGeneratedAt(date = new Date()) {
  return formatInTimeZone(date.toISOString(), DEFAULT_CLASS_TIMEZONE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function renderStudentAttendanceReportPdf(
  input: StudentAttendanceReportInput,
): Buffer {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  }) as PdfDoc;
  const margin = 14;

  let y = drawHeader(doc, input);
  y = drawMetaCard(doc, input, y);
  y = drawSummary(doc, input.summary, y);

  if (input.subjectSummary.length > 0) {
    y = sectionTitle(doc, "Subject summary", y);
    autoTable(doc, {
      startY: y,
      head: [["Subject", "Expected", "Present", "Absent", "Late", "Rate"]],
      body: input.subjectSummary.map((row) => [
        row.subject,
        String(row.expected),
        String(row.present),
        String(row.absent),
        String(row.late),
        row.attendanceRateLabel,
      ]),
      margin: { left: margin, right: margin, top: 16, bottom: 16 },
      styles: {
        font: "helvetica",
        fontSize: 8,
        cellPadding: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 },
        lineColor: BRAND.line,
        lineWidth: 0.15,
        textColor: BRAND.ink,
        overflow: "linebreak",
        valign: "middle",
      },
      headStyles: {
        fillColor: BRAND.ink,
        textColor: BRAND.white,
        fontStyle: "bold",
        fontSize: 7.5,
      },
      alternateRowStyles: { fillColor: BRAND.cream },
      theme: "plain",
      rowPageBreak: "avoid",
      didDrawPage: (data: HookData) => {
        if (data.pageNumber > 1) {
          drawPageChrome(
            doc,
            data.pageNumber,
            doc.getNumberOfPages(),
            input.generatedAtLabel,
            true,
          );
        }
      },
    });
    y = (doc.lastAutoTable?.finalY ?? y) + 8;
  }

  y = sectionTitle(doc, "Attendance detail", y);
  autoTable(doc, {
    startY: y,
    head: [["Date", "Subject", "Session", "Status", "Reason", "Note"]],
    body:
      input.details.length > 0
        ? input.details.map((row) => [
            row.dateLabel,
            row.subject,
            row.sessionLabel,
            row.statusLabel,
            row.reason,
            row.note,
          ])
        : [["—", "—", "—", "—", "—", "No attendance rows"]],
    margin: { left: margin, right: margin, top: 16, bottom: 16 },
    styles: {
      font: "helvetica",
      fontSize: 7.5,
      cellPadding: { top: 2.2, right: 2, bottom: 2.2, left: 2 },
      lineColor: BRAND.line,
      lineWidth: 0.15,
      textColor: BRAND.ink,
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: BRAND.ink,
      textColor: BRAND.white,
      fontStyle: "bold",
      fontSize: 7,
    },
    alternateRowStyles: { fillColor: BRAND.cream },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 28 },
      2: { cellWidth: 36 },
      3: { cellWidth: 22 },
      4: { cellWidth: 28 },
      5: { cellWidth: "auto" },
    },
    theme: "plain",
    rowPageBreak: "avoid",
    didDrawPage: (data: HookData) => {
      if (data.pageNumber > 1) {
        drawPageChrome(
          doc,
          data.pageNumber,
          doc.getNumberOfPages(),
          input.generatedAtLabel,
          true,
        );
      }
    },
  });

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    drawPageChrome(
      doc,
      page,
      pageCount,
      input.generatedAtLabel,
      page > 1,
    );
  }

  return Buffer.from(doc.output("arraybuffer"));
}
