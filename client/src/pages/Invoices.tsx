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
  getAllAccounts,
  getAllInvoices,
  putInvoice,
  deleteInvoice,
  postInvoiceToLedger,
  recordInvoicePayment,
  getProfile,
  type AccountItem,
  type Invoice,
  type InvoiceItem,
  type BusinessProfile,
} from "@/lib/db";
import { downloadInvoicePDF, generateInvoiceHTML } from "@/lib/invoice-pdf";
import {
  formatYen,
  generateInvoiceNumber,
  getToday,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_COLORS,
} from "@/lib/utils";
import { Plus, Trash2, FileText, Download, Eye, MoreHorizontal, Pencil } from "lucide-react";
import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";

function emptyInvoiceItem(): InvoiceItem {
  return { description: "", quantity: 1, unitPrice: 0, amount: 0, taxRate: 10 };
}

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [profile, setProfile] = useState<BusinessProfile | undefined>();
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [previewingInvoice, setPreviewingInvoice] = useState<Invoice | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);
  const [paymentDate, setPaymentDate] = useState(getToday());
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paymentMemo, setPaymentMemo] = useState("");
  const [paymentRequestId, setPaymentRequestId] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const previewFrameRef = useRef<HTMLIFrameElement>(null);

  // Form state
  const [clientName, setClientName] = useState("");
  const [clientPostalCode, setClientPostalCode] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [clientBuilding, setClientBuilding] = useState("");
  const [issueDate, setIssueDate] = useState(getToday());
  const [dueDate, setDueDate] = useState("");
  const [items, setItems] = useState<InvoiceItem[]>([emptyInvoiceItem()]);
  const [taxRate, setTaxRate] = useState(10);
  const [notes, setNotes] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankBranch, setBankBranch] = useState("");
  const [bankAccountType, setBankAccountType] = useState("普通");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");

  const load = useCallback(async () => {
    const [inv, prof, accs] = await Promise.all([getAllInvoices(), getProfile(), getAllAccounts()]);
    setInvoices(inv);
    setProfile(prof);
    setAccounts(accs);
    if (prof) applyProfileBankInfo(prof);
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
      id: editingInvoice?.id || crypto.randomUUID(),
      invoiceNumber: editingInvoice?.invoiceNumber || generateInvoiceNumber(),
      clientName,
      clientPostalCode,
      clientAddress,
      clientBuilding,
      issueDate,
      dueDate,
      items,
      subtotal,
      taxRate,
      taxAmount,
      total,
      taxBreakdown,
      status: editingInvoice?.status || "draft",
      notes,
      bankName,
      bankBranch,
      bankAccountType,
      bankAccountNumber,
      bankAccountName,
      createdAt: editingInvoice?.createdAt || now,
      updatedAt: now,
    };

    await putInvoice(invoice);
    toast.success(editingInvoice ? "下書き請求書を更新しました" : "請求書を作成しました");
    setDialogOpen(false);
    setEditingInvoice(null);
    resetForm();
    load();
  }

  function resetForm() {
    setClientName("");
    setClientPostalCode("");
    setClientAddress("");
    setClientBuilding("");
    setIssueDate(getToday());
    setDueDate("");
    setItems([emptyInvoiceItem()]);
    setTaxRate(10);
    setNotes("");
    if (profile) applyProfileBankInfo(profile);
  }

  function applyProfileBankInfo(prof: BusinessProfile) {
    setBankName(prof.bankName || "");
    setBankBranch(prof.bankBranch || "");
    setBankAccountType(prof.bankAccountType || "普通");
    setBankAccountNumber(prof.bankAccountNumber || "");
    setBankAccountName(prof.bankAccountName || "");
  }

  function handleEdit(invoice: Invoice) {
    if (invoice.status !== "draft") {
      toast.error("下書き以外の請求書は編集できません。");
      return;
    }
    setEditingInvoice(invoice);
    setClientName(invoice.clientName);
    setClientPostalCode(invoice.clientPostalCode || "");
    setClientAddress(invoice.clientAddress || "");
    setClientBuilding(invoice.clientBuilding || "");
    setIssueDate(invoice.issueDate);
    setDueDate(invoice.dueDate || "");
    setItems(invoice.items.map((item) => ({ ...item, taxRate: item.taxRate ?? invoice.taxRate })));
    setTaxRate(invoice.taxRate);
    setNotes(invoice.notes || "");
    setBankName(invoice.bankName || "");
    setBankBranch(invoice.bankBranch || "");
    setBankAccountType(invoice.bankAccountType || "普通");
    setBankAccountNumber(invoice.bankAccountNumber || "");
    setBankAccountName(invoice.bankAccountName || "");
    setDialogOpen(true);
  }

  async function handlePostInvoice(invoice: Invoice) {
    try {
      await postInvoiceToLedger(invoice.id);
      toast.success("請求売上を仕訳帳へ登録しました");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "請求売上を登録できませんでした");
    }
  }

  function openPaymentDialog(invoice: Invoice) {
    const received = (invoice.payments || []).reduce((sum, payment) => sum + payment.amount, 0);
    const preferredAccount = accounts.find((account) => account.category === "asset" && account.code === "102")
      || accounts.find((account) => account.category === "asset" && account.code !== "108");
    setPaymentInvoice(invoice);
    setPaymentRequestId(crypto.randomUUID());
    setPaymentDate(getToday());
    setPaymentAmount(String(invoice.total - received));
    setPaymentAccountId(preferredAccount?.id || "");
    setPaymentMemo("");
  }

  async function handleRecordPayment() {
    if (!paymentInvoice) return;
    const amount = Number(paymentAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !paymentAccountId) {
      toast.error("入金額と入金先口座を正しく入力してください");
      return;
    }
    try {
      setSavingPayment(true);
      await recordInvoicePayment(paymentInvoice.id, { requestId: paymentRequestId, date: paymentDate, amount, depositAccountId: paymentAccountId, memo: paymentMemo.trim() || undefined });
      toast.success("入金を仕訳帳へ記録しました");
      setPaymentInvoice(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "入金を記録できませんでした");
    } finally {
      setSavingPayment(false);
    }
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
    if (!previewingInvoice || !previewFrameRef.current) return;
    downloadInvoicePDF(previewFrameRef.current, previewingInvoice)
      .then(() => toast.success("PDFファイルを保存しました"))
      .catch((error) => toast.error(error instanceof Error ? error.message : "PDFの保存に失敗しました。"));
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
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditingInvoice(null); }}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={() => { setEditingInvoice(null); resetForm(); }}>
              <Plus className="h-4 w-4 mr-1" />
              新規作成
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingInvoice ? "下書き請求書を編集" : "請求書を作成"}</DialogTitle>
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
                  <Label className="text-[12px] font-semibold">郵便番号</Label>
                  <Input value={clientPostalCode} onChange={(e) => setClientPostalCode(e.target.value)} className="mt-1 text-[13px] font-mono" placeholder="123-4567" inputMode="numeric" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-[12px] font-semibold">住所</Label>
                  <Input
                    value={clientAddress}
                    onChange={(e) => setClientAddress(e.target.value)}
                    className="mt-1 text-[13px]"
                  />
                </div>
                <div>
                  <Label className="text-[12px] font-semibold">建物名・部屋番号</Label>
                  <Input value={clientBuilding} onChange={(e) => setClientBuilding(e.target.value)} className="mt-1 text-[13px]" placeholder="○○マンション 101" />
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
              <div className="space-y-2 rounded-md border p-3">
                <Label className="text-[12px] font-semibold">振込先情報</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-[11px] text-muted-foreground">銀行名</Label><Input value={bankName} onChange={(e) => setBankName(e.target.value)} className="mt-1 text-[13px]" placeholder="○○銀行" /></div>
                  <div><Label className="text-[11px] text-muted-foreground">支店名</Label><Input value={bankBranch} onChange={(e) => setBankBranch(e.target.value)} className="mt-1 text-[13px]" placeholder="○○支店" /></div>
                  <div><Label className="text-[11px] text-muted-foreground">口座種別</Label><Select value={bankAccountType} onValueChange={setBankAccountType}><SelectTrigger className="mt-1 text-[13px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="普通">普通</SelectItem><SelectItem value="当座">当座</SelectItem><SelectItem value="貯蓄">貯蓄</SelectItem></SelectContent></Select></div>
                  <div><Label className="text-[11px] text-muted-foreground">口座番号</Label><Input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} className="mt-1 text-[13px] font-mono" placeholder="1234567" inputMode="numeric" /></div>
                </div>
                <div><Label className="text-[11px] text-muted-foreground">口座名義</Label><Input value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} className="mt-1 text-[13px]" placeholder="ヤマダ タロウ" /></div>
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
                <Button onClick={handleSave}>{editingInvoice ? "更新" : "作成"}</Button>
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
          {invoices.map((inv) => {
            const received = (inv.payments || []).reduce((sum, payment) => sum + payment.amount, 0);
            const outstanding = Math.max(0, inv.total - received);
            const unreconciledLegacyPaid = inv.status === "paid" && received < inv.total;
            return <Card key={inv.id} className="border shadow-sm">
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
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold shrink-0 ${unreconciledLegacyPaid ? "text-amber-700 bg-amber-50" : INVOICE_STATUS_COLORS[inv.status]}`}
                    >
                      {unreconciledLegacyPaid ? "入金記録が未登録" : INVOICE_STATUS_LABELS[inv.status]}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="text-[15px] font-mono font-bold">{formatYen(inv.total)}</div>
                      <div className="text-[11px] text-muted-foreground">{inv.issueDate}</div>
                      {inv.status !== "draft" && <div className="text-[11px] text-muted-foreground">入金 {formatYen(received)} / 残額 {formatYen(outstanding)}</div>}
                    </div>
                    <div className="flex gap-1">
                      {inv.status === "draft" && <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => handlePostInvoice(inv)}>送付済にする・売上記帳</Button>}
                      {inv.status !== "draft" && !inv.issueJournalId && <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => handlePostInvoice(inv)}>請求売上を帳簿へ登録</Button>}
                      {inv.issueJournalId && outstanding > 0 && <Button size="sm" className="h-8 text-[12px]" onClick={() => openPaymentDialog(inv)}>入金を記録</Button>}

                      {/* PDF / Preview dropdown */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {inv.status === "draft" && (
                            <DropdownMenuItem onClick={() => handleEdit(inv)}>
                              <Pencil className="h-3.5 w-3.5 mr-2" />
                              下書きを編集
                            </DropdownMenuItem>
                          )}
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
                            disabled={inv.status !== "draft" || !!inv.issueJournalId || (inv.payments?.length || 0) > 0}
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
                {(inv.payments?.length || 0) > 0 && <div className="mt-3 border-t pt-2 space-y-1">
                  <div className="text-[11px] font-semibold text-muted-foreground">入金履歴</div>
                  {inv.payments!.map((payment) => <div key={payment.id} className="flex justify-between gap-3 text-[12px]">
                    <span>{payment.date} · {accounts.find((account) => account.id === payment.depositAccountId)?.name || "入金口座"}{payment.memo ? ` · ${payment.memo}` : ""}</span>
                    <span className="font-mono font-semibold">{formatYen(payment.amount)}</span>
                  </div>)}
                </div>}
                {inv.status === "paid" && received === 0 && <p className="mt-2 text-[11px] text-amber-700">以前の状態変更では実際の入金日・口座が記録されていません。過去の情報は推測で補いません。帳簿登録前に、売上が仕訳帳へ手入力済みでないか確認してください。未登録の場合は「請求売上を帳簿へ登録」後、実際の入金日・口座を記録してください。</p>}
              </CardContent>
            </Card>
          })}
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
            <p className="text-xs text-muted-foreground">請求書をPDFファイルとして直接保存します。</p>
            <Button onClick={handlePrintPDF} className="shrink-0">
              <Download className="h-4 w-4 mr-1.5" />
              PDF保存・印刷
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!paymentInvoice} onOpenChange={(open) => !open && setPaymentInvoice(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>請求書の入金を記録</DialogTitle>
          </DialogHeader>
          {paymentInvoice && <div className="space-y-4">
            <div className="rounded-md bg-muted/40 p-3 text-[13px]">
              <div className="font-semibold">{paymentInvoice.invoiceNumber} · {paymentInvoice.clientName}</div>
              <div className="mt-1 text-muted-foreground">請求額 {formatYen(paymentInvoice.total)} / 入金後残額 {formatYen(Math.max(0, paymentInvoice.total - (paymentInvoice.payments || []).reduce((sum, payment) => sum + payment.amount, 0) - (Number(paymentAmount) || 0)))}</div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment-date">入金日</Label>
              <Input id="payment-date" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment-amount">今回の入金額（税込・円）</Label>
              <Input id="payment-amount" type="number" min="1" step="1" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>入金先口座</Label>
              <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
                <SelectTrigger><SelectValue placeholder="口座を選択" /></SelectTrigger>
                <SelectContent>
                  {accounts.filter((account) => account.category === "asset" && account.code !== "108").map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment-memo">メモ（任意）</Label>
              <Input id="payment-memo" value={paymentMemo} onChange={(event) => setPaymentMemo(event.target.value)} placeholder="振込名義、手数料など" maxLength={500} />
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">入金仕訳（選択口座／売掛金）も同時に保存します。複数回の分割入金に対応し、請求額を超える金額は登録できません。</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPaymentInvoice(null)} disabled={savingPayment}>キャンセル</Button>
              <Button onClick={handleRecordPayment} disabled={savingPayment}>{savingPayment ? "保存中…" : "入金を保存"}</Button>
            </div>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
