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

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import {
    diagramNamed, linkParameters, MsmLinkHandler, notAProject, parseMsmLink,
    type IMsmLinkHost,
} from "../../msm/msmLinks.js";

describe("linkParameters", () => {
    it("reads project and diagram in either order", () => {
        expect(linkParameters("project=/w/shop.msm.project&diagram=Main"))
            .toEqual(new Map([
                ["project", "/w/shop.msm.project"], ["diagram", "Main"],
            ]));
        expect(linkParameters("diagram=Main&project=/w/a"))
            .toEqual(new Map([["diagram", "Main"], ["project", "/w/a"]]));
    });

    it("keeps an & or = a decoded value has", () => {
        // What the editor hands over for project=%2Fw%2Fa%26b%3Dc ...
        expect(linkParameters("project=/w/a&b=c d/x.msm.project"
            + "&diagram=Main & More")).toEqual(new Map([
            ["project", "/w/a&b=c d/x.msm.project"],
            ["diagram", "Main & More"],
        ]));
    });

    it("keeps a + as it is", () => {
        expect(linkParameters("project=/w/c++").get("project"))
            .toBe("/w/c++");
    });
});

describe("parseMsmLink", () => {
    it("reads an Open Diagram link", () => {
        expect(parseMsmLink("/msm/openDiagram",
            "project=/w/shop.msm.project&diagram=Main")).toEqual({
            link: { project: "/w/shop.msm.project", diagram: "Main" },
        });
        expect(parseMsmLink("/msm/openDiagram", "project=/w/shop"))
            .toEqual({ link: { project: "/w/shop" } });
        expect(parseMsmLink("/msm/openDiagram", "project=/w/shop&diagram="))
            .toEqual({ link: { project: "/w/shop" } });
    });

    it("refuses other paths, no project and a relative one", () => {
        expect(parseMsmLink("/msm/deploy", "project=/w/shop"))
            .toHaveProperty("error");
        expect(parseMsmLink("/msm/openDiagram", "diagram=Main"))
            .toHaveProperty("error");
        expect(parseMsmLink("/msm/openDiagram", "project=shop.msm.project"))
            .toHaveProperty("error");
    });
});

describe("diagramNamed", () => {
    it("prefers the exact name, else the one differing in case", () => {
        expect(diagramNamed(["Main", "main"], "main")).toBe("main");
        expect(diagramNamed(["Main", "Orders"], "orders")).toBe("Orders");
        expect(diagramNamed(["Main", "MAIN"], "main")).toBeUndefined();
        expect(diagramNamed(["Main"], "Other")).toBeUndefined();
    });
});

describe("MsmLinkHandler", () => {
    let root: string;
    let project: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "msm-links-"));
        project = join(root, "shop.msm.project");
        await mkdir(project);
        await writeFile(join(project, "msm.project.json"), "{}");
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    /**
     * @param names The project's diagrams.
     *
     * @returns A host recording what was done.
     */
    const hostWith = (names: string[]): IMsmLinkHost & { did: string[] } => {
        const did: string[] = [];

        return {
            did,
            addToProjects: (path) => {
                did.push(`add ${path}`);

                return Promise.resolve();
            },
            diagramNames: () => { return Promise.resolve(names); },
            openDiagram: (_path, name) => { did.push(`open ${name}`); },
            pickDiagram: () => {
                did.push("pick");

                return Promise.resolve();
            },
            warn: (message) => { did.push(`warn ${message}`); },
            log: () => { /* not looked at */ },
        };
    };

    /**
     * @param query The link's query, decoded.
     * @param path Its path.
     *
     * @returns The link, as far as the handler reads it.
     */
    const link = (query: string, path = "/msm/openDiagram"): vscode.Uri => {
        return { path, query } as vscode.Uri;
    };

    it("adds the project and opens the diagram named", async () => {
        const host = hostWith(["Main", "Orders"]);
        await new MsmLinkHandler(host).handleUri(
            link(`project=${project}&diagram=orders`));
        expect(host.did).toEqual([`add ${project}`, "open Orders"]);
    });

    it("lets the user pick where no diagram or an unknown one is named",
        async () => {
            const host = hostWith(["Main"]);
            await new MsmLinkHandler(host).handleUri(
                link(`project=${project}`));
            await new MsmLinkHandler(host).handleUri(
                link(`project=${project}&diagram=Other`));
            expect(host.did).toEqual([
                `add ${project}`, "pick",
                `add ${project}`,
                "warn shop.msm.project has no schema diagram named Other.",
                "pick",
            ]);
        });

    it("adds nothing that is no MSM project", async () => {
        const host = hostWith([]);
        await new MsmLinkHandler(host).handleUri(
            link(`project=${root}&diagram=Main`));
        await new MsmLinkHandler(host).handleUri(
            link(`project=${join(root, "gone")}`));
        await new MsmLinkHandler(host).handleUri(
            link(`project=${project}`, "/msm/other"));
        expect(host.did).toHaveLength(3);
        expect(host.did.every((entry) => { return entry.startsWith("warn"); }))
            .toBe(true);
        expect(await notAProject(project)).toBeUndefined();
    });
});
