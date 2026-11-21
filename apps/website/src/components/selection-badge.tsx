import { XIcon } from '@phosphor-icons/react';

type Props = {
    // What is selected, e.g. "Hyde Park Corner" or "12 stations"; omitted
    // when nothing is
    label?: string;
    onClear: () => void;
};

// What the journeys are limited to, with a button to show them all again, or
// a hint on how to select when nothing is. Top-right of the /explore page, or
// above the controls on phones, where the title fills the top.
export function SelectionBadge({ label, onClear }: Props) {
    if (!label) {
        return (
            // A hint only on screens with room for it and, usually, a keyboard
            <p className="pointer-events-none absolute top-5 right-5 hidden rounded-xl bg-zinc-950/85 px-4 py-3 text-sm text-zinc-200 shadow-xl backdrop-blur lg:block">
                Click a station, or Shift-drag a box, to see only its journeys
            </p>
        );
    }
    return (
        <div className="absolute right-3 bottom-28 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-xl bg-zinc-950/80 py-2 pr-2 pl-4 text-sm text-zinc-100 shadow-xl backdrop-blur sm:top-5 sm:right-5 sm:bottom-auto">
            <span className="min-w-0 truncate">
                <span className="text-zinc-400">Journeys to and from </span>
                {label}
            </span>
            <button
                type="button"
                className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700"
                onClick={onClear}
                aria-label="Show all journeys"
                title="Show all journeys (Esc)"
            >
                <XIcon size={14} />
            </button>
        </div>
    );
}
