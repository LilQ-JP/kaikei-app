/**
 * JournalForm — 仕訳入力ページ
 * macOS Ledger Design
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
  getAllAccounts,
  putJournal,
  type AccountItem,
  type JournalEntry,
} from "@/lib/db";
import { CATEGORY_LABELS, getToday } from "@/lib/utils";
import { Save, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, useMemo } from "react";
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
  const [entries, setEntries] = useState<FormEntry[]>([createEmptyEntry()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAllAccounts().then(setAccounts);
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

  function updateEntry(index: number, field: keyof FormEntry, value: string) {
    setEntries((prev) =>
      prev.map((e, i) => (i === index ? { ...e, [field]: value } : e))
    );
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
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    // Validate
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
    } catch (err) {
      toast.error("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 lg:p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">仕訳入力</h1>
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
        {entries.map((entry, index) => (
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Date */}
                <div>
                  <Label className="text-[12px] font-semibold">日付</Label>
                  <Input
                    type="date"
                    value={entry.date}
                    onChange={(e) => updateEntry(index, "date", e.target.value)}
                    className="mt-1 text-[13px] font-mono"
                  />
                </div>

                {/* Amount */}
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
                {/* Debit account */}
                <div>
                  <Label className="text-[12px] font-semibold">借方（左）</Label>
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

                {/* Credit account */}
                <div>
                  <Label className="text-[12px] font-semibold">貸方（右）</Label>
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

              {/* Description */}
              <div>
                <Label className="text-[12px] font-semibold">摘要</Label>
                <Input
                  placeholder="取引の内容を入力"
                  value={entry.description}
                  onChange={(e) => updateEntry(index, "description", e.target.value)}
                  className="mt-1 text-[13px]"
                />
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
        ))}
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
