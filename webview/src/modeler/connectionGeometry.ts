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

import type { IRect } from "../../../src/modeler/pageSettings.js";
import type { IPoint, Segment } from "../canvas/geometry.js";

/**
 * How the EER diagram draws a foreign key between two tables: an
 * orthogonal route out of the sides that face each other, the crow's
 * foot notation at its ends, and the stubs of a connection drawn split.
 * Pure, so it can be tested without WebGL.
 */

/** The side of a figure a connection leaves or enters. */
export type Side = "left" | "right" | "top" | "bottom";

/** The size of the end markers in diagram units. */
export const MARKER_SIZE = 12;

/**
 * A route's middle segment, which can be moved towards either figure: the
 * axis it moves along, where it sits halfway between them, and how far it
 * can go each way.
 */
export interface IMiddleSegment {
    axis: "x" | "y";
    /** Where it is halfway between the figures. */
    base: number;
    /** Where it is now. */
    at: number;
    min: number;
    max: number;
}

/** A connection's route. */
export interface IRoute {
    /** The polyline, from the start figure's edge to the end figure's. */
    points: IPoint[];
    startSide: Side;
    endSide: Side;
    /** The middle segment, where the route has one between the figures. */
    middle?: IMiddleSegment;
}

/**
 * How close the middle segment comes to a figure: room for the end
 * markers (a crow's foot and its bar) and a little line beyond them.
 */
export const MIDDLE_CLEARANCE = 2 * MARKER_SIZE;

/**
 * Where a middle segment between two edges sits, moved by an offset from
 * halfway and kept clear of both figures.
 *
 * @param axis The axis it moves along.
 * @param from The start figure's edge.
 * @param to The end figure's edge.
 * @param offset How far from halfway, towards larger coordinates.
 *
 * @returns The middle segment.
 */
export const middleSegment = (
    axis: "x" | "y",
    from: number,
    to: number,
    offset: number,
): IMiddleSegment => {
    const base = (from + to) / 2;
    let min = Math.min(from, to) + MIDDLE_CLEARANCE;
    let max = Math.max(from, to) - MIDDLE_CLEARANCE;
    // Too close for any room: it stays halfway.
    if (min > max) {
        min = max = base;
    }

    return { axis, base, at: Math.min(max, Math.max(min, base + offset)),
        min, max };
};

/** The sides a connection leaves and enters by, or a loop. */
type Sides = { loop: false; startSide: Side; endSide: Side }
    | { loop: true; startSide: "right"; endSide: "top" };

/**
 * @param start The start figure's rectangle.
 * @param end The end figure's rectangle.
 *
 * @returns The sides that face each other: left and right where the
 *          figures are further apart across than up and down, else top
 *          and bottom; a loop out of the right side and back in at the top
 *          for a self reference or figures on top of each other.
 */
const sidesOf = (start: IRect, end: IRect): Sides => {
    const horizontalGap = Math.max(end.left - (start.left + start.width),
        start.left - (end.left + end.width));
    const verticalGap = Math.max(end.top - (start.top + start.height),
        start.top - (end.top + end.height));
    if (horizontalGap < 0 && verticalGap < 0) {
        return { loop: true, startSide: "right", endSide: "top" };
    }
    if (horizontalGap >= verticalGap) {
        const startIsLeft = start.left + start.width / 2
            < end.left + end.width / 2;

        return { loop: false, startSide: startIsLeft ? "right" : "left",
            endSide: startIsLeft ? "left" : "right" };
    }
    const startIsAbove = start.top + start.height / 2
        < end.top + end.height / 2;

    return { loop: false, startSide: startIsAbove ? "bottom" : "top",
        endSide: startIsAbove ? "top" : "bottom" };
};

/**
 * A connection's end placed by hand: the side of its figure, and where on
 * the side's straight part it goes among the others there, 0 to 1.
 */
export interface IDock {
    side: Side;
    at: number;
}

/** Where a connection meets its figures. */
export interface IAnchors {
    /** On the start figure's side: a y on a left or right side, else an x. */
    start?: number;
    end?: number;
    /** The sides, where they are not the ones that face each other. */
    startSide?: Side;
    endSide?: Side;
}

