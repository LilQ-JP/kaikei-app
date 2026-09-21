import test from "node:test";
import assert from "node:assert/strict";
import { suggestJournalAccounts } from "../client/src/lib/ai-journal";
import type { AccountItem } from "../client/src/lib/db";

const accounts: AccountItem[] = [
  { id: "a516", code: "516", name: "旅費交通費", category: "expense", createdAt: "2026-01-01" },
  { id: "a102", code: "102", name: "普通預金", category: "asset", createdAt: "2026-01-01" },
  { id: "a400", code: "400", name: "売上高", category: "revenue", createdAt: "2026-01-01" },
];

test("摘要のキーワードから仕訳候補を返す", () => {
  const result = suggestJournalAccounts("新幹線 東京出張", accounts, []);
  assert.equal(result?.debitAccountId, "a516");
  assert.equal(result?.creditAccountId, "a102");
  assert.match(result?.reason ?? "", /キーワード/);
});

test("過去の完全一致履歴をキーワードより優先する", () => {
  const result = suggestJournalAccounts("クライアント入金", accounts, [{
    id: "j1", date: "2026-01-02", description: "クライアント入金", amount: 1000,
    debitAccountId: "a102", creditAccountId: "a400", createdAt: "2026-01-02", updatedAt: "2026-01-02",
  }]);
  assert.equal(result?.debitAccountId, "a102");
  assert.equal(result?.creditAccountId, "a400");
  assert.equal(result?.confidence, 95);
});

test("根拠のない摘要は自動候補にしない", () => {
  assert.equal(suggestJournalAccounts("判定不能なメモ", accounts, []), null);
});
