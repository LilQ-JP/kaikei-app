/**
 * FixedAssets — 固定資産台帳・減価償却ページ
 * macOS Ledger Design
 *
 * 固定資産を登録し、耐用年数に基づいて定額法/定率法で
 * 減価償却費を自動計算する
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
  getAllAccounts,
  getAllJournals,
  putJournal,
  type AccountItem,
  type JournalEntry,
} from "@/lib/db";
import { formatYen } from "@/lib/utils";
import { Plus, Trash2, Calculator, Save, Building2, Info } from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import { toast } from "sonner";
import { loadAppJson, saveAppJson } from "@/lib/app-storage";

interface FixedAsset {
  id: string;
  name: string;
  category: string;
  acquisitionDate: string;
  acquisitionCost: number;
  usefulLife: number; // years
  method: "straight-line" | "declining-balance";
  salvageRate: number; // 残存割合 (0.1 = 10%)
  memo: string;
}

const STORAGE_KEY = "kaikei-fixed-assets";

// 主要な耐用年数テーブル（個人事業主向け）
const USEFUL_LIFE_PRESETS = [
  { label: "パソコン・サーバー", years: 4, category: "器具備品" },
  { label: "プリンター・複合機", years: 5, category: "器具備品" },
  { label: "事務用家具", years: 15, category: "器具備品" },
  { label: "自動車（普通）", years: 6, category: "車両運搬具" },
  { label: "自動車（軽）", years: 4, category: "車両運搬具" },
  { label: "ソフトウェア（自社利用）", years: 5, category: "無形固定資産" },
  { label: "ソフトウェア（市販）", years: 3, category: "無形固定資産" },
  { label: "建物（木造）", years: 22, category: "建物" },
  { label: "建物（鉄骨）", years: 34, category: "建物" },
  { label: "建物（RC）", years: 47, category: "建物" },
  { label: "エアコン", years: 6, category: "建物附属設備" },
  { label: "カメラ・映像機器", years: 5, category: "器具備品" },
];

/** 定額法: (取得価額 - 残存価額) / 耐用年数 */
function straightLineDepreciation(cost: number, salvageRate: number, usefulLife: number): number {
  return Math.round((cost - cost * salvageRate) / usefulLife);
}

/** 定率法: 未償却残高 × 償却率 */
function decliningBalanceRate(usefulLife: number): number {
  // 200%定率法（平成24年4月1日以後取得分）。旧資産は別率表で管理する。
  return Math.min(1, 2 / usefulLife);
}

function calculateDepreciationSchedule(asset: FixedAsset, targetYear: number) {
  const startYear = new Date(asset.acquisitionDate).getFullYear();
  const startMonth = new Date(asset.acquisitionDate).getMonth() + 1;
  let bookValue = asset.acquisitionCost;
  const salvageValue = asset.method === "straight-line" ? Math.round(asset.acquisitionCost * asset.salvageRate) : 1;
  const annualSL = straightLineDepreciation(asset.acquisitionCost, asset.salvageRate, asset.usefulLife);
  const dbRate = decliningBalanceRate(asset.usefulLife);

  let depreciationThisYear = 0;
  let accumulatedDepreciation = 0;

  for (let y = startYear; y <= targetYear && y <= startYear + asset.usefulLife; y++) {
    let yearDep = 0;

    if (asset.method === "straight-line") {
      yearDep = annualSL;
      // First year: pro-rate based on months
      if (y === startYear) {
        const months = 12 - startMonth + 1;
        yearDep = Math.round(annualSL * (months / 12));
      }
    } else {
      yearDep = Math.round(bookValue * dbRate);
      // First year: pro-rate
      if (y === startYear) {
        const months = 12 - startMonth + 1;
        yearDep = Math.round(bookValue * dbRate * (months / 12));
      }
      // Guarantee amount check (定率法の保証額)
      const guaranteeAmount = Math.round(asset.acquisitionCost * (1 / asset.usefulLife) * 0.9);
      if (yearDep < guaranteeAmount) {
        yearDep = annualSL;
      }
    }

    // Don't depreciate below salvage value
    if (bookValue - yearDep < salvageValue) {
      yearDep = Math.max(0, bookValue - salvageValue);
    }

    if (y === targetYear) {
      depreciationThisYear = yearDep;
    }

    accumulatedDepreciation += yearDep;
    bookValue -= yearDep;
  }

  return {
    depreciationThisYear,
    accumulatedDepreciation,
    bookValue: asset.acquisitionCost - accumulatedDepreciation,
    isFullyDepreciated: bookValue <= salvageValue,
  };
}

