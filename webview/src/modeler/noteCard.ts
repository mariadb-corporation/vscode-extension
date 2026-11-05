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

import {
    FIGURE_COLORS,
    NOTE_FIGURE,
    type IModelFigure,
} from "../../../src/modeler/modelFormat.js";
import type { IDiagramTheme } from "../canvas/theme.js";
import { MAX_AUTO_WIDTH } from "./tableCard.js";

/**
 * The figures that show no schema object: a note's text, as Workbench
 * draws it (a sheet in its colour, the text wrapped in its font), and an
 * image, the picture msm embeds as a data URL. msm keeps both as they
 * are; the layout and drawing are pure but for the canvas.
 */

/** The room around a note's text, in diagram units. */
export const NOTE_PADDING = 8;

/** The size a figure without one gets: Workbench's for a new note. */
const DEFAULT_SIZE = { width: 160, height: 60 } as const;

/** A note's font, read from Workbench's way of writing it. */
export interface INoteFont {
    family?: string;
    size: number;
    bold: boolean;
    italic: boolean;
}

/** The size of a note's text where its font names none. */
const DEFAULT_FONT_SIZE = 11;

/**
 * Reads a note's font as Workbench writes it: the family, then style
 * words, then the size in points - `Helvetica 11`, `Arial Bold Italic 12`,
 * or a PostScript name such as `Arial-BoldMT 12`.
 *
 * @param font The font, as the figure has it.
 *
 * @returns Its family (none where it names none: the theme's then),
 *          size and style.
 */
export const parseWorkbenchFont = (font: string | undefined): INoteFont => {
    const words = (font ?? "").trim().split(/\s+/).filter((word) => {
        return word !== "";
    });
    let size = DEFAULT_FONT_SIZE;
    const last = words.at(-1);
    if (last !== undefined && /^\d+(\.\d+)?$/.test(last)) {
        size = Number(last);
        words.pop();
    }
    let bold = false;
    let italic = false;
    const family = words.filter((word) => {
        if (/^bold$/i.test(word)) {
            bold = true;

            return false;
        }
        if (/^(italic|oblique)$/i.test(word)) {
            italic = true;

            return false;
        }

        return true;
    }).map((word) => {
        // A PostScript name carries the style after a dash.
        const styled = /^(.+?)-(\w+)$/.exec(word);
        if (styled === null) {
            return word;
        }
        bold ||= /bold/i.test(styled[2]);
        italic ||= /italic|oblique/i.test(styled[2]);

        return styled[1];
    }).join(" ");

    return {
        ...(family === "" ? {} : { family }),
        size: size > 0 ? size : DEFAULT_FONT_SIZE,
        bold,
        italic,
    };
};

/**
 * @param font A note's font.
 * @param fallbackFamily The theme's font, where the note names none.
 *
 * @returns It as a CSS font.
 */
export const cssFont = (font: INoteFont, fallbackFamily: string): string => {
    const family = font.family === undefined
        ? fallbackFamily
        : `"${font.family.replace(/"/g, "")}", ${fallbackFamily}`;

    return `${font.italic ? "italic " : ""}${font.bold ? "bold " : ""}`
        + `${String(font.size)}px ${family}`;
};

/**
 * Wraps a text to a width, at blanks; a word wider than the line stays
 * whole on a line of its own, cut off when drawn. Line breaks in the text
 * are kept.
 *
 * @param text The text.
 * @param width The room a line has.
 * @param measure Measures a line.
 *
 * @returns The lines.
 */
export const wrapText = (
    text: string,
    width: number,
    measure: (line: string) => number,
): string[] => {
    const lines: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
        let line = "";
        for (const word of paragraph.split(/ +/)) {
            const candidate = line === "" ? word : `${line} ${word}`;
            if (line !== "" && measure(candidate) > width) {
                lines.push(line);
                line = word;
            } else {
                line = candidate;
            }
        }
        lines.push(line);
    }

    return lines;
};

/**
 * @param font A note's font.
 *
 * @returns The height of its lines.
 */
