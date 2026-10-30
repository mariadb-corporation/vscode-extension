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
 * The arithmetic of the notebook's graphs, as far as they need it: scales,
 * round ticks, the slices of a pie, the curves of a line. What a charting
 * library would do, for three simple kinds of graph - free of the DOM, so
 * it is tested as plain numbers.
 */

/** The ten colors the series take in turn, unless told otherwise. */
export const CATEGORY10: readonly string[] = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
    "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
];

/** A point, in the graph's units. */
export type Point = [number, number];

/**
 * A round step that cuts a range into about so many ticks: 1, 2 or 5
 * times a power of ten.
 *
 * @param start One end of the range.
 * @param stop The other.
 * @param count About how many ticks.
 *
 * @returns The step; 0 for an empty range.
 */
export const tickStep = (start: number, stop: number, count: number): number => {
    const span = Math.abs(stop - start);
    if (span === 0 || !Number.isFinite(span)) {
        return 0;
    }

    const rough = span / Math.max(1, count);
    const power = 10 ** Math.floor(Math.log10(rough));
    const error = rough / power;
    const factor = error >= Math.SQRT1_2 * 10
        ? 10
        : error >= Math.sqrt(10)
            ? 5
            : error >= Math.SQRT2 ? 2 : 1;

    return factor * power;
};

/**
 * Widens a domain to round ends, so the axis starts and ends on a tick.
 *
 * @param domain Its smallest and largest value.
 * @param count About how many ticks the axis has.
 *
 * @returns The domain, rounded out; one around a single value.
 */
export const niceDomain = (
    domain: [number, number],
    count: number,
): [number, number] => {
    const [low, high] = domain[0] <= domain[1]
        ? domain
        : [domain[1], domain[0]];
    if (low === high) {
        return low === 0 ? [0, 1] : [low - Math.abs(low) / 2, high + Math.abs(high) / 2];
    }

    const step = tickStep(low, high, count);

    return [Math.floor(low / step) * step, Math.ceil(high / step) * step];
};

/**
 * @param value A number, perhaps off by a float's error.
 *
 * @returns It, as near as it is meant to be.
 */
const tidy = (value: number): number => {
    return Number(value.toPrecision(12));
};

/**
 * The ticks of a linear axis.
 *
 * @param start The domain's start.
 * @param stop Its end.
 * @param count About how many.
 *
 * @returns The ticks, round values within the domain, and their step.
 */
export const linearTicks = (
    start: number,
    stop: number,
    count: number,
): { values: number[]; step: number } => {
    const [low, high] = start <= stop ? [start, stop] : [stop, start];
    const step = tickStep(low, high, count);
    if (step === 0) {
        return { values: [tidy(low)], step: 0 };
    }

    const values: number[] = [];
    for (let index = Math.ceil(low / step); index * step <= high + step * 1e-9;
        index += 1) {
        values.push(tidy(index * step));
    }

    return { values, step };
};

/**
 * Maps a domain onto a range, in a straight line.
 *
 * @param domain The values' ends.
 * @param range Where they go.
 *
 * @returns The scale.
 */
export const linearScale = (
    domain: [number, number],
    range: [number, number],
): (value: number) => number => {
    const [d0, d1] = domain;
    const [r0, r1] = range;
    const span = d1 - d0;

    return (value) => {
        return span === 0 ? (r0 + r1) / 2 : r0 + (value - d0) / span * (r1 - r0);
    };
};

/**
 * Formats a tick or a value the way a d3 format specifier asks for, as
 * far as a notebook's graphs use them: `,` groups thousands, `.N` gives N
 * decimals, `f` fixed, `d` whole, `%` a percentage. Anything else is left
 * to the step: as many decimals as it needs.
 *
 * @param value The value.
 * @param specifier The cell's format, if any.
 * @param step The axis's tick step, which says how many decimals there are
 *             to show where the format does not.
 *
 * @returns The text.
 */
export const formatNumber = (
    value: number,
    specifier?: string,
    step = 0,
): string => {
    const parsed = /^(,)?(?:\.(\d+))?([dfr%])?$/.exec(specifier ?? "");
    const grouping = parsed?.[1] === ",";
    const type = parsed?.[3];
    const decimals = parsed?.[2] === undefined
        ? type === "d"
            ? 0
            : step > 0 ? Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) : 2
        : Number(parsed[2]);
    const shown = type === "%" ? value * 100 : value;
    const text = shown.toLocaleString("en-US", {
        useGrouping: grouping,
        minimumFractionDigits: type === "f" || type === "%" ? decimals : 0,
        maximumFractionDigits: decimals,
    });

    return type === "%" ? `${text}%` : text;
};

