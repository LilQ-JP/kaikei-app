/**
 * CsvImport — CSV取り込みページ（銀行・クレカ明細 → AI自動仕訳）
 * macOS Ledger Design
 *
 * 主要銀行・クレカのCSVフォーマットに対応:
 * - 汎用フォーマット（日付,摘要,金額）
 * - 三菱UFJ / 三井住友 / 楽天銀行
 * - クレジットカード明細
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Upload, FileText, Sparkles, Check, Save, Trash2, AlertCircle } from "lucide-react";
import { useEffect, useState, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

interface ParsedRow {
  key: string;
  date: string;
  description: string;
  amount: number;
  isExpense: boolean; // true = 支出, false = 収入
  debitAccountId: string;
  creditAccountId: string;
  selected: boolean;
  suggestion?: AISuggestion | null;
}

type CSVFormat = "auto" | "generic" | "mufg" | "smbc" | "rakuten" | "creditcard";

const FORMAT_LABELS: Record<CSVFormat, string> = {
  auto: "自動判定",
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

function normalizeDate(dateStr: string): string {
  // Handle various date formats
  const cleaned = dateStr.replace(/[年月]/g, "-").replace(/日/g, "").replace(/\//g, "-").trim();
  const parts = cleaned.split("-").filter(Boolean);
  if (parts.length === 3) {
    const y = parts[0].length === 2 ? `20${parts[0]}` : parts[0];
    const m = parts[1].padStart(2, "0");
    const d = parts[2].padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return dateStr;
}

function parseAmount(amountStr: string): number {
  return Math.abs(Number(amountStr.replace(/[,¥￥円\s]/g, "")) || 0);
}

function isNegativeAmount(amountStr: string): boolean {
  const cleaned = amountStr.replace(/[,¥￥円\s]/g, "");
  return cleaned.startsWith("-") || cleaned.startsWith("△");
}

function parseCSV(text: string, format: CSVFormat): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const rows: ParsedRow[] = [];

  // Skip header row(s)
  let startIndex = 1;
  // Some banks have multiple header rows
  if (format === "mufg" || format === "smbc") startIndex = 1;

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
          // 日付,摘要,摘要内容,支払金額,預り金額,差引残高,メモ,未資金化区分,入払区分
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
          // 年月日,お引出し,お預入れ,お取り扱い内容,残高
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
          // 取引日,入出金(税込),残高,摘要
          date = normalizeDate(cols[0]);
          description = cols[3] || cols[2] || "";
          const rakutenAmt = cols[1] || "";
          amount = parseAmount(rakutenAmt);
          isExpense = isNegativeAmount(rakutenAmt);
          break;

        case "creditcard":
          // 利用日,利用店名,利用金額,支払区分,備考
          date = normalizeDate(cols[0]);
          description = cols[1] || "";
          amount = parseAmount(cols[2] || "0");
          isExpense = true; // クレカは基本支出
          break;

        case "generic":
        case "auto":
        default:
          // Try to detect: look for date-like, description-like, amount-like columns
          date = normalizeDate(cols[0]);
          if (cols.length >= 3) {
            // Check if col[1] is a number (amount) or text (description)
            const col1Num = parseAmount(cols[1]);
            const col2Num = parseAmount(cols[2]);
            if (col1Num > 0 && !cols[1].match(/[a-zA-Zぁ-んァ-ヶ亜-熙]/)) {
              // col[1] is amount, col[2] might be description
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
    // Validate date format
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

  const accountMap = useMemo(() => {
    const map = new Map<string, AccountItem>();
    accounts.forEach((a) => map.set(a.id, a));
    return map;
  }, [accounts]);

  function handleFileSelect(file: File) {
    if (!file.name.endsWith(".csv") && !file.name.endsWith(".txt")) {
      toast.error("CSVファイルを選択してください");
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text, format);
      if (parsed.length === 0) {
        toast.error("取り込めるデータがありませんでした。フォーマットを変更してみてください。");
        return;
      }
      setRows(parsed);
      toast.success(`${parsed.length}件のデータを読み込みました`);
    };
    reader.readAsText(file, "Shift_JIS"); // Japanese CSV is often Shift_JIS
  }

  async function runAIOnAll() {
    if (accounts.length === 0) return;
    setAiProcessing(true);
    const updated = rows.map((row) => {
      const suggestion = suggestJournalAccounts(row.description, accounts, pastJournals);
      if (suggestion) {
        return {
          ...row,
          debitAccountId: row.isExpense ? suggestion.debitAccountId : suggestion.debitAccountId,
          creditAccountId: row.isExpense ? suggestion.creditAccountId : suggestion.creditAccountId,
          suggestion,
        };
      }
      return row;
    });
    setRows(updated);
    setAiProcessing(false);
    toast.success("AI自動仕訳を適用しました");
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
      toast.error(`${incomplete.length}件の仕訳に科目が設定されていません。AI自動仕訳を実行するか、手動で設定してください。`);
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
  const incompleteCount = rows.filter((r) => r.selected && (!r.debitAccountId || !r.creditAccountId)).length;

  return (
    <div className="p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">CSV取り込み</h1>
        {rows.length > 0 && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={runAIOnAll}
              disabled={aiProcessing}
            >
              <Sparkles className="h-4 w-4 mr-1" />
              {aiProcessing ? "処理中..." : "AI自動仕訳"}
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
              </div>

              <div
                className="border-2 border-dashed border-border rounded-xl p-12 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
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
            <CardContent className="text-[13px] space-y-2">
              <p className="text-muted-foreground">以下の銀行・クレカのCSVに対応しています。「自動判定」で多くの場合正しく読み込めます。</p>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {Object.entries(FORMAT_LABELS).filter(([k]) => k !== "auto").map(([key, label]) => (
                  <div key={key} className="flex items-center gap-2 text-[12px]">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    {label}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Parsed data table */}
      {rows.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
              <span>{fileName} — {rows.length}件</span>
              {incompleteCount > 0 && (
                <span className="flex items-center gap-1 text-amber-600">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {incompleteCount}件の科目未設定
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="text-[11px] h-7" onClick={() => toggleAll(true)}>全選択</Button>
              <Button variant="ghost" size="sm" className="text-[11px] h-7" onClick={() => toggleAll(false)}>全解除</Button>
              <Button variant="ghost" size="sm" className="text-[11px] h-7 text-destructive" onClick={() => { setRows([]); setFileName(""); }}>
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
                      <tr key={row.key} className={`hover:bg-muted/20 transition-colors ${!row.selected ? "opacity-40" : ""}`}>
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={row.selected}
                            onCheckedChange={() => toggleRow(row.key)}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">{row.date}</td>
                        <td className="px-3 py-2 truncate max-w-[200px]">{row.description}</td>
                        <td className={`px-3 py-2 text-right font-mono font-bold whitespace-nowrap ${row.isExpense ? "text-red-600" : "text-green-600"}`}>
                          {row.isExpense ? "-" : "+"}{formatYen(row.amount)}
                        </td>
                        <td className="px-3 py-2">
                          <Select value={row.debitAccountId} onValueChange={(v) => updateRow(row.key, "debitAccountId", v)}>
                            <SelectTrigger className="h-8 text-[12px] w-[140px]">
                              <SelectValue placeholder="借方" />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(groupedAccounts).map(([group, accs]) => (
                                <div key={group}>
                                  <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground">{group}</div>
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
                          <Select value={row.creditAccountId} onValueChange={(v) => updateRow(row.key, "creditAccountId", v)}>
                            <SelectTrigger className="h-8 text-[12px] w-[140px]">
                              <SelectValue placeholder="貸方" />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(groupedAccounts).map(([group, accs]) => (
                                <div key={group}>
                                  <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground">{group}</div>
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
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeRow(row.key)}>
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
            <Button variant="outline" onClick={() => { setRows([]); setFileName(""); }}>
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