export const lineHeight = (font: INoteFont): number => {
    return Math.ceil(font.size * 1.3);
};

/**
 * The size of a note or an image: the figure's own, or, where it has none,
 * a note's text unwrapped (up to `MAX_AUTO_WIDTH`, wrapped from there) and
 * a default for an image.
 *
 * @param figure The figure.
 * @param measure Measures a line of the note's text in its font.
 *
 * @returns The width and height.
 */
export const plainFigureSize = (
    figure: IModelFigure,
    measure: (line: string) => number,
): { width: number; height: number } => {
    if (figure.type !== NOTE_FIGURE) {
        return {
            width: figure.width ?? DEFAULT_SIZE.width,
            height: figure.height ?? DEFAULT_SIZE.height,
        };
    }
    const font = parseWorkbenchFont(figure.font);
    const text = figure.text ?? "";
    const width = figure.width ?? Math.min(MAX_AUTO_WIDTH, Math.max(
        DEFAULT_SIZE.width / 2,
        Math.ceil(Math.max(0, ...text.split(/\r?\n/).map(measure)))
            + 2 * NOTE_PADDING));
    const lines = wrapText(text, width - 2 * NOTE_PADDING, measure);

    return {
        width,
        height: figure.height
            ?? lines.length * lineHeight(font) + 2 * NOTE_PADDING,
    };
};

/**
 * Starts a figure's canvas at a scale, clipped to a rounded rectangle.
 *
 * @returns The canvas and its context, or no context in a page that
 *          cannot draw.
 */
const startCanvas = (
    width: number,
    height: number,
    scale: number,
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D | null } => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(width * scale));
    canvas.height = Math.max(1, Math.ceil(height * scale));
    const context = canvas.getContext("2d");
    context?.scale(scale, scale);

    return { canvas, context };
};

/**
 * Draws a note: a sheet in its colour with its text, wrapped and cut off
 * at its size.
 *
 * @param figure The note.
 * @param width Its width.
 * @param height Its height.
 * @param theme The theme, for the border and the font where the note
 *              names none.
 * @param scale Device pixels per diagram unit.
 *
 * @returns The canvas.
 */
export const drawNote = (
    figure: IModelFigure,
    width: number,
    height: number,
    theme: IDiagramTheme,
    scale: number,
): HTMLCanvasElement => {
    const { canvas, context } = startCanvas(width, height, scale);
    if (context === null) {
        return canvas;
    }
    context.fillStyle = figure.color || FIGURE_COLORS[NOTE_FIGURE];
    context.fillRect(0, 0, width, height);
    const font = parseWorkbenchFont(figure.font);
    context.font = cssFont(font, theme.fontFamily);
    context.fillStyle = figure.textColor || "#000000";
    context.textBaseline = "top";
    context.save();
    context.beginPath();
    context.rect(NOTE_PADDING, NOTE_PADDING, Math.max(0, width
        - 2 * NOTE_PADDING), Math.max(0, height - 2 * NOTE_PADDING));
    context.clip();
    const lines = wrapText(figure.text ?? "", width - 2 * NOTE_PADDING,
        (line) => { return context.measureText(line).width; });
    lines.forEach((line, index) => {
        context.fillText(line, NOTE_PADDING,
            NOTE_PADDING + index * lineHeight(font));
    });
    context.restore();
    context.strokeStyle = theme.figureBorder;
    context.lineWidth = 1;
    context.strokeRect(0.5, 0.5, width - 1, height - 1);

    return canvas;
};

/**
 * @param dataUrl A picture, as a data URL.
 *
 * @returns The SVG document it holds, or nothing for any other picture.
 */
const svgOf = (dataUrl: string): string | undefined => {
    const match = /^data:image\/svg\+xml(;[^,]*)?,(.*)$/s.exec(dataUrl);
    if (match === null) {
        return undefined;
    }
    try {
        return (match[1] ?? "").split(";").includes("base64")
            ? new TextDecoder().decode(Uint8Array.from(atob(match[2]),
                (char) => { return char.charCodeAt(0); }))
            : decodeURIComponent(match[2]);
    } catch {
        return undefined;
    }
};

