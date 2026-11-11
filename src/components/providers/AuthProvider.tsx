'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  getIdToken,
  logout as firebaseLogout,
} from '@/lib/firebase/auth-client';
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
    if (typeof window === 'undefined') {
      return;
    }

    const unsubscribe = onAuthStateChanged((nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });

    return () => {
      unsubscribe();
    };
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
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
};
