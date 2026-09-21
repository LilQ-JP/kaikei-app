/**
 * JournalForm — 仕訳入力・編集ページ（仕訳候補 + レシート添付 + 複合仕訳 + 決済カード記録）
 * macOS Ledger Design
 *
 * - 新規作成 /journals/new
 * - 編集 /journals/edit/:id
 * - 摘要入力でルール・過去履歴から仕訳候補を推定
 * - レシート画像/PDFを添付して仕訳と紐付け保存
 * - 複合仕訳: 1取引で複数の借方/貸方行を持てる
 * - 決済カード: どのカード/決済手段で支払ったかを記録
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getAllAccounts,
  getAllJournals,
  putJournalsAtomic,
  putJournal,
  putReceipt,
  getReceipt,
  getAllVendors,
  type AccountItem,
  type JournalEntry,
  type Receipt,
  type Vendor,
} from "@/lib/db";
import { suggestJournalAccounts, getConfidenceLabel, type AISuggestion } from "@/lib/ai-journal";
import { CATEGORY_LABELS, getToday } from "@/lib/utils";
import { Save, Plus, Trash2, Sparkles, Check, X, Camera, Image as ImageIcon, ArrowLeft, Layers, CreditCard, Users } from "lucide-react";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";

/* ─── Payment Method Presets ─── */
const PAYMENT_PRESETS = [
  "現金",
  "楽天カード",
  "三井住友カード",
  "JCBカード",
  "アメックス",
  "PayPay",
  "Suica",
  "銀行振込",
  "クレジットカード",
  "デビットカード",
  "電子マネー",
];

/* ─── Types ─── */

interface SimpleEntry {
  key: string;
  date: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: string;
  description: string;
  memo: string;
  paymentMethod: string;
  taxCategory: NonNullable<JournalEntry["taxCategory"]>;
  taxRate: number;
  receiptFile?: File;
  receiptPreview?: string;
  existingReceiptId?: string;
}

interface CompoundLine {
  key: string;
  side: "debit" | "credit";
  accountId: string;
  amount: string;
}

interface CompoundEntry {
  key: string;
  date: string;
  description: string;
  memo: string;
  paymentMethod: string;
  lines: CompoundLine[];
  receiptFile?: File;
  receiptPreview?: string;
  existingReceiptId?: string;
}

function createEmptySimple(): SimpleEntry {
  return {
    key: crypto.randomUUID(),
    date: getToday(),
    debitAccountId: "",
    creditAccountId: "",
    amount: "",
    description: "",
    memo: "",
    paymentMethod: "",
    taxCategory: "out-of-scope",
    taxRate: 10,
  };
}

