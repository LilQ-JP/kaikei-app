/**
 * IndexedDB Database for フリーランス会計
 * macOS Ledger Design — Apple Design × 会計ツール
 *
 * All data is stored locally in the browser using IndexedDB.
 * No server-side storage is used.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { compareJournalOrder } from "@shared/accounting";

const USE_REMOTE_DB = import.meta.env.PROD || import.meta.env.VITE_REMOTE_DB === "true";
let csrfToken: string | undefined;

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  const response = await fetch("/api/v1/auth/session", { credentials: "same-origin" });
  if (!response.ok) throw new Error("ログインが必要です。再度ログインしてください。");
  const session = await response.json() as { csrfToken?: unknown };
  if (typeof session.csrfToken !== "string" || session.csrfToken.length < 20) {
    throw new Error("安全なセッションを確認できません。再度ログインしてください。");
  }
  csrfToken = session.csrfToken;
  return csrfToken;
}

/** For the few non-CRUD API calls (backup/restore verification). */
export async function getApiCsrfToken(): Promise<string> {
  return getCsrfToken();
}

async function remoteRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) headers.set("X-CSRF-Token", await getCsrfToken());
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: "same-origin",
    headers,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `APIエラー (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const remoteCollection = (collection: string) => `/records/${collection}`;

/* ─── Data Models ─── */

export interface AccountItem {
  id: string;
  code: string; // e.g. "100", "200"
  name: string;
  category: "asset" | "liability" | "equity" | "income" | "expense";
  subcategory: string;
  isDefault: boolean;
  normalBalance?: "debit" | "credit";
  taxRate?: number;
  description?: string;
  createdAt: string;
}

export interface JournalEntry {
  id: string;
  date: string; // YYYY-MM-DD
  debitAccountId: string;
  creditAccountId: string;
  amount: number;
  lines?: Array<{ side: "debit" | "credit"; accountId: string; amount: number; taxCategory?: JournalEntry["taxCategory"]; taxRate?: number; taxIncluded?: boolean }>;
  description: string;
  memo?: string;
  receiptId?: string;
  paymentMethod?: string; // カード名・決済手段（例: 楽天カード, PayPay, 現金）
  taxCategory?: "taxable-sales" | "taxable-purchase" | "taxable-sales-reduced" | "taxable-purchase-reduced" | "exempt" | "non-taxable" | "out-of-scope";
  taxRate?: number;
  taxIncluded?: boolean;
  vendorId?: string;
  sourceDocumentId?: string;
  sourceKey?: string;
  tags?: string[];
  /** 下書きだけを直接編集・削除でき、確定後の訂正は反対仕訳で残す。 */
  status?: "draft" | "posted" | "reversed";
  reversalOf?: string;
  revision?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  clientName: string;
  clientPostalCode?: string;
  clientAddress?: string;
  clientBuilding?: string;
  clientEmail?: string;
  issueDate: string;
  dueDate: string;
  items: InvoiceItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  taxBreakdown?: { taxRate: number; taxableAmount: number; taxAmount: number }[];
  status: "draft" | "sent" | "paid" | "overdue";
  notes?: string;
  bankInfo?: string;
  bankName?: string;
  bankBranch?: string;
  bankAccountType?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  issueJournalId?: string;
  payments?: InvoicePayment[];
  createdAt: string;
  updatedAt: string;
}

export interface InvoicePayment {
  id: string;
  date: string;
  amount: number;
  depositAccountId: string;
  journalId: string;
  memo?: string;
  createdAt: string;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxRate?: number;
}

export interface Receipt {
  id: string;
  imageData: string; // base64 encoded
  fileName: string;
  date: string;
  amount?: number;
  vendor?: string;
  description?: string;
  journalEntryId?: string;
  createdAt: string;
}

export interface BusinessProfile {
  id: string;
  businessName: string;
  ownerName: string;
  /** 既存データとの互換用に、住所を1行へ結合した値も保持する。 */
  address?: string;
  postalCode?: string;
  addressLine?: string;
  building?: string;
  phone?: string;
  email?: string;
  taxId?: string; // 適格請求書発行事業者番号
  bankName?: string;
  bankBranch?: string;
  bankAccountType?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  fiscalYearStart: number; // month 1-12
  taxFilingType: "blue" | "white"; // 青色申告 / 白色申告
  logoData?: string; // base64 encoded logo image
  createdAt: string;
  updatedAt: string;
}

export interface Vendor {
  id: string;
  name: string;
  shortName?: string;
  address?: string;
  phone?: string;
  email?: string;
  defaultDebitAccountId?: string;
  defaultCreditAccountId?: string;
  defaultPaymentMethod?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  id: string;
  currentFiscalYear: number;
  theme: "light" | "dark";
  currency: string;
  dateFormat: string;
  lastBackup?: string;
}

/* ─── DB Schema ─── */

interface KaikeiDB extends DBSchema {
  accounts: {
    key: string;
    value: AccountItem;
    indexes: {
      "by-category": string;
      "by-code": string;
    };
  };
  journals: {
    key: string;
    value: JournalEntry;
    indexes: {
      "by-date": string;
      "by-debit": string;
      "by-credit": string;
    };
  };
  invoices: {
    key: string;
    value: Invoice;
    indexes: {
      "by-date": string;
      "by-status": string;
    };
  };
  receipts: {
    key: string;
    value: Receipt;
    indexes: {
      "by-date": string;
      "by-journal": string;
    };
  };
  profile: {
    key: string;
    value: BusinessProfile;
  };
  settings: {
    key: string;
    value: AppSettings;
  };
  vendors: {
    key: string;
    value: Vendor;
    indexes: {
      "by-name": string;
    };
  };
}

/* ─── Default Accounts (勘定科目マスタ) ─── */

export const DEFAULT_ACCOUNTS: Omit<AccountItem, "id" | "createdAt">[] = [
  // 資産 (Assets)
  { code: "100", name: "現金", category: "asset", subcategory: "流動資産", isDefault: true },
  { code: "102", name: "普通預金", category: "asset", subcategory: "流動資産", isDefault: true },
  { code: "104", name: "当座預金", category: "asset", subcategory: "流動資産", isDefault: true },
  { code: "108", name: "売掛金", category: "asset", subcategory: "流動資産", isDefault: true },
  { code: "110", name: "未収入金", category: "asset", subcategory: "流動資産", isDefault: true },
  { code: "112", name: "前払費用", category: "asset", subcategory: "流動資産", isDefault: true },
  { code: "114", name: "貯蔵品", category: "asset", subcategory: "流動資産", isDefault: true },
  { code: "116", name: "仮払金", category: "asset", subcategory: "流動資産", isDefault: true },
  { code: "118", name: "立替金", category: "asset", subcategory: "流動資産", isDefault: true },
  { code: "150", name: "建物", category: "asset", subcategory: "固定資産", isDefault: true },
  { code: "152", name: "建物附属設備", category: "asset", subcategory: "固定資産", isDefault: true },
  { code: "154", name: "車両運搬具", category: "asset", subcategory: "固定資産", isDefault: true },
  { code: "156", name: "工具器具備品", category: "asset", subcategory: "固定資産", isDefault: true },
  { code: "158", name: "ソフトウェア", category: "asset", subcategory: "固定資産", isDefault: true },
  { code: "159", name: "減価償却累計額", category: "asset", subcategory: "固定資産評価勘定", normalBalance: "credit", isDefault: true },
  { code: "170", name: "事業主貸", category: "asset", subcategory: "事業主勘定", isDefault: true },

  // 負債 (Liabilities)
  { code: "200", name: "買掛金", category: "liability", subcategory: "流動負債", isDefault: true },
  { code: "202", name: "未払金", category: "liability", subcategory: "流動負債", isDefault: true },
  { code: "204", name: "未払費用", category: "liability", subcategory: "流動負債", isDefault: true },
  { code: "206", name: "前受金", category: "liability", subcategory: "流動負債", isDefault: true },
  { code: "208", name: "預り金", category: "liability", subcategory: "流動負債", isDefault: true },
  { code: "210", name: "仮受金", category: "liability", subcategory: "流動負債", isDefault: true },
  { code: "211", name: "仮受消費税", category: "liability", subcategory: "流動負債", isDefault: true },
  { code: "212", name: "未払消費税", category: "liability", subcategory: "流動負債", isDefault: true },
  { code: "250", name: "借入金", category: "liability", subcategory: "固定負債", isDefault: true },
  { code: "270", name: "事業主借", category: "liability", subcategory: "事業主勘定", isDefault: true },

  // 純資産 (Equity)
  { code: "300", name: "元入金", category: "equity", subcategory: "純資産", isDefault: true },

  // 収益 (Income)
  { code: "400", name: "売上高", category: "income", subcategory: "営業収益", isDefault: true },
  { code: "402", name: "雑収入", category: "income", subcategory: "営業外収益", isDefault: true },
  { code: "404", name: "受取利息", category: "income", subcategory: "営業外収益", isDefault: true },

  // 費用 (Expenses)
  { code: "500", name: "仕入高", category: "expense", subcategory: "売上原価", isDefault: true },
  { code: "510", name: "租税公課", category: "expense", subcategory: "経費", isDefault: true },
  { code: "512", name: "荷造運賃", category: "expense", subcategory: "経費", isDefault: true },
  { code: "514", name: "水道光熱費", category: "expense", subcategory: "経費", isDefault: true },
  { code: "516", name: "旅費交通費", category: "expense", subcategory: "経費", isDefault: true },
  { code: "518", name: "通信費", category: "expense", subcategory: "経費", isDefault: true },
  { code: "520", name: "広告宣伝費", category: "expense", subcategory: "経費", isDefault: true },
  { code: "522", name: "接待交際費", category: "expense", subcategory: "経費", isDefault: true },
  { code: "524", name: "損害保険料", category: "expense", subcategory: "経費", isDefault: true },
  { code: "526", name: "修繕費", category: "expense", subcategory: "経費", isDefault: true },
  { code: "528", name: "消耗品費", category: "expense", subcategory: "経費", isDefault: true },
  { code: "530", name: "減価償却費", category: "expense", subcategory: "経費", isDefault: true },
  { code: "532", name: "福利厚生費", category: "expense", subcategory: "経費", isDefault: true },
  { code: "534", name: "給料賃金", category: "expense", subcategory: "経費", isDefault: true },
  { code: "536", name: "外注工賃", category: "expense", subcategory: "経費", isDefault: true },
  { code: "538", name: "利子割引料", category: "expense", subcategory: "経費", isDefault: true },
  { code: "540", name: "地代家賃", category: "expense", subcategory: "経費", isDefault: true },
  { code: "542", name: "貸倒金", category: "expense", subcategory: "経費", isDefault: true },
  { code: "544", name: "雑費", category: "expense", subcategory: "経費", isDefault: true },
  { code: "546", name: "新聞図書費", category: "expense", subcategory: "経費", isDefault: true },
  { code: "548", name: "支払手数料", category: "expense", subcategory: "経費", isDefault: true },
  { code: "550", name: "車両費", category: "expense", subcategory: "経費", isDefault: true },
  { code: "552", name: "会議費", category: "expense", subcategory: "経費", isDefault: true },
  { code: "554", name: "研修費", category: "expense", subcategory: "経費", isDefault: true },
];

/* ─── Database Instance ─── */

let dbInstance: IDBPDatabase<KaikeiDB> | null = null;

export async function getDB(): Promise<IDBPDatabase<KaikeiDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<KaikeiDB>("kaikei-db", 1, {
    upgrade(db) {
      // Accounts store
      const accountStore = db.createObjectStore("accounts", { keyPath: "id" });
      accountStore.createIndex("by-category", "category");
      accountStore.createIndex("by-code", "code");

      // Journals store
      const journalStore = db.createObjectStore("journals", { keyPath: "id" });
      journalStore.createIndex("by-date", "date");
      journalStore.createIndex("by-debit", "debitAccountId");
      journalStore.createIndex("by-credit", "creditAccountId");

      // Invoices store
      const invoiceStore = db.createObjectStore("invoices", { keyPath: "id" });
      invoiceStore.createIndex("by-date", "issueDate");
      invoiceStore.createIndex("by-status", "status");

      // Receipts store
      const receiptStore = db.createObjectStore("receipts", { keyPath: "id" });
      receiptStore.createIndex("by-date", "date");
      receiptStore.createIndex("by-journal", "journalEntryId");

      // Profile store
      db.createObjectStore("profile", { keyPath: "id" });

      // Settings store
      db.createObjectStore("settings", { keyPath: "id" });

      // Vendors store
      const vendorStore = db.createObjectStore("vendors", { keyPath: "id" });
      vendorStore.createIndex("by-name", "name");
    },
  });

  return dbInstance;
}

/* ─── Initialization ─── */

export async function initializeDB(): Promise<void> {
  if (USE_REMOTE_DB) {
    const accounts = await remoteRequest<AccountItem[]>(remoteCollection("accounts"));
    const now = new Date().toISOString();
    const missing = DEFAULT_ACCOUNTS.filter((account) => !accounts.some((existing) => existing.code === account.code));
    if (missing.length > 0) {
      await Promise.all(missing.map((account) => {
        const id = crypto.randomUUID();
        return remoteRequest<void>(`${remoteCollection("accounts")}/${id}`, { method: "PUT", body: JSON.stringify({ ...account, id, createdAt: now }) });
      }));
    }
    const settings = await remoteRequest<AppSettings[]>(remoteCollection("settings"));
    if (settings.length === 0) await remoteRequest<void>(`${remoteCollection("settings")}/default`, { method: "PUT", body: JSON.stringify({ id: "default", currentFiscalYear: new Date().getFullYear(), theme: "light", currency: "JPY", dateFormat: "YYYY-MM-DD" }) });
    return;
  }
  const db = await getDB();

  // Add newly introduced default accounts without overwriting user data.
  const existingAccounts = await db.getAll("accounts");
  const missing = DEFAULT_ACCOUNTS.filter((account) => !existingAccounts.some((existing) => existing.code === account.code));
  if (missing.length > 0) {
    const tx = db.transaction("accounts", "readwrite");
    const now = new Date().toISOString();
    for (const account of missing) await tx.store.put({ ...account, id: crypto.randomUUID(), createdAt: now });
    await tx.done;
  }

  // Check if settings exist
  const settings = await db.get("settings", "default");
  if (!settings) {
    await db.put("settings", {
      id: "default",
      currentFiscalYear: new Date().getFullYear(),
      theme: "light",
      currency: "JPY",
      dateFormat: "YYYY-MM-DD",
    });
  }
}

/* ─── CRUD Helpers ─── */

// Accounts
export async function getAllAccounts(): Promise<AccountItem[]> {
  if (USE_REMOTE_DB) return remoteRequest<AccountItem[]>(remoteCollection("accounts"));
  const db = await getDB();
  return db.getAll("accounts");
}

export async function getAccountsByCategory(category: AccountItem["category"]): Promise<AccountItem[]> {
  if (USE_REMOTE_DB) return (await getAllAccounts()).filter((account) => account.category === category);
  const db = await getDB();
  return db.getAllFromIndex("accounts", "by-category", category);
}

export async function getAccount(id: string): Promise<AccountItem | undefined> {
  if (USE_REMOTE_DB) return remoteRequest<AccountItem | undefined>(`${remoteCollection("accounts")}/${id}`).catch((error) => error.message.includes("APIエラー (404)") ? undefined : Promise.reject(error));
  const db = await getDB();
  return db.get("accounts", id);
}

export async function putAccount(account: AccountItem): Promise<void> {
  if (USE_REMOTE_DB) return remoteRequest<void>(`${remoteCollection("accounts")}/${account.id}`, { method: "PUT", body: JSON.stringify(account) });
  const db = await getDB();
  await db.put("accounts", account);
}

export async function deleteAccount(id: string): Promise<void> {
  if (USE_REMOTE_DB) return remoteRequest<void>(`${remoteCollection("accounts")}/${id}`, { method: "DELETE" });
  const db = await getDB();
  await db.delete("accounts", id);
}

// Journals
export async function getAllJournals(): Promise<JournalEntry[]> {
  if (USE_REMOTE_DB) return remoteRequest<JournalEntry[]>(remoteCollection("journals"));
  const db = await getDB();
  const all = await db.getAll("journals");
  return all.sort((a, b) => compareJournalOrder(b, a));
}

export async function getJournalsByDateRange(start: string, end: string): Promise<JournalEntry[]> {
  if (USE_REMOTE_DB) return (await getAllJournals()).filter((journal) => journal.date >= start && journal.date <= end).sort(compareJournalOrder);
  const db = await getDB();
  const range = IDBKeyRange.bound(start, end);
  const results = await db.getAllFromIndex("journals", "by-date", range);
  return results.sort(compareJournalOrder);
}

export async function putJournal(entry: JournalEntry): Promise<void> {
  if (USE_REMOTE_DB) return remoteRequest<void>(`${remoteCollection("journals")}/${entry.id}`, { method: "PUT", body: JSON.stringify(entry) });
  const db = await getDB();
  await db.put("journals", entry);
}

export async function putJournalsAtomic(entries: JournalEntry[]): Promise<void> {
  if (USE_REMOTE_DB) {
    await remoteRequest<void>("/records/batch", { method: "POST", body: JSON.stringify({ collection: "journals", records: entries.map((data) => ({ id: data.id, data })) }) });
    return;
  }
  const db = await getDB();
  const tx = db.transaction("journals", "readwrite");
  for (const entry of entries) await tx.store.put(entry);
  await tx.done;
}

export async function deleteJournal(id: string): Promise<void> {
  if (USE_REMOTE_DB) return remoteRequest<void>(`${remoteCollection("journals")}/${id}`, { method: "DELETE" });
  const db = await getDB();
  await db.delete("journals", id);
}

// Invoices
export async function getAllInvoices(): Promise<Invoice[]> {
  if (USE_REMOTE_DB) return remoteRequest<Invoice[]>(remoteCollection("invoices"));
  const db = await getDB();
  const all = await db.getAll("invoices");
  return all.sort((a, b) => b.issueDate.localeCompare(a.issueDate));
}

export async function getInvoice(id: string): Promise<Invoice | undefined> {
  if (USE_REMOTE_DB) return remoteRequest<Invoice | undefined>(`${remoteCollection("invoices")}/${id}`).catch((error) => error.message.includes("APIエラー (404)") ? undefined : Promise.reject(error));
  const db = await getDB();
  return db.get("invoices", id);
}

export async function putInvoice(invoice: Invoice): Promise<void> {
  if (USE_REMOTE_DB) return remoteRequest<void>(`${remoteCollection("invoices")}/${invoice.id}`, { method: "PUT", body: JSON.stringify(invoice) });
  const db = await getDB();
  await db.put("invoices", invoice);
}

export async function postInvoiceToLedger(invoiceId: string): Promise<{ invoice: Invoice; journalId: string; alreadyPosted: boolean }> {
  if (!USE_REMOTE_DB) throw new Error("請求の帳簿登録にはサーバー接続が必要です");
  return remoteRequest(`/invoices/${encodeURIComponent(invoiceId)}/issue`, { method: "POST", body: "{}" });
}

export async function recordInvoicePayment(invoiceId: string, input: { requestId: string; date: string; amount: number; depositAccountId: string; memo?: string }): Promise<{ invoice: Invoice; payment: InvoicePayment; outstanding: number; alreadyRecorded?: boolean }> {
  if (!USE_REMOTE_DB) throw new Error("入金の帳簿登録にはサーバー接続が必要です");
  return remoteRequest(`/invoices/${encodeURIComponent(invoiceId)}/payments`, { method: "POST", body: JSON.stringify(input) });
}

export async function deleteInvoice(id: string): Promise<void> {
  if (USE_REMOTE_DB) return remoteRequest<void>(`${remoteCollection("invoices")}/${id}`, { method: "DELETE" });
  const db = await getDB();
  await db.delete("invoices", id);
}

// Receipts
export async function getAllReceipts(): Promise<Receipt[]> {
  if (USE_REMOTE_DB) return remoteRequest<Receipt[]>(remoteCollection("receipts"));
  const db = await getDB();
  const all = await db.getAll("receipts");
  return all.sort((a, b) => b.date.localeCompare(a.date));
}

export async function getReceipt(id: string): Promise<Receipt | undefined> {
  if (USE_REMOTE_DB) return remoteRequest<Receipt | undefined>(`${remoteCollection("receipts")}/${id}`).catch((error) => error.message.includes("APIエラー (404)") ? undefined : Promise.reject(error));
  const db = await getDB();
  return db.get("receipts", id);
}

export async function getReceiptByJournalId(journalId: string): Promise<Receipt | undefined> {
  if (USE_REMOTE_DB) return (await getAllReceipts()).find((receipt) => receipt.journalEntryId === journalId);
  const db = await getDB();
  const all = await db.getAllFromIndex("receipts", "by-journal", journalId);
  return all[0];
}

export async function putReceipt(receipt: Receipt): Promise<void> {
  if (USE_REMOTE_DB) return remoteRequest<void>(`${remoteCollection("receipts")}/${receipt.id}`, { method: "PUT", body: JSON.stringify(receipt) });
  const db = await getDB();
  await db.put("receipts", receipt);
}

export async function deleteReceipt(id: string): Promise<void> {
  if (USE_REMOTE_DB) return remoteRequest<void>(`${remoteCollection("receipts")}/${id}`, { method: "DELETE" });
  const db = await getDB();
  await db.delete("receipts", id);
}

// Profile
export async function getProfile(): Promise<BusinessProfile | undefined> {
  if (USE_REMOTE_DB) return remoteRequest<BusinessProfile[]>(remoteCollection("profile")).then((items) => items[0]);
  const db = await getDB();
  return db.get("profile", "default");
}

export async function putProfile(profile: BusinessProfile): Promise<void> {
  if (USE_REMOTE_DB) return remoteRequest<void>(`${remoteCollection("profile")}/${profile.id || "default"}`, { method: "PUT", body: JSON.stringify(profile) });
  const db = await getDB();
  await db.put("profile", { ...profile, id: "default" });
}

// Settings
export async function getSettings(): Promise<AppSettings | undefined> {
  if (USE_REMOTE_DB) return remoteRequest<AppSettings[]>(remoteCollection("settings")).then((items) => items[0]);
  const db = await getDB();
  return db.get("settings", "default");
}

export async function putSettings(settings: AppSettings): Promise<void> {
  if (USE_REMOTE_DB) return remoteRequest<void>(`${remoteCollection("settings")}/default`, { method: "PUT", body: JSON.stringify(settings) });
  const db = await getDB();
  await db.put("settings", { ...settings, id: "default" });
}

// Export all data
export async function exportAllData(): Promise<string> {
  const db = await getDB();
  const data = {
    accounts: await db.getAll("accounts"),
    journals: await db.getAll("journals"),
    invoices: await db.getAll("invoices"),
    receipts: await db.getAll("receipts"),
    profile: await db.get("profile", "default"),
    settings: await db.get("settings", "default"),
    vendors: await db.getAll("vendors"),
    exportedAt: new Date().toISOString(),
    version: "1.0",
  };
  return JSON.stringify(data, null, 2);
}

// Import data
export async function importAllData(jsonString: string): Promise<void> {
  const data = JSON.parse(jsonString);
  const db = await getDB();

  if (data.accounts) {
    const tx = db.transaction("accounts", "readwrite");
    await tx.store.clear();
    for (const item of data.accounts) {
      await tx.store.put(item);
    }
    await tx.done;
  }

  if (data.journals) {
    const tx = db.transaction("journals", "readwrite");
    await tx.store.clear();
    for (const item of data.journals) {
      await tx.store.put(item);
    }
    await tx.done;
  }

  if (data.invoices) {
    const tx = db.transaction("invoices", "readwrite");
    await tx.store.clear();
    for (const item of data.invoices) {
      await tx.store.put(item);
    }
    await tx.done;
  }

  if (data.receipts) {
    const tx = db.transaction("receipts", "readwrite");
    await tx.store.clear();
    for (const item of data.receipts) {
      await tx.store.put(item);
    }
    await tx.done;
  }

  if (data.profile) {
    await db.put("profile", data.profile);
  }

  if (data.settings) {
    await db.put("settings", data.settings);
  }

  if (data.vendors) {
    const tx = db.transaction("vendors", "readwrite");
    await tx.store.clear();
    for (const item of data.vendors) {
      await tx.store.put(item);
    }
    await tx.done;
  }
}

// Vendors
export async function getAllVendors(): Promise<Vendor[]> {
  if (USE_REMOTE_DB) return remoteRequest<Vendor[]>(remoteCollection("vendors"));
  const db = await getDB();
  const all = await db.getAll("vendors");
  return all.sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

export async function getVendor(id: string): Promise<Vendor | undefined> {
  if (USE_REMOTE_DB) return remoteRequest<Vendor | undefined>(`${remoteCollection("vendors")}/${id}`).catch((error) => error.message.includes("APIエラー (404)") ? undefined : Promise.reject(error));
  const db = await getDB();
  return db.get("vendors", id);
}

export async function putVendor(vendor: Vendor): Promise<void> {
  if (USE_REMOTE_DB) return remoteRequest<void>(`${remoteCollection("vendors")}/${vendor.id}`, { method: "PUT", body: JSON.stringify(vendor) });
  const db = await getDB();
  await db.put("vendors", vendor);
}

export async function deleteVendor(id: string): Promise<void> {
  if (USE_REMOTE_DB) return remoteRequest<void>(`${remoteCollection("vendors")}/${id}`, { method: "DELETE" });
  const db = await getDB();
  await db.delete("vendors", id);
}

// Clear all data
export async function clearAllData(): Promise<void> {
  if (USE_REMOTE_DB) {
    for (const collection of ["accounts", "journals", "invoices", "receipts", "profile", "settings", "vendors", "fixedAssets", "homeExpenseRules"]) {
      await remoteRequest<void>(remoteCollection(collection), { method: "DELETE" });
    }
    return;
  }
  const db = await getDB();
  await db.clear("accounts");
  await db.clear("journals");
  await db.clear("invoices");
  await db.clear("receipts");
  await db.clear("profile");
  await db.clear("settings");
  try { await db.clear("vendors"); } catch {}
  await initializeDB();
}
