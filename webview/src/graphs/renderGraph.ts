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
 * them. The options are the cell's, sent as JSON, so every one of them is
 * checked as it is read: a value of the wrong kind is left out, not
 * trusted. Text and axes take the theme's foreground; the series their
 * colors, or d3's ten.
 */

import {
    axisBottom,
    axisLeft,
    curveBasis,
    curveBundle,
    curveLinear,
    curveNatural,
    curveStep,
    curveStepAfter,
    curveStepBefore,
    type Axis,
    type CurveFactory,
    type CurveFactoryLineOnly,
    extent,
    group as groupBy,
    line,
    type NumberValue,
    pie,
    arc,
    type PieArcDatum,
    scaleBand,
    scaleLinear,
    scaleTime,
    schemeCategory10,
    select,
    type Selection,
} from "d3";

/** The SVG namespace. */
const SVG = "http://www.w3.org/2000/svg";

/** The viewport a graph is laid out in, unless it says otherwise. */
export const DEFAULT_VIEWPORT = { left: 0, top: 0, width: 1200, height: 900 };

/** The room a title takes above the viewport. */
const TITLE_ROOM = 60;

/** The most slices or bars drawn; the rest are left out. */
const MAX_ITEMS = 100;

/** A part of the graph, in the viewport's units. */
interface IBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

type Group = Selection<SVGGElement, unknown, null, undefined>;

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
 * Adds a tooltip to an element: SVG's own, which the webview shows.
 *
 * @param target The element.
 * @param text What it says.
 *
 * @returns Nothing.
 */
const addTooltip = (target: Element, text: string): void => {
    const title = target.ownerDocument.createElementNS(SVG, "title");
    title.textContent = text;
    target.append(title);
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
    root: Group,
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
    const inner = Math.min(numberOf(radius[0]) ?? 0, outer);
    const placed = record(series.transformation) !== undefined;
    const centre = placed
        ? [box.x, box.y]
        : [box.x + box.width / 2, box.y + box.height / 2];

    const layout = pie<ISlice>().sort(null).value((slice) => {
        return slice.value;
    });
    const startAngle = numberOf(series.startAngle);
    const endAngle = numberOf(series.endAngle);
    const padAngle = numberOf(series.padAngle);
    if (startAngle !== undefined) {
        layout.startAngle(startAngle);
    }
    if (endAngle !== undefined) {
        layout.endAngle(endAngle);
    }
    if (padAngle !== undefined) {
        layout.padAngle(padAngle);
    }
    const arcs = layout(slices);
    const shape = arc<PieArcDatum<ISlice>>()
        .innerRadius(inner)
        .outerRadius(outer)
        .cornerRadius(numberOf(series.borderRadius) ?? 0);

    const group = root.append("g")
        .attr("class", "pieGraph")
        .attr("transform", `translate(${centre[0]},${centre[1]})`);
    group.selectAll("path.slice").data(arcs).join("path")
        .attr("class", "slice")
        .attr("d", shape)
        .attr("fill", (_datum, index) => {
            return colors[index % colors.length];
        })
        .attr("stroke", stringOf(series.borderColor) ?? null)
        .attr("stroke-width", numberOf(series.borderWidth) ?? null)
        .each(function (datum) {
            addTooltip(this as Element, datum.data.name === ""
                ? showNumber(datum.data.value)
                : `${datum.data.name}: ${showNumber(datum.data.value)}`);
        });

    if (series.showValues === false) {
        return;
    }

    // Each label beside the pie, on the side its slice points to.
    const labelArc = arc<PieArcDatum<ISlice>>()
        .innerRadius(outer * 1.1)
        .outerRadius(outer * 1.1);
    const offset = outer * 1.25;
    const right = (datum: PieArcDatum<ISlice>): boolean => {
        return (datum.startAngle + datum.endAngle) / 2 < Math.PI;
    };
    group.selectAll("polyline").data(arcs).join("polyline")
        .attr("fill", "none")
        .attr("stroke", "currentColor")
        .attr("stroke-opacity", 0.5)
        .attr("points", (datum) => {
            const bend = labelArc.centroid(datum);
            const end = [offset * 0.95 * (right(datum) ? 1 : -1), bend[1]];

            return [shape.centroid(datum), bend, end].map((point) => {
                return point.join(",");
            }).join(" ");
        });
    group.selectAll("text").data(arcs).join("text")
        .attr("fill", "currentColor")
        .attr("dy", "0.35em")
        .attr("text-anchor", (datum) => {
            return right(datum) ? "start" : "end";
        })
        .attr("transform", (datum) => {
            const [, y] = labelArc.centroid(datum);

            return `translate(${offset * (right(datum) ? 1 : -1)},${y})`;
        })
        .text((datum) => {
            return datum.data.name === ""
                ? showNumber(datum.data.value)
                : datum.data.name;
        });
};

