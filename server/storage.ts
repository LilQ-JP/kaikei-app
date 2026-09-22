import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";

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
  debitAccountId: z.string().min(1).max(128),
  creditAccountId: z.string().min(1).max(128),
  amount: z.number().int().positive().safe(),
  description: z.string().max(1000),
  status: z.enum(["draft", "posted", "reversed"]).optional(),
  reversalOf: z.string().min(1).max(128).optional(),
  sourceKey: z.string().min(1).max(256).optional(),
}).passthrough();

function assertRecordIsValid(collection: RecordCollection, id: string, data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("保存データが不正です");
  const record = data as Record<string, unknown>;
  if (record.id !== id) throw new Error("URLとデータのIDが一致しません");
  if (collection !== "journals") return;
  const journal = journalSchema.parse(data);
  if (journal.debitAccountId === journal.creditAccountId) throw new Error("借方と貸方に同じ科目は指定できません");
  for (const accountId of [journal.debitAccountId, journal.creditAccountId]) {
    if (!getRecord("accounts", accountId)) throw new Error("存在しない勘定科目は使用できません");
  }
  if (journal.sourceKey) {
    const duplicate = database.prepare("SELECT id FROM records WHERE collection = 'journals' AND id != ? AND json_extract(data, '$.sourceKey') = ?").get(id, journal.sourceKey) as { id?: string } | undefined;
    if (duplicate) throw new Error("同じ自動生成仕訳がすでに存在します");
  }
  if (journal.reversalOf && !getRecord("journals", journal.reversalOf)) {
    throw new Error("訂正対象の仕訳が見つかりません");
  }
  const existing = getRecord("journals", id) as { status?: unknown } | undefined;
  if (existing && (existing.status ?? "posted") !== "draft") {
    throw new Error("確定済み仕訳は編集できません。訂正は反対仕訳で行ってください");
  }
}

export function putRecord(collection: RecordCollection, id: string, data: unknown, userId: string) {
  assertRecordIsValid(collection, id, data);
  const timestamp = now();
  const serialized = JSON.stringify(data);
  database.prepare(`
    INSERT INTO records(collection, id, data, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(collection, id, serialized, timestamp);
  database.prepare("INSERT INTO audit_events(id, user_id, action, collection, record_id, occurred_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(randomBytes(16).toString("hex"), userId, "upsert", collection, id, timestamp, serialized);
}

export function deleteRecord(collection: RecordCollection, id: string, userId: string) {
  if (collection === "journals") {
    const existing = getRecord("journals", id) as { status?: unknown } | undefined;
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
  const audit = database.prepare("SELECT action, collection, record_id, occurred_at FROM audit_events ORDER BY occurred_at DESC LIMIT 1000").all();
  const payload = Buffer.from(JSON.stringify({ version: 1, createdAt, records, audit }));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getBackupKey(), iv);
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  const filename = `kaikei-${createdAt.replace(/[-:.TZ]/g, "").slice(0, 14)}.backup`;
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
  audit: Array<{ action: string; collection?: string; record_id?: string; occurred_at: string }>;
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
  if (payload.version !== 1 || !Array.isArray(payload.records) || !Array.isArray(payload.audit) || typeof payload.createdAt !== "string") {
    throw new Error("バックアップ内容が不正です");
  }
  for (const record of payload.records) {
    if (!record || typeof record.collection !== "string" || typeof record.id !== "string" || typeof record.data !== "string" || typeof record.updated_at !== "string") {
      throw new Error("バックアップ内のレコードが不正です");
    }
    assertCollection(record.collection);
    JSON.parse(record.data);
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
    return { name, createdAt: payload.createdAt, recordCount, auditEventCount, verifiedAt: now() };
  } finally {
    verificationDb?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
