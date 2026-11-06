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

import type {
    IModelFigure,
    IOutlineSequence,
    IOutlineTable,
    ISchemaModel,
} from "../../../src/modeler/modelFormat.js";
import {
    catalogFromModel,
    foreignKeyOf,
    primaryKeyColumns,
} from "../../src/modeler/catalog.js";
import {
    CARD,
    cardItemAt,
    cardWidth,
    contrastingText,
    editRect,
    estimateText,
    eventCardContent,
    layoutCard,
    layoutTableCard,
    MAX_AUTO_WIDTH,
    MIN_AUTO_WIDTH,
    routineCardContent,
    sequenceCardContent,
    tableCardContent,
    TITLE_RESERVE,
    viewCardContent,
} from "../../src/modeler/tableCard.js";

/** A table as msm's snapshot has it: the outline's shape. */
const table: IOutlineTable = {
    name: "actor",
    columns: [
        { name: "actor_id", type: "INT", nullable: false },
        { name: "first_name", type: "VARCHAR(45)", nullable: false },
        { name: "note", type: "TEXT", nullable: true },
        { name: "film_id", type: "INT", nullable: false },
    ],
    foreign_keys: [{
        name: "fk_actor_film", columns: ["film_id"],
        references: { schema: null, table: "film", columns: ["film_id"] },
        many: true, mandatory: true, referenced_mandatory: true,
    }],
    indexes: [
        { name: null, kind: "primary", columns: ["actor_id"] },
        { name: null, kind: "unique", columns: ["first_name", "note"] },
        { name: "idx_film", kind: "index", columns: ["film_id"] },
    ],
};

const figure: IModelFigure = {
    id: "f1", type: "TableFigure", name: "actor", left: 10, top: 20,
    width: 180, height: 100, color: "#98BFDA", table: "actor",
    expanded: true, columnsExpanded: true,
};

describe("layoutTableCard", () => {
    it("puts the title in the header and a row per column", () => {
        const layout = layoutTableCard(table, figure, true);

        expect(layout.width).toBe(180);
        expect(layout.items[0]).toMatchObject({
            kind: "title", text: "actor", editable: true, icon: "table",
            rect: { left: 0, top: 0, width: 180, height: CARD.headerHeight },
        });
        const columns = layout.items.filter((item) => {
            return item.kind === "column";
        });
        expect(columns.map((item) => { return item.text; }))
            .toEqual(["actor_id", "first_name", "note", "film_id"]);
        expect(columns.map((item) => { return item.icon; }))
            .toEqual(["primaryKey", "notNull", "nullable", "notNull"]);
        expect(columns.every((item) => { return item.editable; })).toBe(true);
        expect(columns[0].detail).toBe("INT");
        // The height follows the content.
        expect(layout.height).toBe(CARD.headerHeight + CARD.padding
            + CARD.headingHeight + 4 * CARD.rowHeight + CARD.padding);
    });

    it("adds the indices and foreign keys where expanded", () => {
        const layout = layoutTableCard(table, {
            ...figure, indicesExpanded: true, foreignKeysExpanded: true,
        });
        const kinds = layout.items.map((item) => { return item.kind; });

        expect(kinds).toContain("index");
        expect(kinds).toContain("foreignKey");
        expect(layout.items.filter((item) => { return item.kind === "heading"; })
            .map((item) => { return item.text; }))
            .toEqual(["Columns", "Indexes", "Foreign Keys"]);
        expect(layout.items.filter((item) => { return item.kind === "index"; })
            .map((item) => { return item.text; }))
            .toEqual(["PRIMARY", "first_name, note", "idx_film"]);
        expect(layout.items.find((item) => { return item.kind === "index"; })
            ?.editable).toBe(false);
    });

    it("edits no names where the schema is not a project's", () => {
        const layout = layoutTableCard(table, figure);

        expect(layout.items.some((item) => { return item.editable; }))
            .toBe(false);
    });

    it("grows with the content unless sized by hand", () => {
        const auto = layoutTableCard(table, { ...figure, height: 40 });
        expect(auto.height).toBe(auto.contentHeight);

        const smaller = layoutTableCard(table, {
            ...figure, manualSizing: true, height: 70,
        });
        expect(smaller.height).toBe(70);
        expect(smaller.contentHeight).toBe(auto.contentHeight);

        const larger = layoutTableCard(table, {
            ...figure, manualSizing: true, height: 300,
        });
        expect(larger.height).toBe(300);

        // Never less than the header.
        expect(layoutTableCard(table, {
            ...figure, manualSizing: true, height: 5,
        }).height).toBe(CARD.headerHeight);
    });

    it("hits no item the card's height cuts off", () => {
        const layout = layoutTableCard(table, {
            ...figure, manualSizing: true,
            height: CARD.headerHeight + CARD.padding + CARD.headingHeight
                + CARD.rowHeight + 4,
        });
        const firstRow = CARD.headerHeight + CARD.padding + CARD.headingHeight;

        expect(cardItemAt(layout, 50, firstRow + 1)?.text).toBe("actor_id");
        // The second row is only partly inside: not editable from there.
        expect(cardItemAt(layout, 50, firstRow + CARD.rowHeight + 1))
            .toBeUndefined();
    });

    it("shows only the header of a collapsed figure", () => {
        const layout = layoutTableCard(table, { ...figure, expanded: false });

        expect(layout.items).toHaveLength(1);
        expect(layout.height).toBe(CARD.headerHeight);
    });

    it("shows a figure whose table is unknown by name, not editable", () => {
        const layout = layoutTableCard(undefined, figure, true);

        expect(layout.items[0].editable).toBe(false);
        expect(layout.items).toHaveLength(1);
    });

    it("finds the item under a point", () => {
        const layout = layoutTableCard(table, figure);

        expect(cardItemAt(layout, 50, 10)?.kind).toBe("title");
        const firstRow = CARD.headerHeight + CARD.padding + CARD.headingHeight;
        expect(cardItemAt(layout, 50, firstRow + 1)?.text).toBe("actor_id");
        expect(cardItemAt(layout, 50, firstRow + CARD.rowHeight + 1)?.text)
            .toBe("first_name");
        // In the padding, nothing.
        expect(cardItemAt(layout, 2, firstRow + 1)).toBeUndefined();
    });
});

