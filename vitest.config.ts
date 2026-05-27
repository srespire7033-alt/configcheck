import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // .claude/worktrees stores transient Claude Code worktree copies — those
    // duplicate e2e specs aren't real tests in this checkout. Excluding the
    // whole directory plus .next prevents false-positive failures from those
    // mirror copies and from generated Next.js output.
    exclude: ['e2e/**', 'node_modules/**', '.claude/worktrees/**', '.next/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
