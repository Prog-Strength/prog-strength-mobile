// Ticking clock hook for the live-workout surface. Returns `Date.now()`
// and re-renders the caller every `intervalMs` so duration/countdown
// displays stay current. The interval is torn down on unmount and
// re-armed if the interval changes.
import { useEffect, useState } from "react";

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
