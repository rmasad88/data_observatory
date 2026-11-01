import { WebMercatorViewport } from '@deck.gl/core';
import DeckGL from '@deck.gl/react';
import { createFileRoute, useLocation } from '@tanstack/react-router';
import { Map, type MapRef } from '@vis.gl/react-maplibre';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    binPositionAt,
    createStationLayer,
    stationCirclePaint,
    stationPoints,
    stationStyles
} from '../lib/heartbeat/layer';
import { INITIAL_POSITION_MINUTES, playbackMinutes, wrapMinutes } from '../lib/playback';
import { screenEngine } from '../lib/realtime/engines/screen-engine';
import { useScreenStore } from '../lib/realtime/stores/screen-store';
import { DEFAULT_MAP_VIEW, type ScreenMapViewState } from '../lib/realtime/types';
import { fitPositionsToWall, type WallSize } from '../lib/wall-view';

import 'maplibre-gl/dist/maplibre-gl.css';

const WALL_COLS = 3;
const WALL_ROWS = 2;
const SCREEN_WIDTH = 1920;
const SCREEN_HEIGHT = 1080;
const WALL: WallSize = {
    cols: WALL_COLS,
    rows: WALL_ROWS,
    screenWidth: SCREEN_WIDTH,
    screenHeight: SCREEN_HEIGHT
};
// Shared animation timings so transitions feel identical across all screen nodes.
const MAP_TRANSITION_DURATION_MS = 1200;
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
// While playing, the fallback renderer restyles its circles at most 30 times a
// second: smooth to the eye, with headroom when several iframes share a machine
const FALLBACK_MIN_UPDATE_MS = 1000 / 30;
// Fallback renderer's MapLibre source and layer for the stations
const STATIONS_SOURCE_ID = 'stations-source';
const STATIONS_LAYER_ID = 'stations-layer';

// Each `/screen` instance represents one wall tile (`c`,`r`) and computes
// a local camera from shared wall state. We keep a lighter fallback renderer for
// iframe deployments where multiple WebGL contexts are active at once.

export const Route = createFileRoute('/screen')({
    component: ScreenPage
});

