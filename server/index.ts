import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { assertCollection, clearRecords, createEncryptedBackup, createSession, deleteRecord, deleteSession, getRecord, getSession, hasAdminUser, listEncryptedBackups, listRecords, putRecord, putRecordsAtomic, setAdminPassword, verifyAdminPassword, verifyEncryptedBackup } from "./storage";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self' data:");
    next();
  });
  app.use(express.json({ limit: "25mb" }));

  function readCookie(req: express.Request, name: string): string | undefined {
    const value = req.headers.cookie?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
    return value ? decodeURIComponent(value.slice(name.length + 1)) : undefined;
  }

  function requireSession(req: express.Request, res: express.Response, next: express.NextFunction) {
    const session = getSession(readCookie(req, "kaikei_session"));
    if (!session) return res.status(401).json({ error: "ログインが必要です" });
    res.locals.userId = session.userId;
    res.locals.csrfToken = session.csrfToken;
    return next();
  }

  function requireCsrf(req: express.Request, res: express.Response, next: express.NextFunction) {
    const provided = req.get("X-CSRF-Token");
    if (!provided || provided !== res.locals.csrfToken) return res.status(403).json({ error: "安全確認に失敗しました。画面を再読み込みして再試行してください" });
    return next();
  }

  const failedLogins = new Map<string, { count: number; retryAfter: number }>();

  app.get("/api/v1/health", (_req, res) => res.json({ ok: true, service: "kaikei", storage: "sqlite" }));
  app.get("/api/v1/auth/status", (_req, res) => res.json({ configured: hasAdminUser() }));
  app.post("/api/v1/auth/setup", (req, res) => {
    if (hasAdminUser()) return res.status(409).json({ error: "初期設定は完了しています" });
    try {
      setAdminPassword(String(req.body?.password || ""));
      return res.status(201).json({ ok: true });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "初期設定に失敗しました" });
    }
  });
  app.post("/api/v1/auth/login", (req, res) => {
    const address = req.ip || "unknown";
    const failure = failedLogins.get(address);
    if (failure?.retryAfter && failure.retryAfter > Date.now()) return res.status(429).json({ error: "ログイン試行が多すぎます。しばらくしてから再試行してください" });
    if (!verifyAdminPassword(String(req.body?.password || ""))) {
      const count = (failure?.count || 0) + 1;
      failedLogins.set(address, { count, retryAfter: count >= 5 ? Date.now() + 15 * 60 * 1000 : 0 });
      return res.status(401).json({ error: "パスワードが違います" });
    }
    failedLogins.delete(address);
    const session = createSession();
    res.setHeader("Set-Cookie", `kaikei_session=${encodeURIComponent(session.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
    return res.json({ ok: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt });
  });
  app.post("/api/v1/auth/logout", requireSession, requireCsrf, (req, res) => {
    deleteSession(readCookie(req, "kaikei_session"));
    res.setHeader("Set-Cookie", "kaikei_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    return res.status(204).end();
  });
  app.get("/api/v1/auth/session", requireSession, (_req, res) => res.json({ authenticated: true, csrfToken: res.locals.csrfToken }));

  app.get("/api/v1/backups", requireSession, (_req, res) => res.json(listEncryptedBackups()));
  app.post("/api/v1/backups", requireSession, requireCsrf, (_req, res) => {
    try { return res.status(201).json(createEncryptedBackup(res.locals.userId)); }
    catch (error) { return res.status(500).json({ error: error instanceof Error ? error.message : "バックアップに失敗しました" }); }
  });
  app.post("/api/v1/backups/:name/verify", requireSession, requireCsrf, (req, res) => {
    try { return res.json(verifyEncryptedBackup(req.params.name)); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "バックアップ検証に失敗しました" }); }
  });

  app.get("/api/v1/records/:collection", requireSession, (req, res) => {
    try { assertCollection(req.params.collection); return res.json(listRecords(req.params.collection)); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "不正なデータ種別です" }); }
  });
  app.post("/api/v1/records/batch", requireSession, requireCsrf, (req, res) => {
    try {
      assertCollection(String(req.body?.collection || ""));
      const records = Array.isArray(req.body?.records) ? req.body.records : [];
      if (records.some((record: unknown) => !record || typeof record !== "object" || typeof (record as { id?: unknown }).id !== "string")) return res.status(400).json({ error: "一括保存データが不正です" });
      putRecordsAtomic(req.body.collection, records, res.locals.userId);
      return res.status(204).end();
    } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "一括保存に失敗しました" }); }
  });
  app.get("/api/v1/records/:collection/:id", requireSession, (req, res) => {
    try { assertCollection(req.params.collection); const value = getRecord(req.params.collection, req.params.id); return value === undefined ? res.sendStatus(404) : res.json(value); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "不正なデータ種別です" }); }
  });
  app.put("/api/v1/records/:collection/:id", requireSession, requireCsrf, (req, res) => {
    try { assertCollection(req.params.collection); putRecord(req.params.collection, req.params.id, req.body, res.locals.userId); return res.status(204).end(); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "保存に失敗しました" }); }
  });
  app.delete("/api/v1/records/:collection/:id", requireSession, requireCsrf, (req, res) => {
    try { assertCollection(req.params.collection); deleteRecord(req.params.collection, req.params.id, res.locals.userId); return res.status(204).end(); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "削除に失敗しました" }); }
  });
  app.delete("/api/v1/records/:collection", requireSession, requireCsrf, (req, res) => {
    try { assertCollection(req.params.collection); clearRecords(req.params.collection, res.locals.userId); return res.status(204).end(); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "削除に失敗しました" }); }
  });

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.all("/api/v1/*", (_req, res) => res.status(404).json({ error: "APIが見つかりません" }));
  if (process.env.NODE_ENV === "production") app.get("/seed", (_req, res) => res.sendStatus(404));
  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;

  // Tailscale Serve is the only remote entry point.  Do not expose the
  // accounting API directly on the LAN or Tailnet interface.
  server.listen(Number(port), "127.0.0.1", () => {
    console.log(`Server running on http://127.0.0.1:${port}/`);
  });
}

startServer().catch(console.error);
