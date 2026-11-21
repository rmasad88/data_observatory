import type { MapViewState } from '@deck.gl/core';
import DeckGL, { type DeckGLRef } from '@deck.gl/react';
import { createFileRoute } from '@tanstack/react-router';
import { Map } from '@vis.gl/react-maplibre';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BoxSelect } from '../components/box-select';
import { ExploreControls } from '../components/explore-controls';
import { ExploreOverlay } from '../components/explore-overlay';
import { SelectionBadge } from '../components/selection-badge';
import { MAP_STYLE } from '../lib/basemap';
import {
    dayTicks,
    EXPLORE_START_MINUTES,
    periodMinutes,
    stationTooltip,
    stepHours
} from '../lib/explore';
import { loadHeartbeat, type HeartbeatData } from '../lib/heartbeat/data';
import { buildFlowSchedule, createFlowSymbolLayer } from '../lib/heartbeat/flow-symbols';
import { activityAtPosition, binPositionAt, createStationLayer } from '../lib/heartbeat/layer';
import { useJourneyTrails } from '../lib/paths/use-journey-trails';
import {
    applyPlaybackCommand,
    DEFAULT_SPEED,
    formatDataTime,
    playbackMinutes,
    wrapMinutes,
    type PlaybackCommand,
    type PlaybackState
} from '../lib/playback';
import {
    addStationsInBox,
    clickStation,
    NO_SELECTION,
    selectionLabel,
    toggleStation,
    type Box,
    type Selection
} from '../lib/station-selection';
import { wallClock } from '../lib/wall-labels';
import { fitPositionsToWall } from '../lib/wall-view';

import 'maplibre-gl/dist/maplibre-gl.css';

// The public, single-screen version of the heartbeat. Unlike the wall's
// screens it needs no server: it loads the data itself and runs its own clock,
// so the build can serve it as a static page (e.g. on GitHub Pages).
export const Route = createFileRoute('/explore')({
    component: ExplorePage
});

// Elements whose own keyboard handling must win over the page's shortcuts
const INTERACTIVE_TAGS = new Set(['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA']);

