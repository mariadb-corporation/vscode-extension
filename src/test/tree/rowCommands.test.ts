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

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
    RestdTreeItem,
    restdCommandIds,
    type IRestdNode,
} from "../../tree/restdTreeProvider.js";
import {
    SandboxTreeItem,
    sandboxCommandIds,
    type ISandboxNode,
} from "../../tree/sandboxesTreeProvider.js";

/**
 * The overview's deployment menus are built from `sandboxCommandIds` and
 * `restdCommandIds`; the Deployments view's rows from package.json's
 * `view/item/context` entries, by the rows' `contextValue`. These hold the
 * two together: in every state, the same commands, in the same order.
 */

interface IMenuEntry {
    command: string;
    when?: string;
    group?: string;
}

const MENU = (JSON.parse(readFileSync(
    join(import.meta.dirname, "..", "..", "..", "package.json"), "utf8",
)) as { contributes: { menus: Record<string, IMenuEntry[]> } })
    .contributes.menus["view/item/context"]!;

/**
 * @param entry A menu entry.
 * @param viewItem A row's context value.
 *
 * @returns Whether the entry's `viewItem` test passes for it. Only the two
 *          forms these rows' entries use, `==` and `=~ /.../`.
 */
const offeredOn = (entry: IMenuEntry, viewItem: string): boolean => {
    const equals = /viewItem == (\S+)/u.exec(entry.when ?? "");
    if (equals) {
        return equals[1] === viewItem;
    }
    const matches = /viewItem =~ \/(.+?)\//u.exec(entry.when ?? "");

    return matches !== null
        && new RegExp(matches[1]!.replaceAll("\\\\", "\\"), "u")
            .test(viewItem);
};

/**
 * @param viewItem A row's context value.
 * @param prefix The commands the row's kind has: `mariadb.restd.`.
 *
 * @returns What the row's context menu offers, in its order: by group,
 *          then by the position within it. The inline buttons repeat the
 *          menu's entries, so they are left out.
 */
const menuOf = (viewItem: string, prefix: RegExp): string[] => {
    const order = (group = ""): [string, number] => {
        const [name, position] = group.split("@");

        return [name ?? "", Number(position ?? 0)];
    };

    return MENU.filter((entry) => {
        return prefix.test(entry.command)
            && !(entry.group ?? "").startsWith("inline")
            && offeredOn(entry, viewItem);
    }).sort((left, right) => {
        const [leftGroup, leftAt] = order(left.group);
        const [rightGroup, rightAt] = order(right.group);

        return leftGroup.localeCompare(rightGroup) || leftAt - rightAt;
    }).map((entry) => { return entry.command; });
};

describe("a sandbox's commands", () => {
    const states: ISandboxNode[] = [
        { kind: "sandbox", port: 3310, version: "13.1.1", status: "running" },
        { kind: "sandbox", port: 3310, version: "13.1.1", status: "stopped" },
        { kind: "sandbox", port: 3310, version: "13.1.1", status: "running",
            action: "stopping" },
    ];

    it.each(states)("are its row's menu: $status, $action", (node) => {
        const viewItem = new SandboxTreeItem(node).contextValue!;

        expect(sandboxCommandIds(node))
            .toEqual(menuOf(viewItem, /Sandbox$/u));
    });
});

describe("a REST Daemon's commands", () => {
    const base = {
        kind: "restd", directory: "/restd/1", host: "127.0.0.1",
        server_port: 3310, port: 8443, url: "https://localhost:8443",
        pid: 1, log_path: "/restd/1/log", metadata_schema: "mysql_rest_service_metadata",
        connection_uri: null,
    } as const;
    const states = [
        { ...base, status: "running" },
        { ...base, status: "stopped" },
        { ...base, status: "running", action: "stopping" },
    ] as unknown as IRestdNode[];

    it.each(states)("are its row's menu: $status, $action", (node) => {
        const viewItem = new RestdTreeItem(node).contextValue!;

        expect(restdCommandIds(node))
            .toEqual(menuOf(viewItem, /^mariadb\.restd\./u));
    });
});
