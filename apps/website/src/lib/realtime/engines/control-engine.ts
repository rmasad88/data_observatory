import { controlStore } from '../stores/control-store';
import type { ControlStoreState } from '../types';
import { BusEngine } from './bus-engine';

// Connects an operator's control panel to the bus. Playback commands (play,
// pause, speed) will be sent from here.
export class ControlEngine extends BusEngine<ControlStoreState> {
    private constructor() {
        super('control', controlStore);
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
}

export const controlEngine = ControlEngine.getInstance();
