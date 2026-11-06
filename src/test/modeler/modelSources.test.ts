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

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
    IMsmApi,
    IMsmSchemaEdit,
    IMsmSchemaEditResult,
} from "../../mcp/msmApi.js";
import { DiagramDrafts } from "../../modeler/diagramDrafts.js";
import {
    DIAGRAM_FORMAT,
    SCHEMA_DEFINITION_FORMAT,
    type IDiagramDocument,
    type IDiagramRow,
} from "../../modeler/modelFormat.js";
import type { SaveState } from "../../modeler/modelerProtocol.js";
import {
    ConnectionModelSource,
    describeEdit,
    type IModelSource,
    diagramHash,
    ProjectModelSource,
} from "../../modeler/modelSources.js";
import type { IActionRow } from "../../webview/protocol.js";

const PROJECT = "/work/shop.msm.project";

const snapshot = (hash = "sha256:one"): IDiagramRow => {
    return {
        name: "schema_definition",
        format: SCHEMA_DEFINITION_FORMAT,
        document: { format: SCHEMA_DEFINITION_FORMAT, schema: "shop",
            source_hash: hash, tables: [], views: [], routines: [] },
    };
};

const diagram = (name: string, left = 10): IDiagramDocument => {
    return {
        format: DIAGRAM_FORMAT,
        name,
        width: 100,
        height: 100,
        layers: [],
        figures: [
            { id: "t", type: "TableFigure", name: "customer", table: "customer",
                left, top: 10, width: 120, height: 60 },
            { id: "logo", type: "ImageFigure", name: "Logo", left: 0, top: 0,
                width: 20, height: 20, image_size: 400 },
        ],
        connections: [],
    };
};

/**
 * Waits until the saves a test started are done: the save states end with
 * one that is not pending or saving.
 *
 * @param fake The test's setup.
 */
const settle = async (fake: IFake): Promise<void> => {
    await vi.waitFor(() => {
        expect(["saved", "failed"]).toContain(fake.states.at(-1)?.state);
    });
};

/** What the fake api was called with, in order. */
type Call = [string, ...unknown[]];

interface IFake {
    source: ProjectModelSource;
    calls: Call[];
    rows: IDiagramRow[];
    drafts: DiagramDrafts;
    states: SaveState[];
    actions: IActionRow[];
    asked: string[];
    /** Makes the next save fail. */
    failSave: (error?: Error) => void;
    /** Makes the next schema edit fail. */
    failEdit: (error?: Error) => void;
}

/**
 * @param fake A source's test setup.
 *
 * @returns The calls its Actions rows showed, while they ran.
 */
const calls = (fake: IFake): string[] => {
    return fake.actions.flatMap((row) => {
        return (row.children ?? []).map((child) => { return child.statement; });
    });
};

const setUp = (keep = false): IFake => {
    const folder = mkdtempSync(join(tmpdir(), "drafts-"));
    const drafts = new DiagramDrafts(folder);
    const calls: Call[] = [];
    const rows: IDiagramRow[] = [snapshot(),
        { name: "Main", format: DIAGRAM_FORMAT, document: diagram("Main") }];
    let saveError: Error | undefined;
    let editError: Error | undefined;
    const api = {
        getSchemaDiagrams: (path: string) => {
            calls.push(["get", path]);

            return Promise.resolve(structuredClone(rows));
        },
        setSchemaDiagram: (_path: string, document: IDiagramDocument) => {
            calls.push(["set", document.name]);
            if (saveError !== undefined) {
                const error = saveError;
                saveError = undefined;

                return Promise.reject(error);
            }

            return Promise.resolve(["/work/shop.msm.project/development/x.sql"]);
        },
        getSchemaDiagramImage: (_path: string, name: string, id: string) => {
            calls.push(["image", name, id]);

            return Promise.resolve("data:image/png;base64,AAAA");
        },
        editSchema: (
            _path: string,
            _edits: IMsmSchemaEdit[],
            base: string,
        ): Promise<IMsmSchemaEditResult> => {
            calls.push(["edit", base]);
            if (editError !== undefined) {
                const error = editError;
                editError = undefined;

                return Promise.reject(error);
            }

            return Promise.resolve({
                rows: [snapshot("sha256:two"), rows[1]],
                files: ["a.sql"],
                migration: [],
                notes: [{ message: "A view refers to it." }],
            });
        },
    } as unknown as IMsmApi;
    const states: SaveState[] = [];
    const actions: IActionRow[] = [];
    const asked: string[] = [];
    const source = new ProjectModelSource(PROJECT, {
        msmApi: () => { return Promise.resolve(api); },
        put: (_connection, row) => { actions.push(row); },
        drafts,
        keepDraft: (name) => {
            asked.push(name);

            return Promise.resolve(keep);
        },
        log: () => { /* not looked at */ },
    }, 0);
    source.onSaveState = (state) => { states.push(state); };

    return {
        source, calls, rows, drafts, states, actions, asked,
        failSave: (error = new Error("disk full")) => { saveError = error; },
        failEdit: (error = new Error("unsupported")) => { editError = error; },
    };
};

