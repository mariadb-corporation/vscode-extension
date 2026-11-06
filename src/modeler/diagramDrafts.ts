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

import { createHash } from "node:crypto";
import {
    mkdirSync,
    renameSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { IDiagramDocument } from "./modelFormat.js";

/**
 * The changes made to MSM projects' diagrams that msm does not have yet:
 * a file per diagram in the extension's storage, written as each change
 * is made and removed once the project has it, so a VS Code closed - or
 * a save that failed - loses nothing.
 */

/** A diagram's changes, kept. */
export interface IDiagramDraft {
    projectPath: string;
    name: string;
    /**
     * The hash of the project's diagram the changes were made to
     * (`diagramHash`): the project changed it since where it differs.
     */
    base: string;
    document: IDiagramDocument;
    savedAt: Date;
}

/** A draft as its file holds it. */
type IDraftFile = Omit<IDiagramDraft, "savedAt"> & {
    version: 1;
    savedAt: string;
};

/**
 * @param text A text.
 *
 * @returns Its hash, short enough for a file name.
 */
const hashOf = (text: string): string => {
    return createHash("sha256").update(text).digest("hex").slice(0, 16);
};

export class DiagramDrafts {
    /**
     * @param folder The folder the drafts are kept in, made when the first
     *               one is.
     */
    public constructor(private readonly folder: string) { }

    /**
     * @param projectPath A project folder.
     * @param name A diagram.
     *
     * @returns The file its draft is kept in: hashes, as the names may be
     *          anything; the file says whose it is.
     */
    #file(projectPath: string, name: string): string {
        return join(this.folder,
            `${hashOf(projectPath)}-${hashOf(name)}.json`);
    }

    /**
     * Keeps a diagram's changes, replacing what was kept of it. Written at
     * once and in one piece (to a temporary file, then renamed), so a
     * draft is never half there.
     *
     * @param projectPath The project folder.
     * @param document The diagram, as it is now.
     * @param base The hash of the project's diagram it was changed from.
     */
    public put(
        projectPath: string,
        document: IDiagramDocument,
        base: string,
    ): void {
        mkdirSync(this.folder, { recursive: true });
        const file = this.#file(projectPath, document.name);
        const content: IDraftFile = {
            version: 1,
            projectPath,
            name: document.name,
            base,
            document,
            savedAt: new Date().toISOString(),
        };
        writeFileSync(`${file}.tmp`, JSON.stringify(content));
        renameSync(`${file}.tmp`, file);
    }

    /**
     * Drops a diagram's draft, where there is one.
     *
     * @param projectPath The project folder.
     * @param name The diagram.
     */
    public remove(projectPath: string, name: string): void {
        rmSync(this.#file(projectPath, name), { force: true });
    }

    /**
     * @param projectPath A project folder.
     *
     * @returns The drafts of its diagrams; a file that cannot be read is
     *          skipped.
     */
    public async list(projectPath: string): Promise<IDiagramDraft[]> {
        let names: string[];
        try {
            names = await readdir(this.folder);
        } catch {
            return [];
        }
        const prefix = `${hashOf(projectPath)}-`;
        const drafts: IDiagramDraft[] = [];
        for (const name of names) {
            if (!name.startsWith(prefix) || !name.endsWith(".json")) {
                continue;
            }
            try {
                const content = JSON.parse(await readFile(
                    join(this.folder, name), "utf8")) as IDraftFile;
                if (content.version === 1
                    && content.projectPath === projectPath) {
                    const { version: _version, savedAt, ...draft } = content;
                    drafts.push({ ...draft, savedAt: new Date(savedAt) });
                }
            } catch {
                // Not one of ours, or cut short: there is nothing to take.
            }
        }

        return drafts;
    }
}
