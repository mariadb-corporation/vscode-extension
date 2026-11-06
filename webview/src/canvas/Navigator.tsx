/*
 * Copyright (c) 2026, MariaDB plc.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License, version 2.0,
 * as published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See
 * the GNU General Public License, version 2.0, for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software Foundation, Inc.,
 * 51 Franklin St, Fifth Floor, Boston, MA 02110-1301 USA
 */

import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import type { INavigatorState } from "./canvasTypes.js";
import {
    HamburgerButton,
    MENU_BUTTON_SIZE,
    pointUnder,
} from "./CanvasMenu.js";
import { SplitButton } from "./SplitButton.js";
import type { IRect } from "../../../src/modeler/pageSettings.js";

/**
 * The Navigator: a floating panel over the canvas's top right corner with
 * an overview of the whole paper, the part in view marked on it, and a
 * zoom slider.
 *
 * The panel draws no overview itself: its overview area is left clear,
 * and the canvas draws the page into that part of its own WebGL canvas
 * from straight above (`Canvas.setNavigatorArea`), so it stays 2D in a 3D
 * view and costs no second WebGL context. The panel draws the part in
 * view over it, which can be dragged to pan.
 */

/** The overview's width in CSS pixels; its height follows the paper. */
const AREA_WIDTH = 192;

/** The overview's least and largest height. */
const AREA_MIN_HEIGHT = 64;
const AREA_MAX_HEIGHT = 192;

/** The value's list's entry that fits the pages, above the zooms. */
const FIT = "fit";

/** The zooms the value's list offers. */
const ZOOM_PRESETS = [0.5, 0.75, 1, 1.5] as const;

/** The slider's steps: the zoom on a log scale. */
const SLIDER_STEPS = 1000;

/**
 * @param zoom A zoom level.
 * @param range The zoom's range.
 * @param range.min Its least.
 * @param range.max Its largest.
 *
 * @returns The slider's position for it.
 */
export const zoomToSlider = (
    zoom: number,
    range: { min: number; max: number },
): number => {
    return Math.round(SLIDER_STEPS * Math.log(zoom / range.min)
        / Math.log(range.max / range.min));
};

/**
 * @param value A slider position.
 * @param range The zoom's range.
 * @param range.min Its least.
 * @param range.max Its largest.
 *
 * @returns The zoom level it stands for.
 */
export const sliderToZoom = (
    value: number,
    range: { min: number; max: number },
): number => {
    return range.min * (range.max / range.min) ** (value / SLIDER_STEPS);
};

export interface INavigatorProps {
    /** What the canvas last reported, if anything yet. */
    state?: INavigatorState;
    zoom: number;
    zoomRange: { min: number; max: number };
    onZoom: (zoom: number) => void;
    /** Zooms to show the pages whole, as the toolbar's Fit the pages. */
    onFit: () => void;
    /**
     * The overview's area changed: where the canvas draws it, relative to
     * the canvas host (the canvas sits at its top left).
     */
    onArea: (area: IRect | undefined, panel?: IRect) => void;
    /** Pans the view by a distance dragged in the overview. */
    onPan: (dx: number, dy: number) => void;
    /** Centres the view on a point of the overview. */
    onCenter: (x: number, y: number) => void;
    /** Opens the panel's menu at a point of the canvas host. */
    onMenu: (x: number, y: number) => void;
    menuOpen: boolean;
}

