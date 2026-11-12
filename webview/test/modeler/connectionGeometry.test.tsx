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
    crowsFoot,
    distanceToSegment,
    MARKER_SIZE,
    MIDDLE_CLEARANCE,
    oneMarker,
    routeConnection,
    nearestDock,
    sideSlots,
    splitStubs,
    spreadAnchors,
    standAnchors,
    standingSlots,
    atOfHeight,
    turnedMarker,
    type IAnchors,
    type IConnectionLevels,
} from "../../src/modeler/connectionGeometry.js";

describe("routeConnection", () => {
    const a = { left: 0, top: 0, width: 100, height: 50 };

    it("leaves and enters the facing sides of figures side by side", () => {
        const b = { left: 300, top: 100, width: 100, height: 50 };
        const route = routeConnection(a, b);

        expect(route.startSide).toBe("right");
        expect(route.endSide).toBe("left");
        expect(route.points[0]).toEqual({ x: 100, y: 25 });
        expect(route.points[route.points.length - 1]).toEqual({ x: 300, y: 125 });
        // One middle segment, half way between.
        expect(route.points[1].x).toBe(200);
        expect(route.points[2].x).toBe(200);

        const back = routeConnection(b, a);
        expect(back.startSide).toBe("left");
        expect(back.endSide).toBe("right");
    });

    it("goes up and down between figures above each other", () => {
        const b = { left: 20, top: 200, width: 100, height: 50 };
        const route = routeConnection(a, b);

        expect(route.startSide).toBe("bottom");
        expect(route.endSide).toBe("top");
        expect(route.points[0]).toEqual({ x: 50, y: 50 });
        expect(route.points[3]).toEqual({ x: 70, y: 200 });
    });

    it("moves the middle segment by its offset, clear of both figures", () => {
        const b = { left: 300, top: 100, width: 100, height: 50 };

        const moved = routeConnection(a, b, -60);
        expect(moved.points[1].x).toBe(140);
        expect(moved.points[2].x).toBe(140);
        expect(moved.middle).toMatchObject({ axis: "x", base: 200, at: 140 });

        // Never closer to a figure than the end markers need.
        const near = routeConnection(a, b, -1000);
        expect(near.points[1].x).toBe(100 + MIDDLE_CLEARANCE);
        const far = routeConnection(a, b, 1000);
        expect(far.points[1].x).toBe(300 - MIDDLE_CLEARANCE);

        const below = { left: 20, top: 200, width: 100, height: 50 };
        const vertical = routeConnection(a, below, 30);
        expect(vertical.middle?.axis).toBe("y");
        expect(vertical.points[1].y).toBe(155);
    });

    it("keeps the middle segment halfway where there is no room", () => {
        const close = { left: 120, top: 30, width: 100, height: 50 };
        const route = routeConnection(a, close, 50);

        expect(route.points[1].x).toBe(110);
    });

    it("loops out and back in for a self reference", () => {
        const route = routeConnection(a, a);

        expect(route.startSide).toBe("right");
        expect(route.endSide).toBe("top");
        expect(route.points[route.points.length - 1]).toEqual({ x: 50, y: 0 });
    });
});

describe("splitStubs", () => {
    it("draws a stub out of each figure instead of the whole route", () => {
        const route = routeConnection(
            { left: 0, top: 0, width: 100, height: 50 },
            { left: 900, top: 400, width: 100, height: 50 });
        const stubs = splitStubs(route, 40);

        expect(stubs).toEqual([
            [{ x: 100, y: 25 }, { x: 140, y: 25 }],
            [{ x: 900, y: 425 }, { x: 860, y: 425 }],
        ]);
    });

    it("follows the sides a vertical route leaves and enters", () => {
        const route = routeConnection(
            { left: 0, top: 0, width: 100, height: 50 },
            { left: 0, top: 900, width: 100, height: 50 });

        expect(splitStubs(route, 40)).toEqual([
            [{ x: 50, y: 50 }, { x: 50, y: 90 }],
            [{ x: 50, y: 900 }, { x: 50, y: 860 }],
        ]);
    });
});

