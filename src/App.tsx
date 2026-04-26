import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { SessionLogProvider, useSessionLog } from "./context/SessionLogContext";
import { ActiveLockProvider } from "./context/ActiveLockContext";
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
  const { log } = useSessionLog();

  const [modules, setModules] = useState<Module[]>([]);
  const [page, setPage] = useState<Page>("dashboard");
  const [selectedmodule_name, setSelectedmodule_name] = useState<string | null>(
    null
  );
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [showInstall, setShowInstall] = useState(false);

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

  useEffect(() => {
    if (!isAuthenticated) return;
    log(
      "success",
      "auth",
      `Signed in as ${user?.email ?? "unknown"} (${user?.role ?? "?"})`
    );
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isAuthenticated) return;

    const fetchModules = () =>
      supabase
        .from("modules")
        .select("*")
        .then(({ data, error }) => {
          if (!error && data) {
            setModules(data as Module[]);
            log("success", "query", `SELECT modules → ${data.length} rows`);
          } else if (error) {
            log(
              "error",
              "query",
              `SELECT modules failed: ${error.message}`,
              JSON.stringify(error)
            );
            console.error("Error fetching modules:", error.message);
          }
        });

    fetchModules();

    const channel = supabase
      .channel("modules_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "modules" },
        (payload) => {
          log("info", "realtime", `modules → ${payload.eventType}`);
          fetchModules();
        }
      )
      .subscribe((status) => {
        log(
          status === "SUBSCRIBED" ? "success" : "warn",
          "realtime",
          `modules_realtime channel: ${status}`
        );
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-base">
        <Spinner size={48} />
      </div>
    );
  }

  if (!isAuthenticated) return <LoginPage />;

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
        return (
          <TestReport
            module_test_id={selectedTestId ?? undefined}
            onBack={
              selectedTestId
                ? () => {
                    setPage("module");
                    log("info", "nav", "Back → module");
                  }
                : undefined
            }
          />
        );

      case "users":
        return <UsersPanel />;

      case "audit_log":
        return <AuditLog />;

      default:
        return <Dashboard onNavigate={navigate} />;
    }
  };

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
            if (p === "report") setSelectedTestId(null);
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
              bg-bg-surface border border-[var(--border-color)]
              text-t-secondary hover:text-t-primary hover:border-[var(--color-brand)]
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

const App: React.FC = () => (
  <ThemeProvider>
    <SessionLogProvider>
      <ActiveLockProvider>
        <AppInner />
      </ActiveLockProvider>
    </SessionLogProvider>
  </ThemeProvider>
);

export default App;