/** A connection drawn on a diagram, for spreading the lines on a side. */
export interface IConnectionEnds {
    id: string;
    startFigure: string;
    endFigure: string;
    start: IRect;
    end: IRect;
    /** Ends placed by hand. */
    startDock?: IDock;
    endDock?: IDock;
}

/**
 * @param side A side.
 *
 * @returns Whether it is the left or right one: a line leaves it across.
 */
const isVertical = (side: Side): boolean => {
    return side === "left" || side === "right";
};

/**
 * @param rect A figure.
 * @param side One of its sides.
 * @param corner The corner radius, left out at each end.
 *
 * @returns The side's straight part: where it starts along its axis, and
 *          how long it is.
 */
const straightPart = (
    rect: IRect,
    side: Side,
    corner: number,
): { from: number; length: number } => {
    const vertical = isVertical(side);
    const full = vertical ? rect.height : rect.width;
    // A side shorter than its two corners has no straight part: its
    // middle, then.
    const cut = Math.min(corner, full / 2);

    return { from: (vertical ? rect.top : rect.left) + cut,
        length: full - 2 * cut };
};

/**
 * @param rect A figure.
 * @param side One of its sides.
 * @param count How many lines meet it.
 * @param corner The corner radius, left out at each end.
 *
 * @returns Where they meet it along its axis, in order: its straight part
 *          split into count + 2 parts, the middles of the inner ones.
 */
export const sideSlots = (
    rect: IRect,
    side: Side,
    count: number,
    corner = 0,
): number[] => {
    const { from, length } = straightPart(rect, side, corner);

    return Array.from({ length: count }, (_, index) => {
        return from + length * (index + 1.5) / (count + 2);
    });
};

/**
 * Where each connection meets its figures, spread over the sides they
 * share: the straight part of a side (its rounded corners left out) is
 * split into n + 2 parts for n lines, which meet it at the middles of the
 * inner n (one in the middle; two at 3/8 and 5/8), so they gather towards
 * the middle and never dock on a corner. An end placed by hand
 * (`IDock`) keeps its side, and its `at` is its place in the order there;
 * the others take the sides that face each other, in the order of where
 * the figures at their other ends are along the side, so they do not
 * cross.
 *
 * @param connections The connections drawn.
 * @param corner The figures' corner radius: left out at each end of a side.
 *
 * @returns Each connection's anchors, by id: both sides and both places.
 */
export const spreadAnchors = (
    connections: readonly IConnectionEnds[],
    corner = 0,
): Map<string, IAnchors> => {
    interface IEnd {
        id: string;
        which: "start" | "end";
        /** Its place among the side's ends, 0 to 1 along the side. */
        order: number;
        /** What sorts ends of the same place: where they come from. */
        then: number;
    }
    const sides = new Map<string, { rect: IRect; side: Side; ends: IEnd[] }>();
    const add = (figure: string, rect: IRect, side: Side, end: IEnd): void => {
        const key = `${figure}\u0000${side}`;
        let entry = sides.get(key);
        if (entry === undefined) {
            entry = { rect, side, ends: [] };
            sides.set(key, entry);
        }
        entry.ends.push(end);
    };
    // An end placed automatically takes the place of the figure at its
    // other end, along its side, as a share of the side.
    const towards = (rect: IRect, side: Side, other: IRect): {
        order: number; then: number;
    } => {
        const along = isVertical(side)
            ? other.top + other.height / 2 : other.left + other.width / 2;
        const { from, length } = straightPart(rect, side, corner);
        const share = length <= 0 ? 0.5 : (along - from) / length;

        return { order: Math.min(1, Math.max(0, share)), then: along };
    };
    const anchors = new Map<string, IAnchors>();
    for (const connection of connections) {
        const { id, start, end, startDock, endDock } = connection;
        const auto = sidesOf(start, end);
        const startSide = startDock?.side ?? auto.startSide;
        const endSide = endDock?.side ?? auto.endSide;
        anchors.set(id, { startSide, endSide });
        // A loop goes out to the upper right and comes back from there:
        // first on the right side, last on the top.
        add(connection.startFigure, start, startSide, { id, which: "start",
            ...(startDock !== undefined
                ? { order: startDock.at, then: startDock.at }
                : auto.loop ? { order: 0, then: -Infinity }
                    : towards(start, startSide, end)) });
        add(connection.endFigure, end, endSide, { id, which: "end",
            ...(endDock !== undefined
                ? { order: endDock.at, then: endDock.at }
                : auto.loop ? { order: 1, then: Infinity }
                    : towards(end, endSide, start)) });
    }

    for (const { rect, side, ends } of sides.values()) {
        ends.sort((a, b) => {
            return a.order - b.order || a.then - b.then
                || a.id.localeCompare(b.id);
        });
        const slots = sideSlots(rect, side, ends.length, corner);
        ends.forEach((end, index) => {
            anchors.set(end.id, { ...anchors.get(end.id),
                [end.which]: slots[index] });
        });
    }

    return anchors;
};

