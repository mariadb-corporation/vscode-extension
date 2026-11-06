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

import { beforeEach, describe, expect, it } from "vitest";

import type { IMsmSchemaEdit } from "../../mcp/msmApi.js";
import type {
    IDiagramDocument,
    ISchemaModel,
} from "../../modeler/modelFormat.js";
import {
    MODELER_VIEW_TYPE,
    ModelerPanel,
    type IModelerHost,
} from "../../modeler/modelerPanel.js";
import type {
    ModelerHostMessage,
    ModelerTarget,
} from "../../modeler/modelerProtocol.js";
import type {
    IModelSource,
    ISchemaEditOutcome,
} from "../../modeler/modelSources.js";
import { DEFAULT_PAGE_SETTINGS } from "../../modeler/pageSettings.js";
import {
    errorMessages,
    MockWebview,
    MockWebviewPanel,
    resetVscodeMock,
    Uri,
    ViewColumn,
    webviewPanels,
} from "../mocks/vscode.js";

const extensionUri = Uri.file("/ext");

const model: ISchemaModel = {
    schema: "world",
    sourceHash: "sha256:one",
    tables: [],
    views: [],
    routines: [],
    triggers: [],
    events: [],
    sequences: [],
    diagrams: [],
};

/** A source as a test makes it: what it was asked, and its answers. */
interface IFakeSource extends IModelSource {
    changes: IDiagramDocument[];
    edits: Array<[IMsmSchemaEdit[], string]>;
    flushes: number;
    reads: number;
}

const source = (
    schema = "world",
    overrides: Partial<IModelSource> = {},
): IFakeSource => {
    const fake: IFakeSource = {
        key: `connection:${schema}`,
        schemaTitle: schema,
        editable: false,
        changes: [],
        edits: [],
        flushes: 0,
        reads: 0,
        target: (diagram): ModelerTarget => {
            return { kind: "connection", connection: "dba@localhost:3310",
                schema, diagram };
        },
        read: () => {
            fake.reads += 1;

            return Promise.resolve({ model: { ...model, schema },
                source: `${schema}.msm_schema_diagrams` });
        },
        changed: (document) => { fake.changes.push(document); },
        flush: () => {
            fake.flushes += 1;

            return Promise.resolve();
        },
        ...overrides,
    };

    return fake;
};

const flush = async (): Promise<void> => {
    await new Promise((resolve) => { setTimeout(resolve, 0); });
};

const lastPanel = (): MockWebviewPanel => {
    return webviewPanels[webviewPanels.length - 1];
};

const posted = (panel = lastPanel()): ModelerHostMessage[] => {
    return (panel.webview as MockWebview).posted as ModelerHostMessage[];
};

const host = (logs: string[] = []): IModelerHost => {
    return { log: (message) => { logs.push(message); } };
};

const show = (diagram: string, from = source()): MockWebviewPanel => {
    ModelerPanel.show(extensionUri as never, from, diagram, host());

    return lastPanel();
};

const ready = async (panel: MockWebviewPanel): Promise<void> => {
    (panel.webview as MockWebview).receive({ type: "ready" });
    await flush();
};

