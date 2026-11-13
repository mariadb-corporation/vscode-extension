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

import { act, cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";

// The page asks for the VS Code API as it loads.
import "../setup.js";
import { ObjectDetails } from "../../src/details/ObjectDetails.js";

const FIGURE = {
    kind: "figure", id: "f1", x: 10, y: 20, z: 0, width: 200, height: 120,
    autoHeight: true, upright: false, color: "", editable: true,
} as const;

/** Sends the page what the extension does. */
const send = (message: unknown): void => {
    act(() => {
        window.dispatchEvent(new MessageEvent("message", { data: message }));
    });
};

describe("the Object Details page", () => {
    afterEach(cleanup);

    it("heads an object with its type's icon, its name, then its type", () => {
        const { container } = render(<ObjectDetails />);
        send({ type: "show", details: { schema: "shop", where: "project shop",
            object: { type: "table", table: { name: "orders", columns: [],
                indexes: [], foreign_keys: [] } } }, item: FIGURE });

        const header = container.querySelector(".detailsHeader")!;
        // The title, the rule, then the schema under it.
        expect([...header.children].map((child) => {
            return child.className;
        })).toEqual(["detailsTitle", "detailsRule", "detailsWhere"]);
        const title = header.querySelector(".detailsTitle")!;
        expect([...title.children].map((child) => {
            return child.className;
        })).toEqual(["detailsTitleIcon", "detailsTitleText"]);
        expect(title.querySelector(".detailsTitleIcon .detailsTypeIcon"))
            .not.toBeNull();
        // One line, the whole of it as its tooltip where "…" cuts it.
        expect(title.querySelector(".detailsTitleText")?.textContent)
            .toBe("orders Table");
        expect(title.querySelector(".detailsTitleText")
            ?.getAttribute("title")).toBe("orders Table");
        expect(header.querySelector(".detailsWhere")?.textContent)
            .toBe("shop");
        expect(header.querySelector(".detailsWhere")?.getAttribute("title"))
            .toBe("shop · project shop");
        // The light and the dark icon; the theme's shows.
        expect([...header.querySelectorAll(".detailsTypeIcon img")]
            .map((img) => { return img.getAttribute("src")?.slice(0, 19); }))
            .toEqual(["data:image/svg+xml;", "data:image/svg+xml;"]);
    });

    it("titles a figure's color as its other sections, without a hint "
        + "where a swatch shows it", () => {
        const { container } = render(<ObjectDetails />);
        send({ type: "show", details: { schema: "shop", where: "project shop",
            object: { type: "table", table: { name: "orders", columns: [],
                indexes: [], foreign_keys: [] } } }, item: FIGURE });

        expect(container.querySelector(".itemColor .field-caption")
            ?.textContent).toBe("Color");
        expect(container.querySelector(".itemColor .field-hint")).toBeNull();
        expect(screen.getByLabelText("Auto-Height")).toBeTruthy();
    });

    it("heads a relationship line with its kind's toolbar icon", () => {
        const { container } = render(<ObjectDetails />);
        send({ type: "show", item: { kind: "connection", id: "c1",
            source: "orders", target: "customer", offset: 0, split: false,
            many: true, identifying: false, editable: true } });

        const header = container.querySelector(".detailsHeader")!;
        // No schema: the rule, nothing under it.
        expect([...header.children].map((child) => {
            return child.className;
        })).toEqual(["detailsTitle", "detailsRule"]);
        expect(header.querySelector(".detailsTitleIcon .detailsHeaderIcon"))
            .not.toBeNull();
        expect(header.querySelector(".detailsTitleText")?.textContent)
            .toBe("orders → customer Relationship");
        // The 1:n tool's icon, as a mask in the theme's colour.
        expect((header.querySelector(".detailsIcon") as HTMLElement)
            .style.maskImage).toMatch(/^url\("data:image\/svg\+xml/u);
    });

    it("heads a REST object figure with its icon, path, kind, and what it "
        + "serves", () => {
        const { container } = render(<ObjectDetails />);
        send({ type: "show", item: { ...FIGURE, upright: true, rest: {
            service: "/svc", schema: "/shop", object: "/orders",
            objectType: "VIEW", dbSchema: "shop", dbObject: "orders" } } });

        const header = container.querySelector(".detailsHeader")!;
        expect(header.querySelector(".detailsTypeIcon img")).not.toBeNull();
        expect(header.querySelector(".detailsName")?.textContent)
            .toBe("/orders");
        expect(header.querySelector(".detailsKind")?.textContent)
            .toBe("REST View");
        // Its full path under the rule, what it serves as the tooltip.
        expect(header.querySelector(".detailsWhere")?.textContent)
            .toBe("/svc/shop/orders");
        expect(header.querySelector(".detailsWhere")?.getAttribute("title"))
            .toBe("/svc/shop/orders · shop.orders");
        // Its place and size below.
        expect(screen.getByLabelText("Upright")).toBeTruthy();
    });

    it("heads a REST object Section 180 does not define by its paths", () => {
        const { container } = render(<ObjectDetails />);
        send({ type: "show", item: { ...FIGURE, rest: { service: "/svc",
            schema: "/shop", object: "/gone" } } });

        expect(container.querySelector(".detailsKind")?.textContent)
            .toBe("REST Object");
        expect(container.querySelector(".detailsWhere")?.textContent)
            .toBe("/svc/shop/gone");
    });

    it("empties when the extension shows nothing", () => {
        const { container } = render(<ObjectDetails />);
        send({ type: "show", details: { schema: "shop", where: "project shop",
            object: { type: "table", table: { name: "orders", columns: [],
                indexes: [], foreign_keys: [] } } }, item: FIGURE });
        send({ type: "show" });

        expect(container.querySelector(".detailsHeader")).toBeNull();
        expect(container.querySelector(".itemSection")).toBeNull();
    });
});
