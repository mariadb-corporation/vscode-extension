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

import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { posted } from "./setup.js";
import { MsmDialog } from "../src/MsmDialog.js";
import {
    createDefaults,
    deployDefaults,
    deploymentScriptDefaults,
    releaseDefaults,
    type IMsmConnectionChoice,
    type IMsmProjectContext,
} from "../../src/msm/msmFields.js";
import type {
    IMsmLoadMessage,
    MsmHostMessage,
} from "../../src/msm/msmProtocol.js";

let host: HTMLDivElement;

const PROJECT: IMsmProjectContext = {
    projectPath: "/work/sakila.msm.project",
    schemaName: "sakila",
    license: "MIT",
    copyrightHolders: ["Ada", "Bob"],
    currentDevelopmentVersion: "1.0.1",
    lastReleasedVersion: "1.0.0",
    releasedVersions: ["0.9.0", "1.0.0"],
    deploymentScriptVersions: ["0.9.0"],
    schemaDevelopmentFilePath: "/work/sakila.msm.project/development/sakila_next.sql",
};

const CONNECTIONS: IMsmConnectionChoice[] = [
    { uri: "mariadb://root@a:3306", label: "root@a:3306" },
    { uri: "mariadb://root@b:3306", label: "root@b:3306" },
];

const send = async (message: MsmHostMessage): Promise<void> => {
    await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data: message }));
        await Promise.resolve();
    });
};

const open = async (load: Omit<IMsmLoadMessage, "type">): Promise<void> => {
    await act(async () => {
        render(<MsmDialog />, host);
        await Promise.resolve();
    });
    await send({ type: "load", ...load });
};

const openCreate = (): Promise<void> => {
    return open({
        kind: "create", title: "New MSM Project",
        values: createDefaults("/work"),
        licenses: ["None", "BSD", "GPL-2.0", "MIT"],
    });
};

const openRelease = (project = PROJECT): Promise<void> => {
    return open({
        kind: "release", title: "Prepare Release - sakila", project,
        values: releaseDefaults(project),
    });
};

const button = (label: string): HTMLButtonElement => {
    const found = [...host.querySelectorAll("button")].find((node) => {
        return (node.textContent ?? "").trim() === label;
    });
    if (!found) {
        throw new Error(`No button '${label}'.`);
    }

    return found;
};

const click = async (label: string): Promise<void> => {
    await act(async () => {
        button(label).click();
        await Promise.resolve();
    });
};

const input = (name: string): HTMLInputElement => {
    return host.querySelector(`[name='${name}']`)!;
};

const change = async (name: string, value: string | boolean): Promise<void> => {
    await act(async () => {
        const element = input(name);
        if (typeof value === "boolean") {
            element.checked = value;
            element.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
            element.value = value;
            element.dispatchEvent(new Event(
                element.tagName === "SELECT" ? "change" : "input",
                { bubbles: true }));
        }
        await Promise.resolve();
    });
};

const submitted = (): unknown[] => {
    return posted.filter((message) => { return message.type === "submit"; });
};

const optionsOf = (name: string): string[] => {
    return [...host.querySelectorAll(`[name='${name}'] option`)]
        .map((option) => { return option.textContent ?? ""; });
};

beforeEach(() => {
    posted.length = 0;
    host = document.createElement("div");
    document.body.append(host);
});

afterEach(() => {
    render(null, host);
    host.remove();
});

