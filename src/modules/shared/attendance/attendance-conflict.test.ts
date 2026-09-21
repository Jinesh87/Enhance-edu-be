import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  homeworkGradeContentDiffers,
  isAttendanceConflict,
  isOptimisticConflict,
  sessionLessonContentDiffers,
} from "./attendance-conflict.js";

describe("isOptimisticConflict Option C", () => {
  const serverUpdatedAt = new Date("2026-09-21T10:00:00.000Z");

  it("conflicts when base missing and content differs", () => {
    assert.equal(
      isOptimisticConflict({
        clientBaseUpdatedAt: null,
        serverUpdatedAt,
        contentDiffers: true,
      }),
      true,
    );
  });

  it("allows when base missing but content is identical", () => {
    assert.equal(
      isOptimisticConflict({
        clientBaseUpdatedAt: null,
        serverUpdatedAt,
        contentDiffers: false,
      }),
      false,
    );
  });

  it("flags conflict when server is newer and content differs", () => {
    assert.equal(
      isOptimisticConflict({
        clientBaseUpdatedAt: "2026-09-21T09:00:00.000Z",
        serverUpdatedAt,
        contentDiffers: true,
      }),
      true,
    );
  });

  it("allows when client base is current", () => {
    assert.equal(
      isOptimisticConflict({
        clientBaseUpdatedAt: "2026-09-21T10:00:00.000Z",
        serverUpdatedAt,
        contentDiffers: true,
      }),
      false,
    );
  });
});

describe("isAttendanceConflict", () => {
  const serverUpdatedAt = new Date("2026-09-21T10:00:00.000Z");

  it("Option C: no base + status change is conflict", () => {
    assert.equal(
      isAttendanceConflict({
        clientBaseUpdatedAt: null,
        serverUpdatedAt,
        serverStatus: "PRESENT",
        nextStatus: "ABSENT",
      }),
      true,
    );
  });

  it("allows same-status with no base", () => {
    assert.equal(
      isAttendanceConflict({
        clientBaseUpdatedAt: null,
        serverUpdatedAt,
        serverStatus: "PRESENT",
        nextStatus: "PRESENT",
      }),
      false,
    );
  });
});

describe("content differs helpers", () => {
  it("detects homework grade field changes", () => {
    assert.equal(
      homeworkGradeContentDiffers(
        { marks: 5, maxMarks: 10, feedback: "ok", isCompleted: true },
        { marks: 6, maxMarks: 10, feedback: "ok", isCompleted: true },
      ),
      true,
    );
    assert.equal(
      homeworkGradeContentDiffers(
        { marks: 5, maxMarks: 10, feedback: "ok", isCompleted: true },
        { marks: 5, maxMarks: 10, feedback: "ok", isCompleted: true },
      ),
      false,
    );
  });

  it("detects session lesson field changes", () => {
    assert.equal(
      sessionLessonContentDiffers(
        {
          title: "A",
          description: null,
          objectives: null,
          notes: "n1",
        },
        { title: "A", description: null, objectives: null, notes: "n2" },
      ),
      true,
    );
  });
});
