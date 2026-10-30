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
 * Where a notebook's TypeScript cells run: one `vm` context per notebook,
 * kept across its cells, with the scripting runtime of the MySQL Shell's
 * notebooks as far as it goes so far - `print`, `runSql`, `$` and
 * `console`. Lives in the notebook's worker thread (`scriptWorker.ts`);
 * free of the worker API, so the tests run it in-process.
 */

import { inspect } from "node:util";
import vm from "node:vm";

import { transform } from "sucrase";

import type {
    FromWorkerMessage,
    PrintedValue,
    ToWorkerMessage,
} from "./scriptProtocol.js";

/** The file name a cell's code goes by in a stack. */
export const CELL_FILE = "cell.ts";

/** A stack frame in the cell, and its line. */
const CELL_FRAME = /cell\.ts:(\d+):/;

/** What a cell's code is put in, on its first line. */
const WRAPPER_START = "(async () => {";

/**
 * Turns a cell's TypeScript into the JavaScript to run: its types
 * stripped, and its code made the body of an async function, so it can
 * `await` and `return` at the top. The function opens on the cell's first
 * line, so a stack's line numbers are the cell's.
 *
 * @param code The cell's TypeScript.
 *
 * @returns The JavaScript, an expression whose value is the function's
 *          promise.
 *
 * @throws A SyntaxError saying where, for code that does not parse.
 */
export const compileCell = (code: string): string => {
    return transform(`${WRAPPER_START}${code}\n})()`, {
        transforms: ["typescript"],
        // The context is a modern V8: nothing needs lowering.
        disableESTransforms: true,
    }).code;
};

/**
 * Says what a value printed is: text for text, numbers and errors, JSON
 * for what JSON can hold, and Node's own rendering for the rest.
 *
 * @param value What was printed.
 * @param stream Where text goes.
 *
 * @returns The printed value.
 */
export const printedValueOf = (
    value: unknown,
    stream: "stdout" | "stderr" = "stdout",
): PrintedValue => {
    if (typeof value === "string") {
        return { kind: "text", stream, text: value };
    }
    if (value instanceof Error) {
        return { kind: "text", stream, text: value.stack ?? String(value) };
    }
    if (value !== null && typeof value === "object") {
        try {
            const json = JSON.stringify(value, (_key, inner: unknown) => {
                return typeof inner === "bigint" ? inner.toString() : inner;
            }, 2);
            if (json !== undefined) {
                return { kind: "json", json };
            }
        } catch {
            // A cycle, say: Node's own rendering copes.
        }
    }

    return { kind: "text", stream, text: inspect(value, { depth: 4 }) };
};

/**
 * Says where a cell does not parse in the cell's own terms: the position
 * the transpiler reports counts the wrapper on the first line.
 *
 * @param message The transpiler's message, ending in `(line:column)`.
 *
 * @returns The message, its column on the first line the cell's.
 */
export const cellSyntaxMessage = (message: string): string => {
    return message.replace(/\(1:(\d+)\)$/, (_whole, column: string) => {
        return `(1:${Math.max(1, Number(column) - WRAPPER_START.length)})`;
    });
};

/**
 * Keeps the part of an error's stack that is the cell's own: frames in
 * its lines, not the wrapper's call of it on the line after them.
 *
 * @param error What a cell threw.
 * @param lineCount How many lines the cell has.
 *
 * @returns Its message, and the frames in the cell.
 */
export const describeFailure = (
    error: unknown,
    lineCount = Number.POSITIVE_INFINITY,
): string => {
    if (!(error instanceof Error) && !(typeof error === "object"
        && error !== null && "message" in error)) {
        return `Uncaught ${inspect(error)}`;
    }

    const failure = error as Error;
    const frames = (failure.stack ?? "").split("\n").filter((line) => {
        const at = CELL_FRAME.exec(line);

        return at !== null && Number(at[1]) <= lineCount;
    });

    return [`${failure.name}: ${failure.message}`, ...frames].join("\n");
};

/** A notebook's TypeScript runtime. */
export interface IScriptSandbox {
    /** Handles a message from the extension. */
    receive(message: ToWorkerMessage): void;
}

/**
 * Builds a notebook's TypeScript runtime.
 *
 * @param send Sends a message to the extension.
 *
 * @returns The runtime.
 */
export const createScriptSandbox = (
    send: (message: FromWorkerMessage) => void,
): IScriptSandbox => {
    /** The cell running now; what a timer prints later is still its. */
    let runId = 0;
    let requests = 0;
    const pending = new Map<number, {
        resolve: (rows: Array<Record<string, unknown>>) => void;
        reject: (error: Error) => void;
    }>();

    const print = (...values: unknown[]): void => {
        for (const value of values) {
            send({ type: "print", runId, value: printedValueOf(value) });
        }
    };

    const printTo = (stream: "stdout" | "stderr") => {
        return (...values: unknown[]): void => {
            const text = values.map((value) => {
                return typeof value === "string"
                    ? value
                    : inspect(value, { depth: 4 });
            }).join(" ");
            send({ type: "print", runId, value: { kind: "text", stream, text } });
        };
    };

    /**
     * Runs SQL on the notebook's connection.
     *
     * @param sql The SQL: one statement or several.
     *
     * @returns The rows of the first result set, an object a row.
     */
    const runSql = (sql: string): Promise<Array<Record<string, unknown>>> => {
        requests += 1;
        const requestId = requests;

        return new Promise((resolve, reject) => {
            pending.set(requestId, { resolve, reject });
            send({ type: "runSql", runId, requestId, sql: String(sql) });
        });
    };

    const context = vm.createContext({
        print,
        runSql,
        // What the cells share, as in the MySQL Shell's notebooks.
        $: {},
        console: {
            log: printTo("stdout"),
            info: printTo("stdout"),
            debug: printTo("stdout"),
            warn: printTo("stderr"),
            error: printTo("stderr"),
        },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        queueMicrotask,
        structuredClone,
        fetch,
        URL,
        URLSearchParams,
        TextEncoder,
        TextDecoder,
        AbortController,
    });

    const run = async (code: string): Promise<void> => {
        let error: string | undefined;
        let compiled: string | undefined;
        try {
            compiled = compileCell(code);
        } catch (failure) {
            error = `SyntaxError: ${cellSyntaxMessage(
                failure instanceof Error ? failure.message : String(failure))}`;
        }
        if (compiled !== undefined) {
            try {
                const script = new vm.Script(compiled, { filename: CELL_FILE });
                await (script.runInContext(context) as Promise<unknown>);
            } catch (failure) {
                error = describeFailure(failure, code.split("\n").length);
            }
        }
        send({ type: "done", runId, ...error === undefined ? {} : { error } });
    };

    return {
        receive: (message) => {
            switch (message.type) {
                case "run": {
                    runId = message.runId;
                    void run(message.code);
                    break;
                }

                case "sqlResult": {
                    const waiting = pending.get(message.requestId);
                    pending.delete(message.requestId);
                    if (message.error !== undefined) {
                        waiting?.reject(new Error(message.error));
                    } else {
                        waiting?.resolve(message.rows ?? []);
                    }
                    break;
                }
            }
        },
    };
};
