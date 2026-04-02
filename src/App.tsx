// App.tsx
import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "./context/AuthContext";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
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

type Page = "dashboard" | "module" | "execution" | "report" | "users" | "auditlog";

// ─── MUI Activator ─────────────────────────────────────────────────────────────
//
// Dynamically imports @mui/material and builds a live MUI theme from the
// current token values + MUI config. Reads token values directly from
// theme.ts (+ customTokens overrides) rather than getComputedStyle so there
// are no timing issues with CSS var injection order.
//
// Toggle from: Theme Editor → MUI tab → "Activate MUI ThemeProvider".

type MuiProviderComponent = React.ComponentType<{ theme: unknown; children: React.ReactNode }>;

const MuiActivator: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { theme, muiConfig, customTokens } = useTheme();
  const [Provider, setProvider] = useState<MuiProviderComponent | null>(null);
  const [muiTheme, setMuiTheme] = useState<unknown>(null);
  const [muiError, setMuiError] = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  const buildMuiTheme = useCallback(async () => {
    if (!muiConfig.active) {
      setProvider(null);
      setMuiTheme(null);
      setMuiError(null);
      return;
    }

    setLoading(true);
    try {
      const { ThemeProvider: TP, createTheme } = await import("@mui/material/styles");

      // Read token values directly from theme.ts + editor overrides.
      // This avoids getComputedStyle timing issues (child effects fire before
      // parent effects, so CSS vars may not be set yet when this runs).
      const base = tokens[theme];
      const over = customTokens[theme];
      const tv = (key: TokenKey): string => (over[key] ?? base[key]) || "";

      const muiT = createTheme({
        palette: {
          mode: theme,
          primary:    { main: tv("colorBrand") || palette.brand[500] },
          error:      { main: palette.fail },
          warning:    { main: palette.pend },
          success:    { main: palette.pass },
          background: { default: tv("bgBase"), paper: tv("bgSurface") },
          text:       { primary: tv("textPrimary"), secondary: tv("textSecondary") },
          divider:    tv("borderColor"),
        },
        shape: { borderRadius: muiConfig.borderRadius },
        typography: {
          fontFamily:        muiConfig.fontFamily,
          fontSize:          muiConfig.fontSize,
          fontWeightRegular: muiConfig.fontWeightRegular,
          fontWeightMedium:  muiConfig.fontWeightMedium,
          fontWeightBold:    muiConfig.fontWeightBold,
          button: {
            textTransform: muiConfig.buttonTextTransform as any,
            fontWeight:    muiConfig.fontWeightMedium,
          },
        },
        components: {
          MuiButton:    { styleOverrides: { root: { borderRadius: muiConfig.buttonBorderRadius } } },
          MuiTextField: { styleOverrides: { root: {
            "& .MuiOutlinedInput-root": { borderRadius: muiConfig.textFieldBorderRadius },
          }}},
          MuiPaper: { styleOverrides: { root: {
            backgroundImage: muiConfig.disablePaperBgImage ? "none" : undefined,
          }}},
        },
      });

      setMuiTheme(muiT);
      // Use functional update to store a component (not an updater fn).
      setProvider(() => TP as unknown as MuiProviderComponent);
      setMuiError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("MUI ThemeProvider error:", msg);
      setMuiError(msg);
      setProvider(null);
      setMuiTheme(null);
    } finally {
      setLoading(false);
    }
  }, [theme, muiConfig, customTokens]);

  useEffect(() => { buildMuiTheme(); }, [buildMuiTheme]);

  // ── Render ──────────────────────────────────────────────

  if (muiConfig.active && muiError) {
    const isMissing = muiError.includes("Cannot find module") ||
                      muiError.includes("Failed to fetch") ||
                      muiError.includes("not found");
    return (
      <>
        <div className="fixed top-0 left-0 right-0 z-[9999] bg-pend/90 text-white text-xs py-1.5 px-4 text-center">
          {isMissing
            ? <>⚠️ <code>@mui/material</code> not installed. Run: <code className="font-mono bg-black/20 px-1 rounded">npm i @mui/material @emotion/react @emotion/styled</code></>
            : <>⚠️ MUI theme error — check console. App continues with Tailwind.</>
          }
        </div>
        {children}
      </>
    );
  }

  if (muiConfig.active && loading) {
    // MUI is being loaded — render children as-is to avoid layout flash.
    return <>{children}</>;
  }

  if (Provider && muiTheme) {
    return <Provider theme={muiTheme}>{children}</Provider>;
  }

  return <>{children}</>;
};

// ─── App Inner ─────────────────────────────────────────────────────────────────

const AppInner: React.FC = () => {
  const { isLoading: authLoading, isAuthenticated } = useAuth();
  const [modules, setModules]                       = useState<Module[]>([]);
  const [page, setPage]                             = useState<Page>("dashboard");
  const [selectedModuleId, setSelectedModuleId]     = useState<string | null>(null);
  const [selectedTestId, setSelectedTestId]         = useState<string | null>(null);

  // FIX: modules were fetched once on login and never refreshed.
  // A Realtime channel now keeps the list in sync — if another admin
  // adds/renames/deletes a module mid-session this user will see it immediately.
  useEffect(() => {
    if (!isAuthenticated) return;

    const fetchModules = () =>
      supabase
        .from("modules")
        .select("*")
        .then(({ data, error }) => {
          if (!error && data) setModules(data as Module[]);
          else if (error) console.error("Error fetching modules:", error.message);
        });

    fetchModules();

    const channel = supabase
      .channel("modules_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "modules" },
        () => fetchModules()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isAuthenticated]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <Spinner size={48} />
      </div>
    );
  }

  if (!isAuthenticated) return <LoginPage />;

  const selectedModule = modules.find(m => m.id === selectedModuleId);

  const navigate = (p: string, moduleId?: string) => {
    if (p === "module" && moduleId) { setSelectedModuleId(moduleId); setPage("module"); }
    else setPage(p as Page);
  };

  const renderPage = () => {
    switch (page) {
      case "dashboard": return <Dashboard onNavigate={navigate} />;
      case "module":    return selectedModule
        ? <ModuleDashboard moduleId={selectedModule.id} moduleName={selectedModule.name}
            onBack={() => setPage("dashboard")}
            onExecute={testId => { setSelectedTestId(testId); setPage("execution"); }} />
        : <Dashboard onNavigate={navigate} />;
      case "execution": return selectedModule && selectedTestId
        ? <TestExecution moduleId={selectedModule.id} moduleName={selectedModule.name}
            initialModuleTestId={selectedTestId} onBack={() => setPage("module")} />
        : <Dashboard onNavigate={navigate} />;
      case "report":   return <TestReport />;
      case "users":    return <UsersPanel />;
      case "auditlog": return <AuditLog />;
      default:         return <Dashboard onNavigate={navigate} />;
    }
  };

  return (
    <MuiActivator>
      <div className="flex min-h-screen bg-gray-950">
        <Sidebar activePage={page} onNavigate={navigate} modules={modules} />
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">{renderPage()}</main>
        <MobileNav activePage={page} onNavigate={p => navigate(p)} />
      </div>
    </MuiActivator>
  );
};

// ─── Root ─────────────────────────────────────────────────────────────────────

const App: React.FC = () => (
  <ThemeProvider>
    <AppInner />
  </ThemeProvider>
);

export default App;
