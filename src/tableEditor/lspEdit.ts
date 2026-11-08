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
 * `mariadb-lsp edit` (lsp-server `docs/edit-format.md`) run by the
 * extension itself, for the table editor: with no edits it reads a script's
 * outline (a live table's `SHOW CREATE TABLE`, a project's development
 * script); with edits it gives the migration, the ALTER statements a live
 * table is changed with and a project's Save previews. It writes no file:
 * msm still makes a project's edits.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { IMsmSchemaEdit } from "../mcp/msmApi.js";
import type {
    IOutlineTable,
    IOutlineTrigger,
} from "../modeler/modelFormat.js";

/** A position in a text, as LSP counts it (0-based, UTF-16). */
export interface ILspPosition {
    line: number;
    character: number;
}

/** An object of the outline, with where it is written. */
interface IPlaced {
    name: string;
    source?: number;
    range?: { start: ILspPosition; end: ILspPosition };
}

/** A schema of the outline. */
export interface ILspOutlineSchema {
    name: string | null;
    tables: Array<IOutlineTable & IPlaced>;
    triggers?: Array<IOutlineTrigger & IPlaced>;
}

/** The outline of the script, as the edit gives it. */
export interface ILspOutline {
    schemas: ILspOutlineSchema[];
    /** The files the script includes, by `source`. */
    includes?: Array<{ path?: string; file?: string }> | null;
}

/** One statement of the migration. */
export interface ILspMigrationStatement {
    sql: string;
    action?: string;
    object?: string;
    name?: string;
}

/** What `mariadb-lsp edit` answers with. */
export interface ILspEditResult {
    migration: ILspMigrationStatement[];
    notes: Array<{ kind?: string; message: string }>;
    outline: ILspOutline;
}

/** What a run of the binary came to. */
export interface ILspRun {
    code: number | null;
    stdout: string;
    stderr: string;
}

/** Runs the binary: a test's fake, else `spawn`. */
export type LspRunner = (binary: string, args: string[],
    stdin?: string) => Promise<ILspRun>;

/** Where the script comes from: text on stdin, or a project's file. */
export type LspScript = { text: string } | { file: string };

/**
 * Runs a binary with its standard input, collecting its output.
 *
 * @param binary The binary.
 * @param args Its arguments.
 * @param stdin What it reads.
 *
 * @returns How it ended.
 */
export const spawnLsp: LspRunner = (binary, args, stdin) => {
    return new Promise((resolve, reject) => {
        const child = spawn(binary, args, { stdio: "pipe" });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => { stdout += chunk; });
        child.stderr.on("data", (chunk: string) => { stderr += chunk; });
        child.once("error", reject);
        child.once("close", (code) => { resolve({ code, stdout, stderr }); });
        child.stdin.end(stdin ?? "");
    });
};

/**
 * `mariadb-lsp edit`, found when first needed.
 */
export class LspEdit {
    /**
     * @param binary Finds the binary: undefined where there is none.
     * @param run Runs it.
     */
    public constructor(
        private readonly binary: () => Promise<string | undefined>,
        private readonly run: LspRunner = spawnLsp,
    ) { }

    /**
     * @param script The script.
     * @param schema The schema the names belong to; null for a script
     *               without `USE`.
     * @param edits The edits; none reads the outline alone.
     *
     * @returns What the binary answered.
     */
    public async edit(
        script: LspScript,
        schema: string | null,
        edits: IMsmSchemaEdit[] = [],
    ): Promise<ILspEditResult> {
        const binary = await this.binary();
        if (binary === undefined) {
            throw new Error("No usable mariadb-lsp was found: the table "
                + "editor needs the MariaDB SQL language server of a MariaDB "
                + "Shell installation, one on the PATH, or mariadb.lsp.path.");
        }
        const folder = await mkdtemp(path.join(tmpdir(), "mariadb-edit-"));
        try {
            const request = path.join(folder, "edits.json");
            await writeFile(request, JSON.stringify({ format: 1, schema,
                edits }));
            const args = ["edit", "--edits", request];
            const result = "file" in script
                ? await this.run(binary, [...args, script.file])
                : await this.run(binary, [...args, "-"], script.text);

            return parseEditResult(result);
        } finally {
            await rm(folder, { recursive: true, force: true });
        }
    }
}

/**
 * @param result How the binary ended.
 *
 * @returns Its answer; an error with its message where it refused.
 */
export const parseEditResult = (result: ILspRun): ILspEditResult => {
    let answer: unknown;
    try {
        answer = JSON.parse(result.stdout);
    } catch {
        throw new Error(`mariadb-lsp edit failed (exit ${result.code}): `
            + (result.stderr.trim() || result.stdout.trim() || "no output"));
    }
    const refused = (answer as { error?: { message?: string } }).error;
    if (refused !== undefined || result.code !== 0) {
        throw new Error(refused?.message
            ?? (result.stderr.trim() || `mariadb-lsp edit exited with ${
                result.code}`));
    }
    const edited = answer as Partial<ILspEditResult>;

    return {
        migration: edited.migration ?? [],
        notes: edited.notes ?? [],
        outline: edited.outline ?? { schemas: [] },
    };
};

/**
 * @param text A text.
 * @param start Where the slice starts.
 * @param end Where it ends.
 *
 * @returns The text between the two positions.
 */
export const sliceText = (
    text: string,
    start: ILspPosition,
    end: ILspPosition,
): string => {
    const lines = text.split("\n");
    const offset = (position: ILspPosition): number => {
        let at = 0;
        for (let line = 0; line < position.line && line < lines.length;
            line += 1) {
            at += lines[line].length + 1;
        }

        return at + position.character;
    };

    return text.slice(offset(start), offset(end));
};

/**
 * @param outline An outline.
 * @param schema The schema to look in; null takes the first.
 * @param table The table.
 *
 * @returns The table and its triggers, where the outline has it.
 */
export const tableOfOutline = (
    outline: ILspOutline,
    schema: string | null,
    table: string,
): { table: IOutlineTable & IPlaced; triggers: IOutlineTrigger[] }
    | undefined => {
    const lower = table.toLowerCase();
    const schemas = outline.schemas.filter((entry) => {
        return schema === null || entry.name === null
            || entry.name.toLowerCase() === schema.toLowerCase();
    });
    for (const entry of schemas) {
        const found = entry.tables.find((candidate) => {
            return candidate.name.toLowerCase() === lower;
        });
        if (found !== undefined) {
            return {
                table: found,
                triggers: schemas.flatMap((each) => {
                    return each.triggers ?? [];
                }).filter((trigger) => {
                    return trigger.table.toLowerCase() === lower;
                }),
            };
        }
    }

    return undefined;
};
