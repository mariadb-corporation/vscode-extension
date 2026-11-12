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

import { ActionGroup } from "../../restd/actionGroup.js";
import type { IActionRow } from "../../webview/protocol.js";

/** Collects what goes up, keeping the latest row of each id. */
const collect = (): {
    put: (connection: string, row: IActionRow) => void;
    rows: Map<string, IActionRow>;
    last: () => IActionRow;
} => {
    const rows = new Map<string, IActionRow>();
    let last: IActionRow | undefined;

    return {
        put: (_connection, row) => { rows.set(row.id, row); last = row; },
        rows,
        last: () => { return last!; },
    };
};

const WORDS = { doing: "Creating Sandbox on port 3311",
    done: "Created Sandbox on port 3311" };

describe("ActionGroup", () => {
    it("is pending until finished, a row for each step under it", async () => {
        const rows = collect();
        const group = new ActionGroup(rows.put, "General", WORDS);
        expect(rows.last()).toMatchObject({ role: "run", kind: "pending",
            message: "Creating Sandbox on port 3311…", children: [] });

        await group.step({ doing: "Deploying", done: "Deployed" }, "call()",
            () => { return Promise.resolve("deployed"); },
            { detail: (said) => { return said; } });
        expect(rows.last().kind).toBe("pending");
        expect(rows.last().children).toMatchObject([
            { role: "statement", kind: "info", message: "Deployed",
                statement: "deployed" },
        ]);

        group.finish("https://localhost:33110/myService/v1");
        expect(rows.last()).toMatchObject({
            kind: "info", message: "Created Sandbox on port 3311",
            summary: "https://localhost:33110/myService/v1",
        });
        // One action: every put replaced the one row.
        expect(rows.rows.size).toBe(1);
    });

    it("is one row where its only step is called as it is", async () => {
        const rows = collect();
        const group = new ActionGroup(rows.put, "General", WORDS);
        let release: () => void = () => { /* set below */ };
        const running = group.run(() => {
            return group.step(WORDS, "msm.create(path=/p)", () => {
                return new Promise<string>((resolve) => {
                    release = () => { resolve("2 files"); };
                });
            }, { detail: (said) => { return said; } });
        }, () => { return "Next: 1.0.2"; });
        await Promise.resolve();
        // The call shows while it runs, with the whole's words.
        expect(rows.last()).toMatchObject({ role: "statement",
            kind: "pending", message: "Creating Sandbox on port 3311…",
            statement: "msm.create(path=/p)" });
        expect(rows.last().children).toBeUndefined();

        release();
        await running;
        // What the whole came to first, then what the call did.
        expect(rows.last()).toMatchObject({ role: "statement", kind: "info",
            message: "Created Sandbox on port 3311",
            statement: "Next: 1.0.2\n2 files" });
        expect(rows.rows.size).toBe(1);
    });

    it("has its only step's failure as a row under it", async () => {
        const rows = collect();
        const group = new ActionGroup(rows.put, "General", WORDS);

        await expect(group.run(() => {
            return group.step(WORDS, "msm.create(path=/p)", () => {
                return Promise.reject(new Error("No space."));
            });
        })).rejects.toThrow("No space.");

        expect(rows.last()).toMatchObject({ role: "run", kind: "error",
            message: "Creating Sandbox on port 3311 failed" });
        expect(rows.last().children).toMatchObject([{ kind: "error",
            message: "Creating Sandbox on port 3311 failed: No space.",
            statement: "msm.create(path=/p)" }]);
        // Still the one action, its row now with a child.
        expect(rows.rows.size).toBe(1);
    });

    it("shows a step's spinner while it runs", async () => {
        const rows = collect();
        const group = new ActionGroup(rows.put, "General", WORDS);
        let release!: () => void;
        const running = group.step({ doing: "Waiting", done: "Waited" }, "w()",
            () => { return new Promise<void>((resolve) => { release = resolve; }); });

        expect(rows.last().children?.[0]).toMatchObject({
            kind: "pending", message: "Waiting…" });
        release();
        await running;
    });

    it("fails with the step's error to jump to, and its log", async () => {
        const rows = collect();
        const group = new ActionGroup(rows.put, "General", WORDS);

        await expect(group.step({ doing: "Setting up", done: "Set up" },
            "restd.configure_restd()",
            () => { return Promise.reject(new Error("Access denied")); },
            { logOf: () => { return Promise.resolve("/logs/setup.log"); } }))
            .rejects.toThrow("Access denied");
        group.finish();

        const row = rows.last();
        const failed = row.children![0]!;
        expect(failed).toMatchObject({ kind: "error",
            message: "Setting up failed: Access denied",
            statement: "restd.configure_restd()", logPath: "/logs/setup.log" });
        expect(row).toMatchObject({ kind: "error",
            message: "Creating Sandbox on port 3311 failed",
            summary: "Finished with 1 error", jumpToRowId: failed.id,
            logPath: "/logs/setup.log" });
    });
    it("offers the log a done step's result names", async () => {
        const rows = collect();
        const group = new ActionGroup(rows.put, "General", WORDS);

        await group.step({ doing: "Setting up", done: "Set up" },
            "restd.configure_restd()",
            () => { return Promise.resolve({ installed: true }); }, {
                logOfResult: (value) => {
                    return Promise.resolve(value.installed
                        ? "/logs/install.log" : undefined);
                },
            });
        group.finish();

        const row = rows.last();
        expect(row.children![0]).toMatchObject({ kind: "info",
            message: "Set up", logPath: "/logs/install.log" });
        // The whole names a log only where a step failed.
        expect(row.logPath).toBeUndefined();
    });

    it("fails as a whole where run fails outside any step", async () => {
        const rows = collect();
        const group = new ActionGroup(rows.put, "General", WORDS);

        await expect(group.run(() => {
            return Promise.reject(new Error("The MCP server is not running."));
        })).rejects.toThrow("not running");

        expect(rows.last()).toMatchObject({ kind: "error", children: [],
            message: "Creating Sandbox on port 3311 failed: The MCP server "
                + "is not running.",
            summary: "Failed" });
    });
});
