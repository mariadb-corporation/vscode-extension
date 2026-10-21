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