describe("ProjectModelSource", () => {
    let fake: IFake;

    beforeEach(() => {
        fake = setUp();
    });

    it("reads a project's diagrams through msm, as an action", async () => {
        expect(fake.source.schemaTitle).toBe("shop");
        expect(fake.source.target("Main")).toEqual({ kind: "project",
            projectPath: PROJECT, diagram: "Main" });
        const { model, source } = await fake.source.read();

        expect(source).toBe(PROJECT);
        expect(model.sourceHash).toBe("sha256:one");
        expect(model.diagrams.map((entry) => { return entry.name; }))
            .toEqual(["Main"]);
        expect(calls(fake)).toContainEqual(expect.stringContaining(
            "msm.get_schema_diagrams(schema_project_path="));
    });

    it("keeps a change at once, saves it once settled, then drops it",
        async () => {
            await fake.source.read();
            fake.source.changed(diagram("Main", 50));

            const [kept] = await fake.drafts.list(PROJECT);
            expect(kept.document.figures[0].left).toBe(50);
            expect(kept.base).toBe(diagramHash(diagram("Main")));
            await settle(fake);

            expect(fake.calls.at(-1)).toEqual(["set", "Main"]);
            expect(await fake.drafts.list(PROJECT)).toEqual([]);
            expect(fake.states.map((state) => { return state.state; }))
                .toEqual(["pending", "saving", "saved"]);
        });

    it("saves the last of quick changes once", async () => {
        await fake.source.read();
        fake.source.changed(diagram("Main", 20));
        fake.source.changed(diagram("Main", 30));
        await settle(fake);

        expect(fake.calls.filter((call) => { return call[0] === "set"; }))
            .toHaveLength(1);
    });

    it("keeps the draft where a save fails", async () => {
        await fake.source.read();
        fake.failSave();
        fake.source.changed(diagram("Main", 50));
        await settle(fake);

        expect(fake.states.at(-1)).toEqual({ state: "failed",
            message: "disk full" });
        expect(await fake.drafts.list(PROJECT)).toHaveLength(1);
    });

    it("takes up the changes a closed VS Code left, and saves them",
        async () => {
            fake.drafts.put(PROJECT, diagram("Main", 70),
                diagramHash(diagram("Main")));
            const { model } = await fake.source.read();

            const figures = model.diagrams[0].figures;
            expect(figures[0].left).toBe(70);
            // The draft has no pictures; the project's stand-in stays.
            expect(figures[1].image_size).toBe(400);
            expect(fake.asked).toEqual([]);
            await settle(fake);
            expect(fake.calls.at(-1)).toEqual(["set", "Main"]);
            expect(await fake.drafts.list(PROJECT)).toEqual([]);
        });

    it("asks before changes of a diagram the project changed since",
        async () => {
            fake.drafts.put(PROJECT, diagram("Main", 70), "sha256:older");
            const { model } = await fake.source.read();

            expect(fake.asked).toEqual(["Main"]);
            expect(model.diagrams[0].figures[0].left).toBe(10);
            expect(await fake.drafts.list(PROJECT)).toEqual([]);

            const keeping = setUp(true);
            keeping.drafts.put(PROJECT, diagram("Main", 70), "sha256:older");
            expect((await keeping.source.read()).model.diagrams[0].figures[0]
                .left).toBe(70);
        });

    it("drops the changes of a diagram the project no longer has",
        async () => {
            fake.drafts.put(PROJECT, diagram("Gone"), "x");
            await fake.source.read();

            expect(await fake.drafts.list(PROJECT)).toEqual([]);
            expect(fake.asked).toEqual([]);
        });

    it("saves what waits before a schema edit, then edits", async () => {
        await fake.source.read();
        fake.source.changed(diagram("Main", 50));
        const outcome = await fake.source.edit([{ op: "rename_table",
            table: "customer", new_name: "client" }], "sha256:one");

        expect(fake.calls.slice(-2)).toEqual([["set", "Main"],
            ["edit", "sha256:one"]]);
        expect(outcome.model.sourceHash).toBe("sha256:two");
        expect(outcome.notes).toEqual(["A view refers to it."]);
        expect(calls(fake)).toContainEqual(expect.stringContaining(
            "edits=rename_table customer -> client"));
    });

    it("saves the diagrams a schema edit placed figures on once it is made",
        async () => {
            await fake.source.read();
            await fake.source.edit([{ op: "add_table", table: { name: "t" } }],
                "sha256:one", [diagram("Main", 70)]);

            expect(fake.calls.slice(-2)).toEqual([["edit", "sha256:one"],
                ["set", "Main"]]);
            expect(await fake.drafts.list(PROJECT)).toEqual([]);
            expect(calls(fake)).toContainEqual(expect.stringContaining(
                "edits=add_table t"));
        });

    it("drops those diagrams where the edit fails, and saves nothing",
        async () => {
            await fake.source.read();
            fake.failEdit();

            await expect(fake.source.edit([{ op: "add_table",
                table: { name: "t" } }], "sha256:one", [diagram("Main", 70)]))
                .rejects.toThrow("unsupported");
            expect(fake.calls.filter((call) => { return call[0] === "set"; }))
                .toEqual([]);
            expect(await fake.drafts.list(PROJECT)).toEqual([]);
        });

    it("reads a picture msm left out", async () => {
        expect(await fake.source.image("Main", "logo"))
            .toBe("data:image/png;base64,AAAA");
        expect(fake.calls).toEqual([["image", "Main", "logo"]]);
    });
});

