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

// Accept a playback state sent by the bus, with the server's time when it was
// sent. Returns the state and the offset to add to this machine's clock to get
// the server's, or null if anything is invalid. Message delivery takes a few
// milliseconds, far too little to see at playback speed.
export function parsePlaybackUpdate(
    state: unknown,
    serverNow: unknown,
    localNow: number
): { playback: PlaybackState; clockOffsetMs: number } | null {
    const playback = parsePlaybackState(state);
    if (!playback || !isFiniteNumber(serverNow)) return null;
    return { playback, clockOffsetMs: serverNow - localNow };
}

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

// Label for a playback position, e.g. "Wed 10 Jul 08:52". `start` is the data's
// start in London local time ("2024-07-01T00:00:00"). The arithmetic is done in
// UTC purely as a calendar, so the viewer's timezone can never shift the label.
export function formatDataTime(start: string, minutes: number) {
    const match = LOCAL_DATE_TIME.exec(start);
    if (!match) throw new Error(`Unrecognised start time: ${start}`);
    const [, year, month, day, hour, minute] = match.map(Number);
    const startMs = Date.UTC(year, month - 1, day, hour, minute);
    const moment = new Date(startMs + Math.floor(minutes) * 60_000);

    const date = moment.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC'
    });
    const time = moment.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC'
    });
    return `${date} ${time}`.replace(',', '');
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}
