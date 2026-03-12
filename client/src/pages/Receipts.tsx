/**
 * Receipts — レシート画像保存・管理ページ
 * macOS Ledger Design
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
  getAllReceipts,
  putReceipt,
  deleteReceipt,
  type Receipt,
} from "@/lib/db";
import { formatYen, getToday } from "@/lib/utils";
import { Camera, ImageIcon, Plus, Trash2, X, ZoomIn } from "lucide-react";
import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";

export default function Receipts() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Form state
  const [imageData, setImageData] = useState("");
  const [fileName, setFileName] = useState("");
  const [date, setDate] = useState(getToday());
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await getAllReceipts();
    setReceipts(r);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("画像ファイルを選択してください");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("ファイルサイズは5MB以下にしてください");
      return;
    }

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImageData(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    if (!imageData) {
      toast.error("画像を選択してください");
      return;
    }

    const receipt: Receipt = {
      id: crypto.randomUUID(),
      imageData,
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
    setImageData("");
    setFileName("");
    setDate(getToday());
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
              {/* Image upload */}
              <div>
                <Label className="text-[12px] font-semibold">画像 *</Label>
                {imageData ? (
                  <div className="mt-1 relative">
                    <img src={imageData} alt="preview" className="w-full h-48 object-contain rounded-lg border bg-muted/20" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-1 right-1 h-7 w-7 p-0 bg-background/80"
                      onClick={() => { setImageData(""); setFileName(""); if (fileInputRef.current) fileInputRef.current.value = ""; }}
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
                    <p className="text-[12px] text-muted-foreground">クリックして画像を選択</p>
                    <p className="text-[11px] text-muted-foreground/60">JPG, PNG (5MB以下)</p>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
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
                <Input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 text-[13px]" placeholder="補足メモ" />
              </div>

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
            <p className="text-[12px] text-muted-foreground/60 mt-1">レシートの画像を保存して経費管理に活用できます</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {receipts.map((receipt) => (
            <Card key={receipt.id} className="border shadow-sm overflow-hidden group">
              <div className="relative h-40 bg-muted/20">
                <img
                  src={receipt.imageData}
                  alt={receipt.fileName}
                  className="w-full h-full object-contain cursor-pointer"
                  onClick={() => setPreviewImage(receipt.imageData)}
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="bg-white/80 h-8 w-8 p-0"
                    onClick={() => setPreviewImage(receipt.imageData)}
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <CardContent className="p-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <div className="text-[12px] font-mono text-muted-foreground">{receipt.date}</div>
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
          ))}
        </div>
      )}

      {/* Image preview modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <img src={previewImage} alt="preview" className="max-w-full max-h-[85vh] object-contain rounded-lg" />
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2 h-8 w-8 p-0 bg-white/80 hover:bg-white"
              onClick={() => setPreviewImage(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <div className="mt-3 text-[12px] text-muted-foreground">
        {receipts.length}件のレシート
      </div>
    </div>
  );
}
