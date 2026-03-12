/**
 * BalanceSheet — 貸借対照表ページ
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

export default function BalanceSheet() {
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
    () => journals.filter((j) => j.date <= `${year}-12-31`),
    [journals, year]
  );

  const accountMap = useMemo(() => {
    const map = new Map<string, AccountItem>();
    accounts.forEach((a) => map.set(a.id, a));
    return map;
  }, [accounts]);

  const bsData = useMemo(() => {
    // Calculate balances
    const balances = new Map<string, number>();

    yearJournals.forEach((j) => {
      const debitAcc = accountMap.get(j.debitAccountId);
      const creditAcc = accountMap.get(j.creditAccountId);

      if (debitAcc) {
        const isDebitNormal = debitAcc.category === "asset" || debitAcc.category === "expense";
        const current = balances.get(debitAcc.id) || 0;
        balances.set(debitAcc.id, current + (isDebitNormal ? j.amount : -j.amount));
      }
      if (creditAcc) {
        const isDebitNormal = creditAcc.category === "asset" || creditAcc.category === "expense";
        const current = balances.get(creditAcc.id) || 0;
        balances.set(creditAcc.id, current + (isDebitNormal ? -j.amount : j.amount));
      }
    });

    const assetItems: { account: AccountItem; balance: number }[] = [];
    const liabilityItems: { account: AccountItem; balance: number }[] = [];
    const equityItems: { account: AccountItem; balance: number }[] = [];

    // Calculate net income for the year
    let netIncome = 0;
    const currentYearJournals = journals.filter((j) => j.date.startsWith(String(year)));
    currentYearJournals.forEach((j) => {
      const creditAcc = accountMap.get(j.creditAccountId);
      const debitAcc = accountMap.get(j.debitAccountId);
      if (creditAcc?.category === "income") netIncome += j.amount;
      if (debitAcc?.category === "expense") netIncome -= j.amount;
    });

    accounts
      .sort((a, b) => a.code.localeCompare(b.code))
      .forEach((acc) => {
        const balance = balances.get(acc.id) || 0;
        if (balance === 0) return;
        if (acc.category === "asset") assetItems.push({ account: acc, balance });
        if (acc.category === "liability") liabilityItems.push({ account: acc, balance });
        if (acc.category === "equity") equityItems.push({ account: acc, balance });
      });

    const totalAssets = assetItems.reduce((sum, i) => sum + i.balance, 0);
    const totalLiabilities = liabilityItems.reduce((sum, i) => sum + i.balance, 0);
    const totalEquity = equityItems.reduce((sum, i) => sum + i.balance, 0) + netIncome;

    return { assetItems, liabilityItems, equityItems, totalAssets, totalLiabilities, totalEquity, netIncome };
  }, [yearJournals, accountMap, accounts, journals, year]);

  function handleExport() {
    const lines: string[] = [`貸借対照表 ${year}年12月31日現在`, ""];
    lines.push("【資産の部】");
    bsData.assetItems.forEach((i) => lines.push(`  ${i.account.name},${i.balance}`));
    lines.push(`  資産合計,${bsData.totalAssets}`);
    lines.push("");
    lines.push("【負債の部】");
    bsData.liabilityItems.forEach((i) => lines.push(`  ${i.account.name},${i.balance}`));
    lines.push(`  負債合計,${bsData.totalLiabilities}`);
    lines.push("");
    lines.push("【純資産の部】");
    bsData.equityItems.forEach((i) => lines.push(`  ${i.account.name},${i.balance}`));
    lines.push(`  当期純利益,${bsData.netIncome}`);
    lines.push(`  純資産合計,${bsData.totalEquity}`);
    downloadFile(lines.join("\n"), `貸借対照表_${year}.csv`, "text/csv;charset=utf-8");
    toast.success("CSVをダウンロードしました");
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center"><div className="text-sm text-muted-foreground">読み込み中...</div></div>;
  }

  return (
    <div className="p-4 lg:p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">貸借対照表</h1>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => setYear(year - 1)}>←</Button>
            <span className="text-[14px] font-bold px-2">{year}年12月31日</span>
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
            仕訳データがありません
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: Assets */}
          <Card className="border shadow-sm">
            <CardContent className="p-0">
              <div className="px-4 py-3 border-b bg-blue-50/50">
                <h2 className="text-[14px] font-bold text-blue-700">資産の部</h2>
              </div>
              <div className="divide-y divide-border">
                {bsData.assetItems.map((item) => (
                  <div key={item.account.id} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-[13px] font-medium">{item.account.name}</span>
                    <span className="text-[13px] font-mono font-bold">{formatYen(item.balance)}</span>
                  </div>
                ))}
                {bsData.assetItems.length === 0 && (
                  <div className="px-4 py-4 text-[13px] text-muted-foreground text-center">資産なし</div>
                )}
              </div>
              <div className="flex items-center justify-between px-4 py-3 border-t-2 bg-blue-50/30">
                <span className="text-[13px] font-bold">資産合計</span>
                <span className="text-[15px] font-mono font-bold">{formatYen(bsData.totalAssets)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Right: Liabilities + Equity */}
          <div className="space-y-4">
            <Card className="border shadow-sm">
              <CardContent className="p-0">
                <div className="px-4 py-3 border-b bg-orange-50/50">
                  <h2 className="text-[14px] font-bold text-orange-700">負債の部</h2>
                </div>
                <div className="divide-y divide-border">
                  {bsData.liabilityItems.map((item) => (
                    <div key={item.account.id} className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-[13px] font-medium">{item.account.name}</span>
                      <span className="text-[13px] font-mono font-bold">{formatYen(item.balance)}</span>
                    </div>
                  ))}
                  {bsData.liabilityItems.length === 0 && (
                    <div className="px-4 py-4 text-[13px] text-muted-foreground text-center">負債なし</div>
                  )}
                </div>
                <div className="flex items-center justify-between px-4 py-3 border-t bg-orange-50/30">
                  <span className="text-[13px] font-bold">負債合計</span>
                  <span className="text-[15px] font-mono font-bold">{formatYen(bsData.totalLiabilities)}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="border shadow-sm">
              <CardContent className="p-0">
                <div className="px-4 py-3 border-b bg-purple-50/50">
                  <h2 className="text-[14px] font-bold text-purple-700">純資産の部</h2>
                </div>
                <div className="divide-y divide-border">
                  {bsData.equityItems.map((item) => (
                    <div key={item.account.id} className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-[13px] font-medium">{item.account.name}</span>
                      <span className="text-[13px] font-mono font-bold">{formatYen(item.balance)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-[13px] font-medium">当期純利益</span>
                    <span className={`text-[13px] font-mono font-bold ${bsData.netIncome >= 0 ? "money-positive" : "money-negative"}`}>
                      {formatYen(bsData.netIncome)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between px-4 py-3 border-t bg-purple-50/30">
                  <span className="text-[13px] font-bold">純資産合計</span>
                  <span className="text-[15px] font-mono font-bold">{formatYen(bsData.totalEquity)}</span>
                </div>
              </CardContent>
            </Card>

            {/* Total liabilities + equity */}
            <Card className="border-2 border-primary/30 shadow-sm">
              <CardContent className="p-0">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-[14px] font-bold">負債・純資産合計</span>
                  <span className="text-[16px] font-mono font-bold">{formatYen(bsData.totalLiabilities + bsData.totalEquity)}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
