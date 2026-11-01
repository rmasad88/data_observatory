import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import type { HeartbeatData } from '../../heartbeat/data';

// Stand-in for the loaded data; the engine only stores it, never inspects it
const FAKE_HEARTBEAT = { stations: [] } as unknown as HeartbeatData;

const loadHeartbeat = vi.fn<() => Promise<HeartbeatData>>();

// The engine is a singleton built when its module is first imported, so each
// test gets a fresh one with the data loader replaced by `loadHeartbeat`.
async function freshScreenEngine() {
    vi.resetModules();
    delete (globalThis as { __screenEngineInstance?: unknown }).__screenEngineInstance;
    vi.doMock('../../heartbeat/data', () => ({ loadHeartbeat }));
    const { screenEngine } = await import('./screen-engine');
    const { screenStore } = await import('../stores/screen-store');
    return { screenEngine, screenStore };
}

beforeEach(() => {
    // A bare `window` lets the engine load data; without `window.location` it
    // still skips opening a WebSocket.
    vi.stubGlobal('window', {});
    loadHeartbeat.mockReset();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('../../heartbeat/data');
});

describe('ensureHeartbeatLoaded', () => {
    it('loads the heartbeat into the store', async () => {
        loadHeartbeat.mockResolvedValue(FAKE_HEARTBEAT);
        const { screenEngine, screenStore } = await freshScreenEngine();

        await screenEngine.ensureHeartbeatLoaded();

        expect(screenStore.state.heartbeat).toBe(FAKE_HEARTBEAT);
        expect(screenStore.state.heartbeatStatus).toBe('ready');
        expect(screenStore.state.heartbeatError).toBeNull();
    });

    it('shares one download between callers', async () => {
        // Hold the download open so every call below arrives while it runs
        let finishDownload: (data: HeartbeatData) => void = () => {};
        loadHeartbeat.mockReturnValue(
            new Promise((resolve) => {
                finishDownload = resolve;
            })
        );
        const { screenEngine, screenStore } = await freshScreenEngine();

        // The constructor has already started the download; these join it
        const calls = [screenEngine.ensureHeartbeatLoaded(), screenEngine.ensureHeartbeatLoaded()];
        expect(screenStore.state.heartbeatStatus).toBe('loading');
        finishDownload(FAKE_HEARTBEAT);
        await Promise.all(calls);

        expect(loadHeartbeat).toHaveBeenCalledTimes(1);
        expect(screenStore.state.heartbeatStatus).toBe('ready');
    });

    it('records a failure, then retries on the next call', async () => {
        loadHeartbeat
            .mockRejectedValueOnce(new Error('Failed to load heartbeat counts: 404'))
            .mockResolvedValue(FAKE_HEARTBEAT);
        const { screenEngine, screenStore } = await freshScreenEngine();

        // The load started by the constructor fails
        await vi.waitFor(() => expect(screenStore.state.heartbeatStatus).toBe('error'));
        expect(screenStore.state.heartbeatError).toMatch(/404/);
        expect(screenStore.state.heartbeat).toBeNull();

        // The next call, e.g. when a screen page opens, tries again
        await screenEngine.ensureHeartbeatLoaded();
        expect(screenStore.state.heartbeatStatus).toBe('ready');
        expect(screenStore.state.heartbeatError).toBeNull();
        expect(loadHeartbeat).toHaveBeenCalledTimes(2);
    });

    it('does nothing during server rendering', async () => {
        vi.unstubAllGlobals();
        const { screenEngine, screenStore } = await freshScreenEngine();

        await screenEngine.ensureHeartbeatLoaded();

        expect(loadHeartbeat).not.toHaveBeenCalled();
        expect(screenStore.state.heartbeatStatus).toBe('idle');
    });
});

describe('camera overrides', () => {
    // onMessage and onHello are called by the bus connection; tests call them directly
    type BusHandlers = {
        onMessage(message: unknown): void;
        onHello(hello: unknown): void;
    };

    it('adds valid fields from map-view messages, keeping earlier ones', async () => {
        loadHeartbeat.mockResolvedValue(FAKE_HEARTBEAT);
        const { screenEngine, screenStore } = await freshScreenEngine();
        const handlers = screenEngine as unknown as BusHandlers;

        handlers.onMessage({ type: 'screen/map-view', view: { zoom: 14 } });
        handlers.onMessage({
            type: 'screen/map-view',
            view: { bearing: 30, pitch: 'steep', latitude: Number.NaN }
        });

        expect(screenStore.state.mapViewOverride).toEqual({ zoom: 14, bearing: 30 });
    });

    it('replaces the overrides with the bus snapshot on hello', async () => {
        loadHeartbeat.mockResolvedValue(FAKE_HEARTBEAT);
        const { screenEngine, screenStore } = await freshScreenEngine();
        const handlers = screenEngine as unknown as BusHandlers;

        handlers.onMessage({ type: 'screen/map-view', view: { zoom: 14 } });
        handlers.onHello({
            type: 'hello',
            peerId: 'p1',
            state: { mapViewOverride: { pitch: 20 } }
        });

        expect(screenStore.state.mapViewOverride).toEqual({ pitch: 20 });
    });
});

describe('playback', () => {
    type BusHandlers = {
        onMessage(message: unknown): void;
        onHello(hello: unknown): void;
    };
    const PLAYING = { playing: true, positionMinutes: 0, speed: 24, startedAt: 1_000 };

    it('stores playback/state and lines the clock up with the server', async () => {
        loadHeartbeat.mockResolvedValue(FAKE_HEARTBEAT);
        const { screenEngine, screenStore } = await freshScreenEngine();
        const serverNow = Date.now() + 5_000;

        (screenEngine as unknown as BusHandlers).onMessage({
            type: 'playback/state',
            state: PLAYING,
            serverNow
        });

        expect(screenStore.state.playback).toEqual(PLAYING);
        // This screen's clock is about 5 seconds behind the server's
        expect(screenStore.state.clockOffsetMs).toBeGreaterThan(4_900);
        expect(screenStore.state.clockOffsetMs).toBeLessThanOrEqual(5_000);
    });

    it('takes the playback state from hello when joining late', async () => {
        loadHeartbeat.mockResolvedValue(FAKE_HEARTBEAT);
        const { screenEngine, screenStore } = await freshScreenEngine();

        (screenEngine as unknown as BusHandlers).onHello({
            type: 'hello',
            peerId: 'p1',
            state: { mapViewOverride: {}, playback: PLAYING },
            serverNow: Date.now()
        });

        expect(screenStore.state.playback).toEqual(PLAYING);
    });

    it('ignores an invalid playback state', async () => {
        loadHeartbeat.mockResolvedValue(FAKE_HEARTBEAT);
        const { screenEngine, screenStore } = await freshScreenEngine();

        (screenEngine as unknown as BusHandlers).onMessage({
            type: 'playback/state',
            state: { ...PLAYING, speed: 'fast' },
            serverNow: Date.now()
        });

        expect(screenStore.state.playback).toBeNull();
    });
});
