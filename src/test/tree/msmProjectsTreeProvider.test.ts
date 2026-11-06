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

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type {
    IMsmApi,
    IMsmListedProject,
    IMsmProjectDetails,
} from "../../mcp/msmApi.js";
import { McpToolError } from "../../mcp/protocol.js";
import { parseSchemaObjectUris } from "../../modeler/modelerProtocol.js";
import type { IServerStatus } from "../../mcp/serverStarter.js";
import {
    MSM_DIAGRAM_CLICK_COMMAND,
    MSM_PROJECTS_DRAG_MIME,
    MSM_PROJECTS_VIEW_STATE_CONTEXT_KEY,
    MsmProjectsTreeProvider,
    projectDescription,
    projectLabel,
    type IMsmFileNode,
    type IMsmFolderNode,
    type IMsmProjectNode,
    type MsmProjectsNode,
} from "../../tree/msmProjectsTreeProvider.js";
import {
    contextKeys,
    DataTransfer,
    DataTransferItem,
    errorMessages,
    resetVscodeMock,
    TreeItemCollapsibleState,
    Uri,
} from "../mocks/vscode.js";

/** Resolves an icon name to a recognisable pair of paths. */
const resolveIcon = (name: string) => {
    return {
        light: Uri.file(`/ext/images/light/${name}`),
        dark: Uri.file(`/ext/images/dark/${name}`),
    } as never;
};

/** A project folder on disk, with a file and a folder in it. */
const makeProject = (root: string, name: string): string => {
    const folder = join(root, `${name}.msm.project`);
    mkdirSync(join(folder, "development"), { recursive: true });
    writeFileSync(join(folder, "msm.project.json"), "{}");
    writeFileSync(join(folder, "development", `${name}_next.sql`), "");

    return folder;
};

const listed = (
    projectPath: string,
    changes: Partial<IMsmListedProject> = {},
): IMsmListedProject => {
    return {
        projectPath, folder: "/", caption: "", mcpAccess: false,
        schemaName: "shop", exists: true, ...changes,
    };
};

interface IFake {
    tree: MsmProjectsTreeProvider;
    updates: Array<[string, IMsmProjectDetails]>;
    projects: IMsmListedProject[];
}

const setUp = (projects: IMsmListedProject[]): IFake => {
    const updates: Array<[string, IMsmProjectDetails]> = [];
    const api = {
        listProjects: () => { return Promise.resolve(projects); },
        listSchemaDiagrams: (path: string) => {
            return Promise.resolve(path.endsWith("shop.msm.project")
                ? { schemaDefinition: { tables: 2, current: false },
                    diagrams: [{ name: "Main", figures: 3, connections: 1 }] }
                : { diagrams: [] });
        },
        getSchemaDiagrams: () => {
            return Promise.resolve([{
                name: "schema_definition", format: "msm-schema/1",
                document: JSON.stringify({
                    format: "msm-schema/1", schema: "shop",
                    tables: [
                        { name: "orders", columns: [] },
                        { name: "Customer", columns: [],
                            options: { comment: "Who buys" } },
                    ],
                    views: [{ name: "customer_ids" }],
                    routines: [
                        { name: "count_orders", kind: "function" },
                        { name: "tidy" },
                    ],
                    triggers: [{ name: "orders_bi", timing: "BEFORE",
                        events: ["INSERT"], table: "orders" }],
                    events: [{ name: "purge", schedule: "EVERY 1 DAY",
                        comment: "Old rows" }],
                    sequences: [{ name: "order_no" }],
                }),
            }]);
        },
        // The listing carries the versions: no project is read for them.
        projectInformation: () => {
            throw new Error("projectInformation is not to be called");
        },
        updateProject: (path: string, details: IMsmProjectDetails) => {
            updates.push([path, details]);
            const project = projects.find((entry) => {
                return entry.projectPath === path;
            })!;
            Object.assign(project, details);

            return Promise.resolve(project);
        },
    } as unknown as IMsmApi;
    const tree = new MsmProjectsTreeProvider({
        resolveIcon,
        msmApi: () => { return Promise.resolve(api); },
        log: () => { /* not looked at */ },
    });

    return { tree, updates, projects };
};

/**
 * @param error What listing the projects fails with.
 *
 * @returns A view whose listing fails so.
 */
