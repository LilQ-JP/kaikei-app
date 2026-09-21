/**
 * CsvImport — CSV取り込みページ（銀行・クレカ明細 + 仕訳帳CSV → 仕訳候補）
 * macOS Ledger Design
 *
 * 対応フォーマット:
 * - 仕訳帳CSV（取引日,借方勘定科目,金額,貸方勘定科目,金額,摘要,取引No）
 * - 汎用フォーマット（日付,摘要,金額）
 * - 三菱UFJ / 三井住友 / 楽天銀行
 * - クレジットカード明細
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  getAllAccounts,
  getAllJournals,
  putJournal,
  type AccountItem,
  type JournalEntry,
} from "@/lib/db";
import { suggestJournalAccounts, type AISuggestion } from "@/lib/ai-journal";
import { CATEGORY_LABELS, formatYen } from "@/lib/utils";
import { Upload, FileText, Sparkles, Save, Trash2, AlertCircle, CheckCircle2 } from "lucide-react";
import { useEffect, useState, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

interface ParsedRow {
  key: string;
  date: string;
  description: string;
  amount: number;
  isExpense: boolean;
  debitAccountId: string;
  creditAccountId: string;
  selected: boolean;
  suggestion?: AISuggestion | null;
  /** 仕訳帳CSVで科目名が直接マッチした場合 true */
  autoMatched?: boolean;
}

type CSVFormat = "auto" | "journal" | "generic" | "mufg" | "smbc" | "rakuten" | "creditcard";

