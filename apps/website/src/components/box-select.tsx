import { useEffect, useState, type PointerEvent } from 'react';

import type { Box } from '../lib/station-selection';

type Props = {
    // A box was drawn, in pixels from the layer's top-left corner
    onBox: (box: Box) => void;
    // A Shift-click with no drag, at that point
    onClick: (x: number, y: number) => void;
};

// Movement under this many pixels counts as a click rather than a box
const CLICK_TOLERANCE_PIXELS = 4;

// While Shift is held, covers the map so that dragging draws a selection box
// instead of panning. Without Shift it isn't there and the map works as usual.
export function BoxSelect({ onBox, onClick }: Props) {
    const shiftHeld = useShiftHeld();
    const [box, setBox] = useState<Box | null>(null);

    // Stays up mid-drag even if Shift is let go, so the box can be finished
    if (!shiftHeld && !box) return null;

    const point = (event: PointerEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    return (
        <div
            className="absolute inset-0 cursor-crosshair"
            onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                const { x, y } = point(event);
                setBox({ x0: x, y0: y, x1: x, y1: y });
            }}
            onPointerMove={(event) => {
                if (!box) return;
                const { x, y } = point(event);
                setBox({ ...box, x1: x, y1: y });
            }}
            onPointerUp={() => {
                if (!box) return;
                const moved = Math.hypot(box.x1 - box.x0, box.y1 - box.y0);
                if (moved < CLICK_TOLERANCE_PIXELS) onClick(box.x0, box.y0);
                else onBox(box);
                setBox(null);
            }}
            onPointerCancel={() => setBox(null)}
        >
            {box ? (
                <div
                    className="pointer-events-none absolute border border-white/70 bg-white/10"
                    style={{
                        left: Math.min(box.x0, box.x1),
                        top: Math.min(box.y0, box.y1),
                        width: Math.abs(box.x1 - box.x0),
                        height: Math.abs(box.y1 - box.y0)
                    }}
                />
            ) : null}
        </div>
    );
}

// Whether the Shift key is down, reset if the window loses focus mid-press
function useShiftHeld() {
    const [held, setHeld] = useState(false);
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => setHeld(event.shiftKey);
        const onBlur = () => setHeld(false);
        window.addEventListener('keydown', onKey);
        window.addEventListener('keyup', onKey);
        window.addEventListener('blur', onBlur);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('keyup', onKey);
            window.removeEventListener('blur', onBlur);
        };
    }, []);
    return held;
}
