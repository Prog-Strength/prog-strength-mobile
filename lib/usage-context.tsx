/**
 * Daily AI-usage state (GET /me/usage). The Settings usage section and
 * the capped-aware chat composer read one snapshot. Same lazy-fetch
 * contract as profile-context: the (tabs) auth gate triggers the first
 * refresh; the chat screen re-refreshes after each completed turn so
 * the cap engages without an app restart.
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { getMyUsage, type UsageData } from "@/lib/api";
import { getToken } from "@/lib/auth";

type UsageContextValue = {
  usage: UsageData | null;
  refresh: () => Promise<void>;
};

const UsageContext = createContext<UsageContextValue | null>(null);

export function UsageProvider({ children }: { children: ReactNode }) {
  const [usage, setUsage] = useState<UsageData | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const token = await getToken();
    if (!token) return;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setUsage(await getMyUsage(token, tz));
    } catch {
      // Usage is advisory UI — never block the app on it. A failed
      // fetch leaves the previous snapshot (or null = uncapped).
    }
  }, []);

  return <UsageContext.Provider value={{ usage, refresh }}>{children}</UsageContext.Provider>;
}

export function useUsage(): UsageContextValue {
  const ctx = useContext(UsageContext);
  if (!ctx) throw new Error("useUsage must be used within a UsageProvider");
  return ctx;
}
