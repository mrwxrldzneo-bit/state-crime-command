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

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    const token = localStorage.getItem("scc_token");
    const stored = localStorage.getItem("scc_user");

    if (!token || !stored) {
      setUser(null);
      return;
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
    try {
      const { data } = await api.post("/auth/login", {
        username: username.trim(),
        password,
      });

      localStorage.setItem("scc_token", data.token);

      const authenticatedUser = {
        username: data.username,
        role: data.role,
      };

      localStorage.setItem(
        "scc_user",
        JSON.stringify(authenticatedUser)
      );

      setUser(authenticatedUser);

      return { ok: true };
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

  const logout = useCallback(() => {
    localStorage.removeItem("scc_token");
    localStorage.removeItem("scc_user");
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      login,
      logout,
      isAdmin: user?.role === "admin",
    }),
    [user, login, logout]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);