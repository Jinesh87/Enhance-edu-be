export enum EnquiryStageKind {
  OPEN = "OPEN",
  LOST = "LOST",
  CONVERTED = "CONVERTED",
}

export enum EnquiryExamOutcome {
  PASS = "PASS",
  FAIL = "FAIL",
  BORDERLINE = "BORDERLINE",
}

export enum EnquiryNurtureState {
  NONE = "NONE",
  WELCOME_SENT = "WELCOME_SENT",
  WAITING_LIST = "WAITING_LIST",
  PAUSED = "PAUSED",
}

export const DEFAULT_ENQUIRY_STAGES = [
  { code: "new", name: "New enquiry", sortOrder: 1, kind: EnquiryStageKind.OPEN },
  {
    code: "waiting_list",
    name: "Waiting list",
    sortOrder: 2,
    kind: EnquiryStageKind.OPEN,
  },
  {
    code: "trial_booked",
    name: "Trial booked",
    sortOrder: 3,
    kind: EnquiryStageKind.OPEN,
  },
  {
    code: "trial_attended",
    name: "Trial attended",
    sortOrder: 4,
    kind: EnquiryStageKind.OPEN,
  },
  {
    code: "entrance_exam",
    name: "Entrance exam",
    sortOrder: 5,
    kind: EnquiryStageKind.OPEN,
  },
  { code: "offer", name: "Offer", sortOrder: 6, kind: EnquiryStageKind.OPEN },
  { code: "lost", name: "Lost", sortOrder: 90, kind: EnquiryStageKind.LOST },
  {
    code: "converted",
    name: "Converted",
    sortOrder: 99,
    kind: EnquiryStageKind.CONVERTED,
  },
] as const;

export const DEFAULT_ENQUIRY_SOURCES = [
  "Website",
  "School",
  "Referral",
  "Walk-in",
  "Facebook",
  "Instagram",
  "Google",
  "Other",
] as const;

export const DEFAULT_ENQUIRY_COMPETITORS = [
  "Cluey Learning",
  "Kip McGrath",
  "NumberWorks'nWords",
  "Another local centre",
] as const;

export const DEFAULT_LOSS_REASONS: {
  stageCode: string;
  name: string;
  requiresCompetitor: boolean;
}[] = [
  { stageCode: "new", name: "No response", requiresCompetitor: false },
  { stageCode: "new", name: "Not ready yet", requiresCompetitor: false },
  {
    stageCode: "waiting_list",
    name: "Wait was too long",
    requiresCompetitor: false,
  },
  {
    stageCode: "waiting_list",
    name: "Found a different tutoring centre",
    requiresCompetitor: true,
  },
  {
    stageCode: "trial_booked",
    name: "Never attended the trial class",
    requiresCompetitor: false,
  },
  {
    stageCode: "trial_booked",
    name: "Found a different tutoring centre",
    requiresCompetitor: true,
  },
  {
    stageCode: "trial_attended",
    name: "Did not like the class",
    requiresCompetitor: false,
  },
  {
    stageCode: "trial_attended",
    name: "Found a different tutoring centre",
    requiresCompetitor: true,
  },
  {
    stageCode: "entrance_exam",
    name: "Did not meet the threshold",
    requiresCompetitor: false,
  },
  {
    stageCode: "entrance_exam",
    name: "Found a different tutoring centre",
    requiresCompetitor: true,
  },
  { stageCode: "offer", name: "Price", requiresCompetitor: false },
  {
    stageCode: "offer",
    name: "Found a different tutoring centre",
    requiresCompetitor: true,
  },
];
