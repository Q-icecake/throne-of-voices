import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const directory = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: directory('./client'),
  appType: 'mpa',
  publicDir: false,
  envDir: false,
  envPrefix: [],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    cors: false,
    fs: {
      strict: true,
      allow: [directory('./client'), directory('./shared')],
      deny: ['**/server/**', '**/artifacts/**', '**/tests/**', '**/scripts/**', '**/.env*', '**/*.{key,pem}', '**/.git/**'],
    },
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
  build: { outDir: directory('./dist'), emptyOutDir: true, sourcemap: false },
});
