/**
 * AI自動仕訳エンジン
 * macOS Ledger Design — フリーランス会計
 *
 * キーワードマッチング＋過去の仕訳パターン学習で
 * 摘要テキストから勘定科目を自動推定する。
 *
 * ルール:
 * 1. 過去の仕訳履歴から同じ摘要パターンを検索（最優先）
 * 2. キーワードルールベースで借方・貸方を推定
 * 3. 信頼度スコアを返す
 */

import { type AccountItem, type JournalEntry } from "./db";

export interface AISuggestion {
  debitAccountId: string;
  creditAccountId: string;
  debitAccountName: string;
  creditAccountName: string;
  confidence: number; // 0-100
  reason: string;
}

/** キーワード → 勘定科目コードのマッピングルール */
interface KeywordRule {
  keywords: string[];
  /** 借方の科目コード */
  debitCode: string;
  /** 貸方の科目コード（デフォルト: "102" 普通預金） */
  creditCode?: string;
  /** ルールの優先度（高いほど優先） */
  priority: number;
}

const KEYWORD_RULES: KeywordRule[] = [
  // 交通費
  { keywords: ["電車", "バス", "タクシー", "Suica", "PASMO", "定期", "交通", "JR", "新幹線", "飛行機", "航空", "ANA", "JAL"], debitCode: "516", priority: 10 },
  // 通信費
  { keywords: ["携帯", "スマホ", "電話", "インターネット", "Wi-Fi", "WiFi", "プロバイダ", "回線", "ドコモ", "au", "ソフトバンク", "楽天モバイル", "通信"], debitCode: "518", priority: 10 },
  // 地代家賃
  { keywords: ["家賃", "賃料", "オフィス", "事務所", "コワーキング", "レンタルオフィス", "駐車場"], debitCode: "540", priority: 10 },
  // 水道光熱費
  { keywords: ["電気", "ガス", "水道", "光熱", "東京電力", "関西電力", "東京ガス"], debitCode: "514", priority: 10 },
  // 消耗品費
  { keywords: ["文房具", "コピー用紙", "トナー", "インク", "USB", "ケーブル", "マウス", "キーボード", "100均", "ダイソー", "セリア", "消耗品", "事務用品"], debitCode: "528", priority: 8 },
  // 新聞図書費
  { keywords: ["書籍", "本", "雑誌", "新聞", "Kindle", "技術書", "参考書", "Amazon.*本", "図書"], debitCode: "546", priority: 9 },
  // 接待交際費
  { keywords: ["飲み会", "接待", "会食", "懇親会", "お中元", "お歳暮", "贈答", "ギフト", "手土産"], debitCode: "522", priority: 9 },
  // 会議費
  { keywords: ["会議", "ミーティング", "打ち合わせ", "カフェ.*打ち合わせ", "スタバ.*会議", "ランチミーティング", "コーヒー.*打ち合わせ"], debitCode: "552", priority: 9 },
  // 広告宣伝費
  { keywords: ["広告", "Google Ads", "Facebook広告", "Instagram広告", "Twitter広告", "リスティング", "SNS広告", "宣伝", "PR", "チラシ", "名刺"], debitCode: "520", priority: 10 },
  // 外注工賃
  { keywords: ["外注", "業務委託", "フリーランス", "デザイン依頼", "開発依頼", "ランサーズ", "クラウドワークス", "ココナラ"], debitCode: "536", priority: 10 },
  // 支払手数料
  { keywords: ["手数料", "振込手数料", "決済手数料", "PayPal", "Stripe", "カード手数料", "ATM"], debitCode: "548", priority: 9 },
  // 租税公課
  { keywords: ["税金", "印紙", "収入印紙", "固定資産税", "自動車税", "住民税", "事業税", "印鑑証明"], debitCode: "510", priority: 10 },
  // 損害保険料
  { keywords: ["保険", "損害保険", "火災保険", "賠償責任保険", "所得補償"], debitCode: "524", priority: 10 },
  // 荷造運賃
  { keywords: ["宅配", "送料", "配送", "ヤマト", "佐川", "郵便", "レターパック", "クリックポスト", "荷造"], debitCode: "512", priority: 10 },
  // 修繕費
  { keywords: ["修理", "修繕", "メンテナンス", "点検", "整備"], debitCode: "526", priority: 9 },
  // 福利厚生費
  { keywords: ["健康診断", "人間ドック", "福利厚生", "社員旅行"], debitCode: "532", priority: 9 },
  // 給料賃金
  { keywords: ["給料", "給与", "賃金", "アルバイト", "パート"], debitCode: "534", priority: 10 },
  // 研修費
  { keywords: ["研修", "セミナー", "勉強会", "講座", "スクール", "Udemy", "オンライン講座", "資格"], debitCode: "554", priority: 9 },
  // 車両費
  { keywords: ["ガソリン", "給油", "高速道路", "ETC", "車検", "オイル交換", "洗車"], debitCode: "550", priority: 10 },
  // 利子割引料
  { keywords: ["利息", "利子", "ローン利息", "借入利息"], debitCode: "538", priority: 10 },
  // 減価償却費
  { keywords: ["減価償却", "償却"], debitCode: "530", priority: 10 },

  // ── ソフトウェア・サブスク系（よくある経費） ──
  { keywords: ["AWS", "Azure", "GCP", "サーバー代", "ホスティング", "ドメイン", "SSL", "Vercel", "Heroku", "さくら", "エックスサーバー"], debitCode: "518", priority: 9 },
  { keywords: ["Adobe", "Figma", "Notion", "Slack", "Zoom", "Microsoft 365", "Office", "ChatGPT", "GitHub", "サブスク"], debitCode: "518", priority: 8 },

  // ── 売上系 ──
  { keywords: ["売上", "報酬", "受注", "納品", "請求", "入金", "振込入金", "クライアント.*入金"], debitCode: "102", creditCode: "400", priority: 10 },
  { keywords: ["利息.*入金", "受取利息"], debitCode: "102", creditCode: "404", priority: 10 },

  // ── 仕入系 ──
  { keywords: ["仕入", "材料", "原材料", "部品"], debitCode: "500", priority: 10 },

  // ── 事業主系 ──
  { keywords: ["個人.*引出", "プライベート", "生活費", "事業主貸"], debitCode: "170", creditCode: "102", priority: 10 },
  { keywords: ["個人.*入金", "自己資金", "事業主借", "立替.*戻"], debitCode: "102", creditCode: "270", priority: 10 },

  // ── PC・機器購入（金額で分岐するが、ここではデフォルト消耗品） ──
  { keywords: ["パソコン", "PC", "Mac", "MacBook", "iPad", "iPhone", "モニター", "ディスプレイ", "プリンター"], debitCode: "528", priority: 7 },
];

