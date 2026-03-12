/**
 * JournalList — 仕訳帳ページ（レシート連携対応）
 * macOS Ledger Design
 *
 * レシートが紐付いた仕訳にはアイコンが表示され、
 * クリックでレシート画像をプレビューできる。
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getAllAccounts,
  getAllJournals,
  deleteJournal,
  getReceipt,
  type AccountItem,
  type JournalEntry,
  type Receipt,
} from "@/lib/db";
import { formatYen, journalsToCSV, downloadFile } from "@/lib/utils";
import { Download, Plus, Search, Trash2, Camera } from "lucide-react";
import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

export default function JournalList() {
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [receiptCache, setReceiptCache] = useState<Record<string, Receipt>>({});
  const [previewReceipt, setPreviewReceipt] = useState<Receipt | null>(null);

  const load = useCallback(async () => {
    const [j, a] = await Promise.all([getAllJournals(), getAllAccounts()]);
    setJournals(j);
    setAccounts(a);
    setLoading(false);

    // レシート付き仕訳のレシートデータをプリロード
    const withReceipts = j.filter((entry) => entry.receiptId);
    const receipts: Record<string, Receipt> = {};
    await Promise.all(
      withReceipts.map(async (entry) => {
        if (entry.receiptId) {
          const r = await getReceipt(entry.receiptId);
          if (r) receipts[entry.receiptId] = r;
        }
      })
    );
    setReceiptCache(receipts);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const accountMap = useMemo(() => {
    const map = new Map<string, AccountItem>();
    accounts.forEach((a) => map.set(a.id, a));
    return map;
  }, [accounts]);

  const filtered = useMemo(() => {
    if (!search) return journals;
    const q = search.toLowerCase();
    return journals.filter((j) => {
      const debit = accountMap.get(j.debitAccountId);
      const credit = accountMap.get(j.creditAccountId);
      return (
        j.date.includes(q) ||
        j.description.toLowerCase().includes(q) ||
        debit?.name.toLowerCase().includes(q) ||
        credit?.name.toLowerCase().includes(q) ||
        String(j.amount).includes(q)
      );
    });
  }, [journals, search, accountMap]);

  async function handleDelete(id: string) {
    await deleteJournal(id);
    toast.success("仕訳を削除しました");
    load();
  }

  function handleShowReceipt(receiptId: string) {
    const receipt = receiptCache[receiptId];
    if (receipt) {
      setPreviewReceipt(receipt);
    } else {
      toast.error("レシート画像が見つかりません");
    }
  }

  function handleExportCSV() {
    const data = filtered.map((j) => ({
      date: j.date,
      debitName: accountMap.get(j.debitAccountId)?.name || "",
      creditName: accountMap.get(j.creditAccountId)?.name || "",
      amount: j.amount,
      description: j.description,
    }));
    const csv = journalsToCSV(data);
    downloadFile(csv, `仕訳帳_${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
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
    <div className="p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">仕訳帳</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-1" />
            CSV
          </Button>
          <Link href="/journals/new">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              新規仕訳
            </Button>
          </Link>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="日付・科目名・摘要で検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 text-[13px]"
        />
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <p className="text-[13px] text-muted-foreground">
                {journals.length === 0 ? "仕訳がありません" : "検索結果がありません"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-2.5 text-left font-bold text-muted-foreground">日付</th>
                    <th className="px-4 py-2.5 text-left font-bold text-muted-foreground">借方</th>
                    <th className="px-4 py-2.5 text-left font-bold text-muted-foreground">貸方</th>
                    <th className="px-4 py-2.5 text-right font-bold text-muted-foreground">金額</th>
                    <th className="px-4 py-2.5 text-left font-bold text-muted-foreground">摘要</th>
                    <th className="px-4 py-2.5 w-10 text-center font-bold text-muted-foreground">
                      <Camera className="h-3.5 w-3.5 mx-auto" />
                    </th>
                    <th className="px-4 py-2.5 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((j) => {
                    const debit = accountMap.get(j.debitAccountId);
                    const credit = accountMap.get(j.creditAccountId);
                    const hasReceipt = !!j.receiptId;
                    return (
                      <tr key={j.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-muted-foreground whitespace-nowrap">
                          {j.date}
                        </td>
                        <td className="px-4 py-2.5 font-semibold whitespace-nowrap">
                          {debit?.name || "—"}
                        </td>
                        <td className="px-4 py-2.5 font-semibold whitespace-nowrap">
                          {credit?.name || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold whitespace-nowrap">
                          {formatYen(j.amount)}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[200px]">
                          {j.description || "—"}
                        </td>
                        <td className="px-2 py-2.5 text-center">
                          {hasReceipt ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                                  onClick={() => handleShowReceipt(j.receiptId!)}
                                >
                                  <Camera className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-[12px]">レシートを表示</p>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-muted-foreground/30">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>仕訳を削除</AlertDialogTitle>
                                <AlertDialogDescription>
                                  この仕訳を削除しますか？この操作は取り消せません。
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>キャンセル</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDelete(j.id)}>
                                  削除
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-3 text-[12px] text-muted-foreground">
        {filtered.length}件の仕訳 / 合計: {formatYen(filtered.reduce((sum, j) => sum + j.amount, 0))}
      </div>

      {/* Receipt preview dialog */}
      <Dialog open={!!previewReceipt} onOpenChange={() => setPreviewReceipt(null)}>
        <DialogContent className="max-w-lg">
          <DialogTitle className="text-[14px] font-bold">
            レシート画像
          </DialogTitle>
          {previewReceipt && (
            <div className="space-y-3">
              <img
                src={previewReceipt.imageData}
                alt="レシート"
                className="w-full h-auto rounded-lg border"
              />
              <div className="flex items-center justify-between text-[12px] text-muted-foreground">
                <span>{previewReceipt.fileName}</span>
                <span>{previewReceipt.date}</span>
              </div>
              {previewReceipt.vendor && (
                <div className="text-[12px]">
                  <span className="font-semibold">取引先:</span> {previewReceipt.vendor}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
