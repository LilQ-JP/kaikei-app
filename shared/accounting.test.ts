import assert from "node:assert/strict";
import test from "node:test";
import { calculateBalanceSheet, calculateProfitLoss, compareJournalOrder, summarizeBalances, validateBalancedJournal } from "./accounting";

test("旧仕訳の作成日時が欠けていても安全に並べ替える", () => {
  const old = { id: "old", date: "2026-01-01" };
  const newer = { id: "newer", date: "2026-01-01", createdAt: "2026-01-02T00:00:00Z" };
  const later = { id: "later", date: "2026-01-02" };
  assert.deepEqual([later, newer, old].sort(compareJournalOrder), [old, newer, later]);
  assert.doesNotThrow(() => compareJournalOrder(old, newer));
});

const accounts = [
  { id: "cash", code: "100", name: "現金", category: "asset" as const },
  { id: "capital", code: "300", name: "元入金", category: "equity" as const },
  { id: "sales", code: "400", name: "売上高", category: "income" as const },
  { id: "expense", code: "500", name: "通信費", category: "expense" as const },
];

const journal = (id: string, debitAccountId: string, creditAccountId: string, amount: number) => ({
  id, date: "2026-01-01", debitAccountId, creditAccountId, amount,
});

test("貸方正常残高の科目は貸方残高になる", () => {
  const balances = summarizeBalances(accounts, [journal("1", "cash", "capital", 1000)]);
  assert.equal(balances.get("capital")?.debitBalance, 0);
  assert.equal(balances.get("capital")?.creditBalance, 1000);
});

test("返品・返金の逆仕訳を損益へ反映する", () => {
  const result = calculateProfitLoss(accounts, [
    journal("1", "cash", "sales", 1000),
    journal("2", "sales", "cash", 200),
    journal("3", "expense", "cash", 100),
    journal("4", "cash", "expense", 20),
  ]);
  assert.equal(result.totalIncome, 800);
  assert.equal(result.totalExpense, 80);
  assert.equal(result.netIncome, 720);
});

test("貸借対照表が一致する", () => {
  const journals = [
    journal("1", "cash", "capital", 1000),
    journal("2", "cash", "sales", 500),
    journal("3", "expense", "cash", 100),
  ];
  const result = calculateBalanceSheet(accounts, journals, journals);
  assert.equal(result.totalAssets, 1400);
  assert.equal(result.totalLiabilities + result.totalEquity, 1400);
  assert.equal(result.isBalanced, true);
});

test("不正な仕訳を拒否する", () => {
  assert.match(validateBalancedJournal(journal("1", "cash", "cash", 100)), /同じ科目/);
  assert.match(validateBalancedJournal(journal("1", "cash", "sales", 1.5)), /整数/);
});

test("複合仕訳は借貸合計が一致する場合だけ集計する", () => {
  const compound = {
    id: "compound", date: "2026-01-01",
    lines: [
      { side: "debit" as const, accountId: "cash", amount: 600 },
      { side: "debit" as const, accountId: "expense", amount: 400 },
      { side: "credit" as const, accountId: "capital", amount: 1000 },
    ],
  };
  assert.equal(validateBalancedJournal(compound), null);
  const balances = summarizeBalances(accounts, [compound]);
  assert.equal(balances.get("cash")?.debitBalance, 600);
  assert.equal(balances.get("expense")?.debitBalance, 400);
  assert.equal(balances.get("capital")?.creditBalance, 1000);
  assert.match(validateBalancedJournal({ ...compound, lines: compound.lines.slice(0, 2) }), /両方/);
});

test("過年度利益を含めて翌年度の貸借対照表を一致させる", () => {
  const previousYear = [{ ...journal("prior", "cash", "sales", 100), date: "2025-12-31" }];
  const result = calculateBalanceSheet(accounts, previousYear, []);
  assert.equal(result.netIncome, 0);
  assert.equal(result.cumulativeNetIncome, 100);
  assert.equal(result.totalAssets, 100);
  assert.equal(result.totalEquity, 100);
  assert.equal(result.isBalanced, true);
});

test("減価償却累計額は資産から控除して貸借を一致させる", () => {
  const depreciationAccounts = [
    ...accounts,
    { id: "equipment", code: "156", name: "工具器具備品", category: "asset" as const },
    { id: "accumulated", code: "159", name: "減価償却累計額", category: "asset" as const, normalBalance: "credit" as const },
    { id: "depreciation", code: "530", name: "減価償却費", category: "expense" as const },
  ];
  const journals = [
    journal("1", "equipment", "capital", 100),
    journal("2", "depreciation", "accumulated", 20),
  ];
  const result = calculateBalanceSheet(depreciationAccounts, journals, journals);
  assert.equal(result.assetItems.find((item) => item.account.id === "accumulated")?.balance, -20);
  assert.equal(result.totalAssets, 80);
  assert.equal(result.totalEquity, 80);
  assert.equal(result.isBalanced, true);
});
