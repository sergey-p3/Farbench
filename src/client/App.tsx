import { useEffect, useState } from "react";
import { api } from "./api.js";
import { Login } from "./components/Login.js";
import { WorkspaceShell } from "./components/WorkspaceShell.js";

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  useEffect(() => {
    void bootstrapAuth();
  }, []);

  async function bootstrapAuth() {
    setIsBootstrapping(true);
    try {
      await api.workspaces();
      setIsAuthenticated(true);
    } catch {
      resetToLogin();
    } finally {
      setIsBootstrapping(false);
    }
  }

  function resetToLogin() {
    setIsAuthenticated(false);
  }

  if (isBootstrapping) {
    return <main className="login-screen"><p className="loading-state">Checking session...</p></main>;
  }

  if (!isAuthenticated) {
    return <Login onLogin={() => setIsAuthenticated(true)} />;
  }

  return <WorkspaceShell onUnauthorized={resetToLogin} />;
}

export default App;
