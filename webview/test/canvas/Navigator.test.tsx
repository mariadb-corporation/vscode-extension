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

import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";

import { ZOOM_RANGE } from "../../src/canvas/Canvas.js";
import { ZOOM_STEP } from "../../src/canvas/canvasTypes.js";
import {
    Navigator,
    sliderToZoom,
    zoomToSlider,
} from "../../src/canvas/Navigator.js";
import { installLayoutStubs } from "../setup.js";

describe("the Navigator's zoom slider", () => {
    it("spans the zoom range on a log scale", () => {
        expect(zoomToSlider(ZOOM_RANGE.min, ZOOM_RANGE)).toBe(0);
        expect(zoomToSlider(ZOOM_RANGE.max, ZOOM_RANGE)).toBe(1000);
        expect(sliderToZoom(0, ZOOM_RANGE)).toBeCloseTo(ZOOM_RANGE.min, 9);
        expect(sliderToZoom(1000, ZOOM_RANGE)).toBeCloseTo(ZOOM_RANGE.max, 9);
        // The middle of the slider is the geometric middle of the range.
        expect(sliderToZoom(500, ZOOM_RANGE)).toBeCloseTo(
            Math.sqrt(ZOOM_RANGE.min * ZOOM_RANGE.max), 9);
    });

    it("goes back and forth without drifting", () => {
        for (const zoom of [0.1, 0.5, 1, 2.5, 7]) {
            expect(sliderToZoom(zoomToSlider(zoom, ZOOM_RANGE), ZOOM_RANGE))
                .toBeCloseTo(zoom, 1);
        }
    });
});

describe("the Navigator", () => {
    it("has its zoom below the overview, and fits the pages from the list",
        () => {
            installLayoutStubs();
            const host = document.createElement("div");
            document.body.appendChild(host);
            const zooms: number[] = [];
            let fits = 0;
            act(() => {
                render(<Navigator zoom={0.5} zoomRange={ZOOM_RANGE}
                    onZoom={(zoom) => { zooms.push(zoom); }}
                    onFit={() => { fits += 1; }}
                    onArea={() => { /* not looked at */ }}
                    onPan={() => { /* not looked at */ }}
                    onCenter={() => { /* not looked at */ }}
                    onMenu={() => { /* not looked at */ }}
                    menuOpen={false} />, host);
            });
            const parts = [...host.querySelector(".navigator")!.children]
                .map((part) => { return part.className; });
            expect(parts).toEqual(["navigatorTitle", "navigatorArea",
                "navigatorZoom"]);

            act(() => {
                host.querySelector<HTMLButtonElement>(".splitChevron")!.click();
            });
            const fit = [...host.querySelectorAll<HTMLElement>(
                ".splitMenu [role^=menuitem]")].find((item) => {
                return item.textContent === "Fit the Pages";
            });
            act(() => { fit!.click(); });
            expect(fits).toBe(1);

            // The value's button does it again.
            act(() => {
                host.querySelector<HTMLButtonElement>(".splitMain")!.click();
            });
            expect(fits).toBe(2);
            expect(zooms).toEqual([]);

            // - and +, right of the slider, step as a zoom click does.
            const steps = [...host.querySelectorAll<HTMLButtonElement>(
                ".navigatorStep")];
            expect(steps.map((step) => { return step.title; }))
                .toEqual(["Zoom Out", "Zoom In"]);
            expect(steps[0].previousElementSibling?.getAttribute("type"))
                .toBe("range");
            act(() => { steps[0].click(); });
            act(() => { steps[1].click(); });
            expect(zooms).toEqual([0.5 / ZOOM_STEP, 0.5 * ZOOM_STEP]);

            render(null, host);
            host.remove();
        });
});
