import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import api, { formatApiError } from "../lib/api";

const AuthContext = createContext(null);

const LOCAL_CREDENTIALS = {
  ADMIN: {
    password: "ADMINSCC2026!",
    role: "admin",
  },
  DETECTIVE: {
    password: "NSWPFSCC2026",
    role: "detective",
  },
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    const token = localStorage.getItem("scc_token");
    const stored = localStorage.getItem("scc_user");

    if (!token || !stored) {
      setUser(null);
      return;
    }

    if (token === "clearance_approved_bypass_token") {
      try {
        setUser(JSON.parse(stored));
        return;
      } catch {
        localStorage.removeItem("scc_token");
        localStorage.removeItem("scc_user");
        setUser(null);
        return;
      }
    }

    api
      .get("/auth/me")
      .then((res) => {
        setUser(res.data);
      })
      .catch(() => {
        localStorage.removeItem("scc_token");
        localStorage.removeItem("scc_user");
        setUser(null);
      });
  }, []);

  const login = useCallback(async (username, password) => {
    const checkUser = username.trim().toUpperCase();
    const checkPass = password.trim();

    /*
     * LOCAL SCC CLEARANCE
     *
     * These credentials never contact the backend.
     */
    const localAccount = LOCAL_CREDENTIALS[checkUser];

    if (localAccount && checkPass === localAccount.password) {
      const authenticatedUser = {
        username: checkUser,
        role: localAccount.role,
      };

      localStorage.setItem(
        "scc_token",
        "clearance_approved_bypass_token"
      );

      localStorage.setItem(
        "scc_user",
        JSON.stringify(authenticatedUser)
      );

      return {
        ok: true,
        local: true,
        user: authenticatedUser,
      };
    }

    /*
     * DATABASE AUTHENTICATION
     *
     * Any account that isn't one of the local clearance accounts
     * falls through to the backend.
     */
    try {
      const { data } = await api.post("/auth/login", {
        username: username.trim(),
        password,
      });

      const authenticatedUser = {
        username: data.username,
        role: data.role,
      };

      localStorage.setItem("scc_token", data.token);

      localStorage.setItem(
        "scc_user",
        JSON.stringify(authenticatedUser)
      );

      return {
        ok: true,
        local: false,
        user: authenticatedUser,
      };
    } catch (e) {
      return {
        ok: false,
        error:
          formatApiError(e.response?.data?.detail) ||
          e.message ||
          "Authentication failed.",
      };
    }
  }, []);

  /*
   * Called only AFTER Login.jsx finishes its authentication terminal.
   */
  const completeLogin = useCallback(() => {
    const stored = localStorage.getItem("scc_user");

    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {
        setUser(null);
        return;
      }
    }

    window.location.assign("/cases");
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("scc_token");
    localStorage.removeItem("scc_user");
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      login,
      completeLogin,
      logout,
      isAdmin: user?.role === "admin",
    }),
    [user, login, completeLogin, logout]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);