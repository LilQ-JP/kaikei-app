/**
 * Invoices — 請求書一覧・作成ページ（PDF出力対応）
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getAllInvoices,
  putInvoice,
  deleteInvoice,
  getProfile,
  type Invoice,
  type InvoiceItem,
  type BusinessProfile,
} from "@/lib/db";
import { generateInvoiceHTML } from "@/lib/invoice-pdf";
import {
  formatYen,
  generateInvoiceNumber,
  getToday,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_COLORS,
} from "@/lib/utils";
import { Plus, Trash2, FileText, Download, Eye, MoreHorizontal } from "lucide-react";
import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";

function emptyInvoiceItem(): InvoiceItem {
  return { description: "", quantity: 1, unitPrice: 0, amount: 0, taxRate: 10 };
}

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [profile, setProfile] = useState<BusinessProfile | undefined>();
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewingInvoice, setPreviewingInvoice] = useState<Invoice | null>(null);
  const previewFrameRef = useRef<HTMLIFrameElement>(null);

  // Form state
  const [clientName, setClientName] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [issueDate, setIssueDate] = useState(getToday());
  const [dueDate, setDueDate] = useState("");
  const [items, setItems] = useState<InvoiceItem[]>([emptyInvoiceItem()]);
  const [taxRate, setTaxRate] = useState(10);
  const [notes, setNotes] = useState("");
  const [bankInfo, setBankInfo] = useState("");

  const load = useCallback(async () => {
    const [inv, prof] = await Promise.all([getAllInvoices(), getProfile()]);
    setInvoices(inv);
    setProfile(prof);
    if (prof?.bankName) {
      setBankInfo(
        `${prof.bankName} ${prof.bankBranch || ""} ${prof.bankAccountType || ""} ${prof.bankAccountNumber || ""} ${prof.bankAccountName || ""}`.trim()
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function updateItem(index: number, field: keyof InvoiceItem, value: string | number) {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const updated = { ...item, [field]: value };
        if (field === "quantity" || field === "unitPrice") {
          updated.amount = Number(updated.quantity) * Number(updated.unitPrice);
        }
        return updated;
      })
    );
  }

  function addItem() {
    setItems((prev) => [...prev, emptyInvoiceItem()]);
  }

  function removeItem(index: number) {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const taxBreakdown = Array.from(items.reduce((groups, item) => {
    const rate = Number(item.taxRate ?? taxRate);
    groups.set(rate, (groups.get(rate) || 0) + item.amount);
    return groups;
  }, new Map<number, number>()).entries()).sort(([a], [b]) => a - b).map(([rate, taxableAmount]) => ({
    taxRate: rate,
    taxableAmount,
    taxAmount: Math.floor(taxableAmount * (rate / 100)),
  }));
  const taxAmount = taxBreakdown.reduce((sum, group) => sum + group.taxAmount, 0);
  const total = subtotal + taxAmount;

  async function handleSave() {
    if (!clientName) {
      toast.error("請求先名を入力してください");
      return;
    }
    if (items.some((item) => !item.description || item.amount <= 0)) {
      toast.error("すべての明細に品名と金額を入力してください");
      return;
    }

    const now = new Date().toISOString();
    const invoice: Invoice = {
      id: crypto.randomUUID(),
      invoiceNumber: generateInvoiceNumber(),
      clientName,
      clientAddress,
      issueDate,
      dueDate,
      items,
      subtotal,
      taxRate,
      taxAmount,
      total,
      taxBreakdown,
      status: "draft",
      notes,
      bankInfo,
      createdAt: now,
      updatedAt: now,
    };

    await putInvoice(invoice);
    toast.success("請求書を作成しました");
    setDialogOpen(false);
    resetForm();
    load();
  }

  function resetForm() {
    setClientName("");
    setClientAddress("");
    setIssueDate(getToday());
    setDueDate("");
    setItems([emptyInvoiceItem()]);
    setTaxRate(10);
    setNotes("");
  }

  async function updateStatus(id: string, status: Invoice["status"]) {
    const inv = invoices.find((i) => i.id === id);
    if (!inv) return;
    await putInvoice({ ...inv, status, updatedAt: new Date().toISOString() });
    toast.success("ステータスを更新しました");
    load();
  }

  async function handleDelete(id: string) {
    await deleteInvoice(id);
    toast.success("請求書を削除しました");
    load();
  }

  function handlePreview(invoice: Invoice) {
    setPreviewingInvoice(invoice);
  }

  function handlePrintPDF() {
    const frameWindow = previewFrameRef.current?.contentWindow;
    if (!frameWindow) {
      toast.error("プレビューを読み込めませんでした。もう一度お試しください。");
      return;
    }
    frameWindow.focus();
    frameWindow.print();
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
        <h1 className="text-xl font-bold">請求書</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              新規作成
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>請求書を作成</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-[12px] font-semibold">請求先名 *</Label>
                  <Input
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className="mt-1 text-[13px]"
                    placeholder="株式会社〇〇"
                  />
                </div>
                <div>
                  <Label className="text-[12px] font-semibold">請求先住所</Label>
                  <Input
                    value={clientAddress}
                    onChange={(e) => setClientAddress(e.target.value)}
                    className="mt-1 text-[13px]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-[12px] font-semibold">発行日</Label>
                  <Input
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className="mt-1 text-[13px] font-mono"
                  />
                </div>
                <div>
                  <Label className="text-[12px] font-semibold">支払期限</Label>
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="mt-1 text-[13px] font-mono"
                  />
                </div>
                <div>
                  <Label className="text-[12px] font-semibold">消費税率(%)</Label>
                  <Input
                    type="number"
                    value={taxRate}
                    onChange={(e) => setTaxRate(Number(e.target.value))}
                    className="mt-1 text-[13px] font-mono"
                  />
                </div>
              </div>

              {/* Items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-[12px] font-semibold">明細</Label>
                  <Button variant="outline" size="sm" onClick={addItem} className="h-7 text-[12px]">
                    <Plus className="h-3 w-3 mr-1" />
                    行追加
                  </Button>
                </div>
                <div className="space-y-2">
                  {items.map((item, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-4">
                        {i === 0 && (
                          <Label className="text-[11px] text-muted-foreground">品名</Label>
                        )}
                        <Input
                          value={item.description}
                          onChange={(e) => updateItem(i, "description", e.target.value)}
                          className="text-[13px]"
                          placeholder="品名"
                        />
                      </div>
                      <div className="col-span-2">
                        {i === 0 && (
                          <Label className="text-[11px] text-muted-foreground">数量</Label>
                        )}
                        <Input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateItem(i, "quantity", Number(e.target.value))}
                          className="text-[13px] font-mono"
                        />
                      </div>
                      <div className="col-span-2">
                        {i === 0 && (
                          <Label className="text-[11px] text-muted-foreground">単価</Label>
                        )}
                        <Input
                          type="number"
                          value={item.unitPrice}
                          onChange={(e) => updateItem(i, "unitPrice", Number(e.target.value))}
                          className="text-[13px] font-mono"
                        />
                      </div>
                      <div className="col-span-2">
                        {i === 0 && (
                          <Label className="text-[11px] text-muted-foreground">金額</Label>
                        )}
                        <div className="h-9 flex items-center text-[13px] font-mono font-bold">
                          {formatYen(item.amount)}
                        </div>
                      </div>
                      <div className="col-span-1">
                        {i === 0 && <Label className="text-[11px] text-muted-foreground">税率</Label>}
                        <select
                          value={item.taxRate ?? 10}
                          onChange={(e) => updateItem(i, "taxRate", Number(e.target.value))}
                          className="mt-1 h-9 w-full rounded-md border bg-background px-1 text-[12px]"
                        >
                          <option value={10}>10%</option>
                          <option value={8}>8%</option>
                          <option value={0}>非課税</option>
                        </select>
                      </div>
                      <div className="col-span-1">
                        {items.length > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-9 w-9 p-0"
                            onClick={() => removeItem(i)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="border-t pt-3 space-y-1 text-right">
                <div className="text-[13px]">
                  小計: <span className="font-mono font-bold">{formatYen(subtotal)}</span>
                </div>
                {taxBreakdown.map((group) => (
                  <div key={group.taxRate} className="text-[13px]">
                    消費税({group.taxRate}%): <span className="font-mono font-bold">{formatYen(group.taxAmount)}</span>
                  </div>
                ))}
                <div className="text-[16px] font-bold">
                  合計: <span className="font-mono">{formatYen(total)}</span>
                </div>
              </div>

              {/* Bank info & notes */}
              <div>
                <Label className="text-[12px] font-semibold">振込先情報</Label>
                <Input
                  value={bankInfo}
                  onChange={(e) => setBankInfo(e.target.value)}
                  className="mt-1 text-[13px]"
                  placeholder="〇〇銀行 〇〇支店 普通 1234567"
                />
              </div>
              <div>
                <Label className="text-[12px] font-semibold">備考</Label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1 text-[13px]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  キャンセル
                </Button>
                <Button onClick={handleSave}>作成</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Invoice list */}
      {invoices.length === 0 ? (
        <Card className="border shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FileText className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-[13px] text-muted-foreground">請求書がありません</p>
            <p className="text-[12px] text-muted-foreground/60 mt-1">
              「新規作成」から請求書を作成できます
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {invoices.map((inv) => (
            <Card key={inv.id} className="border shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold">{inv.invoiceNumber}</div>
                      <div className="text-[12px] text-muted-foreground truncate">
                        {inv.clientName}
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold shrink-0 ${INVOICE_STATUS_COLORS[inv.status]}`}
                    >
                      {INVOICE_STATUS_LABELS[inv.status]}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="text-[15px] font-mono font-bold">{formatYen(inv.total)}</div>
                      <div className="text-[11px] text-muted-foreground">{inv.issueDate}</div>
                    </div>
                    <div className="flex gap-1">
                      <Select
                        value={inv.status}
                        onValueChange={(v) => updateStatus(inv.id, v as Invoice["status"])}
                      >
                        <SelectTrigger className="h-8 w-[100px] text-[12px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="draft">下書き</SelectItem>
                          <SelectItem value="sent">送付済</SelectItem>
                          <SelectItem value="paid">入金済</SelectItem>
                          <SelectItem value="overdue">期限超過</SelectItem>
                        </SelectContent>
                      </Select>

                      {/* PDF / Preview dropdown */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handlePreview(inv)}>
                            <Eye className="h-3.5 w-3.5 mr-2" />
                            プレビュー
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handlePreview(inv)}>
                            <Download className="h-3.5 w-3.5 mr-2" />
                            PDF保存・印刷
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>請求書を削除</AlertDialogTitle>
                            <AlertDialogDescription>
                              この請求書を削除しますか？
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>キャンセル</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(inv.id)}>
                              削除
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-3 text-[12px] text-muted-foreground">{invoices.length}件の請求書</div>

      <Dialog open={!!previewingInvoice} onOpenChange={(open) => !open && setPreviewingInvoice(null)}>
        <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-5 pb-3 border-b">
            <DialogTitle>請求書プレビュー</DialogTitle>
          </DialogHeader>
          {previewingInvoice && (
            <iframe
              ref={previewFrameRef}
              title={`請求書 ${previewingInvoice.invoiceNumber}`}
              srcDoc={generateInvoiceHTML(previewingInvoice, profile)}
              className="flex-1 w-full border-0 bg-white"
              sandbox="allow-same-origin allow-modals"
            />
          )}
          <div className="px-6 py-3 border-t flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">印刷画面で保存先を「PDF に保存」にするとPDFを作成できます。</p>
            <Button onClick={handlePrintPDF} className="shrink-0">
              <Download className="h-4 w-4 mr-1.5" />
              PDF保存・印刷
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