/**
 * An SVG picture has a size of its own only where its root element says
 * it - a `viewBox` or a width and height: without, a browser draws it at
 * nothing. Such a picture is given the figure's size. Other pictures come
 * back as they are. (An SVG drawn as an image never loads what it refers
 * to, and the webview's policy refuses it anyway, so its links do not
 * matter.)
 *
 * @param dataUrl The picture, as a data URL.
 * @param width The figure's width.
 * @param height The figure's height.
 *
 * @returns The picture to draw, as a data URL.
 */
export const sizedPicture = (
    dataUrl: string,
    width: number,
    height: number,
): string => {
    const svg = svgOf(dataUrl);
    const root = svg === undefined ? null : /<svg\b[^>]*>/i.exec(svg);
    if (svg === undefined || root === null) {
        return dataUrl;
    }
    const tag = root[0];
    const has = (attribute: string): boolean => {
        return new RegExp(`\\s${attribute}\\s*=`, "i").test(tag);
    };
    if (has("viewBox") || (has("width") && has("height"))) {
        return dataUrl;
    }
    const sized = tag.replace(/^<svg\b/i, `<svg${has("width") ? ""
        : ` width="${String(width)}"`}${has("height") ? ""
        : ` height="${String(height)}"`}`);
    const fixed = svg.slice(0, root.index) + sized
        + svg.slice(root.index + tag.length);

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fixed)}`;
};

/**
 * Where a picture goes in its figure: filling it, or, keeping its aspect
 * ratio, as large as fits, centred.
 *
 * @param picture The picture's own size.
 * @param width The figure's width.
 * @param height The figure's height.
 * @param keepAspectRatio Whether to keep the picture's proportions.
 *
 * @returns The rectangle, in the figure.
 */
export const pictureRect = (
    picture: { width: number; height: number },
    width: number,
    height: number,
    keepAspectRatio: boolean,
): { left: number; top: number; width: number; height: number } => {
    if (!keepAspectRatio || picture.width <= 0 || picture.height <= 0) {
        return { left: 0, top: 0, width, height };
    }
    const scale = Math.min(width / picture.width, height / picture.height);
    const fitted = { width: picture.width * scale, height: picture.height * scale };

    return {
        left: (width - fitted.width) / 2,
        top: (height - fitted.height) / 2,
        ...fitted,
    };
};

/**
 * Draws an image figure: its picture, or, while there is none, a frame
 * saying why.
 *
 * @param figure The figure.
 * @param width Its width.
 * @param height Its height.
 * @param picture The picture, loaded.
 * @param status What stands in for a missing picture: "Loading the
 *               picture…", or why it could not be had.
 * @param theme The theme.
 * @param scale Device pixels per diagram unit.
 *
 * @returns The canvas.
 */
export const drawImageFigure = (
    figure: IModelFigure,
    width: number,
    height: number,
    picture: HTMLImageElement | undefined,
    status: string,
    theme: IDiagramTheme,
    scale: number,
): HTMLCanvasElement => {
    const { canvas, context } = startCanvas(width, height, scale);
    if (context === null) {
        return canvas;
    }
    if (picture !== undefined) {
        const rect = pictureRect(
            { width: picture.naturalWidth, height: picture.naturalHeight },
            width, height, figure.keepAspectRatio === true);
        context.drawImage(picture, rect.left, rect.top, rect.width,
            rect.height);

        return canvas;
    }
    context.fillStyle = theme.figureBackground;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = theme.figureBorder;
    context.setLineDash([4, 3]);
    context.strokeRect(0.5, 0.5, width - 1, height - 1);
    context.font = `11px ${theme.fontFamily}`;
    context.fillStyle = theme.dimmed;
    context.textAlign = "center";
    context.textBaseline = "middle";
    const lines = wrapText(status, width - 2 * NOTE_PADDING, (line) => {
        return context.measureText(line).width;
    });
    lines.forEach((line, index) => {
        context.fillText(line, width / 2,
            height / 2 + (index - (lines.length - 1) / 2) * 14);
    });

    return canvas;
};