const treeFailing = (error: Error): MsmProjectsTreeProvider => {
    return new MsmProjectsTreeProvider({
        resolveIcon,
        msmApi: () => {
            return Promise.resolve({
                listProjects: () => { return Promise.reject(error); },
            } as unknown as IMsmApi);
        },
        log: () => { /* not looked at */ },
    });
};

const labels = (fake: IFake, nodes: MsmProjectsNode[]): string[] => {
    return nodes.map((node) => {
        return String(fake.tree.getTreeItem(node).label);
    });
};

describe("the MSM Projects view", () => {
    let root: string;

    beforeEach(() => {
        resetVscodeMock();
        root = mkdtempSync(join(tmpdir(), "msm-tree-"));
    });

    it("shows the folders first, then the projects at the top level",
        async () => {
            const fake = setUp([
                listed("/p/b.msm.project", { schemaName: "beta" }),
                listed("/p/a.msm.project", { caption: "Alpha" }),
                listed("/p/c.msm.project", { folder: "/Shop/Prod" }),
            ]);
            await fake.tree.newFolder("/Archive");

            const roots = await fake.tree.getChildren();
            expect(labels(fake, roots)).toEqual(
                ["Archive", "Shop", "Alpha", "beta"]);
            expect((roots[0] as IMsmFolderNode).empty).toBe(true);
            expect(fake.tree.getTreeItem(roots[0]).contextValue)
                .toBe("mariadbMsmFolder.empty");
            expect(fake.tree.getTreeItem(roots[1]).contextValue)
                .toBe("mariadbMsmFolder");

            const shop = await fake.tree.getChildren(roots[1]);
            const [prod] = shop;
            expect(labels(fake, await fake.tree.getChildren(prod)))
                .toEqual(["shop"]);
            expect(await fake.tree.folders())
                .toEqual(["/Archive", "/Shop", "/Shop/Prod"]);
        });

    it("describes a project by its development version, and MCP where "
        + "LLMs may work on it, as a connection's row says MCP", async () => {
        const fake = setUp([
            listed("/p/open.msm.project",
                { mcpAccess: true, developmentVersion: "0.0.3" }),
            listed("/p/kept.msm.project", { developmentVersion: "0.0.3" }),
            listed("/p/gone.msm.project", { exists: false }),
            // The server could not read its version.
            listed("/p/broken.msm.project", { mcpAccess: true }),
        ]);
        const nodes = await fake.tree.getChildren() as IMsmProjectNode[];
        const byPath = (path: string): IMsmProjectNode => {
            return nodes.find((node) => {
                return node.project.projectPath === path;
            })!;
        };

        expect(projectDescription(byPath("/p/open.msm.project")))
            .toBe("0.0.3 · MCP");
        expect(projectDescription(byPath("/p/kept.msm.project")))
            .toBe("0.0.3");
        expect(projectDescription(byPath("/p/gone.msm.project")))
            .toBe("missing");
        // Its version could not be read: only what is known.
        expect(projectDescription(byPath("/p/broken.msm.project")))
            .toBe("MCP");

        const gone = fake.tree.getTreeItem(byPath("/p/gone.msm.project"));
        expect(gone.contextValue).toBe("mariadbMsmProject.missing");
        expect(gone.collapsibleState).toBe(TreeItemCollapsibleState.None);
        const kept = fake.tree.getTreeItem(byPath("/p/kept.msm.project"));
        expect(kept.contextValue).toBe("mariadbMsmProject");
        expect(kept.collapsibleState)
            .toBe(TreeItemCollapsibleState.Collapsed);
        expect(String(kept.tooltip)).toMatch(/LLMs have no MCP access/u);
        expect(String(kept.tooltip)).toMatch(/Development version 0\.0\.3/u);
        expect(String(fake.tree.getTreeItem(
            byPath("/p/broken.msm.project")).tooltip))
            .not.toMatch(/Development version/u);
    });

    it("names a project by its caption, schema, else its folder", () => {
        expect(projectLabel(listed("/p/x.msm.project", { caption: "Shop" })))
            .toBe("Shop");
        expect(projectLabel(listed("/p/x.msm.project")))
            .toBe("shop");
        const { schemaName: _left, ...unread } = listed("/p/x.msm.project");
        expect(projectLabel(unread)).toBe("x");
    });

    it("draws a project's color with the connections' decoration",
        async () => {
            const fake = setUp([listed("/p/a.msm.project", { color: "blue" })]);
            const [node] = await fake.tree.getChildren();

            const uri = fake.tree.getTreeItem(node).resourceUri;
            expect(uri?.scheme).toBe("mariadb-connection");
            expect(uri?.path).toBe("/blue/msmProject");
        });

    it("expands a project into its files, which open on a click",
        async () => {
            const project = makeProject(root, "shop");
            const fake = setUp([listed(project)]);
            const [node] = await fake.tree.getChildren();

            const [, ...files] = await fake.tree.getChildren(node) as
                IMsmFileNode[];
            expect(labels(fake, files))
                .toEqual(["development", "msm.project.json"]);
            const folder = fake.tree.getTreeItem(files[0]);
            expect(folder.collapsibleState)
                .toBe(TreeItemCollapsibleState.Collapsed);
            expect(folder.command).toBeUndefined();

            const file = fake.tree.getTreeItem(files[1]);
            expect(file.resourceUri?.fsPath)
                .toBe(join(project, "msm.project.json"));
            expect(file.command).toMatchObject({ command: "vscode.open" });

            expect(labels(fake, await fake.tree.getChildren(files[0])))
                .toEqual(["shop_next.sql"]);
        });

    it("shows a project's schema first, with the Connections view's rows",
        async () => {
            const project = makeProject(root, "shop");
            const fake = setUp([listed(project)]);
            const [node] = await fake.tree.getChildren();
            const [schema] = await fake.tree.getChildren(node);

            const item = fake.tree.getTreeItem(schema);
            expect(item.label).toBe("shop");
            expect(item.contextValue).toBe("mariadbMsmSchema");
            expect(String((item.iconPath as { light: Uri }).light.path))
                .toBe("/ext/images/light/schema.svg");
            expect(item.description).toBe("snapshot older than the script");
            const rows = await fake.tree.getChildren(schema);
            expect(rows.map((row) => {
                return fake.tree.getTreeItem(row).label;
            })).toEqual(["Diagrams", "Tables", "Views", "Functions",
                "Procedures", "Sequences", "Triggers", "Events"]);
            expect(fake.tree.getTreeItem(rows[1]).contextValue)
                .toBe("mariadbMsmObjectGroup.table");
        });

    it("lists the script's objects as msm's snapshot has them, by name",
        async () => {
            const project = makeProject(root, "shop");
            const fake = setUp([listed(project)]);
            const [node] = await fake.tree.getChildren();
            const [schema] = await fake.tree.getChildren(node);
            const [, tables, views, functions, procedures] =
                await fake.tree.getChildren(schema);
            const names = async (group: MsmProjectsNode) => {
                return (await fake.tree.getChildren(group)).map((row) => {
                    return fake.tree.getTreeItem(row).label;
                });
            };

            expect(await names(tables)).toEqual(["Customer", "orders"]);
            expect(await names(views)).toEqual(["customer_ids"]);
            expect(await names(functions)).toEqual(["count_orders"]);
            // A routine without a kind is a procedure.
            expect(await names(procedures)).toEqual(["tidy"]);
            const [, , , , , sequences, triggers, events] =
                await fake.tree.getChildren(schema);
            expect(await names(sequences)).toEqual(["order_no"]);
            expect(await names(triggers)).toEqual(["orders_bi"]);
            expect(await names(events)).toEqual(["purge"]);
            const [purge] = await fake.tree.getChildren(events);
            expect(fake.tree.getTreeItem(purge).tooltip).toBe("Old rows");
            const [customer] = await fake.tree.getChildren(tables);
            expect(customer).toMatchObject({ kind: "object", projectPath:
                project, schema: "shop", objectType: "table",
                name: "Customer", comment: "Who buys" });
            const item = fake.tree.getTreeItem(customer);
            expect(item.contextValue).toBe("mariadbMsmObject.table");
            expect(item.tooltip).toBe("Who buys");
        });

    it("lists a project's diagrams first in its schema, which open on a "
        + "double-click", async () => {
            const project = makeProject(root, "shop");
            const fake = setUp([listed(project)]);
            const [node] = await fake.tree.getChildren();
            const [schema] = await fake.tree.getChildren(node);
            const [diagrams] = await fake.tree.getChildren(schema);

            const folder = fake.tree.getTreeItem(diagrams);
            expect(folder.label).toBe("Diagrams");
            expect(folder.contextValue).toBe("mariadbMsmDiagrams");
            const rows = await fake.tree.getChildren(diagrams);
            expect(rows).toEqual([{ kind: "diagram", projectPath: project,
                name: "Main", figures: 3 }]);
            const row = fake.tree.getTreeItem(rows[0]);
            expect(row.description).toBe("3 figures");
            expect(row.contextValue).toBe("mariadbMsmDiagram");
            expect(row.command).toEqual({
                command: MSM_DIAGRAM_CLICK_COMMAND,
                title: "Open Diagram",
                arguments: [rows[0]],
            });
            expect(await fake.tree.getChildren(rows[0])).toEqual([]);
            expect(fake.tree.getParent(rows[0])).toBeUndefined();
        });

    it("shows no diagrams where the MariaDB Shell has none", async () => {
        const logs: string[] = [];
        const tree = new MsmProjectsTreeProvider({
        resolveIcon,
            msmApi: () => {
                return Promise.resolve({
                    listSchemaDiagrams: () => {
                        return Promise.reject(new McpToolError(
                            "msm.list_schema_diagrams",
                            "Unknown tool: msm.list_schema_diagrams"));
                    },
                } as unknown as IMsmApi);
            },
            log: (message) => { logs.push(message); },
        });

        expect(await tree.getChildren({ kind: "diagrams",
            projectPath: "/p/shop.msm.project" })).toEqual([]);
        expect(logs[0]).toContain("a newer version is needed");
    });

    it("carries the tables, views and routines dragged to a diagram",
        async () => {
            const project = makeProject(root, "shop");
            const fake = setUp([listed(project)]);
            const [node] = await fake.tree.getChildren();
            const [schema] = await fake.tree.getChildren(node);
            const [, tables, , functions] = await fake.tree.getChildren(schema);
            const [customer] = await fake.tree.getChildren(tables);
            const [count] = await fake.tree.getChildren(functions);
            const transfer = new DataTransfer();

            fake.tree.handleDrag([tables, customer, count], transfer as never);

            expect(fake.tree.dragMimeTypes).toContain("text/uri-list");
            expect(parseSchemaObjectUris(String(
                transfer.get("text/uri-list")?.value))).toEqual([
                { place: { projectPath: project },
                    ref: { type: "table", name: "Customer" } },
                { place: { projectPath: project },
                    ref: { type: "function", name: "count_orders" } },
            ]);
            // Nothing the view files elsewhere.
            expect(transfer.get(MSM_PROJECTS_DRAG_MIME)).toBeUndefined();
        });

    it("moves a dropped project into the folder dropped on", async () => {
        const fake = setUp([
            listed("/p/a.msm.project"),
            listed("/p/b.msm.project", { folder: "/Shop" }),
        ]);
        const roots = await fake.tree.getChildren();
        const shop = roots[0];
        const a = roots[1];
        const transfer = new DataTransfer();
        fake.tree.handleDrag([a], transfer as never);

        await fake.tree.handleDrop(shop, transfer as never);

        expect(fake.updates).toEqual([["/p/a.msm.project", { folder: "/Shop" }]]);
    });

    it("moves a folder whole, and ignores what it did not put there",
        async () => {
            const fake = setUp([
                listed("/p/a.msm.project", { folder: "/Shop" }),
                listed("/p/b.msm.project", { folder: "/Shop/Prod" }),
                listed("/p/c.msm.project", { folder: "/Archive" }),
            ]);
            await fake.tree.folderColors.set("/Shop", "red");
            const roots = await fake.tree.getChildren();
            const [archive, shop] = roots;

            const stranger = new DataTransfer();
            stranger.set(MSM_PROJECTS_DRAG_MIME,
                new DataTransferItem("not rows"));
            await fake.tree.handleDrop(archive, stranger as never);
            expect(fake.updates).toEqual([]);

            const transfer = new DataTransfer();
            fake.tree.handleDrag([shop], transfer as never);
            await fake.tree.handleDrop(archive, transfer as never);

            expect(fake.updates).toEqual([
                ["/p/a.msm.project", { folder: "/Archive/Shop" }],
                ["/p/b.msm.project", { folder: "/Archive/Shop/Prod" }],
            ]);
            expect(fake.tree.folderColors.get("/Archive/Shop")).toBe("red");
        });

    it("renames a folder by filing its projects anew", async () => {
        const fake = setUp([listed("/p/a.msm.project", { folder: "/Shop" })]);
        const [shop] = await fake.tree.getChildren();

        await fake.tree.renameFolder(shop as IMsmFolderNode, "Store");

        expect(fake.updates).toEqual([["/p/a.msm.project", { folder: "/Store" }]]);
    });

    it("keeps a collapsed folder collapsed", async () => {
        const fake = setUp([listed("/p/a.msm.project", { folder: "/Shop" })]);
        const [shop] = await fake.tree.getChildren();

        await fake.tree.collapsed(shop);
        expect(fake.tree.getTreeItem(shop).collapsibleState)
            .toBe(TreeItemCollapsibleState.Collapsed);
        await fake.tree.expanded(shop);
        expect(fake.tree.getTreeItem(shop).collapsibleState)
            .toBe(TreeItemCollapsibleState.Expanded);
    });

    it("walks up from a project to its folders, for reveal", () => {
        const fake = setUp([]);
        const node: IMsmProjectNode = {
            kind: "project",
            project: listed("/p/a.msm.project", { folder: "/Shop/Prod" }),
        };

        const parent = fake.tree.getParent(node) as IMsmFolderNode;
        expect(parent.path).toBe("/Shop/Prod");
        expect((fake.tree.getParent(parent) as IMsmFolderNode).path)
            .toBe("/Shop");
        expect(fake.tree.getParent({
            kind: "project", project: listed("/p/b.msm.project"),
        })).toBeUndefined();
    });

    it("files a project by its folder in any spelling, and offers the "
        + "folders made here before a listing", async () => {
        const fake = setUp([listed("/p/a.msm.project", { folder: "Shop/" })]);
        await fake.tree.newFolder("/Archive");
        // No listing yet: a dialog asking does not start the server.
        expect(await fake.tree.folders()).toEqual(["/Archive"]);

        const roots = await fake.tree.getChildren();
        const shop = roots[1] as IMsmFolderNode;
        expect(shop.path).toBe("/Shop");
        expect(shop.empty).toBe(false);
        expect(labels(fake, await fake.tree.getChildren(shop)))
            .toEqual(["shop"]);
        expect(await fake.tree.folders()).toEqual(["/Archive", "/Shop"]);
    });

    for (const tool of ["msm.list_projects", "msm_list_projects"]) {
        it(`asks for a newer MariaDB Shell where ${tool} is unknown to it`,
            async () => {
                const tree = treeFailing(new McpToolError(tool,
                    `Unknown tool: ${tool}`));

                expect(await tree.getChildren()).toEqual([]);
                expect(tree.state).toBe("unsupported");
                expect(contextKeys.get(MSM_PROJECTS_VIEW_STATE_CONTEXT_KEY))
                    .toBe("unsupported");
                // The welcome content says it; no error message on top.
                expect(errorMessages).toEqual([]);
            });
    }

    it("says in its welcome content that the listing failed", async () => {
        const tree = treeFailing(new McpToolError("msm.list_projects",
            "The list could not be read."));

        expect(await tree.getChildren()).toEqual([]);
        expect(contextKeys.get(MSM_PROJECTS_VIEW_STATE_CONTEXT_KEY))
            .toBe("failed");
        expect(errorMessages).toEqual([]);
    });

    it("waits for the MariaDB Shell's startup in its welcome content", () => {
        const tree = new MsmProjectsTreeProvider({
        resolveIcon,
            msmApi: () => { return new Promise(() => { /* never */ }); },
            status: {
                phase: "installing",
                onDidChangePhase: () => { return () => { /* nothing */ }; },
            } as unknown as IServerStatus,
            log: () => { /* not looked at */ },
        });

        expect(tree.state).toBe("installing");
        expect(contextKeys.get(MSM_PROJECTS_VIEW_STATE_CONTEXT_KEY))
            .toBe("installing");
    });

    it("notes a listing for the welcome content", async () => {
        const fake = setUp([]);

        expect(await fake.tree.getChildren()).toEqual([]);
        expect(contextKeys.get(MSM_PROJECTS_VIEW_STATE_CONTEXT_KEY))
            .toBe("listed");
    });
});
