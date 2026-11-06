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

import type { IModelFigure } from "../../../src/modeler/modelFormat.js";
import {
    cssFont,
    lineHeight,
    NOTE_PADDING,
    parseWorkbenchFont,
    pictureRect,
    plainFigureSize,
    sizedPicture,
    wrapText,
} from "../../src/modeler/noteCard.js";
import { MAX_AUTO_WIDTH } from "../../src/modeler/tableCard.js";

/** Every character 6 units wide. */
const measure = (text: string): number => { return text.length * 6; };

const note = (changes: Partial<IModelFigure> = {}): IModelFigure => {
    return { id: "n", type: "NoteFigure", name: "Note", left: 0, top: 0,
        text: "Hello world", ...changes };
};

const svgUrl = (svg: string): string => {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

const svgIn = (url: string): string => {
    return decodeURIComponent(url.slice(url.indexOf(",") + 1));
};

describe("parseWorkbenchFont", () => {
    it("reads Workbench's way of naming a font", () => {
        expect(parseWorkbenchFont("Helvetica 11")).toEqual({
            family: "Helvetica", size: 11, bold: false, italic: false });
        expect(parseWorkbenchFont("Arial Bold Italic 12.5")).toEqual({
            family: "Arial", size: 12.5, bold: true, italic: true });
        expect(parseWorkbenchFont("Arial-BoldMT 14")).toEqual({
            family: "Arial", size: 14, bold: true, italic: false });
        expect(parseWorkbenchFont("Lucida Grande")).toEqual({
            family: "Lucida Grande", size: 11, bold: false, italic: false });
        expect(parseWorkbenchFont(undefined)).toEqual({
            size: 11, bold: false, italic: false });
    });

    it("writes it as a CSS font, the theme's behind it", () => {
        expect(cssFont(parseWorkbenchFont("Arial Bold 12"), "sans-serif"))
            .toBe("bold 12px \"Arial\", sans-serif");
        expect(cssFont(parseWorkbenchFont(""), "system-ui"))
            .toBe("11px system-ui");
    });
});

describe("a note", () => {
    it("wraps its text at blanks, keeping its line breaks", () => {
        expect(wrapText("one two three\nfour", 50, measure))
            .toEqual(["one two", "three", "four"]);
        // A word wider than the line stays whole.
        expect(wrapText("unbreakableword", 30, measure))
            .toEqual(["unbreakableword"]);
    });

    it("keeps the size it has", () => {
        expect(plainFigureSize(note({ width: 200, height: 90 }), measure))
            .toEqual({ width: 200, height: 90 });
    });

    it("is sized to its text where it has no size", () => {
        const size = plainFigureSize(note({ text: "Hello world\nok" }), measure);

        // The longest line, "Hello world", and the padding either side.
        expect(size.width).toBe(11 * 6 + 2 * NOTE_PADDING);
        expect(size.height).toBe(2 * lineHeight(parseWorkbenchFont(undefined))
            + 2 * NOTE_PADDING);
        // A long text wraps at the widest a figure is made.
        const long = plainFigureSize(note({ text: "word ".repeat(100) }),
            measure);
        expect(long.width).toBe(MAX_AUTO_WIDTH);
        expect(long.height).toBeGreaterThan(5 * lineHeight(
            parseWorkbenchFont(undefined)));
    });

    it("gives a picture without a size Workbench's default", () => {
        expect(plainFigureSize({ id: "i", type: "ImageFigure", name: "Logo",
            left: 0, top: 0 }, measure)).toEqual({ width: 160, height: 60 });
    });
});

describe("sizedPicture", () => {
    it("gives an SVG without a size of its own the figure's", () => {
        const fixed = sizedPicture(svgUrl("<svg xmlns=\"http://www.w3.org/2000/svg\">"
            + "<rect width=\"5\" height=\"5\"/></svg>"), 120, 80);

        expect(svgIn(fixed)).toBe("<svg width=\"120\" height=\"80\" "
            + "xmlns=\"http://www.w3.org/2000/svg\"><rect width=\"5\" "
            + "height=\"5\"/></svg>");
    });

    it("adds only what a size lacks", () => {
        expect(svgIn(sizedPicture(svgUrl("<svg width=\"10\"></svg>"), 120, 80)))
            .toBe("<svg height=\"80\" width=\"10\"></svg>");
    });

    it("leaves an SVG with a viewBox or a size, and other pictures, alone",
        () => {
            for (const url of [
                svgUrl("<svg viewBox=\"0 0 10 10\"></svg>"),
                svgUrl("<svg width=\"10\" height=\"20\"></svg>"),
                "data:image/png;base64,iVBORw0KGgo=",
                "data:image/svg+xml;utf8,not an svg",
            ]) {
                expect(sizedPicture(url, 120, 80)).toBe(url);
            }
        });

    it("reads a base64 SVG", () => {
        const url = `data:image/svg+xml;base64,${btoa("<svg><g/></svg>")}`;

        expect(svgIn(sizedPicture(url, 3, 4)))
            .toBe("<svg width=\"3\" height=\"4\"><g/></svg>");
    });
});

describe("pictureRect", () => {
    it("fills the figure, or fits the picture in it, centred", () => {
        const picture = { width: 200, height: 100 };

        expect(pictureRect(picture, 100, 100, false))
            .toEqual({ left: 0, top: 0, width: 100, height: 100 });
        expect(pictureRect(picture, 100, 100, true))
            .toEqual({ left: 0, top: 25, width: 100, height: 50 });
        // A picture without a size of its own fills it.
        expect(pictureRect({ width: 0, height: 0 }, 100, 100, true))
            .toEqual({ left: 0, top: 0, width: 100, height: 100 });
    });
});
