/**
 * AiChat — 会計AIチャット相談コンポーネント
 * macOS Ledger Design
 *
 * 会計・確定申告に関する質問にルールベースで回答する。
 * ブラウザ内完結（外部API不要）。
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageCircle, X, Send, Bot, User, Sparkles } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface QARule {
  keywords: string[];
  answer: string;
  category: string;
}

const QA_RULES: QARule[] = [
  // 勘定科目の質問
  {
    keywords: ["交通費", "電車", "バス", "タクシー", "旅費"],
    answer: "交通費は「旅費交通費」（コード516）で計上します。電車・バス・タクシー・飛行機代、Suica/PASMOチャージ（事業用のみ）、高速道路料金、駐車場代が含まれます。\n\nプライベートとの按分が必要な場合は「家事按分」機能で事業使用割合を設定してください。",
    category: "勘定科目",
  },
  {
    keywords: ["通信費", "携帯", "インターネット", "Wi-Fi", "サーバー"],
    answer: "通信費（コード518）には、携帯電話料金、インターネット回線費、サーバー代、ドメイン代、SaaS利用料（Zoom、Slack、Adobe等）が含まれます。\n\n自宅兼事務所の場合、通信費は「家事按分」で事業使用割合を設定することをおすすめします。一般的には30〜50%程度が目安です。",
    category: "勘定科目",
  },
  {
    keywords: ["消耗品", "文房具", "パソコン", "PC", "備品"],
    answer: "10万円未満の物品は「消耗品費」（コード528）で一括経費にできます。\n\n10万円以上30万円未満の場合、青色申告の少額減価償却資産の特例で一括経費にできます（年間合計300万円まで）。\n\n30万円以上は「固定資産」として登録し、減価償却が必要です。「固定資産台帳」機能で管理できます。",
    category: "勘定科目",
  },
  {
    keywords: ["会議費", "カフェ", "打ち合わせ", "ミーティング", "ランチ"],
    answer: "取引先との打ち合わせでのカフェ代・飲食代は「会議費」（コード552）で計上できます。1人あたり5,000円以下が目安です。\n\n5,000円を超える飲食は「接待交際費」（コード522）になります。\n\n一人で作業するためのカフェ代は経費として認められにくいので注意してください。",
    category: "勘定科目",
  },
  {
    keywords: ["家賃", "事務所", "オフィス", "コワーキング"],
    answer: "事務所の家賃は「地代家賃」（コード540）で計上します。\n\n自宅兼事務所の場合は「家事按分」が必要です。面積比や使用時間で按分するのが一般的で、30〜50%程度が目安です。\n\n敷金・礼金は20万円未満なら一括経費、20万円以上は繰延資産として償却します。",
    category: "勘定科目",
  },
  {
    keywords: ["接待", "飲み会", "交際費", "贈答", "お中元", "お歳暮"],
    answer: "取引先との飲食代（1人5,000円超）、贈答品、お中元・お歳暮は「接待交際費」（コード522）で計上します。\n\n個人事業主の場合、接待交際費に上限はありませんが、事業との関連性を説明できる必要があります。領収書には相手先名と人数を記載しておきましょう。",
    category: "勘定科目",
  },
  {
    keywords: ["外注", "業務委託", "フリーランス", "デザイン依頼"],
    answer: "外部への業務委託費は「外注工賃」（コード536）で計上します。\n\nデザイン・開発・ライティングなどの外注費が該当します。源泉徴収が必要な場合があるので注意してください（個人への支払いで一定の業務の場合）。",
    category: "勘定科目",
  },
  {
    keywords: ["手数料", "振込", "決済", "PayPal", "Stripe"],
    answer: "銀行の振込手数料、クレジットカード決済手数料、PayPal・Stripe等の手数料は「支払手数料」（コード548）で計上します。\n\n税理士・弁護士への報酬も支払手数料に含まれます。",
    category: "勘定科目",
  },

  // 確定申告
  {
    keywords: ["青色申告", "青色", "申告"],
    answer: "青色申告のメリット：\n\n1. **最大65万円の特別控除**（e-Tax + 複式簿記の場合）\n2. **赤字の3年間繰越**\n3. **少額減価償却資産の特例**（30万円未満を一括経費化）\n4. **家族への給与を経費にできる**（青色事業専従者給与）\n\n複式簿記での記帳が必要ですが、このアプリで仕訳を入力すれば自動的に複式簿記になります。",
    category: "確定申告",
  },
  {
    keywords: ["白色申告", "白色"],
    answer: "白色申告は簡易な記帳で済みますが、青色申告の特別控除（最大65万円）が受けられません。\n\n特別な理由がなければ、青色申告をおすすめします。このアプリで仕訳を入力すれば複式簿記の要件を満たせます。\n\n青色申告への切替は、その年の3月15日までに「所得税の青色申告承認申請書」を税務署に提出する必要があります。",
    category: "確定申告",
  },
  {
    keywords: ["確定申告", "期限", "いつまで", "締め切り"],
    answer: "確定申告の期限は毎年**3月15日**です（土日の場合は翌営業日）。\n\n1月1日〜12月31日の所得を翌年2月16日〜3月15日に申告します。\n\ne-Taxを使えば自宅から電子申告でき、青色申告特別控除も65万円（紙提出の場合は55万円）になります。",
    category: "確定申告",
  },
  {
    keywords: ["控除", "所得控除", "節税"],
    answer: "個人事業主が使える主な所得控除：\n\n1. **基礎控除**: 48万円\n2. **青色申告特別控除**: 最大65万円\n3. **社会保険料控除**: 国保・年金の全額\n4. **小規模企業共済等掛金控除**: iDeCo・小規模企業共済\n5. **生命保険料控除**: 最大12万円\n6. **医療費控除**: 10万円超の部分\n7. **ふるさと納税**: 寄附金控除\n\n経費を正しく計上することが最大の節税です。",
    category: "確定申告",
  },
  {
    keywords: ["経費", "何が経費", "経費になる"],
    answer: "個人事業主の主な経費：\n\n- **通信費**: 携帯、ネット回線、サーバー代\n- **旅費交通費**: 電車、タクシー、ガソリン代\n- **消耗品費**: 文房具、10万円未満の備品\n- **地代家賃**: 事務所家賃（自宅兼用は按分）\n- **水道光熱費**: 電気・ガス・水道（按分）\n- **外注工賃**: 業務委託費\n- **接待交際費**: 取引先との飲食代\n- **新聞図書費**: 事業関連の書籍\n- **研修費**: セミナー、オンライン講座\n\nポイント: 「事業に必要な支出」であることが条件です。",
    category: "確定申告",
  },

  // 消費税
  {
    keywords: ["消費税", "インボイス", "適格請求書"],
    answer: "消費税の基本：\n\n- **免税事業者**: 前々年の課税売上が1,000万円以下なら消費税の納付義務なし\n- **課税事業者**: 1,000万円超、またはインボイス登録した場合\n\nインボイス制度（2023年10月〜）:\n- 適格請求書発行事業者の登録が必要\n- 登録すると免税事業者でも消費税の申告・納付が必要\n- 2割特例: 納付税額を売上税額の2割にできる経過措置あり\n\n「消費税集計」ページで概算の納付税額を確認できます。",
    category: "消費税",
  },

  // 家事按分
  {
    keywords: ["家事按分", "按分", "プライベート", "事業割合"],
    answer: "自宅兼事務所の場合、経費を事業用とプライベート用に按分する必要があります。\n\n一般的な按分割合の目安：\n- **家賃**: 面積比（事務所スペース÷全体面積）で30〜50%\n- **電気代**: 使用時間比で30〜50%\n- **通信費**: 事業使用割合で30〜50%\n- **車両費**: 走行距離比\n\n「家事按分」ページで科目ごとの按分割合を設定し、年度末に自動で按分仕訳を作成できます。",
    category: "家事按分",
  },

  // 減価償却
  {
    keywords: ["減価償却", "固定資産", "耐用年数"],
    answer: "10万円以上の資産は減価償却が必要です：\n\n- **10万円未満**: 消耗品費で一括経費\n- **10〜20万円**: 一括償却資産（3年均等償却）を選択可\n- **10〜30万円**: 青色申告の少額減価償却資産の特例で一括経費可（年300万円まで）\n- **30万円以上**: 通常の減価償却\n\n主な耐用年数：\n- パソコン: 4年\n- サーバー: 5年\n- 事務机・椅子: 8〜15年\n- 自動車: 6年\n\n「固定資産台帳」ページで管理・自動計算できます。",
    category: "減価償却",
  },

  // 事業主貸・事業主借
  {
    keywords: ["事業主貸", "事業主借", "元入金", "個人", "プライベート"],
    answer: "**事業主貸**: 事業のお金をプライベートに使った場合\n例: 生活費の引き出し、個人の税金支払い\n\n**事業主借**: 個人のお金を事業に使った場合\n例: 個人のクレカで事業の買い物、自己資金の投入\n\n**元入金**: 事業開始時の資本金に相当。年度末に事業主貸・事業主借と相殺して翌年の元入金になります。\n\n仕訳例:\n- 生活費引出: 事業主貸 / 普通預金\n- 個人カードで経費: 消耗品費 / 事業主借",
    category: "勘定科目",
  },

  // 請求書
  {
    keywords: ["請求書", "インボイス", "発行", "書き方"],
    answer: "適格請求書（インボイス）の記載事項：\n\n1. 発行者の氏名・名称\n2. **適格請求書発行事業者の登録番号**（T+13桁）\n3. 取引年月日\n4. 取引内容\n5. 税率ごとの合計額と適用税率\n6. **税率ごとの消費税額**\n7. 書類の交付を受ける事業者の氏名・名称\n\n「請求書」ページで作成すれば、これらの項目が自動的に含まれます。",
    category: "請求書",
  },
];

const GREETING = "こんにちは！会計・確定申告に関する質問にお答えします。\n\n例えば：\n- 「カフェ代は何の科目？」\n- 「青色申告のメリットは？」\n- 「家事按分の割合は？」\n- 「減価償却の基準は？」\n\nお気軽にどうぞ！";

function findAnswer(question: string): string {
  const q = question.toLowerCase();

  // 挨拶
  if (q.match(/^(こんにちは|はじめまして|ありがとう|よろしく|hello|hi)/)) {
    return "こんにちは！会計や確定申告について何でも聞いてください。";
  }

  // ルールマッチング
  let bestRule: QARule | null = null;
  let bestScore = 0;

  for (const rule of QA_RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (q.includes(kw.toLowerCase())) {
        score += kw.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestRule = rule;
    }
  }

  if (bestRule && bestScore >= 2) {
    return bestRule.answer;
  }

  // デフォルト回答
  return "申し訳ありません、その質問には対応していません。\n\n以下のトピックについてお答えできます：\n- 勘定科目の選び方\n- 確定申告（青色/白色）\n- 経費の判断\n- 消費税・インボイス\n- 家事按分\n- 減価償却\n- 事業主貸・事業主借\n- 請求書の書き方\n\n具体的なキーワードを含めて質問してみてください。";
}

export default function AiChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "greeting",
      role: "assistant",
      content: GREETING,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const handleSend = useCallback(() => {
    if (!input.trim()) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    // 少し遅延を入れてタイピング感を出す
    setTimeout(() => {
      const answer = findAnswer(userMsg.content);
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: answer,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setIsTyping(false);
    }, 500 + Math.random() * 500);
  }, [input]);

  return (
    <>
      {/* FABボタン */}
      <AnimatePresence>
        {!open && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            className="fixed bottom-6 right-6 z-50"
          >
            <Button
              onClick={() => setOpen(true)}
              className="h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-shadow bg-primary text-primary-foreground"
            >
              <MessageCircle className="h-6 w-6" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* チャットウィンドウ */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-6 right-6 z-50 w-[380px] h-[520px] bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <div className="text-[13px] font-bold">会計AIアシスタント</div>
                  <div className="text-[10px] text-muted-foreground">会計・確定申告の相談</div>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
                >
                  <div
                    className={`h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      msg.role === "assistant"
                        ? "bg-primary/10"
                        : "bg-muted"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <div
                    className={`max-w-[280px] rounded-lg px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap ${
                      msg.role === "assistant"
                        ? "bg-muted/50 dark:bg-muted/30 text-foreground"
                        : "bg-primary text-primary-foreground"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex gap-2">
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="bg-muted/50 dark:bg-muted/30 rounded-lg px-3 py-2">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="border-t p-3">
              <div className="flex gap-2">
                <Input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="質問を入力..."
                  className="text-[13px] flex-1"
                  disabled={isTyping}
                />
                <Button
                  size="sm"
                  className="h-9 w-9 p-0"
                  onClick={handleSend}
                  disabled={!input.trim() || isTyping}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
