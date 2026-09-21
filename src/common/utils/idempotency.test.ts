import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  __resetIdempotencyMemoryForTests,
  idempotencyLookup,
  idempotencyStore,
  readIdempotencyKey,
} from "./idempotency.js";

describe("idempotency memory fallback", () => {
  it("stores and returns the same response body", async () => {
    __resetIdempotencyMemoryForTests();
    const key = `test-${Date.now()}`;
    const body = { ok: true, n: 1 };
    await idempotencyStore(key, 200, body);
    const hit = await idempotencyLookup(key);
    assert.ok(hit);
    assert.equal(hit.status, 200);
    assert.deepEqual(hit.body, body);
  });

  it("returns null for missing keys", async () => {
    __resetIdempotencyMemoryForTests();
    assert.equal(await idempotencyLookup("missing-key"), null);
    assert.equal(await idempotencyLookup(undefined), null);
  });

  it("reads Idempotency-Key header", () => {
    assert.equal(
      readIdempotencyKey({
        get: (name) =>
          name.toLowerCase() === "idempotency-key" ? "abc" : undefined,
      }),
      "abc",
    );
    assert.equal(
      readIdempotencyKey({ body: { clientRequestId: "from-body" } }),
      "from-body",
    );
  });
});
