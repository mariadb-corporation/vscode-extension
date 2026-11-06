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

import { DIAGRAM_TOOLS } from "../../src/modeler/diagramTools.js";
import { DiagramToolbar, ToolPanel } from "../../src/modeler/DiagramToolbar.js";

describe("DiagramToolbar", () => {
    let host: HTMLDivElement;
    let picked: string[];

    const show = (locked = false, tools = DIAGRAM_TOOLS): void => {
        act(() => {
            render(<DiagramToolbar
                tools={tools}
                tool="table"
                onTool={(id) => { picked.push(id); }}
                locked={locked}
            />, host);
        });
    };

    const buttons = (): HTMLButtonElement[] => {
        return [...host.querySelectorAll<HTMLButtonElement>("button")];
    };

    beforeEach(() => {
        host = document.createElement("div");
        document.body.appendChild(host);
        picked = [];
    });

    afterEach(() => {
        render(null, host);
        host.remove();
    });

    it("lists Workbench's tools in its groups, each named with its key", () => {
        show();

        expect(buttons().map((button) => { return button.title; })).toEqual(
            DIAGRAM_TOOLS.map((tool) => {
                return tool.key === undefined ? tool.title
                    : `${tool.title} (${tool.key === "Escape" ? "Esc"
                        : tool.key.toUpperCase()})`;
            }));
        expect(buttons()[0]?.title).toBe("Select Objects (Esc)");
        expect(host.querySelectorAll(".diagramToolDivider")).toHaveLength(5);
    });

    it("shows the tool in use, and picks one clicked", () => {
        show();
        const table = host.querySelector<HTMLButtonElement>(".toolTable")!;

        expect(table.getAttribute("aria-pressed")).toBe("true");
        act(() => { host.querySelector<HTMLButtonElement>(".toolRel1n")!.click(); });
        expect(picked).toEqual(["rel1n"]);
    });

    it("offers only the canvas's tools on a locked diagram", () => {
        show(true);

        expect(buttons().filter((button) => { return !button.disabled; })
            .map((button) => { return button.className.split(" ")[2]; }))
            .toEqual(["toolPointer", "toolHand", "toolZoom"]);
    });
});

describe("ToolPanel", () => {
    it("lists the columns picked, the next one in bold, and its button", () => {
        const host = document.createElement("div");
        let pressed = 0;
        act(() => {
            render(<ToolPanel
                panel={{ title: "Referenced Columns", text: "Pick matching "
                    + "columns for the referenced table.",
                columns: ["buyer UUID", "seller UUID"], current: 1,
                button: true }}
                onPickReferenced={() => { pressed += 1; }}
            />, host);
        });

        expect(host.querySelector(".toolPanelTitle")?.textContent)
            .toBe("Referenced Columns");
        expect(host.querySelector("li.current")?.textContent).toBe("seller UUID");
        act(() => { host.querySelector<HTMLButtonElement>("button")!.click(); });
        expect(pressed).toBe(1);
        render(null, host);
    });
});
