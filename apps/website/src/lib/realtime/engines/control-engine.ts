import { loadHeartbeatPeriod } from '../../heartbeat/data';
import { parsePlaybackUpdate, type PlaybackCommand } from '../../playback';
import { controlStore } from '../stores/control-store';
import type {
    BusMessage,
    ControlStoreState,
    HelloBusMessage,
    PlaybackSetMessage,
    PlaybackStateMessage
} from '../types';
import { BusEngine } from './bus-engine';

// Connects an operator's control panel to the bus: sends playback commands and
// keeps a copy of the wall's playback state to display.
export class ControlEngine extends BusEngine<ControlStoreState> {
    // The period download in progress, shared by callers; cleared when done
    private periodRequest: Promise<void> | null = null;

    private constructor() {
        super('control', controlStore);
        void this.ensurePeriodLoaded();
    }

    static getInstance() {
        const globalWithControlEngine = globalThis as typeof globalThis & {
            __controlEngineInstance?: ControlEngine;
        };

        if (!globalWithControlEngine.__controlEngineInstance) {
            globalWithControlEngine.__controlEngineInstance = new ControlEngine();
        }

        return globalWithControlEngine.__controlEngineInstance;
    }

    // Ask the bus to change playback. The panel updates when the bus replies
    // with the new state, so every control panel shows the same thing.
    setPlayback(command: PlaybackCommand) {
        const message: PlaybackSetMessage = {
            type: 'playback/set',
            command,
            peerId: this.getPeerId() ?? undefined
        };
        this.send(message);
    }

    // Load the data's dates (small metadata file only) unless already loaded.
    // Callers during a download share it; after a failure the next call retries.
    ensurePeriodLoaded(): Promise<void> {
        if (typeof window === 'undefined') return Promise.resolve();
        if (this.store.state.period) return Promise.resolve();

        this.periodRequest ??= loadHeartbeatPeriod()
            .then((period) => this.store.setState((prev) => ({ ...prev, period })))
            // The panel can still play and pause without dates; it just can't label them
            .catch(() => undefined)
            .finally(() => {
                this.periodRequest = null;
            });
        return this.periodRequest;
    }

    protected override onMessage(message: BusMessage) {
        if (message.type === 'playback/state') {
            const { state, serverNow } = message as Partial<PlaybackStateMessage>;
            this.applyPlayback(state, serverNow);
        }
    }

    protected override onHello(hello: HelloBusMessage) {
        this.applyPlayback(hello.state?.playback, hello.serverNow);
    }

    private applyPlayback(state: unknown, serverNow: unknown) {
        const update = parsePlaybackUpdate(state, serverNow, Date.now());
        if (update) this.store.setState((prev) => ({ ...prev, ...update }));
    }
}

export const controlEngine = ControlEngine.getInstance();
