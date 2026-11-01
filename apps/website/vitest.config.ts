import { defineConfig } from 'vite-plus';

// Unit tests run without the app's plugins (TanStack Start, Nitro): those set up
// a dev server and fail under the test runner, and the code under test doesn't
// need them. Vitest uses this file instead of vite.config.ts.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts']
    }
});
