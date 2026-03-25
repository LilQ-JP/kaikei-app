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
        <Route path="/profile" component={Profile} />
        <Route path="/seed" component={Seed} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initializeDB().then(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-sm font-semibold text-muted-foreground">読み込み中...</div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
