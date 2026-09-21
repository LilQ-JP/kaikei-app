import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import AppLayout from "./components/AppLayout";
import { useEffect, useState } from "react";
import { initializeDB } from "./lib/db";
import Dashboard from "./pages/Dashboard";
import JournalForm from "./pages/JournalForm";
import JournalList from "./pages/JournalList";
import Invoices from "./pages/Invoices";
import Ledger from "./pages/Ledger";
import TrialBalance from "./pages/TrialBalance";
import ProfitLoss from "./pages/ProfitLoss";
import BalanceSheet from "./pages/BalanceSheet";
import TaxFiling from "./pages/TaxFiling";
import Receipts from "./pages/Receipts";
import Accounts from "./pages/Accounts";
import DataManagement from "./pages/DataManagement";
import Profile from "./pages/Profile";
import Seed from "./pages/Seed";
import CsvImport from "./pages/CsvImport";
import HomeExpense from "./pages/HomeExpense";
import FixedAssets from "./pages/FixedAssets";
import ConsumptionTax from "./pages/ConsumptionTax";
import MonthlyTrend from "./pages/MonthlyTrend";
import Reports from "./pages/Reports";
import Vendors from "./pages/Vendors";
import AiChat from "./components/AiChat";

const USE_REMOTE_DB = import.meta.env.PROD || import.meta.env.VITE_REMOTE_DB === "true";

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/journals/new" component={JournalForm} />
        <Route path="/journals/edit/:id" component={JournalForm} />
        <Route path="/journals" component={JournalList} />
        <Route path="/csv-import" component={CsvImport} />
        <Route path="/invoices" component={Invoices} />
        <Route path="/ledger" component={Ledger} />
        <Route path="/trial-balance" component={TrialBalance} />
        <Route path="/monthly-trend" component={MonthlyTrend} />
        <Route path="/reports" component={Reports} />
        <Route path="/pl" component={ProfitLoss} />
        <Route path="/bs" component={BalanceSheet} />
        <Route path="/tax-filing" component={TaxFiling} />
        <Route path="/consumption-tax" component={ConsumptionTax} />
        <Route path="/home-expense" component={HomeExpense} />
        <Route path="/fixed-assets" component={FixedAssets} />
        <Route path="/receipts" component={Receipts} />
        <Route path="/accounts" component={Accounts} />
        <Route path="/data" component={DataManagement} />
        <Route path="/vendors" component={Vendors} />
        <Route path="/profile" component={Profile} />
        <Route path="/seed" component={Seed} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function LoadingScreen({ message = "読み込み中..." }: { message?: string }) {
  return <div className="flex h-screen items-center justify-center bg-background"><div className="text-sm font-semibold text-muted-foreground">{message}</div></div>;
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(USE_REMOTE_DB);
  const [configured, setConfigured] = useState(false);
  const [authenticated, setAuthenticated] = useState(!USE_REMOTE_DB);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!USE_REMOTE_DB) return;
    Promise.all([
      fetch("/api/v1/auth/status").then((response) => response.json()),
      fetch("/api/v1/auth/session", { credentials: "same-origin" }),
    ]).then(([status, session]) => {
      setConfigured(Boolean(status.configured));
      setAuthenticated(session.ok);
      setLoading(false);
    }).catch(() => {
      setError("サーバーに接続できません。Lenovoの会計サーバーとTailscale接続を確認してください。");
      setLoading(false);
    });
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const endpoint = configured ? "/api/v1/auth/login" : "/api/v1/auth/setup";
    const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.error || "認証に失敗しました");
      return;
    }
    if (!configured) {
      const login = await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      if (!login.ok) { setError("初期設定後のログインに失敗しました"); return; }
      setConfigured(true);
    }
    setAuthenticated(true);
  }

  if (!USE_REMOTE_DB || authenticated) return <>{children}</>;
  if (loading) return <LoadingScreen />;
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 shadow-sm">
        <div><h1 className="text-xl font-bold">フリーランス会計</h1><p className="mt-1 text-sm text-muted-foreground">{configured ? "会計サーバーへログイン" : "初回パスワードを設定"}</p></div>
        <label className="block text-sm font-medium">パスワード<input type="password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3" autoComplete={configured ? "current-password" : "new-password"} required /></label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button type="submit" className="h-10 w-full rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">{configured ? "ログイン" : "設定して開始"}</button>
      </form>
    </div>
  );
}

function DatabaseApp() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initializeDB().then(() => setReady(true));
  }, []);

  if (!ready) return <LoadingScreen />;

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <TooltipProvider>
          <Toaster />
          <Router />
          <AiChat />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

function App() {
  return <AuthGate><DatabaseApp /></AuthGate>;
}

export default App;
