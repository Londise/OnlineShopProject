import assert from "node:assert/strict";
import test from "node:test";
import { serializableTransaction } from "../src/db/transaction.js";

test("runs the callback in a Serializable transaction", async () => {
  const work = async (tx) => tx.result;
  const client = { $transaction: async (callback, options) => {
    assert.equal(callback, work);
    assert.equal(options.isolationLevel, "Serializable");
    return callback({ result: "ok" });
  } };
  assert.equal(await serializableTransaction(client, work), "ok");
});

for (const conflict of [
  { code: "P2034" },
  { code: "P2010", meta: { code: "40001" } },
  { code: "P2010", meta: { code: "40P01" } },
]) {
  test(`retries an aborted transaction (${conflict.meta?.code ?? conflict.code})`, async () => {
    let attempts = 0;
    const client = { $transaction: async () => {
      if (++attempts === 1) throw conflict;
      return "ok";
    } };
    assert.equal(await serializableTransaction(client, () => {}), "ok");
    assert.equal(attempts, 2);
  });
}

test("stops after three conflicts", async () => {
  let attempts = 0;
  const conflict = { code: "P2034" };
  const client = { $transaction: async () => { attempts++; throw conflict; } };
  await assert.rejects(serializableTransaction(client, () => {}), (error) => error === conflict);
  assert.equal(attempts, 3);
});

test("does not retry domain errors, duplicates or connection failures", async () => {
  for (const code of ["INSUFFICIENT_STOCK", "P2002", "P1001", "P2010"]) {
    let attempts = 0;
    const error = { code };
    const client = { $transaction: async () => { attempts++; throw error; } };
    await assert.rejects(serializableTransaction(client, () => {}), (caught) => caught === error);
    assert.equal(attempts, 1);
  }
});

test("rejects an invalid retry limit", async () => {
  await assert.rejects(serializableTransaction({}, () => {}, 0));
});
