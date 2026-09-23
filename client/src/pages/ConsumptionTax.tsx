/**
 * ConsumptionTax — 消費税集計レポートページ
 * macOS Ledger Design
 *
 * インボイス制度対応の消費税計算・集計
 * 課税売上・課税仕入の集計と納付税額の概算
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
  getAllJournals,
  type AccountItem,
  type JournalEntry,
} from "@/lib/db";
import { formatYen, downloadFile } from "@/lib/utils";
import { Download, Info, Receipt } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type TaxRate = "10" | "8" | "0";
type TaxMethod = "general" | "simplified";

const TAX_RATE_LABELS: Record<TaxRate, string> = {
  "10": "標準税率 10%",
  "8": "軽減税率 8%",
  "0": "非課税・免税",
};

// 簡易課税のみなし仕入率
const SIMPLIFIED_RATES: Record<string, { label: string; rate: number }> = {
  "1": { label: "第一種（卸売業）", rate: 90 },
  "2": { label: "第二種（小売業）", rate: 80 },
  "3": { label: "第三種（製造業等）", rate: 70 },
  "4": { label: "第四種（その他）", rate: 60 },
  "5": { label: "第五種（サービス業等）", rate: 50 },
  "6": { label: "第六種（不動産業）", rate: 40 },
};

export default function ConsumptionTax() {
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [taxMethod, setTaxMethod] = useState<TaxMethod>("general");
  const [simplifiedType, setSimplifiedType] = useState("5");
  const [defaultTaxRate, setDefaultTaxRate] = useState<TaxRate>("10");

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

  const taxData = useMemo(() => {
    let taxableSales = 0;
    let salesTax = 0;
    const salesByAccount = new Map<string, number>();
    const salesTaxByAccount = new Map<string, number>();
    let taxablePurchases = 0;
    let purchaseTax = 0;
    const purchasesByAccount = new Map<string, number>();
    const purchaseTaxByAccount = new Map<string, number>();
    let unclassifiedCount = 0;

    function addTaxEntry(category: JournalEntry["taxCategory"], amount: number, taxRate: number | undefined, taxIncluded: boolean | undefined, accountId: string, side: "debit" | "credit") {
      const isSales = category === "taxable-sales" || category === "taxable-sales-reduced";
      const isPurchase = category === "taxable-purchase" || category === "taxable-purchase-reduced";
      if (!isSales && !isPurchase) return;
      const rate = taxRate ?? (category?.endsWith("-reduced") ? 8 : 10);
      const tax = taxIncluded === false ? Math.floor(amount * rate / 100) : amount - Math.floor(amount * 100 / (100 + rate));
      const base = taxIncluded === false ? amount : amount - tax;
      const direction = (isSales ? side === "credit" : side === "debit") ? 1 : -1;
      if (isSales) {
        taxableSales += base * direction;
        salesTax += tax * direction;
        salesByAccount.set(accountId, (salesByAccount.get(accountId) || 0) + base * direction);
        salesTaxByAccount.set(accountId, (salesTaxByAccount.get(accountId) || 0) + tax * direction);
      } else {
        taxablePurchases += base * direction;
        purchaseTax += tax * direction;
        purchasesByAccount.set(accountId, (purchasesByAccount.get(accountId) || 0) + base * direction);
        purchaseTaxByAccount.set(accountId, (purchaseTaxByAccount.get(accountId) || 0) + tax * direction);
      }
    }

    yearJournals.forEach((j) => {
      if (j.sourceKey?.startsWith("invoice-payment:")) return;
      if (j.lines?.length) {
        for (const line of j.lines) addTaxEntry(line.taxCategory, line.amount, line.taxRate, line.taxIncluded, line.accountId, line.side);
        return;
      }
      const category = j.taxCategory;
      if (!category || category === "out-of-scope") unclassifiedCount++;
      addTaxEntry(category, j.amount, j.taxRate, j.taxIncluded, category?.startsWith("taxable-sales") ? j.creditAccountId : j.debitAccountId, category?.startsWith("taxable-sales") ? "credit" : "debit");
    });

    let taxPayable = 0;

    if (taxMethod === "general") {
      // 一般課税: 売上税額 - 仕入税額
      taxPayable = salesTax - purchaseTax;
    } else {
      // 簡易課税: 売上税額 × (1 - みなし仕入率)
      const simplifiedRate = SIMPLIFIED_RATES[simplifiedType]?.rate || 50;
      purchaseTax = Math.round(salesTax * (simplifiedRate / 100));
      taxPayable = salesTax - purchaseTax;
    }

    const salesItems = Array.from(salesByAccount.entries())
      .map(([id, amount]) => ({
        account: accountMap.get(id)!,
        amount,
        tax: salesTaxByAccount.get(id) || 0,
      }))
      .filter((i) => i.account)
      .sort((a, b) => b.amount - a.amount);

    const purchaseItems = Array.from(purchasesByAccount.entries())
      .map(([id, amount]) => ({
        account: accountMap.get(id)!,
        amount,
        tax: purchaseTaxByAccount.get(id) || 0,
      }))
      .filter((i) => i.account)
      .sort((a, b) => b.amount - a.amount);

    return {
      taxableSales,
      taxablePurchases,
      salesTax,
      purchaseTax,
      taxPayable,
      salesItems,
      purchaseItems,
      unclassifiedCount,
    };
  }, [yearJournals, accountMap, taxMethod, simplifiedType, defaultTaxRate]);

  function handleExport() {
    const lines: string[] = [
      `消費税集計レポート ${year}年度`,
      `計算方式: ${taxMethod === "general" ? "一般課税（本則課税）" : `簡易課税（${SIMPLIFIED_RATES[simplifiedType]?.label}）`}`,
      `適用税率: ${defaultTaxRate}%`,
      "",
      "【課税売上】",
      "科目,金額,消費税額",
    ];
    taxData.salesItems.forEach((i) => lines.push(`${i.account.name},${i.amount},${i.tax}`));
    lines.push(`課税売上合計,${taxData.taxableSales},${taxData.salesTax}`);
    lines.push("");
    lines.push("【課税仕入】");
    lines.push("科目,金額,消費税額");
    taxData.purchaseItems.forEach((i) => lines.push(`${i.account.name},${i.amount},${i.tax}`));
    lines.push(`課税仕入合計,${taxData.taxablePurchases},${taxData.purchaseTax}`);
    lines.push("");
    lines.push(`納付税額（概算）,${taxData.taxPayable}`);
    downloadFile(lines.join("\n"), `消費税集計_${year}.csv`, "text/csv;charset=utf-8");
    toast.success("CSVをダウンロードしました");
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center"><div className="text-sm text-muted-foreground">読み込み中...</div></div>;
  }

  return (
    <div className="p-4 lg:p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">消費税集計</h1>
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

      {/* Settings */}
      <Card className="border shadow-sm mb-4">
        <CardContent className="py-4 px-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label className="text-[12px] font-semibold">課税方式</Label>
              <Select value={taxMethod} onValueChange={(v) => setTaxMethod(v as TaxMethod)}>
                <SelectTrigger className="mt-1 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general" className="text-[13px]">一般課税（本則課税）</SelectItem>
                  <SelectItem value="simplified" className="text-[13px]">簡易課税</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {taxMethod === "simplified" && (
              <div>
                <Label className="text-[12px] font-semibold">事業区分</Label>
                <Select value={simplifiedType} onValueChange={setSimplifiedType}>
                  <SelectTrigger className="mt-1 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SIMPLIFIED_RATES).map(([key, { label, rate }]) => (
                      <SelectItem key={key} value={key} className="text-[13px]">
                        {label}（{rate}%）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-[12px] font-semibold">適用税率</Label>
              <Select value={defaultTaxRate} onValueChange={(v) => setDefaultTaxRate(v as TaxRate)}>
                <SelectTrigger className="mt-1 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TAX_RATE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key} className="text-[13px]">{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Info */}
      <Card className="border shadow-sm mb-4 bg-amber-50/30">
        <CardContent className="py-3 px-4">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-[12px] text-muted-foreground">
              この画面は仕訳明細の消費税区分を集計した検算用データです。実際の消費税申告では、
              非課税取引・不課税取引、課税売上割合、インボイス保存要件などの確認が必要です。
              年間課税売上高が1,000万円以下の場合は免税事業者となり、消費税の納付義務はありません
              （インボイス登録事業者を除く）。
              {taxData.unclassifiedCount > 0 && ` 未分類の仕訳が${taxData.unclassifiedCount}件あります。申告前に全件分類してください。`}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="border shadow-sm">
            <CardContent className="py-4 px-4 text-center">
              <div className="text-[12px] text-muted-foreground mb-1">課税売上の消費税</div>
              <div className="text-xl font-mono font-bold text-green-600">{formatYen(taxData.salesTax)}</div>
              <div className="text-[11px] text-muted-foreground mt-1">売上 {formatYen(taxData.taxableSales)}</div>
            </CardContent>
          </Card>
          <Card className="border shadow-sm">
            <CardContent className="py-4 px-4 text-center">
              <div className="text-[12px] text-muted-foreground mb-1">
                {taxMethod === "general" ? "課税仕入の消費税" : "みなし仕入税額"}
              </div>
              <div className="text-xl font-mono font-bold text-red-600">{formatYen(taxData.purchaseTax)}</div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {taxMethod === "general"
                  ? `仕入 ${formatYen(taxData.taxablePurchases)}`
                  : `みなし仕入率 ${SIMPLIFIED_RATES[simplifiedType]?.rate}%`}
              </div>
            </CardContent>
          </Card>
          <Card className="border-2 border-primary/30 shadow-sm">
            <CardContent className="py-4 px-4 text-center">
              <div className="text-[12px] text-muted-foreground mb-1">納付税額（概算）</div>
              <div className={`text-xl font-mono font-bold ${taxData.taxPayable >= 0 ? "text-foreground" : "text-green-600"}`}>
                {formatYen(taxData.taxPayable)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {taxData.taxPayable < 0 ? "還付" : "納付"}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sales detail */}
        <Card className="border shadow-sm">
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b bg-green-50/50">
              <h2 className="text-[14px] font-bold text-green-700">課税売上の内訳</h2>
            </div>
            {taxData.salesItems.length === 0 ? (
              <div className="py-8 text-center text-[13px] text-muted-foreground">課税売上なし</div>
            ) : (
              <div className="divide-y divide-border">
                {taxData.salesItems.map((item) => (
                  <div key={item.account.id} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-[13px] font-medium">{item.account.name}</span>
                    <div className="flex items-center gap-6">
                      <span className="text-[13px] font-mono">{formatYen(item.amount)}</span>
                      <span className="text-[12px] font-mono text-muted-foreground w-24 text-right">税 {formatYen(item.tax)}</span>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between px-4 py-3 bg-green-50/30">
                  <span className="text-[13px] font-bold">合計</span>
                  <div className="flex items-center gap-6">
                    <span className="text-[14px] font-mono font-bold">{formatYen(taxData.taxableSales)}</span>
                    <span className="text-[13px] font-mono font-bold text-green-600 w-24 text-right">税 {formatYen(taxData.salesTax)}</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Purchase detail (only for general method) */}
        {taxMethod === "general" && (
          <Card className="border shadow-sm">
            <CardContent className="p-0">
              <div className="px-4 py-3 border-b bg-red-50/50">
                <h2 className="text-[14px] font-bold text-red-700">課税仕入の内訳</h2>
              </div>
              {taxData.purchaseItems.length === 0 ? (
                <div className="py-8 text-center text-[13px] text-muted-foreground">課税仕入なし</div>
              ) : (
                <div className="divide-y divide-border">
                  {taxData.purchaseItems.map((item) => (
                    <div key={item.account.id} className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-[13px] font-medium">{item.account.name}</span>
                      <div className="flex items-center gap-6">
                        <span className="text-[13px] font-mono">{formatYen(item.amount)}</span>
                        <span className="text-[12px] font-mono text-muted-foreground w-24 text-right">税 {formatYen(item.tax)}</span>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-4 py-3 bg-red-50/30">
                    <span className="text-[13px] font-bold">合計</span>
                    <div className="flex items-center gap-6">
                      <span className="text-[14px] font-mono font-bold">{formatYen(taxData.taxablePurchases)}</span>
                      <span className="text-[13px] font-mono font-bold text-red-600 w-24 text-right">税 {formatYen(taxData.purchaseTax)}</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
