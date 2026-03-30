/**
 * Receipt AI — レシートAI自動判定エンジン
 * macOS Ledger Design — フリーランス会計
 *
 * レシートの店名・金額・日付・カテゴリをテキストから推定し、
 * 適切な勘定科目を自動提案する。
 *
 * ※ ブラウザ内完結（外部API不要）
 * ファイル名やユーザー入力のメモから推定する仕組み。
 */

import { type AccountItem } from "./db";

export interface ReceiptAnalysis {
  storeName: string;
  amount: number | null;
  date: string | null;
  suggestedDebitAccountId: string | null;
  suggestedDebitAccountName: string;
  suggestedCreditAccountId: string | null;
  suggestedCreditAccountName: string;
  confidence: number;
  reason: string;
  category: string;
}

interface StoreRule {
  patterns: string[];
  category: string;
  debitCode: string;
  creditCode?: string;
}

const STORE_RULES: StoreRule[] = [
  // コンビニ・スーパー
  { patterns: ["セブンイレブン", "7-eleven", "ファミリーマート", "ファミマ", "ローソン", "lawson", "ミニストップ", "デイリーヤマザキ"], category: "消耗品費", debitCode: "528" },
  { patterns: ["イオン", "aeon", "イトーヨーカドー", "西友", "seiyu", "ライフ", "マルエツ", "サミット", "オーケー", "業務スーパー", "コストコ", "costco"], category: "消耗品費", debitCode: "528" },

  // 飲食店
  { patterns: ["スターバックス", "starbucks", "スタバ", "タリーズ", "tully", "ドトール", "doutor", "コメダ", "サンマルク"], category: "会議費", debitCode: "552" },
  { patterns: ["マクドナルド", "mcdonald", "マック", "吉野家", "松屋", "すき家", "CoCo壱", "ココイチ", "丸亀", "サイゼリヤ", "ガスト", "デニーズ", "ジョナサン", "ロイヤルホスト"], category: "会議費", debitCode: "552" },
  { patterns: ["居酒屋", "焼肉", "寿司", "鳥貴族", "串カツ", "和民", "魚民", "笑笑"], category: "接待交際費", debitCode: "522" },

  // 交通
  { patterns: ["JR", "東京メトロ", "metro", "都営", "小田急", "京王", "東急", "西武", "東武", "京急", "相鉄", "Suica", "PASMO", "ICOCA"], category: "旅費交通費", debitCode: "516" },
  { patterns: ["タクシー", "uber", "didi", "GO タクシー", "Japan Taxi"], category: "旅費交通費", debitCode: "516" },
  { patterns: ["ガソリン", "ENEOS", "エネオス", "出光", "シェル", "コスモ石油", "ETC", "高速", "駐車場", "パーキング", "パークン", "リパーク", "タイムズ", "三井のリパーク"], category: "旅費交通費", debitCode: "516" },

  // 通信・IT
  { patterns: ["ドコモ", "docomo", "au", "KDDI", "ソフトバンク", "softbank", "楽天モバイル", "UQ", "ワイモバイル", "Y!mobile", "LINEMO"], category: "通信費", debitCode: "518" },
  { patterns: ["Google", "GOOGLE", "Apple", "APPLE", "Microsoft", "Amazon Web", "AWS", "Vercel", "GitHub", "Notion", "Slack", "Zoom", "Adobe", "Figma", "ChatGPT", "OpenAI", "Claude", "CLAUDE", "Anthropic", "X CORP", "TWITTER"], category: "通信費", debitCode: "518" },
  { patterns: ["GOOGLE WORKSPACE", "Google Cloud", "iCloud"], category: "通信費", debitCode: "518" },

  // オフィス用品
  { patterns: ["無印良品", "MUJI", "ダイソー", "セリア", "キャンドゥ", "100均"], category: "消耗品費", debitCode: "528" },
  { patterns: ["ヨドバシ", "yodobashi", "ビックカメラ", "bic camera", "ケーズデンキ", "エディオン", "ヤマダ電機", "ノジマ"], category: "消耗品費", debitCode: "528" },
  { patterns: ["Amazon", "amazon", "アマゾン", "楽天市場", "Yahoo!ショッピング", "メルカリ"], category: "消耗品費", debitCode: "528" },

  // 家具・インテリア
  { patterns: ["ニトリ", "NITORI", "IKEA", "イケア", "フランフラン", "Francfranc"], category: "消耗品費", debitCode: "528" },

  // 書籍
  { patterns: ["紀伊國屋", "丸善", "ジュンク堂", "TSUTAYA", "蔦屋", "ブックオフ", "Kindle", "書店", "本屋"], category: "新聞図書費", debitCode: "546" },

  // 宅配
  { patterns: ["ヤマト", "佐川", "日本郵便", "ゆうパック", "クロネコ", "レターパック", "クリックポスト"], category: "荷造運賃", debitCode: "512" },

  // 保険
  { patterns: ["保険", "損保", "生命保険", "火災保険"], category: "損害保険料", debitCode: "524" },

  // 医療
  { patterns: ["病院", "クリニック", "薬局", "調剤", "歯科", "歯医者"], category: "福利厚生費", debitCode: "532" },

  // 手数料
  { patterns: ["手数料", "振込手数料", "ATM", "PayPal", "Stripe", "Square", "スクエア", "Color", "MOONSHOT"], category: "支払手数料", debitCode: "548" },

  // サブスク
  { patterns: ["Netflix", "Spotify", "YouTube Premium", "Disney+", "Hulu", "U-NEXT", "dTV"], category: "通信費", debitCode: "518" },

  // 研修
  { patterns: ["Udemy", "Coursera", "セミナー", "研修", "講座", "スクール"], category: "研修費", debitCode: "554" },
];

