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
 * notebooks as far as it goes so far - `print`, `runSql` and `console` -
 * and, as there, a cell's last expression shown once it is over. What a
 * cell declares at its top is there for the cells after it, as in the
 * Node REPL; the old runtime's `$` is not there. Lives in the notebook's
 * worker thread (`scriptWorker.ts`); free of the worker API, so the tests
 * run it in-process.
 */

import { inspect } from "node:util";
import vm from "node:vm";

import { parse, type Node } from "acorn";
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

/** Where in the cell a frame is: its line and column. */
const CELL_POSITION = /cell\.ts:(\d+):(\d+)/;

/** What a cell's code is put in, on its first line. */
const WRAPPER_START = "(async () => {";

/** What a cell's last expression is made, around it. */
const RETURN_START = "return (";

/**
 * A cell compiled, and by how many columns each line of it that was
 * written into was moved: what a stack reports there is put back.
 */
export interface ICompiledCell {
    code: string;
    /** Line (from 1) -> columns added in front of the cell's own code. */
    shifts: Map<number, number>;
}

/** The parts of an ESTree node `rewriteCell` reads. */
interface IEsNode extends Node {
    expression?: IEsNode;
    callee?: IEsNode;
    body?: IEsNode | IEsNode[];
    directive?: string;
    kind?: string;
    declarations?: IEsNode[];
    id?: IEsNode | null;
    init?: IEsNode | null;
    name?: string;
    properties?: IEsNode[];
    elements?: Array<IEsNode | null>;
    value?: IEsNode;
    left?: IEsNode;
    argument?: IEsNode;
}

/**
 * The names a declaration's binding binds: a name, or every name a
 * destructuring pattern takes apart, defaults and rest elements too.
 *
 * @param pattern The binding.
 *
 * @returns Its names.
 */
const boundNames = (pattern: IEsNode | null | undefined): string[] => {
    switch (pattern?.type) {
        case "Identifier": {
            return [pattern.name ?? ""];
        }

        case "ObjectPattern": {
            return (pattern.properties ?? []).flatMap((property) => {
                return boundNames(property.type === "RestElement"
                    ? property.argument
                    : property.value);
            });
        }

        case "ArrayPattern": {
            return (pattern.elements ?? []).flatMap(boundNames);
        }

        case "AssignmentPattern": {
            return boundNames(pattern.left);
        }

        case "RestElement": {
            return boundNames(pattern.argument);
        }

        default:
            return [];
    }
};

/** A piece of text put in place of another. */
interface IEdit {
    start: number;
    end: number;
    text: string;
    /**
     * Of two put in at the same place, the one ranked lower ends up after
     * the other: a declaration's `)` after the `= undefined` before it.
     */
    rank?: number;
}

/**
 * Rewrites a cell, compiled, so it is part of its notebook:
 *
 * - What it declares at its top - `const`, `let`, `var`, a function, a
 *   class - is the notebook's, for the cells after it to use, as in the
 *   Node REPL. A variable is declared once with `var`, after the cell's
 *   function (where `var` is hoisted to the top of the script, not the
 *   end), and its declaration in the cell becomes an assignment:
 *   `const a = 1` runs as `;(   a = 1)`, its keyword's place taken by as
 *   many characters, so the columns after it stay the cell's. A function
 *   or a class is handed over once it is declared. Running a cell again
 *   assigns again, rather than failing as a second `const` would.
 * - Its last statement, where it is an expression, is what its function
 *   returns, so its value can be shown, as the MySQL Shell's notebooks
 *   showed a block's. An assignment is left as it is: setting `obj.x` is
 *   not asking to see it.
 *
 * @param compiled The cell, compiled: `(async () => {...})()`.
 *
 * @returns The same, rewritten, and the line its returned expression is
 *          on, where it has one; as it was where it does not parse - V8
 *          says why when it runs.
 */
