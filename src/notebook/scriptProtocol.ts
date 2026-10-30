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

/**
 * The REST client SDK a notebook's TypeScript runs with: its current
 * service's classes on the SDK's base classes, as TypeScript.
 */
export interface INotebookSdk {
    /** Tells one SDK from the one before it, so it is loaded once. */
    version: string;
    code: string;
    /**
     * The certificate of the shell's local certificate authority, which
     * signs the REST Daemons' certificates: trusted for HTTPS to this
     * machine, where the daemons are.
     */
    certificateAuthority?: string;
}

/** What a cell asks of the extension. */
export type HostCall =
    /** Runs SQL on the notebook's connection: its rows, `runSql`'s. */
    | "runSql"
    /** Logs in to a REST service: asks for what it lacks, a password. */
    | "authenticate"
    /** Builds the notebook's SDK again. */
    | "refreshSdk"
    /** Makes a REST service the session's current one. */
    | "setCurrentService";

/** From the extension to the worker. */
export type ToWorkerMessage =
    /** Run a cell's TypeScript. */
    | { type: "run"; runId: number; code: string }
    /** Load the REST client SDK, before the cell after it. */
    | { type: "sdk"; sdk: INotebookSdk }
    /** The answer to a `host` call, and the SDK it built, if any. */
    | {
        type: "hostResult";
        requestId: number;
        value?: unknown;
        error?: string;
        sdk?: INotebookSdk;
    };

/** From the worker to the extension. */
export type FromWorkerMessage =
    | { type: "print"; runId: number; value: PrintedValue }
    /** A cell asked something of the extension. */
    | {
        type: "host";
        runId: number;
        requestId: number;
        call: HostCall;
        args: Record<string, unknown>;
    }
    /** A cell's code is over: its promise settled. */
    | { type: "done"; runId: number; error?: string };
