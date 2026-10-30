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

/**
 * Draws the graph a notebook's TypeScript cell asked for with
 * `Graph.render` or `PieGraph.render`: an SVG of its series - pie, line,
 * bar - laid out in one viewport, as the MySQL Shell's notebooks drew
 * them. Plain SVG, its arithmetic in `graphMath.ts`: three simple kinds of
 * graph do not need a charting library. The options are the cell's, sent
 * as JSON, so every one of them is checked as it is read: a value of the
 * wrong kind is left out, not trusted. Text and axes take the theme's
 * foreground; the series their colors, or the ten of `CATEGORY10`.
 */

import {
    arcPath,
    bands,
    CATEGORY10,
    formatNumber,
    linearScale,
    linearTicks,
    linePath,
    niceDomain,
    pieAngles,
    type Point,
    sliceMiddle,
    timeTicks,
} from "./graphMath.js";

/** The SVG namespace. */
const SVG = "http://www.w3.org/2000/svg";

/** The viewport a graph is laid out in, unless it says otherwise. */
export const DEFAULT_VIEWPORT = { left: 0, top: 0, width: 1200, height: 900 };

/** The room a title takes above the viewport. */
const TITLE_ROOM = 60;

/** The most slices or bars drawn; the rest are left out. */
const MAX_ITEMS = 100;

/** How long a tick's mark is. */
const TICK_SIZE = 6;

/** A part of the graph, in the viewport's units. */
interface IBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A slice of a pie. */
interface ISlice {
    name: string;
    value: number;
}

/** A point of a line. */
interface IPoint {
    x: number | Date;
    y?: number;
    group: string;
}

/**
 * Adds an element to another.
 *
 * @param parent Where it goes.
 * @param tag The SVG element's name.
 * @param attributes Its attributes; one that is undefined is left out.
 * @param text Its text, if any.
 *
 * @returns The element.
 */
const add = (
    parent: Element,
    tag: string,
    attributes: Record<string, string | number | undefined> = {},
    text?: string,
): SVGElement => {
    const element = parent.ownerDocument.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) {
        if (value !== undefined) {
            element.setAttribute(name, String(value));
        }
    }
    if (text !== undefined) {
        element.textContent = text;
    }
    parent.append(element);

    return element;
};

/**
 * Adds a tooltip to an element: SVG's own, which the webview shows.
 *
 * @param target The element.
 * @param text What it says.
 *
 * @returns Nothing.
 */
const addTooltip = (target: Element, text: string): void => {
    add(target, "title", {}, text);
};

/**
 * @param value Anything.
 *
 * @returns It, where it is a plain object.
 */
const record = (value: unknown): Record<string, unknown> | undefined => {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
};

/**
 * @param value Anything.
 *
 * @returns It, where it is a finite number.
 */
const numberOf = (value: unknown): number | undefined => {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
};

/**
 * @param value Anything.
 *
 * @returns It, where it is a string.
 */
const stringOf = (value: unknown): string | undefined => {
    return typeof value === "string" ? value : undefined;
};

/** An ISO date, as `JSON.stringify` writes a `Date`. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Reads back what the cell had as a `Date` and sent as its ISO text.
 *
 * @param value A value of the data.
 *
 * @returns A number, a date, or text.
 */
export const datumOf = (value: unknown): number | Date | string | undefined => {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === "string") {
        return ISO_DATE.test(value) ? new Date(value) : value;
    }

    return undefined;
};

/**
 * @param value A series' or the graph's colors.
 *
 * @returns The colors that are strings, where there are any.
 */
const colorsOf = (value: unknown): string[] | undefined => {
    const colors = Array.isArray(value)
        ? value.filter((color): color is string => {
            return typeof color === "string";
        })
        : [];

    return colors.length > 0 ? colors : undefined;
};

/**
 * Where a series is drawn: its `transformation`, its position a number or
 * a percentage of the viewport, or the whole viewport.
 *
 * @param series The series.
 * @param viewport The graph's viewport.
 *
 * @returns Its box.
 */
const boxOf = (
    series: Record<string, unknown>,
    viewport: typeof DEFAULT_VIEWPORT,
): IBox => {
    const placed = record(series.transformation);
    const position = (value: unknown, size: number, origin: number) => {
        const percent = /^(-?\d+(?:\.\d+)?)%$/.exec(stringOf(value) ?? "");

        return percent === null
            ? numberOf(value) ?? origin
            : origin + size * Number(percent[1]) / 100;
    };

    return {
        x: position(placed?.x, viewport.width, viewport.left),
        y: position(placed?.y, viewport.height, viewport.top),
        width: numberOf(placed?.width) ?? viewport.width,
        height: numberOf(placed?.height) ?? viewport.height,
    };
};

