import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = setInterval(update, intervalMs);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') update(); });
    return () => { clearInterval(timer); listener.remove(); };
  }, [intervalMs]);
  return now;
}
