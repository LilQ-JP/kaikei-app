import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { validateBalancedJournal, journalLines } from "../shared/accounting";

export const RECORD_COLLECTIONS = [
  "accounts",
  "journals",
  "invoices",
  "receipts",
  "profile",
  "settings",
  "vendors",
  "fixedAssets",
  "homeExpenseRules",
  "fiscalYears",
] as const;

export type RecordCollection = (typeof RECORD_COLLECTIONS)[number];

const dataRoot = process.env.KAIKEI_DATA_DIR || path.join(process.env.PROGRAMDATA || process.cwd(), "LilQKaikei");
fs.mkdirSync(dataRoot, { recursive: true });

export const dataPaths = {
  root: dataRoot,
  database: path.join(dataRoot, "kaikei.sqlite"),
  documents: path.join(dataRoot, "documents"),
  backups: path.join(dataRoot, "backups"),
};
fs.mkdirSync(dataPaths.documents, { recursive: true });
fs.mkdirSync(dataPaths.backups, { recursive: true });

const backupKeyPath = path.join(dataPaths.root, "backup.key");
function getBackupKey(): Buffer {
  const configured = process.env.KAIKEI_BACKUP_KEY;
  if (configured) return scryptSync(configured, "kaikei-backup", 32);
  if (!fs.existsSync(backupKeyPath)) fs.writeFileSync(backupKeyPath, randomBytes(32), { mode: 0o600 });
  return fs.readFileSync(backupKeyPath);
}

export const database = new DatabaseSync(dataPaths.database);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA synchronous = FULL;
  CREATE TABLE IF NOT EXISTS records (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (collection, id)
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    csrf_token TEXT
  );
  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    action TEXT NOT NULL,
    collection TEXT,
    record_id TEXT,
    occurred_at TEXT NOT NULL,
    data TEXT
  );
