/**
 * Receipts — レシート画像/PDF保存・管理ページ（仕訳連携対応）
 * macOS Ledger Design
 *
 * - 画像（JPG/PNG）とPDFの両方に対応
 * - 仕訳と紐付いたレシートにはバッジが表示
 * - クリックで紐付いた仕訳の詳細を確認可能
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  getAllReceipts,
  getAllJournals,
  getAllAccounts,
  putReceipt,
  deleteReceipt,
  type Receipt,
  type JournalEntry,
  type AccountItem,
} from "@/lib/db";
import { formatYen, getToday } from "@/lib/utils";
import { Camera, ImageIcon, Plus, Trash2, X, ZoomIn, BookOpen, Link2, FileText, Sparkles, Check } from "lucide-react";
import { analyzeReceipt, getReceiptConfidenceLabel, type ReceiptAnalysis } from "@/lib/receipt-ai";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";
import { journalLines } from "@shared/accounting";

function isPdfData(data: string): boolean {
  return data.startsWith("data:application/pdf");
}

const ACCEPTED_DOCUMENT_TYPES = new Set(["image/jpeg", "image/png", "image/heic", "application/pdf"]);

export default function Receipts() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewData, setPreviewData] = useState<{ data: string; isPdf: boolean } | null>(null);
  const [journalDetailReceipt, setJournalDetailReceipt] = useState<Receipt | null>(null);

  // Form state
  const [fileData, setFileData] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileIsPdf, setFileIsPdf] = useState(false);
  const [date, setDate] = useState(getToday());
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [aiAnalysis, setAiAnalysis] = useState<ReceiptAnalysis | null>(null);

  const load = useCallback(async () => {
    const [r, j, a] = await Promise.all([getAllReceipts(), getAllJournals(), getAllAccounts()]);
    setReceipts(r);
    setJournals(j);
    setAccounts(a);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const accountMap = useMemo(() => {
    const map = new Map<string, AccountItem>();
    accounts.forEach((a) => map.set(a.id, a));
    return map;
  }, [accounts]);

  const journalByReceiptId = useMemo(() => {
    const map = new Map<string, JournalEntry>();
    journals.forEach((j) => {
      if (j.receiptId) map.set(j.receiptId, j);
    });
    return map;
  }, [journals]);

  const journalById = useMemo(() => {
    const map = new Map<string, JournalEntry>();
    journals.forEach((j) => map.set(j.id, j));
    return map;
  }, [journals]);

  function getLinkedJournal(receipt: Receipt): JournalEntry | undefined {
    const byReceiptId = journalByReceiptId.get(receipt.id);
    if (byReceiptId) return byReceiptId;
    if (receipt.journalEntryId) return journalById.get(receipt.journalEntryId);
    return undefined;
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";
    if ((!isImage && !isPdf) || !ACCEPTED_DOCUMENT_TYPES.has(file.type)) {
      toast.error("JPEG・PNG・HEIC画像またはPDFを選択してください（SVG等は保存できません）");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("ファイルサイズは10MB以下にしてください");
      return;
    }
    setFileName(file.name);
    setFileIsPdf(isPdf);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setFileData(ev.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Run AI analysis on file name
    const analysis = analyzeReceipt(file.name, description || vendor, accounts);
    setAiAnalysis(analysis);
    if (analysis.amount && !amount) setAmount(String(analysis.amount));
    if (analysis.date && !date) setDate(analysis.date);
    if (analysis.storeName && !vendor) setVendor(analysis.storeName);
  }

  async function handleSave() {
    if (!fileData) {
      toast.error("画像またはPDFを選択してください");
      return;
    }
    const receipt: Receipt = {
      id: crypto.randomUUID(),
      imageData: fileData,
      fileName,
      date,
      amount: amount ? Number(amount) : undefined,
      vendor: vendor || undefined,
      description: description || undefined,
      createdAt: new Date().toISOString(),
    };
    await putReceipt(receipt);
    toast.success("レシートを保存しました");
    setDialogOpen(false);
    resetForm();
    load();
  }

  function resetForm() {
    setFileData("");
    setFileName("");
    setFileIsPdf(false);
    setDate(getToday());
    setAiAnalysis(null);
    setAmount("");
    setVendor("");
    setDescription("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDelete(id: string) {
    await deleteReceipt(id);
    toast.success("レシートを削除しました");
    load();
  }

  function openPreview(receipt: Receipt) {
    const isPdf = isPdfData(receipt.imageData);
    setPreviewData({ data: receipt.imageData, isPdf });
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center"><div className="text-sm text-muted-foreground">読み込み中...</div></div>;
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">レシート</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              追加
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>レシートを追加</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div>
                <Label className="text-[12px] font-semibold">画像 / PDF *</Label>
                {fileData ? (
                  <div className="mt-1 relative">
                    {fileIsPdf ? (
                      <div className="w-full h-48 flex flex-col items-center justify-center rounded-lg border bg-muted/20">
                        <FileText className="h-12 w-12 text-red-500 mb-2" />
                        <p className="text-[13px] font-semibold">{fileName}</p>
                        <p className="text-[11px] text-muted-foreground">PDFファイル</p>
                      </div>
                    ) : (
                      <img src={fileData} alt="preview" className="w-full h-48 object-contain rounded-lg border bg-muted/20" />
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-1 right-1 h-7 w-7 p-0 bg-background/80"
                      onClick={() => { setFileData(""); setFileName(""); setFileIsPdf(false); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div
                    className="mt-1 flex flex-col items-center justify-center h-40 rounded-lg border-2 border-dashed border-border hover:border-primary/50 transition-colors cursor-pointer"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Camera className="h-8 w-8 text-muted-foreground/50 mb-2" />
                    <p className="text-[12px] text-muted-foreground">クリックして画像/PDFを選択</p>
                    <p className="text-[11px] text-muted-foreground/60">JPG, PNG, HEIC, PDF (10MB以下)</p>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/heic,application/pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-[12px] font-semibold">日付</Label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 text-[13px] font-mono" />
                </div>
                <div>
                  <Label className="text-[12px] font-semibold">金額（円）</Label>
                  <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 text-[13px] font-mono" placeholder="0" />
                </div>
              </div>

              <div>
                <Label className="text-[12px] font-semibold">店舗名</Label>
                <Input value={vendor} onChange={(e) => setVendor(e.target.value)} className="mt-1 text-[13px]" placeholder="店舗名" />
              </div>

              <div>
                <Label className="text-[12px] font-semibold">メモ</Label>
                <Input value={description} onChange={(e) => {
                  setDescription(e.target.value);
                  if (fileName) {
                    const analysis = analyzeReceipt(fileName, e.target.value || vendor, accounts);
                    setAiAnalysis(analysis);
                  }
                }} className="mt-1 text-[13px]" placeholder="補足メモ" />
              </div>

              {/* AI Analysis Result */}
              {aiAnalysis && aiAnalysis.confidence > 0 && (
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/15">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <span className="text-[12px] font-bold text-primary">AI自動判定</span>
                    {(() => {
                      const conf = getReceiptConfidenceLabel(aiAnalysis.confidence);
                      return (
                        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold ${conf.color}`}>
                          信頼度 {conf.label} ({aiAnalysis.confidence}%)
                        </span>
                      );
                    })()}
                  </div>
                  <div className="space-y-1">
                    <div className="text-[12px]">
                      <span className="font-semibold">推定科目:</span> 借方 {aiAnalysis.suggestedDebitAccountName} / 貸方 {aiAnalysis.suggestedCreditAccountName}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{aiAnalysis.reason}</div>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">※ 仕訳入力時に仕訳候補としてこの推定を確認できます</p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>キャンセル</Button>
                <Button onClick={handleSave}>保存</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {receipts.length === 0 ? (
        <Card className="border shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <ImageIcon className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-[13px] text-muted-foreground">レシートがありません</p>
            <p className="text-[12px] text-muted-foreground/60 mt-1">仕訳入力時にレシートを添付するか、ここから直接追加できます</p>
            <p className="text-[11px] text-muted-foreground/50 mt-0.5">画像（JPG/PNG）とPDFに対応</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {receipts.map((receipt) => {
            const linkedJournal = getLinkedJournal(receipt);
            const isPdf = isPdfData(receipt.imageData);
            return (
              <Card key={receipt.id} className="border shadow-sm overflow-hidden group">
                <div className="relative h-40 bg-muted/20">
                  {isPdf ? (
                    <div
                      className="w-full h-full flex flex-col items-center justify-center cursor-pointer"
                      onClick={() => openPreview(receipt)}
                    >
                      <FileText className="h-12 w-12 text-red-500 mb-1" />
                      <p className="text-[11px] font-semibold text-muted-foreground truncate max-w-[90%]">{receipt.fileName}</p>
                      <p className="text-[10px] text-muted-foreground/60">PDF</p>
                    </div>
                  ) : (
                    <img
                      src={receipt.imageData}
                      alt={receipt.fileName}
                      className="w-full h-full object-contain cursor-pointer"
                      onClick={() => openPreview(receipt)}
                    />
                  )}
                  {/* 仕訳連携バッジ */}
                  {linkedJournal && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          className="absolute top-2 left-2 flex items-center gap-1 bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-[10px] font-bold shadow-sm hover:bg-primary/90 transition-colors"
                          onClick={() => setJournalDetailReceipt(receipt)}
                        >
                          <Link2 className="h-3 w-3" />
                          仕訳連携済
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-[12px]">クリックで紐付いた仕訳を確認</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {!isPdf && (
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 pointer-events-none">
                      <div className="bg-white/80 dark:bg-black/50 h-8 w-8 rounded-full flex items-center justify-center">
                        <ZoomIn className="h-4 w-4" />
                      </div>
                    </div>
                  )}
                </div>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <div className="text-[12px] font-mono text-muted-foreground">{receipt.date}</div>
                        {isPdf && (
                          <span className="text-[9px] font-bold text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400 px-1 py-0.5 rounded">PDF</span>
                        )}
                      </div>
                      {receipt.vendor && <div className="text-[13px] font-semibold truncate">{receipt.vendor}</div>}
                      {receipt.amount && <div className="text-[13px] font-mono font-bold">{formatYen(receipt.amount)}</div>}
                      {receipt.description && <div className="text-[11px] text-muted-foreground truncate mt-0.5">{receipt.description}</div>}
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>レシートを削除</AlertDialogTitle>
                          <AlertDialogDescription>このレシートを削除しますか？</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>キャンセル</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(receipt.id)}>削除</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Preview modal — image or PDF */}
      {previewData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setPreviewData(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            {previewData.isPdf ? (
              <div className="bg-background rounded-lg overflow-hidden shadow-2xl" style={{ width: "80vw", height: "85vh" }}>
                <iframe
                  src={previewData.data}
                  title="PDF Preview"
                  className="w-full h-full"
                  sandbox=""
                />
              </div>
            ) : (
              <img src={previewData.data} alt="preview" className="max-w-full max-h-[85vh] object-contain rounded-lg" />
            )}
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2 h-8 w-8 p-0 bg-white/80 dark:bg-black/60 hover:bg-white dark:hover:bg-black/80"
              onClick={() => setPreviewData(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Journal detail dialog for linked receipt */}
      <Dialog open={!!journalDetailReceipt} onOpenChange={() => setJournalDetailReceipt(null)}>
        <DialogContent className="max-w-md">
          <DialogTitle className="text-[14px] font-bold flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            紐付いた仕訳
          </DialogTitle>
          {journalDetailReceipt && (() => {
            const journal = getLinkedJournal(journalDetailReceipt);
            if (!journal) return <p className="text-[13px] text-muted-foreground">仕訳が見つかりません</p>;
            const lines = journalLines(journal);
            const debit = lines.filter((line) => line.side === "debit").map((line) => `${accountMap.get(line.accountId)?.name || "不明科目"} ${formatYen(line.amount)}`).join("、");
            const credit = lines.filter((line) => line.side === "credit").map((line) => `${accountMap.get(line.accountId)?.name || "不明科目"} ${formatYen(line.amount)}`).join("、");
            return (
              <div className="space-y-3 mt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-muted/30 rounded-lg p-3">
                    <div className="text-[11px] text-muted-foreground font-semibold mb-1">日付</div>
                    <div className="text-[13px] font-mono">{journal.date}</div>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3">
                    <div className="text-[11px] text-muted-foreground font-semibold mb-1">金額</div>
                    <div className="text-[13px] font-mono font-bold">{formatYen(journal.amount)}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-muted/30 rounded-lg p-3">
                    <div className="text-[11px] text-muted-foreground font-semibold mb-1">借方</div>
                    <div className="text-[13px] font-semibold">{debit || "—"}</div>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3">
                    <div className="text-[11px] text-muted-foreground font-semibold mb-1">貸方</div>
                    <div className="text-[13px] font-semibold">{credit || "—"}</div>
                  </div>
                </div>
                {journal.description && (
                  <div className="bg-muted/30 rounded-lg p-3">
                    <div className="text-[11px] text-muted-foreground font-semibold mb-1">摘要</div>
                    <div className="text-[13px]">{journal.description}</div>
                  </div>
                )}
                {journal.paymentMethod && (
                  <div className="bg-muted/30 rounded-lg p-3">
                    <div className="text-[11px] text-muted-foreground font-semibold mb-1">決済手段</div>
                    <div className="text-[13px]">{journal.paymentMethod}</div>
                  </div>
                )}
                {journal.memo && (
                  <div className="bg-muted/30 rounded-lg p-3">
                    <div className="text-[11px] text-muted-foreground font-semibold mb-1">メモ</div>
                    <div className="text-[13px]">{journal.memo}</div>
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <div className="mt-3 text-[12px] text-muted-foreground">
        {receipts.length}件のレシート
        {receipts.filter((r) => getLinkedJournal(r)).length > 0 && (
          <span className="ml-2">
            （うち{receipts.filter((r) => getLinkedJournal(r)).length}件が仕訳と連携済）
          </span>
        )}
      </div>
    </div>
  );
}
