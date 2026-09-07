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

    if (!token) {
      setUser(null);
      return;
    }

    api
      .get("/auth/me")
      .then((res) => {
        const officerId = localStorage.getItem("scc_officer_id") || "";

        const authenticatedUser = {
          username: res.data.username,
          role: String(res.data.role || "").toLowerCase(),
          officer_id: officerId,
        };

        localStorage.setItem("scc_user", JSON.stringify(authenticatedUser));

        setUser(authenticatedUser);
      })
      .catch(() => {
        localStorage.removeItem("scc_token");
        localStorage.removeItem("scc_user");
        localStorage.removeItem("scc_officer_id");
        setUser(null);
      });
  }, []);

  const login = useCallback(async (username, password, officerId = "") => {
    const cleanUsername = username.trim().toUpperCase();
    const cleanOfficerId = officerId.trim();

    try {
      const { data } = await api.post("/auth/login", {
        username: cleanUsername,
        password,
      });

      const authenticatedUser = {
        username: data.username,
        role: String(data.role || "").toLowerCase(),
        officer_id: cleanOfficerId,
      };

      localStorage.setItem("scc_token", data.token);

      localStorage.setItem("scc_user", JSON.stringify(authenticatedUser));

      if (cleanOfficerId) {
        localStorage.setItem("scc_officer_id", cleanOfficerId);
      } else {
        localStorage.removeItem("scc_officer_id");
      }

      // Do not update React auth state yet.
      // Login.jsx completes the authentication sequence first,
      // then calls completeLogin() to activate the session.
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

  const completeLogin = useCallback(() => {
    const stored = localStorage.getItem("scc_user");

    if (!stored) {
      setUser(null);
      return;
    }

    try {
      const parsedUser = JSON.parse(stored);

      const officerId =
        parsedUser?.officer_id || localStorage.getItem("scc_officer_id") || "";

      setUser({
        ...parsedUser,
        officer_id: officerId,
      });
    } catch {
      setUser(null);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("scc_token");
    localStorage.removeItem("scc_user");
    localStorage.removeItem("scc_officer_id");

    setUser(null);
  }, []);

  const isAdmin = String(user?.role || "").toLowerCase() === "admin";

  const value = useMemo(
    () => ({
      user,
      login,
      completeLogin,
      logout,
      isAdmin,
    }),
    [user, login, completeLogin, logout, isAdmin],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
