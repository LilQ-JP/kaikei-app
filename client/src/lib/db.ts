/**
 * IndexedDB Database for フリーランス会計
 * macOS Ledger Design — Apple Design × 会計ツール
 *
 * All data is stored locally in the browser using IndexedDB.
 * No server-side storage is used.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/* ─── Data Models ─── */

export interface AccountItem {
  id: string;
  code: string; // e.g. "100", "200"
  name: string;
  category: "asset" | "liability" | "equity" | "income" | "expense";
  subcategory: string;
  isDefault: boolean;
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
  description: string;
  memo?: string;
  receiptId?: string;
  paymentMethod?: string; // カード名・決済手段（例: 楽天カード, PayPay, 現金）
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  clientName: string;
  clientAddress?: string;
  clientEmail?: string;
  issueDate: string;
  dueDate: string;
  items: InvoiceItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  status: "draft" | "sent" | "paid" | "overdue";
  notes?: string;
  bankInfo?: string;
  createdAt: string;
  updatedAt: string;
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
  address?: string;
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
  { code: "170", name: "事業主貸", category: "asset", subcategory: "事業主勘定", isDefault: true },

  // 負債 (Liabilities)
  { code: "200", name: "買掛金", category: "liability", subcategory: "流動負債", isDefault: true },
  { code: "202", name: "未払金", category: "liability", subcategory: "流動負債", isDefault: true },
  { code: "204", name: "未払費用", category: "liability", subcategory: "流動負債", isDefault: true },
  { code: "206", name: "前受金", category: "liability", subcategory: "流動負債", isDefault: true },
  { code: "208", name: "預り金", category: "liability", subcategory: "流動負債", isDefault: true },
  { code: "210", name: "仮受金", category: "liability", subcategory: "流動負債", isDefault: true },
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
  const db = await getDB();

  // Check if accounts already exist
  const count = await db.count("accounts");
  if (count === 0) {
    const tx = db.transaction("accounts", "readwrite");
    const now = new Date().toISOString();
    for (const account of DEFAULT_ACCOUNTS) {
      await tx.store.put({
        ...account,
        id: crypto.randomUUID(),
        createdAt: now,
      });
    }
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
  const db = await getDB();
  return db.getAll("accounts");
}

export async function getAccountsByCategory(category: AccountItem["category"]): Promise<AccountItem[]> {
  const db = await getDB();
  return db.getAllFromIndex("accounts", "by-category", category);
}

export async function getAccount(id: string): Promise<AccountItem | undefined> {
  const db = await getDB();
  return db.get("accounts", id);
}

export async function putAccount(account: AccountItem): Promise<void> {
  const db = await getDB();
  await db.put("accounts", account);
}

export async function deleteAccount(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("accounts", id);
}

// Journals
export async function getAllJournals(): Promise<JournalEntry[]> {
  const db = await getDB();
  const all = await db.getAll("journals");
  return all.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export async function getJournalsByDateRange(start: string, end: string): Promise<JournalEntry[]> {
  const db = await getDB();
  const range = IDBKeyRange.bound(start, end);
  const results = await db.getAllFromIndex("journals", "by-date", range);
  return results.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

export async function putJournal(entry: JournalEntry): Promise<void> {
  const db = await getDB();
  await db.put("journals", entry);
}

export async function deleteJournal(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("journals", id);
}

// Invoices
export async function getAllInvoices(): Promise<Invoice[]> {
  const db = await getDB();
  const all = await db.getAll("invoices");
  return all.sort((a, b) => b.issueDate.localeCompare(a.issueDate));
}

export async function getInvoice(id: string): Promise<Invoice | undefined> {
  const db = await getDB();
  return db.get("invoices", id);
}

export async function putInvoice(invoice: Invoice): Promise<void> {
  const db = await getDB();
  await db.put("invoices", invoice);
}

export async function deleteInvoice(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("invoices", id);
}

// Receipts
export async function getAllReceipts(): Promise<Receipt[]> {
  const db = await getDB();
  const all = await db.getAll("receipts");
  return all.sort((a, b) => b.date.localeCompare(a.date));
}

export async function getReceipt(id: string): Promise<Receipt | undefined> {
  const db = await getDB();
  return db.get("receipts", id);
}

export async function getReceiptByJournalId(journalId: string): Promise<Receipt | undefined> {
  const db = await getDB();
  const all = await db.getAllFromIndex("receipts", "by-journal", journalId);
  return all[0];
}

export async function putReceipt(receipt: Receipt): Promise<void> {
  const db = await getDB();
  await db.put("receipts", receipt);
}

export async function deleteReceipt(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("receipts", id);
}

// Profile
export async function getProfile(): Promise<BusinessProfile | undefined> {
  const db = await getDB();
  return db.get("profile", "default");
}

export async function putProfile(profile: BusinessProfile): Promise<void> {
  const db = await getDB();
  await db.put("profile", { ...profile, id: "default" });
}

// Settings
export async function getSettings(): Promise<AppSettings | undefined> {
  const db = await getDB();
  return db.get("settings", "default");
}

export async function putSettings(settings: AppSettings): Promise<void> {
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
  const db = await getDB();
  const all = await db.getAll("vendors");
  return all.sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

export async function getVendor(id: string): Promise<Vendor | undefined> {
  const db = await getDB();
  return db.get("vendors", id);
}

export async function putVendor(vendor: Vendor): Promise<void> {
  const db = await getDB();
  await db.put("vendors", vendor);
}

export async function deleteVendor(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("vendors", id);
}

// Clear all data
export async function clearAllData(): Promise<void> {
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
