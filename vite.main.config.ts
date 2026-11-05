import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // node:sqlite 是 Node.js 内置模块，保持外部引用，不参与打包
      external: ['node:sqlite'],
    },
  },
});
