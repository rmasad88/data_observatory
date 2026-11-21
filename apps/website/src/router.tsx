import { createRouter } from '@tanstack/react-router';

import { DefaultCatchBoundary } from './components/default-catch-boundary';
import { DefaultNotFound } from './components/default-not-found';
import { routeTree } from './routeTree.gen';

export function getRouter() {
    const router = createRouter({
        routeTree,
        // Matches the build's base path, e.g. '/data_observatory/' on GitHub Pages
        basepath: import.meta.env.BASE_URL,
        defaultPreload: 'intent',
        defaultErrorComponent: DefaultCatchBoundary,
        defaultNotFoundComponent: DefaultNotFound,
        scrollRestoration: true,
        defaultStructuralSharing: true
    });
    return router;
}