/**
 * ファイル名やメモからレシートの内容を分析して勘定科目を推定
 */
export function analyzeReceipt(
  fileName: string,
  memo: string,
  accounts: AccountItem[]
): ReceiptAnalysis {
  const text = `${fileName} ${memo}`.toLowerCase();

  // 金額の抽出を試みる（ファイル名やメモに含まれている場合）
  const amountMatch = text.match(/(\d{1,3}(?:,\d{3})*|\d+)(?:\s*円|\s*yen)?/);
  const amount = amountMatch
    ? parseInt(amountMatch[1].replace(/,/g, ""), 10)
    : null;

  // 日付の抽出を試みる
  const dateMatch = text.match(
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})|(\d{1,2})[\/\-](\d{1,2})/
  );
  let date: string | null = null;
  if (dateMatch) {
    if (dateMatch[1]) {
      date = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
    } else if (dateMatch[4]) {
      const year = new Date().getFullYear();
      date = `${year}-${dateMatch[4].padStart(2, "0")}-${dateMatch[5].padStart(2, "0")}`;
    }
  }

  // 店名・カテゴリの推定
  let bestRule: StoreRule | null = null;
  let bestScore = 0;
  let matchedPattern = "";

  for (const rule of STORE_RULES) {
    for (const pattern of rule.patterns) {
      if (text.includes(pattern.toLowerCase())) {
        const score = pattern.length;
        if (score > bestScore) {
          bestScore = score;
          bestRule = rule;
          matchedPattern = pattern;
        }
      }
    }
  }

  if (bestRule) {
    const debitAccount = accounts.find((a) => a.code === bestRule!.debitCode);
    const creditAccount = accounts.find((a) => a.code === (bestRule!.creditCode || "102"));

    return {
      storeName: matchedPattern,
      amount,
      date,
      suggestedDebitAccountId: debitAccount?.id || null,
      suggestedDebitAccountName: debitAccount?.name || bestRule.category,
      suggestedCreditAccountId: creditAccount?.id || null,
      suggestedCreditAccountName: creditAccount?.name || "普通預金",
      confidence: Math.min(85, 50 + bestScore * 2),
      reason: `「${matchedPattern}」を検出 → ${bestRule.category}と推定`,
      category: bestRule.category,
    };
  }

  // マッチしなかった場合のデフォルト
  return {
    storeName: "",
    amount,
    date,
    suggestedDebitAccountId: null,
    suggestedDebitAccountName: "不明",
    suggestedCreditAccountId: null,
    suggestedCreditAccountName: "",
    confidence: 0,
    reason: "自動判定できませんでした。摘要を入力してAI仕訳をお試しください。",
    category: "不明",
  };
}

/**
 * 信頼度ラベル
 */
export function getReceiptConfidenceLabel(confidence: number): {
  label: string;
  color: string;
} {
  if (confidence >= 70) return { label: "高", color: "text-green-600 bg-green-50 dark:bg-green-950/30" };
  if (confidence >= 40) return { label: "中", color: "text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30" };
  if (confidence > 0) return { label: "低", color: "text-orange-600 bg-orange-50 dark:bg-orange-950/30" };
  return { label: "—", color: "text-muted-foreground bg-muted/30" };
}
