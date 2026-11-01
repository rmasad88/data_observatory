import {
    createRootRouteWithContext,
    HeadContent,
    Outlet,
    ScriptOnce,
    Scripts
} from '@tanstack/react-router';

import { ThemeProvider } from '../lib/theme-provider';

import appCss from '../style.css?url';

export const Route = createRootRouteWithContext()({
    head: () => ({
        meta: [
            {
                charSet: 'utf-8'
            },
            {
                name: 'viewport',
                content: 'width=device-width, initial-scale=1'
            },
            {
                title: 'London cycling heartbeat'
            },
            {
                name: 'description',
                content:
                    'Two weeks of London cycle hire journeys, played back across the Data Observatory wall'
            }
        ],
        links: [
            {
                rel: 'icon',
                href: '/favicon.ico'
            },
            { rel: 'stylesheet', href: appCss }
        ]
    }),
    component: RootComponent
});

function RootComponent() {
    // Route outlet is wrapped by the root document shell to share theme/scripts/head.
    return (
        <RootDocument>
            <Outlet />
        </RootDocument>
    );
}

function RootDocument({ children }: { readonly children: React.ReactNode }) {
    return (
        <html lang="en">
            <head>
                <HeadContent />
            </head>
            <body>
                {/*
                  Hydration strategy:
                  - We set the `dark` class before React hydrates so the initial server HTML and
                    first painted client frame use the same color theme.
                  - Without this early script, React would hydrate into a different class state
                    and users would see a flash of incorrect theme (FOUC).
                  - `ScriptOnce` guarantees this bootstrap script only executes once per document,
                    even as routes change.
                */}
                <ScriptOnce>
                    {`document.documentElement.classList.toggle(
              'dark',
              localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)
          );`}
                </ScriptOnce>
                {/* ThemeProvider keeps theme state in sync across routes, tabs, and iframes. */}
                <ThemeProvider>{children}</ThemeProvider>
                <Scripts />
            </body>
        </html>
    );
}
