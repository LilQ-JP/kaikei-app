import assert from "node:assert/strict";
import test from "node:test";
import { calculateBalanceSheet, calculateProfitLoss, summarizeBalances, validateBalancedJournal } from "./accounting";

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