describe("New MSM Project", () => {
    it("asks for the schema, the copyright and the license, and sends them",
        async () => {
            await openCreate();

            expect(posted[0]).toEqual({ type: "ready" });
            expect(host.querySelector("h1")?.textContent).toBe("New MSM Project");
            expect(input("targetPath").value).toBe("/work");
            expect(optionsOf("license")).toEqual(
                ["None", "BSD", "GPL-2.0", "MIT"]);

            await change("schemaName", "sakila");
            await change("copyrightHolder", "Ada");
            await change("license", "MIT");
            await click("Create");

            expect(submitted()).toEqual([{
                type: "submit",
                values: {
                    ...createDefaults("/work"), schemaName: "sakila",
                    copyrightHolder: "Ada", license: "MIT",
                },
            }]);
        });

    it("names the project folder the schema makes", async () => {
        await openCreate();
        expect(host.textContent).toContain("<schema>.msm.project");

        await change("schemaName", "sakila");
        expect(host.textContent).toContain("The project folder is "
            + "sakila.msm.project.");
    });

    it("marks a field once it is typed into, and sends nothing wrong",
        async () => {
            await openCreate();
            // Nothing marked before anything was typed.
            expect(host.querySelector(".invalid")).toBeNull();

            await change("schemaName", "123");
            expect(input("schemaName").getAttribute("aria-invalid")).toBe("true");
            expect(host.textContent).toContain("cannot be digits only");

            await change("copyrightHolder", "Ada");
            await click("Create");
            expect(submitted()).toEqual([]);
            expect(button("Create").disabled).toBe(true);

            await change("allowSpecialChars", true);
            expect(button("Create").disabled).toBe(false);
            await click("Create");
            expect(submitted()).toHaveLength(1);
        });

    it("marks every field missing once Create is pressed", async () => {
        await openCreate();
        await click("Create");

        expect(input("schemaName").getAttribute("aria-invalid")).toBe("true");
        expect(host.textContent).toContain("Enter the schema's name.");
        expect(submitted()).toEqual([]);
    });

    it("asks the extension to browse, and takes the folder it picked",
        async () => {
            await openCreate();
            await click("Browse...");
            expect(posted.at(-1)).toEqual({
                type: "browse", field: "targetPath", current: "/work",
            });

            await send({ type: "browsed", field: "targetPath", path: "/picked" });
            expect(input("targetPath").value).toBe("/picked");
        });

    it("shows the extension's problem beside its field until it is changed",
        async () => {
            await openCreate();
            await change("schemaName", "sakila");
            await change("copyrightHolder", "Ada");
            // The host's answer to Create.
            await click("Create");
            await send({ type: "error", field: "targetPath",
                message: "This folder does not exist." });

            expect(input("targetPath").getAttribute("aria-invalid")).toBe("true");
            expect(host.textContent).toContain("This folder does not exist.");

            await change("createTargetPath", true);
            expect(host.textContent).not.toContain("This folder does not exist.");
        });

    it("shows a failure, and a progress bar while it works", async () => {
        await openCreate();
        await send({ type: "busy", busy: true });

        expect(host.querySelector("[role='progressbar']")?.getAttribute(
            "aria-label")).toBe("Creating the project...");
        expect(button("Create").disabled).toBe(true);
        expect(button("Cancel").disabled).toBe(true);

        await send({ type: "busy", busy: false });
        await send({ type: "error", message: "Access denied" });
        expect(host.querySelector("[role='progressbar']")).toBeNull();
        expect(host.querySelector(".message.error")?.textContent)
            .toBe("Access denied");
    });

    it("cancels", async () => {
        await openCreate();
        await click("Cancel");

        expect(posted.at(-1)).toEqual({ type: "cancel" });
    });
});

describe("MSM Project Information", () => {
    const openInfo = (project = PROJECT): Promise<void> => {
        return open({
            kind: "info", title: "MSM Project Information - sakila", project,
            values: {},
        });
    };

    it("lists what the project's files say", async () => {
        await openInfo();

        const rows = [...host.querySelectorAll(".msm-info-row")].map((row) => {
            return [row.querySelector("dt")?.textContent,
                row.querySelector("dd")?.textContent];
        });
        expect(rows).toEqual([
            ["Schema", "sakila"],
            ["Project Folder", "/work/sakila.msm.project"],
            ["License", "MIT"],
            ["Copyright", "Ada, Bob"],
            ["Development Version", "1.0.1"],
            ["Last Release", "1.0.0"],
            ["Released Versions", "1.0.0, 0.9.0"],
            ["Deployment Scripts", "0.9.0"],
        ]);
    });

    it("goes on to the project's other dialogs and its script", async () => {
        await openInfo();

        await click("Open Development Script");
        expect(posted.at(-1)).toEqual({ type: "open", what: "developmentFile" });
        await click("Prepare Release...");
        expect(posted.at(-1)).toEqual({ type: "open", what: "release" });
        await click("Generate Deployment Script...");
        expect(posted.at(-1)).toEqual({ type: "open", what: "deploymentScript" });
        await click("Deploy Schema...");
        expect(posted.at(-1)).toEqual({ type: "open", what: "deploy" });
    });

    it("offers what a new project cannot do yet disabled", async () => {
        await openInfo({
            ...PROJECT, lastReleasedVersion: undefined, releasedVersions: [],
            deploymentScriptVersions: [],
        });

        expect(host.textContent).toContain("Not released yet");
        expect(button("Generate Deployment Script...").disabled).toBe(true);
        expect(button("Deploy Schema...").disabled).toBe(true);
        expect(button("Prepare Release...").disabled).toBe(false);
    });

    it("closes with its one button", async () => {
        await openInfo();
        expect(() => { return button("Cancel"); }).toThrow();

        await click("Close");
        expect(posted.at(-1)).toEqual({ type: "cancel" });
    });
});

