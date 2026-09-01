import { jsPDF } from "jspdf";
import { autoTable, type HookData } from "jspdf-autotable";
import {
  DEFAULT_CLASS_TIMEZONE,
  formatInTimeZone,
} from "../../../common/utils/timezone.js";
import type { Term } from "../../../entities/Term.js";

const INSTITUTION_NAME = "Enhance Education";
const DOCUMENT_TITLE = "Subject timetable";

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

export type TimetableSessionRow = {
  startAt: string;
  endAt: string;
  room: string | null;
  isWeeklySlot: boolean;
  teacher?: { fullName: string } | null;
  class?: {
    lesson?: string | null;
    code?: string;
    room?: string;
    timeZone?: string | null;
    teacher?: { fullName: string } | null;
  } | null;
};

export type TimetableSubjectBlock = {
  subjectName: string;
  sessions: TimetableSessionRow[];
};

type PdfDoc = jsPDF & { lastAutoTable?: { finalY: number } };

function formatTime12h(value: string, timeZone?: string | null) {
  return formatInTimeZone(value, timeZone, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatSessionDay(row: TimetableSessionRow) {
  const timeZone = row.class?.timeZone ?? DEFAULT_CLASS_TIMEZONE;
  if (row.isWeeklySlot) {
    const day =
      formatInTimeZone(row.startAt, timeZone, { weekday: "long" }) || "—";
    return `${day} (weekly)`;
  }
  return (
    formatInTimeZone(row.startAt, timeZone, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }) || "—"
  );
}

function formatSessionTime(row: TimetableSessionRow) {
  const timeZone = row.class?.timeZone ?? DEFAULT_CLASS_TIMEZONE;
  const start = formatTime12h(row.startAt, timeZone);
  const end = formatTime12h(row.endAt, timeZone);
  if (!start || !end) return "—";
  return `${start} – ${end}`;
}

function formatDisplayDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

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
  compact = false,
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;

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

  const footerY = pageHeight - 7;
  doc.setDrawColor(BRAND.line[0], BRAND.line[1], BRAND.line[2]);
  doc.setLineWidth(0.2);
  doc.line(margin, footerY - 3, pageWidth - margin, footerY - 3);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  setText(doc, BRAND.muted);
  doc.text(
    `Generated ${new Date().toLocaleString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })}`,
    margin,
    footerY,
  );
  doc.text(`Page ${pageNumber} of ${pageCount}`, pageWidth - margin, footerY, {
    align: "right",
  });
}

