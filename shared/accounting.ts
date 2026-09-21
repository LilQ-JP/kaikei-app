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
  debitAccountId: string;
  creditAccountId: string;
  amount: number;
  description?: string;
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

export function validateBalancedJournal(journal: AccountingJournal): string | null {
  if (!journal.id || !/^\d{4}-\d{2}-\d{2}$/.test(journal.date)) return "日付またはIDが不正です";
  if (!journal.debitAccountId || !journal.creditAccountId) return "借方・貸方科目が必要です";
  if (journal.debitAccountId === journal.creditAccountId) return "借方と貸方に同じ科目は指定できません";
  if (!Number.isSafeInteger(journal.amount) || journal.amount <= 0) return "金額は1円以上の整数で入力してください";
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
    if (!Number.isSafeInteger(journal.amount) || journal.amount <= 0) continue;
    const debit = result.get(journal.debitAccountId);
    const credit = result.get(journal.creditAccountId);
    if (debit) debit.debitTotal += journal.amount;
    if (credit) credit.creditTotal += journal.amount;
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
    if (account.category === "income" && balance.creditBalance > 0) {
      incomeItems.push({ account, amount: balance.creditBalance });
    }
    if (account.category === "expense" && balance.debitBalance > 0) {
      expenseItems.push({ account, amount: balance.debitBalance });
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
  const assetItems: { account: AccountingAccount; balance: number }[] = [];
  const liabilityItems: { account: AccountingAccount; balance: number }[] = [];
  const equityItems: { account: AccountingAccount; balance: number }[] = [];

  for (const account of accounts) {
    const balance = balances.get(account.id);
    if (!balance) continue;
    const amount = isDebitNormal(account) ? balance.debitBalance : balance.creditBalance;
    if (amount === 0) continue;
    if (account.category === "asset") assetItems.push({ account, balance: amount });
    if (account.category === "liability") liabilityItems.push({ account, balance: amount });
    if (account.category === "equity") equityItems.push({ account, balance: amount });
  }

  const totalAssets = assetItems.reduce((sum, item) => sum + item.balance, 0);
  const totalLiabilities = liabilityItems.reduce((sum, item) => sum + item.balance, 0);
  const totalEquity = equityItems.reduce((sum, item) => sum + item.balance, 0) + currentProfitLoss.netIncome;
  return {
    ...currentProfitLoss,
    assetItems,
    liabilityItems,
    equityItems,
    totalAssets,
    totalLiabilities,
    totalEquity,
    isBalanced: totalAssets === totalLiabilities + totalEquity,
  };
}
