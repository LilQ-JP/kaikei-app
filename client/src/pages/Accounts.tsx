/**
 * Accounts — 勘定科目管理ページ
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
  getAllAccounts,
  putAccount,
  deleteAccount,
  type AccountItem,
} from "@/lib/db";
import { CATEGORY_LABELS } from "@/lib/utils";
import { Plus, Trash2, Pencil } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";

export default function Accounts() {
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<AccountItem["category"]>("asset");
  const [description, setDescription] = useState("");

  const load = useCallback(async () => {
    const a = await getAllAccounts();
    setAccounts(a.sort((x, y) => x.code.localeCompare(y.code)));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openEdit(acc: AccountItem) {
    setEditingId(acc.id);
    setCode(acc.code);
    setName(acc.name);
    setCategory(acc.category);
    setDescription(acc.description || "");
    setDialogOpen(true);
  }

  function openNew() {
    setEditingId(null);
    setCode("");
    setName("");
    setCategory("expense");
    setDescription("");
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!code || !name) {
      toast.error("コードと科目名は必須です");
      return;
    }
    // Check duplicate code
    const existing = accounts.find((a) => a.code === code && a.id !== editingId);
    if (existing) {
      toast.error("このコードは既に使用されています");
      return;
    }

    const now = new Date().toISOString();
    const acc: AccountItem = {
      id: editingId || crypto.randomUUID(),
      code,
      name,
      category,
      subcategory: "",
      description: description || undefined,
      isDefault: false,
      createdAt: editingId ? accounts.find((a) => a.id === editingId)?.createdAt || now : now,
    };

    await putAccount(acc);
    toast.success(editingId ? "勘定科目を更新しました" : "勘定科目を追加しました");
    setDialogOpen(false);
    load();
  }

  async function handleDelete(id: string) {
    const acc = accounts.find((a) => a.id === id);
    if (acc?.isDefault) {
      toast.error("デフォルト科目は削除できません");
      return;
    }
    await deleteAccount(id);
    toast.success("勘定科目を削除しました");
    load();
  }

  const grouped = accounts.reduce<Record<string, AccountItem[]>>((acc, item) => {
    const label = CATEGORY_LABELS[item.category] || item.category;
    if (!acc[label]) acc[label] = [];
    acc[label].push(item);
    return acc;
  }, {});

  if (loading) {
    return <div className="flex h-full items-center justify-center"><div className="text-sm text-muted-foreground">読み込み中...</div></div>;
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">勘定科目</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openNew}>
              <Plus className="h-4 w-4 mr-1" />
              追加
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingId ? "勘定科目を編集" : "勘定科目を追加"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-[12px] font-semibold">コード *</Label>
                  <Input value={code} onChange={(e) => setCode(e.target.value)} className="mt-1 text-[13px] font-mono" placeholder="100" />
                </div>
                <div>
                  <Label className="text-[12px] font-semibold">区分 *</Label>
                  <Select value={category} onValueChange={(v) => setCategory(v as AccountItem["category"])}>
                    <SelectTrigger className="mt-1 text-[13px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asset">資産</SelectItem>
                      <SelectItem value="liability">負債</SelectItem>
                      <SelectItem value="equity">純資産</SelectItem>
                      <SelectItem value="income">収益</SelectItem>
                      <SelectItem value="expense">費用</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-[12px] font-semibold">科目名 *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 text-[13px]" placeholder="科目名" />
              </div>
              <div>
                <Label className="text-[12px] font-semibold">説明</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 text-[13px]" placeholder="任意の説明" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>キャンセル</Button>
                <Button onClick={handleSave}>{editingId ? "更新" : "追加"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-4">
        {Object.entries(grouped).map(([group, accs]) => (
          <Card key={group} className="border shadow-sm">
            <CardContent className="p-0">
              <div className="px-4 py-3 border-b bg-muted/30">
                <h2 className="text-[13px] font-bold">{group}</h2>
              </div>
              <div className="divide-y divide-border">
                {accs.map((acc) => (
                  <div key={acc.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/20 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="text-[12px] font-mono text-muted-foreground w-12">{acc.code}</span>
                      <div>
                        <span className="text-[13px] font-semibold">{acc.name}</span>
                        {acc.description && (
                          <span className="ml-2 text-[11px] text-muted-foreground">{acc.description}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {acc.isDefault && (
                        <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">デフォルト</span>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(acc)}>
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                      {!acc.isDefault && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>勘定科目を削除</AlertDialogTitle>
                              <AlertDialogDescription>「{acc.name}」を削除しますか？この科目を使用している仕訳がある場合、表示に影響が出ます。</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>キャンセル</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(acc.id)}>削除</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-3 text-[12px] text-muted-foreground">
        {accounts.length}件の勘定科目
      </div>
    </div>
  );
}
