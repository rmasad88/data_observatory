import { loadHeartbeat } from '../../heartbeat/data';
import { screenStore } from '../stores/screen-store';
import type {
    BusMessage,
    HelloBusMessage,
    ScreenMapViewMessage,
    ScreenMapViewState,
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

    setMapView(view: Partial<ScreenMapViewState>) {
        // Merge patch updates so callers can provide only changed camera fields.
        this.store.setState((prev) => ({
            ...prev,
            mapView: {
                ...prev.mapView,
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
            this.applyMapView((message as ScreenMapViewMessage).view);
        }
    }

    protected override onHello(hello: HelloBusMessage) {
        // Late joiners take the wall's current camera from the bus snapshot, via the
        // same path as live updates so both behave identically.
        if (hello.state) this.applyMapView(hello.state.mapView);
    }

    private applyMapView(view: unknown) {
        // Network payloads are untrusted: only take fields that are numbers.
        if (typeof view !== 'object' || view === null) return;
        const candidate = view as Partial<Record<keyof ScreenMapViewState, unknown>>;
        const current = this.store.state.mapView;
        const pick = (key: keyof ScreenMapViewState) =>
            typeof candidate[key] === 'number' ? candidate[key] : current[key];

        this.setMapView({
            longitude: pick('longitude'),
            latitude: pick('latitude'),
            zoom: pick('zoom'),
            bearing: pick('bearing'),
            pitch: pick('pitch')
        });
    }
}

export const screenEngine = ScreenEngine.getInstance();