`);
// Existing Lenovo databases predate CSRF tokens.  Invalidating their old
// sessions is intentional: a fresh login is required before a write.
try { database.exec("ALTER TABLE sessions ADD COLUMN csrf_token TEXT"); } catch { /* column already exists */ }

const collectionSet = new Set<string>(RECORD_COLLECTIONS);
export function assertCollection(value: string): asserts value is RecordCollection {
  if (!collectionSet.has(value)) throw new Error("不正なデータ種別です");
}

function now() {
  return new Date().toISOString();
}

export function listRecords(collection: RecordCollection): unknown[] {
  const rows = database.prepare("SELECT data FROM records WHERE collection = ? ORDER BY updated_at DESC").all(collection) as Array<{ data: string }>;
  return rows.map((row) => JSON.parse(row.data));
}

export function getRecord(collection: RecordCollection, id: string): unknown | undefined {
  const row = database.prepare("SELECT data FROM records WHERE collection = ? AND id = ?").get(collection, id) as { data?: string } | undefined;
  return row?.data ? JSON.parse(row.data) : undefined;
}

const journalSchema = z.object({
  id: z.string().min(1).max(128),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  debitAccountId: z.string().min(1).max(128).optional(),
  creditAccountId: z.string().min(1).max(128).optional(),
  amount: z.number().int().positive().safe().optional(),
  lines: z.array(z.object({
    side: z.enum(["debit", "credit"]),
    accountId: z.string().min(1).max(128),
    amount: z.number().int().positive().safe(),
  }).passthrough()).min(2).optional(),
  description: z.string().max(1000).default(""),
  status: z.enum(["draft", "posted", "reversed"]).optional(),
  reversalOf: z.string().min(1).max(128).optional(),
  sourceKey: z.string().min(1).max(256).optional(),
}).passthrough();

function assertFiscalYearOpen(date: string) {
  const year = date.slice(0, 4);
  const fiscalYear = getRecord("fiscalYears", year) as { status?: string; closed?: boolean } | undefined;
  if (fiscalYear?.status === "closed" || fiscalYear?.closed === true) {
    throw new Error(`${year}年度は締め済みのため変更できません`);
  }
}

function assertRealDate(dateValue: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) throw new Error("日付形式が不正です");
  const parsed = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateValue) throw new Error("実在しない日付です");
  assertFiscalYearOpen(dateValue);
}

function accountIdByCode(code: string): string {
  const row = database.prepare("SELECT id FROM records WHERE collection = 'accounts' AND json_extract(data, '$.code') = ? LIMIT 1").get(code) as { id?: string } | undefined;
  if (!row?.id) throw new Error(`勘定科目コード${code}がありません。勘定科目を初期化してください`);
  return row.id;
}

function insertRecordAndAudit(collection: RecordCollection, id: string, data: unknown, userId: string, timestamp: string) {
  const serialized = JSON.stringify(data);
  database.prepare(`
    INSERT INTO records(collection, id, data, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(collection, id, serialized, timestamp);
  database.prepare("INSERT INTO audit_events(id, user_id, action, collection, record_id, occurred_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(randomBytes(16).toString("hex"), userId, "upsert", collection, id, timestamp, serialized);
}

/** Posts a sent invoice to AR, revenue and output-tax accounts atomically. */
export function postInvoiceToLedger(invoiceId: string, userId: string) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const invoice = getRecord("invoices", invoiceId) as Record<string, any> | undefined;
    if (!invoice) throw new Error("請求書が見つかりません");
    if (invoice.issueJournalId) {
      database.exec("COMMIT");
      return { invoice, journalId: invoice.issueJournalId, alreadyPosted: true };
    }
    const total = Number(invoice.total);
    const subtotal = Number(invoice.subtotal);
    const taxAmount = Number(invoice.taxAmount || 0);
    if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(subtotal) || subtotal < 0 || !Number.isSafeInteger(taxAmount) || subtotal + taxAmount !== total) throw new Error("請求書の金額が一致しません");
    assertRealDate(String(invoice.issueDate));
    const breakdown = Array.isArray(invoice.taxBreakdown) && invoice.taxBreakdown.length
      ? invoice.taxBreakdown as Array<{ taxRate: number; taxableAmount: number; taxAmount: number }>
      : [{ taxRate: Number(invoice.taxRate || 10), taxableAmount: subtotal, taxAmount }];
    if (breakdown.some((group) => !Number.isSafeInteger(group.taxableAmount) || group.taxableAmount < 0 || !Number.isSafeInteger(group.taxAmount) || group.taxAmount < 0 || ![0, 8, 10].includes(group.taxRate)) || breakdown.reduce((sum, group) => sum + group.taxableAmount, 0) !== subtotal || breakdown.reduce((sum, group) => sum + group.taxAmount, 0) !== taxAmount) throw new Error("請求書の税率別金額が一致しません");
    const receivableAccountId = accountIdByCode("108");
    const salesAccountId = accountIdByCode("400");
    const outputTaxAccountId = taxAmount > 0 ? accountIdByCode("211") : undefined;
    const lines = [
      { side: "debit" as const, accountId: receivableAccountId, amount: total },
      ...breakdown.filter((group) => group.taxableAmount > 0).map((group) => ({
        side: "credit" as const,
        accountId: salesAccountId,
        amount: group.taxableAmount,
        taxCategory: group.taxRate === 8 ? "taxable-sales-reduced" as const : group.taxRate === 10 ? "taxable-sales" as const : "exempt" as const,
        taxRate: group.taxRate,
        taxIncluded: false,
      })),
      ...(taxAmount > 0 ? [{ side: "credit" as const, accountId: outputTaxAccountId!, amount: taxAmount }] : []),
    ];
    const journalId = randomUUID();
    const journal = {
      id: journalId,
      date: invoice.issueDate,
      debitAccountId: receivableAccountId,
      creditAccountId: salesAccountId,
      amount: total,
      description: `請求売上 ${invoice.invoiceNumber || ""} ${invoice.clientName || ""}`.trim(),
      status: "posted",
      sourceKey: `invoice-issued:${invoiceId}`,
      lines,
      createdAt: now(),
      updatedAt: now(),
    };
    assertRecordIsValid("journals", journalId, journal);
    const updatedInvoice = { ...invoice, status: invoice.status === "draft" ? "sent" : invoice.status, issueJournalId: journalId, updatedAt: now() };
    const timestamp = now();
    insertRecordAndAudit("journals", journalId, journal, userId, timestamp);
    insertRecordAndAudit("invoices", invoiceId, updatedInvoice, userId, timestamp);
    database.exec("COMMIT");
    return { invoice: updatedInvoice, journalId, alreadyPosted: false };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

