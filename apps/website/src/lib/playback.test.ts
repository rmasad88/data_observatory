import { describe, expect, it } from 'vite-plus/test';

import {
    DEFAULT_SPEED,
    INITIAL_POSITION_MINUTES,
    MAX_SPEED,
    applyPlaybackCommand,
    createInitialPlayback,
    parsePlaybackCommand,
    parsePlaybackState,
    playbackMinutes,
    wrapMinutes,
    type PlaybackState
} from './playback';

const FORTNIGHT_MINUTES = 14 * 24 * 60;

const playingFromMidnight: PlaybackState = {
    playing: true,
    positionMinutes: 0,
    speed: 24,
    startedAt: 1_000_000
};

describe('createInitialPlayback', () => {
    it('starts paused at the morning peak at the default speed', () => {
        expect(createInitialPlayback(5)).toEqual({
            playing: false,
            positionMinutes: INITIAL_POSITION_MINUTES,
            speed: DEFAULT_SPEED,
            startedAt: 5
        });
    });
});

describe('playbackMinutes', () => {
    it('advances at the playback speed', () => {
        // 10 real seconds at 24 simulated minutes per second
        expect(playbackMinutes(playingFromMidnight, 1_010_000)).toBe(240);
    });

    it('stays put while paused', () => {
        const paused = { ...playingFromMidnight, playing: false, positionMinutes: 100 };

        expect(playbackMinutes(paused, 9_999_999)).toBe(100);
    });
});

describe('wrapMinutes', () => {
    it.each([
        [0, 0],
        [FORTNIGHT_MINUTES, 0],
        [FORTNIGHT_MINUTES + 30, 30],
        // Slightly negative values (e.g. from clock correction) wrap to the end
        [-10, FORTNIGHT_MINUTES - 10]
    ])('wraps %d to %d', (minutes, expected) => {
        expect(wrapMinutes(minutes, FORTNIGHT_MINUTES)).toBe(expected);
    });
});

describe('applyPlaybackCommand', () => {
    it('pausing keeps the current position', () => {
        const paused = applyPlaybackCommand(playingFromMidnight, { playing: false }, 1_010_000);

        expect(paused).toEqual({
            playing: false,
            positionMinutes: 240,
            speed: 24,
            startedAt: 1_010_000
        });
    });

    it('changing speed continues from the current position without a jump', () => {
        const faster = applyPlaybackCommand(playingFromMidnight, { speed: 48 }, 1_010_000);

        expect(playbackMinutes(faster, 1_010_000)).toBe(240);
        // Then advances twice as fast
        expect(playbackMinutes(faster, 1_011_000)).toBe(288);
    });

    it('seeking jumps to the requested position', () => {
        const seeked = applyPlaybackCommand(
            playingFromMidnight,
            { positionMinutes: 600 },
            1_010_000
        );

        expect(playbackMinutes(seeked, 1_010_000)).toBe(600);
    });
});

describe('parsePlaybackCommand', () => {
    it('keeps valid fields', () => {
        expect(parsePlaybackCommand({ playing: true, speed: 48, positionMinutes: 60 })).toEqual({
            playing: true,
            speed: 48,
            positionMinutes: 60
        });
    });

    it.each([
        ['not an object', 'play'],
        ['wrong types', { playing: 'yes', speed: '48' }],
        ['negative position', { positionMinutes: -5 }],
        ['zero speed', { speed: 0 }],
        ['speed too high', { speed: MAX_SPEED + 1 }],
        ['infinite position', { positionMinutes: Number.POSITIVE_INFINITY }]
    ])('drops %s', (_label, value) => {
        expect(parsePlaybackCommand(value)).toEqual({});
    });
});

describe('parsePlaybackState', () => {
    it('accepts a complete state', () => {
        expect(parsePlaybackState(playingFromMidnight)).toEqual(playingFromMidnight);
    });

    it('rejects a state with any field missing or invalid', () => {
        expect(parsePlaybackState({ ...playingFromMidnight, startedAt: 'now' })).toBeNull();
        expect(parsePlaybackState({ playing: true, speed: 24, startedAt: 0 })).toBeNull();
        expect(parsePlaybackState(null)).toBeNull();
    });
});
