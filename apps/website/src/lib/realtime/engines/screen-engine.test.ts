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
    // still skips opening a WebSocket. The demo arc data request just fails.
    vi.stubGlobal('window', {});
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('Not found', { status: 404 }))
    );
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
