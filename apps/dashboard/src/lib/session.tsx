import { createContext, useContext, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** Private server data belongs to one in-memory administrator session. */
export function createConsoleQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 15_000, retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false, gcTime: 0 },
    },
  });
}

const SessionContext = createContext<{
  token: string;
  sessionId: string;
  setToken: (token: string, expectedToken?: string) => void;
  logout: () => void;
} | null>(null);

/** Cancel pending reads and discard cached records whenever the operator signs out. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createConsoleQueryClient);
  const [token, setToken] = useState("");
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  function logout() {
    void client.cancelQueries();
    client.clear();
    setToken("");
    setSessionId(crypto.randomUUID());
  }
  return (
    <QueryClientProvider client={client}>
      <SessionContext.Provider
        value={{
          token,
          setToken: (next, expected) =>
            setToken((current) =>
              expected !== undefined && current !== expected ? current : next,
            ),
          sessionId,
          logout,
        }}
      >
        {children}
      </SessionContext.Provider>
    </QueryClientProvider>
  );
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("Missing console session provider");
  return session;
}
