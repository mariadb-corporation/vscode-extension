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

import { describe, expect, it } from "vitest";

import type { IMsmSchemaRename } from "../../mcp/msmApi.js";
import {
    releasedMessage,
    renameDetail,
    renameSchema,
    type ISchemaRenameHost,
} from "../../msm/schemaRename.js";

const OLD = "/work/shop.msm.project";
const NEW = "/work/store.msm.project";

/** msm's answer: allowed, the folder moving, unless overridden. */
const answer = (extra: Partial<IMsmSchemaRename> = {}): IMsmSchemaRename => {
    return { allowed: true, projectPath: NEW, previousProjectPath: OLD,
        files: [`${NEW}/msm.project.json`], migration: [], warnings: [],
        ...extra };
};

/**
 * A host that records what was done, in order.
 *
 * @param options What msm and the user answer.
 * @param options.check The nameless dry run's answer.
 * @param options.plan The dry run's answer for the name.
 * @param options.done The rename's answer, or its error.
 * @param options.name The name typed.
 * @param options.confirmed Whether the rename is confirmed.
 * @param options.shown The diagram the open viewer shows.
 */
const setUp = (options: {
    check?: IMsmSchemaRename;
    plan?: IMsmSchemaRename;
    done?: IMsmSchemaRename | Error;
    name?: string;
    confirmed?: boolean;
    shown?: string;
} = {}) => {
    const steps: string[] = [];
    const host: ISchemaRenameHost = {
        api: {
            renameSchema: (projectPath, newName, dryRun) => {
                steps.push(`${dryRun ? "dry run" : "rename"} ${projectPath} `
                    + `${newName ?? "(no name)"}`);
                if (dryRun) {
                    return Promise.resolve(newName === undefined
                        ? options.check ?? answer()
                        : options.plan ?? answer());
                }
                const done = options.done ?? answer();

                return done instanceof Error
                    ? Promise.reject(done) : Promise.resolve(done);
            },
        },
        askName: (current) => {
            steps.push(`ask ${current}`);

            return Promise.resolve(options.name ?? "store");
        },
        confirm: (message, detail) => {
            steps.push(`confirm ${message} | ${detail}`);

            return Promise.resolve(options.confirmed ?? true);
        },
        refuse: (message) => { steps.push(`refuse ${message}`); },
        warn: (message) => { steps.push(`warn ${message}`); },
        closeViewer: (projectPath) => {
            steps.push(`close ${projectPath}`);

            return Promise.resolve(options.shown);
        },
        moved: (from, to) => {
            steps.push(`moved ${from} -> ${to}`);

            return Promise.resolve();
        },
        openDiagram: (projectPath, diagram) => {
            steps.push(`open ${projectPath} ${diagram}`);
        },
    };

    return { host, steps };
};

describe("Rename Schema", () => {
    it("asks msm, confirms, closes the viewer, renames and follows the "
        + "folder", async () => {
        const { host, steps } = setUp({ shown: "Main",
            done: answer({ warnings: ["Project shop2 depends on shop."] }) });

        expect(await renameSchema({ projectPath: OLD, schema: "shop" }, host))
            .toBe(NEW);
        expect(steps).toEqual([
            `dry run ${OLD} (no name)`,
            "ask shop",
            `dry run ${OLD} store`,
            "confirm Rename the schema shop to store? | Everything in the "
                + "project that names shop will name store: its settings, its "
                + "SQL scripts, the schema snapshot and the project list.\n"
                + `The project folder moves to ${NEW}.\n1 file(s) will be `
                + "written.",
            `close ${OLD}`,
            `rename ${OLD} store`,
            `moved ${OLD} -> ${NEW}`,
            `open ${NEW} Main`,
            "warn The schema shop is now store. Left to you: Project shop2 "
                + "depends on shop.",
        ]);
    });

    it("refuses a released project before asking for a name", async () => {
        const { host, steps } = setUp();

        expect(await renameSchema({ projectPath: OLD, schema: "shop",
            lastReleasedVersion: "1.0.0" }, host)).toBeUndefined();
        expect(steps).toEqual([`refuse ${releasedMessage("shop", "1.0.0")}`]);
    });

    it("says why msm will not, before a name and after one", async () => {
        const lsp = setUp({ check: answer({ allowed: false,
            reason: "lsp-missing", message: "Update mariadb-lsp." }) });
        await renameSchema({ projectPath: OLD, schema: "shop" }, lsp.host);
        expect(lsp.steps).toEqual([`dry run ${OLD} (no name)`,
            "refuse Update mariadb-lsp."]);

        const taken = setUp({ plan: answer({ allowed: false,
            reason: "folder-exists" }) });
        await renameSchema({ projectPath: OLD, schema: "shop" }, taken.host);
        expect(taken.steps.at(-1))
            .toBe("refuse The schema shop cannot be renamed to store "
                + "(folder-exists).");
        expect(taken.steps.some((step) => { return step.startsWith("close"); }))
            .toBe(false);
    });

    it("does nothing for the same name, an empty one or no", async () => {
        for (const options of [{ name: "shop" }, { name: "  " },
            { confirmed: false }]) {
            const { host, steps } = setUp(options);
            expect(await renameSchema({ projectPath: OLD, schema: "shop" },
                host)).toBeUndefined();
            expect(steps.some((step) => {
                return step.startsWith("rename") || step.startsWith("close");
            })).toBe(false);
        }
    });

    it("opens the viewer where it was when the rename fails", async () => {
        const { host, steps } = setUp({ shown: "Main",
            done: new Error("msm refused") });

        await expect(renameSchema({ projectPath: OLD, schema: "shop" }, host))
            .rejects.toThrow("msm refused");
        expect(steps.slice(-2)).toEqual([`rename ${OLD} store`,
            `open ${OLD} Main`]);
    });

    it("lists the migration where msm has one", () => {
        expect(renameDetail(answer({ projectPath: OLD,
            migration: ["RENAME TABLE shop.t TO store.t"] }), "shop", "store"))
            .toContain("Deployed databases are moved with:\n"
                + "RENAME TABLE shop.t TO store.t");
    });
});