describe("ModelerPanel", () => {
    beforeEach(() => {
        resetVscodeMock();
    });

    it("opens on a diagram and sends the model once the page is ready",
        async () => {
            const logs: string[] = [];
            ModelerPanel.show(extensionUri as never, source(), "MRS",
                host(logs));

            const panel = lastPanel();
            expect(panel.viewType).toBe(MODELER_VIEW_TYPE);
            expect(panel.title).toBe("MRS (world)");
            expect(panel.webview.html).toContain("modeler.js");
            expect(posted()).toEqual([]);

            await ready(panel);

            expect(posted()).toEqual([{
                type: "load",
                model,
                source: "world.msm_schema_diagrams",
                pageSettings: DEFAULT_PAGE_SETTINGS,
                diagram: "MRS",
                editable: false,
                target: { kind: "connection", connection: "dba@localhost:3310",
                    schema: "world", diagram: "MRS" },
            }]);
            expect(logs[0]).toContain("Showing the diagrams of world");

            panel.dispose();
        });

    it("tells the page when the model cannot be read", async () => {
        const panel = show("MRS", source("world", {
            read: () => { return Promise.reject(new Error("gone")); },
        }));
        await ready(panel);

        expect(posted()).toEqual([{ type: "error", message: "gone" }]);

        panel.dispose();
    });

    it("shows another diagram of the schema in the panel that is up",
        () => {
            const panel = show("MRS");
            const count = webviewPanels.length;

            show("MRS Status");

            expect(webviewPanels).toHaveLength(count);
            expect(panel.revealed).toBe(1);
            expect(panel.title).toBe("MRS Status (world)");
            expect(posted(panel)).toEqual([
                { type: "showDiagram", name: "MRS Status" },
            ]);

            panel.dispose();
        });

    it("opens a panel of its own for another schema, and again once closed",
        () => {
            const first = show("MRS");
            const second = show("Main", source("shop"));

            expect(second).not.toBe(first);
            first.dispose();
            expect(show("MRS")).not.toBe(first);

            second.dispose();
            lastPanel().dispose();
        });

    it("escapes a diagram's name in the page, where the database put markup",
        () => {
            const panel = show("x</title><meta http-equiv=\"refresh\">");

            expect(panel.webview.html).not.toContain(
                "<meta http-equiv=\"refresh\"");
            expect(panel.webview.html).toContain(
                "<title>x&lt;/title&gt;&lt;meta http-equiv=&quot;refresh"
                + "&quot;&gt; (world)</title>");
            panel.dispose();
        });

    it("answers a drop of tree rows with the objects last dragged, once",
        async () => {
            const dragged = ["mariadb-schema-object:/table/city?project=%2Fp"];
            ModelerPanel.show(extensionUri as never, source(), "MRS", {
                ...host(),
                draggedObjects: () => { return dragged.shift(); },
            });
            const panel = lastPanel();
            await ready(panel);
            const webview = panel.webview as MockWebview;

            webview.receive({ type: "treeDrop", x: 10, y: 20,
                types: ["text/uri-list"] });
            webview.receive({ type: "treeDrop", x: 30, y: 40, types: [] });
            await flush();

            expect(posted().slice(1)).toEqual([
                { type: "treeDropped", x: 10, y: 20,
                    uriList: "mariadb-schema-object:/table/city?project=%2Fp" },
                { type: "treeDropped", uriList: "", x: 30, y: 40 },
            ]);

            panel.dispose();
        });

    it("places what a tree's drag carried where the pointer comes back, "
        + "and nothing otherwise", async () => {
            const dragged = ["mariadb-schema-object:/table/city?project=%2Fp"];
            const logs: string[] = [];
            ModelerPanel.show(extensionUri as never, source(), "MRS", {
                ...host(logs),
                draggedObjects: () => { return dragged.shift(); },
            });
            const panel = lastPanel();
            await ready(panel);
            const webview = panel.webview as MockWebview;

            webview.receive({ type: "pointerArrived", x: 5, y: 6 });
            webview.receive({ type: "pointerArrived", x: 7, y: 8 });
            await flush();

            expect(posted().slice(1)).toEqual([{ type: "treeDropped",
                uriList: "mariadb-schema-object:/table/city?project=%2Fp",
                x: 5, y: 6 }]);
            expect(logs.at(-1)).toContain("dragged from a tree");

            panel.dispose();
        });

    it("titles itself by the diagram the page shows", () => {
        const panel = show("MRS");

        (panel.webview as MockWebview).receive({
            type: "diagramShown", name: "MRS Status",
        });

        expect(panel.title).toBe("MRS Status (world)");
        panel.dispose();
    });

    it("hands a changed diagram to its source, and saves on close",
        async () => {
            const from = source();
            const panel = show("MRS", from);
            const document = { format: "msm-diagram/1", name: "MRS",
                width: 1, height: 1, layers: [], figures: [],
                connections: [] } as IDiagramDocument;

            (panel.webview as MockWebview).receive({
                type: "diagramChanged", document,
            });
            from.onSaveState?.({ state: "saving" });
            panel.dispose();
            await flush();

            expect(from.changes).toEqual([document]);
            expect(posted(panel)).toContainEqual({ type: "saveState",
                save: { state: "saving" } });
            expect(from.flushes).toBe(1);
            expect(from.onSaveState).toBeUndefined();
        });

    it("sends a picture msm left out, or why there is none", async () => {
        const panel = show("MRS", source("world", {
            image: (diagram, figureId) => {
                return figureId === "logo"
                    ? Promise.resolve(`data:image/png;base64,${diagram}`)
                    : Promise.reject(new Error("no picture"));
            },
        }));

        (panel.webview as MockWebview).receive({ type: "imageWanted",
            diagram: "MRS", figureId: "logo" });
        (panel.webview as MockWebview).receive({ type: "imageWanted",
            diagram: "MRS", figureId: "gone" });
        await flush();

        expect(posted(panel)).toEqual([
            { type: "image", diagram: "MRS", figureId: "logo",
                image: "data:image/png;base64,MRS" },
            { type: "image", diagram: "MRS", figureId: "gone",
                error: "no picture" },
        ]);
        panel.dispose();
    });

    it("makes schema edits against the snapshot shown, and the next against "
        + "the new one", async () => {
        const from = source("world", {
            editable: true,
            edit: (edits, baseHash): Promise<ISchemaEditOutcome> => {
                from.edits.push([edits, baseHash]);

                return Promise.resolve({
                    model: { ...model, sourceHash: `${baseHash}+` },
                    notes: [],
                });
            },
        });
        const panel = show("MRS", from);
        await ready(panel);
        const rename = { op: "rename_table", table: "a", new_name: "b" };

        (panel.webview as MockWebview).receive({ type: "schemaEdit",
            edits: [rename] });
        await flush();
        (panel.webview as MockWebview).receive({ type: "schemaEdit",
            edits: [rename] });
        await flush();

        expect(from.edits.map(([, base]) => { return base; }))
            .toEqual(["sha256:one", "sha256:one+"]);
        expect(posted(panel).at(-1)).toEqual({
            type: "schemaEdited",
            objects: { sourceHash: "sha256:one++", tables: [], views: [],
                routines: [], triggers: [], events: [], sequences: [] },
        });
        panel.dispose();
    });

    it("says why a schema edit failed, and shows the project again",
        async () => {
            const from = source("world", {
                editable: true,
                edit: () => { return Promise.reject(new Error("stale")); },
            });
            const panel = show("MRS", from);
            await ready(panel);

            (panel.webview as MockWebview).receive({ type: "schemaEdit",
                edits: [{ op: "rename_table" }] });
            await flush();

            expect(posted(panel).slice(1).map((message) => {
                return message.type;
            })).toEqual(["schemaEdited", "load"]);
            expect(posted(panel)[1]).toEqual({ type: "schemaEdited",
                error: "stale" });
            expect(from.reads).toBe(2);
            expect(errorMessages.at(-1)).toContain("stale");
            panel.dispose();
        });

    it("leaves a refused edit to the viewer where it takes it back itself",
        async () => {
            const from = source("world", {
                editable: true,
                edit: () => { return Promise.reject(new Error("bad type")); },
            });
            const panel = show("MRS", from);
            await ready(panel);

            (panel.webview as MockWebview).receive({ type: "schemaEdit",
                edits: [{ op: "add_table" }], recover: true });
            await flush();

            expect(posted(panel).slice(1)).toEqual([{ type: "schemaEdited",
                error: "bad type" }]);
            expect(from.reads).toBe(1);
            panel.dispose();
        });

    it("reads the project again where it changed since, even so",
        async () => {
            const from = source("world", {
                editable: true,
                edit: () => {
                    return Promise.reject(new Error("The schema changed since "
                        + "the snapshot the edits were made against (`a`, now "
                        + "`b`): read the diagrams again and redo them."));
                },
            });
            const panel = show("MRS", from);
            await ready(panel);

            (panel.webview as MockWebview).receive({ type: "schemaEdit",
                edits: [{ op: "add_table" }], recover: true });
            await flush();

            expect(from.reads).toBe(2);
            panel.dispose();
        });

    it("refuses schema edits a source cannot make", async () => {
        const panel = show("MRS");
        await ready(panel);

        (panel.webview as MockWebview).receive({ type: "schemaEdit",
            edits: [] });
        await flush();

        expect(posted(panel).at(-1)).toMatchObject({ type: "schemaEdited",
            error: "The schema of this diagram cannot be edited." });
        panel.dispose();
    });

    it("takes a panel restored after a restart, once per source", async () => {
        const restored = new MockWebviewPanel(MODELER_VIEW_TYPE, "old",
            ViewColumn.One, {});
        ModelerPanel.revive(extensionUri as never, restored as never, source(),
            "MRS Status", host());

        expect(restored.title).toBe("MRS Status (world)");
        expect(restored.webview.html).toContain("modeler.js");
        await ready(restored);
        expect(posted(restored)[0]).toMatchObject({ type: "load",
            diagram: "MRS Status" });

        const again = new MockWebviewPanel(MODELER_VIEW_TYPE, "old",
            ViewColumn.One, {});
        ModelerPanel.revive(extensionUri as never, again as never, source(),
            "MRS", host());
        expect(again.disposed).toBe(true);
        restored.dispose();
    });
});
