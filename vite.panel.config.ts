import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const panelApiOrigin = process.env.PANEL_API_ORIGIN || 'http://127.0.0.1:4188';
const panelDevHost = process.env.PANEL_DEV_HOST || '0.0.0.0';

export default defineConfig({
  root: fileURLToPath(new URL('./panel', import.meta.url)),
  plugins: [react()],
  server: {
    host: panelDevHost,
    port: Number(process.env.PANEL_DEV_PORT || 4187),
    strictPort: true,
    proxy: {
      '/api': {
        target: panelApiOrigin,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', proxyReq => {
            proxyReq.setHeader('origin', panelApiOrigin);
          });
        },
      },
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/panel/client', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
  },
});