const FORMAT_LABELS: Record<CSVFormat, string> = {
  auto: "自動判定",
  journal: "仕訳帳CSV（借方/貸方科目付き）",
  generic: "汎用（日付,摘要,金額）",
  mufg: "三菱UFJ銀行",
  smbc: "三井住友銀行",
  rakuten: "楽天銀行",
  creditcard: "クレジットカード明細",
};

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function normalizeDate(dateStr: string, defaultYear?: string): string {
  const cleaned = dateStr.replace(/[年月]/g, "-").replace(/日/g, "").replace(/\//g, "-").trim();
  const parts = cleaned.split("-").filter(Boolean);
  if (parts.length === 3) {
    const y = parts[0].length === 2 ? `20${parts[0]}` : parts[0];
    const m = parts[1].padStart(2, "0");
    const d = parts[2].padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  // MM/DD format without year — use defaultYear or current year
  if (parts.length === 2) {
    const y = defaultYear || new Date().getFullYear().toString();
    const m = parts[0].padStart(2, "0");
    const d = parts[1].padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return dateStr;
}

function parseAmount(amountStr: string): number {
  return Math.abs(Number(amountStr.replace(/[,¥￥円\s"]/g, "")) || 0);
}

function isNegativeAmount(amountStr: string): boolean {
  const cleaned = amountStr.replace(/[,¥￥円\s"]/g, "");
  return cleaned.startsWith("-") || cleaned.startsWith("△");
}

/** 仕訳帳CSVかどうかヘッダーから自動判定 */
function detectJournalCSV(headerLine: string): boolean {
  const lower = headerLine.toLowerCase();
  return (
    (lower.includes("借方") && lower.includes("貸方")) ||
    (lower.includes("debit") && lower.includes("credit")) ||
    (lower.includes("取引日") && lower.includes("勘定科目") && lower.includes("摘要"))
  );
}

/** 勘定科目名からAccountItemを検索 */
function findAccountByName(name: string, accounts: AccountItem[]): AccountItem | undefined {
  if (!name || name === "(複合仕訳)") return undefined;
  const trimmed = name.trim();
  return accounts.find(
    (a) => a.name === trimmed || a.name === trimmed.replace(/\s/g, "")
  );
}

interface JournalCSVRow {
  date: string;
  debitName: string;
  debitAmount: number;
  creditName: string;
  creditAmount: number;
  description: string;
  txNo?: string;
}

function parseJournalCSV(lines: string[], accounts: AccountItem[], defaultYear?: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 5) continue;

    // Format: 取引日,借方勘定科目,金額,貸方勘定科目,金額,摘要[,取引No]
    const dateRaw = cols[0]?.trim();
    const debitName = cols[1]?.trim() || "";
    const debitAmount = parseAmount(cols[2] || "0");
    const creditName = cols[3]?.trim() || "";
    const creditAmount = parseAmount(cols[4] || "0");
    const description = cols[5]?.trim() || "";
    const txNo = cols[6]?.trim() || "";

    if (!dateRaw) continue;

    const date = normalizeDate(dateRaw, defaultYear);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const amount = debitAmount || creditAmount;
    if (amount === 0) continue;

    // Match account names to IDs
    const debitAccount = findAccountByName(debitName, accounts);
    const creditAccount = findAccountByName(creditName, accounts);

    const isExpense = debitAccount
      ? debitAccount.category === "expense"
      : false;

    rows.push({
      key: crypto.randomUUID(),
      date,
      description: description || `${debitName} / ${creditName}`,
      amount,
      isExpense,
      debitAccountId: debitAccount?.id || "",
      creditAccountId: creditAccount?.id || "",
      selected: true,
      suggestion: null,
      autoMatched: !!(debitAccount && creditAccount),
    });
  }
  return rows;
}

function parseBankCSV(lines: string[], format: CSVFormat): ParsedRow[] {
  const rows: ParsedRow[] = [];
  const startIndex = 1;

  for (let i = startIndex; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 2) continue;

    let date = "";
    let description = "";
    let amount = 0;
    let isExpense = true;

    try {
      switch (format) {
        case "mufg":
          date = normalizeDate(cols[0]);
          description = [cols[1], cols[2]].filter(Boolean).join(" ");
          if (cols[3] && parseAmount(cols[3]) > 0) {
            amount = parseAmount(cols[3]);
            isExpense = true;
          } else if (cols[4] && parseAmount(cols[4]) > 0) {
            amount = parseAmount(cols[4]);
            isExpense = false;
          }
          break;

        case "smbc":
          date = normalizeDate(cols[0]);
          description = cols[3] || "";
          if (cols[1] && parseAmount(cols[1]) > 0) {
            amount = parseAmount(cols[1]);
            isExpense = true;
          } else if (cols[2] && parseAmount(cols[2]) > 0) {
            amount = parseAmount(cols[2]);
            isExpense = false;
          }
          break;

        case "rakuten":
          date = normalizeDate(cols[0]);
          description = cols[3] || cols[2] || "";
          const rakutenAmt = cols[1] || "";
          amount = parseAmount(rakutenAmt);
          isExpense = isNegativeAmount(rakutenAmt);
          break;

        case "creditcard":
          date = normalizeDate(cols[0]);
          description = cols[1] || "";
          amount = parseAmount(cols[2] || "0");
          isExpense = true;
          break;

        case "generic":
        case "auto":
        default:
          date = normalizeDate(cols[0]);
          if (cols.length >= 3) {
            const col1Num = parseAmount(cols[1]);
            const col2Num = parseAmount(cols[2]);
            if (col1Num > 0 && !cols[1].match(/[a-zA-Zぁ-んァ-ヶ亜-熙]/)) {
              amount = col1Num;
              description = cols[2] || "";
              isExpense = isNegativeAmount(cols[1]);
            } else {
              description = cols[1] || "";
              amount = col2Num;
              isExpense = isNegativeAmount(cols[2] || "");
            }
          } else {
            description = cols[1] || "";
          }
          break;
      }
    } catch {
      continue;
    }

    if (!date || amount === 0) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    rows.push({
      key: crypto.randomUUID(),
      date,
      description,
      amount,
      isExpense,
      debitAccountId: "",
      creditAccountId: "",
      selected: true,
      suggestion: null,
    });
  }
  return rows;
}

export default function CsvImport() {
  const [, navigate] = useLocation();
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [pastJournals, setPastJournals] = useState<JournalEntry[]>([]);
  const [format, setFormat] = useState<CSVFormat>("auto");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [aiProcessing, setAiProcessing] = useState(false);
  const [defaultYear, setDefaultYear] = useState(new Date().getFullYear().toString());
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([getAllAccounts(), getAllJournals()]).then(([accs, journals]) => {
      setAccounts(accs);
      setPastJournals(journals);
    });
  }, []);

  const groupedAccounts = useMemo(() => {
    const groups: Record<string, AccountItem[]> = {};
    accounts
      .sort((a, b) => a.code.localeCompare(b.code))
      .forEach((acc) => {
        const label = CATEGORY_LABELS[acc.category] || acc.category;
        if (!groups[label]) groups[label] = [];
        groups[label].push(acc);
      });
    return groups;
  }, [accounts]);

  function handleFileSelect(file: File) {
    if (!file.name.endsWith(".csv") && !file.name.endsWith(".txt")) {
      toast.error("CSVファイルを選択してください");
      return;
    }
    setFileName(file.name);

    // Try to detect year from filename (e.g., "2026年度_LilQ_仕訳帳")
    const yearMatch = file.name.match(/(20\d{2})/);
    if (yearMatch) {
      setDefaultYear(yearMatch[1]);
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) {
        toast.error("データがありません");
        return;
      }

      let detectedFormat = format;
      let parsed: ParsedRow[] = [];

      // Auto-detect format
      if (format === "auto") {
        if (detectJournalCSV(lines[0])) {
          detectedFormat = "journal";
        } else {
          detectedFormat = "generic";
        }
      }

      if (detectedFormat === "journal") {
        const yr = yearMatch ? yearMatch[1] : defaultYear;
        parsed = parseJournalCSV(lines, accounts, yr);
      } else {
        parsed = parseBankCSV(lines, detectedFormat);
      }

      if (parsed.length === 0) {
        toast.error("取り込めるデータがありませんでした。フォーマットを変更してみてください。");
        return;
      }

      const matchedCount = parsed.filter((r) => r.autoMatched).length;
      setRows(parsed);

      if (detectedFormat === "journal") {
        toast.success(
          `${parsed.length}件の仕訳を読み込みました（${matchedCount}件は科目を自動マッチ済み）`
        );
      } else {
        toast.success(`${parsed.length}件のデータを読み込みました`);
      }
    };
    // Try UTF-8 first, then Shift_JIS
    reader.onerror = () => {
      const reader2 = new FileReader();
      reader2.onload = (e2) => {
        const text = e2.target?.result as string;
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2) return;
        // Same parsing logic
        let detectedFormat = format;
        if (format === "auto" && detectJournalCSV(lines[0])) {
          detectedFormat = "journal";
        }
        const parsed =
          detectedFormat === "journal"
            ? parseJournalCSV(lines, accounts, defaultYear)
            : parseBankCSV(lines, detectedFormat === "auto" ? "generic" : detectedFormat);
        if (parsed.length > 0) setRows(parsed);
      };
      reader2.readAsText(file, "Shift_JIS");
    };
    reader.readAsText(file, "UTF-8");
  }

  async function runAIOnAll() {
    if (accounts.length === 0) return;
    setAiProcessing(true);
    const updated = rows.map((row) => {
      // Skip rows that already have both accounts matched
      if (row.debitAccountId && row.creditAccountId) return row;

      const suggestion = suggestJournalAccounts(row.description, accounts, pastJournals);
      if (suggestion) {
        return {
          ...row,
          debitAccountId: row.debitAccountId || suggestion.debitAccountId,
          creditAccountId: row.creditAccountId || suggestion.creditAccountId,
          suggestion,
        };
      }
      return row;
    });
    setRows(updated);
    setAiProcessing(false);
    const newlyMatched = updated.filter(
      (r, i) =>
        r.debitAccountId && r.creditAccountId && (!rows[i].debitAccountId || !rows[i].creditAccountId)
    ).length;
  toast.success(`仕訳候補を適用しました（${newlyMatched}件に科目を設定）`);
  }

  function toggleRow(key: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, selected: !r.selected } : r)));
  }

  function toggleAll(selected: boolean) {
    setRows((prev) => prev.map((r) => ({ ...r, selected })));
  }

  function updateRow(key: string, field: "debitAccountId" | "creditAccountId", value: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  async function handleSave() {
    const selected = rows.filter((r) => r.selected);
    const incomplete = selected.filter((r) => !r.debitAccountId || !r.creditAccountId);
    if (incomplete.length > 0) {
      toast.error(
        `${incomplete.length}件の仕訳に科目が設定されていません。仕訳候補を実行するか、手動で設定してください。`
      );
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      for (const row of selected) {
        const journal: JournalEntry = {
          id: crypto.randomUUID(),
          date: row.date,
          debitAccountId: row.debitAccountId,
          creditAccountId: row.creditAccountId,
          amount: row.amount,
          description: row.description,
          memo: `CSV取込: ${fileName}`,
          createdAt: now,
          updatedAt: now,
        };
        await putJournal(journal);
      }
      toast.success(`${selected.length}件の仕訳を登録しました`);
      navigate("/journals");
    } catch {
      toast.error("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  const selectedCount = rows.filter((r) => r.selected).length;
  const incompleteCount = rows.filter(
    (r) => r.selected && (!r.debitAccountId || !r.creditAccountId)
  ).length;
  const matchedCount = rows.filter((r) => r.debitAccountId && r.creditAccountId).length;

  return (
    <div className="p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">CSV取り込み</h1>
        {rows.length > 0 && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={runAIOnAll} disabled={aiProcessing}>
              <Sparkles className="h-4 w-4 mr-1" />
              {aiProcessing ? "候補を計算中..." : "仕訳候補を計算"}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || selectedCount === 0}>
              <Save className="h-4 w-4 mr-1" />
              {saving ? "保存中..." : `${selectedCount}件を登録`}
            </Button>
          </div>
        )}
      </div>

      {/* Upload area */}
      {rows.length === 0 && (
        <div className="space-y-4">
          <Card className="border shadow-sm">
            <CardContent className="p-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-6">
                <div>
                  <Label className="text-[12px] font-semibold">CSVフォーマット</Label>
                  <Select value={format} onValueChange={(v) => setFormat(v as CSVFormat)}>
                    <SelectTrigger className="mt-1 text-[13px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(FORMAT_LABELS).map(([key, label]) => (
                        <SelectItem key={key} value={key} className="text-[13px]">
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[12px] font-semibold">デフォルト年度（MM/DD形式の場合）</Label>
                  <Select value={defaultYear} onValueChange={setDefaultYear}>
                    <SelectTrigger className="mt-1 text-[13px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[2024, 2025, 2026, 2027].map((y) => (
                        <SelectItem key={y} value={y.toString()} className="text-[13px]">
                          {y}年
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div
                className="border-2 border-dashed border-border rounded-xl p-12 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const file = e.dataTransfer.files[0];
                  if (file) handleFileSelect(file);
                }}
              >
                <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-[14px] font-semibold mb-1">CSVファイルをドラッグ&ドロップ</p>
                <p className="text-[12px] text-muted-foreground">またはクリックしてファイルを選択</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                    e.target.value = "";
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-[14px] font-bold">対応フォーマット</CardTitle>
            </CardHeader>
            <CardContent className="text-[13px] space-y-3">
              <p className="text-muted-foreground">
                以下のCSVフォーマットに対応しています。「自動判定」でヘッダーから自動検出します。
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                {Object.entries(FORMAT_LABELS)
                  .filter(([k]) => k !== "auto")
                  .map(([key, label]) => (
                    <div key={key} className="flex items-center gap-2 text-[12px]">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span>{label}</span>
                    </div>
                  ))}
              </div>
              <div className="mt-3 p-3 bg-blue-50 rounded-lg text-[12px] text-blue-800">
                <p className="font-semibold mb-1">仕訳帳CSVについて</p>
                <p>
                  「取引日, 借方勘定科目, 金額, 貸方勘定科目, 金額, 摘要」の形式のCSVを読み込めます。
                  勘定科目名が登録済みの科目と一致すれば自動でマッチングされます。
                  日付がMM/DD形式の場合は、上の「デフォルト年度」で年を指定してください。
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Parsed data table */}
      {rows.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
              <span>{fileName} — {rows.length}件</span>
              {matchedCount > 0 && (
                <span className="flex items-center gap-1 text-green-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {matchedCount}件 科目設定済み
                </span>
              )}
              {incompleteCount > 0 && (
                <span className="flex items-center gap-1 text-amber-600">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {incompleteCount}件 科目未設定
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="text-[11px] h-7" onClick={() => toggleAll(true)}>
                全選択
              </Button>
              <Button variant="ghost" size="sm" className="text-[11px] h-7" onClick={() => toggleAll(false)}>
                全解除
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-[11px] h-7 text-destructive"
                onClick={() => {
                  setRows([]);
                  setFileName("");
                }}
              >
                クリア
              </Button>
            </div>
          </div>

          <Card className="border shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-3 py-2.5 w-10"></th>
                      <th className="px-3 py-2.5 text-left font-bold text-muted-foreground">日付</th>
                      <th className="px-3 py-2.5 text-left font-bold text-muted-foreground">摘要</th>
                      <th className="px-3 py-2.5 text-right font-bold text-muted-foreground">金額</th>
                      <th className="px-3 py-2.5 text-left font-bold text-muted-foreground">借方</th>
                      <th className="px-3 py-2.5 text-left font-bold text-muted-foreground">貸方</th>
                      <th className="px-3 py-2.5 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((row) => (
                      <tr
                        key={row.key}
                        className={`hover:bg-muted/20 transition-colors ${!row.selected ? "opacity-40" : ""}`}
                      >
                        <td className="px-3 py-2">
                          <Checkbox checked={row.selected} onCheckedChange={() => toggleRow(row.key)} />
                        </td>
                        <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">
                          {row.date}
                        </td>
                        <td className="px-3 py-2 max-w-[220px]">
                          <div className="truncate" title={row.description}>
                            {row.description}
                          </div>
                          {row.autoMatched && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-green-600 mt-0.5">
                              <CheckCircle2 className="h-3 w-3" />
                              自動マッチ
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold whitespace-nowrap">
                          {formatYen(row.amount)}
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            value={row.debitAccountId}
                            onValueChange={(v) => updateRow(row.key, "debitAccountId", v)}
                          >
                            <SelectTrigger className="h-8 text-[12px] w-[140px]">
                              <SelectValue placeholder="借方" />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(groupedAccounts).map(([group, accs]) => (
                                <div key={group}>
                                  <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground">
                                    {group}
                                  </div>
                                  {accs.map((acc) => (
                                    <SelectItem key={acc.id} value={acc.id} className="text-[12px]">
                                      {acc.name}
                                    </SelectItem>
                                  ))}
                                </div>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            value={row.creditAccountId}
                            onValueChange={(v) => updateRow(row.key, "creditAccountId", v)}
                          >
                            <SelectTrigger className="h-8 text-[12px] w-[140px]">
                              <SelectValue placeholder="貸方" />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(groupedAccounts).map(([group, accs]) => (
                                <div key={group}>
                                  <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground">
                                    {group}
                                  </div>
                                  {accs.map((acc) => (
                                    <SelectItem key={acc.id} value={acc.id} className="text-[12px]">
                                      {acc.name}
                                    </SelectItem>
                                  ))}
                                </div>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => removeRow(row.key)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setRows([]);
                setFileName("");
              }}
            >
              キャンセル
            </Button>
            <Button onClick={handleSave} disabled={saving || selectedCount === 0}>
              <Save className="h-4 w-4 mr-1" />
              {saving ? "保存中..." : `${selectedCount}件を仕訳帳に登録`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
