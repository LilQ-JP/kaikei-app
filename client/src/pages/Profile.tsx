/**
 * Profile — 事業者情報設定ページ
 * macOS Ledger Design
 *
 * ロゴアップロード機能付き。
 * ロゴはBase64でIndexedDBに保存し、請求書PDFに反映される。
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
import { Save, User, Upload, X, Image } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";

export default function Profile() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [businessName, setBusinessName] = useState("");
  const [representativeName, setRepresentativeName] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [building, setBuilding] = useState("");
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
  const [logoData, setLogoData] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      const p = await getProfile();
      if (p) {
        setBusinessName(p.businessName || "");
        setRepresentativeName(p.ownerName || "");
        setPostalCode(p.postalCode || "");
        // 旧版の一括住所は、編集時に失われないよう住所欄へ引き継ぐ。
        setAddressLine(p.addressLine || p.address || "");
        setBuilding(p.building || "");
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
        setLogoData(p.logoData || "");
      }
      setLoading(false);
    }
    load();
  }, []);

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("画像ファイルを選択してください");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error("ファイルサイズは2MB以下にしてください");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setLogoData(reader.result as string);
      toast.success("ロゴを読み込みました（保存ボタンで確定）");
    };
    reader.readAsDataURL(file);

    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSave() {
    setSaving(true);
    try {
      const profile: BusinessProfile = {
        id: "default",
        businessName,
        ownerName: representativeName,
        // 税務帳票など既存の address 参照先との互換性を維持する。
        address: [postalCode ? `〒${postalCode}` : "", addressLine, building].filter(Boolean).join(" "),
        postalCode,
        addressLine,
        building,
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
        logoData,
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
        {/* Logo */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px] font-bold flex items-center gap-2">
              <Image className="h-4 w-4" />
              ロゴ
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[11px] text-muted-foreground mb-3">
              請求書PDFに表示されるロゴ画像を設定できます（PNG/JPG、2MB以下）
            </p>
            <div className="flex items-center gap-4">
              {logoData ? (
                <div className="relative group">
                  <div className="h-16 w-32 border rounded-lg overflow-hidden bg-white dark:bg-muted/30 flex items-center justify-center p-2">
                    <img
                      src={logoData}
                      alt="ロゴ"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <button
                    onClick={() => setLogoData("")}
                    className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="h-16 w-32 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                >
                  <Upload className="h-4 w-4 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">ロゴをアップロード</span>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-[12px]"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3 w-3 mr-1" />
                  {logoData ? "変更" : "選択"}
                </Button>
                {logoData && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[12px] text-destructive hover:text-destructive"
                    onClick={() => setLogoData("")}
                  >
                    <X className="h-3 w-3 mr-1" />
                    削除
                  </Button>
                )}
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
              className="hidden"
            />
          </CardContent>
        </Card>

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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label className="text-[12px] font-semibold">郵便番号</Label>
                <Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} className="mt-1 text-[13px] font-mono" placeholder="123-4567" inputMode="numeric" />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-[12px] font-semibold">住所</Label>
                <Input value={addressLine} onChange={(e) => setAddressLine(e.target.value)} className="mt-1 text-[13px]" placeholder="東京都渋谷区..." />
              </div>
            </div>
            <div>
              <Label className="text-[12px] font-semibold">建物名・部屋番号</Label>
              <Input value={building} onChange={(e) => setBuilding(e.target.value)} className="mt-1 text-[13px]" placeholder="○○マンション 101" />
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