function ScreenPage() {
    const { search } = useLocation();
    // Query params identify which physical panel this route instance represents.
    const searchParams = (search as Record<string, unknown>) ?? {};
    const screenC = parseScreenCoordinate(searchParams.c, WALL_COLS, 0);
    const screenR = parseScreenCoordinate(searchParams.r, WALL_ROWS, 0);

    const mapViewOverride = useScreenStore((state) => state.mapViewOverride);
    const heartbeat = useScreenStore((state) => state.heartbeat);
    const playback = useScreenStore((state) => state.playback);
    const clockOffsetMs = useScreenStore((state) => state.clockOffsetMs);

    // Frame all stations on the whole wall, then apply any operator changes.
    // Until the data loads, show the default view of London.
    const fittedView = useMemo(
        () =>
            heartbeat
                ? fitPositionsToWall(
                      heartbeat.stations.map((station) => station.position),
                      WALL
                  )
                : DEFAULT_MAP_VIEW,
        [heartbeat]
    );
    const mapView = useMemo(
        () => ({ ...fittedView, ...mapViewOverride }),
        [fittedView, mapViewOverride]
    );
    const [isClient, setIsClient] = useState(false);
    const [useDeckWrapper, setUseDeckWrapper] = useState(false);
    const [animatedBaseMapView, setAnimatedBaseMapView] = useState(mapView);
    const animationFrameRef = useRef<number | null>(null);
    // Minutes since the data's start being shown, wrapped to the fortnight
    const [minutes, setMinutes] = useState(INITIAL_POSITION_MINUTES);
    const playbackFrameRef = useRef<number | null>(null);
    const lastFallbackUpdateRef = useRef(0);
    // True once the fallback map has the stations' source and layer
    const [fallbackReady, setFallbackReady] = useState(false);
    const [mapInstance, setMapInstance] = useState<ReturnType<MapRef['getMap']> | null>(null);

    const setMapRef = useCallback((instance: MapRef | null) => {
        setMapInstance(instance?.getMap() ?? null);
    }, []);

    useEffect(() => {
        setIsClient(true);
        // Avoid DeckGL context exhaustion in a 6-iframe wall layout.
        // `window.top` path is used when opening a screen directly in its own tab, where one
        // high-level DeckGL canvas is typically safe.
        setUseDeckWrapper(window.self === window.top);
        // Also the retry path if an earlier heartbeat load failed
        void screenEngine.ensureHeartbeatLoaded();
    }, []);

    useEffect(() => {
        if (!isClient) return;

        if (animationFrameRef.current !== null) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }

        const from = animatedBaseMapView;
        const to = mapView;
        const startTime = performance.now();

        const step = (now: number) => {
            const elapsed = now - startTime;
            const linearT = Math.min(1, elapsed / MAP_TRANSITION_DURATION_MS);
            const t = easeInOutCubic(linearT);

            setAnimatedBaseMapView(interpolateMapView(from, to, t));

            if (linearT < 1) {
                animationFrameRef.current = requestAnimationFrame(step);
            } else {
                animationFrameRef.current = null;
            }
        };

        animationFrameRef.current = requestAnimationFrame(step);

        return () => {
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
        };
    }, [isClient, mapView]);

    const localScreenMapView = useMemo(() => {
        // Transform shared wall center view into per-panel view by offsetting camera in pixels.
        return deriveScreenMapView(animatedBaseMapView, screenC, screenR);
    }, [animatedBaseMapView, screenC, screenR]);

    // Follow the wall's shared clock. Every screen computes the same moment from
    // the playback state and the server's time, so nothing is sent per frame.
    useEffect(() => {
        if (!isClient || !playback || !heartbeat) return;
        const periodMinutes = heartbeat.binCount * heartbeat.binMinutes;
        const currentMinutes = () =>
            wrapMinutes(playbackMinutes(playback, Date.now() + clockOffsetMs), periodMinutes);

        setMinutes(currentMinutes());
        if (!playback.playing) return;

        const tick = () => {
            setMinutes(currentMinutes());
            playbackFrameRef.current = requestAnimationFrame(tick);
        };
        playbackFrameRef.current = requestAnimationFrame(tick);

        return () => {
            if (playbackFrameRef.current !== null) {
                cancelAnimationFrame(playbackFrameRef.current);
                playbackFrameRef.current = null;
            }
        };
    }, [isClient, playback, heartbeat, clockOffsetMs]);

    // Position between bins shown, shared by both renderers
    const binPosition = heartbeat ? binPositionAt(heartbeat, minutes) : 0;
    const isPlaying = playback?.playing ?? false;

    const layers = useMemo(
        () => (heartbeat ? [createStationLayer(heartbeat, binPosition)] : []),
        [heartbeat, binPosition]
    );

    // Fallback: add the stations' points and circle layer to the map once
    useEffect(() => {
        if (!isClient || useDeckWrapper || !mapInstance || !heartbeat) return;

        const addStations = () => {
            if (!mapInstance.isStyleLoaded()) return;
            if (!mapInstance.getSource(STATIONS_SOURCE_ID)) {
                mapInstance.addSource(STATIONS_SOURCE_ID, {
                    type: 'geojson',
                    data: stationPoints(heartbeat)
                });
                mapInstance.addLayer({
                    id: STATIONS_LAYER_ID,
                    type: 'circle',
                    source: STATIONS_SOURCE_ID,
                    paint: stationCirclePaint()
                });
            }
            setFallbackReady(true);
        };

        addStations();
        // If the map style was still loading, add the stations once it is ready
        mapInstance.on('load', addStations);
        return () => {
            mapInstance.off('load', addStations);
        };
    }, [isClient, useDeckWrapper, mapInstance, heartbeat]);

    // Fallback: restyle each station in place as playback moves. Setting feature
    // state updates only the circles' values, with no geometry re-sent, so it is
    // light enough to run many times a second.
    useEffect(() => {
        if (!fallbackReady || !mapInstance || !heartbeat) return;

        // While playing, skip updates that come sooner than the fallback's limit
        const now = performance.now();
        if (isPlaying && now - lastFallbackUpdateRef.current < FALLBACK_MIN_UPDATE_MS) return;
        lastFallbackUpdateRef.current = now;

        stationStyles(heartbeat, binPosition).forEach((style, id) => {
            mapInstance.setFeatureState({ source: STATIONS_SOURCE_ID, id }, style);
        });
    }, [fallbackReady, mapInstance, heartbeat, binPosition, isPlaying]);

    return (
        <main className="pointer-events-none h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100">
            <div className="relative flex h-full w-full items-center justify-center">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(34,197,94,0.14),transparent_40%),radial-gradient(circle_at_80%_70%,rgba(14,165,233,0.12),transparent_45%)]" />
                <div className="relative z-30 flex h-full w-full flex-col items-center justify-center gap-4">
                    <p className="text-sm tracking-[0.35em] text-zinc-400 uppercase md:text-lg">
                        Screen Node
                    </p>
                    <h1 className="text-5xl font-semibold tracking-tight md:text-6xl">
                        /screen?c={screenC}&r={screenR}
                    </h1>
                    <div className="text-md rounded-full border border-emerald-400/40 bg-emerald-400/10 px-4 py-1 text-emerald-300 md:text-3xl">
                        Ready
                    </div>
                </div>
                <div className="absolute inset-0 z-200">
                    {isClient && useDeckWrapper ? (
                        <DeckGL
                            controller={false}
                            viewState={localScreenMapView}
                            layers={layers}
                            style={{ width: '100%', height: '100%' }}
                        >
                            <Map reuseMaps attributionControl={false} mapStyle={MAP_STYLE} />
                        </DeckGL>
                    ) : null}

                    {isClient && !useDeckWrapper ? (
                        // Iframe-safe fallback implementation: direct map rendering + imperative layers.
                        <Map
                            ref={setMapRef}
                            reuseMaps
                            attributionControl={false}
                            mapStyle={MAP_STYLE}
                            longitude={localScreenMapView.longitude}
                            latitude={localScreenMapView.latitude}
                            zoom={localScreenMapView.zoom}
                            bearing={localScreenMapView.bearing}
                            pitch={localScreenMapView.pitch}
                            style={{ width: '100%', height: '100%' }}
                        />
                    ) : null}
                </div>
            </div>
        </main>
    );
}