/**
 * 過去の仕訳履歴から類似パターンを検索
 */
function findHistoryMatch(
  description: string,
  journals: JournalEntry[],
  accounts: AccountItem[]
): AISuggestion | null {
  if (!description.trim() || journals.length === 0) return null;

  const desc = description.toLowerCase().trim();

  // 完全一致 → 部分一致 の順で検索
  const exactMatch = journals.find(
    (j) => j.description.toLowerCase().trim() === desc
  );
  if (exactMatch) {
    const debit = accounts.find((a) => a.id === exactMatch.debitAccountId);
    const credit = accounts.find((a) => a.id === exactMatch.creditAccountId);
    if (debit && credit) {
      return {
        debitAccountId: debit.id,
        creditAccountId: credit.id,
        debitAccountName: debit.name,
        creditAccountName: credit.name,
        confidence: 95,
        reason: `過去の仕訳「${exactMatch.description}」と一致`,
      };
    }
  }

  // 部分一致（摘要の先頭3文字以上が一致）
  const partialMatches = journals.filter((j) => {
    const jDesc = j.description.toLowerCase().trim();
    return (
      desc.length >= 3 &&
      (jDesc.includes(desc) || desc.includes(jDesc))
    );
  });

  if (partialMatches.length > 0) {
    // 最も頻出するパターンを選択
    const patternCount: Record<string, { count: number; entry: JournalEntry }> = {};
    for (const j of partialMatches) {
      const key = `${j.debitAccountId}:${j.creditAccountId}`;
      if (!patternCount[key]) patternCount[key] = { count: 0, entry: j };
      patternCount[key].count++;
    }

    const best = Object.values(patternCount).sort((a, b) => b.count - a.count)[0];
    if (best) {
      const debit = accounts.find((a) => a.id === best.entry.debitAccountId);
      const credit = accounts.find((a) => a.id === best.entry.creditAccountId);
      if (debit && credit) {
        return {
          debitAccountId: debit.id,
          creditAccountId: credit.id,
          debitAccountName: debit.name,
          creditAccountName: credit.name,
          confidence: Math.min(85, 60 + best.count * 5),
          reason: `過去の類似仕訳から推定（${best.count}件の履歴）`,
        };
      }
    }
  }

  return null;
}

