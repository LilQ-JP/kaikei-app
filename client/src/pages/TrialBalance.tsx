/**
 * TrialBalance — 試算表ページ
 * macOS Ledger Design
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  getAllAccounts,
  getAllJournals,
  type AccountItem,
  type JournalEntry,
} from "@/lib/db";
import { formatYen, CATEGORY_LABELS, downloadFile } from "@/lib/utils";
import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { summarizeBalances } from "@shared/accounting";

interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  category: string;
  debitTotal: number;
  creditTotal: number;
  debitBalance: number;
  creditBalance: number;
}

export default function TrialBalance() {
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

  const rows = useMemo(() => {
    const balances = summarizeBalances(accounts, yearJournals);

    const result: TrialBalanceRow[] = [];
    [...accounts]
      .sort((a, b) => a.code.localeCompare(b.code))
      .forEach((acc) => {
        const data = balances.get(acc.id);
        if (!data || (data.debitTotal === 0 && data.creditTotal === 0)) return;
        result.push({
          accountId: acc.id,
          code: acc.code,
          name: acc.name,
          category: acc.category,
          debitTotal: data.debitTotal,
          creditTotal: data.creditTotal,
          debitBalance: data.debitBalance,
          creditBalance: data.creditBalance,
        });
      });

    return result;
  }, [accounts, yearJournals]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => ({
        debitTotal: acc.debitTotal + row.debitTotal,
        creditTotal: acc.creditTotal + row.creditTotal,
        debitBalance: acc.debitBalance + (row.debitBalance > 0 ? row.debitBalance : 0),
        creditBalance: acc.creditBalance + (row.creditBalance > 0 ? row.creditBalance : 0),
      }),
      { debitTotal: 0, creditTotal: 0, debitBalance: 0, creditBalance: 0 }
    );
  }, [rows]);

  function handleExport() {
    const header = "科目コード,科目名,区分,借方合計,貸方合計,借方残高,貸方残高";
    const csvRows = rows.map(
      (r) => `${r.code},"${r.name}","${CATEGORY_LABELS[r.category]}",${r.debitTotal},${r.creditTotal},${Math.max(0, r.debitBalance)},${Math.max(0, r.creditBalance)}`
    );
    downloadFile([header, ...csvRows].join("\n"), `試算表_${year}.csv`, "text/csv;charset=utf-8");
    toast.success("CSVをダウンロードしました");
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center"><div className="text-sm text-muted-foreground">読み込み中...</div></div>;
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">試算表</h1>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => setYear(year - 1)}>←</Button>
            <span className="text-[14px] font-bold px-2">{year}年</span>
            <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => setYear(year + 1)}>→</Button>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={rows.length === 0}>
          <Download className="h-4 w-4 mr-1" />CSV
        </Button>
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="py-16 text-center text-[13px] text-muted-foreground">
              {year}年の仕訳データがありません
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-2.5 text-left font-bold text-muted-foreground">コード</th>
                    <th className="px-4 py-2.5 text-left font-bold text-muted-foreground">勘定科目</th>
                    <th className="px-4 py-2.5 text-center font-bold text-muted-foreground" colSpan={2}>合計</th>
                    <th className="px-4 py-2.5 text-center font-bold text-muted-foreground" colSpan={2}>残高</th>
                  </tr>
                  <tr className="border-b bg-muted/15">
                    <th></th>
                    <th></th>
                    <th className="px-4 py-1.5 text-right text-[11px] font-bold text-muted-foreground">借方</th>
                    <th className="px-4 py-1.5 text-right text-[11px] font-bold text-muted-foreground">貸方</th>
                    <th className="px-4 py-1.5 text-right text-[11px] font-bold text-muted-foreground">借方</th>
                    <th className="px-4 py-1.5 text-right text-[11px] font-bold text-muted-foreground">貸方</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr key={row.accountId} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2 font-mono text-muted-foreground">{row.code}</td>
                      <td className="px-4 py-2 font-semibold">{row.name}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold">{row.debitTotal > 0 ? formatYen(row.debitTotal) : ""}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold">{row.creditTotal > 0 ? formatYen(row.creditTotal) : ""}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold">{row.debitBalance > 0 ? formatYen(row.debitBalance) : ""}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold">{row.creditBalance > 0 ? formatYen(row.creditBalance) : ""}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-foreground/20 bg-muted/30">
                    <td className="px-4 py-2.5 font-bold" colSpan={2}>合計</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold">{formatYen(totals.debitTotal)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold">{formatYen(totals.creditTotal)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold">{formatYen(totals.debitBalance)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold">{formatYen(totals.creditBalance)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