export const Navigator = (props: INavigatorProps): JSX.Element => {
    const root = useRef<HTMLDivElement>(null);
    const area = useRef<HTMLDivElement>(null);
    const drag = useRef<{ x: number; y: number } | undefined>(undefined);
    /**
     * What was last picked from the list, which the value's button does
     * again: a zoom, or fitting the pages.
     */
    const [lastPick, setLastPick] = useState<number | typeof FIT>(1);
    const zoomTo = (pick: number | typeof FIT): void => {
        if (pick === FIT) {
            props.onFit();
        } else {
            props.onZoom(pick);
        }
    };
    const aspect = props.state?.aspect ?? 0.7;
    const height = Math.round(Math.min(AREA_MAX_HEIGHT,
        Math.max(AREA_MIN_HEIGHT, AREA_WIDTH * aspect)));

    // The canvas draws into the area: tell it where the area is, and the
    // whole panel, which it keeps its menu buttons off, relative to the
    // host the panel floats in - whenever they move or change size, and
    // that they are gone when the panel is.
    const report = (): void => {
        const element = area.current;
        const panel = root.current;
        const host = panel?.offsetParent;
        if (element === null || panel === null || host === null
            || host === undefined) {
            return;
        }
        const origin = host.getBoundingClientRect();
        const relative = (rect: DOMRect): IRect => {
            return {
                left: rect.left - origin.left,
                top: rect.top - origin.top,
                width: rect.width,
                height: rect.height,
            };
        };
        props.onArea(relative(element.getBoundingClientRect()),
            relative(panel.getBoundingClientRect()));
    };
    useLayoutEffect(report, [height]);
    useEffect(() => {
        const element = area.current;
        const host = root.current?.offsetParent;
        if (element === null) {
            return undefined;
        }
        const observer = new ResizeObserver(report);
        observer.observe(element);
        if (host !== null && host !== undefined) {
            observer.observe(host);
        }

        return () => {
            observer.disconnect();
            props.onArea(undefined);
        };
    }, []);

    const point = (event: PointerEvent): { x: number; y: number } => {
        const rect = area.current!.getBoundingClientRect();

        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    /** Ends a drag in the overview: released, or taken by the system. */
    const endDrag = (event: PointerEvent): void => {
        drag.current = undefined;
        (event.currentTarget as Element).releasePointerCapture(event.pointerId);
    };

    const view = props.state?.view;

    return <div ref={root} className="navigator" role="region"
        aria-label="Navigator">
        <div className="navigatorTitle">
            <span>Navigator</span>
            <HamburgerButton
                size={MENU_BUTTON_SIZE}
                label="Navigator Menu"
                open={props.menuOpen}
                onOpen={(button) => {
                    const at = pointUnder(button, root.current?.offsetParent);
                    props.onMenu(at.x, at.y);
                }}
            />
        </div>
        <div
            ref={area}
            className="navigatorArea"
            style={{ height: `${height}px` }}
        >
            <svg
                className="navigatorView"
                width="100%"
                height="100%"
                onPointerDown={(event) => {
                    const at = point(event);
                    // A press outside the part in view brings it there
                    // first; either way the drag pans from here.
                    if (!(event.target instanceof SVGPolygonElement)) {
                        props.onCenter(at.x, at.y);
                    }
                    drag.current = at;
                    (event.currentTarget as Element)
                        .setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                    if (drag.current === undefined) {
                        return;
                    }
                    const at = point(event);
                    props.onPan(at.x - drag.current.x, at.y - drag.current.y);
                    drag.current = at;
                }}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
            >
                {view !== undefined && <polygon
                    points={view.map((corner) => {
                        return `${corner.x},${corner.y}`;
                    }).join(" ")}
                />}
            </svg>
        </div>
        {/* Below the overview, as in Workbench. */}
        <div className="navigatorZoom">
            <input
                type="range"
                aria-label="Zoom"
                min={0}
                max={SLIDER_STEPS}
                value={zoomToSlider(props.zoom, props.zoomRange)}
                onInput={(event) => {
                    props.onZoom(sliderToZoom(
                        Number((event.target as HTMLInputElement).value),
                        props.zoomRange));
                }}
            />
            <SplitButton
                caption={`${Math.round(props.zoom * 100)}%`}
                title={lastPick === FIT ? "Fit the pages"
                    : `Zoom to ${Math.round(lastPick * 100)}%`}
                toggled={false}
                onClick={() => { zoomTo(lastPick); }}
                menuLabel="Choose the Zoom"
                items={[
                    { id: FIT, caption: "Fit the Pages" },
                    ...ZOOM_PRESETS.map((zoom) => {
                        return { id: String(zoom), caption: `${zoom * 100}%` };
                    }),
                ]}
                // Ticked where the zoom is one of them.
                selected={String(Math.round(props.zoom * 100) / 100)}
                onSelect={(id) => {
                    const pick = id === FIT ? FIT : Number(id);
                    setLastPick(pick);
                    zoomTo(pick);
                }}
            />
        </div>
    </div>;
};