export const rewriteCell = (
    compiled: string,
): { code: string; returnLine?: number } => {
    let program: IEsNode;
    try {
        program = parse(compiled, { ecmaVersion: "latest" }) as IEsNode;
    } catch {
        return { code: compiled };
    }

    const call = (program.body as IEsNode[] | undefined)?.[0]?.expression;
    const block = call?.callee?.body;
    const statements = Array.isArray(block)
        ? block
        : (block?.body as IEsNode[] | undefined) ?? [];
    const edits: IEdit[] = [];
    const variables: string[] = [];

    for (const statement of statements) {
        if (statement.type === "VariableDeclaration") {
            const keyword = statement.kind ?? "";
            for (const declarator of statement.declarations ?? []) {
                variables.push(...boundNames(declarator.id));
                // `let a;` sets it afresh, as declaring it would.
                if (declarator.init === null && declarator.id?.type
                    === "Identifier") {
                    edits.push({
                        start: declarator.end,
                        end: declarator.end,
                        text: " = undefined",
                        rank: 1,
                    });
                }
            }
            // `;(` against a line before it that has no semicolon.
            edits.push({
                start: statement.start,
                end: statement.start + keyword.length,
                text: ";(".padEnd(keyword.length, " "),
            });
            const close = compiled[statement.end - 1] === ";"
                ? statement.end - 1
                : statement.end;
            edits.push({ start: close, end: close, text: ")" });
        } else if ((statement.type === "FunctionDeclaration"
            || statement.type === "ClassDeclaration")
            && statement.id?.name !== undefined) {
            const name = statement.id.name;
            edits.push({
                start: statement.end,
                end: statement.end,
                text: `;globalThis.${name} = ${name};`,
            });
        }
    }

    let returnLine: number | undefined;
    const last = statements.at(-1);
    const expression = last?.expression;
    if (last?.type === "ExpressionStatement" && expression !== undefined
        && last.directive === undefined
        && expression.type !== "AssignmentExpression") {
        edits.push({
            start: last.start,
            end: expression.start,
            text: RETURN_START,
        }, {
            start: expression.end,
            end: last.end,
            text: ");",
        });
        returnLine = compiled.slice(0, last.start).split("\n").length;
    }

    // From the end, so each edit's offsets still hold.
    let code = compiled;
    for (const edit of edits.sort((first, second) => {
        return second.start - first.start
            || (first.rank ?? 0) - (second.rank ?? 0);
    })) {
        code = `${code.slice(0, edit.start)}${edit.text}${code.slice(edit.end)}`;
    }
    if (variables.length > 0) {
        code += `;var ${[...new Set(variables)].join(", ")};`;
    }

    return returnLine === undefined ? { code } : { code, returnLine };
};

/**
 * Turns a cell's TypeScript into the JavaScript to run: its types
 * stripped, and its code made the body of an async function, so it can
 * `await` and `return` at the top, its declarations the notebook's and its
 * last expression returned (`rewriteCell`). The
 * function opens on the cell's first line, so a stack's line numbers are
 * the cell's.
 *
 * @param code The cell's TypeScript.
 *
 * @returns The JavaScript, an expression whose value is the function's
 *          promise, and the columns it moved.
 *
 * @throws A SyntaxError saying where, for code that does not parse.
 */
export const compileCell = (code: string): ICompiledCell => {
    const rewritten = rewriteCell(transform(
        `${WRAPPER_START}${code}\n})()`, {
            transforms: ["typescript"],
            // The context is a modern V8: nothing needs lowering.
            disableESTransforms: true,
        }).code);
    const shifts = new Map([[1, WRAPPER_START.length]]);
    if (rewritten.returnLine !== undefined) {
        shifts.set(rewritten.returnLine,
            (shifts.get(rewritten.returnLine) ?? 0) + RETURN_START.length);
    }

    return { code: rewritten.code, shifts };
};

/**
 * The shapes of `PieGraph`, as the MySQL Shell's notebooks had them: an
 * enum, so it maps its names to numbers and back.
 */
export const PieGraphLayout: Readonly<Record<string, string | number>> =
    Object.freeze(Object.fromEntries(["Donut", "ThickDonut", "ThinDonut",
        "Pie"].flatMap((name, index) => {
        return [[name, index], [String(index), name]];
    })));

/** Each `PieGraphLayout`'s inner and outer radius. */
const PIE_RADIUS: Record<number, [number, number]> = {
    0: [120, 200],
    1: [80, 200],
    2: [150, 200],
    3: [0, 200],
};