function ExplorePage() {
    const [heartbeat, setHeartbeat] = useState<HeartbeatData | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    // The page's own clock, in the same form as the wall's shared one, timed
    // with `performance.now()`. Paused until the data arrives.
    const [playback, setPlayback] = useState<PlaybackState>({
        playing: false,
        positionMinutes: EXPLORE_START_MINUTES,
        speed: DEFAULT_SPEED,
        startedAt: 0
    });
    // Minutes since the data's start being shown, wrapped to the fortnight
    const [minutes, setMinutes] = useState(EXPLORE_START_MINUTES);
    // The camera; null until the data is loaded and the stations can be framed
    const [viewState, setViewState] = useState<MapViewState | null>(null);
    // Stations whose journeys alone are shown; empty for all journeys
    const [selection, setSelection] = useState<Selection>(NO_SELECTION);
    const deckRef = useRef<DeckGLRef>(null);
    // The two optional layers, both on to begin with
    const [showJourneys, setShowJourneys] = useState(true);
    const [showSymbols, setShowSymbols] = useState(true);

    const command = useCallback((change: PlaybackCommand) => {
        setPlayback((prev) => applyPlaybackCommand(prev, change, performance.now()));
    }, []);

    const resetView = useCallback(() => {
        if (heartbeat) setViewState(fittedView(heartbeat));
    }, [heartbeat]);

    // Load the data once, frame the stations and start playing
    useEffect(() => {
        let cancelled = false;
        loadHeartbeat()
            .then((data) => {
                if (cancelled) return;
                setHeartbeat(data);
                setViewState(fittedView(data));
                setPlayback((prev) =>
                    applyPlaybackCommand(prev, { playing: true }, performance.now())
                );
            })
            .catch((error: unknown) => {
                if (!cancelled)
                    setLoadError(error instanceof Error ? error.message : String(error));
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // Advance the picture every frame while playing
    useEffect(() => {
        if (!heartbeat) return;
        const period = periodMinutes(heartbeat);
        const current = () => wrapMinutes(playbackMinutes(playback, performance.now()), period);

        setMinutes(current());
        if (!playback.playing) return;

        let frame = requestAnimationFrame(function tick() {
            setMinutes(current());
            frame = requestAnimationFrame(tick);
        });
        return () => cancelAnimationFrame(frame);
    }, [heartbeat, playback]);

    // Keyboard: space plays or pauses, the arrow keys step an hour, Escape
    // clears the selection
    useEffect(() => {
        if (!heartbeat) return;

        const onKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && INTERACTIVE_TAGS.has(target.tagName)) return;

            const now = wrapMinutes(
                playbackMinutes(playback, performance.now()),
                periodMinutes(heartbeat)
            );
            if (event.key === ' ') {
                event.preventDefault();
                command({ playing: !playback.playing });
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                const hours = event.key === 'ArrowLeft' ? -1 : 1;
                command({ positionMinutes: stepHours(heartbeat, now, hours) });
            } else if (event.key === 'Escape') {
                setSelection(NO_SELECTION);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [heartbeat, playback, command]);

    const binPosition = heartbeat ? binPositionAt(heartbeat, minutes) : 0;
    // When each station releases its + and − symbols, worked out once
    const flowSchedule = useMemo(
        () => (heartbeat ? buildFlowSchedule(heartbeat) : null),
        [heartbeat]
    );
    // A Shift-drag adds the stations inside the box; a Shift-click adds or
    // removes the station under the pointer
    const selectBox = useCallback(
        (box: Box) => {
            // The viewport deck.gl is drawing, so pixels match the screen
            const viewport = deckRef.current?.deck?.getViewports()[0];
            if (!heartbeat || !viewport) return;
            const positions = heartbeat.stations.map((station) => station.position);
            const project = (position: [number, number]) =>
                viewport.project(position) as [number, number];
            setSelection((prev) => addStationsInBox(prev, positions, project, box));
        },
        [heartbeat]
    );
    const shiftClick = useCallback((x: number, y: number) => {
        const picked = deckRef.current?.pickObject({ x, y, radius: 4, layerIds: ['stations'] });
        if (picked && picked.index >= 0) {
            setSelection((prev) => toggleStation(prev, picked.index));
        }
    }, []);

    // Same object until the selection changes, so the trails are only
    // re-filtered then
    const trailFilter = useMemo(
        () => ({
            selection,
            stationTerminals: heartbeat ? heartbeat.stations.map((station) => station.terminal) : []
        }),
        [selection, heartbeat]
    );
    const trailLayers = useJourneyTrails(showJourneys, heartbeat?.start, minutes, trailFilter);
    const layers = useMemo(
        () =>
            heartbeat && flowSchedule
                ? [
                      // Under the dots, so the stations stay readable
                      ...trailLayers,
                      createStationLayer(heartbeat, binPosition, selection),
                      // Above the dots
                      ...(showSymbols
                          ? [
                                createFlowSymbolLayer(
                                    heartbeat,
                                    flowSchedule,
                                    minutes,
                                    playback.speed,
                                    selection
                                )
                            ]
                          : [])
                  ]
                : [],
        [
            heartbeat,
            flowSchedule,
            trailLayers,
            binPosition,
            selection,
            showSymbols,
            minutes,
            playback.speed
        ]
    );
    const ticks = useMemo(() => (heartbeat ? dayTicks(heartbeat) : []), [heartbeat]);

    return (
        <main className="relative h-dvh w-screen overflow-hidden bg-zinc-950 text-zinc-100">
            {heartbeat && viewState ? (
                <DeckGL
                    ref={deckRef}
                    viewState={viewState}
                    onViewStateChange={({ viewState: next }) => setViewState(next as MapViewState)}
                    // Pan and zoom only: tilting and rotating a flat map of dots adds nothing
                    controller={{ dragRotate: false, touchRotate: false }}
                    layers={layers}
                    // A station picks just that station; empty map clears
                    onClick={({ layer, index }) =>
                        setSelection((prev) =>
                            layer?.id === 'stations' && index >= 0
                                ? clickStation(prev, index)
                                : NO_SELECTION
                        )
                    }
                    getTooltip={({ index }) =>
                        index >= 0
                            ? {
                                  text: stationTooltip(
                                      heartbeat,
                                      heartbeat.stations[index],
                                      activityAtPosition(heartbeat, index, binPosition)
                                  ),
                                  style: TOOLTIP_STYLE
                              }
                            : null
                    }
                >
                    <Map reuseMaps mapStyle={MAP_STYLE} attributionControl={{ compact: true }} />
                </DeckGL>
            ) : (
                <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-zinc-400">
                    {loadError
                        ? `Sorry, the journey data couldn't be loaded (${loadError}). Please reload the page.`
                        : 'Loading two weeks of journeys…'}
                </p>
            )}

            {heartbeat && viewState ? <BoxSelect onBox={selectBox} onClick={shiftClick} /> : null}

            <ExploreOverlay clock={heartbeat ? wallClock(heartbeat.start, minutes) : undefined} />

            {heartbeat ? (
                <SelectionBadge
                    label={
                        selection.size > 0
                            ? selectionLabel(
                                  selection,
                                  heartbeat.stations.map((station) => station.name)
                              )
                            : undefined
                    }
                    onClear={() => setSelection(NO_SELECTION)}
                />
            ) : null}

            {heartbeat ? (
                <ExploreControls
                    playing={playback.playing}
                    speed={playback.speed}
                    minutes={minutes}
                    periodMinutes={periodMinutes(heartbeat)}
                    ticks={ticks}
                    timeLabel={formatDataTime(heartbeat.start, minutes)}
                    onTogglePlay={() => command({ playing: !playback.playing })}
                    onSeek={(positionMinutes) => command({ positionMinutes })}
                    onSpeed={(speed) => command({ speed })}
                    onResetView={resetView}
                    showJourneys={showJourneys}
                    showSymbols={showSymbols}
                    onToggleJourneys={() => setShowJourneys((shown) => !shown)}
                    onToggleSymbols={() => setShowSymbols((shown) => !shown)}
                />
            ) : null}
        </main>
    );
}

// Matches the page's dark panels
const TOOLTIP_STYLE = {
    backgroundColor: 'rgba(9, 9, 11, 0.9)',
    color: '#f4f4f5',
    borderRadius: '8px',
    padding: '8px 10px',
    fontSize: '13px',
    whiteSpace: 'pre-line'
};

// The camera that fits every station into the browser window
function fittedView(data: HeartbeatData): MapViewState {
    return fitPositionsToWall(
        data.stations.map((station) => station.position),
        { cols: 1, rows: 1, screenWidth: window.innerWidth, screenHeight: window.innerHeight }
    );
}
