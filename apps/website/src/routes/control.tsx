import { createFileRoute } from '@tanstack/react-router';

// Imported for its side effect: creating the engine connects this page to the bus
import '../lib/realtime/engines/control-engine';
import { useControlStore } from '../lib/realtime/stores/control-store';

type ControlSearch = {
    // Optional label so multiple control clients can be distinguished in the simulator.
    operator: string;
};

export const Route = createFileRoute('/control')({
    validateSearch: (search: Record<string, unknown>): ControlSearch => {
        return {
            // Default operator id keeps the route usable when query params are omitted.
            operator: typeof search.operator === 'string' ? search.operator : 'A'
        };
    },
    component: ControlPage
});

function ControlPage() {
    // `/control` models a handheld/operator endpoint:
    // - it sends intent into the websocket bus
    // - it does not render the heavy map visuals itself
    // This separation mirrors operational setups where controllers and wall screens have
    // different hardware constraints and UX goals.
    const { operator } = Route.useSearch();
    const connection = useControlStore((state) => state.connection);

    return (
        <main className="h-screen w-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
            <div className="flex h-full w-full flex-col p-3">
                <header className="mb-3 flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
                    <div>
                        <p className="text-[10px] tracking-[0.2em] text-[var(--muted-foreground)] uppercase">
                            Operator
                        </p>
                        <h1 className="text-sm font-semibold">Control Panel {operator}</h1>
                    </div>
                    <span className="rounded-full bg-[var(--primary)] px-2 py-1 text-[10px] font-medium text-[var(--primary-foreground)]">
                        /control
                    </span>
                </header>

                <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
                    <p className="text-xs text-[var(--muted-foreground)]">
                        Bus connection: {connection}
                    </p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                        Playback controls will appear here.
                    </p>
                </section>
            </div>
        </main>
    );
}
