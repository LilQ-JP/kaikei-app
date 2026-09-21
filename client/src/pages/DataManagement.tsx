/**
 * DataManagement — データ管理ページ
 * macOS Ledger Design
 * エクスポート・インポート・データリセット
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  getAllAccounts,
  getAllJournals,
  getAllInvoices,
  getAllReceipts,
  getAllVendors,
  getSettings,
  getProfile,
  putAccount,
  putJournal,
  putInvoice,
  putReceipt,
  putProfile,
  putVendor,
  putSettings,
  clearAllData,
} from "@/lib/db";
import { downloadFile } from "@/lib/utils";
import { Download, Upload, Trash2, Database, HardDrive } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export default function DataManagement() {
  const [stats, setStats] = useState({ accounts: 0, journals: 0, invoices: 0, receipts: 0 });
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      const [a, j, i, r] = await Promise.all([
        getAllAccounts(),
        getAllJournals(),
        getAllInvoices(),
        getAllReceipts(),
      ]);
      setStats({
        accounts: a.length,
        journals: j.length,
        invoices: i.length,
        receipts: r.length,
      });
      setLoading(false);
    }
    load();
  }, []);

  async function handleExportJSON() {
    const [accounts, journals, invoices, receipts, profile, vendors, settings] = await Promise.all([
      getAllAccounts(),
      getAllJournals(),
      getAllInvoices(),
      getAllReceipts(),
      getProfile(),
      getAllVendors(),
      getSettings(),
    ]);

    const localStorageData = {
      fixedAssets: localStorage.getItem("kaikei-fixed-assets"),
      homeExpenseRules: localStorage.getItem("kaikei-home-expense-rules"),
    };

    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      app: "フリーランス会計",
      accounts,
      journals,
      invoices,
      receipts,
      profile,
      vendors,
      settings,
      localStorage: localStorageData,
    };

    const json = JSON.stringify(data, null, 2);
    downloadFile(json, `会計データ_${new Date().toISOString().slice(0, 10)}.json`, "application/json");
    toast.success("JSONファイルをダウンロードしました");
  }

  async function handleImportJSON(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.version || !data.accounts) {
        toast.error("無効なデータファイルです");
        return;
      }

      let imported = 0;

      if (data.accounts?.length) {
        for (const acc of data.accounts) await putAccount(acc);
        imported += data.accounts.length;
      }
      if (data.journals?.length) {
        for (const j of data.journals) await putJournal(j);
        imported += data.journals.length;
      }
      if (data.invoices?.length) {
        for (const inv of data.invoices) await putInvoice(inv);
        imported += data.invoices.length;
      }
      if (data.receipts?.length) {
        for (const r of data.receipts) await putReceipt(r);
        imported += data.receipts.length;
      }
      if (data.profile) {
        await putProfile(data.profile);
        imported++;
      }
      if (data.vendors?.length) {
        for (const vendor of data.vendors) await putVendor(vendor);
        imported += data.vendors.length;
      }
      if (data.settings) {
        await putSettings(data.settings);
        imported++;
      }
      if (data.localStorage) {
        for (const [key, value] of Object.entries(data.localStorage)) {
          if (typeof value === "string") localStorage.setItem(
            key === "fixedAssets" ? "kaikei-fixed-assets" : "kaikei-home-expense-rules",
            value,
          );
        }
      }

      toast.success(`${imported}件のデータをインポートしました`);
      window.location.reload();
    } catch (err) {
      toast.error("インポートに失敗しました。ファイル形式を確認してください。");
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleClearAll() {
    await clearAllData();
    toast.success("すべてのデータを削除しました");
    window.location.reload();
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center"><div className="text-sm text-muted-foreground">読み込み中...</div></div>;
  }

  const totalRecords = stats.accounts + stats.journals + stats.invoices + stats.receipts;

  return (
    <div className="p-4 lg:p-6 max-w-2xl">
      <h1 className="text-xl font-bold mb-4">データ管理</h1>

      {/* Stats */}
      <Card className="border shadow-sm mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-[14px] font-bold flex items-center gap-2">
            <Database className="h-4 w-4" />
            データ概要
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">勘定科目</div>
              <div className="text-lg font-bold">{stats.accounts}</div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">仕訳</div>
              <div className="text-lg font-bold">{stats.journals}</div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">請求書</div>
              <div className="text-lg font-bold">{stats.invoices}</div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">レシート</div>
              <div className="text-lg font-bold">{stats.receipts}</div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[12px] text-muted-foreground">
            <HardDrive className="h-3.5 w-3.5" />
            合計 {totalRecords} レコード（ブラウザのIndexedDBに保存）
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="space-y-3">
        {/* Export */}
        <Card className="border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[14px] font-bold">データエクスポート</h3>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  すべてのデータをJSONファイルとしてダウンロードします
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={handleExportJSON}>
                <Download className="h-4 w-4 mr-1" />
                JSON
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Import */}
        <Card className="border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[14px] font-bold">データインポート</h3>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  JSONファイルからデータを復元します（既存データとマージ）
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-1" />
                インポート
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleImportJSON}
                className="hidden"
              />
            </div>
          </CardContent>
        </Card>

        {/* Clear */}
        <Card className="border shadow-sm border-destructive/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[14px] font-bold text-destructive">データ全削除</h3>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  すべてのデータを削除します。この操作は取り消せません。
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/5">
                    <Trash2 className="h-4 w-4 mr-1" />
                    全削除
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>すべてのデータを削除</AlertDialogTitle>
                    <AlertDialogDescription>
                      勘定科目、仕訳、請求書、レシート、事業者情報のすべてが削除されます。
                      この操作は取り消せません。事前にエクスポートすることをお勧めします。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>キャンセル</AlertDialogCancel>
                    <AlertDialogAction onClick={handleClearAll} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      すべて削除
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
