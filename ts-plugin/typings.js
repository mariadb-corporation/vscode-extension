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

// @ts-check

/*
 * The typings of the runtime a MariaDB Notebook's TypeScript cells run in,
 * as the editor knows it: what the plugin hands the TypeScript server. A
 * string rather than a .d.ts file, which the Marketplace takes for
 * TypeScript that has no place in an extension.
 */

"use strict";

module.exports = `/*
 * The runtime a MariaDB Notebook's TypeScript cells run in, as the editor
 * knows it. What a cell declares at its top is there for the cells run
 * after it; a cell's last expression is shown once it is over.
 */

/** A row of a result set: a value per column, by the column's name. */
type IDataRecord = Record<string, unknown>;

/**
 * Shows values under the cell, as they are printed: text as it reads, an
 * object or an array as JSON.
 *
 * @param values What to show.
 */
declare function print(...values: unknown[]): void;

/**
 * Runs SQL on the notebook's connection.
 *
 * @param sql One statement, or several.
 *
 * @returns Every row of the first result set, an object a row; none where
 *          no statement returned one. Rejects with the error of the first
 *          statement that failed.
 */
declare function runSql(sql: string): Promise<IDataRecord[]>;

// ---------- Graphs ----------

/** A value a graph's data can hold. */
declare type DatumDataType = string | number | Date;

/** A slice of a pie graph. */
declare interface IPieDatum {
    /** Its label, and what tells it from the others. */
    name?: string;
    value: number;
}

/** A point of a line graph. */
declare interface IXYDatum {
    /** The value on the x axis. */
    xValue: number | Date;
    /** The value on the y axis; left out, the line has a gap there. */
    yValue?: number;
    /** The line it belongs to, where a graph has several. */
    group?: string;
}

/**
 * A bar graph's data, tabular: the first row holds the captions, and each
 * row after it a category in its first column and the value in its second.
 */
declare type ITabularGraphData = DatumDataType[][];

/**
 * A bar graph's data, as rows: the first key of an entry is its category,
 * the second its value - as "runSql" answers them.
 */
declare type IJsonGraphData = Array<Record<string, DatumDataType>>;

declare type IGraphData = ITabularGraphData | IJsonGraphData;

/** What every series of a graph has. */
declare interface IBaseGraphEntry {
    /** The series type. */
    type: string;
    /** Tells the series apart; made up where left out. */
    id?: string;
    /** Its own colors, in place of the graph's. */
    colors?: string[];
    /**
     * Where in the graph's viewport the series is drawn, and how big;
     * the whole viewport where left out.
     */
    transformation?: {
        x: number | string;
        y: number | string;
        width: number;
        height: number;
    };
}

declare interface IPieGraphConfiguration extends IBaseGraphEntry {
    type: "pie";
    /** The inner and outer radius; an inner radius above 0 is a donut. */
    radius?: [number, number];
    /** In radians, 0 at 12 o'clock, clockwise (default: 0). */
    startAngle?: number;
    /** In radians, 0 at 12 o'clock, clockwise (default: 2π). */
    endAngle?: number;
    borderColor?: string;
    borderWidth?: number;
    /** The angle left between slices, in radians. */
    padAngle?: number;
    /** Whether each slice is labeled, with a line to it (default: true). */
    showValues?: boolean;
    data?: IPieDatum[];
}

/** How a line graph joins its points. */
declare type LineGraphCurve =
    | "Basis"
    | "Bundle"
    | "Linear"
    | "Natural"
    | "Step"
    | "StepBefore"
    | "StepAfter";

declare interface ILineGraphConfiguration extends IBaseGraphEntry {
    type: "line";
    /** The margins around the plot, in pixels. */
    marginTop?: number;
    marginRight?: number;
    marginBottom?: number;
    marginLeft?: number;
    /** The line's width, in pixels (default: 1.5). */
    strokeWidth?: number;
    /** The smallest and the largest x value shown. */
    xDomain?: [number, number] | [Date, Date];
    /** How many ticks the x axis has, roughly. */
    xTickCount?: number;
    /** The smallest and the largest y value shown. */
    yDomain?: [number, number];
    /** How many ticks the y axis has, roughly. */
    yTickCount?: number;
    /** A d3 format specifier for the y axis, "".2f"" say. */
    yFormat?: string;
    /** The y axis's caption. */
    yLabel?: string;
    /** How the points are joined (default: "Linear"). */
    curve?: LineGraphCurve;
    data?: IXYDatum[];
}

declare interface IBarGraphConfiguration extends IBaseGraphEntry {
    type: "bar";
    /** The margins around the plot, in pixels. */
    marginTop?: number;
    marginRight?: number;
    marginBottom?: number;
    marginLeft?: number;
    /** The space between bars, as a part of a bar's width (default: 0.1). */
    xPadding?: number;
    /** The smallest and the largest y value shown. */
    yDomain?: [number, number];
    /** A d3 format specifier for the y axis, "".2f"" say. */
    yFormat?: string;
    /** The y axis's caption. */
    yLabel?: string;
    data?: IGraphData;
}

declare type IGraphConfiguration =
    | IPieGraphConfiguration
    | ILineGraphConfiguration
    | IBarGraphConfiguration;

/** Where a caption sits. */
declare type GraphAlignment = "Start" | "Middle" | "End";

/** A caption: a graph's title. */
declare interface IGraphLabel {
    text: string;
    horizontalAlignment?: GraphAlignment;
}

/** A graph: one or more series in one picture. */
declare interface IGraphOptions {
    title?: IGraphLabel;
    series?: IGraphConfiguration[];
    /** The colors the series take in turn. */
    colors?: string[];
    /** The space the series are laid out in (default: 0 0 1200 450). */
    viewport?: { left: number; top: number; width: number; height: number };
}

/** Draws graphs under the cell. */
declare class Graph {
    /**
     * Draws a graph under the cell.
     *
     * @param options Its series, title and colors.
     */
    public static render(options: IGraphOptions): void;
}

/** The shape of a "PieGraph". */
declare enum PieGraphLayout {
    Donut,
    ThickDonut,
    ThinDonut,
    Pie,
}

/** Draws a pie graph of a result set's rows, the quick way. */
declare class PieGraph {
    /**
     * Draws the rows as the slices of a pie.
     *
     * @param data The rows: their "name" and "value" columns, the columns
     *        "keys" names, or a row's two columns in turn.
     * @param layout Pie or donut (default: Pie).
     * @param keys The columns that are a slice's name and its value.
     */
    public static render(
        data: IDataRecord[],
        layout?: PieGraphLayout,
        keys?: { name: string; value: string },
    ): void;
}
`;
