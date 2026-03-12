import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format number as Japanese Yen */
export function formatYen(amount: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Format number with commas */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat("ja-JP").format(num);
}

/** Format date as YYYY年MM月DD日 */
export function formatDateJP(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** Format date as YYYY/MM/DD */
export function formatDateSlash(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

/** Get today as YYYY-MM-DD */
export function getToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Get fiscal year range */
export function getFiscalYearRange(year: number, startMonth: number = 1): { start: string; end: string } {
  if (startMonth === 1) {
    return {
      start: `${year}-01-01`,
      end: `${year}-12-31`,
    };
  }
  return {
    start: `${year}-${String(startMonth).padStart(2, "0")}-01`,
    end: `${year + 1}-${String(startMonth - 1).padStart(2, "0")}-${new Date(year + 1, startMonth - 1, 0).getDate()}`,
  };
}

/** Generate invoice number */
export function generateInvoiceNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  return `INV-${y}${m}${d}-${rand}`;
}

/** Category labels in Japanese */
export const CATEGORY_LABELS: Record<string, string> = {
  asset: "資産",
  liability: "負債",
  equity: "純資産",
  income: "収益",
  expense: "費用",
};

/** Account category colors */
export const CATEGORY_COLORS: Record<string, string> = {
  asset: "text-blue-600 bg-blue-50",
  liability: "text-orange-600 bg-orange-50",
  equity: "text-purple-600 bg-purple-50",
  income: "text-green-600 bg-green-50",
  expense: "text-red-600 bg-red-50",
};

/** Invoice status labels */
export const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: "下書き",
  sent: "送付済",
  paid: "入金済",
  overdue: "期限超過",
};

export const INVOICE_STATUS_COLORS: Record<string, string> = {
  draft: "text-gray-600 bg-gray-100",
  sent: "text-blue-600 bg-blue-50",
  paid: "text-green-600 bg-green-50",
  overdue: "text-red-600 bg-red-50",
};

/** Download a string as a file */
export function downloadFile(content: string, filename: string, mimeType: string = "application/json") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Convert journals to CSV */
export function journalsToCSV(journals: Array<{ date: string; debitName: string; creditName: string; amount: number; description: string }>): string {
  const header = "日付,借方科目,貸方科目,金額,摘要";
  const rows = journals.map(j =>
    `${j.date},"${j.debitName}","${j.creditName}",${j.amount},"${j.description}"`
  );
  return [header, ...rows].join("\n");
}
