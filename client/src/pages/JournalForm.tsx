/**
 * JournalForm — 仕訳入力ページ（AI自動仕訳機能付き）
 * macOS Ledger Design
 *
 * 摘要を入力するとAIが自動的に勘定科目を推定。
 * 過去の仕訳パターン学習 + キーワードルールベースのハイブリッド方式。
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
  getAllAccounts,
  getAllJournals,
  putJournal,
  type AccountItem,
  type JournalEntry,
} from "@/lib/db";
import { suggestJournalAccounts, getConfidenceLabel, type AISuggestion } from "@/lib/ai-journal";
import { CATEGORY_LABELS, getToday } from "@/lib/utils";
import { Save, Plus, Trash2, Sparkles, Check, X } from "lucide-react";
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

export default function JournalForm() {
  const [, navigate] = useLocation();
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [pastJournals, setPastJournals] = useState<JournalEntry[]>([]);
  const [entries, setEntries] = useState<FormEntry[]>([createEmptyEntry()]);
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<string, AISuggestion | null>>({});
  const [aiEnabled, setAiEnabled] = useState(true);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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

      // Debounce: 300ms
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
        // 摘要が変更されたらAI推定を実行
        if (field === "description") {
          runAISuggestion(e.key, value);
        }
        return updated;
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
    // 適用後にサジェストをクリア
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
        const journal: JournalEntry = {
          id: crypto.randomUUID(),
          date: e.date,
          debitAccountId: e.debitAccountId,
          creditAccountId: e.creditAccountId,
          amount: Number(e.amount),
          description: e.description,
          memo: e.memo,
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
          {/* AI toggle */}
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
    </div>
  );
}
