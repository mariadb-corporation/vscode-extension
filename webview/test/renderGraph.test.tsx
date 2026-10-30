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

import "./setup.js";
import { barsOf, datumOf, renderGraph } from "../src/graphs/renderGraph.js";

/**
 * @param options A graph's options.
 *
 * @returns The graph, drawn.
 */
const draw = (options: unknown): SVGSVGElement => {
    return renderGraph(document, JSON.parse(JSON.stringify(options)));
};

/**
 * @param svg A graph.
 * @param selector Picks elements.
 *
 * @returns Their tooltips.
 */
const tooltips = (svg: SVGSVGElement, selector: string): string[] => {
    return [...svg.querySelectorAll(`${selector} > title`)].map((title) => {
        return title.textContent ?? "";
    });
};

describe("renderGraph", () => {
    it("draws a pie: a slice each, labeled, with its value on hover", () => {
        const svg = draw({ series: [{ type: "pie", radius: [100, 200],
            data: [{ name: "Asia", value: 51 }, { name: "Europe", value: 4.5 },
                { name: "Nowhere", value: -1 }] }] });

        expect(svg.getAttribute("viewBox")).toBe("0 0 1200 450");
        expect(svg.querySelectorAll("path.slice")).toHaveLength(2);
        expect(tooltips(svg, "path.slice")).toEqual(["Asia: 51", "Europe: 4.50"]);
        expect([...svg.querySelectorAll(".pieGraph text")].map((text) => {
            return text.textContent;
        })).toEqual(["Asia", "Europe"]);
        expect(svg.querySelectorAll(".pieGraph polyline")).toHaveLength(2);
    });

    it("leaves a pie's labels off where asked, and colors it as told", () => {
        const svg = draw({ colors: ["red", 7, "blue"], series: [{
            type: "pie", showValues: false,
            data: [{ value: 1 }, { value: 2 }, { value: 3 }] }] });

        expect(svg.querySelectorAll(".pieGraph text")).toHaveLength(0);
        expect([...svg.querySelectorAll("path.slice")].map((slice) => {
            return slice.getAttribute("fill");
        })).toEqual(["red", "blue", "red"]);
    });

    it("draws a line a group, against a time axis for dates, with a legend",
        () => {
            const day = (n: number): string => {
                return new Date(Date.UTC(2026, 0, n)).toISOString();
            };
            const svg = draw({ series: [{ type: "line", yLabel: "ms",
                data: [
                    { xValue: day(1), yValue: 1, group: "read" },
                    { xValue: day(2), yValue: 3, group: "read" },
                    { xValue: day(1), yValue: 2, group: "write" },
                    { xValue: day(2), group: "write" },
                    { xValue: "not a date", yValue: 9 },
                ] }] });

            expect(svg.querySelectorAll("path.line")).toHaveLength(2);
            expect(tooltips(svg, "path.line")).toEqual(["read", "write"]);
            expect([...svg.querySelectorAll(".legend text")].map((text) => {
                return text.textContent;
            })).toEqual(["read", "write"]);
            expect(svg.querySelector(".yLabel")?.textContent).toBe("ms");
            expect(svg.querySelectorAll(".xAxis .tick").length)
                .toBeGreaterThan(0);
        });

    it("draws a bar a category, from either shape of data", () => {
        const tabular = draw({ series: [{ type: "bar",
            data: [["Continent", "Countries"], ["Asia", 51], ["Europe", 46]] }] });
        const rows = draw({ series: [{ type: "bar",
            data: [{ c: "Asia", n: 51 }, { c: "Europe", n: "46" }] }] });

        for (const svg of [tabular, rows]) {
            expect(tooltips(svg, ".barGraph rect"))
                .toEqual(["Asia: 51", "Europe: 46"]);
        }
    });

    it("sets a title above the series, aligned as asked", () => {
        const svg = draw({ title: { text: "Load", horizontalAlignment: "End" },
            series: [] });
        const title = svg.querySelector(".graphTitle");

        expect(svg.getAttribute("viewBox")).toBe("0 -60 1200 510");
        expect(title?.textContent).toBe("Load");
        expect(title?.getAttribute("text-anchor")).toBe("end");
    });

    it("draws nothing it cannot read, and does not fail on it", () => {
        const svg = draw({ viewport: { left: 0, top: 0, width: 400,
            height: "tall" }, series: [null, { type: "radar" },
            { type: "pie", data: "lots" }, { type: "bar" }] });

        expect(svg.getAttribute("viewBox")).toBe("0 0 400 450");
        expect(svg.querySelectorAll("path.slice, rect")).toHaveLength(0);
        expect(draw("not even options").childElementCount).toBe(1);
    });

    it("reads dates back, and leaves anything else as it is", () => {
        expect(datumOf("2026-01-02T00:00:00.000Z")).toEqual(
            new Date(Date.UTC(2026, 0, 2)));
        expect(datumOf("2026")).toBe("2026");
        expect(datumOf(Number.NaN)).toBeUndefined();
        expect(barsOf([])).toEqual([]);
    });
});
