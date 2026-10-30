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
 * The MariaDB Notebook file: its JSON shape, reading and writing it, and
 * what a run of a cell leaves as its outputs. Free of `vscode`, so it is
 * tested as plain data; the serializer and the controller map it onto the
 * notebook API.
 */

import type { IActionRow, IExecutionReport } from "../webview/protocol.js";
import type { INotebookResultPayload } from "./notebookProtocol.js";
import { errorText } from "../text.js";

/** The notebook type, as `contributes.notebooks` declares it. */
export const NOTEBOOK_TYPE = "mariadb-notebook";

/** The format version written; a file with a later one is refused. */
export const NOTEBOOK_FORMAT_VERSION = 1;

/** The output type of a cell's result sets, which the extension draws. */
export const RESULT_SET_MIME = "application/vnd.mariadb.resultset+json";

/** What a statement said, in the built-in renderer's stream style. */
export const STDOUT_MIME = "application/vnd.code.notebook.stdout";

/** What went wrong, in the built-in renderer's error stream style. */
export const STDERR_MIME = "application/vnd.code.notebook.stderr";

/** One item of an output: its type and its content. */
export type NotebookOutputItem =
    | { mime: string; text: string }
    | { mime: string; json: unknown };

/** One output of a cell. */
export interface INotebookOutput {
    items: NotebookOutputItem[];
}

/** One cell as the file holds it. */
export interface INotebookCell {
    kind: "code" | "markdown";
    /** A code cell's language; a markdown cell has none. */
    language?: string;
    source: string;
    /**
     * True once the user picked a code cell's language by hand: it is not
     * switched by what is typed in it from then on.
     */
    languagePinned?: boolean;
    /** What its last run left, saved so a reopened notebook shows it. */
    outputs?: INotebookOutput[];
}

/** The whole file. */
export interface INotebookFile {
    version: number;
    /** The connection the notebook runs on, as a URI. */
    connection?: string;
    cells: INotebookCell[];
}

/**
 * Reads a notebook file.
 *
 * @param text The file's contents. An empty file is an empty notebook,
 *             which is what a new file created on disk holds.
 *
 * @returns The notebook.
 *
 * @throws An error saying what is wrong with a file that is not one.
 */
export const parseNotebook = (text: string): INotebookFile => {
    if (text.trim().length === 0) {
        return { version: NOTEBOOK_FORMAT_VERSION, cells: [] };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new Error(
            `The notebook is not valid JSON: ${errorText(error)}`);
    }

    if (typeof parsed !== "object" || parsed === null
        || !Array.isArray((parsed as INotebookFile).cells)) {
        throw new Error("The file is not a MariaDB Notebook: it has no "
            + "cells.");
    }

    const file = parsed as Partial<INotebookFile>;
    const version = typeof file.version === "number"
        ? file.version
        : NOTEBOOK_FORMAT_VERSION;
    if (version > NOTEBOOK_FORMAT_VERSION) {
        throw new Error(`The notebook is format version ${version}; this `
            + `version of the extension reads up to `
            + `${NOTEBOOK_FORMAT_VERSION}.`);
    }

    const cells = (file.cells ?? []).filter((cell) => {
        return typeof cell === "object" && cell !== null;
    }).map((cell): INotebookCell => {
        const kind = cell.kind === "markdown" ? "markdown" : "code";

        return {
            kind,
            ...kind === "code" && typeof cell.language === "string"
                ? { language: cell.language }
                : {},
            source: typeof cell.source === "string" ? cell.source : "",
            ...kind === "code" && cell.languagePinned === true
                ? { languagePinned: true }
                : {},
            ...Array.isArray(cell.outputs) && cell.outputs.length > 0
                ? { outputs: cell.outputs }
                : {},
        };
    });

    return {
        version,
        ...typeof file.connection === "string"
            ? { connection: file.connection }
            : {},
        cells,
    };
};

/**
 * Writes a notebook file: indented, so a saved notebook diffs line by line,
 * and with a trailing newline.
 *
 * @param file The notebook.
 *
 * @returns The file's contents.
 */
export const serializeNotebook = (file: INotebookFile): string => {
    return `${JSON.stringify(file, null, 2)}\n`;
};

/**
 * Turns a run of a cell into its outputs: what its statements said, in
 * the order they ran - each message a line of one stream output, each
 * error a stream of its own - and then, where there were any, its result
 * sets, together in one output with a tab each, as the MariaDB panel has
 * them.
 *
 * @param report What the run produced.
 * @param view Which view the result sets are, and the connection they
 *             came from.
 * @param view.viewId Tells this output's view from every other's.
 * @param view.connection The connection the cell ran on.
 *
 * @returns The cell's outputs.
 */
export const outputsOf = (
    report: IExecutionReport,
    view: { viewId: string; connection: string },
): INotebookOutput[] => {
    const outputs: INotebookOutput[] = [];
    let lines: string[] = [];

    const flush = (): void => {
        if (lines.length > 0) {
            outputs.push({
                items: [{ mime: STDOUT_MIME, text: `${lines.join("\n")}\n` }],
            });
            lines = [];
        }
    };

    const statements: IActionRow[] = report.actions.flatMap((run) => {
        return run.children ?? [];
    });
    for (const row of statements) {
        if (row.kind === "error") {
            flush();
            outputs.push({
                items: [{ mime: STDERR_MIME, text: `${row.message}\n` }],
            });
            continue;
        }

        // A statement with a result set says so on the set's own tab.
        if (row.resultId === undefined) {
            lines.push(row.message);
        }
        for (const child of row.children ?? []) {
            if (child.role === "warning") {
                lines.push(`${child.statement}: ${child.message}`);
            }
        }
    }
    flush();

    if (report.resultSets.length > 0) {
        const payload: INotebookResultPayload = {
            ...view,
            resultSets: report.resultSets,
        };
        outputs.push({ items: [{ mime: RESULT_SET_MIME, json: payload }] });
    }

    return outputs;
};

/**
 * Whether a run went through without a failing statement.
 *
 * @param report What the run produced.
 *
 * @returns False where the run or any of its statements failed.
 */
export const succeeded = (report: IExecutionReport): boolean => {
    return report.actions.every((run) => {
        return run.kind !== "error";
    });
};
