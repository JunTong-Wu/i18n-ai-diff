import { useEffect, useRef } from 'react';
import { usePanelI18n } from '../../i18n';
import { toast } from '../ui/sonner';
import { normalizePanelErrorMessage } from './panelErrorMessages';

export function usePanelErrorToast(error: string | null, title: string) {
  const { t } = usePanelI18n();
  const lastErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!error) {
      lastErrorRef.current = null;
      return;
    }
    if (lastErrorRef.current === error) return;
    lastErrorRef.current = error;
    toast.error(title, { description: normalizePanelErrorMessage(error, t) });
  }, [error, title, t]);
}
