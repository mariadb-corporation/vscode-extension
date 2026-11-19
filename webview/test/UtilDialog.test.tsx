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
import { UtilDialog } from "../src/UtilDialog.js";
import type { IDumpInfo } from "../../src/mcp/utilApi.js";
import {
    groupKey,
    objectKey,
    schemaKey,
    USERS_KEY,
} from "../../src/util/dumpSelection.js";
import {
    initialUtilValues,
    utilOperationSpec,
    type UtilOperation,
} from "../../src/util/utilFields.js";
import type {
    IUtilTarget,
    UtilHostMessage,
} from "../../src/util/utilProtocol.js";

let host: HTMLDivElement;

const send = async (message: UtilHostMessage): Promise<void> => {
    await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data: message }));
        await Promise.resolve();
    });
};

const dump = (over: Partial<IDumpInfo> = {}): IDumpInfo => {
    const schema = (name: string, tables: string[], count = tables.length) => {
        return {
            name, tables, table_count: count, views: [], view_count: 0,
            functions: [], function_count: 0, procedures: [],
            procedure_count: 0, events: [], event_count: 0,
        };
    };

    return {
        url: "/dumps/x.mariadb.dump.zip", format: "zip", kind: "dumpSchemas",
        complete: true,
        source: { server: "db1", server_version: "11.8.2", user: "root" },
        begin: "2026-11-10 14:05:00", end: null, options: {},
        includes_users: false, users: [], user_count: 0, schema_count: 2,
        schemas: [schema("shop", ["orders", "items"], 150),
            schema("crm", ["leads"])],
        data_file_bytes: 1, size_bytes: 2048, ...over,
    };
};

/** A load's dialog, its dump read. */
const openLoad = async (operation: UtilOperation = "loadDump",
    info: IDumpInfo = dump()): Promise<void> => {
    await open(operation, "/dumps/x.mariadb.dump.zip");
    await send({ type: "inspected", path: "/dumps/x.mariadb.dump.zip", info });
};

const box = (key: string): HTMLInputElement => {
    return host.querySelector(`input[data-key='${key.replaceAll("'",
        "\\'")}']`)!;
};

/** Opens or closes a row of the Objects tab. */
const disclose = async (label: string): Promise<void> => {
    await act(async () => {
        host.querySelector<HTMLButtonElement>(
            `button[aria-label='${label}']`)!.click();
        await Promise.resolve();
    });
};

const toggleBox = async (key: string): Promise<void> => {
    await act(async () => {
        box(key).click();
        await Promise.resolve();
    });
};

