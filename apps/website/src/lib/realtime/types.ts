import type { HeartbeatData } from '../heartbeat/data';

export type BusMessage = {
    // Keep message kinds namespaced (`control/*`, `screen/*`).
    type: string;
    peerId?: string;
    peerCount?: number;
    [key: string]: unknown;
};

export type HelloBusMessage = BusMessage & {
    type: 'hello';
    peerId: string;
    state?: BusSharedState;
};

export type ControlSliderMessage = BusMessage & {
    type: 'control/slider';
    value: number;
};

export type ScreenSegmentSelectionMessage = BusMessage & {
    type: 'screen/segment-selection';
    indexes: number[];
};

export type MapCity = 'london' | 'paris' | 'berlin' | 'madrid' | 'rome' | 'amsterdam';

export type BusSharedState = {
    city: MapCity;
    zoom: number;
    selectedSegmentIndexes: number[];
};

export type ScreenMapViewState = {
    longitude: number;
    latitude: number;
    zoom: number;
    bearing: number;
    pitch: number;
};

export type ScreenMapViewMessage = BusMessage & {
    type: 'screen/map-view';
    view: Partial<ScreenMapViewState>;
    city?: MapCity;
};

export type ArcSegment = {
    id: string;
    start: [number, number];
    end: [number, number];
    weight: number;
};

export type EngineRole = 'screen' | 'control';

export type EngineConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export type EngineStoreState = {
    role: EngineRole;
    peerId: string | null;
    connection: EngineConnectionState;
    messageCount: number;
    lastMessageType: string | null;
    lastMessageAt: number | null;
    lastError: string | null;
};

export const createInitialEngineStoreState = (role: EngineRole): EngineStoreState => ({
    role,
    peerId: null,
    connection: 'idle',
    messageCount: 0,
    lastMessageType: null,
    lastMessageAt: null,
    lastError: null
});

export type ControlStoreState = EngineStoreState & {
    sliderValue: number;
    isSliderInteracting: boolean;
    selectedCity: MapCity;
    selectedSegmentIndexes: number[];
};

// Progress of loading the heartbeat files into the screen store
export type HeartbeatStatus = 'idle' | 'loading' | 'ready' | 'error';

export type ScreenStoreState = EngineStoreState & {
    mapView: ScreenMapViewState;
    arcSegments: ArcSegment[];
    selectedSegmentIndexes: number[];
    isArcSegmentsLoading: boolean;
    // Null until loaded; see `ScreenEngine.ensureHeartbeatLoaded`
    heartbeat: HeartbeatData | null;
    heartbeatStatus: HeartbeatStatus;
    heartbeatError: string | null;
};

export const createInitialControlStoreState = (): ControlStoreState => ({
    ...createInitialEngineStoreState('control'),
    sliderValue: 25,
    isSliderInteracting: false,
    selectedCity: 'london',
    selectedSegmentIndexes: []
});

export const createInitialScreenStoreState = (): ScreenStoreState => ({
    ...createInitialEngineStoreState('screen'),
    mapView: {
        longitude: -0.1749,
        latitude: 51.4988,
        zoom: 9,
        bearing: 0,
        pitch: 0
    },
    arcSegments: [],
    selectedSegmentIndexes: [],
    isArcSegmentsLoading: false,
    heartbeat: null,
    heartbeatStatus: 'idle',
    heartbeatError: null
});