/**
 * Where an end dragged to a point goes on its figure: the nearest side,
 * and where along its straight part, 0 to 1.
 *
 * @param rect The figure.
 * @param point The point, on the page.
 * @param corner The corner radius, left out at each end of a side.
 *
 * @returns The dock.
 */
export const nearestDock = (
    rect: IRect,
    point: IPoint,
    corner = 0,
): IDock => {
    const right = rect.left + rect.width;
    const bottom = rect.top + rect.height;
    const clamp = (value: number, low: number, high: number): number => {
        return Math.min(high, Math.max(low, value));
    };
    // Outside the figure, the side the point is furthest beyond (above
    // and a little right is the top); inside, the nearest edge.
    const beyondX = Math.max(rect.left - point.x, point.x - right);
    const beyondY = Math.max(rect.top - point.y, point.y - bottom);
    let side: Side;
    if (beyondX > 0 || beyondY > 0) {
        side = beyondY > beyondX
            ? point.y < rect.top ? "top" : "bottom"
            : point.x < rect.left ? "left" : "right";
    } else {
        const gaps: Array<[Side, number]> = [["left", point.x - rect.left],
            ["right", right - point.x], ["top", point.y - rect.top],
            ["bottom", bottom - point.y]];
        side = gaps.reduce((best, gap) => {
            return gap[1] < best[1] ? gap : best;
        })[0];
    }
    const { from, length } = straightPart(rect, side, corner);
    const along = isVertical(side) ? point.y : point.x;

    return { side, at: length <= 0 ? 0.5 : clamp((along - from) / length, 0, 1) };
};

/** How far a line goes straight out of a side it does not face across. */
const STUB = 20;

/**
 * @param rect A figure.
 * @param side One of its sides.
 * @param at Where along it; left out, its middle.
 *
 * @returns The point on that side.
 */
const pointOnSide = (rect: IRect, side: Side, at?: number): IPoint => {
    switch (side) {
        case "left": {
            return { x: rect.left, y: at ?? rect.top + rect.height / 2 };
        }
        case "right": {
            return { x: rect.left + rect.width,
                y: at ?? rect.top + rect.height / 2 };
        }
        case "top": {
            return { x: at ?? rect.left + rect.width / 2, y: rect.top };
        }
        default: {
            return { x: at ?? rect.left + rect.width / 2,
                y: rect.top + rect.height };
        }
    }
};

/**
 * @param points A polyline.
 *
 * @returns It without repeated points and without points in the middle of
 *          a straight run.
 */
const simplified = (points: IPoint[]): IPoint[] => {
    const kept: IPoint[] = [];
    for (const point of points) {
        const last = kept[kept.length - 1];
        if (last !== undefined && last.x === point.x && last.y === point.y) {
            continue;
        }
        const before = kept[kept.length - 2];
        if (before !== undefined && last !== undefined
            && ((before.x === last.x && last.x === point.x)
                || (before.y === last.y && last.y === point.y))) {
            kept[kept.length - 1] = point;
            continue;
        }
        kept.push(point);
    }

    return kept;
};

/**
 * Routes a connection between two figures as an orthogonal line: out of
 * the sides that face each other, with one middle segment where the
 * figures are side by side or above each other, and a Z where they
 * overlap in neither direction. Ends placed on other sides (`IAnchors`'
 * sides) go straight out of them and are joined at right angles: an L
 * where the corner lies ahead of both, else around.
 *
 * @param start The start figure's rectangle (the foreign key's table).
 * @param end The end figure's rectangle (the referenced table).
 * @param offset How far the middle segment is moved from halfway between
 *               them, towards larger coordinates (Workbench's
 *               `middleSegmentOffset`).
 * @param anchors Where it meets each figure (`spreadAnchors`); left out,
 *                the facing sides' middles.
 *
 * @returns The route.
 */
