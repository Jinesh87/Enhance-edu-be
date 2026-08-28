import { EnquiryStageKind } from "../constants/enquiry.js";

type StageLike = {
  id: string;
  kind: EnquiryStageKind | string;
  sortOrder: number;
  retiredAt?: Date | null;
};

export function sortedOpenStages<T extends StageLike>(stages: T[]): T[] {
  return stages
    .filter((stage) => stage.kind === EnquiryStageKind.OPEN && !stage.retiredAt)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

export function getNextOpenStage<T extends StageLike>(
  stages: T[],
  currentStageId: string,
): T | null {
  const openStages = sortedOpenStages(stages);
  const currentIndex = openStages.findIndex((stage) => stage.id === currentStageId);
  if (currentIndex === -1) return null;
  return openStages[currentIndex + 1] ?? null;
}

export function canMoveEnquiryToStage(
  currentStage: StageLike | null | undefined,
  targetStage: StageLike,
  stages: StageLike[],
): boolean {
  if (!currentStage) return false;
  if (currentStage.id === targetStage.id) return false;
  if (targetStage.kind === EnquiryStageKind.LOST) return true;
  if (targetStage.kind !== EnquiryStageKind.OPEN) return false;

  const nextStage = getNextOpenStage(stages, currentStage.id);
  return nextStage?.id === targetStage.id;
}
