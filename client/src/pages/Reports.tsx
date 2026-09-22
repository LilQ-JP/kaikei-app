/**
 * Reports — レポート・分析ページ
 * macOS Ledger Design
 *
 * 勘定科目別・月次別の集計をグラフで可視化
 * 期間選択（年度・四半期・月）、CSV出力対応
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getAllAccounts,
  getAllJournals,
  type AccountItem,
  type JournalEntry,
} from "@/lib/db";
import { formatYen, downloadFile, CATEGORY_LABELS } from "@/lib/utils";
import { Download, PieChart, BarChart3, TrendingUp, CreditCard } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from "recharts";
import { calculateProfitLoss } from "@shared/accounting";

const COLORS = [
  "oklch(0.55 0.22 260)",
  "oklch(0.55 0.18 155)",
  "oklch(0.58 0.22 25)",
  "oklch(0.65 0.15 80)",
  "oklch(0.6 0.18 300)",
  "oklch(0.5 0.2 200)",
  "oklch(0.6 0.15 120)",
  "oklch(0.55 0.2 340)",
  "oklch(0.65 0.12 50)",
  "oklch(0.5 0.18 230)",
];

export default function Reports() {
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [tab, setTab] = useState("expense");

  useEffect(() => {
    Promise.all([getAllAccounts(), getAllJournals()]).then(([accs, jrnls]) => {
      setAccounts(accs);
      setJournals(jrnls);
      // Auto-detect year from data
      const years = Array.from(new Set(jrnls.map((j) => new Date(j.date).getFullYear())));
      if (years.length > 0 && !years.includes(selectedYear)) {
        setSelectedYear(Math.max(...years));
      }
      setLoading(false);
    });
  }, []);

  const accountMap = useMemo(() => {
    const map = new Map<string, AccountItem>();
    accounts.forEach((a) => map.set(a.id, a));
    return map;
  }, [accounts]);

  const availableYears = useMemo(() => {
    const years = Array.from(new Set(journals.map((j) => new Date(j.date).getFullYear())));
    return years.sort((a, b) => b - a);
  }, [journals]);

  const yearJournals = useMemo(
    () => journals.filter((j) => new Date(j.date).getFullYear() === selectedYear),
    [journals, selectedYear]
  );

  // 勘定科目別集計（経費）
  const expenseByAccount = useMemo(() => {
    return calculateProfitLoss(accounts, yearJournals).expenseItems
      .map(({ account, amount }) => ({ id: account.id, name: account.name, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [yearJournals, accounts]);

  // 勘定科目別集計（収入）
  const incomeByAccount = useMemo(() => {
    return calculateProfitLoss(accounts, yearJournals).incomeItems
      .map(({ account, amount }) => ({ id: account.id, name: account.name, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [yearJournals, accounts]);

  // 月次集計
  const monthlyData = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: `${i + 1}月`,
      monthNum: i + 1,
      income: 0,
      expense: 0,
      profit: 0,
    }));
    for (let month = 1; month <= 12; month++) {
      const profitLoss = calculateProfitLoss(accounts, yearJournals.filter((journal) => Number(journal.date.slice(5, 7)) === month));
      months[month - 1].income = profitLoss.totalIncome;
      months[month - 1].expense = profitLoss.totalExpense;
    }
    months.forEach((m) => (m.profit = m.income - m.expense));
    return months;
  }, [yearJournals, accounts]);

  // 決済手段別集計
  const paymentMethodData = useMemo(() => {
    const map = new Map<string, number>();
    yearJournals.forEach((j) => {
      const method = j.paymentMethod || "未設定";
      map.set(method, (map.get(method) || 0) + j.amount);
    });
    return Array.from(map.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [yearJournals]);

  // 月別経費科目トップ5推移
  const monthlyExpenseTrend = useMemo(() => {
    const top5 = expenseByAccount.slice(0, 5);
    const months = Array.from({ length: 12 }, (_, i) => {
      const row: Record<string, number | string> = { month: `${i + 1}月` };
      top5.forEach((acc) => (row[acc.name] = 0));
      return row;
    });
    for (let month = 1; month <= 12; month++) {
      const profitLoss = calculateProfitLoss(accounts, yearJournals.filter((journal) => Number(journal.date.slice(5, 7)) === month));
      for (const item of profitLoss.expenseItems) {
        if (top5.some((account) => account.name === item.account.name)) {
          (months[month - 1][item.account.name] as number) += item.amount;
        }
      }
    }
    return { data: months, keys: top5.map((a) => a.name) };
  }, [yearJournals, accountMap, expenseByAccount]);

  const totalExpense = expenseByAccount.reduce((s, a) => s + a.amount, 0);
  const totalIncome = incomeByAccount.reduce((s, a) => s + a.amount, 0);

  function exportCSV() {
    const data = tab === "expense" ? expenseByAccount : incomeByAccount;
    const header = "勘定科目,金額\n";
    const rows = data.map((d) => `${d.name},${d.amount}`).join("\n");
    downloadFile(header + rows, `${selectedYear}年_${tab === "expense" ? "経費" : "収入"}_科目別集計.csv`, "text/csv");
    toast.success("CSVをダウンロードしました");
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">レポート・分析</h1>
        <div className="flex items-center gap-2">
          <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
            <SelectTrigger className="w-[120px] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableYears.map((y) => (
                <SelectItem key={y} value={String(y)} className="text-[13px]">
                  {y}年度
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="h-4 w-4 mr-1" />
            CSV
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card className="border shadow-sm">
          <CardContent className="pt-4 pb-4">
            <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">年間収入</div>
            <div className="text-xl font-bold font-mono text-income">{formatYen(totalIncome)}</div>
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardContent className="pt-4 pb-4">
            <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">年間経費</div>
            <div className="text-xl font-bold font-mono text-expense">{formatYen(totalExpense)}</div>
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardContent className="pt-4 pb-4">
            <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">年間利益</div>
            <div className={`text-xl font-bold font-mono ${totalIncome - totalExpense >= 0 ? "text-income" : "text-expense"}`}>
              {formatYen(totalIncome - totalExpense)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Monthly income/expense bar chart */}
      <Card className="border shadow-sm mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-[14px] font-bold flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            月次収支推移
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyData} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`} />
              <RechartsTooltip
                formatter={(value: number) => formatYen(value)}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
                labelStyle={{ fontWeight: 700, fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="income" name="収入" fill="var(--income)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" name="経費" fill="var(--expense)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Monthly profit line chart */}
      <Card className="border shadow-sm mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-[14px] font-bold flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            月次利益推移
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`} />
              <RechartsTooltip
                formatter={(value: number) => formatYen(value)}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
              />
              <Line type="monotone" dataKey="profit" name="利益" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Expense/Income by account */}
      <Tabs value={tab} onValueChange={setTab} className="mb-6">
        <TabsList className="h-9">
          <TabsTrigger value="expense" className="text-[12px] gap-1.5">
            <PieChart className="h-3.5 w-3.5" />
            経費内訳
          </TabsTrigger>
          <TabsTrigger value="income" className="text-[12px] gap-1.5">
            <PieChart className="h-3.5 w-3.5" />
            収入内訳
          </TabsTrigger>
          <TabsTrigger value="payment" className="text-[12px] gap-1.5">
            <CreditCard className="h-3.5 w-3.5" />
            決済手段別
          </TabsTrigger>
        </TabsList>

        <TabsContent value="expense">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pie chart */}
            <Card className="border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-[13px] font-bold">経費科目別割合</CardTitle>
              </CardHeader>
              <CardContent>
                {expenseByAccount.length === 0 ? (
                  <div className="flex items-center justify-center h-[250px] text-[13px] text-muted-foreground">データがありません</div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <RechartsPieChart>
                      <Pie
                        data={expenseByAccount}
                        dataKey="amount"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={{ strokeWidth: 1 }}
                        style={{ fontSize: 11 }}
                      >
                        {expenseByAccount.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        formatter={(value: number) => formatYen(value)}
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
                      />
                    </RechartsPieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Table */}
            <Card className="border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-[13px] font-bold">経費科目別一覧</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 font-bold text-muted-foreground">科目</th>
                        <th className="text-right py-2 font-bold text-muted-foreground">金額</th>
                        <th className="text-right py-2 font-bold text-muted-foreground">割合</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expenseByAccount.map((item, i) => (
                        <tr key={item.id} className="border-b border-border/50">
                          <td className="py-2 flex items-center gap-2">
                            <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                            {item.name}
                          </td>
                          <td className="py-2 text-right font-mono font-semibold">{formatYen(item.amount)}</td>
                          <td className="py-2 text-right font-mono text-muted-foreground">
                            {totalExpense > 0 ? ((item.amount / totalExpense) * 100).toFixed(1) : 0}%
                          </td>
                        </tr>
                      ))}
                      <tr className="font-bold">
                        <td className="py-2">合計</td>
                        <td className="py-2 text-right font-mono">{formatYen(totalExpense)}</td>
                        <td className="py-2 text-right font-mono">100%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="income">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-[13px] font-bold">収入科目別割合</CardTitle>
              </CardHeader>
              <CardContent>
                {incomeByAccount.length === 0 ? (
                  <div className="flex items-center justify-center h-[250px] text-[13px] text-muted-foreground">データがありません</div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <RechartsPieChart>
                      <Pie
                        data={incomeByAccount}
                        dataKey="amount"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={{ strokeWidth: 1 }}
                        style={{ fontSize: 11 }}
                      >
                        {incomeByAccount.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        formatter={(value: number) => formatYen(value)}
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
                      />
                    </RechartsPieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-[13px] font-bold">収入科目別一覧</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 font-bold text-muted-foreground">科目</th>
                        <th className="text-right py-2 font-bold text-muted-foreground">金額</th>
                        <th className="text-right py-2 font-bold text-muted-foreground">割合</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incomeByAccount.map((item, i) => (
                        <tr key={item.id} className="border-b border-border/50">
                          <td className="py-2 flex items-center gap-2">
                            <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                            {item.name}
                          </td>
                          <td className="py-2 text-right font-mono font-semibold">{formatYen(item.amount)}</td>
                          <td className="py-2 text-right font-mono text-muted-foreground">
                            {totalIncome > 0 ? ((item.amount / totalIncome) * 100).toFixed(1) : 0}%
                          </td>
                        </tr>
                      ))}
                      <tr className="font-bold">
                        <td className="py-2">合計</td>
                        <td className="py-2 text-right font-mono">{formatYen(totalIncome)}</td>
                        <td className="py-2 text-right font-mono">100%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="payment">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-[13px] font-bold">決済手段別割合</CardTitle>
              </CardHeader>
              <CardContent>
                {paymentMethodData.length === 0 ? (
                  <div className="flex items-center justify-center h-[250px] text-[13px] text-muted-foreground">データがありません</div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <RechartsPieChart>
                      <Pie
                        data={paymentMethodData}
                        dataKey="amount"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={{ strokeWidth: 1 }}
                        style={{ fontSize: 11 }}
                      >
                        {paymentMethodData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        formatter={(value: number) => formatYen(value)}
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
                      />
                    </RechartsPieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-[13px] font-bold">決済手段別一覧</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 font-bold text-muted-foreground">決済手段</th>
                        <th className="text-right py-2 font-bold text-muted-foreground">金額</th>
                        <th className="text-right py-2 font-bold text-muted-foreground">件数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentMethodData.map((item, i) => {
                        const count = yearJournals.filter((j) => (j.paymentMethod || "未設定") === item.name).length;
                        return (
                          <tr key={item.name} className="border-b border-border/50">
                            <td className="py-2 flex items-center gap-2">
                              <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                              {item.name}
                            </td>
                            <td className="py-2 text-right font-mono font-semibold">{formatYen(item.amount)}</td>
                            <td className="py-2 text-right font-mono text-muted-foreground">{count}件</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Monthly expense trend by top accounts */}
      {monthlyExpenseTrend.keys.length > 0 && (
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px] font-bold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              経費科目別月次推移（上位5科目）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthlyExpenseTrend.data} barGap={1}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`} />
                <RechartsTooltip
                  formatter={(value: number) => formatYen(value)}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {monthlyExpenseTrend.keys.map((key, i) => (
                  <Bar key={key} dataKey={key} fill={COLORS[i % COLORS.length]} radius={[2, 2, 0, 0]} stackId="a" />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
