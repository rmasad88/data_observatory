import { loadHeartbeat } from '../../heartbeat/data';
import { loadArcSegmentsDataset } from '../arc-segments';
import { getCityMapView, isMapCity } from '../map-cities';
import { screenStore } from '../stores/screen-store';
import type {
    ArcSegment,
    BusMessage,
    HelloBusMessage,
    ScreenMapViewMessage,
    ScreenMapViewState,
    ScreenSegmentSelectionMessage,
    ScreenStoreState
} from '../types';
import { BusEngine } from './bus-engine';

export class ScreenEngine extends BusEngine<ScreenStoreState> {
    // Guards repeated fetches during retries/rerenders.
    private hasAttemptedArcSegmentLoad = false;
    // The heartbeat download in progress, shared by every caller so the
    // ~6 MB counts file is only fetched once. Cleared when it finishes.
    private heartbeatRequest: Promise<void> | null = null;

    private constructor() {
        super('screen', screenStore);
        // Prime dataset early so first render after route mount has data asap.
        void this.ensureArcSegmentsLoaded();
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

    async ensureArcSegmentsLoaded() {
        if (typeof window === 'undefined') return;
        if (this.hasAttemptedArcSegmentLoad || this.store.state.arcSegments.length > 0) return;

        this.hasAttemptedArcSegmentLoad = true;
        this.store.setState((prev) => ({
            ...prev,
            isArcSegmentsLoading: true
        }));

        try {
            const payload = await loadArcSegmentsDataset();
            if (!payload) {
                throw new Error('Failed to load arc segments');
            }
            const arcSegments = this.parseArcSegments(payload);

            this.store.setState((prev) => ({
                ...prev,
                arcSegments,
                isArcSegmentsLoading: false
            }));
        } catch {
            // Reset guard so a later user action / reconnect can retry loading data.
            this.hasAttemptedArcSegmentLoad = false;
            this.store.setState((prev) => ({
                ...prev,
                isArcSegmentsLoading: false
            }));
        }
    }

    protected override onMessage(message: BusMessage) {
        if (message.type === 'screen/map-view') {
            const mapViewMessage = message as ScreenMapViewMessage;
            this.applyMapViewMessage(mapViewMessage);
            return;
        }

        if (message.type === 'screen/segment-selection') {
            const segmentSelectionMessage = message as ScreenSegmentSelectionMessage;
            this.applySegmentSelection(segmentSelectionMessage.indexes);
        }
    }

    protected override onHello(hello: HelloBusMessage) {
        if (!hello.state) return;
        // Apply the same message handlers used for live events so hello-state and realtime updates
        // follow one code path and stay behaviorally consistent.
        this.applyMapViewMessage({
            type: 'screen/map-view',
            city: hello.state.city,
            view: { zoom: hello.state.zoom }
        });
        this.applySegmentSelection(hello.state.selectedSegmentIndexes);
    }

    private applyMapViewMessage(mapViewMessage: ScreenMapViewMessage) {
        // Start from current state and layer updates in deterministic order:
        // city preset first, then granular overrides from `view`.
        let nextView = this.store.state.mapView;

        if (isMapCity(mapViewMessage.city)) {
            nextView = {
                ...nextView,
                ...getCityMapView(mapViewMessage.city)
            };
        }

        if (mapViewMessage.view && typeof mapViewMessage.view === 'object') {
            const view = mapViewMessage.view;
            nextView = {
                ...nextView,
                longitude: typeof view.longitude === 'number' ? view.longitude : nextView.longitude,
                latitude: typeof view.latitude === 'number' ? view.latitude : nextView.latitude,
                zoom: typeof view.zoom === 'number' ? view.zoom : nextView.zoom,
                bearing: typeof view.bearing === 'number' ? view.bearing : nextView.bearing,
                pitch: typeof view.pitch === 'number' ? view.pitch : nextView.pitch
            };
        }

        this.setMapView(nextView);
    }

    private applySegmentSelection(indexes: unknown) {
        if (!Array.isArray(indexes)) return;

        const sanitizedIndexes = indexes
            .filter((value): value is number => Number.isInteger(value) && value >= 0)
            .slice()
            .sort((a, b) => a - b);

        this.store.setState((prev) => {
            if (arraysEqual(prev.selectedSegmentIndexes, sanitizedIndexes)) return prev;
            return {
                ...prev,
                selectedSegmentIndexes: sanitizedIndexes
            };
        });
    }

    private parseArcSegments(payload: unknown): ArcSegment[] {
        // Runtime validation keeps map rendering resilient against malformed datasets.
        if (!Array.isArray(payload)) return [];

        const segments: ArcSegment[] = [];
        for (const item of payload) {
            if (typeof item !== 'object' || item === null) continue;
            const candidate = item as Partial<ArcSegment>;
            if (
                typeof candidate.id !== 'string' ||
                !Array.isArray(candidate.start) ||
                !Array.isArray(candidate.end) ||
                candidate.start.length !== 2 ||
                candidate.end.length !== 2 ||
                typeof candidate.start[0] !== 'number' ||
                typeof candidate.start[1] !== 'number' ||
                typeof candidate.end[0] !== 'number' ||
                typeof candidate.end[1] !== 'number' ||
                typeof candidate.weight !== 'number'
            ) {
                continue;
            }

            segments.push({
                id: candidate.id,
                // Copy values into fresh tuples to avoid retaining untrusted references.
                start: [candidate.start[0], candidate.start[1]],
                end: [candidate.end[0], candidate.end[1]],
                weight: candidate.weight
            });
        }

        return segments;
    }
}

export const screenEngine = ScreenEngine.getInstance();

function arraysEqual(a: number[], b: number[]) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}
