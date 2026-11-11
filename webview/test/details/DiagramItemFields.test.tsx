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

import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    DiagramItemFields,
    formatUnits,
    parseUnits,
} from "../../src/details/DiagramItemFields.js";

const FIGURE = {
    kind: "figure", id: "f1", x: 819.6, y: 478.3, z: 0, width: 527.3,
    height: 399.3, autoHeight: true, editable: true,
} as const;

describe("the diagram item's fields", () => {
    afterEach(cleanup);

    it("reads a decimal point or comma, with or without px", () => {
        expect(parseUnits("819,6")).toBe(819.6);
        expect(parseUnits("819.6 px")).toBe(819.6);
        expect(parseUnits("")).toBeUndefined();
        expect(parseUnits("abc")).toBeUndefined();
        expect(parseUnits(formatUnits(12.25))).toBeCloseTo(12.3, 5);
    });

    it("commits a changed field on Enter, and nothing unchanged", () => {
        const change = vi.fn();
        render(<DiagramItemFields item={FIGURE} change={change} />);
        const x = screen.getByLabelText("X position");

        fireEvent.keyDown(x, { key: "Enter" });
        expect(change).not.toHaveBeenCalled();

        fireEvent.input(x, { target: { value: "100" } });
        fireEvent.keyDown(x, { key: "Enter" });
        expect(change).toHaveBeenCalledWith({ x: 100 });
    });

    it("switches the height's Auto, and is read only where the diagram is", () => {
        const change = vi.fn();
        const { rerender } = render(
            <DiagramItemFields item={FIGURE} change={change} />);
        fireEvent.click(screen.getByLabelText("Auto"));
        expect(change).toHaveBeenCalledWith({ autoHeight: false });

        rerender(<DiagramItemFields item={{ ...FIGURE, editable: false }}
            change={change} />);
        expect(screen.getByLabelText("Width")).toHaveProperty("readOnly", true);
        expect(screen.getByLabelText("Auto")).toHaveProperty("disabled", true);
    });

    it("shows a relationship line's offset and split", () => {
        const change = vi.fn();
        render(<DiagramItemFields item={{ kind: "connection", id: "c1",
            source: "orders", target: "customers", offset: -40, split: false,
            editable: true }} change={change} />);

        expect(screen.getByText("orders")).toBeTruthy();
        fireEvent.click(screen.getByLabelText("Split"));
        expect(change).toHaveBeenCalledWith({ split: true });
    });

    it("lists a layer's tables, with its place and no Auto", () => {
        const change = vi.fn();
        render(<DiagramItemFields item={{ kind: "layer", id: "l1",
            name: "Sales", x: 0, y: 0, z: 40, width: 600, height: 400,
            tables: ["customers", "orders"], editable: true }}
        change={change} />);

        expect(screen.getByText("customers")).toBeTruthy();
        expect(screen.queryByLabelText("Auto")).toBeNull();
        const z = screen.getByLabelText("Elevation above the page");
        fireEvent.input(z, { target: { value: "80" } });
        fireEvent.keyDown(z, { key: "Enter" });
        expect(change).toHaveBeenCalledWith({ z: 80 });
    });

    it("changes a relationship's kind", () => {
        const change = vi.fn();
        render(<DiagramItemFields item={{ kind: "connection", id: "c1",
            source: "orders", target: "customers", offset: 0, split: false,
            many: true, identifying: false, editable: true }}
        change={change} />);

        fireEvent.change(screen.getByLabelText("Kind:"),
            { target: { value: "1:1" } });
        expect(change).toHaveBeenCalledWith({ many: false });
        fireEvent.click(screen.getByLabelText("Identifying"));
        expect(change).toHaveBeenCalledWith({ identifying: true });
    });

    it("shows an end placed by hand, and resets it", () => {
        const change = vi.fn();
        render(<DiagramItemFields item={{ kind: "connection", id: "c1",
            source: "orders", target: "customers", offset: 0, split: false,
            endDock: "top", editable: true }} change={change} />);

        expect(screen.getByText("Top side")).toBeTruthy();
        expect(screen.queryByText("Source end")).toBeNull();
        fireEvent.click(screen.getByLabelText(
            "Reset the target end to the automatic layout"));
        expect(change).toHaveBeenCalledWith({ resetDock: "end" });
    });
});
