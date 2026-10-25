import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { apiRequest, queryClient, API_BASE } from "./queryClient";

export type AuthUser = {
  id: number;
  username: string;
  email: string;
  role: string;
};

type AuthState = {
  user: AuthUser | null;
  isLoading: boolean;
  login: (identifier: string, password: string, role?: "owner" | "it") => Promise<AuthUser>;
  signup: (
    username: string,
    email: string,
    password: string,
    inviteCode: string
  ) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user ?? null);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (identifier: string, password: string, role?: "owner" | "it") => {
    const res = await apiRequest("POST", "/api/auth/login", {
      identifier,
      password,
      ...(role ? { role } : {}),
    });
    const data = await res.json();
    setUser(data.user);
    await queryClient.invalidateQueries();
    return data.user as AuthUser;
  }, []);

  const signup = useCallback(
    async (
      username: string,
      email: string,
      password: string,
      inviteCode: string
    ) => {
      const res = await apiRequest("POST", "/api/auth/signup", {
        username,
        email,
        password,
        inviteCode,
      });
      const data = await res.json();
      setUser(data.user);
      await queryClient.invalidateQueries();
      return data.user as AuthUser;
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch {
      // even if server logout fails, clear local state
    }
    setUser(null);
    await queryClient.invalidateQueries();
  }, []);

  const value: AuthState = { user, isLoading, login, signup, logout, refresh };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
