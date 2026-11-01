// The wall's shared playback clock. The bus holds one PlaybackState; every
// screen derives the current moment from it each frame, so nothing needs to be
// sent per frame and all screens agree.
//
// Times are milliseconds on the bus server's clock. Screens correct their own
// clock to it using the server time sent with each playback message.

export type PlaybackState = {
    playing: boolean;
    // Position in minutes since the data's start (Monday 1 July 00:00) at
    // `startedAt`. Not wrapped: screens wrap it to the data's period.
    positionMinutes: number;
    // Simulated minutes per real second
    speed: number;
    // Server time (ms) when `positionMinutes` applied
    startedAt: number;
};

// A change requested by an operator; omitted fields keep their current value
export type PlaybackCommand = Partial<Pick<PlaybackState, 'playing' | 'positionMinutes' | 'speed'>>;

// One simulated day per real minute
export const DEFAULT_SPEED = 24;
// Fastest allowed: one simulated day every 6 seconds
export const MAX_SPEED = 240;

// Where an idle wall waits for an operator: Wednesday 10 July 08:30, the
// morning peak, so the paused wall shows the commuter tide
export const INITIAL_POSITION_MINUTES = (9 * 24 + 8.5) * 60;

export function createInitialPlayback(serverNow: number): PlaybackState {
    return {
        playing: false,
        positionMinutes: INITIAL_POSITION_MINUTES,
        speed: DEFAULT_SPEED,
        startedAt: serverNow
    };
}

// The playback position at `serverNow`, in minutes since the data's start
// (not yet wrapped to the data's period)
export function playbackMinutes(state: PlaybackState, serverNow: number) {
    if (!state.playing) return state.positionMinutes;
    const elapsedSeconds = (serverNow - state.startedAt) / 1000;
    return state.positionMinutes + elapsedSeconds * state.speed;
}

// Wrap a position into [0, periodMinutes), so playback loops the fortnight
export function wrapMinutes(minutes: number, periodMinutes: number) {
    return ((minutes % periodMinutes) + periodMinutes) % periodMinutes;
}

// Apply an operator's command. The current position is fixed first, so
// changing speed or pausing never makes the picture jump.
export function applyPlaybackCommand(
    state: PlaybackState,
    command: PlaybackCommand,
    serverNow: number
): PlaybackState {
    return {
        playing: command.playing ?? state.playing,
        positionMinutes: command.positionMinutes ?? playbackMinutes(state, serverNow),
        speed: command.speed ?? state.speed,
        startedAt: serverNow
    };
}

// Network payloads are untrusted: keep only valid fields of a command
export function parsePlaybackCommand(value: unknown): PlaybackCommand {
    if (typeof value !== 'object' || value === null) return {};
    const candidate = value as Record<string, unknown>;
    const command: PlaybackCommand = {};
    if (typeof candidate.playing === 'boolean') command.playing = candidate.playing;
    if (isFiniteNumber(candidate.positionMinutes) && candidate.positionMinutes >= 0) {
        command.positionMinutes = candidate.positionMinutes;
    }
    if (isFiniteNumber(candidate.speed) && candidate.speed > 0 && candidate.speed <= MAX_SPEED) {
        command.speed = candidate.speed;
    }
    return command;
}

// Check a full state received from the bus; null if anything is invalid
export function parsePlaybackState(value: unknown): PlaybackState | null {
    if (typeof value !== 'object' || value === null) return null;
    const candidate = value as Record<string, unknown>;
    const command = parsePlaybackCommand(candidate);
    if (
        command.playing === undefined ||
        command.positionMinutes === undefined ||
        command.speed === undefined ||
        !isFiniteNumber(candidate.startedAt)
    ) {
        return null;
    }
    return {
        playing: command.playing,
        positionMinutes: command.positionMinutes,
        speed: command.speed,
        startedAt: candidate.startedAt
    };
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}