export const routeConnection = (
    start: IRect,
    end: IRect,
    offset = 0,
    anchors: IAnchors = {},
): IRoute => {
    const auto = sidesOf(start, end);
    const startSide = anchors.startSide ?? auto.startSide;
    const endSide = anchors.endSide ?? auto.endSide;
    const p1 = pointOnSide(start, startSide, anchors.start);
    const p2 = pointOnSide(end, endSide, anchors.end);

    // A self reference, or figures on top of each other: a loop out of
    // the right side and back in at the top.
    if (auto.loop && startSide === "right" && endSide === "top") {
        const outX = Math.max(start.left + start.width,
            end.left + end.width) + 20;
        const points: IPoint[] = [
            p1,
            { x: outX, y: p1.y },
            { x: outX, y: end.top - 20 },
            { x: p2.x, y: end.top - 20 },
            p2,
        ];

        return { points, startSide, endSide };
    }

    // Sides facing each other across the gap: one middle segment.
    if ((startSide === "right" && endSide === "left" && p1.x <= p2.x)
        || (startSide === "left" && endSide === "right" && p1.x >= p2.x)) {
        const middle = middleSegment("x", p1.x, p2.x, offset);

        return {
            points: [p1, { x: middle.at, y: p1.y }, { x: middle.at, y: p2.y }, p2],
            startSide,
            endSide,
            middle,
        };
    }
    if ((startSide === "bottom" && endSide === "top" && p1.y <= p2.y)
        || (startSide === "top" && endSide === "bottom" && p1.y >= p2.y)) {
        const middle = middleSegment("y", p1.y, p2.y, offset);

        return {
            points: [p1, { x: p1.x, y: middle.at }, { x: p2.x, y: middle.at }, p2],
            startSide,
            endSide,
            middle,
        };
    }

    // Placed by hand on sides that do not face each other.
    const a = outward(startSide);
    const b = outward(endSide);
    const ahead = (corner: IPoint): boolean => {
        return (corner.x - p1.x) * a.x + (corner.y - p1.y) * a.y >= STUB
            && (corner.x - p2.x) * b.x + (corner.y - p2.y) * b.y >= STUB;
    };
    if (isVertical(startSide) !== isVertical(endSide)) {
        const corner = isVertical(startSide)
            ? { x: p2.x, y: p1.y } : { x: p1.x, y: p2.y };
        if (ahead(corner)) {
            return { points: [p1, corner, p2], startSide, endSide };
        }
    }
    const q1 = { x: p1.x + a.x * STUB, y: p1.y + a.y * STUB };
    const q2 = { x: p2.x + b.x * STUB, y: p2.y + b.y * STUB };
    let points: IPoint[];
    if (isVertical(startSide) !== isVertical(endSide)) {
        // Out of each side, then across: the turns alternate, so the line
        // never doubles back.
        const turn = isVertical(startSide)
            ? { x: q1.x, y: q2.y } : { x: q2.x, y: q1.y };
        points = [p1, q1, turn, q2, p2];
    } else if (startSide === endSide) {
        // The same way out: a U around beyond both.
        if (isVertical(startSide)) {
            const x = a.x > 0 ? Math.max(q1.x, q2.x) : Math.min(q1.x, q2.x);
            points = [p1, { x, y: p1.y }, { x, y: p2.y }, p2];
        } else {
            const y = a.y > 0 ? Math.max(q1.y, q2.y) : Math.min(q1.y, q2.y);
            points = [p1, { x: p1.x, y }, { x: p2.x, y }, p2];
        }
    } else if (isVertical(startSide)) {
        // Facing away: out of both, across halfway between them.
        const y = (p1.y + p2.y) / 2;
        points = [p1, q1, { x: q1.x, y }, { x: q2.x, y }, q2, p2];
    } else {
        const x = (p1.x + p2.x) / 2;
        points = [p1, q1, { x, y: q1.y }, { x, y: q2.y }, q2, p2];
    }

    return { points: simplified(points), startSide, endSide };
};