/** The curves a line series can be drawn with. */
const CURVES: Record<string, CurveFactory | CurveFactoryLineOnly> = {
    Basis: curveBasis,
    Bundle: curveBundle,
    Linear: curveLinear,
    Natural: curveNatural,
    Step: curveStep,
    StepBefore: curveStepBefore,
    StepAfter: curveStepAfter,
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
 * Draws a y axis with grid lines across the plot, and its caption.
 *
 * @param group Where to draw.
 * @param axis The axis.
 * @param plot The plot's box.
 * @param label The caption, if any.
 *
 * @returns Nothing.
 */
const drawYAxis = (
    group: Group,
    axis: Axis<NumberValue>,
    plot: IBox,
    label: string | undefined,
): void => {
    const host = group.append("g")
        .attr("class", "yAxis")
        .attr("transform", `translate(${plot.x},0)`)
        .call(axis)
        // The graph's own size, not d3's 10px, which is tiny scaled down.
        .attr("font-size", null)
        .attr("font-family", null);
    host.selectAll(".tick line").clone()
        .attr("stroke-opacity", 0.2)
        .attr("x2", plot.width);
    if (label !== undefined) {
        // Over the axis, above its highest tick.
        host.append("text")
            .attr("class", "yLabel")
            .attr("fill", "currentColor")
            .attr("text-anchor", "middle")
            .attr("x", 0)
            .attr("y", plot.y - 16)
            .text(label);
    }
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
    root: Group,
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
    const margins = marginsOf(series,
        { top: 40, right: 30, bottom: 40, left: 60 });
    const plot: IBox = {
        x: box.x + margins.left,
        y: box.y + margins.top,
        width: Math.max(1, box.width - margins.left - margins.right),
        height: Math.max(1, box.height - margins.top - margins.bottom),
    };
    const byTime = points.some((point) => {
        return point.x instanceof Date;
    });

    const xDomain = Array.isArray(series.xDomain)
        ? series.xDomain.map(datumOf)
        : [];
    const xValues = points.map((point) => {
        return +point.x;
    });
    const [xLow, xHigh] = [
        xDomain[0] instanceof Date || typeof xDomain[0] === "number"
            ? +xDomain[0] : undefined,
        xDomain[1] instanceof Date || typeof xDomain[1] === "number"
            ? +xDomain[1] : undefined,
    ];
    const xExtent = extent(xValues);
    const xRange: [number, number] = [plot.x, plot.x + plot.width];
    const xFrom = xLow ?? xExtent[0] ?? 0;
    const xTo = xHigh ?? xExtent[1] ?? 1;
    const xScale = byTime
        ? scaleTime([new Date(xFrom), new Date(xTo)], xRange)
        : scaleLinear([xFrom, xTo], xRange);

    // The data's own range: a line is read for how it moves, not against 0.
    const yDomain = Array.isArray(series.yDomain) ? series.yDomain : [];
    const yExtent = extent(points, (point) => {
        return point.y;
    });
    const yScale = scaleLinear(
        [numberOf(yDomain[0]) ?? yExtent[0] ?? 0,
            numberOf(yDomain[1]) ?? yExtent[1] ?? 1],
        [plot.y + plot.height, plot.y]).nice();

    const group = root.append("g").attr("class", "lineGraph");
    group.append("g")
        .attr("class", "xAxis")
        .attr("transform", `translate(0,${plot.y + plot.height})`)
        .call(axisBottom(xScale as never).ticks(
            numberOf(series.xTickCount) ?? plot.width / 120))
        .attr("font-size", null)
        .attr("font-family", null);
    drawYAxis(group, axisLeft(yScale).ticks(
        numberOf(series.yTickCount) ?? plot.height / 60,
        stringOf(series.yFormat)), plot, stringOf(series.yLabel));

    const curve = CURVES[stringOf(series.curve) ?? ""] ?? curveLinear;
    const path = line<IPoint>()
        .defined((point) => {
            return point.y !== undefined;
        })
        .x((point) => {
            return (xScale as (value: number | Date) => number)(point.x);
        })
        .y((point) => {
            return yScale(point.y ?? 0);
        })
        .curve(curve);
    const lines = [...groupBy(points, (point) => {
        return point.group;
    })];
    group.selectAll("path.line").data(lines).join("path")
        .attr("class", "line")
        .attr("fill", "none")
        .attr("stroke", (_datum, index) => {
            return colors[index % colors.length];
        })
        .attr("stroke-width", numberOf(series.strokeWidth) ?? 1.5)
        .attr("stroke-linejoin", "round")
        .attr("stroke-linecap", "round")
        .attr("d", ([, members]) => {
            return path(members);
        })
        .each(function ([name]) {
            if (name !== "") {
                addTooltip(this as Element, name);
            }
        });

    // Which line is which, where there is more than one: a swatch and the
    // group's name each, at the plot's top right.
    if (lines.length > 1) {
        const legend = group.append("g")
            .attr("class", "legend")
            .attr("transform", `translate(${plot.x + plot.width},${plot.y})`);
        lines.forEach(([name], index) => {
            const entry = legend.append("g")
                .attr("transform", `translate(0,${index * 28})`);
            entry.append("rect")
                .attr("x", -18)
                .attr("y", -9)
                .attr("width", 18)
                .attr("height", 4)
                .attr("fill", colors[index % colors.length]);
            entry.append("text")
                .attr("x", -26)
                .attr("dy", "0.35em")
                .attr("y", -7)
                .attr("text-anchor", "end")
                .attr("fill", "currentColor")
                .text(name === "" ? "(none)" : name);
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
 * Draws a bar series: a bar per category, against a linear y axis.
 *
 * @param root Where to draw.
 * @param series The series.
 * @param box Its box.
 * @param colors The colors the bars take in turn.
 *
 * @returns Nothing.
 */
const drawBar = (
    root: Group,
    series: Record<string, unknown>,
    box: IBox,
    colors: readonly string[],
): void => {
    const bars = barsOf(series.data);
    const margins = marginsOf(series,
        { top: 40, right: 20, bottom: 40, left: 60 });
    const plot: IBox = {
        x: box.x + margins.left,
        y: box.y + margins.top,
        width: Math.max(1, box.width - margins.left - margins.right),
        height: Math.max(1, box.height - margins.top - margins.bottom),
    };
    const xScale = scaleBand(bars.map((bar) => {
        return bar.category;
    }), [plot.x, plot.x + plot.width])
        .padding(numberOf(series.xPadding) ?? 0.1);
    const yDomain = Array.isArray(series.yDomain) ? series.yDomain : [];
    const yExtent = extent(bars, (bar) => {
        return bar.value;
    });
    const yScale = scaleLinear(
        [numberOf(yDomain[0]) ?? Math.min(0, yExtent[0] ?? 0),
            numberOf(yDomain[1]) ?? Math.max(0, yExtent[1] ?? 1)],
        [plot.y + plot.height, plot.y]).nice();

    const group = root.append("g").attr("class", "barGraph");
    drawYAxis(group, axisLeft(yScale).ticks(plot.height / 60,
        stringOf(series.yFormat)), plot, stringOf(series.yLabel));
    group.selectAll("rect").data(bars).join("rect")
        .attr("x", (bar) => {
            return xScale(bar.category) ?? 0;
        })
        .attr("width", xScale.bandwidth())
        .attr("y", (bar) => {
            return Math.min(yScale(bar.value), yScale(0));
        })
        .attr("height", (bar) => {
            return Math.abs(yScale(0) - yScale(bar.value));
        })
        .attr("fill", (_bar, index) => {
            return colors[index % colors.length];
        })
        .each(function (bar) {
            addTooltip(this as Element,
                `${bar.category}: ${showNumber(bar.value)}`);
        });
    group.append("g")
        .attr("class", "xAxis")
        .attr("transform", `translate(0,${plot.y + plot.height})`)
        .call(axisBottom(xScale))
        .attr("font-size", null)
        .attr("font-family", null);
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
    const root = select(svg).append("g") as unknown as Group;

    const graphColors = colorsOf(graph.colors) ?? [...schemeCategory10];
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
        select(svg).append("text")
            .attr("class", "graphTitle")
            .attr("x", x)
            .attr("y", viewport.top - titleRoom / 2)
            .attr("dy", "0.35em")
            .attr("text-anchor", anchor)
            .attr("fill", "currentColor")
            .text(text);
    }

    return svg;
};
