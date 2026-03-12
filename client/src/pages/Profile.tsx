/**
 * Profile — 事業者情報設定ページ
 * macOS Ledger Design
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
import { getProfile, putProfile, type BusinessProfile } from "@/lib/db";
import { Save, User } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function Profile() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [businessName, setBusinessName] = useState("");
  const [representativeName, setRepresentativeName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [taxId, setTaxId] = useState("");
  const [taxFilingType, setTaxFilingType] = useState<"blue" | "white">("blue");
  const [fiscalYearStart, setFiscalYearStart] = useState("01-01");
  const [bankName, setBankName] = useState("");
  const [bankBranch, setBankBranch] = useState("");
  const [bankAccountType, setBankAccountType] = useState("普通");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");

  useEffect(() => {
    async function load() {
      const p = await getProfile();
      if (p) {
        setBusinessName(p.businessName || "");
        setRepresentativeName(p.ownerName || "");
        setAddress(p.address || "");
        setPhone(p.phone || "");
        setEmail(p.email || "");
        setTaxId(p.taxId || "");
        setTaxFilingType(p.taxFilingType || "blue");
        setFiscalYearStart(p.fiscalYearStart === 4 ? "04-01" : "01-01");
        setBankName(p.bankName || "");
        setBankBranch(p.bankBranch || "");
        setBankAccountType(p.bankAccountType || "普通");
        setBankAccountNumber(p.bankAccountNumber || "");
        setBankAccountName(p.bankAccountName || "");
      }
      setLoading(false);
    }
    load();
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const profile: BusinessProfile = {
        id: "default",
        businessName,
        ownerName: representativeName,
        address,
        phone,
        email,
        taxId,
        taxFilingType,
        fiscalYearStart: fiscalYearStart === "04-01" ? 4 : 1,
        bankName,
        bankBranch,
        bankAccountType,
        bankAccountNumber,
        bankAccountName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await putProfile(profile);
      toast.success("事業者情報を保存しました");
    } catch {
      toast.error("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center"><div className="text-sm text-muted-foreground">読み込み中...</div></div>;
  }

  return (
    <div className="p-4 lg:p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">事業者情報</h1>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-1" />
          {saving ? "保存中..." : "保存"}
        </Button>
      </div>

      <div className="space-y-4">
        {/* Basic info */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px] font-bold flex items-center gap-2">
              <User className="h-4 w-4" />
              基本情報
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-[12px] font-semibold">屋号・事業名</Label>
                <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="mt-1 text-[13px]" placeholder="〇〇デザイン事務所" />
              </div>
              <div>
                <Label className="text-[12px] font-semibold">代表者名</Label>
                <Input value={representativeName} onChange={(e) => setRepresentativeName(e.target.value)} className="mt-1 text-[13px]" placeholder="山田 太郎" />
              </div>
            </div>
            <div>
              <Label className="text-[12px] font-semibold">住所</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} className="mt-1 text-[13px]" placeholder="東京都渋谷区..." />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-[12px] font-semibold">電話番号</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 text-[13px] font-mono" placeholder="03-1234-5678" />
              </div>
              <div>
                <Label className="text-[12px] font-semibold">メールアドレス</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 text-[13px]" placeholder="info@example.com" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tax info */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px] font-bold">税務情報</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-[12px] font-semibold">インボイス登録番号</Label>
                <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} className="mt-1 text-[13px] font-mono" placeholder="T1234567890123" />
              </div>
              <div>
                <Label className="text-[12px] font-semibold">申告種別</Label>
                <Select value={taxFilingType} onValueChange={(v) => setTaxFilingType(v as "blue" | "white")}>
                  <SelectTrigger className="mt-1 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blue">青色申告</SelectItem>
                    <SelectItem value="white">白色申告</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-[12px] font-semibold">会計期間開始日</Label>
              <Select value={fiscalYearStart} onValueChange={setFiscalYearStart}>
                <SelectTrigger className="mt-1 text-[13px] max-w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="01-01">1月1日</SelectItem>
                  <SelectItem value="04-01">4月1日</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Bank info */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px] font-bold">振込先情報</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-[12px] font-semibold">銀行名</Label>
                <Input value={bankName} onChange={(e) => setBankName(e.target.value)} className="mt-1 text-[13px]" placeholder="〇〇銀行" />
              </div>
              <div>
                <Label className="text-[12px] font-semibold">支店名</Label>
                <Input value={bankBranch} onChange={(e) => setBankBranch(e.target.value)} className="mt-1 text-[13px]" placeholder="〇〇支店" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="text-[12px] font-semibold">口座種別</Label>
                <Select value={bankAccountType} onValueChange={setBankAccountType}>
                  <SelectTrigger className="mt-1 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="普通">普通</SelectItem>
                    <SelectItem value="当座">当座</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[12px] font-semibold">口座番号</Label>
                <Input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} className="mt-1 text-[13px] font-mono" placeholder="1234567" />
              </div>
              <div>
                <Label className="text-[12px] font-semibold">口座名義</Label>
                <Input value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} className="mt-1 text-[13px]" placeholder="ヤマダ タロウ" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              ここで設定した振込先情報は請求書に自動で反映されます
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Bottom save */}
      <div className="mt-6 flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-1" />
          {saving ? "保存中..." : "保存"}
        </Button>
      </div>
    </div>
  );
}
