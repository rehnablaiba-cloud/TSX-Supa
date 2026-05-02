// src/App.tsx
//
// CHANGES FROM PREVIOUS VERSION:
//   - Added AppShell import
//   - AppShell wraps AppInner inside the existing provider chain
//   - Removed the modules supabase.from("modules") fetch from AppInner
//     and replaced it with useQuery — now uses rpc.fetchModuleOptions() so
//     the module list is cached and shared with Dashboard (zero duplicate fetches)
//   - Realtime on modules table now calls queryClient.invalidateQueries
//     instead of re-running a fetch callback
//   - Everything else (navigation, page rendering, install prompt) unchanged
//
import React, { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { SessionLogProvider, useSessionLog } from "./context/SessionLogContext";
import { ActiveLockProvider } from "./context/ActiveLockContext";
import AppShell from "./components/AppShell";
import SessionLog from "./components/DevTools/SessionLog";
import SessionManager from "./components/UI/SessionManager";
import LoginPage from "./components/Auth/LoginPage";
import Sidebar from "./components/Layout/Sidebar";
import MobileNav from "./components/Layout/MobileNav";
import Dashboard from "./components/Dashboard/Dashboard";
import ModuleDashboard from "./components/ModuleDashboard/ModuleDashboard";
import TestExecution from "./components/TestExecution/TestExecution";
import TestReport from "./components/TestReport/TestReport";
import UsersPanel from "./components/Users/UsersPanel";
import AuditLog from "./components/AuditLog/AuditLog";
import Spinner from "./components/UI/Spinner";
import { supabase } from "./supabase";
import { fetchModuleOptions } from "./lib/rpc";
import { QK, STALE, GC } from "./lib/queryClient";
import { Module } from "./types";

type Page =
  | "dashboard"
  | "module"
  | "execution"
  | "report"
  | "users"
  | "audit_log";

// ─── AppInner ─────────────────────────────────────────────────────────────────

const AppInner: React.FC = () => {
  const { isLoading: authLoading, isAuthenticated, user } = useAuth();
  const { log }         = useSessionLog();
  const queryClient     = useQueryClient();

  const [page, setPage]                         = useState<Page>("dashboard");
  const [selectedmodule_name, setSelectedmodule_name] = useState<string | null>(null);
  const [selectedTestId, setSelectedTestId]     = useState<string | null>(null);
  const [installPrompt, setInstallPrompt]       = useState<any>(null);
  const [showInstall, setShowInstall]           = useState(false);

  // ── Install prompt ──────────────────────────────────────────────────────
  useEffect(() => {
    if ((window as any).__installPrompt) {
      setInstallPrompt((window as any).__installPrompt);
      setShowInstall(true);
    }
    const handler = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
      setShowInstall(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") setShowInstall(false);
  };

  const isAdmin = user?.role === "admin";

  // ── Auth log ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return;
    log(
      "success",
      "auth",
      `Signed in as ${user?.email ?? "unknown"} (${user?.role ?? "?"})`
    );
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Modules — useQuery replaces manual fetch + useState ─────────────────
  //
  // fetchModuleOptions() returns { name: string }[] from the modules table.
  // The Module type used by Sidebar expects { name: string } at minimum —
  // if Module has additional fields (description etc.), cast as shown below.
  //
  // Cache key: QK.moduleOptions() = ['moduleOptions']
  // staleTime: 5 min — modules list changes rarely
  // gcTime:    30 min — survives route changes and remounts within a session
  //
  // The Realtime subscription below invalidates this key on any modules
  // table change — no manual refetch callback needed.
  const modulesQuery = useQuery({
    queryKey:  QK.moduleOptions(),
    queryFn:   fetchModuleOptions,
    enabled:   isAuthenticated,   // don't run before auth is confirmed
    staleTime: STALE.modules,
    gcTime:    GC.modules,
  });

  // Cast ModuleOption[] → Module[] for Sidebar compatibility.
  // fetchModuleOptions returns { name: string }[] which satisfies Module
  // as long as Module only requires `name`. If Module requires more fields,
  // extend fetchModuleOptions or cast with defaults here.
  const modules = (modulesQuery.data ?? []) as unknown as Module[];

  // ── Realtime — modules table ────────────────────────────────────────────
  // Invalidates QK.moduleOptions() on any INSERT/UPDATE/DELETE.
  // TanStack refetches automatically if the query is currently stale.
  useEffect(() => {
    if (!isAuthenticated) return;

    const channel = supabase
      .channel("modules_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "modules" },
        (payload) => {
          log("info", "realtime", `modules → ${payload.eventType}`);
          queryClient.invalidateQueries({ queryKey: QK.moduleOptions() });
        }
      )
      .subscribe((status) => {
        log(
          status === "SUBSCRIBED" ? "success" : "warn",
          "realtime",
          `modules_realtime channel: ${status}`
        );
      });

    return () => { supabase.removeChannel(channel); };
  }, [isAuthenticated, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auth gate ───────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-base">
        <Spinner size={48} />
      </div>
    );
  }

  if (!isAuthenticated) return <LoginPage />;

  // ── Navigation ──────────────────────────────────────────────────────────
  const selectedModule = modules.find((m) => m.name === selectedmodule_name);

  const navigate = (p: string, module_name?: string) => {
    if (p === "module" && module_name) {
      setSelectedmodule_name(module_name);
      setPage("module");
      log("info", "nav", `Navigate → module: ${module_name}`);
    } else {
      if (p === "report") setSelectedTestId(null);
      setPage(p as Page);
      log("info", "nav", `Navigate → ${p}`);
    }
  };

  const navigateToReport = (testId: string) => {
    setSelectedTestId(testId);
    setPage("report");
    log("info", "nav", `Navigate → report: ${testId}`);
  };

  // ── Page renderer ───────────────────────────────────────────────────────
  const renderPage = () => {
    switch (page) {
      case "dashboard":
        return <Dashboard onNavigate={navigate} />;

      case "module":
        return selectedModule ? (
          <ModuleDashboard
            module_name={selectedModule.name}
            onBack={() => {
              setPage("dashboard");
              log("info", "nav", "Back → dashboard");
            }}
            onExecute={(mtId) => {
              setSelectedTestId(mtId);
              setPage("execution");
              log("info", "nav", `Execute test: ${mtId}`);
            }}
            onViewReport={navigateToReport}
          />
        ) : (
          <Dashboard onNavigate={navigate} />
        );

      case "execution":
        return selectedModule && selectedTestId ? (
          <TestExecution
            module_name={selectedModule.name}
            initialmodule_test_id={selectedTestId}
            isAdmin={isAdmin}
            onBack={() => {
              setPage("module");
              log("info", "nav", "Back → module");
            }}
          />
        ) : (
          <Dashboard onNavigate={navigate} />
        );

      case "report":
        return <TestReport />;

      case "users":
        return <UsersPanel />;

      case "audit_log":
        return <AuditLog />;

      default:
        return <Dashboard onNavigate={navigate} />;
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <SessionManager>
      <div className="flex min-h-screen bg-bg-base">
        <Sidebar activePage={page} onNavigate={navigate} modules={modules} />
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {renderPage()}
        </main>
        <MobileNav
          activePage={page}
          onNavigate={(p) => {
            if (p === "report")    setSelectedTestId(null);
            if (p === "audit_log") setSelectedTestId(null);
            navigate(p);
          }}
        />
        {showInstall && (
          <button
            onClick={handleInstall}
            title="Install TestPro as an app"
            className="fixed bottom-20 right-4 z-50 flex items-center gap-1.5
              px-2.5 py-1.5 rounded-lg text-[11px] font-semibold
              bg-bg-surface border border-(--border-color)
              text-t-secondary hover:text-t-primary hover:border-(--color-brand)
              shadow-lg transition-colors"
          >
            📲 Install
          </button>
        )}
      </div>
      <SessionLog />
    </SessionManager>
  );
};

// ─── Root ─────────────────────────────────────────────────────────────────────
//
// Provider chain (outermost → innermost):
//   ThemeProvider        — CSS theme vars
//   SessionLogProvider   — dev log context
//   ActiveLockProvider   — lock state context
//   AppShell             — session expiry modal + enhanced signout  ← NEW
//   AppInner             — auth gate + page routing
//
// QueryClientProvider is one level above in main.tsx — wraps everything.
//
const App: React.FC = () => (
  <ThemeProvider>
    <SessionLogProvider>
      <ActiveLockProvider>
        <AppShell>
          <AppInner />
        </AppShell>
      </ActiveLockProvider>
    </SessionLogProvider>
  </ThemeProvider>
);

export default App;
