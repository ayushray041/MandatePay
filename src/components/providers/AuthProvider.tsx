'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  getIdToken,
  getCurrentUser,
  initializeAuthPersistence,
  logout as firebaseLogout,
} from '@/lib/firebase/auth-client';
import { firebaseApp } from '@/lib/firebase/client';
import { getApiErrorMessage } from '@/lib/api/client-errors';
import { userProfileSchema, type UserProfile } from '@/models/user';
import type { User } from 'firebase/auth';

interface AuthContextProps {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  logout: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextProps | undefined>(undefined);

async function fetchUserProfile(user: User): Promise<UserProfile> {
  const token = await user.getIdToken();
  const response = await fetch('/api/users/me', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Your profile could not be loaded.'));
  }

  const payload: unknown = await response.json();
  if (typeof payload !== 'object' || payload === null || !('data' in payload)) {
    throw new Error('Profile API returned an invalid response.');
  }

  const parsedProfile = userProfileSchema.safeParse(payload.data);
  if (!parsedProfile.success || parsedProfile.data.uid !== user.uid) {
    throw new Error('The authenticated user profile is invalid.');
  }

  return parsedProfile.data;
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(Boolean(firebaseApp));
  const [error, setError] = useState<string | null>(null);
  const profileRequestRef = useRef(0);

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
          const currentRequest = ++profileRequestRef.current;
          setUser(nextUser);
          setProfile(null);
          setError(null);

          if (!nextUser) {
            setLoading(false);
            return;
          }

          setLoading(true);
          void (async () => {
            try {
              const nextProfile = await fetchUserProfile(nextUser);

              if (active && currentRequest === profileRequestRef.current) {
                setProfile(nextProfile);
              }
            } catch (caughtError: unknown) {
              if (active && currentRequest === profileRequestRef.current) {
                setError(
                  caughtError instanceof Error
                    ? caughtError.message
                    : 'Your profile could not be loaded.',
                );
              }
            } finally {
              if (active && currentRequest === profileRequestRef.current) {
                setLoading(false);
              }
            }
          })();
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
      profileRequestRef.current += 1;
      unsubscribe?.();
    };
  }, []);

  const handleLogout = async () => {
    await firebaseLogout();
    setUser(null);
    setProfile(null);
  };

  const refreshProfile = async () => {
    const currentUser = getCurrentUser();
    if (!currentUser) {
      throw new Error('Sign in before loading your profile.');
    }

    const currentRequest = ++profileRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const currentProfile = await fetchUserProfile(currentUser);
      if (currentRequest === profileRequestRef.current) {
        setUser(currentUser);
        setProfile(currentProfile);
      }
    } catch (caughtError: unknown) {
      if (currentRequest === profileRequestRef.current) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Your profile could not be loaded.',
        );
      }
      throw caughtError;
    } finally {
      if (currentRequest === profileRequestRef.current) {
        setLoading(false);
      }
    }
  };

  const fetchIdToken = (force = false) => getIdToken(force);

  const contextValue: AuthContextProps = {
    user,
    profile,
    loading,
    error,
    logout: handleLogout,
    getIdToken: fetchIdToken,
    refreshProfile,
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
