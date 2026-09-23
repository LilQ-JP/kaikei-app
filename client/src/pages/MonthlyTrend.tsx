/**
 * MonthlyTrend — 月次推移表ページ
 * macOS Ledger Design
 *
 * 月ごとの科目別推移を比較する表
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getAllAccounts,
  getAllJournals,
  type AccountItem,
  type JournalEntry,
} from "@/lib/db";
import { formatYen, downloadFile, CATEGORY_LABELS } from "@/lib/utils";
import { Download, TrendingUp, TrendingDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { journalLines } from "@shared/accounting";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

type ViewMode = "income-expense" | "expense-detail" | "income-detail";

export default function MonthlyTrend() {
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [viewMode, setViewMode] = useState<ViewMode>("income-expense");

  useEffect(() => {
    Promise.all([getAllJournals(), getAllAccounts()]).then(([j, a]) => {
      setJournals(j);
      setAccounts(a);
      setLoading(false);
    });
  }, []);

  const accountMap = useMemo(() => {
    const map = new Map<string, AccountItem>();
    accounts.forEach((a) => map.set(a.id, a));
    return map;
  }, [accounts]);

  const yearJournals = useMemo(
    () => journals.filter((j) => j.date.startsWith(String(year))),
    [journals, year]
  );

  // Monthly aggregation
  const monthlyData = useMemo(() => {
    const data: Array<{
      month: string;
      monthNum: number;
      income: number;
      expense: number;
      profit: number;
      accounts: Record<string, number>;
    }> = [];

    for (let m = 0; m < 12; m++) {
      const monthStr = `${year}-${String(m + 1).padStart(2, "0")}`;
      const monthJournals = yearJournals.filter((j) => j.date.startsWith(monthStr));

      let income = 0;
      let expense = 0;
      const accountAmounts: Record<string, number> = {};

      monthJournals.forEach((j) => {
        journalLines(j).forEach((line) => {
          const account = accountMap.get(line.accountId);
          if (!account) return;
          const sign = line.side === "credit" ? 1 : -1;
          if (account.category === "income") {
            const amount = line.amount * sign;
            income += amount;
            accountAmounts[account.id] = (accountAmounts[account.id] || 0) + amount;
          }
          if (account.category === "expense") {
            const amount = line.amount * -sign;
            expense += amount;
            accountAmounts[account.id] = (accountAmounts[account.id] || 0) + amount;
          }
        });
      });

      data.push({
        month: MONTHS[m],
        monthNum: m + 1,
        income,
        expense,
        profit: income - expense,
        accounts: accountAmounts,
      });
    }

    return data;
  }, [yearJournals, accountMap, year]);

  // Get relevant accounts for detail views
  const relevantAccounts = useMemo(() => {
    const category = viewMode === "income-detail" ? "income" : "expense";
    const accIds = new Set<string>();
    monthlyData.forEach((m) => {
      Object.keys(m.accounts).forEach((id) => {
        const acc = accountMap.get(id);
        if (acc?.category === category) accIds.add(id);
      });
    });
    return Array.from(accIds)
      .map((id) => accountMap.get(id)!)
      .filter(Boolean)
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [monthlyData, accountMap, viewMode]);

  // Chart data
  const chartData = useMemo(() => {
    if (viewMode === "income-expense") {
      return monthlyData.map((m) => ({
        name: m.month,
        収入: m.income,
        支出: m.expense,
        利益: m.profit,
      }));
    }
    return monthlyData.map((m) => {
      const entry: Record<string, number | string> = { name: m.month };
      relevantAccounts.forEach((acc) => {
        entry[acc.name] = m.accounts[acc.id] || 0;
      });
      return entry;
    });
  }, [monthlyData, viewMode, relevantAccounts]);

  // Totals
  const totals = useMemo(() => {
    const totalIncome = monthlyData.reduce((s, m) => s + m.income, 0);
    const totalExpense = monthlyData.reduce((s, m) => s + m.expense, 0);
    return { income: totalIncome, expense: totalExpense, profit: totalIncome - totalExpense };
  }, [monthlyData]);

  const COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1"];

  function handleExport() {
    const lines: string[] = [`月次推移表 ${year}年度`, ""];

    if (viewMode === "income-expense") {
      lines.push("月,収入,支出,利益");
      monthlyData.forEach((m) => lines.push(`${m.month},${m.income},${m.expense},${m.profit}`));
      lines.push(`合計,${totals.income},${totals.expense},${totals.profit}`);
    } else {
      const accs = relevantAccounts;
      lines.push(["月", ...accs.map((a) => a.name), "合計"].join(","));
      monthlyData.forEach((m) => {
        const vals = accs.map((a) => m.accounts[a.id] || 0);
        lines.push([m.month, ...vals, vals.reduce((s, v) => s + v, 0)].join(","));
      });
    }

    downloadFile(lines.join("\n"), `月次推移表_${year}.csv`, "text/csv;charset=utf-8");
    toast.success("CSVをダウンロードしました");
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center"><div className="text-sm text-muted-foreground">読み込み中...</div></div>;
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">月次推移表</h1>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => setYear(year - 1)}>←</Button>
            <span className="text-[14px] font-bold px-2">{year}年度</span>
            <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => setYear(year + 1)}>→</Button>
          </div>
        </div>
        <div className="flex gap-2">
          <Select value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <SelectTrigger className="w-[160px] h-8 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="income-expense" className="text-[12px]">収支サマリー</SelectItem>
              <SelectItem value="expense-detail" className="text-[12px]">経費科目別</SelectItem>
              <SelectItem value="income-detail" className="text-[12px]">収益科目別</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1" />CSV
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <Card className="border shadow-sm">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-green-600" />
              <span className="text-[12px] text-muted-foreground">年間収入</span>
            </div>
            <div className="text-lg font-mono font-bold text-green-600">{formatYen(totals.income)}</div>
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="h-4 w-4 text-red-600" />
              <span className="text-[12px] text-muted-foreground">年間支出</span>
            </div>
            <div className="text-lg font-mono font-bold text-red-600">{formatYen(totals.expense)}</div>
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[12px] text-muted-foreground">年間利益</span>
            </div>
            <div className={`text-lg font-mono font-bold ${totals.profit >= 0 ? "text-green-600" : "text-red-600"}`}>
              {formatYen(totals.profit)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      <Card className="border shadow-sm mb-4">
        <CardContent className="py-4 px-2">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`} />
              <RechartsTooltip
                formatter={(value: number) => formatYen(value)}
                contentStyle={{ fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {viewMode === "income-expense" ? (
                <>
                  <Bar dataKey="収入" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="支出" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </>
              ) : (
                relevantAccounts.map((acc, i) => (
                  <Bar key={acc.id} dataKey={acc.name} fill={COLORS[i % COLORS.length]} radius={[2, 2, 0, 0]} stackId="a" />
                ))
              )}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-3 py-2.5 text-left font-bold text-muted-foreground sticky left-0 bg-muted/30 z-10">
                    {viewMode === "income-expense" ? "項目" : "科目"}
                  </th>
                  {MONTHS.map((m) => (
                    <th key={m} className="px-3 py-2.5 text-right font-bold text-muted-foreground whitespace-nowrap">{m}</th>
                  ))}
                  <th className="px-3 py-2.5 text-right font-bold text-muted-foreground">合計</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {viewMode === "income-expense" ? (
                  <>
                    <tr className="hover:bg-muted/20">
                      <td className="px-3 py-2.5 font-semibold text-green-700 sticky left-0 bg-background z-10">収入</td>
                      {monthlyData.map((m) => (
                        <td key={m.monthNum} className="px-3 py-2.5 text-right font-mono">
                          {m.income > 0 ? formatYen(m.income) : "—"}
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-green-600">{formatYen(totals.income)}</td>
                    </tr>
                    <tr className="hover:bg-muted/20">
                      <td className="px-3 py-2.5 font-semibold text-red-700 sticky left-0 bg-background z-10">支出</td>
                      {monthlyData.map((m) => (
                        <td key={m.monthNum} className="px-3 py-2.5 text-right font-mono">
                          {m.expense > 0 ? formatYen(m.expense) : "—"}
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-red-600">{formatYen(totals.expense)}</td>
                    </tr>
                    <tr className="bg-muted/20 font-bold">
                      <td className="px-3 py-2.5 sticky left-0 bg-muted/20 z-10">利益</td>
                      {monthlyData.map((m) => (
                        <td key={m.monthNum} className={`px-3 py-2.5 text-right font-mono ${m.profit >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {m.income > 0 || m.expense > 0 ? formatYen(m.profit) : "—"}
                        </td>
                      ))}
                      <td className={`px-3 py-2.5 text-right font-mono ${totals.profit >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {formatYen(totals.profit)}
                      </td>
                    </tr>
                  </>
                ) : (
                  relevantAccounts.map((acc) => {
                    const total = monthlyData.reduce((s, m) => s + (m.accounts[acc.id] || 0), 0);
                    return (
                      <tr key={acc.id} className="hover:bg-muted/20">
                        <td className="px-3 py-2.5 font-semibold sticky left-0 bg-background z-10 whitespace-nowrap">{acc.name}</td>
                        {monthlyData.map((m) => (
                          <td key={m.monthNum} className="px-3 py-2.5 text-right font-mono">
                            {(m.accounts[acc.id] || 0) > 0 ? formatYen(m.accounts[acc.id]) : "—"}
                          </td>
                        ))}
                        <td className="px-3 py-2.5 text-right font-mono font-bold">{formatYen(total)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
