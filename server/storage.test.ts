import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kaikei-storage-test-"));
process.env.KAIKEI_DATA_DIR = tempRoot;
const { createEncryptedBackup, dataPaths, database, deleteRecord, getRecord, putRecord, putRecordsAtomic, verifyEncryptedBackup } = await import("./storage");

function journal(id: string, sourceKey?: string) {
  return { id, date: "2026-09-23", debitAccountId: "cash", creditAccountId: "sales", amount: 300, description: "test", status: "posted", sourceKey };
}

test("server rejects unbalanced and invalid journal data", () => {
  putRecord("accounts", "cash", { id: "cash", code: "100", category: "asset" }, "owner");
  putRecord("accounts", "sales", { id: "sales", code: "400", category: "income" }, "owner");
  assert.throws(() => putRecord("journals", "bad-date", { ...journal("bad-date"), date: "2026-02-30" }, "owner"), /実在しない日付/);
  assert.throws(() => putRecord("journals", "bad-lines", { id: "bad-lines", date: "2026-09-23", lines: [
    { side: "debit", accountId: "cash", amount: 300 },
    { side: "credit", accountId: "sales", amount: 299 },
  ] }, "owner"), /一致しません/);
  assert.equal(getRecord("journals", "bad-lines"), undefined);
});

test("server writes balanced compound journal and prevents duplicate automatic postings", () => {
  putRecord("journals", "compound", { id: "compound", date: "2026-09-23", description: "test", sourceKey: "asset:2026:1", lines: [
    { side: "debit", accountId: "cash", amount: 200 },
    { side: "debit", accountId: "cash", amount: 100 },
    { side: "credit", accountId: "sales", amount: 300 },
  ] }, "owner");
  assert.ok(getRecord("journals", "compound"));
  assert.throws(() => putRecord("journals", "duplicate", journal("duplicate", "asset:2026:1"), "owner"), /すでに存在/);
  assert.throws(() => deleteRecord("accounts", "cash", "owner"), /使用中/);
  assert.throws(() => putRecord("accounts", "cash", { id: "cash", code: "400", category: "income" }, "owner"), /変更できません/);
  assert.throws(() => putRecord("journals", "false-reversal", { ...journal("false-reversal"), reversalOf: "compound" }, "owner"), /一致しません/);
  putRecord("journals", "reversal", { id: "reversal", date: "2026-09-23", description: "reversal", reversalOf: "compound", lines: [
    { side: "credit", accountId: "cash", amount: 200 },
    { side: "credit", accountId: "cash", amount: 100 },
    { side: "debit", accountId: "sales", amount: 300 },
  ] }, "owner");
  assert.throws(() => putRecord("journals", "repeat-reversal", { ...journal("repeat-reversal"), reversalOf: "compound" }, "owner"), /一致しません|すでに反対仕訳/);
});

test("batch rolls back completely and closed fiscal year blocks edits", () => {
  assert.throws(() => putRecordsAtomic("journals", [
    { id: "first", data: journal("first") },
    { id: "invalid", data: { ...journal("invalid"), amount: 0 } },
  ], "owner"));
  assert.equal(getRecord("journals", "first"), undefined);
  putRecord("fiscalYears", "2026", { id: "2026", status: "closed" }, "owner");
  assert.throws(() => putRecord("journals", "closed", journal("closed"), "owner"), /締め済み/);
  assert.throws(() => putRecord("fiscalYears", "2026", { id: "2026", status: "open" }, "owner"), /理由/);
  putRecord("fiscalYears", "2026", { id: "2026", status: "open", unlockReason: "過去の仕訳を訂正するため" }, "owner");
  putRecord("journals", "after-open", journal("after-open"), "owner");
  assert.ok(getRecord("journals", "after-open"));
});

test("encrypted backup restores all records, audit entries and document bytes for verification", () => {
  fs.writeFileSync(path.join(dataPaths.documents, "receipt.pdf"), Buffer.from("test-original"));
  const backup = createEncryptedBackup("owner");
  assert.ok(fs.readFileSync(backup.file).subarray(0, 4).equals(Buffer.from("LKQ1")));
  assert.equal(fs.readFileSync(backup.file).includes(Buffer.from("test-original")), false);
  const result = verifyEncryptedBackup(path.basename(backup.file));
  assert.equal(result.recordCount, backup.recordCount);
  assert.equal(result.documentCount, 1);
  assert.ok(result.auditEventCount >= result.recordCount);
  assert.equal(result.legacyBackup, false);
});

process.on("exit", () => {
  database.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