function createEmptyCompound(): CompoundEntry {
  return {
    key: crypto.randomUUID(),
    date: getToday(),
    description: "",
    memo: "",
    paymentMethod: "",
    lines: [
      { key: crypto.randomUUID(), side: "debit", accountId: "", amount: "" },
      { key: crypto.randomUUID(), side: "credit", accountId: "", amount: "" },
    ],
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ─── Component ─── */

export default function JournalForm() {
  const [, navigate] = useLocation();
  const params = useParams<{ id?: string }>();
  const editId = params?.id;
  const isEdit = !!editId;

  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [pastJournals, setPastJournals] = useState<JournalEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Mode: simple (通常仕訳) or compound (複合仕訳)
  const [mode, setMode] = useState<"simple" | "compound">("simple");

  // Simple mode state
  const [entries, setEntries] = useState<SimpleEntry[]>([createEmptySimple()]);
  const [suggestions, setSuggestions] = useState<Record<string, AISuggestion | null>>({});
  const [aiEnabled, setAiEnabled] = useState(true);

  // Compound mode state
  const [compoundEntry, setCompoundEntry] = useState<CompoundEntry>(createEmptyCompound());

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Custom payment method input
  const [showCustomPayment, setShowCustomPayment] = useState<Record<string, boolean>>({});

  // Load accounts, past journals, and vendors
  useEffect(() => {
    Promise.all([getAllAccounts(), getAllJournals(), getAllVendors()]).then(([accs, journals, vends]) => {
      setAccounts(accs);
      setPastJournals(journals);
      setVendors(vends);

      if (editId) {
        const existing = journals.find((j) => j.id === editId);
        if (existing) {
          setEntries([
            {
              key: existing.id,
              date: existing.date,
              debitAccountId: existing.debitAccountId,
              creditAccountId: existing.creditAccountId,
              amount: String(existing.amount),
              description: existing.description,
              memo: existing.memo || "",
              paymentMethod: existing.paymentMethod || "",
              taxCategory: existing.taxCategory || "out-of-scope",
              taxRate: existing.taxRate ?? 10,
              existingReceiptId: existing.receiptId,
            },
          ]);
          if (existing.receiptId) {
            getReceipt(existing.receiptId).then((r) => {
              if (r) {
                setEntries((prev) =>
                  prev.map((e) =>
                    e.key === existing.id
                      ? { ...e, receiptPreview: r.imageData }
                      : e
                  )
                );
              }
            });
          }
        } else {
          toast.error("仕訳が見つかりません");
          navigate("/journals");
        }
      }
      setLoading(false);
    });
  }, [editId, navigate]);

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

  const runAISuggestion = useCallback(
    (entryKey: string, description: string) => {
      if (!aiEnabled || !description.trim() || accounts.length === 0) {
        setSuggestions((prev) => ({ ...prev, [entryKey]: null }));
        return;
      }
      if (debounceTimers.current[entryKey]) {
        clearTimeout(debounceTimers.current[entryKey]);
      }
      debounceTimers.current[entryKey] = setTimeout(() => {
        const result = suggestJournalAccounts(description, accounts, pastJournals);
        setSuggestions((prev) => ({ ...prev, [entryKey]: result }));
      }, 300);
    },
    [aiEnabled, accounts, pastJournals]
  );

  /* ─── Simple mode helpers ─── */

  function updateEntry(index: number, field: keyof SimpleEntry, value: string) {
    setEntries((prev) =>
      prev.map((e, i) => {
        if (i !== index) return e;
        const updated = { ...e, [field]: value };
        if (field === "description") {
          runAISuggestion(e.key, value);
        }
        return updated;
      })
    );
  }

  function handleReceiptSelect(entryKey: string, file: File) {
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";
    if (!isImage && !isPdf) {
      toast.error("画像またはPDFファイルを選択してください");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("ファイルサイズは10MB以下にしてください");
      return;
    }
    const previewUrl = isImage ? URL.createObjectURL(file) : "PDF";
    if (mode === "simple") {
      setEntries((prev) =>
        prev.map((e) =>
          e.key === entryKey ? { ...e, receiptFile: file, receiptPreview: previewUrl } : e
        )
      );
    } else {
      setCompoundEntry((prev) => ({ ...prev, receiptFile: file, receiptPreview: previewUrl }));
    }
    toast.success(`${isPdf ? "PDF" : "レシート画像"}を添付しました`);
  }

  function removeReceipt(entryKey: string) {
    if (mode === "simple") {
      setEntries((prev) =>
        prev.map((e) => {
          if (e.key !== entryKey) return e;
          if (e.receiptPreview && e.receiptPreview !== "PDF" && !e.existingReceiptId) URL.revokeObjectURL(e.receiptPreview);
          return { ...e, receiptFile: undefined, receiptPreview: undefined, existingReceiptId: undefined };
        })
      );
    } else {
      if (compoundEntry.receiptPreview && compoundEntry.receiptPreview !== "PDF" && !compoundEntry.existingReceiptId) {
        URL.revokeObjectURL(compoundEntry.receiptPreview);
      }
      setCompoundEntry((prev) => ({ ...prev, receiptFile: undefined, receiptPreview: undefined, existingReceiptId: undefined }));
    }
  }

  function applySuggestion(entryKey: string) {
    const suggestion = suggestions[entryKey];
    if (!suggestion) return;
    setEntries((prev) =>
      prev.map((e) => {
        if (e.key !== entryKey) return e;
        return {
          ...e,
          debitAccountId: suggestion.debitAccountId,
          creditAccountId: suggestion.creditAccountId,
        };
      })
    );
    setSuggestions((prev) => ({ ...prev, [entryKey]: null }));
    toast.success("仕訳候補を適用しました。内容を確認して保存してください");
  }

  function dismissSuggestion(entryKey: string) {
    setSuggestions((prev) => ({ ...prev, [entryKey]: null }));
  }

  function addEntry() {
    const lastEntry = entries[entries.length - 1];
    setEntries((prev) => [
      ...prev,
      { ...createEmptySimple(), date: lastEntry?.date || getToday(), paymentMethod: lastEntry?.paymentMethod || "" },
    ]);
  }

  function removeEntry(index: number) {
    if (entries.length <= 1) return;
    const removed = entries[index];
    if (removed.receiptPreview && removed.receiptPreview !== "PDF" && !removed.existingReceiptId) URL.revokeObjectURL(removed.receiptPreview);
    setSuggestions((prev) => {
      const next = { ...prev };
      delete next[removed.key];
      return next;
    });
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }

  /* ─── Compound mode helpers ─── */

  function addCompoundLine(side: "debit" | "credit") {
    setCompoundEntry((prev) => ({
      ...prev,
      lines: [...prev.lines, { key: crypto.randomUUID(), side, accountId: "", amount: "" }],
    }));
  }

  function updateCompoundLine(lineKey: string, field: "accountId" | "amount", value: string) {
    setCompoundEntry((prev) => ({
      ...prev,
      lines: prev.lines.map((l) => (l.key === lineKey ? { ...l, [field]: value } : l)),
    }));
  }

  function removeCompoundLine(lineKey: string) {
    setCompoundEntry((prev) => ({
      ...prev,
      lines: prev.lines.filter((l) => l.key !== lineKey),
    }));
  }

  /* ─── Save ─── */

  async function handleSave() {
    setSaving(true);
    try {
      const now = new Date().toISOString();

      if (mode === "simple") {
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          if (!e.date || !e.debitAccountId || !e.creditAccountId || !e.amount) {
            toast.error(`${i + 1}行目: 日付・借方・貸方・金額は必須です`);
            setSaving(false);
            return;
          }
          if (e.debitAccountId === e.creditAccountId) {
            toast.error(`${i + 1}行目: 借方と貸方に同じ科目は指定できません`);
            setSaving(false);
            return;
          }
          if (isNaN(Number(e.amount)) || Number(e.amount) <= 0) {
            toast.error(`${i + 1}行目: 金額は正の数値を入力してください`);
            setSaving(false);
            return;
          }
        }

        for (const e of entries) {
          const journalId = isEdit ? e.key : crypto.randomUUID();
          let receiptId: string | undefined = e.existingReceiptId;

          if (e.receiptFile) {
            const base64 = await fileToBase64(e.receiptFile);
            receiptId = receiptId || crypto.randomUUID();
            const receipt: Receipt = {
              id: receiptId,
              imageData: base64,
              fileName: e.receiptFile.name,
              date: e.date,
              amount: Number(e.amount) || undefined,
              vendor: e.description || undefined,
              description: e.description,
              journalEntryId: journalId,
              createdAt: now,
            };
            await putReceipt(receipt);
          }

          const journal: JournalEntry = {
            id: journalId,
            date: e.date,
            debitAccountId: e.debitAccountId,
            creditAccountId: e.creditAccountId,
            amount: Number(e.amount),
            description: e.description,
            memo: e.memo || undefined,
            paymentMethod: e.paymentMethod || undefined,
            taxCategory: e.taxCategory,
            taxRate: e.taxRate,
            taxIncluded: true,
            receiptId,
            createdAt: isEdit ? (pastJournals.find((j) => j.id === journalId)?.createdAt || now) : now,
            updatedAt: now,
          };
          await putJournal(journal);
        }
        toast.success(isEdit ? "仕訳を更新しました" : `${entries.length}件の仕訳を保存しました`);
      } else {
        // Compound mode
        const ce = compoundEntry;
        if (!ce.date || !ce.description) {
          toast.error("日付と摘要は必須です");
          setSaving(false);
          return;
        }
        const debitLines = ce.lines.filter((l) => l.side === "debit");
        const creditLines = ce.lines.filter((l) => l.side === "credit");
        if (debitLines.length === 0 || creditLines.length === 0) {
          toast.error("借方・貸方それぞれ1行以上必要です");
          setSaving(false);
          return;
        }
        for (const l of ce.lines) {
          if (!l.accountId || !l.amount || isNaN(Number(l.amount)) || Number(l.amount) <= 0) {
            toast.error("すべての行に科目と正の金額を入力してください");
            setSaving(false);
            return;
          }
        }
        const debitTotal = debitLines.reduce((s, l) => s + Number(l.amount), 0);
        const creditTotal = creditLines.reduce((s, l) => s + Number(l.amount), 0);
        if (Math.abs(debitTotal - creditTotal) > 0.01) {
          toast.error(`借方合計(${debitTotal})と貸方合計(${creditTotal})が一致しません`);
          setSaving(false);
          return;
        }

        const compoundGroupId = crypto.randomUUID();
        let receiptId: string | undefined;
        if (ce.receiptFile) {
          const base64 = await fileToBase64(ce.receiptFile);
          receiptId = crypto.randomUUID();
          await putReceipt({
            id: receiptId,
            imageData: base64,
            fileName: ce.receiptFile.name,
            date: ce.date,
            vendor: ce.description,
            description: ce.description,
            createdAt: now,
          });
        }

        // Clone lines to avoid mutation
        const dLines = debitLines.map((l) => ({ ...l }));
        const cLines = creditLines.map((l) => ({ ...l }));
        const journalsToSave: JournalEntry[] = [];
        for (const dl of dLines) {
          for (const cl of cLines) {
            const amount = Math.min(Number(dl.amount), Number(cl.amount));
            if (amount <= 0) continue;
            const journal: JournalEntry = {
              id: crypto.randomUUID(),
              date: ce.date,
              debitAccountId: dl.accountId,
              creditAccountId: cl.accountId,
              amount,
              description: ce.description,
              memo: ce.memo || undefined,
              paymentMethod: ce.paymentMethod || undefined,
              receiptId,
              tags: [compoundGroupId],
              createdAt: now,
              updatedAt: now,
            };
            journalsToSave.push(journal);
            dl.amount = String(Number(dl.amount) - amount);
            cl.amount = String(Number(cl.amount) - amount);
          }
        }
        await putJournalsAtomic(journalsToSave);
        toast.success("複合仕訳を保存しました");
      }

      navigate("/journals");
    } catch (err) {
      toast.error("保存に失敗しました");
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  /* ─── Account selector component ─── */
  function AccountSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="text-[13px]">
          <SelectValue placeholder={label || "勘定科目を選択"} />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(groupedAccounts).map(([group, accs]) => (
            <div key={group}>
              <div className="px-2 py-1.5 text-[11px] font-bold text-muted-foreground">{group}</div>
              {accs.map((acc) => (
                <SelectItem key={acc.id} value={acc.id} className="text-[13px]">
                  {acc.code} {acc.name}
                </SelectItem>
              ))}
            </div>
          ))}
        </SelectContent>
      </Select>
    );
  }

  /* ─── Payment method selector ─── */
  function PaymentMethodSelect({ entryKey, value, onChange }: { entryKey: string; value: string; onChange: (v: string) => void }) {
    const isCustom = showCustomPayment[entryKey];
    return (
      <div>
        <Label className="text-[12px] font-semibold">
          <CreditCard className="inline h-3 w-3 mr-1 -mt-0.5" />
          決済手段（任意）
        </Label>
        {isCustom ? (
          <div className="mt-1 flex gap-2">
            <Input
              placeholder="カード名を入力"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="text-[13px]"
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-[11px] shrink-0"
              onClick={() => setShowCustomPayment((prev) => ({ ...prev, [entryKey]: false }))}
            >
              一覧
            </Button>
          </div>
        ) : (
          <div className="mt-1 flex gap-2">
            <Select value={value} onValueChange={onChange}>
              <SelectTrigger className="text-[13px]">
                <SelectValue placeholder="選択してください" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-[13px] text-muted-foreground">
                  未設定
                </SelectItem>
                {PAYMENT_PRESETS.map((p) => (
                  <SelectItem key={p} value={p} className="text-[13px]">
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-[11px] shrink-0"
              onClick={() => setShowCustomPayment((prev) => ({ ...prev, [entryKey]: true }))}
            >
              手入力
            </Button>
          </div>
        )}
      </div>
    );
  }

  /* ─── Receipt attachment UI ─── */
  function ReceiptAttachment({ entryKey, preview, receiptFile }: { entryKey: string; preview?: string; receiptFile?: File }) {
    const isPdf = preview === "PDF" || receiptFile?.type === "application/pdf";
    return (
      <div>
        <Label className="text-[12px] font-semibold">
          <Camera className="inline h-3 w-3 mr-1 -mt-0.5" />
          レシート（画像/PDF、任意）
        </Label>
        <div className="mt-1">
          {preview ? (
            <div className="flex items-start gap-3">
              {isPdf ? (
                <div className="h-20 w-20 flex items-center justify-center rounded-lg border border-border bg-muted/20 shrink-0">
                  <div className="text-center">
                    <div className="text-[20px] font-bold text-primary">PDF</div>
                    <div className="text-[10px] text-muted-foreground">添付済</div>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPreviewImage(preview)}
                  className="relative group rounded-lg overflow-hidden border border-border shrink-0"
                >
                  <img src={preview} alt="レシート" className="h-20 w-20 object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                    <ImageIcon className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </button>
              )}
              <div className="flex flex-col gap-1">
                <span className="text-[12px] text-muted-foreground truncate max-w-[200px]">
                  {receiptFile?.name || "保存済みレシート"}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px] text-destructive hover:text-destructive w-fit px-2"
                  onClick={() => removeReceipt(entryKey)}
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  削除
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <input
                ref={(el) => { fileInputRefs.current[entryKey] = el; }}
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleReceiptSelect(entryKey, file);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-[12px] text-muted-foreground"
                onClick={() => fileInputRefs.current[entryKey]?.click()}
              >
                <Camera className="h-3.5 w-3.5 mr-1.5" />
                レシートを撮影・選択（画像/PDF）
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          {isEdit && (
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate("/journals")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <h1 className="text-xl font-bold">{isEdit ? "仕訳を編集" : "仕訳入力"}</h1>
          {!isEdit && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={aiEnabled ? "default" : "outline"}
                  size="sm"
                  className="h-7 gap-1 text-[12px]"
                  onClick={() => setAiEnabled(!aiEnabled)}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  仕訳候補
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-[12px]">
                  {aiEnabled ? "摘要を入力すると候補を表示します（保存前に確認が必要）" : "クリックで仕訳候補を有効にします"}
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="flex gap-2">
          {!isEdit && mode === "simple" && (
            <Button variant="outline" size="sm" onClick={addEntry}>
              <Plus className="h-4 w-4 mr-1" />
              行を追加
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-1" />
            {saving ? "保存中..." : isEdit ? "更新" : "保存"}
          </Button>
        </div>
      </div>

      {/* Mode tabs */}
      {!isEdit && (
        <Tabs value={mode} onValueChange={(v) => setMode(v as "simple" | "compound")} className="mb-4">
          <TabsList className="h-9">
            <TabsTrigger value="simple" className="text-[12px] gap-1.5">
              <Save className="h-3.5 w-3.5" />
              通常仕訳
            </TabsTrigger>
            <TabsTrigger value="compound" className="text-[12px] gap-1.5">
              <Layers className="h-3.5 w-3.5" />
              複合仕訳
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {/* ─── Simple Mode ─── */}
      {mode === "simple" && (
        <div className="space-y-4">
          {entries.map((entry, index) => {
            const suggestion = suggestions[entry.key];
            const conf = suggestion ? getConfidenceLabel(suggestion.confidence) : null;

            return (
              <Card key={entry.key} className="border shadow-sm">
                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                  <CardTitle className="text-[13px] font-bold text-muted-foreground">
                    {isEdit ? "仕訳を編集" : `仕訳 #${index + 1}`}
                  </CardTitle>
                  <div className="flex items-center gap-1">
                    {entry.receiptPreview && (
                      <span className="text-[10px] font-bold text-green-600 bg-green-50 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded-full">
                        <Camera className="inline h-3 w-3 mr-0.5" />
                        レシート添付済
                      </span>
                    )}
                    {entry.paymentMethod && (
                      <span className="text-[10px] font-bold text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400 px-1.5 py-0.5 rounded-full">
                        <CreditCard className="inline h-3 w-3 mr-0.5" />
                        {entry.paymentMethod}
                      </span>
                    )}
                    {entries.length > 1 && !isEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeEntry(index)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Vendor quick select */}
                  {vendors.length > 0 && (
                    <div>
                      <Label className="text-[12px] font-semibold">
                        <Users className="inline h-3 w-3 mr-1 -mt-0.5" />
                        取引先から入力（任意）
                      </Label>
                      <Select
                        value="__placeholder__"
                        onValueChange={(vendorId) => {
                          const vendor = vendors.find((v) => v.id === vendorId);
                          if (!vendor) return;
                          setEntries((prev) =>
                            prev.map((e, i) => {
                              if (i !== index) return e;
                              return {
                                ...e,
                                description: e.description || vendor.name,
                                debitAccountId: vendor.defaultDebitAccountId || e.debitAccountId,
                                creditAccountId: vendor.defaultCreditAccountId || e.creditAccountId,
                                paymentMethod: vendor.defaultPaymentMethod || e.paymentMethod,
                              };
                            })
                          );
                          toast.success(`取引先「${vendor.name}」の情報を反映しました`);
                        }}
                      >
                        <SelectTrigger className="mt-1 text-[13px]">
                          <SelectValue placeholder="登録済み取引先を選択" />
                        </SelectTrigger>
                        <SelectContent>
                          {vendors.map((v) => (
                            <SelectItem key={v.id} value={v.id} className="text-[13px]">
                              {v.name}{v.shortName ? ` (${v.shortName})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Description */}
                  <div>
                    <Label className="text-[12px] font-semibold">
                      摘要
                      {aiEnabled && !isEdit && (
                        <span className="ml-2 text-[10px] font-normal text-primary">
                          <Sparkles className="inline h-3 w-3 mr-0.5 -mt-0.5" />
                          入力すると過去履歴・キーワードから候補を推定
                        </span>
                      )}
                    </Label>
                    <Input
                      placeholder="例: スタバでクライアントと打ち合わせ"
                      value={entry.description}
                      onChange={(e) => updateEntry(index, "description", e.target.value)}
                      className="mt-1 text-[13px]"
                    />
                  </div>

                  {/* AI Suggestion */}
                  {suggestion && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/15">
                      <Sparkles className="h-4 w-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[12px] font-bold text-primary">仕訳候補:</span>
                          <span className="text-[12px] font-semibold">
                            借方: {suggestion.debitAccountName} / 貸方: {suggestion.creditAccountName}
                          </span>
                          <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold ${conf?.color}`}>
                            信頼度 {conf?.label} ({suggestion.confidence}%)
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{suggestion.reason}</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="default" size="sm" className="h-7 text-[11px] gap-1" onClick={() => applySuggestion(entry.key)}>
                          <Check className="h-3 w-3" />適用
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground" onClick={() => dismissSuggestion(entry.key)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <Label className="text-[12px] font-semibold">日付</Label>
                      <Input type="date" value={entry.date} onChange={(e) => updateEntry(index, "date", e.target.value)} className="mt-1 text-[13px] font-mono" />
                    </div>
                    <div>
                      <Label className="text-[12px] font-semibold">金額（円）</Label>
                      <Input type="number" placeholder="0" value={entry.amount} onChange={(e) => updateEntry(index, "amount", e.target.value)} className="mt-1 text-[13px] font-mono" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <Label className="text-[12px] font-semibold">消費税区分</Label>
                      <select value={entry.taxCategory} onChange={(e) => updateEntry(index, "taxCategory", e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-[13px]">
                        <option value="out-of-scope">対象外・未設定</option>
                        <option value="taxable-sales">課税売上10%</option>
                        <option value="taxable-sales-reduced">課税売上8%</option>
                        <option value="taxable-purchase">課税仕入10%</option>
                        <option value="taxable-purchase-reduced">課税仕入8%</option>
                        <option value="exempt">非課税</option>
                        <option value="non-taxable">不課税・免税</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-[12px] font-semibold">税率（%）</Label>
                      <Input type="number" min="0" max="100" value={entry.taxRate} onChange={(e) => updateEntry(index, "taxRate", e.target.value)} className="mt-1 text-[13px] font-mono" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <Label className="text-[12px] font-semibold">借方（左）</Label>
                      <div className="mt-1">
                        <AccountSelect value={entry.debitAccountId} onChange={(v) => updateEntry(index, "debitAccountId", v)} />
                      </div>
                    </div>
                    <div>
                      <Label className="text-[12px] font-semibold">貸方（右）</Label>
                      <div className="mt-1">
                        <AccountSelect value={entry.creditAccountId} onChange={(v) => updateEntry(index, "creditAccountId", v)} />
                      </div>
                    </div>
                  </div>

                  {/* Payment method */}
                  <PaymentMethodSelect
                    entryKey={entry.key}
                    value={entry.paymentMethod}
                    onChange={(v) => updateEntry(index, "paymentMethod", v === "__none__" ? "" : v)}
                  />

                  <div>
                    <Label className="text-[12px] font-semibold">メモ（任意）</Label>
                    <Input placeholder="補足メモ" value={entry.memo} onChange={(e) => updateEntry(index, "memo", e.target.value)} className="mt-1 text-[13px]" />
                  </div>

                  <ReceiptAttachment entryKey={entry.key} preview={entry.receiptPreview} receiptFile={entry.receiptFile} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ─── Compound Mode ─── */}
      {mode === "compound" && (
        <Card className="border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-[13px] font-bold text-muted-foreground">複合仕訳</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-[12px] font-semibold">日付</Label>
                <Input
                  type="date"
                  value={compoundEntry.date}
                  onChange={(e) => setCompoundEntry((prev) => ({ ...prev, date: e.target.value }))}
                  className="mt-1 text-[13px] font-mono"
                />
              </div>
              <div>
                <Label className="text-[12px] font-semibold">摘要</Label>
                <Input
                  placeholder="取引の内容"
                  value={compoundEntry.description}
                  onChange={(e) => setCompoundEntry((prev) => ({ ...prev, description: e.target.value }))}
                  className="mt-1 text-[13px]"
                />
              </div>
            </div>

            {/* Debit lines */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-[12px] font-bold text-blue-700 dark:text-blue-400">借方（左）</Label>
                <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={() => addCompoundLine("debit")}>
                  <Plus className="h-3 w-3 mr-0.5" />行追加
                </Button>
              </div>
              <div className="space-y-2">
                {compoundEntry.lines.filter((l) => l.side === "debit").map((line) => (
                  <div key={line.key} className="flex items-center gap-2">
                    <div className="flex-1">
                      <AccountSelect value={line.accountId} onChange={(v) => updateCompoundLine(line.key, "accountId", v)} />
                    </div>
                    <Input
                      type="number"
                      placeholder="金額"
                      value={line.amount}
                      onChange={(e) => updateCompoundLine(line.key, "amount", e.target.value)}
                      className="w-32 text-[13px] font-mono"
                    />
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeCompoundLine(line.key)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="mt-1 text-right text-[12px] font-mono font-bold text-blue-700 dark:text-blue-400">
                借方合計: ¥{compoundEntry.lines.filter((l) => l.side === "debit").reduce((s, l) => s + (Number(l.amount) || 0), 0).toLocaleString()}
              </div>
            </div>

            {/* Credit lines */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-[12px] font-bold text-red-700 dark:text-red-400">貸方（右）</Label>
                <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={() => addCompoundLine("credit")}>
                  <Plus className="h-3 w-3 mr-0.5" />行追加
                </Button>
              </div>
              <div className="space-y-2">
                {compoundEntry.lines.filter((l) => l.side === "credit").map((line) => (
                  <div key={line.key} className="flex items-center gap-2">
                    <div className="flex-1">
                      <AccountSelect value={line.accountId} onChange={(v) => updateCompoundLine(line.key, "accountId", v)} />
                    </div>
                    <Input
                      type="number"
                      placeholder="金額"
                      value={line.amount}
                      onChange={(e) => updateCompoundLine(line.key, "amount", e.target.value)}
                      className="w-32 text-[13px] font-mono"
                    />
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeCompoundLine(line.key)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="mt-1 text-right text-[12px] font-mono font-bold text-red-700 dark:text-red-400">
                貸方合計: ¥{compoundEntry.lines.filter((l) => l.side === "credit").reduce((s, l) => s + (Number(l.amount) || 0), 0).toLocaleString()}
              </div>
            </div>

            {/* Balance check */}
            {(() => {
              const dTotal = compoundEntry.lines.filter((l) => l.side === "debit").reduce((s, l) => s + (Number(l.amount) || 0), 0);
              const cTotal = compoundEntry.lines.filter((l) => l.side === "credit").reduce((s, l) => s + (Number(l.amount) || 0), 0);
              const diff = dTotal - cTotal;
              if (diff !== 0 && (dTotal > 0 || cTotal > 0)) {
                return (
                  <div className="text-[12px] font-bold text-destructive bg-destructive/5 rounded-lg px-3 py-2">
                    差額: ¥{Math.abs(diff).toLocaleString()} （{diff > 0 ? "借方超過" : "貸方超過"}）
                  </div>
                );
              }
              return null;
            })()}

            {/* Payment method for compound */}
            <PaymentMethodSelect
              entryKey={compoundEntry.key}
              value={compoundEntry.paymentMethod}
              onChange={(v) => setCompoundEntry((prev) => ({ ...prev, paymentMethod: v === "__none__" ? "" : v }))}
            />

            <div>
              <Label className="text-[12px] font-semibold">メモ（任意）</Label>
              <Input
                placeholder="補足メモ"
                value={compoundEntry.memo}
                onChange={(e) => setCompoundEntry((prev) => ({ ...prev, memo: e.target.value }))}
                className="mt-1 text-[13px]"
              />
            </div>

            <ReceiptAttachment entryKey={compoundEntry.key} preview={compoundEntry.receiptPreview} receiptFile={compoundEntry.receiptFile} />
          </CardContent>
        </Card>
      )}

      {/* Bottom buttons */}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate("/journals")}>
          キャンセル
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-1" />
          {saving ? "保存中..." : isEdit ? "更新" : mode === "compound" ? "複合仕訳を保存" : `${entries.length}件を保存`}
        </Button>
      </div>

      {/* Receipt preview dialog */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-lg p-2">
          <DialogTitle className="sr-only">レシート画像プレビュー</DialogTitle>
          {previewImage && (
            <img src={previewImage} alt="レシートプレビュー" className="w-full h-auto rounded-lg" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
