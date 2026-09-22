/**
 * Invoice PDF Generator
 * macOS Ledger Design — フリーランス会計
 *
 * ブラウザ内で請求書HTMLを生成し、A4 1ページのPDFとして保存する。
 */

import { type Invoice, type BusinessProfile } from "./db";
import { formatYen } from "./utils";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * プレビュー用の自己完結した請求書ドキュメントを生成する。
 * iframe の srcDoc に渡すため、外部通信やポップアップを必要としない。
 */
export function generateInvoiceHTML(invoice: Invoice, profile?: BusinessProfile): string {
  const taxBreakdown = invoice.taxBreakdown?.length ? invoice.taxBreakdown : [{ taxRate: invoice.taxRate, taxableAmount: invoice.subtotal, taxAmount: invoice.taxAmount }];
  const itemRows = invoice.items
    .map(
      (item, i) => `
    <tr>
      <td style="padding:7px 10px;border-bottom:1px solid #e5e5e5;font-size:12px;">${i + 1}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #e5e5e5;font-size:12px;">${escapeHtml(item.description)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #e5e5e5;font-size:12px;text-align:right;font-family:'JetBrains Mono',monospace;">${item.quantity}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #e5e5e5;font-size:12px;text-align:right;font-family:'JetBrains Mono',monospace;">${formatYen(item.unitPrice)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #e5e5e5;font-size:12px;text-align:right;font-weight:600;font-family:'JetBrains Mono',monospace;">${formatYen(item.amount)}</td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>請求書 ${escapeHtml(invoice.invoiceNumber)}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: 'Noto Sans JP', 'Hiragino Kaku Gothic Pro', 'メイリオ', sans-serif;
      color: #1d1d1f;
      background: #fff;
      font-weight: 500;
      -webkit-font-smoothing: antialiased;
    }
    @page {
      size: A4;
      margin: 15mm 15mm 20mm 15mm;
    }
    @media print {
      body { padding: 0; }
      .page { box-shadow: none; padding: 0; }
    }
    .page {
      max-width: 210mm;
      margin: 0 auto;
      padding: 28px;
    }
    .mono { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body>
  <div class="page">
    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:16px;">
        ${profile?.logoData ? `<img src="${profile.logoData}" style="max-height:48px;max-width:120px;object-fit:contain;" alt="Logo" />` : ""}
        <div>
          <h1 style="font-size:28px;font-weight:700;letter-spacing:-0.02em;color:#1d1d1f;">請求書</h1>
          <div style="margin-top:6px;font-size:12px;color:#86868b;">INVOICE</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:12px;color:#86868b;margin-bottom:4px;">請求書番号</div>
        <div style="font-size:14px;font-weight:600;" class="mono">${escapeHtml(invoice.invoiceNumber)}</div>
      </div>
    </div>

    <!-- Dates -->
    <div style="display:flex;gap:32px;margin-bottom:18px;">
      <div>
        <div style="font-size:11px;color:#86868b;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">発行日</div>
        <div style="font-size:13px;font-weight:600;">${formatDate(invoice.issueDate)}</div>
      </div>
      ${invoice.dueDate ? `
      <div>
        <div style="font-size:11px;color:#86868b;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">支払期限</div>
        <div style="font-size:13px;font-weight:600;">${formatDate(invoice.dueDate)}</div>
      </div>` : ""}
    </div>

    <!-- From / To -->
    <div style="display:flex;gap:32px;margin-bottom:20px;">
      <div style="flex:1;">
        <div style="font-size:11px;color:#86868b;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #1d1d1f;">請求先</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:4px;">${escapeHtml(invoice.clientName)} 御中</div>
        ${formatInvoiceAddress(invoice)}
      </div>
      <div style="flex:1;text-align:right;">
        <div style="font-size:11px;color:#86868b;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #1d1d1f;text-align:left;">発行者</div>
        ${profile?.businessName ? `<div style="font-size:15px;font-weight:700;margin-bottom:4px;text-align:left;">${escapeHtml(profile.businessName)}</div>` : ""}
        ${profile?.ownerName ? `<div style="font-size:12px;color:#6e6e73;text-align:left;">${escapeHtml(profile.ownerName)}</div>` : ""}
        ${profile?.address ? `<div style="font-size:12px;color:#6e6e73;text-align:left;">${escapeHtml(profile.address)}</div>` : ""}
        ${profile?.phone ? `<div style="font-size:12px;color:#6e6e73;text-align:left;">TEL: ${escapeHtml(profile.phone)}</div>` : ""}
        ${profile?.email ? `<div style="font-size:12px;color:#6e6e73;text-align:left;">${escapeHtml(profile.email)}</div>` : ""}
        ${profile?.taxId ? `<div style="font-size:11px;color:#86868b;margin-top:6px;text-align:left;">登録番号: ${escapeHtml(profile.taxId)}</div>` : ""}
      </div>
    </div>

    <!-- Total highlight -->
    <div style="background:#f5f5f7;border-radius:8px;padding:12px 16px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;">
      <div style="font-size:13px;font-weight:600;color:#6e6e73;">ご請求金額</div>
      <div style="font-size:24px;font-weight:700;letter-spacing:-0.02em;" class="mono">${formatYen(invoice.total)}</div>
    </div>

    <!-- Items table -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <thead>
        <tr style="background:#f5f5f7;">
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#86868b;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #d2d2d7;width:40px;">No.</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#86868b;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #d2d2d7;">品名・内容</th>
          <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:700;color:#86868b;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #d2d2d7;width:70px;">数量</th>
          <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:700;color:#86868b;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #d2d2d7;width:100px;">単価</th>
          <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:700;color:#86868b;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #d2d2d7;width:110px;">金額</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>

    <!-- Totals -->
    <div style="display:flex;justify-content:flex-end;margin-bottom:16px;">
      <div style="width:260px;">
        <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;">
          <span style="color:#6e6e73;">小計</span>
          <span class="mono" style="font-weight:600;">${formatYen(invoice.subtotal)}</span>
        </div>
        ${taxBreakdown.map((group) => `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;border-bottom:1px solid #e5e5e5;">
          <span style="color:#6e6e73;">消費税 (${group.taxRate}%)</span>
          <span class="mono" style="font-weight:600;">${formatYen(group.taxAmount)}</span>
        </div>`).join("")}
        <div style="display:flex;justify-content:space-between;padding:10px 0;font-size:16px;font-weight:700;">
          <span>合計</span>
          <span class="mono">${formatYen(invoice.total)}</span>
        </div>
      </div>
    </div>

    <!-- Bank info -->
    ${formatBankInfo(invoice) ? `
    <div style="background:#f5f5f7;border-radius:8px;padding:12px 16px;margin-bottom:12px;">
      <div style="font-size:11px;font-weight:700;color:#86868b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">振込先</div>
      ${formatBankInfo(invoice)}
    </div>` : ""}

    <!-- Notes -->
    ${invoice.notes ? `
    <div style="margin-bottom:16px;">
      <div style="font-size:11px;font-weight:700;color:#86868b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">備考</div>
      <div style="font-size:12px;color:#6e6e73;">${escapeHtml(invoice.notes)}</div>
    </div>` : ""}

    <!-- Footer -->
    <div style="margin-top:20px;padding-top:10px;border-top:1px solid #e5e5e5;text-align:center;">
      <div style="font-size:10px;color:#86868b;">この請求書はフリーランス会計で作成されました</div>
    </div>
  </div>
</body>
</html>`;
}

function formatInvoiceAddress(invoice: Invoice): string {
  const lines = [
    invoice.clientPostalCode ? `〒${invoice.clientPostalCode}` : "",
    invoice.clientAddress || "",
    invoice.clientBuilding || "",
  ].filter(Boolean);
  return lines.length ? `<div style="font-size:12px;color:#6e6e73;white-space:pre-line;">${lines.map(escapeHtml).join("<br />")}</div>` : "";
}

function formatBankInfo(invoice: Invoice): string {
  const fields = [
    ["銀行名", invoice.bankName],
    ["支店名", invoice.bankBranch],
    ["口座種別", invoice.bankAccountType],
    ["口座番号", invoice.bankAccountNumber],
    ["口座名義", invoice.bankAccountName],
  ].filter(([, value]) => Boolean(value));

  if (fields.length) {
    return `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 20px;">
      ${fields.map(([label, value], index) => `<div style="${index === fields.length - 1 && label === "口座名義" ? "grid-column:1 / -1;" : ""}">
        <div style="font-size:10px;color:#86868b;margin-bottom:2px;">${label}</div>
        <div style="font-size:12px;font-weight:600;word-break:break-all;">${escapeHtml(value || "")}</div>
      </div>`).join("")}
    </div>`;
  }

  return invoice.bankInfo
    ? `<div style="font-size:12px;font-weight:600;white-space:pre-line;word-break:break-all;">${escapeHtml(invoice.bankInfo)}</div>`
    : "";
}

/** Download a real PDF file, without relying on the browser print dialog. */
export async function downloadInvoicePDF(frame: HTMLIFrameElement, invoice: Invoice): Promise<void> {
  const page = frame.contentDocument?.querySelector<HTMLElement>(".page");
  if (!page) throw new Error("請求書プレビューを読み込めませんでした。");

  const canvas = await html2canvas(page, { backgroundColor: "#ffffff", scale: 2, useCORS: false, logging: false });
  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });
  const imageData = canvas.toDataURL("image/jpeg", 0.95);
  // A4の余白を確保しつつ、常に1ページへ縮小して保存する。
  // 多数明細でも2ページ目に切り取られず、全文を確認できる。
  const margin = 10;
  const usableWidth = 210 - margin * 2;
  const usableHeight = 297 - margin * 2;
  const sourceRatio = canvas.width / canvas.height;
  const targetRatio = usableWidth / usableHeight;
  const [width, height] = sourceRatio > targetRatio
    ? [usableWidth, usableWidth / sourceRatio]
    : [usableHeight * sourceRatio, usableHeight];
  pdf.addImage(imageData, "JPEG", margin + (usableWidth - width) / 2, margin + (usableHeight - height) / 2, width, height, undefined, "FAST");
  pdf.save(`${invoice.invoiceNumber}.pdf`);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