/**
 * キーワードルールベースで勘定科目を推定
 */
function findKeywordMatch(
  description: string,
  accounts: AccountItem[]
): AISuggestion | null {
  if (!description.trim()) return null;

  const desc = description.toLowerCase();

  let bestRule: KeywordRule | null = null;
  let bestScore = 0;
  let matchedKeyword = "";

  for (const rule of KEYWORD_RULES) {
    for (const kw of rule.keywords) {
      const kwLower = kw.toLowerCase();
      // 正規表現パターン対応
      try {
        const regex = new RegExp(kwLower, "i");
        if (regex.test(desc)) {
          const score = rule.priority * 10 + kw.length;
          if (score > bestScore) {
            bestScore = score;
            bestRule = rule;
            matchedKeyword = kw;
          }
        }
      } catch {
        // 正規表現として無効な場合は単純な部分一致
        if (desc.includes(kwLower)) {
          const score = rule.priority * 10 + kw.length;
          if (score > bestScore) {
            bestScore = score;
            bestRule = rule;
            matchedKeyword = kw;
          }
        }
      }
    }
  }

  if (!bestRule) return null;

  const debitAccount = accounts.find((a) => a.code === bestRule!.debitCode);
  const creditCode = bestRule.creditCode || "102"; // デフォルト: 普通預金
  const creditAccount = accounts.find((a) => a.code === creditCode);

  if (!debitAccount || !creditAccount) return null;

  return {
    debitAccountId: debitAccount.id,
    creditAccountId: creditAccount.id,
    debitAccountName: debitAccount.name,
    creditAccountName: creditAccount.name,
    confidence: Math.min(80, bestRule.priority * 8),
    reason: `キーワード「${matchedKeyword}」から推定`,
  };
}

/**
 * AI自動仕訳メイン関数
 * 摘要テキストから借方・貸方の勘定科目を推定する
 */
export function suggestJournalAccounts(
  description: string,
  accounts: AccountItem[],
  pastJournals: JournalEntry[]
): AISuggestion | null {
  if (!description.trim()) return null;

  // 1. 過去の仕訳履歴から検索（最優先）
  const historyMatch = findHistoryMatch(description, pastJournals, accounts);
  if (historyMatch && historyMatch.confidence >= 70) {
    return historyMatch;
  }

  // 2. キーワードルールベースで検索
  const keywordMatch = findKeywordMatch(description, accounts);
  if (keywordMatch) {
    // 履歴マッチも低信頼度であった場合、信頼度を少し上げる
    if (historyMatch) {
      return {
        ...keywordMatch,
        confidence: Math.min(90, keywordMatch.confidence + 10),
        reason: `${keywordMatch.reason}（履歴でも確認）`,
      };
    }
    return keywordMatch;
  }

  // 3. 低信頼度の履歴マッチがあればそれを返す
  if (historyMatch) {
    return historyMatch;
  }

  return null;
}

/**
 * 信頼度に応じたラベルを返す
 */
export function getConfidenceLabel(confidence: number): {
  label: string;
  color: string;
} {
  if (confidence >= 80) return { label: "高", color: "text-green-600 bg-green-50" };
  if (confidence >= 50) return { label: "中", color: "text-yellow-600 bg-yellow-50" };
  return { label: "低", color: "text-orange-600 bg-orange-50" };
}
