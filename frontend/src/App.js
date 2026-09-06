import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import { ShieldAlert } from "lucide-react";

function Gate() {
  const { user } = useAuth();

  if (user === undefined) {
    return (
      <div className="scc-grid-bg min-h-screen flex flex-col items-center justify-center gap-3">
        <ShieldAlert className="h-10 w-10 text-[#d4b25a] animate-pulse" />
        <p className="font-display uppercase tracking-[0.25em] text-sm text-[#8ba0bd]">
          Authenticating…
        </p>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={user ? <Dashboard /> : <Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <div className="App scc-scanlines scc-vignette">
      <AuthProvider>
        <BrowserRouter>
          <Gate />
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}

export default App;
