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

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { IToolCaller } from "../../mcp/mariaDbApi.js";
import {
    MSM_DEPLOY_TIMEOUT_MS,
    MSM_LICENSES,
    MsmApi,
} from "../../mcp/msmApi.js";
import type { IToolResult } from "../../mcp/protocol.js";

interface ICall {
    name: string;
    args: Record<string, unknown>;
    timeoutMs?: number;
}

const PROJECT = "/work/sakila.msm.project";

/**
 * The plugin's license templates, in a mariadb-shell-plugins checkout next
 * to this repository (or `MARIADB_SHELL_PLUGINS`), as the UI tests find it.
 */
const LICENSE_TEMPLATES = join(process.env.MARIADB_SHELL_PLUGINS
    ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..",
        "mariadb-shell-plugins"), "msm_plugin", "templates", "license");

/*
 * The answers below are what a `mcp start-server --gui` with this
 * repository's msm_plugin answered with, word for word but the paths.
 */

const INFO = {
    copyrights: [{ holder: "Ada", yearOfCreation: "2026", tracksUpdates: true }],
    copyrightHolder: "Ada", customLicense: "", license: "MIT",
    schemaDependencies: [], schemaName: "sakila", schemaFileName: "sakila",
    yearOfCreation: "2026", currentDevelopmentVersion: "0.0.1",
    lastReleasedVersion: null,
    schemaDevelopmentFilePath: `${PROJECT}/development/sakila_next.sql`,
};

const scalar = (value: string): IToolResult => {
    return {
        content: [{ type: "text", text: value }],
        structuredContent: { result: value }, isError: false,
    };
};

/** A list of `[major, minor, patch]`: its content is flattened. */
const versions = (...list: number[][]): IToolResult => {
    return {
        content: list.flat().map((part) => {
            return { type: "text", text: String(part) };
        }),
        structuredContent: { result: list }, isError: false,
    };
};

const failure = (message: string): IToolResult => {
    return { content: [{ type: "text", text: message }], isError: true };
};

const createCaller = (
    answers: Record<string, IToolResult> = {},
): IToolCaller & { calls: ICall[] } => {
    const calls: ICall[] = [];

    return {
        calls,
        callTool: (name, args, timeoutMs) => {
            calls.push({ name, args, ...(timeoutMs === undefined
                ? {} : { timeoutMs }) });

            return Promise.resolve(answers[name] ?? scalar("ok"));
        },
    };
};

