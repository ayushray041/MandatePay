import React, { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, getCurrentUser, getIdToken, logout as firebaseLogout } from '@/lib/firebase/auth-client';
import type { User } from 'firebase/auth';

interface AuthContextProps {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
}

const AuthContext = createContext<AuthContextProps | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // onAuthStateChanged works only in browser; guard for SSR.
    if (typeof window === 'undefined') {
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged((u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    await firebaseLogout();
    setUser(null);
  };

  const fetchIdToken = (force = false) => getIdToken(force);

  const contextValue: AuthContextProps = {
    user,
    loading,
    logout: handleLogout,
    getIdToken: fetchIdToken,
  };

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};
