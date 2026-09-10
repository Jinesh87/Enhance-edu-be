import {
  getObjectBuffer,
  putObject,
} from "../../../../common/storage/object-storage.js";

export class AdminAiReportStorageService {
  buildKey(ownerUserId: string, reportId: string): string {
    return `admin-ai-reports/${ownerUserId}/${reportId}.pdf`;
  }

  async storePdf(params: {
    ownerUserId: string;
    reportId: string;
    buffer: Buffer;
  }): Promise<{ storageKey: string; byteSize: number }> {
    const storageKey = this.buildKey(params.ownerUserId, params.reportId);
    const stored = await putObject({
      key: storageKey,
      body: params.buffer,
      contentType: "application/pdf",
    });
    return { storageKey, byteSize: stored.byteSize };
  }

  /**
   * Always load via the API (proxy bytes). Do not return Linode signed URLs
   * to the browser — that requires bucket CORS and fails in normal setups.
   */
  async getDownloadBuffer(storageKey: string): Promise<Buffer> {
    return getObjectBuffer(storageKey);
  }
}

export const adminAiReportStorageService = new AdminAiReportStorageService();
