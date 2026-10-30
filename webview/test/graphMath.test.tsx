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

import { describe, expect, it } from "vitest";

import {
    arcPath,
    bands,
    formatNumber,
    linearScale,
    linearTicks,
    linePath,
    niceDomain,
    pieAngles,
    polar,
    tickStep,
    timeTicks,
} from "../src/graphs/graphMath.js";

describe("the graphs' arithmetic", () => {
    it("steps by 1, 2 or 5 times a power of ten", () => {
        expect(tickStep(0, 10, 10)).toBe(1);
        expect(tickStep(0, 100, 5)).toBe(20);
        expect(tickStep(0, 1, 4)).toBe(0.2);
        expect(tickStep(0, 58, 10)).toBe(5);
        expect(tickStep(3, 3, 5)).toBe(0);
    });

    it("rounds a domain out to ticks, and ticks it", () => {
        expect(niceDomain([0.3, 58], 10)).toEqual([0, 60]);
        expect(niceDomain([10.1, 37.9], 8)).toEqual([10, 40]);
        expect(niceDomain([5, 5], 5)).toEqual([2.5, 7.5]);
        expect(niceDomain([0, 0], 5)).toEqual([0, 1]);
        expect(linearTicks(0, 1, 5)).toEqual(
            { values: [0, 0.2, 0.4, 0.6, 0.8, 1], step: 0.2 });
        expect(linearTicks(-3, 7, 2).values).toEqual([0, 5]);
    });

    it("scales in a straight line, upside down too", () => {
        const scale = linearScale([0, 10], [100, 0]);

        expect(scale(0)).toBe(100);
        expect(scale(2.5)).toBe(75);
        expect(linearScale([4, 4], [0, 10])(4)).toBe(5);
    });

    it("formats as a few of d3's specifiers say", () => {
        expect(formatNumber(1234.5, ",.2f")).toBe("1,234.50");
        expect(formatNumber(0.256, ".1%")).toBe("25.6%");
        expect(formatNumber(12.7, "d")).toBe("13");
        // No format: as many decimals as the step needs.
        expect(formatNumber(0.4, undefined, 0.2)).toBe("0.4");
        expect(formatNumber(1500, "", 500)).toBe("1500");
    });

    it("ticks time on round steps, labeled for them", () => {
        const days = timeTicks(new Date(2026, 9, 1, 6), new Date(2026, 9, 9), 10);
        expect(days.map((tick) => { return tick.value.getDate(); }))
            .toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
        expect(days.every((tick) => {
            return tick.value.getHours() === 0;
        })).toBe(true);

        const months = timeTicks(new Date(2025, 0, 15), new Date(2026, 0, 15), 5);
        expect(months.map((tick) => { return tick.value.getMonth(); }))
            .toEqual([3, 6, 9, 0]);

        const minutes = timeTicks(new Date(2026, 0, 1, 10, 0),
            new Date(2026, 0, 1, 10, 30), 6);
        expect(minutes.map((tick) => { return tick.value.getMinutes(); }))
            .toEqual([0, 5, 10, 15, 20, 25, 30]);
    });

    it("puts bands across a range, padded, centred", () => {
        const band = bands(4, [0, 410], 0.1);

        expect(band.width).toBeCloseTo(90);
        expect(band.start(0)).toBeCloseTo(10);
        expect(band.start(3)).toBeCloseTo(310);
    });

    it("cuts a pie by value, clockwise from 12 o'clock", () => {
        expect(pieAngles([1, 1, 2])).toEqual([
            { startAngle: 0, endAngle: Math.PI / 2 },
            { startAngle: Math.PI / 2, endAngle: Math.PI },
            { startAngle: Math.PI, endAngle: 2 * Math.PI },
        ]);
        const padded = pieAngles([1, 1], 0, 2 * Math.PI, 0.2);
        expect(padded[0].startAngle).toBeCloseTo(0.1);
        expect(padded[0].endAngle).toBeCloseTo(Math.PI - 0.1);
        expect(pieAngles([0, 0])).toEqual([
            { startAngle: 0, endAngle: 0 },
            { startAngle: 0, endAngle: 0 },
        ]);
        const [x, y] = polar(Math.PI / 2, 10);
        expect([Math.round(x), Math.round(y) + 0]).toEqual([10, 0]);
    });

    it("outlines a slice, a donut's piece and a whole circle", () => {
        expect(arcPath({ startAngle: 0, endAngle: Math.PI / 2 }, 0, 10))
            .toBe("M0,-10A10,10,0,0,1,10,0L0,0Z");
        expect(arcPath({ startAngle: 0, endAngle: Math.PI / 2 }, 5, 10))
            .toBe("M0,-10A10,10,0,0,1,10,0L5,0A5,5,0,0,0,0,-5Z");
        expect(arcPath({ startAngle: 0, endAngle: 2 * Math.PI }, 0, 10))
            .toBe("M0,-10A10,10,0,1,1,0,10A10,10,0,1,1,0,-10Z");
        expect(arcPath({ startAngle: 1, endAngle: 1 }, 0, 10)).toBe("");
    });

    it("draws a line in runs between gaps, as its curve says", () => {
        expect(linePath([[0, 0], [1, 1], [2, undefined], [3, 3], [4, 4]]))
            .toBe("M0,0L1,1M3,3L4,4");
        expect(linePath([[0, 0], [2, 2]], "Step"))
            .toBe("M0,0L1,0L1,2L2,2");
        expect(linePath([[0, 0], [2, 2]], "StepAfter"))
            .toBe("M0,0L2,0L2,2L2,2");
        // Through every point, smoothly.
        const natural = linePath([[0, 0], [1, 1], [2, 0]], "Natural");
        expect(natural.startsWith("M0,0C")).toBe(true);
        expect(natural.endsWith(",2,0")).toBe(true);
        // From the first point to the last, near the ones between.
        expect(linePath([[0, 0], [6, 6], [12, 0]], "Basis"))
            .toBe("M0,0L1,1C2,2,4,4,6,4C8,4,10,2,11,1L12,0");
        expect(linePath([[0, undefined]])).toBe("");
    });
});