function parseScreenCoordinate(value: unknown, size: number, fallback: number) {
    // SSR and direct route probes may hit `/screen` without `c`/`r`.
    // Fail gracefully by falling back to a deterministic tile.
    if (value === null || value === undefined) {
        return Math.min(size - 1, Math.max(0, fallback));
    }
    const parsed =
        typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (!Number.isInteger(parsed)) {
        return Math.min(size - 1, Math.max(0, fallback));
    }
    // Clamp keeps out-of-range coordinates inside the supported wall grid.
    return Math.min(size - 1, Math.max(0, parsed));
}

function deriveScreenMapView(
    baseView: ScreenMapViewState,
    c: number,
    r: number
): ScreenMapViewState {
    // Convert wall-level geographic center to screen-local center by:
    // 1) projecting to pixels at a canonical screen resolution
    // 2) applying tile offset for row/column
    // 3) unprojecting back to lon/lat
    const viewport = new WebMercatorViewport({
        longitude: baseView.longitude,
        latitude: baseView.latitude,
        zoom: baseView.zoom,
        bearing: baseView.bearing,
        pitch: baseView.pitch,
        width: SCREEN_WIDTH,
        height: SCREEN_HEIGHT
    });

    const [centerX, centerY] = viewport.project([baseView.longitude, baseView.latitude]);

    const pixelOffsetX = (c + 0.5 - WALL_COLS / 2) * SCREEN_WIDTH;
    const pixelOffsetY = (r + 0.5 - WALL_ROWS / 2) * SCREEN_HEIGHT;

    const [longitude, latitude] = viewport.unproject([
        centerX + pixelOffsetX,
        centerY + pixelOffsetY
    ]);

    return {
        ...baseView,
        longitude,
        latitude
    };
}

function interpolateMapView(
    from: ScreenMapViewState,
    to: ScreenMapViewState,
    t: number
): ScreenMapViewState {
    return {
        longitude: lerp(from.longitude, to.longitude, t),
        latitude: lerp(from.latitude, to.latitude, t),
        zoom: lerp(from.zoom, to.zoom, t),
        bearing: lerp(from.bearing, to.bearing, t),
        pitch: lerp(from.pitch, to.pitch, t)
    };
}

function lerp(from: number, to: number, t: number) {
    return from + (to - from) * t;
}

function easeInOutCubic(t: number) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
