/**
 * Dashboard — macOS Ledger Design
 * Overview of income, expenses, profit, and recent transactions
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAllAccounts, getAllJournals, type AccountItem, type JournalEntry } from "@/lib/db";
import { formatYen, getToday } from "@/lib/utils";
import {
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Link } from "wouter";
import { calculateProfitLoss } from "@shared/accounting";
import { journalLines } from "@shared/accounting";

const CHART_COLORS = ["#007aff", "#34c759", "#ff3b30", "#ff9500", "#af52de", "#5ac8fa", "#ff2d55", "#ffcc00"];

export default function Dashboard() {
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [j, a] = await Promise.all([getAllJournals(), getAllAccounts()]);
      setJournals(j);
      setAccounts(a);
      setLoading(false);
    }
    load();
  }, []);

  const accountMap = useMemo(() => {
    const map = new Map<string, AccountItem>();
    accounts.forEach((a) => map.set(a.id, a));
    return map;
  }, [accounts]);

  // Detect available years from data, default to latest year with data or current year
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    journals.forEach((j) => {
      const y = parseInt(j.date.split("-")[0]);
      if (!isNaN(y)) years.add(y);
    });
    if (years.size === 0) years.add(new Date().getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  }, [journals]);

  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  useEffect(() => {
    if (!loading && availableYears.length > 0 && selectedYear === null) {
      setSelectedYear(availableYears[0]);
    }
  }, [availableYears, selectedYear, loading]);

  const displayYear = selectedYear ?? availableYears[0] ?? new Date().getFullYear();
  const currentYearJournals = useMemo(
    () => journals.filter((j) => j.date.startsWith(String(displayYear))),
    [journals, displayYear]
  );

  // Calculate totals
  const stats = useMemo(() => {
    const profitLoss = calculateProfitLoss(accounts, currentYearJournals);
    return { income: profitLoss.totalIncome, expense: profitLoss.totalExpense, profit: profitLoss.netIncome };
  }, [currentYearJournals, accounts]);

  // Monthly chart data
  const monthlyData = useMemo(() => {
    const months: Record<string, { income: number; expense: number }> = {};
    for (let m = 1; m <= 12; m++) {
      months[String(m)] = { income: 0, expense: 0 };
    }
    for (let month = 1; month <= 12; month++) {
      const period = currentYearJournals.filter((journal) => Number(journal.date.slice(5, 7)) === month);
      const profitLoss = calculateProfitLoss(accounts, period);
      months[String(month)].income = profitLoss.totalIncome;
      months[String(month)].expense = profitLoss.totalExpense;
    }
    return Object.entries(months).map(([m, data]) => ({
      month: `${m}月`,
      収入: data.income,
      支出: data.expense,
    }));
  }, [currentYearJournals, accounts]);

  // Expense breakdown
  const expenseBreakdown = useMemo(() => {
    return calculateProfitLoss(accounts, currentYearJournals).expenseItems
      .map((item) => ({ name: item.account.name, value: item.amount }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [currentYearJournals, accounts]);

  // Recent journals
  const recentJournals = useMemo(
    () => journals.slice(0, 8),
    [journals]
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">読み込み中...</div>
      </div>
    );
  }

  const today = getToday();

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">{displayYear}年度</h1>
            {availableYears.length > 1 && (
              <select
                value={displayYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="text-[13px] font-semibold border border-border rounded-md px-2 py-1 bg-background"
              >
                {availableYears.map((y) => (
                  <option key={y} value={y}>{y}年度</option>
                ))}
              </select>
            )}
          </div>
          <p className="text-[13px] text-muted-foreground mt-0.5">{today} 現在</p>
        </div>
        <Link href="/journals/new">
          <div className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
            仕訳を追加
          </div>
        </Link>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50">
                <ArrowDownLeft className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">収入</p>
                <p className="text-lg font-bold money-positive">{formatYen(stats.income)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50">
                <ArrowUpRight className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">支出</p>
                <p className="text-lg font-bold money-negative">{formatYen(stats.expense)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
                <TrendingUp className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">利益</p>
                <p className={`text-lg font-bold ${stats.profit >= 0 ? "money-positive" : "money-negative"}`}>
                  {formatYen(stats.profit)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50">
                <Wallet className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">仕訳数</p>
                <p className="text-lg font-bold">{currentYearJournals.length}件</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Monthly bar chart */}
        <Card className="border shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px] font-bold">月別収支</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {currentYearJournals.length === 0 ? (
              <div className="flex h-[240px] items-center justify-center">
                <div className="text-center">
                  <img
                    src="https://d2xsxph8kpxj0f.cloudfront.net/310519663234847362/nMdoXxfmf8ifGBFtkFptCX/chart-visual-3g6bZMUnaXJFuS4WTDbpp5.webp"
                    alt="chart"
                    className="mx-auto h-32 w-auto opacity-60 mb-3"
                  />
                  <p className="text-[13px] text-muted-foreground">仕訳を追加するとグラフが表示されます</p>
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={monthlyData} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fontWeight: 600 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 10000).toFixed(0)}万`} />
                  <Tooltip
                    formatter={(value: number) => formatYen(value)}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e5e5" }}
                  />
                  <Bar dataKey="収入" fill="#34c759" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="支出" fill="#ff3b30" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Expense pie chart */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px] font-bold">経費内訳</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {expenseBreakdown.length === 0 ? (
              <div className="flex h-[240px] items-center justify-center">
                <p className="text-[13px] text-muted-foreground">データなし</p>
              </div>
            ) : (
              <div>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie
                      data={expenseBreakdown}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {expenseBreakdown.map((_, index) => (
                        <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatYen(value)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 space-y-1">
                  {expenseBreakdown.slice(0, 5).map((item, i) => (
                    <div key={item.name} className="flex items-center justify-between text-[12px]">
                      <div className="flex items-center gap-1.5">
                        <div
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                        />
                        <span className="font-medium">{item.name}</span>
                      </div>
                      <span className="font-mono font-semibold">{formatYen(item.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent transactions */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-[14px] font-bold">最近の仕訳</CardTitle>
          <Link href="/journals">
            <span className="text-[12px] font-semibold text-primary hover:underline">すべて表示</span>
          </Link>
        </CardHeader>
        <CardContent className="pb-2">
          {recentJournals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10">
              <img
                src="https://d2xsxph8kpxj0f.cloudfront.net/310519663234847362/nMdoXxfmf8ifGBFtkFptCX/empty-state-JBQssdRderzZoWPPGMKkZc.webp"
                alt="empty"
                className="h-28 w-auto opacity-50 mb-4"
              />
              <p className="text-[13px] text-muted-foreground mb-3">まだ仕訳がありません</p>
              <Link href="/journals/new">
                <div className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
                  最初の仕訳を追加
                </div>
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recentJournals.map((j) => {
                const lines = journalLines(j);
                const debitNames = lines.filter((line) => line.side === "debit").map((line) => accountMap.get(line.accountId)?.name || "?").join("・");
                const creditNames = lines.filter((line) => line.side === "credit").map((line) => accountMap.get(line.accountId)?.name || "?").join("・");
                return (
                  <div key={j.id} className="flex items-center gap-3 py-2.5">
                    <div className="text-[12px] font-mono text-muted-foreground w-[80px] shrink-0">
                      {j.date}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold truncate">{j.description || "—"}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {debitNames || "?"} → {creditNames || "?"}
                      </div>
                    </div>
                    <div className="text-[13px] font-mono font-bold text-right shrink-0">
                      {formatYen(j.amount)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