/** A step of a time axis: a fixed length, or a number of months. */
interface ITimeStep {
    ms?: number;
    months?: number;
    format: Intl.DateTimeFormatOptions;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The steps a time axis can tick by, finest first. */
const TIME_STEPS: readonly ITimeStep[] = [
    ...[1, 5, 15, 30].map((seconds) => {
        return { ms: seconds * SECOND, format: { hour: "2-digit",
            minute: "2-digit", second: "2-digit" } as const };
    }),
    ...[1, 5, 15, 30].map((minutes) => {
        return { ms: minutes * MINUTE, format: { hour: "2-digit",
            minute: "2-digit" } as const };
    }),
    ...[1, 3, 6, 12].map((hours) => {
        return { ms: hours * HOUR, format: { hour: "2-digit",
            minute: "2-digit" } as const };
    }),
    ...[1, 2, 7].map((days) => {
        return { ms: days * DAY, format: { month: "short",
            day: "numeric" } as const };
    }),
    ...[1, 3, 6].map((months) => {
        return { months, format: { month: "short", year: "numeric" } as const };
    }),
    ...[1, 2, 5, 10, 25, 50, 100].map((years) => {
        return { months: years * 12, format: { year: "numeric" } as const };
    }),
];

/**
 * The ticks of a time axis: the finest step that gives at most about so
 * many, on round times - whole minutes, local midnights, the first of a
 * month - each labeled for its step.
 *
 * @param start The domain's start.
 * @param stop Its end.
 * @param count About how many ticks at most.
 *
 * @returns Each tick's time and its label.
 */
export const timeTicks = (
    start: Date,
    stop: Date,
    count: number,
): Array<{ value: Date; label: string }> => {
    const [low, high] = +start <= +stop ? [+start, +stop] : [+stop, +start];
    const span = Math.max(1, high - low);
    const step = TIME_STEPS.find((candidate) => {
        const length = candidate.ms ?? (candidate.months ?? 1) * 30 * DAY;

        return span / length <= Math.max(1, count);
    }) ?? TIME_STEPS[TIME_STEPS.length - 1];
    const label = new Intl.DateTimeFormat(undefined, step.format);
    const ticks: Array<{ value: Date; label: string }> = [];

    if (step.ms !== undefined) {
        // Days start at local midnight; a shorter step counts from it too.
        const midnight = new Date(low);
        midnight.setHours(0, 0, 0, 0);
        let time = +midnight + Math.ceil((low - +midnight) / step.ms) * step.ms;
        for (; time <= high; time += step.ms) {
            ticks.push({ value: new Date(time), label: label.format(time) });
        }
    } else {
        const months = step.months ?? 1;
        const first = new Date(low);
        const monthIndex = Math.ceil((first.getFullYear() * 12 + first.getMonth()
            + (first.getDate() > 1 || first.getHours() > 0 ? 1 : 0)) / months)
            * months;
        for (let index = monthIndex; ; index += months) {
            const time = new Date(Math.floor(index / 12), index % 12, 1);
            if (+time > high) {
                break;
            }
            ticks.push({ value: time, label: label.format(time) });
        }
    }

    return ticks;
};

/**
 * Places categories in bands across a range, as bars stand: each band
 * as wide as the space allows, `padding` of a step left between them and
 * at the ends, the whole centred.
 *
 * @param count How many categories.
 * @param range The range's ends.
 * @param padding The part of a step left empty (0 to 1).
 *
 * @returns Where each band starts, and its width.
 */
export const bands = (
    count: number,
    range: [number, number],
    padding: number,
): { start(index: number): number; width: number } => {
    const pad = Math.min(Math.max(padding, 0), 1);
    const [r0, r1] = range;
    const step = (r1 - r0) / Math.max(1, count + pad);
    const offset = r0 + (r1 - r0 - step * (count - pad)) / 2;

    return {
        start: (index) => { return offset + step * index; },
        width: step * (1 - pad),
    };
};

/** A slice of a pie: where it starts and ends, clockwise from 12 o'clock. */
export interface ISliceAngles {
    startAngle: number;
    endAngle: number;
}

/**
 * Cuts a pie into slices the size of their values, in the order given.
 *
 * @param values Each slice's value; none below 0.
 * @param startAngle Where the first starts, in radians.
 * @param endAngle Where the last ends.
 * @param padAngle The angle left between two slices.
 *
 * @returns Each slice's angles.
 */
export const pieAngles = (
    values: readonly number[],
    startAngle = 0,
    endAngle = 2 * Math.PI,
    padAngle = 0,
): ISliceAngles[] => {
    const total = values.reduce((sum, value) => { return sum + value; }, 0);
    const span = endAngle - startAngle;
    const pad = values.length > 1 ? Math.min(Math.abs(padAngle),
        Math.abs(span) / values.length) : 0;
    let angle = startAngle;

    return values.map((value) => {
        const size = total > 0 ? span * value / total : 0;
        const slice = {
            startAngle: angle + pad / 2,
            endAngle: angle + size - pad / 2,
        };
        angle += size;

        return slice.endAngle < slice.startAngle
            ? { startAngle: slice.startAngle, endAngle: slice.startAngle }
            : slice;
    });
};

/**
 * @param angle An angle, clockwise from 12 o'clock.
 * @param radius How far out.
 *
 * @returns The point there, around the pie's centre.
 */
export const polar = (angle: number, radius: number): Point => {
    return [radius * Math.sin(angle), -radius * Math.cos(angle)];
};

/**
 * @param value A coordinate.
 *
 * @returns It, short enough for a path.
 */
const coordinate = (value: number): string => {
    return String(Math.round(value * 1000) / 1000);
};

/**
 * @param point A point.
 *
 * @returns It, as a path writes it.
 */
const at = (point: Point): string => {
    return `${coordinate(point[0])},${coordinate(point[1])}`;
};

/**
 * The outline of a slice, as an SVG path: a wedge to the centre, or a
 * ring's piece where the inner radius is above 0.
 *
 * @param slice The slice's angles.
 * @param inner The inner radius.
 * @param outer The outer radius.
 *
 * @returns The path; empty for a slice of no size.
 */
export const arcPath = (
    slice: ISliceAngles,
    inner: number,
    outer: number,
): string => {
    const span = slice.endAngle - slice.startAngle;
    if (span <= 0 || outer <= 0) {
        return "";
    }

    // A whole circle is two halves: an arc cannot end where it starts.
    if (span >= 2 * Math.PI - 1e-6) {
        const middle = slice.startAngle + Math.PI;
        const ring = (radius: number): string => {
            return `M${at(polar(slice.startAngle, radius))}`
                + `A${coordinate(radius)},${coordinate(radius)},0,1,1,`
                + `${at(polar(middle, radius))}`
                + `A${coordinate(radius)},${coordinate(radius)},0,1,1,`
                + `${at(polar(slice.startAngle, radius))}Z`;
        };

        return inner > 0 ? `${ring(outer)}${ring(inner)}` : ring(outer);
    }

    const large = span > Math.PI ? 1 : 0;
    const outerArc = `M${at(polar(slice.startAngle, outer))}`
        + `A${coordinate(outer)},${coordinate(outer)},0,${large},1,`
        + `${at(polar(slice.endAngle, outer))}`;
    if (inner <= 0) {
        return `${outerArc}L0,0Z`;
    }

    return `${outerArc}L${at(polar(slice.endAngle, inner))}`
        + `A${coordinate(inner)},${coordinate(inner)},0,${large},0,`
        + `${at(polar(slice.startAngle, inner))}Z`;
};

/**
 * @param slice A slice's angles.
 * @param radius How far out.
 *
 * @returns The point midway along it, at that radius.
 */
export const sliceMiddle = (slice: ISliceAngles, radius: number): Point => {
    return polar((slice.startAngle + slice.endAngle) / 2, radius);
};

/**
 * The control points of a natural cubic spline through values, one
 * coordinate at a time, as d3's natural curve solves for them.
 *
 * @param values The coordinate of each point, at least three.
 *
 * @returns Each segment's two control points.
 */
const naturalControls = (values: readonly number[]): [number[], number[]] => {
    const n = values.length - 1;
    const a: number[] = [0];
    const b: number[] = [2];
    const r: number[] = [values[0] + 2 * values[1]];
    for (let i = 1; i < n - 1; i += 1) {
        a[i] = 1;
        b[i] = 4;
        r[i] = 4 * values[i] + 2 * values[i + 1];
    }
    a[n - 1] = 2;
    b[n - 1] = 7;
    r[n - 1] = 8 * values[n - 1] + values[n];
    for (let i = 1; i < n; i += 1) {
        const m = a[i] / b[i - 1];
        b[i] -= m;
        r[i] -= m * r[i - 1];
    }
    a[n - 1] = r[n - 1] / b[n - 1];
    for (let i = n - 2; i >= 0; i -= 1) {
        a[i] = (r[i] - a[i + 1]) / b[i];
    }
    b[n - 1] = (values[n] + a[n - 1]) / 2;
    for (let i = 0; i < n - 1; i += 1) {
        b[i] = 2 * values[i + 1] - a[i + 1];
    }

    return [a, b];
};

/**
 * One run of points, joined: straight, in steps, or smoothly.
 *
 * @param points The points, none missing.
 * @param curve How they are joined.
 *
 * @returns The path's commands, starting with a move to the first point.
 */
const segmentPath = (points: readonly Point[], curve: string): string => {
    const [first] = points;
    let path = `M${at(first)}`;
    if (points.length === 1) {
        return path;
    }

    switch (curve) {
        case "Step":
        case "StepBefore":
        case "StepAfter": {
            for (let i = 1; i < points.length; i += 1) {
                const [x0, y0] = points[i - 1];
                const [x1, y1] = points[i];
                const turn = curve === "Step"
                    ? (x0 + x1) / 2
                    : curve === "StepBefore" ? x0 : x1;
                path += `L${at([turn, y0])}L${at([turn, y1])}L${at([x1, y1])}`;
            }

            return path;
        }

        case "Natural": {
            if (points.length === 2) {
                return `${path}L${at(points[1])}`;
            }
            const [ax, bx] = naturalControls(points.map((point) => {
                return point[0];
            }));
            const [ay, by] = naturalControls(points.map((point) => {
                return point[1];
            }));
            for (let i = 1; i < points.length; i += 1) {
                path += `C${at([ax[i - 1], ay[i - 1]])},`
                    + `${at([bx[i - 1], by[i - 1]])},${at(points[i])}`;
            }

            return path;
        }

        case "Basis":
        case "Bundle": {
            // A uniform B-spline, its ends drawn to the end points, as d3's
            // basis curve does.
            if (points.length === 2) {
                return `${path}L${at(points[1])}`;
            }
            const bezier = (p0: Point, p1: Point, p: Point): string => {
                return `C${at([(2 * p0[0] + p1[0]) / 3, (2 * p0[1] + p1[1]) / 3])},`
                    + `${at([(p0[0] + 2 * p1[0]) / 3, (p0[1] + 2 * p1[1]) / 3])},`
                    + `${at([(p0[0] + 4 * p1[0] + p[0]) / 6,
                        (p0[1] + 4 * p1[1] + p[1]) / 6])}`;
            };
            const [p0, p1] = points;
            path += `L${at([(5 * p0[0] + p1[0]) / 6, (5 * p0[1] + p1[1]) / 6])}`;
            for (let i = 2; i < points.length; i += 1) {
                path += bezier(points[i - 2], points[i - 1], points[i]);
            }
            const last = points[points.length - 1];
            path += bezier(points[points.length - 2], last, last);

            return `${path}L${at(last)}`;
        }

        default: {
            for (const point of points.slice(1)) {
                path += `L${at(point)}`;
            }

            return path;
        }
    }
};

/**
 * A line through points, as an SVG path: a gap where a point has no y,
 * each run between gaps joined as the curve says - `Linear`, `Step`,
 * `StepBefore`, `StepAfter`, `Natural`, `Basis` (`Bundle` drawn as it).
 *
 * @param points The points; one without a y is a gap.
 * @param curve How they are joined; straight where unknown.
 *
 * @returns The path; empty where there is nothing to draw.
 */
export const linePath = (
    points: ReadonlyArray<[number, number | undefined]>,
    curve = "Linear",
): string => {
    const runs: Point[][] = [[]];
    for (const [x, y] of points) {
        if (y === undefined || !Number.isFinite(y) || !Number.isFinite(x)) {
            if (runs[runs.length - 1].length > 0) {
                runs.push([]);
            }
            continue;
        }
        runs[runs.length - 1].push([x, y]);
    }

    return runs.filter((run) => {
        return run.length > 0;
    }).map((run) => {
        return segmentPath(run, curve);
    }).join("");
};