/**
 * Turns rows into a pie graph's options, as the MySQL Shell's `PieGraph`
 * did: each row a slice, named and sized by the columns `keys` names, or
 * its `name` and `value` columns, or its two columns in turn.
 *
 * @param data The rows.
 * @param layout The pie's shape, a `PieGraphLayout` (default: Pie).
 * @param keys The columns that are a slice's name and its value.
 *
 * @returns The graph's options.
 *
 * @throws Where a row says nothing that makes a slice.
 */
export const pieGraphOptions = (
    data: unknown,
    layout?: number,
    keys?: { name: string; value: string },
): Record<string, unknown> => {
    if (!Array.isArray(data)) {
        throw new TypeError("PieGraph.render: the data must be an array of "
            + "rows.");
    }

    const slices = data.map((row: Record<string, unknown>) => {
        if (keys !== undefined) {
            return { name: String(row[keys.name]), value: Number(row[keys.value]) };
        }
        if (row.name !== undefined && row.value !== undefined) {
            return { name: String(row.name), value: Number(row.value) };
        }

        const values = Object.values(row);
        if (values.length > 2) {
            throw new Error("PieGraph.render: a row of more than two columns "
                + "needs the keys of its name and its value.");
        }
        if (values.length < 2) {
            throw new Error("PieGraph.render: a row needs a name and a value.");
        }

        return { name: String(values[0]), value: Number(values[1]) };
    });

    return {
        series: [{
            type: "pie",
            data: slices,
            radius: PIE_RADIUS[layout ?? 3] ?? PIE_RADIUS[3],
        }],
    };
};

/**
 * A graph to draw, as it goes to the renderer: JSON, a `Date` as its ISO
 * text, which the renderer reads back.
 *
 * @param options The graph's options.
 *
 * @returns The printed value.
 *
 * @throws Where the options are not an object.
 */
export const graphValueOf = (options: unknown): PrintedValue => {
    if (options === null || typeof options !== "object") {
        throw new TypeError("Graph.render: the options must be an object.");
    }

    return { kind: "graph", json: JSON.stringify(options) };
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
 * its lines, not the wrapper's call of it on the line after them, each at
 * the column it has in the cell.
 *
 * @param error What a cell threw.
 * @param lineCount How many lines the cell has.
 * @param shifts The columns compiling added in front, by line.
 *
 * @returns Its message, and the frames in the cell.
 */
export const describeFailure = (
    error: unknown,
    lineCount = Number.POSITIVE_INFINITY,
    shifts = new Map<number, number>(),
): string => {
    if (!(error instanceof Error) && !(typeof error === "object"
        && error !== null && "message" in error)) {
        return `Uncaught ${inspect(error)}`;
    }

    const failure = error as Error;
    const frames = (failure.stack ?? "").split("\n").filter((line) => {
        const at = CELL_FRAME.exec(line);

        return at !== null && Number(at[1]) <= lineCount;
    }).map((frame) => {
        return frame.replace(CELL_POSITION, (_whole, line: string,
            column: string) => {
            const shift = shifts.get(Number(line)) ?? 0;

            return `${CELL_FILE}:${line}:${
                Math.max(1, Number(column) - shift)}`;
        });
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
        Graph: {
            render: (options: unknown): void => {
                send({ type: "print", runId, value: graphValueOf(options) });
            },
        },
        PieGraph: {
            render: (
                data: unknown,
                layout?: number,
                keys?: { name: string; value: string },
            ): void => {
                send({
                    type: "print",
                    runId,
                    value: graphValueOf(pieGraphOptions(data, layout, keys)),
                });
            },
        },
        PieGraphLayout,
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
        let compiled: ICompiledCell | undefined;
        try {
            compiled = compileCell(code);
        } catch (failure) {
            error = `SyntaxError: ${cellSyntaxMessage(
                failure instanceof Error ? failure.message : String(failure))}`;
        }
        if (compiled !== undefined) {
            try {
                const script = new vm.Script(compiled.code,
                    { filename: CELL_FILE });
                const value = await (script.runInContext(context) as
                    Promise<unknown>);
                // What the cell came to, as a REPL shows it.
                if (value !== undefined) {
                    send({ type: "print", runId, value: printedValueOf(value) });
                }
            } catch (failure) {
                error = describeFailure(failure, code.split("\n").length,
                    compiled.shifts);
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
