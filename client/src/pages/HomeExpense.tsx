/**
 * HomeExpense — 家事按分ページ
 * macOS Ledger Design
 *
 * 家賃・光熱費・通信費などの事業使用割合を設定し、
 * 自動で按分計算を行う
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  getAllAccounts,
  getAllJournals,
  putJournal,
  type AccountItem,
  type JournalEntry,
} from "@/lib/db";
import { formatYen, CATEGORY_LABELS } from "@/lib/utils";
import { Plus, Trash2, Calculator, Save, Info } from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import { toast } from "sonner";
import { journalLines } from "@shared/accounting";
import { loadAppJson, saveAppJson } from "@/lib/app-storage";

interface HomeExpenseRule {
  id: string;
  accountId: string;
  businessRatio: number; // 0-100
  description: string;
}

const STORAGE_KEY = "kaikei-home-expense-rules";

export default function HomeExpense() {
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [rules, setRules] = useState<HomeExpenseRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newRule, setNewRule] = useState<Partial<HomeExpenseRule>>({
    accountId: "",
    businessRatio: 50,
    description: "",
  });
  const [showJournalDialog, setShowJournalDialog] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAppJson<HomeExpenseRule[]>("homeExpenseRules", STORAGE_KEY, []).then(setRules).catch(() => toast.error("家事按分ルールを読み込めません"));
  }, []);

  useEffect(() => {
    Promise.all([getAllAccounts(), getAllJournals()]).then(([accs, j]) => {
      setAccounts(accs);
      setJournals(j);
      setLoading(false);
    });
  }, []);

  const accountMap = useMemo(() => {
    const map = new Map<string, AccountItem>();
    accounts.forEach((a) => map.set(a.id, a));
    return map;
  }, [accounts]);

  const expenseAccounts = useMemo(
    () => accounts.filter((a) => a.category === "expense").sort((a, b) => a.code.localeCompare(b.code)),
    [accounts]
  );

  const yearJournals = useMemo(
    () => journals.filter((j) => j.date.startsWith(String(year))),
    [journals, year]
  );

  // Calculate totals per rule
  const calculations = useMemo(() => {
    return rules.map((rule) => {
      const total = yearJournals
        .reduce((sum, journal) => sum + journalLines(journal).filter((line) => line.accountId === rule.accountId).reduce((lineSum, line) => lineSum + (line.side === "debit" ? line.amount : -line.amount), 0), 0);
      const businessAmount = Math.round(total * (rule.businessRatio / 100));
      const personalAmount = total - businessAmount;
      return {
        rule,
        totalAmount: total,
        businessAmount,
        personalAmount,
        accountName: accountMap.get(rule.accountId)?.name || "不明",
      };
    });
  }, [rules, yearJournals, accountMap]);

  const totalBusiness = calculations.reduce((s, c) => s + c.businessAmount, 0);
  const totalPersonal = calculations.reduce((s, c) => s + c.personalAmount, 0);
  const totalAll = calculations.reduce((s, c) => s + c.totalAmount, 0);

  function handleAddRule() {
    if (!newRule.accountId) {
      toast.error("勘定科目を選択してください");
      return;
    }
    if (rules.some((r) => r.accountId === newRule.accountId)) {
      toast.error("この科目は既に設定されています");
      return;
    }
    const rule: HomeExpenseRule = {
      id: crypto.randomUUID(),
      accountId: newRule.accountId!,
      businessRatio: newRule.businessRatio || 50,
      description: newRule.description || "",
    };
    const updated = [...rules, rule];
    setRules(updated);
    void saveAppJson("homeExpenseRules", STORAGE_KEY, updated);
    setShowAddDialog(false);
    setNewRule({ accountId: "", businessRatio: 50, description: "" });
    toast.success("按分ルールを追加しました");
  }

  function updateRuleRatio(id: string, ratio: number) {
    const updated = rules.map((r) => (r.id === id ? { ...r, businessRatio: Math.max(0, Math.min(100, ratio)) } : r));
    setRules(updated);
    void saveAppJson("homeExpenseRules", STORAGE_KEY, updated);
  }

  function deleteRule(id: string) {
    const updated = rules.filter((r) => r.id !== id);
    setRules(updated);
    void saveAppJson("homeExpenseRules", STORAGE_KEY, updated);
    toast.success("按分ルールを削除しました");
  }

  async function handleCreateJournals() {
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const jigyounushiKari = accounts.find((a) => a.name === "事業主貸");
      if (!jigyounushiKari) {
        toast.error("「事業主貸」科目が見つかりません");
        setSaving(false);
        return;
      }

      const existingJournals = await getAllJournals();
      let count = 0;
      for (const calc of calculations) {
        if (calc.personalAmount <= 0) continue;
        const sourceKey = `家事按分:${year}:${calc.rule.id}`;
        if (existingJournals.some((journal) => journal.memo?.includes(sourceKey))) continue;
        const journal: JournalEntry = {
          id: crypto.randomUUID(),
          date: `${year}-12-31`,
          debitAccountId: jigyounushiKari.id,
          creditAccountId: calc.rule.accountId,
          amount: calc.personalAmount,
          description: `家事按分 ${calc.accountName} 個人使用分 ${100 - calc.rule.businessRatio}%`,
          memo: `家事按分自動仕訳 ${year}年度 ${sourceKey}`,
          sourceKey,
          createdAt: now,
          updatedAt: now,
        };
        await putJournal(journal);
        count++;
      }
      toast.success(`${count}件の家事按分仕訳を作成しました`);
      setShowJournalDialog(false);
      // Reload journals
      const j = await getAllJournals();
      setJournals(j);
    } catch {
      toast.error("仕訳の作成に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center"><div className="text-sm text-muted-foreground">読み込み中...</div></div>;
  }

  return (
    <div className="p-4 lg:p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">家事按分</h1>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => setYear(year - 1)}>←</Button>
            <span className="text-[14px] font-bold px-2">{year}年度</span>
            <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => setYear(year + 1)}>→</Button>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowAddDialog(true)}>
            <Plus className="h-4 w-4 mr-1" />
            ルール追加
          </Button>
          {calculations.some((c) => c.personalAmount > 0) && (
            <Button size="sm" onClick={() => setShowJournalDialog(true)}>
              <Calculator className="h-4 w-4 mr-1" />
              按分仕訳を作成
            </Button>
          )}
        </div>
      </div>

      {/* Info card */}
      <Card className="border shadow-sm mb-4 bg-blue-50/30">
        <CardContent className="py-3 px-4">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
            <p className="text-[12px] text-muted-foreground">
              家事按分とは、家賃・光熱費・通信費など、事業と私用の両方で使う経費を事業使用割合に応じて分ける処理です。
              事業使用割合を設定すると、年度末に自動で按分仕訳（事業主貸/各経費科目）を作成できます。
            </p>
          </div>
        </CardContent>
      </Card>

      {rules.length === 0 ? (
        <Card className="border shadow-sm">
          <CardContent className="py-16 text-center">
            <Calculator className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-[14px] font-semibold mb-1">按分ルールがありません</p>
            <p className="text-[12px] text-muted-foreground mb-4">「ルール追加」から家事按分する経費科目を設定してください</p>
            <Button variant="outline" size="sm" onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-1" />
              ルールを追加
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Rules table */}
          <Card className="border shadow-sm">
            <CardContent className="p-0">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-2.5 text-left font-bold text-muted-foreground">勘定科目</th>
                    <th className="px-4 py-2.5 text-right font-bold text-muted-foreground">年間合計</th>
                    <th className="px-4 py-2.5 text-center font-bold text-muted-foreground">事業割合</th>
                    <th className="px-4 py-2.5 text-right font-bold text-muted-foreground">事業分</th>
                    <th className="px-4 py-2.5 text-right font-bold text-muted-foreground">個人分</th>
                    <th className="px-4 py-2.5 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {calculations.map((calc) => (
                    <tr key={calc.rule.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-semibold">{calc.accountName}</div>
                        {calc.rule.description && (
                          <div className="text-[11px] text-muted-foreground">{calc.rule.description}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold">{formatYen(calc.totalAmount)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            value={calc.rule.businessRatio}
                            onChange={(e) => updateRuleRatio(calc.rule.id, Number(e.target.value))}
                            className="w-16 h-7 text-[12px] font-mono text-center"
                          />
                          <span className="text-[12px] text-muted-foreground">%</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-1.5 mt-1.5">
                          <div
                            className="bg-primary rounded-full h-1.5 transition-all"
                            style={{ width: `${calc.rule.businessRatio}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-green-600">{formatYen(calc.businessAmount)}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-red-600">{formatYen(calc.personalAmount)}</td>
                      <td className="px-2 py-3">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => deleteRule(calc.rule.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/20">
                    <td className="px-4 py-3 font-bold">合計</td>
                    <td className="px-4 py-3 text-right font-mono font-bold">{formatYen(totalAll)}</td>
                    <td className="px-4 py-3"></td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-green-600">{formatYen(totalBusiness)}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-red-600">{formatYen(totalPersonal)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Add rule dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>按分ルールを追加</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-[12px] font-semibold">勘定科目</Label>
              <Select value={newRule.accountId} onValueChange={(v) => setNewRule((p) => ({ ...p, accountId: v }))}>
                <SelectTrigger className="mt-1 text-[13px]">
                  <SelectValue placeholder="経費科目を選択" />
                </SelectTrigger>
                <SelectContent>
                  {expenseAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id} className="text-[13px]">
                      {acc.code} {acc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[12px] font-semibold">事業使用割合（%）</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={newRule.businessRatio}
                onChange={(e) => setNewRule((p) => ({ ...p, businessRatio: Number(e.target.value) }))}
                className="mt-1 text-[13px] font-mono"
              />
            </div>
            <div>
              <Label className="text-[12px] font-semibold">メモ（任意）</Label>
              <Input
                placeholder="例: 自宅兼事務所の家賃"
                value={newRule.description}
                onChange={(e) => setNewRule((p) => ({ ...p, description: e.target.value }))}
                className="mt-1 text-[13px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>キャンセル</Button>
            <Button onClick={handleAddRule}>追加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create journals dialog */}
      <Dialog open={showJournalDialog} onOpenChange={setShowJournalDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>按分仕訳を作成</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-[13px] text-muted-foreground">
              以下の家事按分仕訳を{year}年12月31日付で作成します。個人使用分を「事業主貸」で振り替えます。
            </p>
            <div className="space-y-2">
              {calculations.filter((c) => c.personalAmount > 0).map((calc) => (
                <div key={calc.rule.id} className="flex items-center justify-between text-[13px] py-1.5 px-3 bg-muted/30 rounded-lg">
                  <span className="font-medium">事業主貸 / {calc.accountName}</span>
                  <span className="font-mono font-bold">{formatYen(calc.personalAmount)}</span>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowJournalDialog(false)}>キャンセル</Button>
            <Button onClick={handleCreateJournals} disabled={saving}>
              <Save className="h-4 w-4 mr-1" />
              {saving ? "作成中..." : "仕訳を作成"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
