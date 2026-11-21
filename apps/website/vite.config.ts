import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite-plus';

// Where the site is served from: '/' by default (development, the wall), or a
// sub-path such as '/data_observatory/' for GitHub Pages
const basePath = process.env.BASE_PATH ?? '/';

export default defineConfig({
    base: basePath,
    resolve: {
        tsconfigPaths: true
    },
    server: {
        port: 5780,
        watch: {
            usePolling: true,
            interval: 100
        }
    },
    css: {
        transformer: 'lightningcss',
        lightningcss: {
            cssModules: true
        }
    },
    plugins: [
        devtools({
            consolePiping: { enabled: false }
        }),
        tanstackStart({
            // The public /explore page is also written out as static HTML, so it
            // can be hosted without the server (the wall's routes still need it)
            prerender: {
                enabled: true,
                crawlLinks: false,
                filter: ({ path }) => path === '/explore'
            },
            pages: [{ path: '/explore' }]
        }),
        // https://tanstack.com/start/latest/docs/framework/react/guide/hosting
        nitro({
            features: { websocket: true }
        }),
        viteReact(),
        // https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md#react-compiler
        babel({
            presets: [
                reactCompilerPreset({
                    target: '19'
                })
            ]
        }),
        tailwindcss()
    ]
});
