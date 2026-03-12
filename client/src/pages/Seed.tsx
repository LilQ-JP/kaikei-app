/**
 * Seed — テストデータ投入ページ
 * ユーザー提供の仕訳データをIndexedDBに一括投入する
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAllAccounts, putJournal, type AccountItem, type JournalEntry } from "@/lib/db";
import { Check, Database, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

// ユーザー提供の仕訳データ（2025年度）
const SEED_DATA = [
  { date: "2025-01-08", debit: "消耗品費", credit: "未払金", amount: 1590, desc: "VREW 630" },
  { date: "2025-01-13", debit: "普通預金", credit: "元入金", amount: 2698, desc: "振込 ミヤケ ハルキ" },
  { date: "2025-01-17", debit: "通信費", credit: "未払金", amount: 116, desc: "GOOGLE WORKSPACE LIL" },
  { date: "2025-01-27", debit: "普通預金", credit: "元入金", amount: 100000, desc: "振込 ミヤケ ハルキ" },
  { date: "2025-02-01", debit: "普通預金", credit: "事業主借", amount: 2, desc: "決算お利息 1月分" },
  { date: "2025-02-01", debit: "通信費", credit: "未払金", amount: 146, desc: "GOOGLE WORKSPACE LIL" },
  { date: "2025-02-02", debit: "会議費", credit: "普通預金", amount: 4430, desc: "振込 ツル ユタカ" },
  { date: "2025-02-02", debit: "消耗品費", credit: "未払金", amount: 445, desc: "無印良品" },
  { date: "2025-02-03", debit: "消耗品費", credit: "事業主借", amount: 2899, desc: "(Amazon)" },
  { date: "2025-02-03", debit: "消耗品費", credit: "未払金", amount: 49990, desc: "ニトリ" },
  { date: "2025-02-03", debit: "会議費", credit: "未払金", amount: 4257, desc: "LilQ事業打合せ(メンバー名)と利用・2/3 デニーズにてLilQ運営会議 津留" },
  { date: "2025-02-03", debit: "旅費交通費", credit: "事業主借", amount: 800, desc: "デニーズ 座間店駐車場料金 LilQ事業打合せに伴う駐車代" },
  { date: "2025-02-03", debit: "消耗品費", credit: "事業主借", amount: 2899, desc: "Amazon.co.jp" },
  { date: "2025-02-03", debit: "消耗品費", credit: "事業主借", amount: 12980, desc: "Amazon.co.jp" },
  { date: "2025-02-04", debit: "消耗品費", credit: "事業主借", amount: 2199, desc: "Amazon.co.jp" },
  { date: "2025-02-04", debit: "消耗品費", credit: "事業主借", amount: 610, desc: "Amazon.co.jp" },
  { date: "2025-02-07", debit: "旅費交通費", credit: "未払金", amount: 700, desc: "パークンパーク 旭町 津留" },
  { date: "2025-02-07", debit: "通信費", credit: "未払金", amount: 344, desc: "X CORP. PAID FEATURE" },
  { date: "2025-02-07", debit: "支払手数料", credit: "未払金", amount: 1180, desc: "Color" },
  { date: "2025-02-09", debit: "支払手数料", credit: "未払金", amount: 3259, desc: "MOONSHOT AI PTE. LTD" },
  { date: "2025-02-09", debit: "支払手数料", credit: "未払金", amount: 161, desc: "MOONSHOT AI PTE. LTD" },
  { date: "2025-02-09", debit: "普通預金", credit: "売掛金", amount: 1, desc: "振込 スクエア(カ" },
  { date: "2025-02-10", debit: "支払手数料", credit: "未払金", amount: 12980, desc: "APPLE.COM/JP" },
  { date: "2025-02-11", debit: "事業主貸", credit: "普通預金", amount: 19488, desc: "振込 ミヤケ ハルキ" },
  { date: "2025-02-12", debit: "支払手数料", credit: "未払金", amount: 3232, desc: "CLAUDE.AI SUBSCRIPTI" },
  { date: "2025-02-20", debit: "売掛金", credit: "売上高", amount: 500, desc: "LilQ 制作案件 報酬" },
  { date: "2025-02-25", debit: "旅費交通費", credit: "未払金", amount: 800, desc: "リパーク 相模原旭 津留" },
];

export default function Seed() {
  const [, navigate] = useLocation();
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    getAllAccounts().then((accs) => {
      setAccounts(accs);
      setLoading(false);
    });
  }, []);

  function findAccount(name: string): string | undefined {
    const acc = accounts.find((a) => a.name === name);
    return acc?.id;
  }

  async function handleSeed() {
    setSeeding(true);
    setProgress(0);

    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < SEED_DATA.length; i++) {
      const row = SEED_DATA[i];
      const debitId = findAccount(row.debit);
      const creditId = findAccount(row.credit);

      if (!debitId) {
        errors.push(`${row.date}: 借方「${row.debit}」が見つかりません`);
        errorCount++;
        setProgress(i + 1);
        continue;
      }
      if (!creditId) {
        errors.push(`${row.date}: 貸方「${row.credit}」が見つかりません`);
        errorCount++;
        setProgress(i + 1);
        continue;
      }

      const now = new Date().toISOString();
      const journal: JournalEntry = {
        id: crypto.randomUUID(),
        date: row.date,
        debitAccountId: debitId,
        creditAccountId: creditId,
        amount: row.amount,
        description: row.desc,
        createdAt: now,
        updatedAt: now,
      };

      try {
        await putJournal(journal);
        successCount++;
      } catch (e) {
        errors.push(`${row.date}: 保存エラー - ${row.desc}`);
        errorCount++;
      }
      setProgress(i + 1);
    }

    setSeeding(false);
    setDone(true);

    if (errorCount === 0) {
      toast.success(`${successCount}件の仕訳をすべて投入しました！`);
    } else {
      toast.error(`${successCount}件成功、${errorCount}件エラー`);
      console.error("Seed errors:", errors);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // 投入前にマッピングチェック
  const mappingCheck = SEED_DATA.map((row) => ({
    ...row,
    debitFound: !!findAccount(row.debit),
    creditFound: !!findAccount(row.credit),
  }));
  const allMapped = mappingCheck.every((r) => r.debitFound && r.creditFound);

  return (
    <div className="p-4 lg:p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">テストデータ投入</h1>
        {done && (
          <Button size="sm" onClick={() => navigate("/journals")}>
            仕訳帳を確認 →
          </Button>
        )}
      </div>

      {/* Action buttons - placed at top for visibility */}
      {done ? (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-green-50 border border-green-200 mb-4">
          <Check className="h-5 w-5 text-green-600" />
          <span className="text-[13px] font-semibold text-green-700">
            データ投入が完了しました！仕訳帳で確認してください。
          </span>
          <Button size="sm" className="ml-auto" onClick={() => navigate("/journals")}>
            仕訳帳を確認 →
          </Button>
        </div>
      ) : (
        <div className="flex gap-2 mb-4">
          <Button onClick={handleSeed} disabled={seeding || !allMapped} size="lg">
            <Database className="h-4 w-4 mr-1" />
            {SEED_DATA.length}件を一括投入
          </Button>
          {!allMapped && (
            <span className="text-[12px] text-destructive self-center">
              勘定科目が見つからない行があります。先に勘定科目を追加してください。
            </span>
          )}
        </div>
      )}

      {/* Progress */}
      {seeding && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-[13px]">投入中... {progress}/{SEED_DATA.length}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-200 rounded-full"
              style={{ width: `${(progress / SEED_DATA.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      <Card className="border shadow-sm mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-[14px] font-bold flex items-center gap-2">
            <Database className="h-4 w-4" />
            投入データ一覧（{SEED_DATA.length}件）
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-3 py-2 text-left font-bold text-muted-foreground">#</th>
                  <th className="px-3 py-2 text-left font-bold text-muted-foreground">日付</th>
                  <th className="px-3 py-2 text-left font-bold text-muted-foreground">借方</th>
                  <th className="px-3 py-2 text-left font-bold text-muted-foreground">貸方</th>
                  <th className="px-3 py-2 text-right font-bold text-muted-foreground">金額</th>
                  <th className="px-3 py-2 text-left font-bold text-muted-foreground">摘要</th>
                  <th className="px-3 py-2 text-center font-bold text-muted-foreground">状態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {mappingCheck.map((row, i) => (
                  <tr key={i} className={`${(!row.debitFound || !row.creditFound) ? "bg-destructive/5" : ""}`}>
                    <td className="px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-1.5 font-mono">{row.date}</td>
                    <td className={`px-3 py-1.5 font-semibold ${!row.debitFound ? "text-destructive" : ""}`}>
                      {row.debit}
                    </td>
                    <td className={`px-3 py-1.5 font-semibold ${!row.creditFound ? "text-destructive" : ""}`}>
                      {row.credit}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      ¥{row.amount.toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[200px]">
                      {row.desc}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {row.debitFound && row.creditFound ? (
                        <span className="text-green-600 text-[10px] font-bold">OK</span>
                      ) : (
                        <span className="text-destructive text-[10px] font-bold">NG</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>


    </div>
  );
}
