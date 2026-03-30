/**
 * Vendors — 取引先マスタ管理ページ
 * macOS Ledger Design
 *
 * 取引先を登録・編集・削除できる。
 * デフォルトの勘定科目や決済手段も設定可能。
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  getAllVendors,
  putVendor,
  deleteVendor,
  getAllAccounts,
  type Vendor,
  type AccountItem,
} from "@/lib/db";
import { CATEGORY_LABELS } from "@/lib/utils";
import { Plus, Pencil, Trash2, Search, Building2, CreditCard, BookOpen } from "lucide-react";
import { useEffect, useState, useCallback, useMemo } from "react";
import { toast } from "sonner";

const PAYMENT_METHODS = [
  "現金",
  "普通預金",
  "楽天カード",
  "三井住友VISAカード",
  "JCBカード",
  "アメックス",
  "PayPay",
  "LINE Pay",
  "クレジットカード（その他）",
];

export default function Vendors() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [defaultDebitAccountId, setDefaultDebitAccountId] = useState("");
  const [defaultCreditAccountId, setDefaultCreditAccountId] = useState("");
  const [defaultPaymentMethod, setDefaultPaymentMethod] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    const [v, a] = await Promise.all([getAllVendors(), getAllAccounts()]);
    setVendors(v);
    setAccounts(a);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const accountMap = useMemo(() => {
    const map = new Map<string, AccountItem>();
    accounts.forEach((a) => map.set(a.id, a));
    return map;
  }, [accounts]);

  const grouped = useMemo(() => {
    const groups: Record<string, AccountItem[]> = {};
    accounts.forEach((a) => {
      const label = CATEGORY_LABELS[a.category] || a.category;
      if (!groups[label]) groups[label] = [];
      groups[label].push(a);
    });
    return groups;
  }, [accounts]);

  const filtered = useMemo(() => {
    if (!search) return vendors;
    const q = search.toLowerCase();
    return vendors.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (v.shortName && v.shortName.toLowerCase().includes(q)) ||
        (v.notes && v.notes.toLowerCase().includes(q))
    );
  }, [vendors, search]);

  function resetForm() {
    setName("");
    setShortName("");
    setAddress("");
    setPhone("");
    setEmail("");
    setDefaultDebitAccountId("");
    setDefaultCreditAccountId("");
    setDefaultPaymentMethod("");
    setNotes("");
    setEditingVendor(null);
  }

  function openNew() {
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(vendor: Vendor) {
    setEditingVendor(vendor);
    setName(vendor.name);
    setShortName(vendor.shortName || "");
    setAddress(vendor.address || "");
    setPhone(vendor.phone || "");
    setEmail(vendor.email || "");
    setDefaultDebitAccountId(vendor.defaultDebitAccountId || "");
    setDefaultCreditAccountId(vendor.defaultCreditAccountId || "");
    setDefaultPaymentMethod(vendor.defaultPaymentMethod || "");
    setNotes(vendor.notes || "");
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error("取引先名を入力してください");
      return;
    }

    const now = new Date().toISOString();
    const vendor: Vendor = {
      id: editingVendor?.id || crypto.randomUUID(),
      name: name.trim(),
      shortName: shortName.trim() || undefined,
      address: address.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      defaultDebitAccountId: defaultDebitAccountId || undefined,
      defaultCreditAccountId: defaultCreditAccountId || undefined,
      defaultPaymentMethod: defaultPaymentMethod || undefined,
      notes: notes.trim() || undefined,
      createdAt: editingVendor?.createdAt || now,
      updatedAt: now,
    };

    await putVendor(vendor);
    toast.success(editingVendor ? "取引先を更新しました" : "取引先を登録しました");
    setDialogOpen(false);
    resetForm();
    load();
  }

  async function handleDelete(id: string) {
    await deleteVendor(id);
    toast.success("取引先を削除しました");
    load();
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
        <h1 className="text-xl font-bold">取引先マスタ</h1>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" />
          新規登録
        </Button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="取引先名で検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 text-[13px]"
        />
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Building2 className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-[13px] text-muted-foreground">
                {vendors.length === 0 ? "取引先が登録されていません" : "検索結果がありません"}
              </p>
              {vendors.length === 0 && (
                <Button variant="outline" size="sm" className="mt-3" onClick={openNew}>
                  <Plus className="h-4 w-4 mr-1" />
                  最初の取引先を登録
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-2.5 text-left font-bold text-muted-foreground">取引先名</th>
                    <th className="px-4 py-2.5 text-left font-bold text-muted-foreground">略称</th>
                    <th className="px-4 py-2.5 text-left font-bold text-muted-foreground">
                      <BookOpen className="h-3.5 w-3.5 inline mr-1" />
                      デフォルト科目
                    </th>
                    <th className="px-4 py-2.5 text-left font-bold text-muted-foreground">
                      <CreditCard className="h-3.5 w-3.5 inline mr-1" />
                      決済手段
                    </th>
                    <th className="px-4 py-2.5 text-left font-bold text-muted-foreground">備考</th>
                    <th className="px-4 py-2.5 w-20"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((v) => {
                    const debit = v.defaultDebitAccountId ? accountMap.get(v.defaultDebitAccountId) : null;
                    const credit = v.defaultCreditAccountId ? accountMap.get(v.defaultCreditAccountId) : null;
                    return (
                      <tr key={v.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 font-semibold">{v.name}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{v.shortName || "—"}</td>
                        <td className="px-4 py-2.5">
                          {debit || credit ? (
                            <span className="text-[12px]">
                              {debit && <span className="text-blue-600 dark:text-blue-400 font-medium">{debit.name}</span>}
                              {debit && credit && <span className="text-muted-foreground mx-1">/</span>}
                              {credit && <span className="text-green-600 dark:text-green-400 font-medium">{credit.name}</span>}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/30">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {v.defaultPaymentMethod ? (
                            <span className="inline-flex items-center gap-1 text-[11px] bg-muted/50 dark:bg-muted/30 rounded-full px-2 py-0.5 font-medium">
                              <CreditCard className="h-3 w-3 text-muted-foreground" />
                              {v.defaultPaymentMethod}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/30">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[150px]">
                          {v.notes || "—"}
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
                              onClick={() => openEdit(v)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>取引先を削除</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    「{v.name}」を削除しますか？この操作は取り消せません。
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>キャンセル</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDelete(v.id)}>削除</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
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
        {filtered.length}件の取引先
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) resetForm(); setDialogOpen(open); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-bold">
              {editingVendor ? "取引先を編集" : "取引先を登録"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[12px] font-bold mb-1.5 block">取引先名 *</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例: 株式会社ABC"
                  className="text-[13px]"
                />
              </div>
              <div>
                <Label className="text-[12px] font-bold mb-1.5 block">略称</Label>
                <Input
                  value={shortName}
                  onChange={(e) => setShortName(e.target.value)}
                  placeholder="例: ABC"
                  className="text-[13px]"
                />
              </div>
            </div>

            <div>
              <Label className="text-[12px] font-bold mb-1.5 block">住所</Label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="例: 東京都渋谷区..."
                className="text-[13px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[12px] font-bold mb-1.5 block">電話番号</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="03-1234-5678"
                  className="text-[13px]"
                />
              </div>
              <div>
                <Label className="text-[12px] font-bold mb-1.5 block">メール</Label>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="info@example.com"
                  className="text-[13px]"
                />
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="text-[12px] font-bold text-muted-foreground mb-3">仕訳デフォルト設定</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[12px] font-bold mb-1.5 block">借方科目</Label>
                  <Select value={defaultDebitAccountId} onValueChange={setDefaultDebitAccountId}>
                    <SelectTrigger className="text-[13px]">
                      <SelectValue placeholder="選択..." />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(grouped).map(([group, items]) => (
                        <div key={group}>
                          <div className="px-2 py-1 text-[11px] font-bold text-muted-foreground">{group}</div>
                          {items.map((a) => (
                            <SelectItem key={a.id} value={a.id} className="text-[13px]">
                              {a.name}
                            </SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[12px] font-bold mb-1.5 block">貸方科目</Label>
                  <Select value={defaultCreditAccountId} onValueChange={setDefaultCreditAccountId}>
                    <SelectTrigger className="text-[13px]">
                      <SelectValue placeholder="選択..." />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(grouped).map(([group, items]) => (
                        <div key={group}>
                          <div className="px-2 py-1 text-[11px] font-bold text-muted-foreground">{group}</div>
                          {items.map((a) => (
                            <SelectItem key={a.id} value={a.id} className="text-[13px]">
                              {a.name}
                            </SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div>
              <Label className="text-[12px] font-bold mb-1.5 block">デフォルト決済手段</Label>
              <Select value={defaultPaymentMethod} onValueChange={setDefaultPaymentMethod}>
                <SelectTrigger className="text-[13px]">
                  <SelectValue placeholder="選択..." />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m} className="text-[13px]">
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-[12px] font-bold mb-1.5 block">備考</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="メモ..."
                className="text-[13px] min-h-[60px]"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => { resetForm(); setDialogOpen(false); }}>
                キャンセル
              </Button>
              <Button size="sm" onClick={handleSave}>
                {editingVendor ? "更新" : "登録"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
