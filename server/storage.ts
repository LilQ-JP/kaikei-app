import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { createCipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

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
    expires_at TEXT NOT NULL
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

export function putRecord(collection: RecordCollection, id: string, data: unknown, userId: string) {
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
  const timestamp = now();
  database.prepare("DELETE FROM records WHERE collection = ? AND id = ?").run(collection, id);
  database.prepare("INSERT INTO audit_events(id, user_id, action, collection, record_id, occurred_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(randomBytes(16).toString("hex"), userId, "delete", collection, id, timestamp);
}

export function clearRecords(collection: RecordCollection, userId: string) {
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

export function createSession(): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
  database.prepare("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(scryptSync(token, "kaikei-session", 32).toString("hex"), "owner", expiresAt);
  return { token, expiresAt };
}

export function getSession(token: string | undefined): { userId: string } | undefined {
  if (!token) return undefined;
  const hash = scryptSync(token, "kaikei-session", 32).toString("hex");
  const row = database.prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?").get(hash) as { user_id?: string; expires_at?: string } | undefined;
  if (!row?.user_id || !row.expires_at || new Date(row.expires_at).getTime() <= Date.now()) return undefined;
  return { userId: row.user_id };
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
