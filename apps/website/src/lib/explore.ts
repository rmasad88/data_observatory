// Rules for the public /explore page: where playback starts, the timeline's
// day marks, stepping through time and the station tooltip. Kept free of React
// so they can be unit-tested.

import type { HeartbeatPeriod, HeartbeatStation } from './heartbeat/data';
import type { StationActivity } from './heartbeat/layer';
import { formatDataTime, wrapMinutes } from './playback';

const MINUTES_PER_DAY = 24 * 60;

// Monday 1 July 06:00, so the first thing a visitor sees is the morning
// commute building
export const EXPLORE_START_MINUTES = 6 * 60;

export type DayTick = {
    // Minutes since the data's start, at midnight
    minutes: number;
    // e.g. "Mon 1"
    label: string;
};

// One mark per day of the period for the timeline, at each midnight
export function dayTicks(period: HeartbeatPeriod): DayTick[] {
    const days = Math.floor(periodMinutes(period) / MINUTES_PER_DAY);
    return Array.from({ length: days }, (_, day) => {
        const minutes = day * MINUTES_PER_DAY;
        // "Mon 1 Jul 00:00" -> "Mon 1"
        const [weekday, date] = formatDataTime(period.start, minutes).split(' ');
        return { minutes, label: `${weekday} ${date}` };
    });
}

// Move a position by whole hours (negative for back), looping round the period
export function stepHours(period: HeartbeatPeriod, minutes: number, hours: number) {
    return wrapMinutes(minutes + hours * 60, periodMinutes(period));
}

export function periodMinutes(period: HeartbeatPeriod) {
    return period.binCount * period.binMinutes;
}

// A station's name and its journeys at the moment shown, as rates per hour,
// which read more naturally than counts per 10-minute bin
export function stationTooltip(
    period: HeartbeatPeriod,
    station: HeartbeatStation,
    activity: StationActivity
) {
    const binsPerHour = 60 / period.binMinutes;
    const departures = Math.round(activity.departures * binsPerHour);
    const arrivals = Math.round(activity.arrivals * binsPerHour);
    return `${station.name}\n${departures} departures · ${arrivals} arrivals per hour`;
}
