import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 迷你窗口的独立渲染构建:
// - root 指向自己的页面目录(带独立 index.html),与主窗口的页面分开
// - outDir 显式保持 forge 约定的 .vite/renderer/mini_window(不随 root 变),
//   主进程按 MINI_WINDOW_VITE_NAME 拼路径加载
export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer-mini', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('./.vite/renderer/mini_window', import.meta.url)),
    emptyOutDir: true,
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
