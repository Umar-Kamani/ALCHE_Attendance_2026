import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeResponse, User } from '@alche/shared';
import { apiFetch } from '../lib/api';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  signOutLocal: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      try {
        return await apiFetch<MeResponse>('/auth/me');
      } catch (error) {
        if (error instanceof Error && 'status' in error && (error as { status?: number }).status === 401) {
          return null;
        }
        throw error;
      }
    },
    retry: false,
    staleTime: 30_000,
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      user: query.data?.user ?? null,
      isLoading: query.isLoading,
      refresh: async () => {
        await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      },
      signOutLocal: () => {
        queryClient.setQueryData(['auth', 'me'], null);
        queryClient.clear();
      },
    }),
    [query.data, query.isLoading, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