export default function FixedAssets() {
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showJournalDialog, setShowJournalDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newAsset, setNewAsset] = useState<Partial<FixedAsset>>({
    name: "",
    category: "器具備品",
    acquisitionDate: "",
    acquisitionCost: 0,
    usefulLife: 4,
    method: "straight-line",
    salvageRate: 0,
    memo: "",
  });

  useEffect(() => {
    loadAppJson<FixedAsset[]>("fixedAssets", STORAGE_KEY, []).then(setAssets).catch(() => toast.error("固定資産を読み込めません"));
  }, []);

  useEffect(() => {
    getAllAccounts().then(setAccounts);
  }, []);

  const schedules = useMemo(
    () => assets.map((asset) => ({
      asset,
      ...calculateDepreciationSchedule(asset, year),
    })),
    [assets, year]
  );

  const totalDepreciation = schedules.reduce((s, sc) => s + sc.depreciationThisYear, 0);

  function handleAddAsset() {
    if (!newAsset.name || !newAsset.acquisitionDate || !newAsset.acquisitionCost) {
      toast.error("名称・取得日・取得価額は必須です");
      return;
    }
    const asset: FixedAsset = {
      id: crypto.randomUUID(),
      name: newAsset.name!,
      category: newAsset.category || "器具備品",
      acquisitionDate: newAsset.acquisitionDate!,
      acquisitionCost: newAsset.acquisitionCost!,
      usefulLife: newAsset.usefulLife || 4,
      method: newAsset.method || "straight-line",
      salvageRate: newAsset.salvageRate || 0,
      memo: newAsset.memo || "",
    };
    const updated = [...assets, asset];
    setAssets(updated);
    void saveAppJson("fixedAssets", STORAGE_KEY, updated);
    setShowAddDialog(false);
    setNewAsset({
      name: "", category: "器具備品", acquisitionDate: "", acquisitionCost: 0,
      usefulLife: 4, method: "straight-line", salvageRate: 0, memo: "",
    });
    toast.success("固定資産を追加しました");
  }

  function deleteAsset(id: string) {
    const updated = assets.filter((a) => a.id !== id);
    setAssets(updated);
    void saveAppJson("fixedAssets", STORAGE_KEY, updated);
    toast.success("固定資産を削除しました");
  }

  function applyPreset(preset: typeof USEFUL_LIFE_PRESETS[0]) {
    setNewAsset((p) => ({
      ...p,
      usefulLife: preset.years,
      category: preset.category,
      name: p?.name || preset.label,
    }));
  }

  async function handleCreateJournals() {
    setSaving(true);
    try {
      const depAcc = accounts.find((a) => a.name === "減価償却費");
      const accumAcc = accounts.find((a) => a.name === "減価償却累計額");

      if (!depAcc) {
        toast.error("「減価償却費」科目が見つかりません。勘定科目マスタに追加してください。");
        setSaving(false);
        return;
      }

      if (!accumAcc) {
        toast.error("「減価償却累計額」科目が見つかりません。勘定科目マスタを確認してください。");
        setSaving(false);
        return;
      }

      const creditAccountId = accumAcc.id;
      const existingJournals = await getAllJournals();
      const now = new Date().toISOString();
      let count = 0;

      for (const sc of schedules) {
        if (sc.depreciationThisYear <= 0) continue;
        const sourceKey = `固定資産償却:${year}:${sc.asset.id}`;
        if (existingJournals.some((journal) => journal.memo?.includes(sourceKey))) continue;
        const journal: JournalEntry = {
          id: crypto.randomUUID(),
          date: `${year}-12-31`,
          debitAccountId: depAcc.id,
          creditAccountId,
          amount: sc.depreciationThisYear,
          description: `減価償却 ${sc.asset.name} (${sc.asset.method === "straight-line" ? "定額法" : "定率法"})`,
          memo: `固定資産台帳より自動仕訳 ${year}年度 ${sourceKey}`,
          createdAt: now,
          updatedAt: now,
        };
        await putJournal(journal);
        count++;
      }
      toast.success(`${count}件の減価償却仕訳を作成しました`);
      setShowJournalDialog(false);
    } catch {
      toast.error("仕訳の作成に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 lg:p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">固定資産台帳</h1>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => setYear(year - 1)}>←</Button>
            <span className="text-[14px] font-bold px-2">{year}年度</span>
            <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => setYear(year + 1)}>→</Button>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowAddDialog(true)}>
            <Plus className="h-4 w-4 mr-1" />
            資産追加
          </Button>
          {totalDepreciation > 0 && (
            <Button size="sm" onClick={() => setShowJournalDialog(true)}>
              <Calculator className="h-4 w-4 mr-1" />
              償却仕訳を作成
            </Button>
          )}
        </div>
      </div>

      {/* Info */}
      <Card className="border shadow-sm mb-4 bg-blue-50/30">
        <CardContent className="py-3 px-4">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
            <p className="text-[12px] text-muted-foreground">
              10万円以上の資産は固定資産として登録し、耐用年数に応じて減価償却します。
              10万円未満は消耗品費として一括経費計上できます。
              10万円以上30万円未満は少額減価償却資産の特例（青色申告）で一括経費計上も可能です。
            </p>
          </div>
        </CardContent>
      </Card>

      {assets.length === 0 ? (
        <Card className="border shadow-sm">
          <CardContent className="py-16 text-center">
            <Building2 className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-[14px] font-semibold mb-1">固定資産がありません</p>
            <p className="text-[12px] text-muted-foreground mb-4">「資産追加」からPC・車両・建物などの固定資産を登録してください</p>
            <Button variant="outline" size="sm" onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-1" />
              資産を追加
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border shadow-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-2.5 text-left font-bold text-muted-foreground">資産名</th>
                    <th className="px-4 py-2.5 text-left font-bold text-muted-foreground">種類</th>
                    <th className="px-4 py-2.5 text-left font-bold text-muted-foreground">取得日</th>
                    <th className="px-4 py-2.5 text-right font-bold text-muted-foreground">取得価額</th>
                    <th className="px-4 py-2.5 text-center font-bold text-muted-foreground">耐用年数</th>
                    <th className="px-4 py-2.5 text-center font-bold text-muted-foreground">償却方法</th>
                    <th className="px-4 py-2.5 text-right font-bold text-muted-foreground">{year}年償却額</th>
                    <th className="px-4 py-2.5 text-right font-bold text-muted-foreground">帳簿価額</th>
                    <th className="px-4 py-2.5 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {schedules.map((sc) => (
                    <tr key={sc.asset.id} className={`hover:bg-muted/20 transition-colors ${sc.isFullyDepreciated ? "opacity-50" : ""}`}>
                      <td className="px-4 py-2.5">
                        <div className="font-semibold">{sc.asset.name}</div>
                        {sc.asset.memo && <div className="text-[11px] text-muted-foreground">{sc.asset.memo}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{sc.asset.category}</td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground">{sc.asset.acquisitionDate}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold">{formatYen(sc.asset.acquisitionCost)}</td>
                      <td className="px-4 py-2.5 text-center">{sc.asset.usefulLife}年</td>
                      <td className="px-4 py-2.5 text-center text-[12px]">
                        {sc.asset.method === "straight-line" ? "定額法" : "定率法"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold">
                        {sc.isFullyDepreciated ? (
                          <span className="text-muted-foreground">償却済</span>
                        ) : (
                          <span className="text-red-600">{formatYen(sc.depreciationThisYear)}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold">{formatYen(sc.bookValue)}</td>
                      <td className="px-2 py-2.5">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>固定資産を削除</AlertDialogTitle>
                              <AlertDialogDescription>「{sc.asset.name}」を削除しますか？</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>キャンセル</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteAsset(sc.asset.id)}>削除</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/20">
                    <td colSpan={6} className="px-4 py-3 font-bold">合計</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-red-600">{formatYen(totalDepreciation)}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold">
                      {formatYen(schedules.reduce((s, sc) => s + sc.bookValue, 0))}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add asset dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>固定資産を追加</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Presets */}
            <div>
              <Label className="text-[12px] font-semibold">耐用年数プリセット</Label>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {USEFUL_LIFE_PRESETS.slice(0, 8).map((preset) => (
                  <Button
                    key={preset.label}
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px]"
                    onClick={() => applyPreset(preset)}
                  >
                    {preset.label}({preset.years}年)
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-[12px] font-semibold">資産名</Label>
                <Input
                  placeholder="例: MacBook Pro"
                  value={newAsset.name}
                  onChange={(e) => setNewAsset((p) => ({ ...p, name: e.target.value }))}
                  className="mt-1 text-[13px]"
                />
              </div>
              <div>
                <Label className="text-[12px] font-semibold">種類</Label>
                <Input
                  placeholder="例: 器具備品"
                  value={newAsset.category}
                  onChange={(e) => setNewAsset((p) => ({ ...p, category: e.target.value }))}
                  className="mt-1 text-[13px]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-[12px] font-semibold">取得日</Label>
                <Input
                  type="date"
                  value={newAsset.acquisitionDate}
                  onChange={(e) => setNewAsset((p) => ({ ...p, acquisitionDate: e.target.value }))}
                  className="mt-1 text-[13px] font-mono"
                />
              </div>
              <div>
                <Label className="text-[12px] font-semibold">取得価額（円）</Label>
                <Input
                  type="number"
                  placeholder="0"
                  value={newAsset.acquisitionCost || ""}
                  onChange={(e) => setNewAsset((p) => ({ ...p, acquisitionCost: Number(e.target.value) }))}
                  className="mt-1 text-[13px] font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="text-[12px] font-semibold">耐用年数</Label>
                <Input
                  type="number"
                  min={1}
                  value={newAsset.usefulLife || ""}
                  onChange={(e) => setNewAsset((p) => ({ ...p, usefulLife: Number(e.target.value) }))}
                  className="mt-1 text-[13px] font-mono"
                />
              </div>
              <div>
                <Label className="text-[12px] font-semibold">償却方法</Label>
                <Select value={newAsset.method} onValueChange={(v) => setNewAsset((p) => ({ ...p, method: v as FixedAsset["method"] }))}>
                  <SelectTrigger className="mt-1 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="straight-line" className="text-[13px]">定額法</SelectItem>
                    <SelectItem value="declining-balance" className="text-[13px]">定率法</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[12px] font-semibold">残存割合</Label>
                <Select
                  value={String(newAsset.salvageRate || 0)}
                  onValueChange={(v) => setNewAsset((p) => ({ ...p, salvageRate: Number(v) }))}
                >
                  <SelectTrigger className="mt-1 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0" className="text-[13px]">0%（備忘1円）</SelectItem>
                    <SelectItem value="0.1" className="text-[13px]">10%</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-[12px] font-semibold">メモ（任意）</Label>
              <Input
                placeholder="補足情報"
                value={newAsset.memo}
                onChange={(e) => setNewAsset((p) => ({ ...p, memo: e.target.value }))}
                className="mt-1 text-[13px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>キャンセル</Button>
            <Button onClick={handleAddAsset}>追加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create journals dialog */}
      <Dialog open={showJournalDialog} onOpenChange={setShowJournalDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>減価償却仕訳を作成</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-[13px] text-muted-foreground">
              以下の減価償却仕訳を{year}年12月31日付で作成します。
            </p>
            <div className="space-y-2">
              {schedules.filter((sc) => sc.depreciationThisYear > 0 && !sc.isFullyDepreciated).map((sc) => (
                <div key={sc.asset.id} className="flex items-center justify-between text-[13px] py-1.5 px-3 bg-muted/30 rounded-lg">
                  <span className="font-medium">減価償却費 / {sc.asset.name}</span>
                  <span className="font-mono font-bold">{formatYen(sc.depreciationThisYear)}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between text-[14px] font-bold pt-2 border-t">
              <span>合計</span>
              <span className="font-mono">{formatYen(totalDepreciation)}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowJournalDialog(false)}>キャンセル</Button>
            <Button onClick={handleCreateJournals} disabled={saving}>
              <Save className="h-4 w-4 mr-1" />
              {saving ? "作成中..." : "仕訳を作成"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
