import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Web projesi yalnızca arayüzü sunar. /api istekleri (Gemini Live WebSocket dahil) backend projesine aktarılır;
// anahtarlar tarayıcıya ya da bu projeye hiç gelmez.
const backend = process.env.BACKEND_URL || 'http://127.0.0.1:5177';
const proxy = { '/api': { target: backend, changeOrigin: false, ws: true } };

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
});
