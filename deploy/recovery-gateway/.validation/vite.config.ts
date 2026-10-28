import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { outDir: '.validation/dist', rollupOptions: { external: ['@appdeploy/client'] } },
});