/**
 * The direction a line takes away from a figure's side.
 *
 * @param side The side.
 *
 * @returns A unit vector pointing away from the figure.
 */
const outward = (side: Side): IPoint => {
    switch (side) {
        case "left": { return { x: -1, y: 0 }; }
        case "right": { return { x: 1, y: 0 }; }
        case "top": { return { x: 0, y: -1 }; }
        default: { return { x: 0, y: 1 }; }
    }
};

/**
 * The crow's foot at the "many" end of a connection: three prongs from a
 * point on the line to the figure's edge, plus a bar for a mandatory
 * side.
 *
 * @param at Where the line meets the figure.
 * @param side The figure's side it meets.
 * @param mandatory Whether every row of the "one" side needs a row here;
 *                  drawn as a bar across the line.
 *
 * @returns The segments to draw.
 */
export const crowsFoot = (
    at: IPoint,
    side: Side,
    mandatory: boolean,
): Segment[] => {
    const out = outward(side);
    // Perpendicular to the line.
    const across = { x: -out.y, y: out.x };
    const root = { x: at.x + out.x * MARKER_SIZE, y: at.y + out.y * MARKER_SIZE };
    const half = MARKER_SIZE / 2;
    const segments: Segment[] = [
        [root, at],
        [root, { x: at.x + across.x * half, y: at.y + across.y * half }],
        [root, { x: at.x - across.x * half, y: at.y - across.y * half }],
    ];
    if (mandatory) {
        const bar = {
            x: root.x + out.x * (MARKER_SIZE / 2),
            y: root.y + out.y * (MARKER_SIZE / 2),
        };
        segments.push([
            { x: bar.x + across.x * half, y: bar.y + across.y * half },
            { x: bar.x - across.x * half, y: bar.y - across.y * half },
        ]);
    }

    return segments;
};

/**
 * The marker at the "one" end of a connection: a bar across the line, and
 * a second one for a mandatory side (a circle would say optional; the
 * model has no optional references).
 *
 * @param at Where the line meets the figure.
 * @param side The figure's side it meets.
 * @param mandatory Whether the reference is mandatory.
 *
 * @returns The segments to draw.
 */
export const oneMarker = (
    at: IPoint,
    side: Side,
    mandatory: boolean,
): Segment[] => {
    const out = outward(side);
    const across = { x: -out.y, y: out.x };
    const half = MARKER_SIZE / 2;
    const bar = (distance: number): Segment => {
        const center = { x: at.x + out.x * distance, y: at.y + out.y * distance };

        return [
            { x: center.x + across.x * half, y: center.y + across.y * half },
            { x: center.x - across.x * half, y: center.y - across.y * half },
        ];
    };
    const segments: Segment[] = [bar(MARKER_SIZE / 2)];
    if (mandatory) {
        segments.push(bar(MARKER_SIZE));
    }

    return segments;
};

/** How far a split connection's stubs reach out of their figures. */
const SPLIT_STUB_LENGTH = 40;

/**
 * The lines of a split connection (Workbench's "draw split"): instead of
 * the whole route, a short stub out of each figure's side, so a reference
 * across the diagram does not draw a line through it.
 *
 * @param route The connection's full route.
 * @param length How far each stub reaches.
 *
 * @returns The two stubs, start first.
 */
export const splitStubs = (
    route: IRoute,
    length = SPLIT_STUB_LENGTH,
): Segment[] => {
    const stub = (at: IPoint, side: Side): Segment => {
        const out = outward(side);

        return [at, { x: at.x + out.x * length, y: at.y + out.y * length }];
    };

    return [
        stub(route.points[0], route.startSide),
        stub(route.points[route.points.length - 1], route.endSide),
    ];
};

/**
 * @param point A point.
 * @param segment A line segment.
 *
 * @returns How far the point is from the nearest point of the segment.
 */
export const distanceToSegment = (point: IPoint, segment: Segment): number => {
    const [from, to] = segment;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.min(1, Math.max(0,
        ((point.x - from.x) * dx + (point.y - from.y) * dy) / length));

    return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
};