function drawCoverHeader(
  doc: jsPDF,
  options: {
    studentName: string;
    yearLevelName: string;
    termLabel: string;
    termStartDate: string;
    termEndDate: string;
    subjectCount: number;
    sessionCount: number;
  },
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;
  const headerHeight = 30;

  setFill(doc, BRAND.ink);
  doc.rect(0, 0, pageWidth, headerHeight, "F");
  setFill(doc, BRAND.amber);
  doc.rect(0, headerHeight, pageWidth, 1.6, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  setText(doc, BRAND.white);
  doc.text(INSTITUTION_NAME, margin, 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setText(doc, BRAND.cream);
  doc.text("ENROLMENT TIMETABLE", margin, 18);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  setText(doc, BRAND.white);
  doc.text(DOCUMENT_TITLE, margin, 25);

  const cardY = headerHeight + 8;
  const cardHeight = 28;
  setFill(doc, BRAND.cream);
  doc.roundedRect(margin, cardY, pageWidth - margin * 2, cardHeight, 2.5, 2.5, "F");
  doc.setDrawColor(BRAND.line[0], BRAND.line[1], BRAND.line[2]);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, cardY, pageWidth - margin * 2, cardHeight, 2.5, 2.5, "S");

  const colGap = (pageWidth - margin * 2) / 2;
  const labelY = cardY + 8;
  const valueY = cardY + 13.5;
  const leftX = margin + 6;
  const rightX = margin + colGap + 6;

  const metaItems = [
    { label: "Student", value: options.studentName || "—", x: leftX, y: labelY },
    {
      label: "Year level",
      value: options.yearLevelName || "—",
      x: rightX,
      y: labelY,
    },
    { label: "Term", value: options.termLabel, x: leftX, y: labelY + 11 },
    {
      label: "Term dates",
      value:
        options.termStartDate && options.termEndDate
          ? `${formatDisplayDate(options.termStartDate)} – ${formatDisplayDate(options.termEndDate)}`
          : "—",
      x: rightX,
      y: labelY + 11,
    },
  ];

  for (const item of metaItems) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    setText(doc, BRAND.muted);
    doc.text(item.label.toUpperCase(), item.x, item.y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    setText(doc, BRAND.ink);
    doc.text(item.value, item.x, valueY + (item.y - labelY));
  }

  const summaryY = cardY + cardHeight + 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setText(doc, BRAND.muted);
  doc.text(
    `${options.subjectCount} subject${options.subjectCount === 1 ? "" : "s"} · ${options.sessionCount} session${options.sessionCount === 1 ? "" : "s"}`,
    margin,
    summaryY,
  );

  return summaryY + 4;
}

function drawSubjectHeading(
  doc: jsPDF,
  subjectName: string,
  sessionCount: number,
  y: number,
) {
  const margin = 12;
  const pageWidth = doc.internal.pageSize.getWidth();

  setFill(doc, BRAND.amber);
  doc.rect(margin, y, 2.2, 8, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setText(doc, BRAND.ink);
  doc.text(subjectName, margin + 5, y + 5.5);

  const badge = `${sessionCount} session${sessionCount === 1 ? "" : "s"}`;
  const badgeWidth = doc.getTextWidth(badge) + 6;
  const badgeX = pageWidth - margin - badgeWidth;

  setFill(doc, BRAND.creamDark);
  doc.roundedRect(badgeX, y + 0.5, badgeWidth, 7, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  setText(doc, BRAND.inkSoft);
  doc.text(badge, badgeX + 3, y + 5.2);

  return y + 10;
}

function ensureSpace(doc: jsPDF, y: number, needed: number) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottom = pageHeight - 16;
  if (y + needed <= bottom) return y;

  doc.addPage();
  return 22;
}

export function renderEnrollmentTimetablePdf(options: {
  studentName: string;
  yearLevelName: string;
  termLabel: string;
  term: Pick<Term, "startDate" | "endDate">;
  timetables: TimetableSubjectBlock[];
}): Buffer {
  const { studentName, yearLevelName, termLabel, term, timetables } = options;
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  }) as PdfDoc;
  const margin = 12;
  const sessionCount = timetables.reduce(
    (sum, entry) => sum + entry.sessions.length,
    0,
  );

  let y = drawCoverHeader(doc, {
    studentName,
    yearLevelName,
    termLabel,
    termStartDate: term.startDate,
    termEndDate: term.endDate,
    subjectCount: timetables.length,
    sessionCount,
  });

  for (const [index, entry] of timetables.entries()) {
    if (index > 0) y += 4;

    y = ensureSpace(doc, y, 24);
    y = drawSubjectHeading(doc, entry.subjectName, entry.sessions.length, y);

    const body =
      entry.sessions.length === 0
        ? [
            [
              {
                content: "Schedule not published for this subject and term.",
                colSpan: 5,
                styles: {
                  fontStyle: "italic" as const,
                  textColor: BRAND.muted,
                  halign: "center" as const,
                },
              },
            ],
          ]
        : entry.sessions.map((session) => [
            formatSessionDay(session),
            formatSessionTime(session),
            session.class?.lesson || session.class?.code || "—",
            session.room || session.class?.room || "—",
            session.teacher?.fullName || session.class?.teacher?.fullName || "—",
          ]);

    autoTable(doc, {
      startY: y,
      head: [["Day / date", "Time", "Lesson", "Room", "Teacher"]],
      body,
      margin: { left: margin, right: margin, top: 22, bottom: 16 },
      styles: {
        font: "helvetica",
        fontSize: 8.5,
        cellPadding: { top: 3, right: 3, bottom: 3, left: 3 },
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
      alternateRowStyles: {
        fillColor: BRAND.cream,
      },
      columnStyles: {
        0: { cellWidth: 48 },
        1: { cellWidth: 40 },
        2: { cellWidth: "auto" },
        3: { cellWidth: 30 },
        4: { cellWidth: 44 },
      },
      theme: "plain",
      didDrawPage: (data: HookData) => {
        if (data.pageNumber > 1) {
          drawPageChrome(doc, data.pageNumber, doc.getNumberOfPages(), true);
        }
      },
    });

    y = (doc.lastAutoTable?.finalY ?? y) + 6;
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    drawPageChrome(doc, page, pageCount, page > 1);
  }

  return Buffer.from(doc.output("arraybuffer"));
}

export function slugifyTimetableFilename(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