/** Records a partial or full customer payment and reduces accounts receivable atomically. */
export function recordInvoicePayment(invoiceId: string, input: unknown, userId: string) {
  const paymentInput = z.object({
    requestId: z.string().uuid(),
    date: z.string(),
    amount: z.number().int().positive().safe(),
    depositAccountId: z.string().min(1).max(128),
    memo: z.string().max(500).optional(),
  }).parse(input);
  database.exec("BEGIN IMMEDIATE");
  try {
    const invoice = getRecord("invoices", invoiceId) as Record<string, any> | undefined;
    if (!invoice) throw new Error("請求書が見つかりません");
    if (!invoice.issueJournalId || !getRecord("journals", invoice.issueJournalId)) throw new Error("先に請求売上を帳簿へ登録してください");
    const previousPayment = (Array.isArray(invoice.payments) ? invoice.payments : []).find((payment: { id?: string }) => payment.id === paymentInput.requestId) as { date?: string; amount?: number; depositAccountId?: string; journalId?: string } | undefined;
    if (previousPayment) {
      if (previousPayment.date !== paymentInput.date || previousPayment.amount !== paymentInput.amount || previousPayment.depositAccountId !== paymentInput.depositAccountId) throw new Error("この入金リクエストIDは別の内容です");
      const receivedBefore = (invoice.payments as Array<{ amount: number }>).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      database.exec("COMMIT");
      return { invoice, payment: previousPayment, outstanding: Number(invoice.total) - receivedBefore, alreadyRecorded: true };
    }
    assertRealDate(paymentInput.date);
    const depositAccount = getRecord("accounts", paymentInput.depositAccountId) as { category?: string; code?: string } | undefined;
    if (!depositAccount || depositAccount.category !== "asset" || depositAccount.code === "108") throw new Error("入金先には売掛金以外の資産科目を指定してください");
    const payments = Array.isArray(invoice.payments) ? invoice.payments as Array<{ amount: number }> : [];
    const received = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const outstanding = Number(invoice.total) - received;
    if (!Number.isSafeInteger(outstanding) || outstanding <= 0) throw new Error("この請求書はすでに全額入金済みです");
    if (paymentInput.amount > outstanding) throw new Error(`入金額が残額（${outstanding}円）を超えています`);
    const paymentId = paymentInput.requestId;
    const journalId = randomUUID();
    const receivableAccountId = accountIdByCode("108");
    const journal = {
      id: journalId,
      date: paymentInput.date,
      debitAccountId: paymentInput.depositAccountId,
      creditAccountId: receivableAccountId,
      amount: paymentInput.amount,
      description: `請求入金 ${invoice.invoiceNumber || ""} ${invoice.clientName || ""}`.trim(),
      status: "posted",
      sourceKey: `invoice-payment:${invoiceId}:${paymentId}`,
      createdAt: now(),
      updatedAt: now(),
    };
    assertRecordIsValid("journals", journalId, journal);
    const payment = { id: paymentId, date: paymentInput.date, amount: paymentInput.amount, depositAccountId: paymentInput.depositAccountId, journalId, memo: paymentInput.memo, createdAt: now() };
    const nextPayments = [...payments, payment];
    const nextStatus = received + paymentInput.amount >= Number(invoice.total) ? "paid" : invoice.status === "overdue" ? "overdue" : "sent";
    const updatedInvoice = { ...invoice, payments: nextPayments, status: nextStatus, updatedAt: now() };
    const timestamp = now();
    insertRecordAndAudit("journals", journalId, journal, userId, timestamp);
    insertRecordAndAudit("invoices", invoiceId, updatedInvoice, userId, timestamp);
    database.exec("COMMIT");
    return { invoice: updatedInvoice, payment, outstanding: outstanding - paymentInput.amount };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function assertRecordIsValid(collection: RecordCollection, id: string, data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("保存データが不正です");
  const record = data as Record<string, unknown>;
  if (record.id !== id) throw new Error("URLとデータのIDが一致しません");
  if (collection === "accounts") {
    const account = z.object({ id: z.string().min(1), code: z.string().min(1), category: z.enum(["asset", "liability", "equity", "income", "expense"]), normalBalance: z.enum(["debit", "credit"]).optional() }).passthrough().parse(data);
    const existing = getRecord("accounts", id) as { code?: string; category?: string; normalBalance?: string } | undefined;
    if (existing && (existing.code !== account.code || existing.category !== account.category || existing.normalBalance !== account.normalBalance)) {
      const referenced = (listRecords("journals") as Array<Parameters<typeof journalLines>[0]>).some((journal) => journalLines(journal).some((line) => line.accountId === id));
      if (referenced) throw new Error("仕訳で使用中の勘定科目は区分・コードを変更できません");
    }
    return;
  }
  if (collection === "invoices") {
    const invoice = z.object({ id: z.string().min(1), status: z.enum(["draft", "sent", "paid", "overdue"]) }).passthrough().parse(data);
    const existing = getRecord("invoices", id) as { status?: string } | undefined;
    if (existing && existing.status !== "draft") throw new Error("送付済み請求書は編集できません。入金は入金記録から追加してください");
    if (invoice.status !== "draft" || invoice.issueJournalId || (Array.isArray(invoice.payments) && invoice.payments.length > 0)) throw new Error("送付済み状態や入金履歴は専用の請求処理から保存してください");
    return;
  }
  if (collection === "fiscalYears") {
    if (!/^\d{4}$/.test(id)) throw new Error("年度が不正です");
    const existing = getRecord("fiscalYears", id) as { status?: string; closed?: boolean } | undefined;
    const wasClosed = existing?.status === "closed" || existing?.closed === true;
    const isClosed = record.status === "closed" || record.closed === true;
    if (wasClosed && !isClosed && (typeof record.unlockReason !== "string" || record.unlockReason.trim().length < 10)) {
      throw new Error("年度締め解除には10文字以上の理由が必要です");
    }
    if (record.status !== undefined && record.status !== "open" && record.status !== "closed") throw new Error("年度状態が不正です");
    return;
  }
  if (collection !== "journals") return;
  const journal = journalSchema.parse(data);
  const date = new Date(`${journal.date}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== journal.date) throw new Error("実在しない日付です");
  const balanceError = validateBalancedJournal(journal);
  if (balanceError) throw new Error(balanceError);
  assertFiscalYearOpen(journal.date);
  const existing = getRecord("journals", id) as { date?: string; status?: unknown } | undefined;
  if (existing?.date) assertFiscalYearOpen(existing.date);
  for (const accountId of Array.from(new Set(journalLines(journal).map((line) => line.accountId)))) {
    if (!getRecord("accounts", accountId)) throw new Error("存在しない勘定科目は使用できません");
  }
  if (journal.sourceKey) {
    const duplicate = database.prepare("SELECT id FROM records WHERE collection = 'journals' AND id != ? AND json_extract(data, '$.sourceKey') = ?").get(id, journal.sourceKey) as { id?: string } | undefined;
    if (duplicate) throw new Error("同じ自動生成仕訳がすでに存在します");
  }
  if (journal.reversalOf && !getRecord("journals", journal.reversalOf)) {
    throw new Error("訂正対象の仕訳が見つかりません");
  }
  if (journal.reversalOf) {
    const original = getRecord("journals", journal.reversalOf) as Parameters<typeof journalLines>[0];
    const reversed = journalLines(original).map((line) => `${line.side === "debit" ? "credit" : "debit"}:${line.accountId}:${line.amount}`).sort();
    const actual = journalLines(journal).map((line) => `${line.side}:${line.accountId}:${line.amount}`).sort();
    if (reversed.length !== actual.length || reversed.some((line, index) => line !== actual[index])) throw new Error("反対仕訳の明細が元仕訳と一致しません");
    const duplicateReversal = database.prepare("SELECT id FROM records WHERE collection = 'journals' AND id != ? AND json_extract(data, '$.reversalOf') = ?").get(id, journal.reversalOf) as { id?: string } | undefined;
    if (duplicateReversal) throw new Error("この仕訳はすでに反対仕訳で訂正されています");
  }
  if (existing && (existing.status ?? "posted") !== "draft") {
    throw new Error("確定済み仕訳は編集できません。訂正は反対仕訳で行ってください");
  }
}

export function putRecord(collection: RecordCollection, id: string, data: unknown, userId: string) {
  database.exec("BEGIN IMMEDIATE");
  try {
    assertRecordIsValid(collection, id, data);
    const timestamp = now();
    const serialized = JSON.stringify(data);
    database.prepare(`
      INSERT INTO records(collection, id, data, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).run(collection, id, serialized, timestamp);
    database.prepare("INSERT INTO audit_events(id, user_id, action, collection, record_id, occurred_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(randomBytes(16).toString("hex"), userId, "upsert", collection, id, timestamp, serialized);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function deleteRecord(collection: RecordCollection, id: string, userId: string) {
  if (collection === "fiscalYears") throw new Error("年度設定は削除できません。解除理由を記録して開き直してください");
  if (collection === "invoices") {
    const invoice = getRecord("invoices", id) as { status?: string; issueJournalId?: string; payments?: unknown[] } | undefined;
    if (invoice && (invoice.status !== "draft" || invoice.issueJournalId || invoice.payments?.length)) throw new Error("送付済み、帳簿登録済み、または入金履歴のある請求書は削除できません");
  }
  if (collection === "accounts") {
    const referenced = (listRecords("journals") as Array<Parameters<typeof journalLines>[0]>).some((journal) =>
      journalLines(journal).some((line) => line.accountId === id));
    if (referenced) throw new Error("仕訳で使用中の勘定科目は削除できません");
  }
  if (collection === "journals") {
    const existing = getRecord("journals", id) as { date?: string; status?: unknown } | undefined;
    if (existing?.date) assertFiscalYearOpen(existing.date);
    if (existing && (existing.status ?? "posted") !== "draft") {
      throw new Error("確定済み仕訳は削除できません。訂正は反対仕訳で行ってください");
    }
  }
  const timestamp = now();
  database.prepare("DELETE FROM records WHERE collection = ? AND id = ?").run(collection, id);
  database.prepare("INSERT INTO audit_events(id, user_id, action, collection, record_id, occurred_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(randomBytes(16).toString("hex"), userId, "delete", collection, id, timestamp);
}

export function clearRecords(collection: RecordCollection, userId: string) {
  if (collection === "journals") throw new Error("仕訳帳の一括削除は許可されていません");
  if (collection === "fiscalYears") throw new Error("年度設定の一括削除は許可されていません");
  if (collection === "invoices" && (listRecords("invoices") as Array<{ status?: string; issueJournalId?: string; payments?: unknown[] }>).some((invoice) => invoice.status !== "draft" || invoice.issueJournalId || invoice.payments?.length)) throw new Error("送付済み、帳簿登録済み、または入金履歴のある請求書があるため一括削除できません");
  if (collection === "accounts" && listRecords("journals").length > 0) throw new Error("仕訳があるため勘定科目を一括削除できません");
  const timestamp = now();
  database.prepare("DELETE FROM records WHERE collection = ?").run(collection);
  database.prepare("INSERT INTO audit_events(id, user_id, action, collection, occurred_at) VALUES (?, ?, ?, ?, ?)")
    .run(randomBytes(16).toString("hex"), userId, "clear", collection, timestamp);
}

export function putRecordsAtomic(collection: RecordCollection, records: Array<{ id: string; data: unknown }>, userId: string) {
  const timestamp = now();
  const put = database.prepare(`
    INSERT INTO records(collection, id, data, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `);
  const audit = database.prepare("INSERT INTO audit_events(id, user_id, action, collection, record_id, occurred_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)");
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const record of records) {
      assertRecordIsValid(collection, record.id, record.data);
      const serialized = JSON.stringify(record.data);
      put.run(collection, record.id, serialized, timestamp);
      audit.run(randomBytes(16).toString("hex"), userId, "upsert", collection, record.id, timestamp, serialized);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function passwordDigest(password: string, salt: Buffer): string {
  return `${salt.toString("hex")}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function setAdminPassword(password: string) {
  if (password.length < 12) throw new Error("パスワードは12文字以上にしてください");
  const salt = randomBytes(16);
  const digest = passwordDigest(password, salt);
  database.prepare("INSERT INTO users(id, username, password_hash, created_at) VALUES (?, ?, ?, ?)").run("owner", "owner", digest, now());
}

export function hasAdminUser(): boolean {
  return Boolean(database.prepare("SELECT 1 FROM users WHERE id = 'owner'").get());
}

export function verifyAdminPassword(password: string): boolean {
  const row = database.prepare("SELECT password_hash FROM users WHERE id = 'owner'").get() as { password_hash?: string } | undefined;
  if (!row?.password_hash) return false;
  const [saltHex, expectedHex] = row.password_hash.split(":");
  if (!saltHex || !expectedHex) return false;
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createSession(): { token: string; csrfToken: string; expiresAt: string } {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
  database.prepare("INSERT INTO sessions(token_hash, user_id, expires_at, csrf_token) VALUES (?, ?, ?, ?)").run(scryptSync(token, "kaikei-session", 32).toString("hex"), "owner", expiresAt, csrfToken);
  return { token, csrfToken, expiresAt };
}

export function getSession(token: string | undefined): { userId: string; csrfToken: string } | undefined {
  if (!token) return undefined;
  const hash = scryptSync(token, "kaikei-session", 32).toString("hex");
  const row = database.prepare("SELECT user_id, expires_at, csrf_token FROM sessions WHERE token_hash = ?").get(hash) as { user_id?: string; expires_at?: string; csrf_token?: string } | undefined;
  if (!row?.user_id || !row.expires_at || !row.csrf_token || new Date(row.expires_at).getTime() <= Date.now()) return undefined;
  return { userId: row.user_id, csrfToken: row.csrf_token };
}

export function deleteSession(token: string | undefined) {
  if (!token) return;
  const hash = scryptSync(token, "kaikei-session", 32).toString("hex");
  database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash);
}

export function createEncryptedBackup(userId: string): { file: string; createdAt: string; recordCount: number } {
  const createdAt = now();
  const records = database.prepare("SELECT collection, id, data, updated_at FROM records ORDER BY collection, id").all();
  const audit = database.prepare("SELECT id, user_id, action, collection, record_id, occurred_at, data FROM audit_events ORDER BY occurred_at, id").all();
  const users = database.prepare("SELECT id, username, password_hash, created_at FROM users ORDER BY id").all();
  const documents: Array<{ name: string; sha256: string; data: string }> = [];
  function collectDocuments(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) collectDocuments(fullPath);
      else if (entry.isFile()) {
        const raw = fs.readFileSync(fullPath);
        documents.push({ name: path.relative(dataPaths.documents, fullPath).split(path.sep).join("/"), sha256: createHash("sha256").update(raw).digest("hex"), data: raw.toString("base64") });
      } else throw new Error("証憑領域に通常ファイル以外が含まれています");
    }
  }
  collectDocuments(dataPaths.documents);
  documents.sort((a, b) => a.name.localeCompare(b.name));
  const payload = Buffer.from(JSON.stringify({ version: 2, createdAt, records, audit, users, documents }));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getBackupKey(), iv);
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  const filename = `kaikei-${createdAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomBytes(4).toString("hex")}.backup`;
  const file = path.join(dataPaths.backups, filename);
  fs.writeFileSync(file, Buffer.concat([Buffer.from("LKQ1"), iv, tag, encrypted]), { mode: 0o600 });
  database.prepare("INSERT INTO audit_events(id, user_id, action, occurred_at, data) VALUES (?, ?, ?, ?, ?)")
    .run(randomBytes(16).toString("hex"), userId, "backup-created", createdAt, JSON.stringify({ file: filename, recordCount: records.length }));
  return { file, createdAt, recordCount: records.length };
}

export function listEncryptedBackups() {
  return fs.readdirSync(dataPaths.backups).filter((name) => name.endsWith(".backup")).sort().reverse().map((name) => {
    const file = path.join(dataPaths.backups, name);
    return { name, size: fs.statSync(file).size, updatedAt: fs.statSync(file).mtime.toISOString() };
  });
}

type BackupPayload = {
  version: number;
  createdAt: string;
  records: Array<{ collection: string; id: string; data: string; updated_at: string }>;
  audit: Array<{ id?: string; user_id?: string; action: string; collection?: string; record_id?: string; occurred_at: string; data?: string }>;
  users?: Array<{ id: string; username: string; password_hash: string; created_at: string }>;
  documents?: Array<{ name: string; sha256: string; data: string }>;
};

function readBackupPayload(name: string): BackupPayload {
  // Never let an API parameter select a path outside of the backup directory.
  if (!/^[A-Za-z0-9-]+\.backup$/.test(name) || path.basename(name) !== name) {
    throw new Error("バックアップ名が不正です");
  }
  const raw = fs.readFileSync(path.join(dataPaths.backups, name));
  if (raw.length < 32 || raw.subarray(0, 4).toString("utf8") !== "LKQ1") {
    throw new Error("バックアップ形式が不正です");
  }
  const decipher = createDecipheriv("aes-256-gcm", getBackupKey(), raw.subarray(4, 16));
  decipher.setAuthTag(raw.subarray(16, 32));
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat([decipher.update(raw.subarray(32)), decipher.final()]).toString("utf8"));
  } catch {
    throw new Error("バックアップを復号できません。鍵またはファイルを確認してください");
  }
  if (!value || typeof value !== "object") throw new Error("バックアップ内容が不正です");
  const payload = value as Partial<BackupPayload>;
  if (![1, 2].includes(payload.version ?? -1) || !Array.isArray(payload.records) || !Array.isArray(payload.audit) || typeof payload.createdAt !== "string") {
    throw new Error("バックアップ内容が不正です");
  }
  if (payload.version === 2 && (!Array.isArray(payload.documents) || !Array.isArray(payload.users))) throw new Error("バックアップ内容が不正です");
  for (const record of payload.records) {
    if (!record || typeof record.collection !== "string" || typeof record.id !== "string" || typeof record.data !== "string" || typeof record.updated_at !== "string") {
      throw new Error("バックアップ内のレコードが不正です");
    }
    assertCollection(record.collection);
    JSON.parse(record.data);
  }
  for (const document of payload.documents ?? []) {
    if (!document || typeof document.name !== "string" || !/^[^\\/]+(?:\/[^\\/]+)*$/.test(document.name) || document.name.split("/").some((part) => part === "." || part === "..") || !/^[a-f0-9]{64}$/.test(document.sha256) || typeof document.data !== "string") {
      throw new Error("バックアップ内の証憑が不正です");
    }
    const raw = Buffer.from(document.data, "base64");
    if (createHash("sha256").update(raw).digest("hex") !== document.sha256) throw new Error("証憑のハッシュが一致しません");
  }
  return payload as BackupPayload;
}

/**
 * Restores a backup into an isolated SQLite database and verifies record counts.
 * The production database is never opened for writing by this operation.
 */
export function verifyEncryptedBackup(name: string) {
  const payload = readBackupPayload(name);
  const tempRoot = fs.mkdtempSync(path.join(dataPaths.root, "restore-verify-"));
  const tempDatabase = path.join(tempRoot, "verification.sqlite");
  let verificationDb: DatabaseSync | undefined;
  try {
    verificationDb = new DatabaseSync(tempDatabase);
    verificationDb.exec(`
      PRAGMA journal_mode = DELETE;
      CREATE TABLE records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (collection, id));
      CREATE TABLE audit_events (action TEXT NOT NULL, collection TEXT, record_id TEXT, occurred_at TEXT NOT NULL);
    `);
    const insertRecord = verificationDb.prepare("INSERT INTO records(collection, id, data, updated_at) VALUES (?, ?, ?, ?)");
    const insertAudit = verificationDb.prepare("INSERT INTO audit_events(action, collection, record_id, occurred_at) VALUES (?, ?, ?, ?)");
    verificationDb.exec("BEGIN IMMEDIATE");
    try {
      for (const record of payload.records) insertRecord.run(record.collection, record.id, record.data, record.updated_at);
      for (const event of payload.audit) {
        if (!event || typeof event.action !== "string" || typeof event.occurred_at !== "string") throw new Error("バックアップ内の監査記録が不正です");
        insertAudit.run(event.action, event.collection ?? null, event.record_id ?? null, event.occurred_at);
      }
      verificationDb.exec("COMMIT");
    } catch (error) {
      verificationDb.exec("ROLLBACK");
      throw error;
    }
    const recordCount = (verificationDb.prepare("SELECT COUNT(*) AS count FROM records").get() as { count: number }).count;
    const auditEventCount = (verificationDb.prepare("SELECT COUNT(*) AS count FROM audit_events").get() as { count: number }).count;
    if (recordCount !== payload.records.length || auditEventCount !== payload.audit.length) throw new Error("復元後の件数照合に失敗しました");
    for (const document of payload.documents ?? []) {
      const destination = path.join(tempRoot, "documents", ...document.name.split("/"));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, Buffer.from(document.data, "base64"));
      if (createHash("sha256").update(fs.readFileSync(destination)).digest("hex") !== document.sha256) throw new Error("証憑の復元検証に失敗しました");
    }
    return { name, createdAt: payload.createdAt, recordCount, auditEventCount, documentCount: payload.documents?.length ?? 0, verifiedAt: now(), legacyBackup: payload.version === 1 };
  } finally {
    verificationDb?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