/**
 * @param value A number on show.
 *
 * @returns It, as a reader expects it: whole numbers grouped, others to two
 *          decimals.
 */
const showNumber = (value: number): string => {
    return Number.isInteger(value)
        ? value.toLocaleString()
        : value.toFixed(2);
};

/**
 * Draws a pie series: its slices, and - unless `showValues` is false - a
 * label for each, outside the pie, with a line to its slice.
 *
 * @param root Where to draw.
 * @param series The series.
 * @param box Its box; the pie is centred at its position, as the MySQL
 *            Shell's were, unless it has none, then in the box's middle.
 * @param colors The colors the slices take in turn.
 *
 * @returns Nothing.
 */
const drawPie = (
    root: Element,
    series: Record<string, unknown>,
    box: IBox,
    colors: readonly string[],
): void => {
    const slices: ISlice[] = (Array.isArray(series.data) ? series.data : [])
        .slice(0, MAX_ITEMS).flatMap((entry): ISlice[] => {
            const datum = record(entry);
            const value = numberOf(datum?.value);

            return value === undefined || value < 0
                ? []
                : [{ name: stringOf(datum?.name) ?? "", value }];
        });
    const radius = Array.isArray(series.radius) ? series.radius : [];
    const outer = numberOf(radius[1])
        ?? Math.min(box.width, box.height) * 0.3;
    const inner = Math.min(Math.max(numberOf(radius[0]) ?? 0, 0), outer);
    const placed = record(series.transformation) !== undefined;
    const centre = placed
        ? [box.x, box.y]
        : [box.x + box.width / 2, box.y + box.height / 2];
    const angles = pieAngles(slices.map((slice) => {
        return slice.value;
    }), numberOf(series.startAngle), numberOf(series.endAngle),
    numberOf(series.padAngle));

    const group = add(root, "g", {
        class: "pieGraph",
        transform: `translate(${centre[0]},${centre[1]})`,
    });
    slices.forEach((slice, index) => {
        const path = add(group, "path", {
            class: "slice",
            d: arcPath(angles[index], inner, outer),
            fill: colors[index % colors.length],
            stroke: stringOf(series.borderColor),
            "stroke-width": numberOf(series.borderWidth),
        });
        addTooltip(path, slice.name === ""
            ? showNumber(slice.value)
            : `${slice.name}: ${showNumber(slice.value)}`);
    });

    if (series.showValues === false) {
        return;
    }

    // Each label beside the pie, on the side its slice points to.
    const offset = outer * 1.25;
    slices.forEach((slice, index) => {
        const middle = (angles[index].startAngle + angles[index].endAngle) / 2;
        const turn = ((middle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const right = turn < Math.PI;
        const from = sliceMiddle(angles[index], (inner + outer) / 2);
        const bend = sliceMiddle(angles[index], outer * 1.1);
        const end: Point = [offset * 0.95 * (right ? 1 : -1), bend[1]];
        add(group, "polyline", {
            fill: "none",
            stroke: "currentColor",
            "stroke-opacity": 0.5,
            points: [from, bend, end].map((point) => {
                return point.join(",");
            }).join(" "),
        });
        add(group, "text", {
            fill: "currentColor",
            dy: "0.35em",
            "text-anchor": right ? "start" : "end",
            transform: `translate(${offset * (right ? 1 : -1)},${bend[1]})`,
        }, slice.name === "" ? showNumber(slice.value) : slice.name);
    });
};

/** The space a plot leaves around itself, by side. */
interface IMargins {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

/**
 * @param series A series.
 * @param fallback The margins it has where it sets none.
 *
 * @returns Its margins.
 */
const marginsOf = (
    series: Record<string, unknown>,
    fallback: IMargins,
): IMargins => {
    return {
        top: numberOf(series.marginTop) ?? fallback.top,
        right: numberOf(series.marginRight) ?? fallback.right,
        bottom: numberOf(series.marginBottom) ?? fallback.bottom,
        left: numberOf(series.marginLeft) ?? fallback.left,
    };
};

/**
 * @param box A series' box.
 * @param margins The space its plot leaves.
 *
 * @returns The plot's box.
 */
const plotOf = (box: IBox, margins: IMargins): IBox => {
    return {
        x: box.x + margins.left,
        y: box.y + margins.top,
        width: Math.max(1, box.width - margins.left - margins.right),
        height: Math.max(1, box.height - margins.top - margins.bottom),
    };
};

/** A tick of an axis: where it is, and what it says. */
interface ITick {
    at: number;
    label: string;
}

/**
 * Draws an x axis along a plot's bottom.
 *
 * @param parent Where to draw.
 * @param plot The plot's box.
 * @param ticks Its ticks.
 *
 * @returns Nothing.
 */
const drawXAxis = (parent: Element, plot: IBox, ticks: readonly ITick[]): void => {
    const bottom = plot.y + plot.height;
    const axis = add(parent, "g", { class: "xAxis" });
    add(axis, "path", {
        class: "domain",
        fill: "none",
        stroke: "currentColor",
        d: `M${plot.x},${bottom}H${plot.x + plot.width}`,
    });
    for (const tick of ticks) {
        const group = add(axis, "g", {
            class: "tick",
            transform: `translate(${tick.at},${bottom})`,
        });
        add(group, "line", { stroke: "currentColor", y2: TICK_SIZE });
        add(group, "text", {
            fill: "currentColor",
            y: TICK_SIZE + 3,
            dy: "0.71em",
            "text-anchor": "middle",
        }, tick.label);
    }
};

/**
 * Draws a y axis along a plot's left, with a grid line across the plot at
 * each tick, and its caption above it.
 *
 * @param parent Where to draw.
 * @param plot The plot's box.
 * @param ticks Its ticks.
 * @param label The caption, if any.
 *
 * @returns Nothing.
 */
const drawYAxis = (
    parent: Element,
    plot: IBox,
    ticks: readonly ITick[],
    label: string | undefined,
): void => {
    const axis = add(parent, "g", { class: "yAxis" });
    add(axis, "path", {
        class: "domain",
        fill: "none",
        stroke: "currentColor",
        d: `M${plot.x},${plot.y}V${plot.y + plot.height}`,
    });
    for (const tick of ticks) {
        const group = add(axis, "g", {
            class: "tick",
            transform: `translate(${plot.x},${tick.at})`,
        });
        add(group, "line", { stroke: "currentColor", x2: -TICK_SIZE });
        add(group, "line", {
            class: "gridLine",
            stroke: "currentColor",
            "stroke-opacity": 0.2,
            x2: plot.width,
        });
        add(group, "text", {
            fill: "currentColor",
            x: -TICK_SIZE - 3,
            dy: "0.32em",
            "text-anchor": "end",
        }, tick.label);
    }
    if (label !== undefined) {
        // Over the axis, above its highest tick.
        add(axis, "text", {
            class: "yLabel",
            fill: "currentColor",
            "text-anchor": "middle",
            x: plot.x,
            y: plot.y - 16,
        }, label);
    }
};

/**
 * A linear y axis for values: its scale and its ticks, over a domain the
 * cell gave or the values' own, rounded out.
 *
 * @param values The values.
 * @param given The cell's `yDomain`, if any.
 * @param plot The plot's box.
 * @param withZero Whether the axis takes in 0, as a bar's does.
 * @param specifier The cell's `yFormat`, if any.
 *
 * @returns The scale, and the ticks.
 */
const yAxisOf = (
    values: readonly number[],
    given: unknown,
    plot: IBox,
    withZero: boolean,
    specifier: string | undefined,
): { scale: (value: number) => number; ticks: ITick[] } => {
    const count = Math.max(2, plot.height / 60);
    const domain = Array.isArray(given) ? given : [];
    const low = Math.min(...values, ...withZero ? [0] : []);
    const high = Math.max(...values, ...withZero ? [0] : []);
    const from = numberOf(domain[0])
        ?? (Number.isFinite(low) ? low : 0);
    const to = numberOf(domain[1])
        ?? (Number.isFinite(high) ? high : 1);
    const nice = numberOf(domain[0]) !== undefined
        && numberOf(domain[1]) !== undefined
        ? [from, to] as [number, number]
        : niceDomain([from, to], count);
    const scale = linearScale(nice, [plot.y + plot.height, plot.y]);
    const { values: ticks, step } = linearTicks(nice[0], nice[1], count);

    return {
        scale,
        ticks: ticks.map((value) => {
            return { at: scale(value), label: formatNumber(value, specifier, step) };
        }),
    };
};

/**
 * Draws a line series: a line per group of points, against linear or
 * time axes.
 *
 * @param root Where to draw.
 * @param series The series.
 * @param box Its box.
 * @param colors The colors the lines take in turn.
 *
 * @returns Nothing.
 */
const drawLine = (
    root: Element,
    series: Record<string, unknown>,
    box: IBox,
    colors: readonly string[],
): void => {
    const points: IPoint[] = (Array.isArray(series.data) ? series.data : [])
        .flatMap((entry): IPoint[] => {
            const datum = record(entry);
            const x = datumOf(datum?.xValue);
            if (x === undefined || typeof x === "string") {
                return [];
            }

            return [{
                x,
                y: numberOf(datum?.yValue),
                group: stringOf(datum?.group) ?? "",
            }];
        });
    const plot = plotOf(box, marginsOf(series,
        { top: 40, right: 30, bottom: 40, left: 60 }));
    const byTime = points.some((point) => {
        return point.x instanceof Date;
    });

    // The x domain: the cell's, or the points' own.
    const given = Array.isArray(series.xDomain)
        ? series.xDomain.map(datumOf)
        : [];
    const xs = points.map((point) => {
        return +point.x;
    });
    const bound = (value: unknown): number | undefined => {
        return value instanceof Date || typeof value === "number"
            ? +value
            : undefined;
    };
    const xFrom = bound(given[0]) ?? (xs.length > 0 ? Math.min(...xs) : 0);
    const xTo = bound(given[1]) ?? (xs.length > 0 ? Math.max(...xs) : 1);
    const xScale = linearScale([xFrom, xTo], [plot.x, plot.x + plot.width]);
    const xCount = numberOf(series.xTickCount) ?? plot.width / 120;
    const xTicks: ITick[] = byTime
        ? timeTicks(new Date(xFrom), new Date(xTo), xCount).map((tick) => {
            return { at: xScale(+tick.value), label: tick.label };
        })
        : linearTicks(xFrom, xTo, xCount).values.map((value, _index, all) => {
            const step = all.length > 1 ? all[1] - all[0] : 0;

            return { at: xScale(value), label: formatNumber(value, "", step) };
        });

    // The data's own range: a line is read for how it moves, not against 0.
    const ys = points.flatMap((point) => {
        return point.y === undefined ? [] : [point.y];
    });
    const y = yAxisOf(ys, series.yDomain, plot, false, stringOf(series.yFormat));

    const group = add(root, "g", { class: "lineGraph" });
    drawXAxis(group, plot, xTicks);
    drawYAxis(group, plot, y.ticks, stringOf(series.yLabel));

    const lines = new Map<string, IPoint[]>();
    for (const point of points) {
        lines.set(point.group, [...lines.get(point.group) ?? [], point]);
    }
    const curve = stringOf(series.curve) ?? "Linear";
    [...lines].forEach(([name, members], index) => {
        const path = add(group, "path", {
            class: "line",
            fill: "none",
            stroke: colors[index % colors.length],
            "stroke-width": numberOf(series.strokeWidth) ?? 1.5,
            "stroke-linejoin": "round",
            "stroke-linecap": "round",
            d: linePath(members.map((point) => {
                return [xScale(+point.x),
                    point.y === undefined ? undefined : y.scale(point.y)];
            }), curve),
        });
        if (name !== "") {
            addTooltip(path, name);
        }
    });

    // Which line is which, where there is more than one: a swatch and the
    // group's name each, at the plot's top right.
    if (lines.size > 1) {
        const legend = add(group, "g", {
            class: "legend",
            transform: `translate(${plot.x + plot.width},${plot.y})`,
        });
        [...lines.keys()].forEach((name, index) => {
            const entry = add(legend, "g", {
                transform: `translate(0,${index * 28})`,
            });
            add(entry, "rect", {
                x: -18,
                y: -9,
                width: 18,
                height: 4,
                fill: colors[index % colors.length],
            });
            add(entry, "text", {
                x: -26,
                y: -7,
                dy: "0.35em",
                "text-anchor": "end",
                fill: "currentColor",
            }, name === "" ? "(none)" : name);
        });
    }
};

/**
 * Reads a bar series' data, in either of its shapes: tabular - a row of
 * captions, then a category and its value a row - or rows, the first key
 * of each its category and the second its value.
 *
 * @param data The series' data.
 *
 * @returns Each bar's category and value.
 */
export const barsOf = (
    data: unknown,
): Array<{ category: string; value: number }> => {
    if (!Array.isArray(data) || data.length === 0) {
        return [];
    }

    const rows: unknown[][] = Array.isArray(data[0])
        ? (data as unknown[][]).slice(1)
        : data.map((entry) => {
            const row = record(entry) ?? {};

            return Object.values(row).slice(0, 2);
        });

    return rows.slice(0, MAX_ITEMS).flatMap((row) => {
        const category = datumOf(row[0]);
        const value = typeof row[1] === "number" ? row[1] : Number(row[1]);
        if (category === undefined || !Number.isFinite(value)) {
            return [];
        }

        return [{
            category: category instanceof Date
                ? category.toLocaleDateString()
                : String(category),
            value,
        }];
    });
};

/**
 * Draws a bar series: a bar per category, against a linear y axis that
 * takes in 0.
 *
 * @param root Where to draw.
 * @param series The series.
 * @param box Its box.
 * @param colors The colors the bars take in turn.
 *
 * @returns Nothing.
 */
const drawBar = (
    root: Element,
    series: Record<string, unknown>,
    box: IBox,
    colors: readonly string[],
): void => {
    const bars = barsOf(series.data);
    const plot = plotOf(box, marginsOf(series,
        { top: 40, right: 20, bottom: 40, left: 60 }));
    const band = bands(bars.length, [plot.x, plot.x + plot.width],
        numberOf(series.xPadding) ?? 0.1);
    const y = yAxisOf(bars.map((bar) => {
        return bar.value;
    }), series.yDomain, plot, true, stringOf(series.yFormat));

    const group = add(root, "g", { class: "barGraph" });
    drawYAxis(group, plot, y.ticks, stringOf(series.yLabel));
    bars.forEach((bar, index) => {
        const top = y.scale(bar.value);
        const zero = y.scale(0);
        const rect = add(group, "rect", {
            x: band.start(index),
            width: band.width,
            y: Math.min(top, zero),
            height: Math.abs(zero - top),
            fill: colors[index % colors.length],
        });
        addTooltip(rect, `${bar.category}: ${showNumber(bar.value)}`);
    });
    drawXAxis(group, plot, bars.map((bar, index) => {
        return { at: band.start(index) + band.width / 2, label: bar.category };
    }));
};

/**
 * Draws a graph.
 *
 * @param document The document to draw in.
 * @param options The graph's options, as the cell sent them.
 *
 * @returns The graph: an SVG scaled to its viewport.
 */
export const renderGraph = (
    document: Document,
    options: unknown,
): SVGSVGElement => {
    const graph = record(options) ?? {};
    const port = record(graph.viewport);
    const viewport = {
        left: numberOf(port?.left) ?? DEFAULT_VIEWPORT.left,
        top: numberOf(port?.top) ?? DEFAULT_VIEWPORT.top,
        width: numberOf(port?.width) ?? DEFAULT_VIEWPORT.width,
        height: numberOf(port?.height) ?? DEFAULT_VIEWPORT.height,
    };

    // A title is set above the viewport, in room of its own, so it never
    // runs into what the series draw at their top.
    const title = record(graph.title);
    const text = stringOf(title?.text);
    const titleRoom = text === undefined ? 0 : TITLE_ROOM;

    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("class", "graph");
    svg.setAttribute("viewBox", `${viewport.left} ${viewport.top - titleRoom} `
        + `${viewport.width} ${viewport.height + titleRoom}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    const root = add(svg, "g");

    const graphColors = colorsOf(graph.colors) ?? [...CATEGORY10];
    const series = Array.isArray(graph.series) ? graph.series : [];
    for (const entry of series) {
        const each = record(entry);
        if (each === undefined) {
            continue;
        }

        const box = boxOf(each, viewport);
        const colors = colorsOf(each.colors) ?? graphColors;
        switch (each.type) {
            case "pie": {
                drawPie(root, each, box, colors);
                break;
            }

            case "line": {
                drawLine(root, each, box, colors);
                break;
            }

            case "bar": {
                drawBar(root, each, box, colors);
                break;
            }

            default:
        }
    }

    if (text !== undefined) {
        const alignment = stringOf(title?.horizontalAlignment) ?? "Middle";
        const [x, anchor] = alignment === "Start"
            ? [viewport.left + 20, "start"]
            : alignment === "End"
                ? [viewport.left + viewport.width - 20, "end"]
                : [viewport.left + viewport.width / 2, "middle"];
        add(svg, "text", {
            class: "graphTitle",
            x,
            y: viewport.top - titleRoom / 2,
            dy: "0.35em",
            "text-anchor": anchor,
            fill: "currentColor",
        }, text);
    }

    return svg as SVGSVGElement;
};