describe("Prepare Release", () => {
    it("starts on the development version, the next one following it",
        async () => {
            await openRelease();

            expect(input("version").value).toBe("1.0.1");
            expect(input("nextVersion").value).toBe("1.0.2");
            expect(host.textContent).toContain("The last release was 1.0.0.");
            expect(host.textContent).toContain("/work/sakila.msm.project");

            await change("version", "1.1.0");
            expect(input("nextVersion").value).toBe("1.1.1");
        });

    it("leaves a next version that was typed in alone", async () => {
        await openRelease();
        await change("nextVersion", "2.0.0");
        await change("version", "1.1.0");

        expect(input("nextVersion").value).toBe("2.0.0");
    });

    it("sends the release", async () => {
        await openRelease();
        await click("Prepare Release");

        expect(submitted()).toEqual([{
            type: "submit",
            values: {
                version: "1.0.1", nextVersion: "1.0.2",
                allowToStayOnSameVersion: false, overwriteExisting: false,
            },
        }]);
    });

    it("asks before releasing a version again, beside its box", async () => {
        await openRelease();
        await change("version", "1.0.0");
        await click("Prepare Release");

        expect(submitted()).toEqual([]);
        expect(host.querySelector(".field-problem")?.textContent)
            .toContain("1.0.0 has been released already");

        await change("overwriteExisting", true);
        await click("Prepare Release");
        expect(submitted()).toHaveLength(1);
    });

    it("says a first release is the first", async () => {
        await openRelease({
            ...PROJECT, currentDevelopmentVersion: "0.0.1",
            lastReleasedVersion: undefined, releasedVersions: [],
        });

        expect(host.textContent).toContain("The first release of the schema.");
        expect(host.textContent).toContain("not released yet");
    });
});

describe("Generate Deployment Script", () => {
    it("offers the releases newest first, saying which have a script",
        async () => {
            await open({
                kind: "deploymentScript", title: "Generate Deployment Script",
                project: PROJECT, values: deploymentScriptDefaults(PROJECT),
            });

            expect(optionsOf("version")).toEqual(
                ["1.0.0", "0.9.0 (has a deployment script)"]);
            await click("Generate");
            expect(submitted()).toEqual([{
                type: "submit",
                values: { version: "1.0.0", overwriteExisting: false },
            }]);
        });

    it("says at once that there is nothing to generate", async () => {
        const fresh = { ...PROJECT, releasedVersions: [],
            lastReleasedVersion: undefined };
        await open({
            kind: "deploymentScript", title: "Generate Deployment Script",
            project: fresh, values: deploymentScriptDefaults(fresh),
        });

        expect(host.querySelector(".message.error")?.textContent)
            .toContain("Prepare a release first.");
    });
});

describe("Deploy Schema", () => {
    const openDeploy = (connections = CONNECTIONS): Promise<void> => {
        return open({
            kind: "deploy", title: "Deploy Schema - sakila", project: PROJECT,
            values: deployDefaults(PROJECT, connections), connections,
        });
    };

    it("asks for the connection by address, and sends it by URI", async () => {
        await openDeploy();
        expect(optionsOf("connection")).toEqual(
            ["Choose a connection", "root@a:3306", "root@b:3306"]);

        await click("Deploy");
        expect(submitted()).toEqual([]);
        expect(host.textContent).toContain("Choose the connection to deploy onto.");

        await change("connection", "mariadb://root@b:3306");
        await click("Deploy");
        expect(submitted()).toEqual([{
            type: "submit",
            values: {
                connection: "mariadb://root@b:3306", version: "0.9.0",
                backup: true, backupDirectory: "",
            },
        }]);
    });

    it("asks for a backup folder only while backing up", async () => {
        await openDeploy();
        expect(input("backupDirectory")).not.toBeNull();
        expect(host.textContent).toContain("the project's backups folder");

        await change("backup", false);
        expect(input("backupDirectory")).toBeNull();
    });

    it("browses for the backup folder", async () => {
        await openDeploy();
        await click("Browse...");

        expect(posted.at(-1)).toEqual({
            type: "browse", field: "backupDirectory", current: "",
        });
    });

    it("says where there is no connection to deploy onto", async () => {
        await openDeploy([]);

        expect(host.textContent).toContain("There is no connection.");
    });
});
