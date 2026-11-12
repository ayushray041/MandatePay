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
  initializeAuthPersistence,
  logout as firebaseLogout,
} from '@/lib/firebase/auth-client';
import { firebaseApp } from '@/lib/firebase/client';
import type { User } from 'firebase/auth';

interface AuthContextProps {
  user: User | null;
  loading: boolean;
  error: string | null;
  logout: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
}

const AuthContext = createContext<AuthContextProps | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(Boolean(firebaseApp));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !firebaseApp) {
      return;
    }

    let active = true;
    let unsubscribe: (() => void) | undefined;

    void initializeAuthPersistence()
      .then(() => {
        if (!active) {
          return;
        }

        unsubscribe = onAuthStateChanged((nextUser) => {
          setUser(nextUser);
          setError(null);
          setLoading(false);
        });
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to initialize Firebase Authentication.',
          );
          setLoading(false);
        }
      });

    return () => {
      active = false;
      unsubscribe?.();
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
    error,
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
