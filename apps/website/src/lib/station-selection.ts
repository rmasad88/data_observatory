// Rules for selecting stations on the /explore page, by clicking or by
// drawing a box, and for matching a selection to the journey paths. A
// selection is a set of station positions in the heartbeat's station list.

export type Selection = ReadonlySet<number>;

export const NO_SELECTION: Selection = new Set();

// How bright unselected stations and their symbols are while a selection is
// active, as a share of their usual opacity
export const UNSELECTED_DIMMING = 0.35;

// A plain click: select just that station, or clear the selection if it is
// already the only one selected
export function clickStation(selection: Selection, station: number): Selection {
    return selection.size === 1 && selection.has(station) ? NO_SELECTION : new Set([station]);
}

// A Shift-click: add the station, or take it out if it's already in
export function toggleStation(selection: Selection, station: number): Selection {
    const next = new Set(selection);
    if (next.has(station)) next.delete(station);
    else next.add(station);
    return next;
}

// A screen-space box between two corners, in either order
export type Box = { x0: number; y0: number; x1: number; y1: number };

// The stations whose screen positions fall inside a box, added to the
// selection. `project` turns a station's position into pixels.
export function addStationsInBox(
    selection: Selection,
    positions: [number, number][],
    project: (position: [number, number]) => [number, number],
    box: Box
): Selection {
    const left = Math.min(box.x0, box.x1);
    const right = Math.max(box.x0, box.x1);
    const top = Math.min(box.y0, box.y1);
    const bottom = Math.max(box.y0, box.y1);
    const next = new Set(selection);
    positions.forEach((position, station) => {
        const [x, y] = project(position);
        if (x >= left && x <= right && y >= top && y <= bottom) next.add(station);
    });
    return next;
}

// The selection as positions in the paths' terminal list, which `filterTrips`
// matches routes against. Stations without any routes are left out.
export function selectionInPaths(
    selection: Selection,
    stationTerminals: string[],
    pathTerminals: string[]
): Set<number> {
    const selected = new Set([...selection].map((station) => stationTerminals[station]));
    const inPaths = new Set<number>();
    pathTerminals.forEach((terminal, position) => {
        if (selected.has(terminal)) inPaths.add(position);
    });
    return inPaths;
}

// A short description of the selection, e.g. "Hyde Park Corner" or
// "12 stations"
export function selectionLabel(selection: Selection, stationNames: string[]) {
    if (selection.size === 1) return stationNames[[...selection][0]];
    return `${selection.size} stations`;
}
