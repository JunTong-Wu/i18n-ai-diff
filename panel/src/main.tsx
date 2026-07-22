import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Toaster } from './components/ui/sonner';
import { PanelI18nProvider } from './i18n';
import './styles/tailwind.css';
import './styles/index.scss';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PanelI18nProvider>
      <App />
      <Toaster />
    </PanelI18nProvider>
  </StrictMode>,
);
