import "./App.css";

import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";

import { Toaster } from "./components/ui/sonner";

import { AuthProvider, useAuth } from "./context/AuthContext";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";

import { ShieldAlert } from "lucide-react";

const TOASTER_OPTIONS = {
  style: {
    background: "#102540",
    border: "1px solid #1c3557",
    color: "#e7edf6",
  },
};

function PageTransition({ children }) {
  const location = useLocation();

  return (
    <div
      key={location.pathname}
      className="scc-page-transition min-h-screen"
    >
      {children}
    </div>
  );
}

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
    <PageTransition>
      <Routes>
        <Route
          path="/login"
          element={
            user ? <Navigate to="/cases" replace /> : <Login />
          }
        />

        <Route
          path="/cases"
          element={
            user ? <Dashboard /> : <Navigate to="/login" replace />
          }
        />

        <Route
          path="/"
          element={
            <Navigate
              to={user ? "/cases" : "/login"}
              replace
            />
          }
        />

        <Route
          path="*"
          element={
            <Navigate
              to={user ? "/cases" : "/login"}
              replace
            />
          }
        />
      </Routes>
    </PageTransition>
  );
}

function App() {
  return (
    <div className="App scc-scanlines scc-vignette">
      <AuthProvider>
        <BrowserRouter>
          <Gate />
        </BrowserRouter>

        <Toaster
          position="top-right"
          toastOptions={TOASTER_OPTIONS}
        />
      </AuthProvider>

      <style>{`
        .scc-page-transition {
          animation: scc-page-enter 320ms cubic-bezier(0.22, 1, 0.36, 1);
          will-change: opacity, transform;
        }

        @keyframes scc-page-enter {
          from {
            opacity: 0;
            transform: translateY(8px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .scc-page-transition {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

export default App;