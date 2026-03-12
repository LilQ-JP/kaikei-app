/**
 * Invoices — 請求書一覧・作成ページ
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
  getAllInvoices,
  putInvoice,
  deleteInvoice,
  getProfile,
  type Invoice,
  type InvoiceItem,
  type BusinessProfile,
} from "@/lib/db";
import {
  formatYen,
  generateInvoiceNumber,
  getToday,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_COLORS,
} from "@/lib/utils";
import { Plus, Trash2, FileText, Printer, Eye } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";

function emptyInvoiceItem(): InvoiceItem {
  return { description: "", quantity: 1, unitPrice: 0, amount: 0, taxRate: 10 };
}

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [profile, setProfile] = useState<BusinessProfile | undefined>();
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);

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
      setBankInfo(`${prof.bankName} ${prof.bankBranch || ""} ${prof.bankAccountType || ""} ${prof.bankAccountNumber || ""} ${prof.bankAccountName || ""}`);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

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
  const taxAmount = Math.floor(subtotal * (taxRate / 100));
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

  function handlePrint(invoice: Invoice) {
    setPreviewInvoice(invoice);
    setTimeout(() => {
      const printArea = document.getElementById("invoice-print-area");
      if (printArea) {
        const win = window.open("", "_blank");
        if (win) {
          win.document.write(`
            <html><head><title>請求書 ${invoice.invoiceNumber}</title>
            <style>
              body { font-family: "Noto Sans JP", "Hiragino Kaku Gothic Pro", sans-serif; padding: 40px; font-size: 14px; color: #1d1d1f; }
              table { width: 100%; border-collapse: collapse; margin: 20px 0; }
              th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
              th { background: #f5f5f7; font-weight: 700; }
              .text-right { text-align: right; }
              .font-bold { font-weight: 700; }
              .text-sm { font-size: 12px; }
              h1 { font-size: 24px; margin-bottom: 4px; }
              .header { display: flex; justify-content: space-between; margin-bottom: 30px; }
              .total-row { font-size: 18px; font-weight: 700; }
              @media print { body { padding: 20px; } }
            </style></head><body>
            ${printArea.innerHTML}
            </body></html>
          `);
          win.document.close();
          win.print();
        }
      }
      setPreviewInvoice(null);
    }, 100);
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center"><div className="text-sm text-muted-foreground">読み込み中...</div></div>;
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
                  <Input value={clientName} onChange={(e) => setClientName(e.target.value)} className="mt-1 text-[13px]" placeholder="株式会社〇〇" />
                </div>
                <div>
                  <Label className="text-[12px] font-semibold">請求先住所</Label>
                  <Input value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} className="mt-1 text-[13px]" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-[12px] font-semibold">発行日</Label>
                  <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="mt-1 text-[13px] font-mono" />
                </div>
                <div>
                  <Label className="text-[12px] font-semibold">支払期限</Label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 text-[13px] font-mono" />
                </div>
                <div>
                  <Label className="text-[12px] font-semibold">消費税率(%)</Label>
                  <Input type="number" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))} className="mt-1 text-[13px] font-mono" />
                </div>
              </div>

              {/* Items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-[12px] font-semibold">明細</Label>
                  <Button variant="outline" size="sm" onClick={addItem} className="h-7 text-[12px]">
                    <Plus className="h-3 w-3 mr-1" />行追加
                  </Button>
                </div>
                <div className="space-y-2">
                  {items.map((item, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-5">
                        {i === 0 && <Label className="text-[11px] text-muted-foreground">品名</Label>}
                        <Input value={item.description} onChange={(e) => updateItem(i, "description", e.target.value)} className="text-[13px]" placeholder="品名" />
                      </div>
                      <div className="col-span-2">
                        {i === 0 && <Label className="text-[11px] text-muted-foreground">数量</Label>}
                        <Input type="number" value={item.quantity} onChange={(e) => updateItem(i, "quantity", Number(e.target.value))} className="text-[13px] font-mono" />
                      </div>
                      <div className="col-span-2">
                        {i === 0 && <Label className="text-[11px] text-muted-foreground">単価</Label>}
                        <Input type="number" value={item.unitPrice} onChange={(e) => updateItem(i, "unitPrice", Number(e.target.value))} className="text-[13px] font-mono" />
                      </div>
                      <div className="col-span-2">
                        {i === 0 && <Label className="text-[11px] text-muted-foreground">金額</Label>}
                        <div className="h-9 flex items-center text-[13px] font-mono font-bold">{formatYen(item.amount)}</div>
                      </div>
                      <div className="col-span-1">
                        {items.length > 1 && (
                          <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => removeItem(i)}>
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
                <div className="text-[13px]">小計: <span className="font-mono font-bold">{formatYen(subtotal)}</span></div>
                <div className="text-[13px]">消費税({taxRate}%): <span className="font-mono font-bold">{formatYen(taxAmount)}</span></div>
                <div className="text-[16px] font-bold">合計: <span className="font-mono">{formatYen(total)}</span></div>
              </div>

              {/* Bank info & notes */}
              <div>
                <Label className="text-[12px] font-semibold">振込先情報</Label>
                <Input value={bankInfo} onChange={(e) => setBankInfo(e.target.value)} className="mt-1 text-[13px]" placeholder="〇〇銀行 〇〇支店 普通 1234567" />
              </div>
              <div>
                <Label className="text-[12px] font-semibold">備考</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 text-[13px]" />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>キャンセル</Button>
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
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {invoices.map((inv) => (
            <Card key={inv.id} className="border shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div>
                      <div className="text-[13px] font-bold">{inv.invoiceNumber}</div>
                      <div className="text-[12px] text-muted-foreground">{inv.clientName}</div>
                    </div>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${INVOICE_STATUS_COLORS[inv.status]}`}>
                      {INVOICE_STATUS_LABELS[inv.status]}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
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
                      <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => handlePrint(inv)}>
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>請求書を削除</AlertDialogTitle>
                            <AlertDialogDescription>この請求書を削除しますか？</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>キャンセル</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(inv.id)}>削除</AlertDialogAction>
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

      {/* Hidden print area */}
      {previewInvoice && (
        <div id="invoice-print-area" style={{ position: "absolute", left: "-9999px" }}>
          <h1>請求書</h1>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <p><strong>{previewInvoice.clientName}</strong> 御中</p>
              {previewInvoice.clientAddress && <p style={{ fontSize: 12 }}>{previewInvoice.clientAddress}</p>}
            </div>
            <div style={{ textAlign: "right" }}>
              <p>請求書番号: {previewInvoice.invoiceNumber}</p>
              <p>発行日: {previewInvoice.issueDate}</p>
              {previewInvoice.dueDate && <p>支払期限: {previewInvoice.dueDate}</p>}
              {profile?.businessName && <p style={{ marginTop: 10 }}><strong>{profile.businessName}</strong></p>}
              {profile?.address && <p style={{ fontSize: 12 }}>{profile.address}</p>}
              {profile?.taxId && <p style={{ fontSize: 12 }}>登録番号: {profile.taxId}</p>}
            </div>
          </div>
          <table>
            <thead>
              <tr><th>品名</th><th className="text-right">数量</th><th className="text-right">単価</th><th className="text-right">金額</th></tr>
            </thead>
            <tbody>
              {previewInvoice.items.map((item, i) => (
                <tr key={i}>
                  <td>{item.description}</td>
                  <td className="text-right">{item.quantity}</td>
                  <td className="text-right">{formatYen(item.unitPrice)}</td>
                  <td className="text-right">{formatYen(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ textAlign: "right", marginTop: 10 }}>
            <p>小計: {formatYen(previewInvoice.subtotal)}</p>
            <p>消費税({previewInvoice.taxRate}%): {formatYen(previewInvoice.taxAmount)}</p>
            <p className="total-row">合計: {formatYen(previewInvoice.total)}</p>
          </div>
          {previewInvoice.bankInfo && (
            <div style={{ marginTop: 20, padding: 10, border: "1px solid #ddd" }}>
              <p className="font-bold text-sm">振込先</p>
              <p>{previewInvoice.bankInfo}</p>
            </div>
          )}
          {previewInvoice.notes && (
            <div style={{ marginTop: 10 }}>
              <p className="text-sm">備考: {previewInvoice.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