describe("the crow's foot notation", () => {
    it("draws three prongs, and a bar where mandatory", () => {
        const optional = crowsFoot({ x: 100, y: 25 }, "right", false);
        expect(optional).toHaveLength(3);
        // The prongs meet on the line, a marker's length out.
        expect(optional[0][0]).toEqual({ x: 100 + MARKER_SIZE, y: 25 });
        expect(optional[0][1]).toEqual({ x: 100, y: 25 });
        expect(optional[1][1].y).toBeCloseTo(25 + MARKER_SIZE / 2, 5);
        expect(optional[2][1].y).toBeCloseTo(25 - MARKER_SIZE / 2, 5);

        expect(crowsFoot({ x: 100, y: 25 }, "right", true)).toHaveLength(4);
    });

    it("draws one bar for one, two for exactly one", () => {
        expect(oneMarker({ x: 0, y: 0 }, "left", false)).toHaveLength(1);
        const two = oneMarker({ x: 0, y: 0 }, "left", true);
        expect(two).toHaveLength(2);
        // Across the line, which leaves to the left.
        expect(two[0][0].x).toBeCloseTo(-MARKER_SIZE / 2, 5);
        expect(two[0][0].x).toBeCloseTo(two[0][1].x, 5);
    });
});

describe("distanceToSegment", () => {
    it("measures to the segment's nearest point, its ends included", () => {
        const segment = [{ x: 0, y: 0 }, { x: 10, y: 0 }] as const;

        expect(distanceToSegment({ x: 5, y: 3 }, [...segment])).toBe(3);
        expect(distanceToSegment({ x: 13, y: 4 }, [...segment])).toBe(5);
        expect(distanceToSegment({ x: 2, y: 2 },
            [{ x: 2, y: 2 }, { x: 2, y: 2 }])).toBe(0);
    });
});

describe("spreadAnchors", () => {
    // A table 116 high: its straight sides, corners of 8 left out, are 100.
    const table = { left: 0, top: 0, width: 100, height: 116 };
    const right = (top: number) => {
        return { left: 400, top, width: 100, height: 50 };
    };
    const ends = (id: string, end: { left: number; top: number;
        width: number; height: number }, figure = id) => {
        return { id, startFigure: "t", endFigure: figure, start: table, end };
    };

    it("meets the middle of a side for one line", () => {
        const anchors = spreadAnchors([ends("a", right(0))], 8);

        expect(anchors.get("a")?.start).toBe(58);
    });

    it("splits the straight part in n + 2 and uses the inner n", () => {
        // Two: 3/8 and 5/8 of the 100 between the corners, from 8.
        const two = spreadAnchors([ends("a", right(0)), ends("b", right(200))], 8);
        expect([two.get("a")?.start, two.get("b")?.start]).toEqual([45.5, 70.5]);

        // Three: 3/10, 5/10, 7/10.
        const three = spreadAnchors([ends("a", right(0)), ends("b", right(100)),
            ends("c", right(200))], 8);
        expect(["a", "b", "c"].map((id) => { return three.get(id)?.start; }))
            .toEqual([38, 58, 78]);
    });

    it("orders a side's lines by where their other tables are", () => {
        // Listed lower first, the lower table still gets the lower spot.
        const anchors = spreadAnchors([ends("low", right(300)),
            ends("high", right(-200))], 8);

        expect(anchors.get("high")!.start!).toBeLessThan(anchors.get("low")!.start!);
    });

    it("spreads both ends, and a loop takes a spot on two sides", () => {
        const loop = { id: "self", startFigure: "t", endFigure: "t",
            start: table, end: table };
        const anchors = spreadAnchors([loop, ends("a", right(0))], 8);

        // The loop goes out first on the right side, above the other line.
        expect(anchors.get("self")?.start).toBe(45.5);
        expect(anchors.get("a")?.start).toBe(70.5);
        // Alone on the top side: its middle.
        expect(anchors.get("self")?.end).toBe(50);
        // The other table's left side has the one line: its middle.
        expect(anchors.get("a")?.end).toBe(25);
    });

    it("routes through its anchors", () => {
        const route = routeConnection(table, right(0), 0, { start: 45.5, end: 25 });

        expect(route.points[0]).toEqual({ x: 100, y: 45.5 });
        expect(route.points[route.points.length - 1]).toEqual({ x: 400, y: 25 });
    });
});

