/**
 * JournalForm — 仕訳入力ページ（AI自動仕訳 + レシート添付）
 * macOS Ledger Design
 *
 * - 摘要を入力するとAIが勘定科目を自動推定
 * - レシート画像を添付して仕訳と紐付け保存
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
import {
  getAllAccounts,
  getAllJournals,
  putJournal,
  putReceipt,
  type AccountItem,
  type JournalEntry,
  type Receipt,
} from "@/lib/db";
import { suggestJournalAccounts, getConfidenceLabel, type AISuggestion } from "@/lib/ai-journal";
import { CATEGORY_LABELS, getToday } from "@/lib/utils";
import { Save, Plus, Trash2, Sparkles, Check, X, Camera, Image as ImageIcon } from "lucide-react";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

interface FormEntry {
  key: string;
  date: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: string;
  description: string;
  memo: string;
  receiptFile?: File;
  receiptPreview?: string;
}

function createEmptyEntry(): FormEntry {
  return {
    key: crypto.randomUUID(),
    date: getToday(),
    debitAccountId: "",
    creditAccountId: "",
    amount: "",
    description: "",
    memo: "",
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

export default function JournalForm() {
  const [, navigate] = useLocation();
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [pastJournals, setPastJournals] = useState<JournalEntry[]>([]);
  const [entries, setEntries] = useState<FormEntry[]>([createEmptyEntry()]);
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<string, AISuggestion | null>>({});
  const [aiEnabled, setAiEnabled] = useState(true);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

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

  function updateEntry(index: number, field: keyof FormEntry, value: string) {
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
    if (!file.type.startsWith("image/")) {
      toast.error("画像ファイルを選択してください");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("ファイルサイズは10MB以下にしてください");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setEntries((prev) =>
      prev.map((e) =>
        e.key === entryKey ? { ...e, receiptFile: file, receiptPreview: previewUrl } : e
      )
    );
    toast.success("レシート画像を添付しました");
  }

  function removeReceipt(entryKey: string) {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.key !== entryKey) return e;
        if (e.receiptPreview) URL.revokeObjectURL(e.receiptPreview);
        return { ...e, receiptFile: undefined, receiptPreview: undefined };
      })
    );
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
    toast.success("AIの提案を適用しました");
  }

  function dismissSuggestion(entryKey: string) {
    setSuggestions((prev) => ({ ...prev, [entryKey]: null }));
  }

  function addEntry() {
    const lastEntry = entries[entries.length - 1];
    setEntries((prev) => [
      ...prev,
      { ...createEmptyEntry(), date: lastEntry?.date || getToday() },
    ]);
  }

  function removeEntry(index: number) {
    if (entries.length <= 1) return;
    const removed = entries[index];
    if (removed.receiptPreview) URL.revokeObjectURL(removed.receiptPreview);
    setSuggestions((prev) => {
      const next = { ...prev };
      delete next[removed.key];
      return next;
    });
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e.date || !e.debitAccountId || !e.creditAccountId || !e.amount) {
        toast.error(`${i + 1}行目: 日付・借方・貸方・金額は必須です`);
        return;
      }
      if (e.debitAccountId === e.creditAccountId) {
        toast.error(`${i + 1}行目: 借方と貸方に同じ科目は指定できません`);
        return;
      }
      if (isNaN(Number(e.amount)) || Number(e.amount) <= 0) {
        toast.error(`${i + 1}行目: 金額は正の数値を入力してください`);
        return;
      }
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      for (const e of entries) {
        const journalId = crypto.randomUUID();
        let receiptId: string | undefined;

        // レシート画像がある場合は先にReceiptを保存
        if (e.receiptFile) {
          const base64 = await fileToBase64(e.receiptFile);
          receiptId = crypto.randomUUID();
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
          memo: e.memo,
          receiptId,
          createdAt: now,
          updatedAt: now,
        };
        await putJournal(journal);
      }
      toast.success(`${entries.length}件の仕訳を保存しました`);
      navigate("/journals");
    } catch {
      toast.error("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 lg:p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">仕訳入力</h1>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={aiEnabled ? "default" : "outline"}
                size="sm"
                className="h-7 gap-1 text-[12px]"
                onClick={() => setAiEnabled(!aiEnabled)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                AI自動仕訳
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-[12px]">
                {aiEnabled
                  ? "摘要を入力すると勘定科目を自動推定します"
                  : "クリックでAI自動仕訳を有効にします"}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addEntry}>
            <Plus className="h-4 w-4 mr-1" />
            行を追加
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-1" />
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {entries.map((entry, index) => {
          const suggestion = suggestions[entry.key];
          const conf = suggestion ? getConfidenceLabel(suggestion.confidence) : null;

          return (
            <Card key={entry.key} className="border shadow-sm">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-[13px] font-bold text-muted-foreground">
                  仕訳 #{index + 1}
                </CardTitle>
                <div className="flex items-center gap-1">
                  {entry.receiptPreview && (
                    <span className="text-[10px] text-green-600 font-semibold mr-1">
                      <Camera className="inline h-3 w-3 mr-0.5" />
                      レシート添付済
                    </span>
                  )}
                  {entries.length > 1 && (
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
                {/* Description first — AI triggers on this */}
                <div>
                  <Label className="text-[12px] font-semibold">
                    摘要
                    {aiEnabled && (
                      <span className="ml-2 text-[10px] font-normal text-primary">
                        <Sparkles className="inline h-3 w-3 mr-0.5 -mt-0.5" />
                        入力するとAIが科目を推定
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

                {/* AI Suggestion Banner */}
                {suggestion && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/15">
                    <Sparkles className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[12px] font-bold text-primary">AI提案:</span>
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
                      <Button
                        variant="default"
                        size="sm"
                        className="h-7 text-[11px] gap-1"
                        onClick={() => applySuggestion(entry.key)}
                      >
                        <Check className="h-3 w-3" />
                        適用
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground"
                        onClick={() => dismissSuggestion(entry.key)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label className="text-[12px] font-semibold">日付</Label>
                    <Input
                      type="date"
                      value={entry.date}
                      onChange={(e) => updateEntry(index, "date", e.target.value)}
                      className="mt-1 text-[13px] font-mono"
                    />
                  </div>
                  <div>
                    <Label className="text-[12px] font-semibold">金額（円）</Label>
                    <Input
                      type="number"
                      placeholder="0"
                      value={entry.amount}
                      onChange={(e) => updateEntry(index, "amount", e.target.value)}
                      className="mt-1 text-[13px] font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label className="text-[12px] font-semibold">
                      借方（左）
                      {entry.debitAccountId && suggestion?.debitAccountId === entry.debitAccountId && (
                        <span className="ml-1 text-[10px] text-primary"><Sparkles className="inline h-2.5 w-2.5" /> AI</span>
                      )}
                    </Label>
                    <Select
                      value={entry.debitAccountId}
                      onValueChange={(v) => updateEntry(index, "debitAccountId", v)}
                    >
                      <SelectTrigger className="mt-1 text-[13px]">
                        <SelectValue placeholder="勘定科目を選択" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(groupedAccounts).map(([group, accs]) => (
                          <div key={group}>
                            <div className="px-2 py-1.5 text-[11px] font-bold text-muted-foreground">
                              {group}
                            </div>
                            {accs.map((acc) => (
                              <SelectItem key={acc.id} value={acc.id} className="text-[13px]">
                                {acc.code} {acc.name}
                              </SelectItem>
                            ))}
                          </div>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-[12px] font-semibold">
                      貸方（右）
                      {entry.creditAccountId && suggestion?.creditAccountId === entry.creditAccountId && (
                        <span className="ml-1 text-[10px] text-primary"><Sparkles className="inline h-2.5 w-2.5" /> AI</span>
                      )}
                    </Label>
                    <Select
                      value={entry.creditAccountId}
                      onValueChange={(v) => updateEntry(index, "creditAccountId", v)}
                    >
                      <SelectTrigger className="mt-1 text-[13px]">
                        <SelectValue placeholder="勘定科目を選択" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(groupedAccounts).map(([group, accs]) => (
                          <div key={group}>
                            <div className="px-2 py-1.5 text-[11px] font-bold text-muted-foreground">
                              {group}
                            </div>
                            {accs.map((acc) => (
                              <SelectItem key={acc.id} value={acc.id} className="text-[13px]">
                                {acc.code} {acc.name}
                              </SelectItem>
                            ))}
                          </div>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Memo */}
                <div>
                  <Label className="text-[12px] font-semibold">メモ（任意）</Label>
                  <Input
                    placeholder="補足メモ"
                    value={entry.memo}
                    onChange={(e) => updateEntry(index, "memo", e.target.value)}
                    className="mt-1 text-[13px]"
                  />
                </div>

                {/* Receipt attachment */}
                <div>
                  <Label className="text-[12px] font-semibold">
                    <Camera className="inline h-3 w-3 mr-1 -mt-0.5" />
                    レシート画像（任意）
                  </Label>
                  <div className="mt-1">
                    {entry.receiptPreview ? (
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => setPreviewImage(entry.receiptPreview!)}
                          className="relative group rounded-lg overflow-hidden border border-border shrink-0"
                        >
                          <img
                            src={entry.receiptPreview}
                            alt="レシート"
                            className="h-20 w-20 object-cover"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                            <ImageIcon className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </button>
                        <div className="flex flex-col gap-1">
                          <span className="text-[12px] text-muted-foreground truncate max-w-[200px]">
                            {entry.receiptFile?.name}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[11px] text-destructive hover:text-destructive w-fit px-2"
                            onClick={() => removeReceipt(entry.key)}
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            削除
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <input
                          ref={(el) => { fileInputRefs.current[entry.key] = el; }}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleReceiptSelect(entry.key, file);
                            e.target.value = "";
                          }}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-[12px] text-muted-foreground"
                          onClick={() => fileInputRefs.current[entry.key]?.click()}
                        >
                          <Camera className="h-3.5 w-3.5 mr-1.5" />
                          レシートを撮影・選択
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Bottom save button */}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate("/journals")}>
          キャンセル
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-1" />
          {saving ? "保存中..." : `${entries.length}件を保存`}
        </Button>
      </div>

      {/* Receipt image preview dialog */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-lg p-2">
          <DialogTitle className="sr-only">レシート画像プレビュー</DialogTitle>
          {previewImage && (
            <img
              src={previewImage}
              alt="レシートプレビュー"
              className="w-full h-auto rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
