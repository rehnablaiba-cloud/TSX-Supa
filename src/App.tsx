import React, { useState, useEffect } from "react";
import { useAuth } from "./context/AuthContext";  // Update this to Supabase auth context
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
import { supabase } from "./lib/supabase";  // Your Supabase client [web:31]

type Page = "dashboard" | "module" | "execution" | "report" | "users" | "auditlog";

// ─── Inner app (needs ThemeProvider above it) ─────────────────────────────────
const AppInner: React.FC = () => {
  const { isLoading, isAuthenticated } = useAuth();  // Now from Supabase auth context
  const [page, setPage] = useState<Page>("dashboard");
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  
  // Supabase modules query replacement
  const [modules, setModules] = useState<Module[]>([]);
  const [modulesLoading, setModulesLoading] = useState(true);
  const selectedModule = modules.find(m => m.id === selectedModuleId);

  // Fetch modules with Supabase (runs only when authenticated)
  useEffect(() => {
    if (!isAuthenticated) {
      setModulesLoading(false);
      return;
    }

    const fetchModules = async () => {
      setModulesLoading(true);
      const { data, error } = await supabase
        .from('modules')  // Assumes 'modules' table in Supabase
        .select('*');     // Match your Module type [web:31]

      if (error) {
        console.error('Error fetching modules:', error);
      } else {
        setModules(data || []);
      }
      setModulesLoading(false);
    };

    fetchModules();
  }, [isAuthenticated]);

  if (isLoading || modulesLoading) {
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
        return <Dashboard onNavigate={navigate} modules={modules} />;  // Pass modules prop
      case "module":
        return selectedModule ? (
          <ModuleDashboard
            moduleId={selectedModule.id}
            moduleName={selectedModule.name}
            onBack={() => setPage("dashboard")}
            onExecute={(testId) => { setSelectedTestId(testId); setPage("execution"); }}
          />
        ) : (
          <Dashboard onNavigate={navigate} modules={modules} />
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
          <Dashboard onNavigate={navigate} modules={modules} />
        );
      case "report":
        return <TestReport />;
      case "users":
        return <UsersPanel />;
      case "auditlog":
        return <AuditLog />;
      default:
        return <Dashboard onNavigate={navigate} modules={modules} />;
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