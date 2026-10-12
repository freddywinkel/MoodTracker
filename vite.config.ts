import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
export default defineConfig({
  base: '/MoodTracker/',
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(process.env.MOOD_BUILD_ID || pkg.version) },
  build: { outDir: process.env.MOOD_OUT_DIR || 'dist', sourcemap: false },
  test: { environment: 'node', include: ['src/**/*.test.ts'], setupFiles: ['./src/test-setup.ts'] },
});
