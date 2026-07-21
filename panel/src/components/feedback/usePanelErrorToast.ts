import { useEffect, useRef } from 'react';
import { toast } from '../ui/sonner';

export function usePanelErrorToast(error: string | null, title: string) {
  const lastErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!error) {
      lastErrorRef.current = null;
      return;
    }
    if (lastErrorRef.current === error) return;
    lastErrorRef.current = error;
    toast.error(title, { description: error });
  }, [error, title]);
}