describe("ends placed by hand", () => {
    const table = { left: 0, top: 0, width: 116, height: 116 };
    const other = { left: 400, top: 0, width: 100, height: 50 };

    it("snaps a dragged end to the nearest side of its table", () => {
        expect(nearestDock(table, { x: 60, y: -30 }, 8))
            .toEqual({ side: "top", at: 0.52 });
        expect(nearestDock(table, { x: -30, y: 60 }, 8).side).toBe("left");
        expect(nearestDock(table, { x: -5, y: 200 }, 8).side).toBe("bottom");
        // Past the corner: the end of the straight part.
        expect(nearestDock(table, { x: 130, y: -50 }, 8))
            .toMatchObject({ side: "top", at: 1 });
    });

    it("slots a side as the spread does", () => {
        expect(sideSlots(table, "top", 2, 8)).toEqual([45.5, 70.5]);
    });

    it("keeps a docked end's side, ordered among the side's lines", () => {
        const ends = (id: string, top: number) => {
            return { id, startFigure: "t", endFigure: id, start: table,
                end: { ...other, top } };
        };
        // Two lines out of the right side; "b" docked by hand first.
        const anchors = spreadAnchors([ends("a", 0),
            { ...ends("b", 200), startDock: { side: "right", at: 0 } }], 8);
        expect(anchors.get("b")!.start!).toBeLessThan(anchors.get("a")!.start!);

        // Moved to the top: alone there, in its middle; "a" alone right.
        const moved = spreadAnchors([ends("a", 0),
            { ...ends("b", 200), startDock: { side: "top", at: 0.9 } }], 8);
        expect(moved.get("b")).toMatchObject({ startSide: "top", start: 58 });
        expect(moved.get("a")).toMatchObject({ startSide: "right", start: 58 });
    });

    /** @returns Whether every segment turns, none doubling back. */
    const orthogonal = (points: Array<{ x: number; y: number }>): boolean => {
        return points.slice(1).every((point, index) => {
            const from = points[index];

            return point.x === from.x || point.y === from.y;
        }) && points.slice(2).every((point, index) => {
            const [a, b] = [points[index], points[index + 1]];
            // Back along the same axis would be a spike.
            const reverse = (a.x === b.x && b.x === point.x)
                || (a.y === b.y && b.y === point.y);

            return !reverse;
        });
    };
    const route = (anchors: IAnchors, end = other) => {
        return routeConnection(table, end, 0, anchors);
    };

    it("joins a side to a perpendicular one with an L where it can", () => {
        // Out of the top, into the other's left side, which is up and right.
        const up = { left: 300, top: -300, width: 100, height: 50 };
        const l = route({ startSide: "top", endSide: "left" }, up);

        expect(l.points).toEqual([{ x: 58, y: 0 }, { x: 58, y: -275 },
            { x: 300, y: -275 }]);
        expect(l.middle).toBeUndefined();
    });

    it("goes around where the sides face away or the same way", () => {
        for (const anchors of [
            { startSide: "top", endSide: "left" },
            { startSide: "right", endSide: "right" },
            { startSide: "left", endSide: "right" },
            { startSide: "top", endSide: "bottom" },
            { startSide: "bottom", endSide: "bottom" },
        ] as const) {
            const shown = route(anchors);
            expect(shown.startSide).toBe(anchors.startSide);
            expect(shown.endSide).toBe(anchors.endSide);
            expect(orthogonal(shown.points)).toBe(true);
        }
    });

    it("keeps the middle segment where docked sides still face", () => {
        const facing = route({ startSide: "right", endSide: "left",
            start: 30, end: 20 });

        expect(facing.middle?.axis).toBe("x");
        expect(facing.points[0]).toEqual({ x: 116, y: 30 });
    });
});

