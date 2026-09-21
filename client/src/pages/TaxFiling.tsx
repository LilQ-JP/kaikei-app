/**
 * TaxFiling — 確定申告サポートページ
 * macOS Ledger Design
 * 青色申告決算書・白色申告の収支内訳書に対応した集計
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
import {
  getAllAccounts,
  getAllJournals,
  getProfile,
  type AccountItem,
  type JournalEntry,
  type BusinessProfile,
} from "@/lib/db";
import { formatYen, downloadFile } from "@/lib/utils";
import { Download, FileText, Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { summarizeBalances } from "@shared/accounting";
import { Link } from "wouter";

// 青色申告決算書の経費科目マッピング
const BLUE_FORM_EXPENSE_ITEMS = [
  { label: "租税公課", codes: ["510"] },
  { label: "荷造運賃", codes: ["512"] },
  { label: "水道光熱費", codes: ["514"] },
  { label: "旅費交通費", codes: ["516"] },
  { label: "通信費", codes: ["518"] },
  { label: "広告宣伝費", codes: ["520"] },
  { label: "接待交際費", codes: ["522"] },
  { label: "損害保険料", codes: ["524"] },
  { label: "修繕費", codes: ["526"] },
  { label: "消耗品費", codes: ["528"] },
  { label: "減価償却費", codes: ["530"] },
  { label: "福利厚生費", codes: ["532"] },
  { label: "給料賃金", codes: ["534"] },
  { label: "外注工賃", codes: ["536"] },
  { label: "利子割引料", codes: ["538"] },
  { label: "地代家賃", codes: ["540"] },
  { label: "貸倒金", codes: ["542"] },
  { label: "雑費", codes: ["544"] },
];

type BlueDeduction = "65" | "55" | "10";

export default function TaxFiling() {
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [profile, setProfile] = useState<BusinessProfile | undefined>();
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [filingType, setFilingType] = useState<"blue" | "white">("blue");
  // 65万円はe-Tax申告または優良な電子帳簿保存などの要件を満たす場合だけ選択する。
  // このアプリ自体はe-Tax送信・優良電子帳簿の適格性を証明しないため、55万円を安全側の初期値にする。
  const [blueDeduction, setBlueDeduction] = useState<BlueDeduction>("55");

  useEffect(() => {
    async function load() {
      const [j, a, p] = await Promise.all([getAllJournals(), getAllAccounts(), getProfile()]);
      setJournals(j);
      setAccounts(a);
      setProfile(p);
      if (p?.taxFilingType) setFilingType(p.taxFilingType);
      setLoading(false);
    }
    load();
  }, []);

  const yearJournals = useMemo(
    () => journals.filter((j) => j.date.startsWith(String(year))),
    [journals, year]
  );

  const codeToAccountId = useMemo(() => {
    const map = new Map<string, string>();
    accounts.forEach((a) => map.set(a.code, a.id));
    return map;
  }, [accounts]);

  const taxData = useMemo(() => {
    const balances = summarizeBalances(accounts, yearJournals);
    // Revenue
    let salesRevenue = 0;
    let otherIncome = 0;

    accounts.forEach((account) => {
      if (account.category !== "income") return;
      const amount = balances.get(account.id)?.creditBalance || 0;
      if (account.code === "400") salesRevenue += amount;
      else otherIncome += amount;
    });

    // Cost of goods sold
    const cogs = accounts
      .filter((account) => account.code === "500")
      .reduce((sum, account) => sum + (balances.get(account.id)?.debitBalance || 0), 0);

    const grossProfit = salesRevenue - cogs;

    // Expenses by category
    const expenseByCode = new Map<string, number>();
    accounts.forEach((account) => {
      if (account.category !== "expense" || account.code === "500") return;
      const amount = balances.get(account.id)?.debitBalance || 0;
      if (amount > 0) expenseByCode.set(account.code, amount);
    });

    const expenseItems = BLUE_FORM_EXPENSE_ITEMS.map((item) => {
      const amount = item.codes.reduce((sum, code) => sum + (expenseByCode.get(code) || 0), 0);
      return { label: item.label, amount };
    }).filter((item) => item.amount > 0);

    // Other expenses not in the standard list
    const standardCodes = new Set(BLUE_FORM_EXPENSE_ITEMS.flatMap((i) => i.codes));
    let otherExpenses = 0;
    expenseByCode.forEach((amount, code) => {
      if (!standardCodes.has(code)) otherExpenses += amount;
    });
    if (otherExpenses > 0) {
      expenseItems.push({ label: "その他経費", amount: otherExpenses });
    }

    const totalExpenses = expenseItems.reduce((sum, i) => sum + i.amount, 0);
    const operatingIncome = grossProfit - totalExpenses;
    const totalIncome = operatingIncome + otherIncome;

    const deductionAmount = filingType === "blue" ? Number(blueDeduction) * 10000 : 0;
    const taxableIncome = Math.max(0, totalIncome - deductionAmount);

    return {
      salesRevenue,
      cogs,
      grossProfit,
      expenseItems,
      totalExpenses,
      operatingIncome,
      otherIncome,
      totalIncome,
      blueDeduction: deductionAmount,
      taxableIncome,
    };
  }, [yearJournals, accounts, filingType, blueDeduction]);

  function handleExport() {
    const lines: string[] = [];
    lines.push(`${filingType === "blue" ? "青色申告決算書" : "収支内訳書"} ${year}年分`);
    lines.push("");
    lines.push(`売上(収入)金額,${taxData.salesRevenue}`);
    lines.push(`仕入金額,${taxData.cogs}`);
    lines.push(`差引金額,${taxData.grossProfit}`);
    lines.push("");
    lines.push("【経費】");
    taxData.expenseItems.forEach((i) => lines.push(`${i.label},${i.amount}`));
    lines.push(`経費合計,${taxData.totalExpenses}`);
    lines.push("");
    lines.push(`差引金額（営業利益）,${taxData.operatingIncome}`);
    lines.push(`その他収入,${taxData.otherIncome}`);
    lines.push(`所得金額,${taxData.totalIncome}`);
    if (filingType === "blue") {
      lines.push(`青色申告特別控除額,${taxData.blueDeduction}`);
      lines.push(`控除後所得金額,${taxData.taxableIncome}`);
    }
    downloadFile(lines.join("\n"), `確定申告_${year}.csv`, "text/csv;charset=utf-8");
    toast.success("CSVをダウンロードしました");
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center"><div className="text-sm text-muted-foreground">読み込み中...</div></div>;
  }

  return (
    <div className="p-4 lg:p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">確定申告</h1>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => setYear(year - 1)}>←</Button>
            <span className="text-[14px] font-bold px-2">{year}年分</span>
            <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => setYear(year + 1)}>→</Button>
          </div>
        </div>
        <div className="flex gap-2">
          <Select value={filingType} onValueChange={(v) => setFilingType(v as "blue" | "white")}>
            <SelectTrigger className="w-[130px] h-8 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="blue">青色申告</SelectItem>
              <SelectItem value="white">白色申告</SelectItem>
            </SelectContent>
          </Select>
          {filingType === "blue" && (
            <Select value={blueDeduction} onValueChange={(v) => setBlueDeduction(v as BlueDeduction)}>
              <SelectTrigger className="w-[150px] h-8 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="65">青色控除 65万円</SelectItem>
                <SelectItem value="55">青色控除 55万円</SelectItem>
                <SelectItem value="10">青色控除 10万円</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1" />CSV
          </Button>
        </div>
      </div>

      {/* Info banner */}
      <div className="mb-4 flex items-start gap-2 rounded-lg bg-blue-50 p-3 text-[12px] text-blue-700">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">
            {filingType === "blue" ? "青色申告決算書" : "収支内訳書"}の集計データです
          </p>
          <p className="mt-0.5 text-blue-600">
            この集計を元に確定申告書を作成してください。e-Taxや税務署への提出には国税庁の書式をご利用ください。
            {!profile && (
              <Link href="/profile">
                <span className="ml-1 underline font-semibold">事業者情報を設定する →</span>
              </Link>
            )}
          </p>
        </div>
      </div>

      {yearJournals.length === 0 ? (
        <Card className="border shadow-sm">
          <CardContent className="py-16 text-center text-[13px] text-muted-foreground">
            {year}年の仕訳データがありません
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Revenue */}
          <Card className="border shadow-sm">
            <CardContent className="p-0">
              <div className="px-4 py-3 border-b bg-muted/30">
                <h2 className="text-[14px] font-bold">売上・収入</h2>
              </div>
              <div className="divide-y divide-border">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-[13px] font-medium">売上(収入)金額</span>
                  <span className="text-[13px] font-mono font-bold">{formatYen(taxData.salesRevenue)}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-[13px] font-medium">仕入金額</span>
                  <span className="text-[13px] font-mono font-bold">{formatYen(taxData.cogs)}</span>
                </div>
              </div>
              <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/20">
                <span className="text-[13px] font-bold">差引金額</span>
                <span className="text-[15px] font-mono font-bold">{formatYen(taxData.grossProfit)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Expenses */}
          <Card className="border shadow-sm">
            <CardContent className="p-0">
              <div className="px-4 py-3 border-b bg-muted/30">
                <h2 className="text-[14px] font-bold">経費</h2>
              </div>
              <div className="divide-y divide-border">
                {taxData.expenseItems.map((item) => (
                  <div key={item.label} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-[13px] font-medium">{item.label}</span>
                    <span className="text-[13px] font-mono font-bold">{formatYen(item.amount)}</span>
                  </div>
                ))}
                {taxData.expenseItems.length === 0 && (
                  <div className="px-4 py-4 text-[13px] text-muted-foreground text-center">経費なし</div>
                )}
              </div>
              <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/20">
                <span className="text-[13px] font-bold">経費合計</span>
                <span className="text-[15px] font-mono font-bold">{formatYen(taxData.totalExpenses)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Summary */}
          <Card className="border shadow-sm">
            <CardContent className="p-0">
              <div className="px-4 py-3 border-b bg-muted/30">
                <h2 className="text-[14px] font-bold">所得計算</h2>
              </div>
              <div className="divide-y divide-border">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-[13px] font-medium">差引金額（営業利益）</span>
                  <span className="text-[13px] font-mono font-bold">{formatYen(taxData.operatingIncome)}</span>
                </div>
                {taxData.otherIncome > 0 && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-[13px] font-medium">その他収入（雑収入等）</span>
                    <span className="text-[13px] font-mono font-bold">{formatYen(taxData.otherIncome)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between px-4 py-2.5 bg-muted/10">
                  <span className="text-[13px] font-bold">所得金額</span>
                  <span className="text-[15px] font-mono font-bold">{formatYen(taxData.totalIncome)}</span>
                </div>
                {filingType === "blue" && (
                  <>
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-[13px] font-medium">青色申告特別控除額</span>
                      <span className="text-[13px] font-mono font-bold text-primary">−{formatYen(taxData.blueDeduction)}</span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-3 bg-primary/5">
                      <span className="text-[14px] font-bold">控除後所得金額</span>
                      <span className="text-xl font-mono font-bold">{formatYen(taxData.taxableIncome)}</span>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
