import { AttendanceStatus } from "../../../entities/index.js";

export interface ProcessScanInput {
  studentId: string;
  sessionId: string;
  scannedCode: string;
  scannedAt: Date;
  deviceSignal: string;
  isOfflineSync: boolean;
  latitude?: number;
  longitude?: number;
}

export interface OfflineScanInput {
  sessionId: string;
  scannedCode: string;
  scannedAt: string;
  deviceSignal?: string;
  latitude?: number;
  longitude?: number;
}

export interface MarkManualRollInput {
  sessionId: string;
  studentId: string;
  status: AttendanceStatus;
  reason: string;
  markedByUserId: string;
}
