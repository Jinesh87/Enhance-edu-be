import { logger } from "../../../config/logger.js";
import { liveUpdateManager } from "./live-updates.js";
import { sharedAttendanceService } from "./shared-attendance.service.js";

/** Pushes the latest roll to live viewers of a session. Never throws. */
export async function broadcastRollUpdate(sessionId: string): Promise<void> {
  try {
    const rollData = await sharedAttendanceService.getLiveRollData(sessionId);
    liveUpdateManager.broadcast(sessionId, {
      type: "ROLL_UPDATE",
      ...rollData,
    });
  } catch (error) {
    logger.warn({ err: error, sessionId }, "Failed to broadcast roll update");
  }
}