describe("ConnectionModelSource", () => {
    it("reads a live schema's view, and saves nothing", async () => {
        const source = new ConnectionModelSource("dba@localhost", "shop",
            () => {
                return Promise.resolve([snapshot(),
                    { name: "Main", format: DIAGRAM_FORMAT,
                        document: diagram("Main") }]);
            });

        expect(source.editable).toBe(false);
        expect((source as IModelSource).changed).toBeUndefined();
        expect(source.target("Main")).toEqual({ kind: "connection",
            connection: "dba@localhost", schema: "shop", diagram: "Main" });
        expect((await source.read()).source).toBe("shop.msm_schema_diagrams");
    });
});

describe("diagramHash", () => {
    it("tells versions apart, but not key order, pictures or notations",
        () => {
            const reordered = JSON.parse(JSON.stringify(diagram("Main"),
                ["name", "format", "width", "height", "layers", "connections",
                    "figures", "id", "type", "table", "left", "top", "width",
                    "height", "image_size"])) as IDiagramDocument;
            const withPicture = diagram("Main");
            withPicture.figures[1].image = "data:image/png;base64,BBBB";
            withPicture.figureNotation = "workbench/default";

            expect(diagramHash(reordered)).toBe(diagramHash(diagram("Main")));
            expect(diagramHash(withPicture)).toBe(diagramHash(diagram("Main")));
            expect(diagramHash(diagram("Main", 11)))
                .not.toBe(diagramHash(diagram("Main")));
        });
});

describe("describeEdit", () => {
    it("names an edit in a few words", () => {
        expect(describeEdit({ op: "rename_column", table: "t", column: "c",
            new_name: "d" })).toBe("rename_column t c -> d");
        expect(describeEdit({ op: "drop_table", table: "t" }))
            .toBe("drop_table t");
        expect(describeEdit({ op: "add_foreign_key", table: "t",
            foreign_key: { name: "fk_t_u" } })).toBe("add_foreign_key t fk_t_u");
    });
});

describe("DiagramDrafts", () => {
    it("keeps a draft per diagram of a project, and skips what it cannot read",
        async () => {
            const folder = mkdtempSync(join(tmpdir(), "drafts-"));
            const drafts = new DiagramDrafts(join(folder, "made"));
            expect(await drafts.list(PROJECT)).toEqual([]);

            drafts.put(PROJECT, diagram("Main"), "b1");
            drafts.put(PROJECT, diagram("Main", 20), "b1");
            drafts.put(PROJECT, diagram("Other"), "b2");
            drafts.put("/work/other.msm.project", diagram("Main"), "b3");
            writeFileSync(join(folder, "made", "junk.json"), "{");

            const listed = await drafts.list(PROJECT);
            expect(listed.map((draft) => { return draft.name; }).sort())
                .toEqual(["Main", "Other"]);
            const main = listed.find((draft) => { return draft.name === "Main"; });
            expect(main?.document.figures[0].left).toBe(20);
            expect(main?.savedAt).toBeInstanceOf(Date);

            drafts.remove(PROJECT, "Main");
            drafts.remove(PROJECT, "Never");
            expect((await drafts.list(PROJECT)).map((draft) => {
                return draft.name;
            })).toEqual(["Other"]);
        });
});
