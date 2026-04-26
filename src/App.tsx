import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "./context/AuthContext";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
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
import { tokens, palette, TokenKey } from "./theme";

type Page =
  | "dashboard"
  | "module"
  | "execution"
  | "report"
  | "users"
  | "audit_log";
type MuiProviderComponent = React.ComponentType<{
  theme: unknown;
  children: React.ReactNode;
}>;

// ─── MuiActivator ─────────────────────────────────────────────────────────────

const MuiActivator: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { theme, muiConfig, customTokens } = useTheme();
  const [Provider, setProvider] = useState<MuiProviderComponent | null>(null);
  const [muiTheme, setMuiTheme] = useState<unknown>(null);
  const [muiError, setMuiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const buildMuiTheme = useCallback(async () => {
    console.group("🔧 MuiActivator.buildMuiTheme()");
    console.log("muiConfig.active:", muiConfig.active);
    console.log("theme:", theme);
    console.log("customTokens:", customTokens);

    if (!muiConfig.active) {
      console.log("⏹️ MUI inactive — clearing provider");
      setProvider(null);
      setMuiTheme(null);
      setMuiError(null);
      console.groupEnd();
      return;
    }

    setLoading(true);
    console.log("⏳ Starting dynamic import...");

    try {
      const mod = await import("@mui/material/styles");
      console.log("✅ @mui/material/styles loaded:", mod);

      const { ThemeProvider: TP, createTheme } = mod;
      const base = tokens[theme];
      const over = customTokens[theme];
      const tv = (key: TokenKey): string => (over[key] ?? base[key]) || "";

      console.log("Building theme with:");
      console.log("  primary.main:", tv("colorBrand") || palette.brand[500]);
      console.log("  bg.default:", tv("bgBase"));
      console.log("  bg.paper:", tv("bgSurface"));

      const muiT = createTheme({
        palette: {
          mode: theme,
          primary: { main: tv("colorBrand") || palette.brand[500] },
          error: { main: palette.fail },
          warning: { main: palette.pend },
          success: { main: palette.pass },
          background: { default: tv("bgBase"), paper: tv("bgSurface") },
          text: { primary: tv("textPrimary"), secondary: tv("textSecondary") },
          divider: tv("borderColor"),
        },
        shape: { borderRadius: muiConfig.borderRadius },
        typography: {
          fontFamily: muiConfig.fontFamily,
          fontSize: muiConfig.fontSize,
          fontWeightRegular: muiConfig.fontWeightRegular,
          fontWeightMedium: muiConfig.fontWeightMedium,
          fontWeightBold: muiConfig.fontWeightBold,
          button: {
            textTransform: muiConfig.buttonTextTransform as any,
            fontWeight: muiConfig.fontWeightMedium,
          },
        },
        components: {
          MuiButton: {
            styleOverrides: {
              root: { borderRadius: muiConfig.buttonBorderRadius },
            },
          },
          MuiTextField: {
            styleOverrides: {
              root: {
                "& .MuiOutlinedInput-root": {
                  borderRadius: muiConfig.textFieldBorderRadius,
                },
              },
            },
          },
          MuiPaper: {
            styleOverrides: {
              root: {
                backgroundImage: muiConfig.disablePaperBgImage
                  ? "none"
                  : undefined,
              },
            },
          },
        },
      });

      console.log("✅ MUI theme object created:", muiT);
      setMuiTheme(muiT);
      setProvider(() => TP as unknown as MuiProviderComponent);
      setMuiError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("❌ MUI import/build failed:", msg);
      setMuiError(msg);
      setProvider(null);
      setMuiTheme(null);
    } finally {
      setLoading(false);
      console.groupEnd();
    }
  }, [theme, muiConfig, customTokens]);

  useEffect(() => {
    console.log("⚡ MuiActivator useEffect triggered");
    buildMuiTheme();
  }, [buildMuiTheme]);

  if (muiConfig.active && muiError) {
    const isMissing =
      muiError.includes("Cannot find module") ||
      muiError.includes("Failed to fetch") ||
      muiError.includes("not found");
    return (
      <>
        <div className="fixed top-0 left-0 right-0 z-[9999] bg-pend/90 text-t-primary text-xs py-1.5 px-4 text-center">
          {isMissing ? (
            <>
              <code>@mui/material</code> not installed.
            </>
          ) : (
            <>MUI theme error — check console.</>
          )}
        </div>
        {children}
      </>
    );
  }
  if (muiConfig.active && loading) return <>{children}</>;
  if (Provider && muiTheme)
    return <Provider theme={muiTheme}>{children}</Provider>;
  return <>{children}</>;
};

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
    <MuiActivator>
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
    </MuiActivator>
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