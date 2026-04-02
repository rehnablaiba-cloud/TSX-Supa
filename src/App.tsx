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

type Page = "dashboard" | "module" | "execution" | "report" | "users" | "auditlog";

// ─── MUI Activator ─────────────────────────────────────────────────────────────
//
// Tries to dynamically import @mui/material + create a live MUI theme from the
// current token values + MUI config.  If the package is not installed the import
// fails silently and children render without an MUI ThemeProvider — no crash.
//
// Toggle this from the Theme Editor → MUI tab → "Activate MUI ThemeProvider".

type MuiProviderComponent = React.ComponentType<{ theme: unknown; children: React.ReactNode }>;

const MuiActivator: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { theme, muiConfig } = useTheme();
  const [Provider, setProvider] = useState<MuiProviderComponent | null>(null);
  const [muiTheme, setMuiTheme]   = useState<unknown>(null);
  const [muiError, setMuiError]   = useState(false);

  // Build the MUI theme object whenever the active mode or muiConfig changes
  const buildMuiTheme = useCallback(async () => {
    if (!muiConfig.active) { setProvider(null); return; }
    try {
      const [{ ThemeProvider: TP }, { createTheme }] = await Promise.all([
        import("@mui/material/styles"),
        import("@mui/material/styles"),
      ]);

      // Read the current resolved CSS var values so MUI colours match Tailwind exactly
      const css = (v: string) =>
        getComputedStyle(document.documentElement).getPropertyValue(v).trim();

      const t = createTheme({
        palette: {
          mode: theme,
          primary:    { main: css("--color-brand") },
          error:      { main: css("--color-fail") || "#ef4444" },
          warning:    { main: css("--color-pend") || "#f59e0b" },
          success:    { main: css("--color-pass") || "#22c55e" },
          background: { default: css("--bg-base"), paper: css("--bg-surface") },
          text:       { primary: css("--text-primary"), secondary: css("--text-secondary") },
          divider:    css("--border-color"),
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

      setMuiTheme(t);
      setProvider(() => TP as unknown as MuiProviderComponent);
      setMuiError(false);
    } catch (e) {
      // @mui/material not installed — fail silently, render without MUI ThemeProvider
      console.warn("MUI ThemeProvider: @mui/material not found. Run: npm i @mui/material @emotion/react @emotion/styled");
      setMuiError(true);
      setProvider(null);
    }
  }, [theme, muiConfig]);

  useEffect(() => { buildMuiTheme(); }, [buildMuiTheme]);

  if (muiConfig.active && muiError) {
    // Show a non-blocking banner — the app still works with Tailwind
    return (
      <>
        <div className="fixed top-0 left-0 right-0 z-[9999] bg-pend/90 text-white text-xs py-1.5 px-4 text-center">
          ⚠️ MUI ThemeProvider active but <code>@mui/material</code> is not installed.
          Run <code className="font-mono bg-black/20 px-1 rounded">npm i @mui/material @emotion/react @emotion/styled</code> — app continues with Tailwind.
        </div>
        {children}
      </>
    );
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

  useEffect(() => {
    if (!isAuthenticated) return;
    supabase
      .from("modules")
      .select("*")
      .then(({ data, error }) => {
        if (!error && data) setModules(data as Module[]);
        else if (error) console.error("Error fetching modules:", error.message);
      });
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
            initialTestId={selectedTestId} onBack={() => setPage("module")} />
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
