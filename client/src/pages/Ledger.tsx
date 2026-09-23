/**
 * Ledger — 総勘定元帳ページ
 * macOS Ledger Design
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getAllAccounts,
  getAllJournals,
  type AccountItem,
  type JournalEntry,
} from "@/lib/db";
import { formatYen, CATEGORY_LABELS } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { compareJournalOrder, isDebitNormal, journalLines } from "@shared/accounting";

export default function Ledger() {
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [j, a] = await Promise.all([getAllJournals(), getAllAccounts()]);
      setJournals(j);
      setAccounts(a.sort((x, y) => x.code.localeCompare(y.code)));
      setLoading(false);
    }
    load();
  }, []);

  const accountMap = useMemo(() => {
    const map = new Map<string, AccountItem>();
    accounts.forEach((a) => map.set(a.id, a));
    return map;
  }, [accounts]);

  const selectedAccount = accountMap.get(selectedAccountId);

  // Build ledger entries for selected account
  const ledgerEntries = useMemo(() => {
    if (!selectedAccountId) return [];

    const entries = journals
      .map((journal) => ({ journal, lines: journalLines(journal) }))
      .filter(({ lines }) => lines.some((line) => line.accountId === selectedAccountId))
      .map(({ journal, lines }) => ({ journal, lines, ownLines: lines.filter((line) => line.accountId === selectedAccountId) }))
      .sort((a, b) => compareJournalOrder(a.journal, b.journal));

    let balance = 0;
    const account = accountMap.get(selectedAccountId);
    const debitNormal = account ? isDebitNormal(account) : true;

    return entries.map(({ journal, lines, ownLines }) => {
      const debitAmount = ownLines.filter((line) => line.side === "debit").reduce((sum, line) => sum + line.amount, 0);
      const creditAmount = ownLines.filter((line) => line.side === "credit").reduce((sum, line) => sum + line.amount, 0);
      const counterAccountName = lines.filter((line) => line.accountId !== selectedAccountId).map((line) => accountMap.get(line.accountId)?.name || "不明科目").join("・") || "—";

      if (debitNormal) {
        balance += debitAmount - creditAmount;
      } else {
        balance += creditAmount - debitAmount;
      }

      return {
        id: journal.id,
        date: journal.date,
        description: journal.description,
        counterAccountName,
        debitAmount,
        creditAmount,
        balance,
      };
    });
  }, [selectedAccountId, journals, accountMap]);

  const groupedAccounts = useMemo(() => {
    const groups: Record<string, AccountItem[]> = {};
    accounts.forEach((acc) => {
      const label = CATEGORY_LABELS[acc.category] || acc.category;
      if (!groups[label]) groups[label] = [];
      groups[label].push(acc);
    });
    return groups;
  }, [accounts]);

  if (loading) {
    return <div className="flex h-full items-center justify-center"><div className="text-sm text-muted-foreground">読み込み中...</div></div>;
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">総勘定元帳</h1>
      </div>

      {/* Account selector */}
      <div className="mb-4 max-w-sm">
        <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
          <SelectTrigger className="text-[13px]">
            <SelectValue placeholder="勘定科目を選択してください" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(groupedAccounts).map(([group, accs]) => (
              <div key={group}>
                <div className="px-2 py-1.5 text-[11px] font-bold text-muted-foreground">{group}</div>
                {accs.map((acc) => (
                  <SelectItem key={acc.id} value={acc.id} className="text-[13px]">
                    {acc.code} {acc.name}
                  </SelectItem>
                ))}
              </div>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedAccount ? (
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px] font-bold">
              {selectedAccount.code} {selectedAccount.name}
              <span className="ml-2 text-[12px] font-medium text-muted-foreground">
                ({CATEGORY_LABELS[selectedAccount.category]})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {ledgerEntries.length === 0 ? (
              <div className="py-12 text-center text-[13px] text-muted-foreground">
                この科目の取引はありません
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-4 py-2.5 text-left font-bold text-muted-foreground">日付</th>
                      <th className="px-4 py-2.5 text-left font-bold text-muted-foreground">摘要</th>
                      <th className="px-4 py-2.5 text-left font-bold text-muted-foreground">相手科目</th>
                      <th className="px-4 py-2.5 text-right font-bold text-muted-foreground">借方</th>
                      <th className="px-4 py-2.5 text-right font-bold text-muted-foreground">貸方</th>
                      <th className="px-4 py-2.5 text-right font-bold text-muted-foreground">残高</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {ledgerEntries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-muted-foreground whitespace-nowrap">{entry.date}</td>
                        <td className="px-4 py-2.5 truncate max-w-[200px]">{entry.description || "—"}</td>
                        <td className="px-4 py-2.5 font-semibold whitespace-nowrap">{entry.counterAccountName}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold whitespace-nowrap">
                          {entry.debitAmount > 0 ? formatYen(entry.debitAmount) : ""}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold whitespace-nowrap">
                          {entry.creditAmount > 0 ? formatYen(entry.creditAmount) : ""}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold whitespace-nowrap">
                          {formatYen(entry.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <p className="text-[13px] text-muted-foreground">勘定科目を選択すると元帳が表示されます</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
