const USE_REMOTE_DB = import.meta.env.PROD || import.meta.env.VITE_REMOTE_DB === "true";

export async function loadAppJson<T>(collection: string, localStorageKey: string, fallback: T): Promise<T> {
  if (!USE_REMOTE_DB) {
    try { return JSON.parse(localStorage.getItem(localStorageKey) || "") as T; } catch { return fallback; }
  }
  const response = await fetch(`/api/v1/records/${collection}`, { credentials: "same-origin" });
  if (!response.ok) throw new Error("サーバーから設定を読み込めません");
  const rows = await response.json() as Array<{ value?: T }>;
  return rows[0]?.value ?? fallback;
}

export async function saveAppJson<T>(collection: string, localStorageKey: string, value: T): Promise<void> {
  if (!USE_REMOTE_DB) {
    localStorage.setItem(localStorageKey, JSON.stringify(value));
    return;
  }
  const response = await fetch(`/api/v1/records/${collection}/default`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "default", value }),
  });
  if (!response.ok) throw new Error("サーバーへ設定を保存できません");
}
