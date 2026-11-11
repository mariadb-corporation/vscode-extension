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

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { restSectionOf } from "../mrs/restScript.js";
import type { IMsmRestDefinition } from "../tree/msmProjectsTreeProvider.js";

/**
 * An MSM project's development script, read from disk. Free of `vscode`.
 */

/**
 * @param projectPath A project folder.
 *
 * @returns Its development script, `development/<schema>_next.sql` as msm
 *          names it, or undefined where `msm.project.json` cannot say.
 */
export const developmentScript = async (
    projectPath: string,
): Promise<string | undefined> => {
    try {
        const settings = JSON.parse(await readFile(
            join(projectPath, "msm.project.json"), "utf8")) as
            { schemaFileName?: string };

        return settings.schemaFileName === undefined ? undefined
            : join(projectPath, "development",
                `${settings.schemaFileName}_next.sql`);
    } catch {
        return undefined;
    }
};

/**
 * @param projectPath A project folder.
 *
 * @returns Its REST SQL, MSM Section 180 of its development script, or
 *          undefined where it has no script or no such section.
 */
export const restDefinitionOf = async (
    projectPath: string,
): Promise<IMsmRestDefinition | undefined> => {
    const file = await developmentScript(projectPath);
    if (file === undefined) {
        return undefined;
    }
    const section = restSectionOf(await readFile(file, "utf8"));

    return section === undefined ? undefined : { file, ...section };
};
