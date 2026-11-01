import { loadHeartbeat } from '../../heartbeat/data';
import { screenStore } from '../stores/screen-store';
import type {
    BusMessage,
    HelloBusMessage,
    MapViewOverride,
    ScreenMapViewMessage,
    ScreenStoreState
} from '../types';
import { BusEngine } from './bus-engine';

export class ScreenEngine extends BusEngine<ScreenStoreState> {
    // The heartbeat download in progress, shared by every caller so the
    // ~6 MB counts file is only fetched once. Cleared when it finishes.
    private heartbeatRequest: Promise<void> | null = null;

    private constructor() {
        super('screen', screenStore);
        // Start loading early so the first render after the route mounts has data asap.
        void this.ensureHeartbeatLoaded();
    }

    static getInstance() {
        const globalWithScreenEngine = globalThis as typeof globalThis & {
            __screenEngineInstance?: ScreenEngine;
        };

        if (!globalWithScreenEngine.__screenEngineInstance) {
            globalWithScreenEngine.__screenEngineInstance = new ScreenEngine();
        }

        return globalWithScreenEngine.__screenEngineInstance;
    }

    // Merge operator camera changes into the overrides, keeping fields not mentioned.
    setMapViewOverride(view: MapViewOverride) {
        this.store.setState((prev) => ({
            ...prev,
            mapViewOverride: {
                ...prev.mapViewOverride,
                ...view
            }
        }));
    }

    // Load the heartbeat into the store unless it is already there. Callers
    // during a download wait for that same download; after a failure the
    // next call tries again.
    ensureHeartbeatLoaded(): Promise<void> {
        // Nothing to load during server rendering
        if (typeof window === 'undefined') return Promise.resolve();
        if (this.store.state.heartbeat) return Promise.resolve();

        this.heartbeatRequest ??= this.loadHeartbeatIntoStore().finally(() => {
            this.heartbeatRequest = null;
        });
        return this.heartbeatRequest;
    }

    private async loadHeartbeatIntoStore() {
        this.store.setState((prev) => ({
            ...prev,
            heartbeatStatus: 'loading',
            heartbeatError: null
        }));

        try {
            const heartbeat = await loadHeartbeat();
            this.store.setState((prev) => ({
                ...prev,
                heartbeat,
                heartbeatStatus: 'ready'
            }));
        } catch (error) {
            // Keep the message so the screen can show what went wrong
            this.store.setState((prev) => ({
                ...prev,
                heartbeatStatus: 'error',
                heartbeatError: error instanceof Error ? error.message : String(error)
            }));
        }
    }

    protected override onMessage(message: BusMessage) {
        if (message.type === 'screen/map-view') {
            this.setMapViewOverride(validMapViewFields((message as ScreenMapViewMessage).view));
        }
    }

    protected override onHello(hello: HelloBusMessage) {
        if (!hello.state) return;
        // The bus snapshot is the wall's current camera, so it replaces any local
        // overrides rather than adding to them.
        const mapViewOverride = validMapViewFields(hello.state.mapViewOverride);
        this.store.setState((prev) => ({ ...prev, mapViewOverride }));
    }
}

const MAP_VIEW_FIELDS = ['longitude', 'latitude', 'zoom', 'bearing', 'pitch'] as const;

// Network payloads are untrusted: keep only camera fields that are finite numbers.
function validMapViewFields(view: unknown): MapViewOverride {
    if (typeof view !== 'object' || view === null) return {};
    const candidate = view as Record<string, unknown>;
    const valid: MapViewOverride = {};
    for (const key of MAP_VIEW_FIELDS) {
        const value = candidate[key];
        if (typeof value === 'number' && Number.isFinite(value)) valid[key] = value;
    }
    return valid;
}

export const screenEngine = ScreenEngine.getInstance();
