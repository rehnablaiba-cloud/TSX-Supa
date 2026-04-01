import React, { useState, useEffect } from "react";
import { useSession, useSupabaseClient } from "@supabase/auth-helpers-react";
import { ThemeProvider } from "./context/ThemeContext";
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
import { Module } from "./types";

type Page = "dashboard" | "module" | "execution" | "report" | "users" | "auditlog";

// ─── Inner app ────────────────────────────────────────────────────────────────
const AppInner: React.FC = () => {
  const session = useSession();
  const supabase = useSupabaseClient();

  const isAuthenticated = session !== null;
  const [isLoading, setIsLoading]               = useState(true);
  const [modules, setModules]                   = useState<Module[]>([]);
  const [page, setPage]                         = useState<Page>("dashboard");
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [selectedTestId, setSelectedTestId]     = useState<string | null>(null);

  // Fetch modules when authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      setIsLoading(false);
      return;
    }

    const fetchModules = async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("modules")
        .select("*");

      if (!error && data) {
        setModules(data as Module[]);
      } else if (error) {
        console.error("Error fetching modules:", error.message);
      }
      setIsLoading(false);
    };

    fetchModules();
  }, [isAuthenticated, supabase]);

  const selectedModule = modules.find((m) => m.id === selectedModuleId);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <Spinner size={48} />
      </div>
    );
  }

  if (!isAuthenticated) return <LoginPage />;

  const navigate = (p: string, moduleId?: string) => {
    if (p === "module" && moduleId) {
      setSelectedModuleId(moduleId);
      setPage("module");
    } else {
      setPage(p as Page);
    }
  };

  const renderPage = () => {
    switch (page) {
      case "dashboard":
        return <Dashboard onNavigate={navigate} />;
      case "module":
        return selectedModule ? (
          <ModuleDashboard
            moduleId={selectedModule.id}
            moduleName={selectedModule.name}
            onBack={() => setPage("dashboard")}
            onExecute={(testId) => {
              setSelectedTestId(testId);
              setPage("execution");
            }}
          />
        ) : (
          <Dashboard onNavigate={navigate} />
        );
      case "execution":
        return selectedModule && selectedTestId ? (
          <TestExecution
            moduleId={selectedModule.id}
            moduleName={selectedModule.name}
            initialTestId={selectedTestId}
            onBack={() => setPage("module")}
          />
        ) : (
          <Dashboard onNavigate={navigate} />
        );
      case "report":
        return <TestReport />;
      case "users":
        return <UsersPanel />;
      case "auditlog":
        return <AuditLog />;
      default:
        return <Dashboard onNavigate={navigate} />;
    }
  };

  return (
    <div className="flex min-h-screen bg-gray-950">
      <Sidebar activePage={page} onNavigate={navigate} />
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {renderPage()}
      </main>
      <MobileNav activePage={page} onNavigate={(p) => navigate(p)} />
    </div>
  );
};

// ─── Root: wrap with ThemeProvider ────────────────────────────────────────────
const App: React.FC = () => (
  <ThemeProvider>
    <AppInner />
  </ThemeProvider>
);

export default App;