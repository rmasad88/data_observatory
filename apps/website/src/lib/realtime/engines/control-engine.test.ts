import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import type { HeartbeatPeriod } from '../../heartbeat/data';

const PERIOD: HeartbeatPeriod = { start: '2024-07-01T00:00:00', binMinutes: 10, binCount: 2016 };
const PLAYING = { playing: true, positionMinutes: 0, speed: 24, startedAt: 1_000 };

const loadHeartbeatPeriod = vi.fn<() => Promise<HeartbeatPeriod>>();

// onMessage and onHello are called by the bus connection; tests call them directly
type BusHandlers = {
    onMessage(message: unknown): void;
    onHello(hello: unknown): void;
};

// The engine is a singleton built on first import, so each test gets a fresh
// one with the metadata loader replaced by `loadHeartbeatPeriod`.
async function freshControlEngine() {
    vi.resetModules();
    delete (globalThis as { __controlEngineInstance?: unknown }).__controlEngineInstance;
    vi.doMock('../../heartbeat/data', () => ({ loadHeartbeatPeriod }));
    const { controlEngine } = await import('./control-engine');
    const { controlStore } = await import('../stores/control-store');
    return { controlEngine, controlStore, handlers: controlEngine as unknown as BusHandlers };
}

beforeEach(() => {
    // A bare `window` lets the engine load data; without `window.location` it
    // still skips opening a WebSocket.
    vi.stubGlobal('window', {});
    loadHeartbeatPeriod.mockReset();
    loadHeartbeatPeriod.mockResolvedValue(PERIOD);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('../../heartbeat/data');
});

describe('setPlayback', () => {
    it('sends the command to the bus', async () => {
        const { controlEngine } = await freshControlEngine();
        const send = vi.spyOn(controlEngine, 'send').mockImplementation(() => {});

        controlEngine.setPlayback({ playing: true });

        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'playback/set', command: { playing: true } })
        );
    });
});

describe('playback state', () => {
    it('shows the state the bus sends', async () => {
        const { controlStore, handlers } = await freshControlEngine();

        handlers.onMessage({ type: 'playback/state', state: PLAYING, serverNow: Date.now() });

        expect(controlStore.state.playback).toEqual(PLAYING);
    });

    it('takes the state from hello when the panel opens', async () => {
        const { controlStore, handlers } = await freshControlEngine();

        handlers.onHello({
            type: 'hello',
            peerId: 'p1',
            state: { mapViewOverride: {}, playback: PLAYING },
            serverNow: Date.now()
        });

        expect(controlStore.state.playback).toEqual(PLAYING);
    });
});

describe('ensurePeriodLoaded', () => {
    it('loads the data period once', async () => {
        const { controlEngine, controlStore } = await freshControlEngine();

        await controlEngine.ensurePeriodLoaded();
        await controlEngine.ensurePeriodLoaded();

        expect(controlStore.state.period).toEqual(PERIOD);
        expect(loadHeartbeatPeriod).toHaveBeenCalledTimes(1);
    });

    it('retries after a failure', async () => {
        loadHeartbeatPeriod.mockReset();
        loadHeartbeatPeriod.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(PERIOD);
        const { controlEngine, controlStore } = await freshControlEngine();

        // The constructor's attempt fails
        await vi.waitFor(() => expect(loadHeartbeatPeriod).toHaveBeenCalledTimes(1));
        await controlEngine.ensurePeriodLoaded();

        expect(controlStore.state.period).toEqual(PERIOD);
    });
});