describe("editRect", () => {
    it("leaves out the icons and the title's triangle", () => {
        const layout = layoutTableCard(table, figure, true);
        const title = editRect(layout.items[0]);

        // Past the table icon: inset 10, icon 15, gap 5; clear of the
        // menu button's place.
        expect(title.left).toBe(30);
        expect(title.left + title.width).toBe(180 - TITLE_RESERVE);
        // Centred in the header.
        expect(title.top + title.height / 2).toBe(CARD.headerHeight / 2);

        const column = layout.items.find((item) => {
            return item.kind === "column";
        })!;
        expect(editRect(column)).toEqual({
            left: column.rect.left + CARD.iconSize + CARD.gap,
            top: column.rect.top,
            width: column.rect.width - CARD.iconSize - CARD.gap,
            height: column.rect.height,
        });
    });
});

describe("contrastingText", () => {
    it("puts black on a light colour and white on a dark one", () => {
        expect(contrastingText("#98BFDA")).toBe("#000000");
        expect(contrastingText("#203040")).toBe("#ffffff");
        expect(contrastingText("nonsense")).toBe("#000000");
    });
});

describe("the other cards", () => {
    it("shows a view's declared columns", () => {
        const view = { ...figure, type: "ViewFigure", view: "totals",
            table: undefined, name: "Totals" };
        const content = viewCardContent({ name: "totals", columns: ["a", "b"] },
            view);
        const layout = layoutCard(content, view);

        expect(layout.items[0]).toMatchObject({ text: "totals", icon: "view",
            editable: false });
        expect(layout.items.slice(1).map((item) => { return item.text; }))
            .toEqual(["Columns", "a", "b"]);
        // A view without a column list is its header.
        expect(layoutCard(viewCardContent({ name: "totals", columns: [] }, view),
            view).items).toHaveLength(1);
        // One the snapshot lacks shows its figure's name.
        expect(viewCardContent(undefined, view).title).toBe("totals");
    });

    it("lists a group's routines on one card", () => {
        const group = { ...figure, type: "RoutineGroupFigure",
            name: "Routines", routines: ["f", "p"] };
        const layout = layoutCard(routineCardContent([
            { name: "f", parameters: [{ name: "a", type: "INT" }],
                returns: "INT" },
            { name: "p", parameters: [], returns: null },
        ], group), group);

        expect(layout.items[0]).toMatchObject({ text: "Routines",
            icon: "routine" });
        expect(layout.items.slice(2).map((item) => { return item.text; }))
            .toEqual(["f(INT): INT", "p()"]);
        expect(layout.items[2].icon).toBe("routine");
    });

    it("lists a table's triggers unless hidden", () => {
        const triggers = [{ name: "actor_bi", timing: "BEFORE",
            events: "INSERT OR UPDATE", table: "actor" }];
        const shown = layoutCard(tableCardContent(table, figure, false,
            triggers), figure);
        const trigger = shown.items.find((item) => {
            return item.kind === "trigger";
        });

        expect(trigger).toMatchObject({ text: "actor_bi",
            detail: "BEFORE INSERT OR UPDATE", icon: "trigger" });
        expect(tableCardContent(table, { ...figure, triggersExpanded: false },
            false, triggers).sections.map((section) => {
            return section.heading;
        })).not.toContain("Triggers");
    });

    it("lists a group's events with their schedules, and a sequence's "
        + "numbers", () => {
        const group = { ...figure, type: "EventGroupFigure", name: "Nightly",
            events: ["purge"] };
        const events = layoutCard(eventCardContent([{ name: "purge",
            schedule: "EVERY 1 DAY" }], group), group);
        expect(events.items[0]).toMatchObject({ text: "Nightly",
            icon: "event" });
        expect(events.items[2]).toMatchObject({ text: "purge",
            detail: "EVERY 1 DAY", icon: "event" });

        const sequence = { ...figure, type: "SequenceFigure", name: "no",
            sequence: "no" };
        const content = sequenceCardContent({ name: "no", type: "BIGINT",
            start: "1000", increment: null, cycle: true }, sequence);
        expect(content.icon).toBe("sequence");
        const texts = (written: IOutlineSequence): string[] => {
            return sequenceCardContent(written, sequence).sections
                .flatMap((section) => {
                    return section.lines.map((line) => { return line.text; });
                });
        };
        // msm's three rows (diagrams.sequence_rows), which it sizes by.
        expect(texts({ name: "no", type: "INT", start: "1000",
            increment: null, cycle: true })).toEqual(
            ["INT", "START WITH 1000", "INCREMENT BY 1"]);
        expect(texts({ name: "no" })).toEqual(
            ["BIGINT", "START WITH 1", "INCREMENT BY 1"]);
        expect(layoutCard(content, { ...sequence, height: undefined }).height)
            .toBe(CARD.headerHeight + 2 * CARD.padding + CARD.headingHeight
                + 3 * CARD.rowHeight);
        expect(sequenceCardContent({ name: "no" },
            { ...sequence, expanded: false }).sections).toEqual([]);
    });

    it("sizes a figure without a width to its content, as msm does", () => {
        const content = tableCardContent(table, figure);
        const width = cardWidth(content);

        // The longest row: padding, icon, gap, "first_name", gap, its type.
        const row = 2 * CARD.padding + CARD.iconSize + CARD.gap
            + estimateText("first_name", "row") + CARD.gap
            + estimateText("VARCHAR(45)", "detail");
        expect(width).toBe(Math.max(MIN_AUTO_WIDTH, Math.ceil(row / 10) * 10));
        expect(layoutCard(content, { ...figure, width: undefined }).width)
            .toBe(width);
        expect(cardWidth({ ...content, title: "x".repeat(200) }))
            .toBe(MAX_AUTO_WIDTH);
        expect(cardWidth({ title: "t", icon: "table", titleEditable: false,
            sections: [] })).toBe(MIN_AUTO_WIDTH);
    });
});

