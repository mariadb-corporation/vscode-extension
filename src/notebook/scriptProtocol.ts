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
 * What the extension and a notebook's TypeScript worker say to each other.
 * Free of `vscode` and of Node's worker API, so both sides and the tests
 * share it.
 */

/** Something a cell printed. */
export type PrintedValue =
    /** Text, as it reads: a string, a number, an error's stack. */
    | { kind: "text"; stream: "stdout" | "stderr"; text: string }
    /** A value that is JSON, shown as such: an object, an array, rows. */
    | { kind: "json"; json: string }
    /** A graph to draw: its options (`IGraphOptions`), as JSON. */
    | { kind: "graph"; json: string };

/** From the extension to the worker. */
export type ToWorkerMessage =
    /** Run a cell's TypeScript. */
    | { type: "run"; runId: number; code: string }
    /** The answer to a `runSql`. */
    | {
        type: "sqlResult";
        requestId: number;
        rows?: Array<Record<string, unknown>>;
        error?: string;
    };

/** From the worker to the extension. */
export type FromWorkerMessage =
    | { type: "print"; runId: number; value: PrintedValue }
    /** A cell asked for SQL to be run on the notebook's connection. */
    | { type: "runSql"; runId: number; requestId: number; sql: string }
    /** A cell's code is over: its promise settled. */
    | { type: "done"; runId: number; error?: string };
