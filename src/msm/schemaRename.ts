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
 * Rename Schema...: an MSM project's schema renamed through msm's
 * `msm.rename_schema`, which changes everything that names it (settings,
 * file names, the SQL, the snapshot, the folder, the project list) and
 * refuses a project with a release, as databases deployed from it keep
 * the old name. msm is asked first (a dry run), so a refusal is told
 * before anything changes, and what would change is confirmed. The
 * project folder may move: what the extension keeps per folder (open
 * diagram viewers, their views, rows left open) follows.
 *
 * The flow runs on a host, so it can be tested without VS Code. Built so
 * a rename of a released project (msm's `migrate`, which moves deployed
 * databases) fits later: its answer's `migration` is shown with the
 * confirmation, and nothing else in the flow changes.
 */

import type { IMsmApi, IMsmSchemaRename } from "../mcp/msmApi.js";

/** What renaming a schema needs from the extension. */
export interface ISchemaRenameHost {
    api: Pick<IMsmApi, "renameSchema">;
    /**
     * Asks for the new name.
     *
     * @param current The schema's name.
     *
     * @returns The name typed, or nothing where the user gave up.
     */
    askName(current: string): Promise<string | undefined>;
    /**
     * Asks to go ahead.
     *
     * @param message The question.
     * @param detail What will change.
     *
     * @returns Whether to.
     */
    confirm(message: string, detail: string): Promise<boolean>;
    /** Says why nothing was done. */
    refuse(message: string): void;
    /** Says what the user is left to do, after the rename. */
    warn(message: string): void;
    /**
     * Saves and closes the project's open diagram viewer, which works on
     * the folder that may move.
     *
     * @returns The diagram it showed, to show again; nothing where none
     *          was open.
     */
    closeViewer(projectPath: string): Promise<string | undefined>;
    /**
     * Moves what the extension keeps per project folder to the new one:
     * the diagrams' views, rows left open; and redraws the view.
     */
    moved(from: string, to: string): Promise<void>;
    /** Opens a diagram of a project again. */
    openDiagram(projectPath: string, diagram: string): void;
}

/** The project whose schema is renamed. */
export interface ISchemaRenameTarget {
    projectPath: string;
    schema: string;
    /** The last version it released, where it has one. */
    lastReleasedVersion?: string;
}

/**
 * @param schema The schema.
 * @param version The project's last release.
 *
 * @returns Why the schema keeps its name.
 */
export const releasedMessage = (schema: string, version: string): string => {
    return `The schema ${schema} cannot be renamed: its project released `
        + `version ${version}, and databases deployed from it keep the `
        + "name. Only a project without a release can be renamed.";
};

/**
 * @param answer msm's dry run, refused.
 * @param schema The schema.
 * @param newName The name asked for, where one was.
 *
 * @returns Why it cannot be renamed: msm's words, else its reason.
 */
const refusal = (answer: IMsmSchemaRename, schema: string,
    newName?: string): string => {
    return answer.message ?? `The schema ${schema} cannot be renamed`
        + `${newName === undefined ? "" : ` to ${newName}`}`
        + `${answer.reason === undefined ? "" : ` (${answer.reason})`}.`;
};

/**
 * @param answer msm's dry run.
 * @param from The schema's name.
 * @param to Its new name.
 *
 * @returns What will change, for the confirmation.
 */
export const renameDetail = (answer: IMsmSchemaRename, from: string,
    to: string): string => {
    const lines = [`Everything in the project that names ${from} will name `
        + `${to}: its settings, its SQL scripts, the schema snapshot and `
        + "the project list."];
    if (answer.projectPath !== answer.previousProjectPath) {
        lines.push(`The project folder moves to ${answer.projectPath}.`);
    }
    if (answer.files.length > 0) {
        lines.push(`${answer.files.length} file(s) will be written.`);
    }
    if (answer.migration.length > 0) {
        lines.push("Deployed databases are moved with:",
            ...answer.migration);
    }

    return lines.join("\n");
};

/**
 * Renames an MSM project's schema: asks for the name, asks msm whether it
 * can (and what it would change), confirms, closes the project's viewer,
 * renames, moves what is kept per folder, opens the viewer again and
 * says what msm leaves to the user.
 *
 * @param target The project.
 * @param host The extension.
 *
 * @returns Where the project is now; nothing where it was not renamed.
 */
export const renameSchema = async (
    target: ISchemaRenameTarget,
    host: ISchemaRenameHost,
): Promise<string | undefined> => {
    const { projectPath, schema, lastReleasedVersion } = target;
    // Known up front from the project list: no name asked for in vain.
    if (lastReleasedVersion !== undefined) {
        host.refuse(releasedMessage(schema, lastReleasedVersion));

        return undefined;
    }
    // And from msm, what does not depend on the name: a release the list
    // did not say, MCP access, a mariadb-lsp without `rename_schema`.
    const possible = await host.api.renameSchema(projectPath, undefined, true);
    if (!possible.allowed) {
        host.refuse(refusal(possible, schema));

        return undefined;
    }
    const newName = (await host.askName(schema))?.trim();
    if (newName === undefined || newName === "" || newName === schema) {
        return undefined;
    }
    const plan = await host.api.renameSchema(projectPath, newName, true);
    if (!plan.allowed) {
        host.refuse(refusal(plan, schema, newName));

        return undefined;
    }
    if (!await host.confirm(`Rename the schema ${schema} to ${newName}?`,
        renameDetail(plan, schema, newName))) {
        return undefined;
    }

    // Its viewer saves first: msm renames what is on disk.
    const shown = await host.closeViewer(projectPath);
    let done: IMsmSchemaRename;
    try {
        done = await host.api.renameSchema(projectPath, newName, false);
    } catch (error) {
        // Nothing moved: the viewer comes back where it was.
        if (shown !== undefined) {
            host.openDiagram(projectPath, shown);
        }
        throw error;
    }
    await host.moved(projectPath, done.projectPath);
    if (shown !== undefined) {
        host.openDiagram(done.projectPath, shown);
    }
    if (done.warnings.length > 0) {
        host.warn(`The schema ${schema} is now ${newName}. Left to you: `
            + done.warnings.join(" "));
    }

    return done.projectPath;
};
