/**
 * ProfitLoss — 損益計算書ページ
 * macOS Ledger Design
 */

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  getAllAccounts,
  getAllJournals,
  type AccountItem,
  type JournalEntry,
} from "@/lib/db";
import { formatYen, downloadFile } from "@/lib/utils";
import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export default function ProfitLoss() {
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());

  useEffect(() => {
    async function load() {
      const [j, a] = await Promise.all([getAllJournals(), getAllAccounts()]);
      setJournals(j);
      setAccounts(a);
      setLoading(false);
    }
    load();
  }, []);

  const yearJournals = useMemo(
    () => journals.filter((j) => j.date.startsWith(String(year))),
    [journals, year]
  );

  const accountMap = useMemo(() => {
    const map = new Map<string, AccountItem>();
    accounts.forEach((a) => map.set(a.id, a));
    return map;
  }, [accounts]);

  const plData = useMemo(() => {
    // Aggregate amounts by account
    const incomeAccounts = new Map<string, number>();
    const expenseAccounts = new Map<string, number>();

    yearJournals.forEach((j) => {
      const creditAcc = accountMap.get(j.creditAccountId);
      const debitAcc = accountMap.get(j.debitAccountId);

      if (creditAcc?.category === "income") {
        incomeAccounts.set(creditAcc.id, (incomeAccounts.get(creditAcc.id) || 0) + j.amount);
      }
      if (debitAcc?.category === "expense") {
        expenseAccounts.set(debitAcc.id, (expenseAccounts.get(debitAcc.id) || 0) + j.amount);
      }
    });

    const incomeItems = Array.from(incomeAccounts.entries())
      .map(([id, amount]) => ({ account: accountMap.get(id)!, amount }))
      .filter((i) => i.account)
      .sort((a, b) => a.account.code.localeCompare(b.account.code));

    const expenseItems = Array.from(expenseAccounts.entries())
      .map(([id, amount]) => ({ account: accountMap.get(id)!, amount }))
      .filter((i) => i.account)
      .sort((a, b) => a.account.code.localeCompare(b.account.code));

    const totalIncome = incomeItems.reduce((sum, i) => sum + i.amount, 0);
    const totalExpense = expenseItems.reduce((sum, i) => sum + i.amount, 0);
    const netIncome = totalIncome - totalExpense;

    return { incomeItems, expenseItems, totalIncome, totalExpense, netIncome };
  }, [yearJournals, accountMap]);

  function handleExport() {
    const lines: string[] = [`損益計算書 ${year}年度`, ""];
    lines.push("【収益の部】");
    plData.incomeItems.forEach((i) => lines.push(`  ${i.account.name},${i.amount}`));
    lines.push(`  収益合計,${plData.totalIncome}`);
    lines.push("");
    lines.push("【費用の部】");
    plData.expenseItems.forEach((i) => lines.push(`  ${i.account.name},${i.amount}`));
    lines.push(`  費用合計,${plData.totalExpense}`);
    lines.push("");
    lines.push(`当期純利益,${plData.netIncome}`);
    downloadFile(lines.join("\n"), `損益計算書_${year}.csv`, "text/csv;charset=utf-8");
    toast.success("CSVをダウンロードしました");
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center"><div className="text-sm text-muted-foreground">読み込み中...</div></div>;
  }

  return (
    <div className="p-4 lg:p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">損益計算書</h1>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => setYear(year - 1)}>←</Button>
            <span className="text-[14px] font-bold px-2">{year}年度</span>
            <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => setYear(year + 1)}>→</Button>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="h-4 w-4 mr-1" />CSV
        </Button>
      </div>

      {yearJournals.length === 0 ? (
        <Card className="border shadow-sm">
          <CardContent className="py-16 text-center text-[13px] text-muted-foreground">
            {year}年の仕訳データがありません
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Income section */}
          <Card className="border shadow-sm">
            <CardContent className="p-0">
              <div className="px-4 py-3 border-b bg-green-50/50">
                <h2 className="text-[14px] font-bold text-green-700">収益の部</h2>
              </div>
              <div className="divide-y divide-border">
                {plData.incomeItems.map((item) => (
                  <div key={item.account.id} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-[13px] font-medium">{item.account.name}</span>
                    <span className="text-[13px] font-mono font-bold money-positive">{formatYen(item.amount)}</span>
                  </div>
                ))}
                {plData.incomeItems.length === 0 && (
                  <div className="px-4 py-4 text-[13px] text-muted-foreground text-center">収益なし</div>
                )}
              </div>
              <div className="flex items-center justify-between px-4 py-3 border-t bg-green-50/30">
                <span className="text-[13px] font-bold">収益合計</span>
                <span className="text-[15px] font-mono font-bold money-positive">{formatYen(plData.totalIncome)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Expense section */}
          <Card className="border shadow-sm">
            <CardContent className="p-0">
              <div className="px-4 py-3 border-b bg-red-50/50">
                <h2 className="text-[14px] font-bold text-red-700">費用の部</h2>
              </div>
              <div className="divide-y divide-border">
                {plData.expenseItems.map((item) => (
                  <div key={item.account.id} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-[13px] font-medium">{item.account.name}</span>
                    <span className="text-[13px] font-mono font-bold money-negative">{formatYen(item.amount)}</span>
                  </div>
                ))}
                {plData.expenseItems.length === 0 && (
                  <div className="px-4 py-4 text-[13px] text-muted-foreground text-center">費用なし</div>
                )}
              </div>
              <div className="flex items-center justify-between px-4 py-3 border-t bg-red-50/30">
                <span className="text-[13px] font-bold">費用合計</span>
                <span className="text-[15px] font-mono font-bold money-negative">{formatYen(plData.totalExpense)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Net income */}
          <Card className="border-2 border-primary/30 shadow-sm">
            <CardContent className="p-0">
              <div className="flex items-center justify-between px-4 py-4">
                <span className="text-[15px] font-bold">当期純利益</span>
                <span className={`text-xl font-mono font-bold ${plData.netIncome >= 0 ? "money-positive" : "money-negative"}`}>
                  {formatYen(plData.netIncome)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
