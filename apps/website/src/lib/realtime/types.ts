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

export type ScreenMapViewState = {
    longitude: number;
    latitude: number;
    zoom: number;
    bearing: number;
    pitch: number;
};

// Central London, where the docking stations are; screens start here
export const DEFAULT_MAP_VIEW: ScreenMapViewState = {
    longitude: -0.1749,
    latitude: 51.4988,
    zoom: 9,
    bearing: 0,
    pitch: 0
};

// Collaborative state the bus replays to late joiners in its `hello` message
export type BusSharedState = {
    mapView: ScreenMapViewState;
};

export type ScreenMapViewMessage = BusMessage & {
    type: 'screen/map-view';
    view: Partial<ScreenMapViewState>;
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

// Playback controls will add their state here
export type ControlStoreState = EngineStoreState;

// Progress of loading the heartbeat files into the screen store
export type HeartbeatStatus = 'idle' | 'loading' | 'ready' | 'error';

export type ScreenStoreState = EngineStoreState & {
    mapView: ScreenMapViewState;
    // Null until loaded; see `ScreenEngine.ensureHeartbeatLoaded`
    heartbeat: HeartbeatData | null;
    heartbeatStatus: HeartbeatStatus;
    heartbeatError: string | null;
};

export const createInitialControlStoreState = (): ControlStoreState =>
    createInitialEngineStoreState('control');

export const createInitialScreenStoreState = (): ScreenStoreState => ({
    ...createInitialEngineStoreState('screen'),
    mapView: DEFAULT_MAP_VIEW,
    heartbeat: null,
    heartbeatStatus: 'idle',
    heartbeatError: null
});
