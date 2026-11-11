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
    type IEditorPlace,
    movedFile,
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
 * @param options.editors The editors open on the project's files.
 */
const setUp = (options: {
    check?: IMsmSchemaRename;
    plan?: IMsmSchemaRename;
    done?: IMsmSchemaRename | Error;
    name?: string;
    confirmed?: boolean;
    shown?: string;
    editors?: IEditorPlace[];
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
        closeEditors: (projectPath) => {
            steps.push(`close editors ${projectPath}`);

            return Promise.resolve(options.editors ?? []);
        },
        openEditors: (places) => {
            steps.push(`open editors ${places.map((place) => {
                return `${place.path}@${String(place.column)}`;
            }).join(" ")}`);

            return Promise.resolve();
        },
        asAction: (target, work) => {
            steps.push(`action ${target.schema} -> ${target.newName}`);

            return work();
        },
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
            editors: [{ path: `${OLD}/development/shop_next.sql`, column: 1 },
                { path: `${OLD}/msm.project.json`, column: 2 }],
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
            `close editors ${OLD}`,
            `close ${OLD}`,
            "action shop -> store",
            `rename ${OLD} store`,
            `moved ${OLD} -> ${NEW}`,
            `open editors ${NEW}/development/store_next.sql@1 `
                + `${NEW}/msm.project.json@2`,
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

    it("opens the editors and viewer where they were when the rename fails",
        async () => {
            const { host, steps } = setUp({ shown: "Main",
                editors: [{ path: `${OLD}/development/shop_next.sql`,
                    column: 1 }],
                done: new Error("msm refused") });

            await expect(renameSchema({ projectPath: OLD, schema: "shop" },
                host)).rejects.toThrow("msm refused");
            expect(steps.slice(-3)).toEqual([`rename ${OLD} store`,
                `open editors ${OLD}/development/shop_next.sql@1`,
                `open ${OLD} Main`]);
        });

    it("closes no editor before msm agrees and the user confirms",
        async () => {
            const { host, steps } = setUp({ confirmed: false });
            await renameSchema({ projectPath: OLD, schema: "shop" }, host);
            expect(steps.some((step) => {
                return step.startsWith("close editors");
            })).toBe(false);
        });

    describe("movedFile", () => {
        const rename = { from: OLD, to: NEW, schema: "shop",
            newName: "store" };

        it("moves a file to the new folder, renaming what starts with the "
            + "schema's name", () => {
            expect(movedFile(`${OLD}/development/shop_next.sql`, rename))
                .toBe(`${NEW}/development/store_next.sql`);
            expect(movedFile(`${OLD}/README.md`, rename))
                .toBe(`${NEW}/README.md`);
            // Only a name that starts with the schema's, and is not longer.
            expect(movedFile(`${OLD}/development/shopping.sql`, rename))
                .toBe(`${NEW}/development/shopping.sql`);
        });

        it("renames the files of a folder that stays", () => {
            expect(movedFile(`${OLD}/development/shop_next.sql`,
                { ...rename, to: OLD }))
                .toBe(`${OLD}/development/store_next.sql`);
        });

        it("leaves a file outside the project", () => {
            expect(movedFile("/work/other.msm.project/shop_next.sql", rename))
                .toBe("/work/other.msm.project/shop_next.sql");
            expect(movedFile(`${OLD}2/shop_next.sql`, rename))
                .toBe(`${OLD}2/shop_next.sql`);
        });

        it("works with Windows paths", () => {
            expect(movedFile("C:\\w\\shop.msm.project\\shop_next.sql", {
                ...rename, from: "C:\\w\\shop.msm.project",
                to: "C:\\w\\store.msm.project" }))
                .toBe("C:\\w\\store.msm.project\\store_next.sql");
        });
    });

    it("lists the migration where msm has one", () => {
        expect(renameDetail(answer({ projectPath: OLD,
            migration: ["RENAME TABLE shop.t TO store.t"] }), "shop", "store"))
            .toContain("Deployed databases are moved with:\n"
                + "RENAME TABLE shop.t TO store.t");
    });
});