describe("turnedMarker", () => {
    it("leaves a marker flat unturned, and stands what is across the line "
        + "up when turned by 90 degrees", () => {
        const at = { x: 100, y: 25 };
        const foot = crowsFoot(at, "right", false);

        const flat = turnedMarker(foot, at, "right", 0);
        expect(flat.map((segment) => {
            return segment.map(({ x, y }) => { return { x, y }; });
        })).toEqual(foot);
        expect(flat.flat().every((point) => { return point.dz === 0; }))
            .toBe(true);

        const turned = turnedMarker(foot, at, "right", Math.PI / 2);
        // The prongs' ends were half a marker above and below the line on
        // the page; now on the line, as far above and below it.
        const ends = turned.slice(1).map(([, end]) => {
            return [Math.round(end.y), Math.round(end.dz)];
        });
        expect(ends).toEqual([[25, MARKER_SIZE / 2], [25, -MARKER_SIZE / 2]]);
        // Along the line nothing moves: the root stays where it was.
        expect(turned[0][0]).toMatchObject({ x: 100 + MARKER_SIZE, y: 25 });
        expect(turned[0][0].dz).toBeCloseTo(0, 10);
    });
});

describe("standAnchors", () => {
    // An upright card 100 high standing on the page: a slab deep.
    const standing = { left: 0, top: 0, width: 100, height: 20 };
    const stand = { foot: 0, height: 100 };
    const flat = (top: number) => {
        return { left: 300, top, width: 100, height: 50 };
    };
    const ends = (
        id: string,
        endLevel: number,
        extra: Partial<IConnectionLevels> = {},
    ): IConnectionLevels => {
        return { id, startFigure: "standing", endFigure: id, start: standing,
            end: flat(0), startLevel: 10, endLevel, startStand: stand,
            ...extra };
    };
    const anchorsOf = (connections: IConnectionLevels[]) => {
        return new Map<string, IAnchors>(connections.map((c) => {
            return [c.id, { start: 3, end: 25, startSide: "right",
                endSide: "left" }];
        }));
    };

    it("spreads an upright card's edge ends up its height", () => {
        const connections = [ends("low", -10), ends("high", 90)];
        const { anchors, heights } = standAnchors(connections,
            anchorsOf(connections), 8);
        // The higher figure's line meets the card higher up, so seen
        // from the front they do not cross.
        expect(heights.get("high")!.start).toBeGreaterThan(
            heights.get("low")!.start);
        expect(standingSlots(stand, 2, 8)).toEqual([
            heights.get("high")!.start, heights.get("low")!.start]);
        // On the page, both meet the footprint's side in its middle.
        expect(anchors.get("low")!.start).toBe(10);
        expect(anchors.get("high")!.start).toBe(10);
        // The flat figure's ends keep their place and level.
        expect(anchors.get("low")!.end).toBe(25);
        expect(heights.get("low")!.end).toBe(-10);
    });

    it("keeps one line in the middle of the card's height", () => {
        const connections = [ends("one", -10)];
        const { heights } = standAnchors(connections, anchorsOf(connections));
        expect(heights.get("one")!.start).toBe(50);
    });

    it("orders ends placed by hand by their at, 0 at the top", () => {
        const connections = [
            ends("top", -10, { startDock: { side: "right", at: 0 } }),
            ends("foot", 90, { startDock: { side: "right", at: 1 } }),
        ];
        const { heights } = standAnchors(connections,
            anchorsOf(connections));
        expect(heights.get("top")!.start).toBeGreaterThan(
            heights.get("foot")!.start);
    });

    it("leaves ends on an upright card's face at its level", () => {
        const connections = [ends("face", -10)];
        const anchors = new Map<string, IAnchors>([["face", { start: 50,
            end: 350, startSide: "bottom", endSide: "top" }]]);
        const result = standAnchors(connections, anchors);
        expect(result.anchors.get("face")!.start).toBe(50);
        expect(result.heights.get("face")!.start).toBe(10);
    });

    it("turns a height up the edge into a dock's at", () => {
        expect(atOfHeight(stand, 100)).toBe(0);
        expect(atOfHeight(stand, 0)).toBe(1);
        expect(atOfHeight(stand, 50, 8)).toBeCloseTo(0.5);
        expect(atOfHeight(stand, 500)).toBe(0);
    });
});