describe("catalogFromModel", () => {
    const model = (): ISchemaModel => {
        return {
            schema: "s",
            tables: [structuredClone(table), {
                name: "film", columns: [{ name: "film_id", type: "INT" }],
                foreign_keys: [],
            }],
            views: [{ name: "Totals" }],
            routines: [{ name: "f" }],
            triggers: [],
            events: [],
            sequences: [],
            diagrams: [],
        };
    };

    it("finds objects by name, whatever the case", () => {
        const catalog = catalogFromModel(model());

        expect(catalog.table("ACTOR")?.columns).toHaveLength(4);
        expect(catalog.view("totals")?.name).toBe("Totals");
        expect(catalog.routine("F")?.name).toBe("f");
        expect(primaryKeyColumns(catalog.table("actor")!))
            .toEqual(new Set(["actor_id"]));
        expect(foreignKeyOf(catalog.table("actor"), "FK_ACTOR_FILM")?.name)
            .toBe("fk_actor_film");
    });

    it("follows a table's rename", () => {
        const catalog = catalogFromModel(model());

        catalog.renameTable("film", "movie");
        expect(catalog.table("film")).toBeUndefined();
        expect(catalog.table("movie")?.name).toBe("movie");
        // The foreign key that pointed at it points at the new name.
        expect(catalog.table("actor")?.foreign_keys?.[0].references.table)
            .toBe("movie");
    });

    it("follows a column's rename, in the keys too", () => {
        const catalog = catalogFromModel(model());

        catalog.renameColumn("film", "FILM_ID", "id");
        catalog.renameColumn("actor", "film_id", "movie_id");
        expect(catalog.table("film")?.columns[0].name).toBe("id");
        const foreignKey = catalog.table("actor")?.foreign_keys?.[0];
        expect(foreignKey?.columns).toEqual(["movie_id"]);
        expect(foreignKey?.references.columns).toEqual(["id"]);
        expect(catalog.table("actor")?.indexes?.[2].columns)
            .toEqual(["movie_id"]);
    });

    it("takes the snapshot msm made after a schema edit", () => {
        const shown = model();
        const catalog = catalogFromModel(shown);

        catalog.replace({ sourceHash: "sha256:new",
            tables: [{ name: "client", columns: [] }], views: [], routines: [],
            triggers: [], events: [], sequences: [] });
        expect(catalog.table("actor")).toBeUndefined();
        expect(catalog.table("client")?.name).toBe("client");
        expect(shown.sourceHash).toBe("sha256:new");
        expect(shown.tables.map((entry) => { return entry.name; }))
            .toEqual(["client"]);
    });
});