describe("MsmApi", () => {
    it("creates a project with the server's names, sending only what is set",
        async () => {
            const caller = createCaller({
                "msm.create_project": scalar(PROJECT),
            });

            expect(await new MsmApi(caller).createProject({
                schemaName: "sakila", targetPath: "/work",
                copyrightHolder: "Ada", license: "MIT",
                allowSpecialChars: false, overwriteExisting: false,
            })).toBe(PROJECT);
            expect(caller.calls).toEqual([{
                name: "msm.create_project",
                args: {
                    schema_name: "sakila", target_path: "/work",
                    copyright_holder: "Ada", license: "MIT",
                },
            }]);
        });

    it("files a new project in the MSM Projects list as it is made",
        async () => {
            const caller = createCaller({
                "msm.create_project": scalar(PROJECT),
            });

            await new MsmApi(caller).createProject({
                schemaName: "sakila", targetPath: "/work",
                folder: "/Shop", caption: "Prod", color: "green",
            });

            expect(caller.calls[0].args).toEqual({
                schema_name: "sakila", target_path: "/work",
                folder: "/Shop", caption: "Prod", color: "green",
            });
        });

    it("sends the flags of a create that are ticked", async () => {
        const caller = createCaller({ "msm.create_project": scalar(PROJECT) });

        await new MsmApi(caller).createProject({
            schemaName: "my schema", targetPath: "/new",
            overwriteExisting: true, allowSpecialChars: true,
            enforceTargetPath: true,
        });

        expect(caller.calls[0].args).toEqual({
            schema_name: "my schema", target_path: "/new",
            overwrite_existing: true, allow_special_chars: true,
            enforce_target_path: true,
        });
    });

    it("reads the project information as the dict it is", async () => {
        const caller = createCaller({
            "msm.get_project_information": {
                content: [{ type: "text", text: JSON.stringify(INFO, null, 2) }],
                structuredContent: { result: INFO }, isError: false,
            },
        });

        expect(await new MsmApi(caller).projectInformation(PROJECT))
            .toEqual(INFO);
        expect(caller.calls[0]).toEqual({
            name: "msm.get_project_information",
            args: { schema_project_path: PROJECT },
        });
    });

    it("reads released versions from the structured result, not the text",
        async () => {
            const caller = createCaller({
                "msm.get_released_versions": versions([1, 0, 0], [1, 10, 2]),
            });

            expect(await new MsmApi(caller).releasedVersions(PROJECT))
                .toEqual(["1.0.0", "1.10.2"]);
        });

    it("reads no released versions from an empty answer", async () => {
        const caller = createCaller({
            "msm.get_released_versions": {
                content: [], structuredContent: { result: [] }, isError: false,
            },
        });

        expect(await new MsmApi(caller).releasedVersions(PROJECT)).toEqual([]);
    });

    it("reads no versions where the server sent None", async () => {
        const caller = createCaller({
            "msm.get_deployment_script_versions": {
                content: [], structuredContent: { result: null }, isError: false,
            },
        });

        expect(await new MsmApi(caller).deploymentScriptVersions(PROJECT))
            .toEqual([]);
    });

    it("reads the deployment script versions", async () => {
        const caller = createCaller({
            "msm.get_deployment_script_versions": versions([1, 0, 0]),
        });

        expect(await new MsmApi(caller).deploymentScriptVersions(PROJECT))
            .toEqual(["1.0.0"]);
        expect(caller.calls[0].args).toEqual({ schema_project_path: PROJECT });
    });

    it("reads versions from the text items where no structured result came",
        async () => {
            const caller = createCaller({
                "msm.get_released_versions": {
                    content: [{ type: "text", text: "[1, 0, 0]" }],
                },
            });

            expect(await new MsmApi(caller).releasedVersions(PROJECT))
                .toEqual(["1.0.0"]);
        });

    it("prepares a release and answers with the files written", async () => {
        const file = `${PROJECT}/releases/versions/sakila_1.0.0.sql`;
        const caller = createCaller({
            "msm.prepare_release": {
                content: [{ type: "text", text: file }],
                structuredContent: { result: [file] }, isError: false,
            },
        });

        expect(await new MsmApi(caller).prepareRelease({
            projectPath: PROJECT, version: "1.0.0", nextVersion: "1.0.1",
        })).toEqual([file]);
        expect(caller.calls[0]).toEqual({
            name: "msm.prepare_release",
            args: {
                schema_project_path: PROJECT, version: "1.0.0",
                next_version: "1.0.1",
            },
        });
    });

    it("sends a release's flags only when ticked", async () => {
        const caller = createCaller({
            "msm.prepare_release": {
                content: [], structuredContent: { result: [] }, isError: false,
            },
        });

        await new MsmApi(caller).prepareRelease({
            projectPath: PROJECT, version: "1.0.0", nextVersion: "1.0.0",
            allowToStayOnSameVersion: true, overwriteExisting: true,
        });

        expect(caller.calls[0].args).toMatchObject({
            allow_to_stay_on_same_version: true, overwrite_existing: true,
        });
    });

    it("surfaces a refused release as the server's message", async () => {
        const caller = createCaller({
            "msm.prepare_release": failure("Error executing tool "
                + "msm.prepare_release: The file /x already exists. Please "
                + "explicitly allow to replace existing files."),
        });

        await expect(new MsmApi(caller).prepareRelease({
            projectPath: PROJECT, version: "1.0.0", nextVersion: "1.0.1",
        })).rejects.toThrow("already exists");
    });

    it("generates a deployment script and answers with its path", async () => {
        const script =
            `${PROJECT}/releases/deployment/sakila_deployment_1.0.0.sql`;
        const caller = createCaller({
            "msm.generate_deployment_script": scalar(script),
        });

        expect(await new MsmApi(caller).generateDeploymentScript({
            projectPath: PROJECT, version: "1.0.0", overwriteExisting: true,
        })).toBe(script);
        expect(caller.calls[0].args).toEqual({
            schema_project_path: PROJECT, version: "1.0.0",
            overwrite_existing: true,
        });
    });

    it("deploys on a connection, with the time a deployment takes", async () => {
        const caller = createCaller({
            "msm.deploy_schema": scalar("Schema sakila 1.0.0 deployed."),
        });

        expect(await new MsmApi(caller).deploySchema({
            projectPath: PROJECT, connectionId: "c1", version: "1.0.0",
            backup: true, backupDirectory: "/backups",
        })).toBe("Schema sakila 1.0.0 deployed.");
        expect(caller.calls).toEqual([{
            name: "msm.deploy_schema",
            args: {
                connection_id: "c1", schema_project_path: PROJECT,
                version: "1.0.0", backup: true, backup_directory: "/backups",
            },
            timeoutMs: MSM_DEPLOY_TIMEOUT_MS,
        }]);
    });

    it("deploys the newest version without a backup when nothing more is said",
        async () => {
            const caller = createCaller();

            await new MsmApi(caller).deploySchema({
                projectPath: PROJECT, connectionId: "c1",
            });

            expect(caller.calls[0].args).toEqual({
                connection_id: "c1", schema_project_path: PROJECT,
            });
        });

    it("lists the MSM Projects list, in the extension's names", async () => {
        const listed = [
            {
                project_path: PROJECT, folder: "/Shop", caption: "Prod",
                color: "green", mcp_access: false, schema_name: "sakila",
                exists: true, development_version: "1.0.1",
            },
            {
                project_path: "/work/gone.msm.project", folder: "/",
                caption: "", color: "teal", schema_name: null, exists: false,
                development_version: null,
            },
        ];
        const caller = createCaller({
            "msm.list_projects": {
                content: listed.map((entry) => {
                    return { type: "text", text: JSON.stringify(entry) };
                }),
                structuredContent: { result: listed }, isError: false,
            },
        });

        expect(await new MsmApi(caller).listProjects()).toEqual([
            {
                projectPath: PROJECT, folder: "/Shop", caption: "Prod",
                color: "green", mcpAccess: false, schemaName: "sakila",
                exists: true, developmentVersion: "1.0.1",
            },
            // A color it does not know is dropped; a server that predates
            // mcp_access gave every project access; a version that could
            // not be read is left out.
            {
                projectPath: "/work/gone.msm.project", folder: "/",
                caption: "", mcpAccess: true, exists: false,
            },
        ]);
        expect(caller.calls).toEqual([{ name: "msm.list_projects", args: {} }]);
    });

    it("adds, updates and removes a project, sending only what is set",
        async () => {
            const entry = {
                project_path: PROJECT, folder: "/", caption: "", color: "",
                mcp_access: false, schema_name: "sakila", exists: true,
            };
            const answer: IToolResult = {
                content: [{ type: "text", text: JSON.stringify(entry) }],
                isError: false,
            };
            const caller = createCaller({
                "msm.add_project": answer,
                "msm.update_project": answer,
                "msm.remove_project": scalar(PROJECT),
            });
            const api = new MsmApi(caller);

            expect((await api.addProject(PROJECT)).mcpAccess).toBe(false);
            await api.addProject(PROJECT, { folder: "/Shop" });
            await api.updateProject(PROJECT, {
                caption: "", color: "red", mcpAccess: true,
            });
            expect(await api.removeProject(PROJECT)).toBe(PROJECT);
            await api.setDevelopmentVersion(PROJECT, "0.1.0");

            expect(caller.calls.map((call) => {
                return [call.name, call.args];
            })).toEqual([
                ["msm.add_project", { project_path: PROJECT }],
                ["msm.add_project", { project_path: PROJECT, folder: "/Shop" }],
                ["msm.update_project", {
                    project_path: PROJECT, new_caption: "", new_color: "red",
                    new_mcp_access: true,
                }],
                ["msm.remove_project", { project_path: PROJECT }],
                ["msm.set_development_version", {
                    schema_project_path: PROJECT, version: "0.1.0",
                }],
            ]);
        });

    it("creates a project open to LLMs only when asked", async () => {
        const caller = createCaller({ "msm.create_project": scalar(PROJECT) });

        await new MsmApi(caller).createProject({
            schemaName: "s", targetPath: "/w", mcpAccess: true,
        });

        expect(caller.calls[0].args).toMatchObject({ mcp_access: true });
    });

    it("lists, reads and saves a project's schema diagrams", async () => {
        const structured = (result: unknown): IToolResult => {
            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
                structuredContent: { result }, isError: false,
            };
        };
        const rows = [{ name: "Main", format: "msm-diagram/1",
            document: { name: "Main" } }];
        const caller = createCaller({
            "msm.list_schema_diagrams": structured({
                schema_definition: { tables: 2, current: false },
                diagrams: [{ name: "Main", figures: 2, connections: 1 }],
            }),
            "msm.get_schema_diagrams": structured(rows),
            "msm.get_schema_diagram_image": scalar("data:image/png;base64,AA"),
            "msm.set_schema_diagram": structured(["/p/a.sql"]),
        });
        const api = new MsmApi(caller);

        expect(await api.listSchemaDiagrams(PROJECT)).toEqual({
            schemaDefinition: { tables: 2, current: false },
            diagrams: [{ name: "Main", figures: 2, connections: 1 }],
        });
        expect(await api.getSchemaDiagrams(PROJECT)).toEqual(rows);
        await api.getSchemaDiagrams(PROJECT, "Main");
        expect(await api.getSchemaDiagramImage(PROJECT, "Main", "logo"))
            .toBe("data:image/png;base64,AA");
        const document = { format: "msm-diagram/1" as const, name: "Main",
            width: 1, height: 1, layers: [], figures: [], connections: [] };
        expect(await api.setSchemaDiagram(PROJECT, document))
            .toEqual(["/p/a.sql"]);
        expect(caller.calls.map((call) => { return [call.name, call.args]; }))
            .toEqual([
                ["msm.list_schema_diagrams", { schema_project_path: PROJECT }],
                ["msm.get_schema_diagrams", { schema_project_path: PROJECT }],
                ["msm.get_schema_diagrams", { schema_project_path: PROJECT,
                    diagram: "Main" }],
                ["msm.get_schema_diagram_image", { diagram: "Main",
                    figure_id: "logo", schema_project_path: PROJECT }],
                ["msm.set_schema_diagram", { document,
                    schema_project_path: PROJECT }],
            ]);
    });

    it("reads a project without diagrams, a schema edit's result, and "
        + "makes an empty diagram",
        async () => {
            const structured = (result: unknown): IToolResult => {
                return {
                    content: [{ type: "text", text: JSON.stringify(result) }],
                    structuredContent: { result }, isError: false,
                };
            };
            const caller = createCaller({
                "msm.list_schema_diagrams": structured({
                    schema_definition: null, diagrams: [],
                }),
                "msm.remove_schema_diagram": structured(["/p/a.sql"]),
                "msm.rename_schema_diagram": structured(["/p/a.sql"]),
                "msm.create_schema_diagram": structured({
                    name: "Diagram 1", figures: 0, connections: 0,
                    files: ["/p/a.sql"],
                }),
                "msm.edit_schema": structured({
                    rows: [], files: ["/p/a.sql"],
                    migration: ["RENAME TABLE `a` TO `b`"],
                    migration_file: null,
                    notes: [{ kind: "string-reference", message: "Look." }],
                }),
            });
            const api = new MsmApi(caller);
            const edits = [{ op: "rename_table", table: "a", new_name: "b" }];

            expect(await api.listSchemaDiagrams(PROJECT))
                .toEqual({ diagrams: [] });
            expect(await api.editSchema(PROJECT, edits, "sha256:x")).toEqual({
                rows: [], files: ["/p/a.sql"],
                migration: ["RENAME TABLE `a` TO `b`"],
                notes: [{ kind: "string-reference", message: "Look." }],
            });
            expect(caller.calls[1]).toEqual({ name: "msm.edit_schema",
                args: { edits, base_hash: "sha256:x",
                    schema_project_path: PROJECT } });

            // An empty diagram: no tables, which msm would default to all.
            await api.createEmptySchemaDiagram(PROJECT, "Diagram 1");
            expect(caller.calls[2]).toEqual({
                name: "msm.create_schema_diagram",
                args: { name: "Diagram 1", tables: [],
                    schema_project_path: PROJECT } });

            // Removed and renamed by name; msm answers the files written.
            expect(await api.removeSchemaDiagram(PROJECT, "Main"))
                .toEqual(["/p/a.sql"]);
            expect(caller.calls[3]).toEqual({
                name: "msm.remove_schema_diagram",
                args: { name: "Main", schema_project_path: PROJECT } });
            expect(await api.renameSchemaDiagram(PROJECT, "Main", "Overview"))
                .toEqual(["/p/a.sql"]);
            expect(caller.calls[4]).toEqual({
                name: "msm.rename_schema_diagram",
                args: { name: "Main", new_name: "Overview",
                    schema_project_path: PROJECT } });
        });

    it("reads and writes a table's online ALTER TABLE, and starts one",
        async () => {
            const structured = (result: unknown): IToolResult => {
                return {
                    content: [{ type: "text", text: JSON.stringify(result) }],
                    structuredContent: { result }, isError: false,
                };
            };
            const defaults = { maxRebuildBytes: 10, galeraMaxBytes: 5,
                nboLock: null, maxLockedBytes: null, lockWait: 5,
                maxRetries: 10 };
            const caller = createCaller({
                "msm.get_online_alter_settings": structured({ defaults,
                    setting: { enabled: true }, table: "orders",
                    enabled: true, options: defaults }),
                "msm.set_online_alter_table": structured(["/p/msm.project.json"]),
                "msm.set_online_alter_defaults": structured(
                    ["/p/msm.project.json"]),
                "msm.get_online_alter_defaults": structured(defaults),
                "msm.online_alter_table": structured({ task_id: "t1",
                    status: "pending" }),
            });
            const api = new MsmApi(caller);

            expect((await api.getOnlineAlterSettings(PROJECT, "orders"))
                .defaults).toEqual(defaults);
            expect(await api.setOnlineAlterTable(PROJECT, "orders", null))
                .toEqual(["/p/msm.project.json"]);
            expect((await api.getOnlineAlterSettings(PROJECT)).setting)
                .toEqual({ enabled: true });
            expect(await api.setOnlineAlterDefaults(PROJECT,
                { lockWait: 9 })).toEqual(["/p/msm.project.json"]);
            expect(await api.onlineAlterDefaults()).toEqual(defaults);
            expect(await api.onlineAlterTable("c1", "shop", "orders",
                "ADD COLUMN `q` INT", { lockWait: 9 }))
                .toEqual({ task_id: "t1", status: "pending" });
            expect(caller.calls.map((call) => {
                return [call.name, call.args];
            })).toEqual([
                ["msm.get_online_alter_settings", { table: "orders",
                    schema_project_path: PROJECT }],
                ["msm.set_online_alter_table", { table: "orders",
                    settings: null, schema_project_path: PROJECT }],
                ["msm.get_online_alter_settings",
                    { schema_project_path: PROJECT }],
                ["msm.set_online_alter_defaults", {
                    settings: { lockWait: 9 }, schema_project_path: PROJECT }],
                ["msm.get_online_alter_defaults", {}],
                ["msm.online_alter_table", { connection_id: "c1",
                    schema: "shop", table: "orders",
                    spec: "ADD COLUMN `q` INT", options: { lockWait: 9 } }],
            ]);
        });

    it("names the licenses the plugin ships templates for", () => {
        expect([...MSM_LICENSES].sort()).toEqual(
            ["BSD", "GPL-2.0", "MIT", "None"]);
    });

    // The server has no tool listing them, so a template added to the
    // plugin is to be added to MSM_LICENSES too.
    it.skipIf(!existsSync(LICENSE_TEMPLATES))(
        "names every license template of the plugin checkout", () => {
            const templates = readdirSync(LICENSE_TEMPLATES)
                .filter((file) => { return file.endsWith(".txt"); })
                .map((file) => { return file.slice(0, -4); }).sort();

            expect([...MSM_LICENSES].sort()).toEqual(templates);
        });
});
