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

/**
 * The TypeScript server plugin of MariaDB Notebooks: it gives the
 * TypeScript cells of a MariaDB Notebook the typings of the runtime they
 * run in (`typings.js`), so completion, hover and signature help know
 * `print`, `runSql`, `Graph` and `PieGraph`.
 *
 * VS Code opens a notebook cell in the TypeScript server as an in-memory
 * file named `^/vscode-notebook-cell/<authority>/<notebook path>#<cell>`,
 * in the inferred project of its workspace folder; a MariaDB Notebook's
 * path ends in `.mariadb-notebook`, an untitled one's too. A plugin's
 * `getExternalFiles` only reaches a configured project's program, so the
 * typings are added to the file names the project gives its language
 * service, for any project holding such a cell. The cells of a project
 * share its global scope, so a cell knows what the cells before it
 * declared - as the runtime has it.
 *
 * The typings are written to a file under the system's temporary folder,
 * named after what they hold, so the server reads them as it reads any
 * file: the package carries no .d.ts, which the Marketplace refuses.
 *
 * The REST client SDK of a notebook's current REST service comes from the
 * extension: it writes the SDK's source to a file and names it in the
 * plugin's configuration (`configurePlugin`, `{ sdkFile }`); the file is
 * added beside the typings, and the projects are marked to be looked at
 * again. One SDK at a time: the last one built.
 *
 * Plain CommonJS with no dependencies: the server loads it from
 * `node_modules/mariadb-notebook-ts-plugin` beside the extension.
 */

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TYPINGS = require("./typings.js");

/** A MariaDB Notebook's cell, as the TypeScript server names it. */
const NOTEBOOK_CELL = /^\^\/vscode-notebook-cell\/.*\.mariadb-notebook#/i;

/**
 * Writes the typings where the server can read them, unless they are
 * there already.
 *
 * @param {string} folder Where to write them.
 *
 * @returns {string} The file.
 */
const writeTypings = (folder) => {
    const hash = crypto.createHash("sha256").update(TYPINGS).digest("hex");
    const file = path.join(folder, `notebook-${hash.slice(0, 16)}.d.ts`);
    if (!fs.existsSync(file)) {
        fs.mkdirSync(folder, { recursive: true });
        // Whole or not at all: another server may be reading it.
        const partial = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(partial, TYPINGS);
        fs.renameSync(partial, file);
    }

    return file;
};

/**
 * @param {readonly string[]} fileNames A project's files.
 *
 * @returns {boolean} Whether one of them is a MariaDB Notebook's cell.
 */
const holdsNotebookCell = (fileNames) => {
    return fileNames.some((name) => { return NOTEBOOK_CELL.test(name); });
};

/**
 * @param {string[]} fileNames The files of a project holding a MariaDB
 *        Notebook's cell.
 * @param {string} typings The typings' file.
 * @param {string} [sdkFile] The REST SDK's file, if there is one.
 *
 * @returns {string[]} The same, with the typings and the SDK.
 */
const withTypings = (fileNames, typings, sdkFile) => {
    return [...new Set([...fileNames, typings,
        ...sdkFile === undefined ? [] : [sdkFile]])];
};

/**
 * @param {string} [folder] Where the typings are written; the system's
 *        temporary folder, outside the tests.
 *
 * @returns The plugin's module factory, as the server calls it.
 */
const createInit = (folder = path.join(os.tmpdir(),
    "mariadb-notebook-ts-plugin")) => {
    /** @type {string | undefined} */
    let typings;
    /** @type {string | undefined} */
    let sdkFile;
    /**
     * The projects holding a MariaDB Notebook's cell, looked at again for
     * a new SDK; let go of as each is disposed.
     *
     * @type {Set<{ markAsDirty(): void }>}
     */
    const projects = new Set();

    return () => {
        return {
            /**
             * Takes the REST SDK's file from the extension.
             *
             * @param {{ sdkFile?: unknown }} configuration What it sent.
             *
             * @returns {void}
             */
            onConfigurationChanged: (configuration) => {
                const next = typeof configuration.sdkFile === "string"
                    ? configuration.sdkFile
                    : undefined;
                if (next === sdkFile) {
                    return;
                }
                sdkFile = next;
                for (const project of projects) {
                    project.markAsDirty();
                }
            },
            /**
             * @param {{
             *     languageServiceHost: { getScriptFileNames(): string[] };
             *     languageService: unknown;
             *     project: { markAsDirty(): void; projectService: {
             *         logger: { info(message: string): void } } };
             * }} info What the server hands a plugin for a project.
             *
             * @returns {unknown} The project's language service, as it is.
             */
            create: (info) => {
                try {
                    typings ??= writeTypings(folder);
                } catch (error) {
                    info.project.projectService.logger.info(
                        "mariadb-notebook-ts-plugin: could not write the "
                        + `typings: ${String(error)}`);

                    return info.languageService;
                }

                // Asked on every update of every project: one without a
                // notebook's cell gets its own list back, as it is.
                const host = info.languageServiceHost;
                const own = host.getScriptFileNames.bind(host);
                const file = typings;
                host.getScriptFileNames = () => {
                    const fileNames = own();
                    if (!holdsNotebookCell(fileNames)) {
                        return fileNames;
                    }
                    projects.add(info.project);

                    return withTypings(fileNames, file, sdkFile);
                };

                const service = /** @type {{ dispose?(): void }} */ (
                    info.languageService);
                const dispose = service.dispose?.bind(service);
                service.dispose = () => {
                    projects.delete(info.project);
                    dispose?.();
                };

                return info.languageService;
            },
        };
    };
};

module.exports = createInit();
module.exports.createInit = createInit;
module.exports.holdsNotebookCell = holdsNotebookCell;
module.exports.withTypings = withTypings;
