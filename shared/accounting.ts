export type AccountCategory = "asset" | "liability" | "equity" | "income" | "expense";

export interface AccountingAccount {
  id: string;
  code: string;
  name: string;
  category: AccountCategory;
  normalBalance?: "debit" | "credit";
}

export interface AccountingJournal {
  id: string;
  date: string;
  /**
   * New transactions use lines.  The three legacy fields remain optional so
   * that old browser/SQLite records can be migrated without changing their
   * accounting result.
   */
  lines?: readonly AccountingJournalLine[];
  debitAccountId?: string;
  creditAccountId?: string;
  amount?: number;
  description?: string;
}

export interface AccountingJournalLine {
  side: "debit" | "credit";
  accountId: string;
  amount: number;
}

export interface AccountBalance {
  debitTotal: number;
  creditTotal: number;
  balance: number;
  debitBalance: number;
  creditBalance: number;
}

export function isDebitNormal(account: Pick<AccountingAccount, "category" | "normalBalance">): boolean {
  return account.normalBalance ? account.normalBalance === "debit" : account.category === "asset" || account.category === "expense";
}

/** Return a normalized representation for both migrated and legacy records. */
export function journalLines(journal: AccountingJournal): readonly AccountingJournalLine[] {
  if (journal.lines) return journal.lines;
  if (!journal.debitAccountId || !journal.creditAccountId || journal.amount === undefined) return [];
  return [
    { side: "debit", accountId: journal.debitAccountId, amount: journal.amount },
    { side: "credit", accountId: journal.creditAccountId, amount: journal.amount },
  ];
}

export function validateBalancedJournal(journal: AccountingJournal): string | null {
  if (!journal.id || !/^\d{4}-\d{2}-\d{2}$/.test(journal.date)) return "日付またはIDが不正です";
  if (!journal.lines && journal.debitAccountId && journal.debitAccountId === journal.creditAccountId) {
    return "借方と貸方に同じ科目は指定できません";
  }
  const lines = journalLines(journal);
  if (lines.length < 2) return "借方・貸方明細が必要です";

  let debitTotal = 0;
  let creditTotal = 0;
  for (const line of lines) {
    if (!line.accountId) return "勘定科目が必要です";
    if (!Number.isSafeInteger(line.amount) || line.amount <= 0) return "金額は1円以上の整数で入力してください";
    if (line.side === "debit") debitTotal += line.amount;
    else creditTotal += line.amount;
    if (!Number.isSafeInteger(debitTotal) || !Number.isSafeInteger(creditTotal)) return "仕訳合計が安全に計算できる金額を超えています";
  }
  if (debitTotal === 0 || creditTotal === 0) return "借方・貸方の両方が必要です";
  if (debitTotal !== creditTotal) return "借方合計と貸方合計が一致しません";
  return null;
}

export function summarizeBalances(
  accounts: readonly AccountingAccount[],
  journals: readonly AccountingJournal[],
): Map<string, AccountBalance> {
  const result = new Map<string, AccountBalance>();
  for (const account of accounts) {
    result.set(account.id, { debitTotal: 0, creditTotal: 0, balance: 0, debitBalance: 0, creditBalance: 0 });
  }

  for (const journal of journals) {
    // Do not allow a malformed transaction to contribute one side only.
    if (validateBalancedJournal(journal)) continue;
    for (const line of journalLines(journal)) {
      const balance = result.get(line.accountId);
      if (!balance) continue;
      if (line.side === "debit") balance.debitTotal += line.amount;
      else balance.creditTotal += line.amount;
    }
  }

  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  result.forEach((row, accountId) => {
    const account = accountMap.get(accountId);
    if (!account) return;
    row.balance = row.debitTotal - row.creditTotal;
    // Trial-balance residuals are presented by the side on which the net
    // amount remains, independent of the account's normal side.
    row.debitBalance = Math.max(row.balance, 0);
    row.creditBalance = Math.max(-row.balance, 0);
  });
  return result;
}

export function calculateProfitLoss(
  accounts: readonly AccountingAccount[],
  journals: readonly AccountingJournal[],
) {
  const balances = summarizeBalances(accounts, journals);
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const incomeItems: { account: AccountingAccount; amount: number }[] = [];
  const expenseItems: { account: AccountingAccount; amount: number }[] = [];

  for (const account of accounts) {
    const balance = balances.get(account.id);
    if (!balance) continue;
    // Do not discard returns, refunds, or corrections just because they make
    // an account's net amount negative.
    if (account.category === "income" && balance.creditTotal !== balance.debitTotal) {
      incomeItems.push({ account, amount: balance.creditTotal - balance.debitTotal });
    }
    if (account.category === "expense" && balance.debitTotal !== balance.creditTotal) {
      expenseItems.push({ account, amount: balance.debitTotal - balance.creditTotal });
    }
  }

  incomeItems.sort((a, b) => a.account.code.localeCompare(b.account.code));
  expenseItems.sort((a, b) => a.account.code.localeCompare(b.account.code));
  const totalIncome = incomeItems.reduce((sum, item) => sum + item.amount, 0);
  const totalExpense = expenseItems.reduce((sum, item) => sum + item.amount, 0);
  return { accountMap, incomeItems, expenseItems, totalIncome, totalExpense, netIncome: totalIncome - totalExpense };
}

export function calculateBalanceSheet(
  accounts: readonly AccountingAccount[],
  journalsThroughYearEnd: readonly AccountingJournal[],
  currentYearJournals: readonly AccountingJournal[],
) {
  const balances = summarizeBalances(accounts, journalsThroughYearEnd);
  const currentProfitLoss = calculateProfitLoss(accounts, currentYearJournals);
  // In this application income and expense accounts have not historically
  // been closed at year end.  Their cumulative balance must therefore be
  // included in equity; using only the selected year's profit makes a later
  // year's balance sheet fail even when every journal is balanced.
  const cumulativeProfitLoss = calculateProfitLoss(accounts, journalsThroughYearEnd);
  const assetItems: { account: AccountingAccount; balance: number }[] = [];
  const liabilityItems: { account: AccountingAccount; balance: number }[] = [];
  const equityItems: { account: AccountingAccount; balance: number }[] = [];

  for (const account of accounts) {
    const balance = balances.get(account.id);
    if (!balance) continue;
    // Presentation follows the accounting equation, rather than an account's
    // normal side.  A credit-normal asset such as accumulated depreciation is
    // consequently a negative asset, not a positive one.
    const amount = account.category === "asset"
      ? balance.debitTotal - balance.creditTotal
      : balance.creditTotal - balance.debitTotal;
    if (amount === 0) continue;
    if (account.category === "asset") assetItems.push({ account, balance: amount });
    if (account.category === "liability") liabilityItems.push({ account, balance: amount });
    if (account.category === "equity") equityItems.push({ account, balance: amount });
  }

  const totalAssets = assetItems.reduce((sum, item) => sum + item.balance, 0);
  const totalLiabilities = liabilityItems.reduce((sum, item) => sum + item.balance, 0);
  const totalEquity = equityItems.reduce((sum, item) => sum + item.balance, 0) + cumulativeProfitLoss.netIncome;
  return {
    ...currentProfitLoss,
    cumulativeNetIncome: cumulativeProfitLoss.netIncome,
    assetItems,
    liabilityItems,
    equityItems,
    totalAssets,
    totalLiabilities,
    totalEquity,
    isBalanced: totalAssets === totalLiabilities + totalEquity,
  };
}