const open = async (operation: UtilOperation, path = "/home/me/dump",
    targets: IUtilTarget[] = []): Promise<void> => {
    await act(async () => {
        render(<UtilDialog />, host);
        await Promise.resolve();
    });
    const spec = utilOperationSpec(operation, {
        connection: "root@localhost", schemas: ["shop"], tables: ["orders"],
    });
    await send({ type: "load", spec, values: initialUtilValues(spec, path),
        targets });
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

beforeEach(() => {
    posted.length = 0;
    host = document.createElement("div");
    document.body.append(host);
});

afterEach(() => {
    render(null, host);
    host.remove();
});

describe("UtilDialog", () => {
    it("asks for the operation's path and options, and sends them", async () => {
        await open("dumpSchemas");

        expect(posted[0]).toEqual({ type: "ready" });
        expect(host.querySelector("h1")?.textContent).toBe("Dump shop to Disk");
        expect(input("path").value).toBe("/home/me/dump");
        // the advanced options wait on their own tab
        expect(input("maxRate")).toBeNull();

        await change("threads", "8");
        await change("consistent", false);
        await click("Dump");

        expect(posted.at(-1)).toMatchObject({
            type: "start",
            values: { path: "/home/me/dump", threads: "8", consistent: false },
        });
    });

    it("shows the advanced options on their tab", async () => {
        await open("dumpSchemas");
        await click("Advanced");

        expect(input("maxRate")).not.toBeNull();
        expect(input("threads")).toBeNull();
    });

    it("says what is wrong instead of sending it", async () => {
        await open("dumpSchemas", "");
        await click("Dump");

        expect(posted.some((message) => { return message.type === "start"; }))
            .toBe(false);
        expect(input("path").getAttribute("aria-invalid")).toBe("true");
        expect(host.textContent).toContain("Output Folder must be given.");
    });

    it("brings a problem on the other tab into view", async () => {
        await openLoad();
        await click("Advanced");
        // a number on the Basic tab is wrong
        await click("Basic");
        await change("threads", "many");
        await click("Advanced");
        await click("Load");

        expect(input("threads")).not.toBeNull();
        expect(host.textContent).toContain("Threads must be a whole number.");
    });

    it("asks the extension to browse, and takes the path it picked", async () => {
        await open("loadDump", "");
        await click("Browse...");
        expect(posted.at(-1)).toEqual({ type: "browse", current: "" });

        await send({ type: "browsed", path: "/picked" });
        expect(input("path").value).toBe("/picked");
    });

    it("offers the targets of a copy", async () => {
        await open("copySchemas", "", [
            { uri: "mariadb://root@a:3306", label: "root@a:3306" },
            { uri: "mariadb://root@b:3306", label: "root@b:3306" },
        ]);
        const options = [...host.querySelectorAll("[name='target'] option")]
            .map((option) => { return option.textContent; });
        expect(options).toEqual(["Choose a connection", "root@a:3306",
            "root@b:3306"]);

        await click("Copy");
        expect(host.textContent).toContain("Choose the connection to copy to.");

        // shown by address, sent back by URI
        await change("target", "mariadb://root@b:3306");
        await click("Copy");
        expect(posted.at(-1)).toMatchObject({ type: "start",
            values: { target: "mariadb://root@b:3306" } });
    });

    it("shows a progress bar and disables the buttons while it starts",
        async () => {
            await open("dumpSchemas");
            await send({ type: "busy", busy: true });

            expect(host.querySelector("[role='progressbar']")).not.toBeNull();
            expect(button("Dump").disabled).toBe(true);
            expect(button("Cancel").disabled).toBe(true);

            await send({ type: "busy", busy: false });
            await send({ type: "startError", message: "Access denied" });
            expect(host.querySelector("[role='progressbar']")).toBeNull();
            expect(host.querySelector(".message.error")?.textContent)
                .toBe("Access denied");
        });

    it("names the path a zip while Dump to Self-Contained ZIP File is ticked",
        async () => {
            await open("dumpSchemas");
            expect(host.textContent).toContain("Output Folder");

            await change("zip", true);
            expect(input("path").value).toBe("/home/me/dump.mariadb.dump.zip");
            expect(host.textContent).toContain("Output File");
            await click("Browse...");
            expect(posted.at(-1)).toEqual({ type: "browse",
                current: "/home/me/dump.mariadb.dump.zip", zip: true });

            await change("zip", false);
            expect(input("path").value).toBe("/home/me/dump");
        });

    it("lists what the dump holds, and sends what is unticked", async () => {
        await open("loadDump", "/dumps/x.mariadb.dump.zip");
        // nothing to load before the dump is read
        expect(button("Load").disabled).toBe(true);
        expect(host.textContent).toContain("Reading what the dump holds");

        await send({ type: "inspected", path: "/dumps/x.mariadb.dump.zip",
            info: dump() });
        expect(host.textContent).toContain("Schema dump in a ZIP file, from "
            + "db1 (11.8.2) by root");
        expect(button("Load").disabled).toBe(false);

        await toggleBox(schemaKey("crm"));
        await click("Load");

        expect(posted.at(-1)).toMatchObject({ type: "start",
            excluded: [USERS_KEY, schemaKey("crm")] });
    });

    it("reads every name of a list cut short when it is opened", async () => {
        await openLoad();
        await disclose("Open shop");
        await disclose("Open Tables");

        expect(posted.at(-1)).toEqual({ type: "inspectSchema",
            schema: "shop" });
        expect(host.textContent).toContain("...and 148 more");
        await toggleBox(objectKey("shop", "tables", "items"));
        // the group above it shows partly ticked
        expect(box(groupKey("shop", "tables")).indeterminate).toBe(true);
    });

    it("says why a dump cannot be loaded here, and does not load it",
        async () => {
            await openLoad("loadDump", dump({ kind: "dumpTables",
                schema_count: 1 }));

            expect(host.querySelector(".dump-problem")?.textContent)
                .toContain("Load Table Dump from Disk");
            expect(button("Load").disabled).toBe(true);
        });

    it("loads one schema's objects into another, routines unticked",
        async () => {
            await openLoad("loadTableDump", dump({ schema_count: 1,
                schemas: [{ ...dump().schemas[1], functions: ["f"],
                    function_count: 1 }] }));

            expect(host.textContent).toContain("From crm, into shop:");
            expect(box(groupKey("crm", "tables")).checked).toBe(true);
            expect(box(groupKey("crm", "functions")).checked).toBe(false);
        });

    it("says when nothing is ticked", async () => {
        await openLoad();
        await toggleBox(schemaKey("shop"));
        await toggleBox(schemaKey("crm"));
        await click("Load");

        expect(posted.some((message) => { return message.type === "start"; }))
            .toBe(false);
        expect(host.textContent).toContain("Nothing is ticked");
    });

    it("closes with Cancel", async () => {
        await open("exportTable", "/out.tsv");
        await click("Cancel");

        expect(posted.at(-1)).toEqual({ type: "cancel" });
    });
});
