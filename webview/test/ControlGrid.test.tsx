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

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
    comboInput,
    textInput,
} from "../src/tableEditor/ControlGrid.js";

// The grid itself never builds under jsdom (Tabulator measures the DOM):
// its controls are tested alone.

const CHOICES = ["varchar", "int", "integer", "text"].map((value) => {
    return { value, label: value };
});

const key = (target: HTMLElement, name: string): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true,
        cancelable: true });
    target.dispatchEvent(event);

    return event;
};

const options = (): string[] => {
    return [...document.querySelectorAll(".cell-combo-option")]
        .map((item) => { return item.textContent ?? ""; });
};

const activeOption = (): string | undefined => {
    return document.querySelector(".cell-combo-option.active")
        ?.textContent ?? undefined;
};

describe("the grid's controls", () => {
    beforeAll(() => {
        // jsdom lays nothing out, and has no scrollIntoView.
        Element.prototype.scrollIntoView = () => { /* nothing to scroll */ };
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("commits a value once, however often the change comes", () => {
        const committed: string[] = [];
        const input = textInput({ key: "c1", field: "name" }, "id",
            (value) => { committed.push(value); });
        document.body.append(input);
        input.value = "ident";
        input.dispatchEvent(new Event("change"));
        input.dispatchEvent(new Event("change"));
        expect(committed).toEqual(["ident"]);
    });

    it("selects the type and lists the choices when focused, Up and Down "
        + "moving through them", () => {
        const committed: string[] = [];
        const combo = comboInput({ key: "c1", field: "type" }, "varchar",
            CHOICES, (value) => { committed.push(value); });
        document.body.append(combo);
        const input = combo.querySelector("input")!;

        input.focus();
        // Typing replaces it.
        expect(input.selectionStart).toBe(0);
        expect(input.selectionEnd).toBe("varchar".length);
        expect(options()).toEqual(["varchar", "int", "integer", "text"]);
        expect(activeOption()).toBe("varchar");
        expect(input.getAttribute("aria-expanded")).toBe("true");

        expect(key(input, "ArrowDown").defaultPrevented).toBe(true);
        expect(input.value).toBe("int");
        expect(activeOption()).toBe("int");
        key(input, "ArrowDown");
        key(input, "ArrowUp");
        expect(input.value).toBe("int");

        key(input, "Enter");
        expect(committed).toEqual(["int"]);
        expect(options()).toEqual([]);
    });

    it("narrows the list to what is typed, and takes a click", () => {
        const committed: string[] = [];
        const combo = comboInput({ key: "c1", field: "type" }, "varchar",
            CHOICES, (value) => { committed.push(value); });
        document.body.append(combo);
        const input = combo.querySelector("input")!;
        input.focus();

        input.value = "in";
        input.dispatchEvent(new Event("input"));
        expect(options()).toEqual(["int", "integer"]);
        expect(activeOption()).toBe("int");

        // A type of its own: no list, the text kept.
        input.value = "geometry";
        input.dispatchEvent(new Event("input"));
        expect(options()).toEqual([]);

        input.value = "te";
        input.dispatchEvent(new Event("input"));
        document.querySelector(".cell-combo-option")!.dispatchEvent(
            new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        expect(committed).toEqual(["text"]);
    });

    it("closes the list when left, and opens none when focused again by "
        + "a redraw", () => {
        const combo = comboInput({ key: "c1", field: "type" }, "int",
            CHOICES, () => { /* not needed */ });
        document.body.append(combo);
        const input = combo.querySelector("input")!;
        input.focus();
        expect(options()).toHaveLength(4);
        input.blur();
        expect(options()).toEqual([]);

        input.dataset.refocus = "true";
        input.focus();
        expect(options()).toEqual([]);
    });
});
