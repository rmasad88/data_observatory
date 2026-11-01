import type { HeartbeatData } from '../heartbeat/data';
import type { PlaybackCommand, PlaybackState } from '../playback';

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
    // Bus server's clock (ms), so clients can line their clocks up with it
    serverNow?: number;
};

// Control -> bus: change playback. The bus applies it and replies to everyone
// with a `playback/state` message.
export type PlaybackSetMessage = BusMessage & {
    type: 'playback/set';
    command: PlaybackCommand;
};

// Bus -> everyone: the wall's playback after a change, with the server's clock
export type PlaybackStateMessage = BusMessage & {
    type: 'playback/state';
    state: PlaybackState;
    serverNow: number;
};

export type ScreenMapViewState = {
    longitude: number;
    latitude: number;
    zoom: number;
    bearing: number;
    pitch: number;
};

// Central London. Screens show this until the stations load, then fit the
// camera to them (see `fitPositionsToWall`).
export const DEFAULT_MAP_VIEW: ScreenMapViewState = {
    longitude: -0.1749,
    latitude: 51.4988,
    zoom: 9,
    bearing: 0,
    pitch: 0
};

// Camera fields an operator has changed, laid over each screen's fitted view.
// Empty means "show the fitted view".
export type MapViewOverride = Partial<ScreenMapViewState>;

// Collaborative state the bus replays to late joiners in its `hello` message
export type BusSharedState = {
    mapViewOverride: MapViewOverride;
    playback: PlaybackState;
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
    mapViewOverride: MapViewOverride;
    // Null until loaded; see `ScreenEngine.ensureHeartbeatLoaded`
    heartbeat: HeartbeatData | null;
    heartbeatStatus: HeartbeatStatus;
    heartbeatError: string | null;
    // Null until the bus sends it (in `hello` or a `playback/state` message)
    playback: PlaybackState | null;
    // Add to this screen's Date.now() to get the bus server's time
    clockOffsetMs: number;
};

export const createInitialControlStoreState = (): ControlStoreState =>
    createInitialEngineStoreState('control');

export const createInitialScreenStoreState = (): ScreenStoreState => ({
    ...createInitialEngineStoreState('screen'),
    mapViewOverride: {},
    heartbeat: null,
    heartbeatStatus: 'idle',
    heartbeatError: null,
    playback: null,
    clockOffsetMs: 0
});
