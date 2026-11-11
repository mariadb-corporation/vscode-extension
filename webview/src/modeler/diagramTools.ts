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

import type { IMsmSchemaEdit } from "../../../src/mcp/msmApi.js";
import type { DiagramObjectRef } from "../../../src/modeler/modelerProtocol.js";
import {
    FIGURE_COLORS,
    IMAGE_FIGURE,
    NOTE_FIGURE,
    EVENT_GROUP_FIGURE,
    ROUTINE_GROUP_FIGURE,
    SEQUENCE_FIGURE,
    TABLE_FIGURE,
    VIEW_FIGURE,
    type IModelConnection,
    type IModelDiagram,
    type IModelFigure,
    type IModelLayer,
    type IOutlineColumn,
    type IOutlineForeignKey,
    type IOutlineTable,
} from "../../../src/modeler/modelFormat.js";
import type { IRect } from "../../../src/modeler/pageSettings.js";
import {
    COLUMN_TYPES,
    DEFAULT_COLUMN_TYPE,
    KEY_COLUMN_TYPE,
} from "../../../src/sql/columnTypes.js";
import type {
    EditCommit,
    IEditSpec,
    IProbe,
    IToolSession,
} from "../canvas/canvasTypes.js";
import type { IPoint } from "../canvas/geometry.js";
import type { IUndoableAction, UndoStack } from "../canvas/undoStack.js";
import { sameName, type ISchemaCatalog } from "./catalog.js";
import {
    associativeTableChange,
    existingColumnsChange,
    freeName,
    newEventChange,
    newRoutineChange,
    newSequenceChange,
    newTableChange,
    newTriggerChange,
    newViewChange,
    noPrimaryKey,
    numberedName,
    relationshipChange,
    type IRelationshipKind,
    type ISchemaChange,
} from "./schemaEdits.js";
import { placementOf } from "./placeObjects.js";
import type { ICardItem } from "./tableCard.js";

/**
 * The diagram's tool palette, as Workbench's EER diagram has it: the
 * pointer, hand and zoom of the canvas, the eraser, the layer, text and
 * image tools, the table, view and routine group tools, and the
 * relationship tools. Every tool goes back to the pointer once it placed
 * what it places, as in Workbench; the hints are Workbench's texts.
 *
 * `DiagramTools` is what the tools do, on a figure set seen through
 * `IToolTarget`: what is placed is drawn at once, and recorded as one
 * action of the history - a schema object with the schema edit that makes
 * it, which undoing it takes back.
 */

/** A tool of the palette. */
export interface IDiagramTool {
    id: string;
    /** The tooltip, without its key. */
    title: string;
    /** The key that picks it, as `KeyboardEvent.key` has it. */
    key?: string;
    /** The icon's class. */
    icon: string;
    /** The palette's group, between separators. */
    group: number;
    /** Whether it changes the diagram or the schema: a project's only. */
    edits: boolean;
    /** What the status line says once it is picked. */
    hint: string;
}

/** The tools, in the palette's order. */
export const DIAGRAM_TOOLS: readonly IDiagramTool[] = [
    { id: "pointer", title: "Select Objects", key: "Escape",
        icon: "toolPointer", group: 0, edits: false, hint: "" },
    { id: "hand", title: "Pan (or hold Space)", key: "h", icon: "toolHand",
        group: 0, edits: false, hint: "Drag the canvas to move it around." },
    { id: "zoom", title: "Zoom in; Alt + click to zoom out (or hold Z)",
        icon: "toolZoom", group: 0, edits: false,
        hint: "Click to zoom in, Alt + click to zoom out." },
    { id: "eraser", title: "Delete Object", key: "d", icon: "toolEraser",
        group: 1, edits: true, hint: "Click the object to delete." },
    { id: "layer", title: "Place a New Layer at Selected Area", key: "l",
        icon: "toolLayer", group: 2, edits: true,
        hint: "Select an area for the new layer." },
    { id: "note", title: "Place a New Text Object", key: "n",
        icon: "toolNote", group: 2, edits: true,
        hint: "Select a location for the text object." },
    { id: "image", title: "Place a New Image", key: "i", icon: "toolImage",
        group: 2, edits: true,
        hint: "Select a location for the image object." },
    { id: "table", title: "Place a New Table", key: "t", icon: "toolTable",
        group: 3, edits: true, hint: "Select location for new table." },
    { id: "view", title: "Place a New View", key: "v", icon: "toolView",
        group: 3, edits: true, hint: "Select location for new view." },
    { id: "routineGroup", title: "Place a New Routine Group", key: "g",
        icon: "toolRoutineGroup", group: 3, edits: true,
        hint: "Select location for new routine group." },
    { id: "trigger", title: "Place a New Trigger on a Table", key: "r",
        icon: "toolTrigger", group: 3, edits: true,
        hint: "Select the table to add a trigger to." },
    { id: "eventGroup", title: "Place a New Event Group", key: "e",
        icon: "toolEventGroup", group: 3, edits: true,
        hint: "Select location for new event group." },
    { id: "sequence", title: "Place a New Sequence", key: "q",
        icon: "toolSequence", group: 3, edits: true,
        hint: "Select location for new sequence." },
    { id: "rel11", title: "Place a New 1:1 Non-Identifying Relationship",
        key: "1", icon: "toolRel11", group: 4, edits: true,
        hint: "Select the Table to receive the Foreign Key." },
    { id: "rel1n", title: "Place a New 1:n Non-Identifying Relationship",
        key: "2", icon: "toolRel1n", group: 4, edits: true,
        hint: "Select the Table to receive the Foreign Key." },
    { id: "rel11id", title: "Place a New 1:1 Identifying Relationship",
        key: "3", icon: "toolRel11Id", group: 4, edits: true,
        hint: "Select the Table to receive the Foreign Key." },
    { id: "rel1nid", title: "Place a New 1:n Identifying Relationship",
        key: "4", icon: "toolRel1nId", group: 4, edits: true,
        hint: "Select the Table to receive the Foreign Key." },
    { id: "relnm", title: "Place a New n:m Identifying Relationship",
        key: "5", icon: "toolRelNm", group: 4, edits: true,
        hint: "Select the first Table to be joined." },
    { id: "relpick", title: "Place a Relationship Using Existing Columns",
        key: "6", icon: "toolRelPick", group: 5, edits: true,
        hint: "Select the Table to receive the Foreign Key or the Column(s) "
            + "to turn into a Foreign Key." },
];

/** The relationship tools that add columns, by tool. */
const RELATIONSHIPS: Record<string, IRelationshipKind> = {
    rel11: { many: false, identifying: false },
    rel1n: { many: true, identifying: false },
    rel11id: { many: false, identifying: true },
    rel1nid: { many: true, identifying: true },
};

/** A layer's least size, as Workbench asks for: smaller is a click. */
const MIN_BAND = 5;

/** The colour of a new layer, Workbench's. */
const LAYER_COLOR = "#F0F1FE";

/** The largest side a placed picture gets, in page units. */
const MAX_PICTURE_SIDE = 400;

/** The largest picture placed, as msm's Workbench import takes. */
export const MAX_PICTURE_BYTES = 512 * 1024;

/** What is under the pointer, for the tools. */
export interface IToolHit {
    /** The figure's id, or the layer's. */
    figureId: string;
    /** Whether it is a layer, where no figure is under the pointer. */
    layer?: boolean;
    /** The figure's table, for a table's. */
    table?: string;
    /** The column whose row is under the pointer, if one is. */
    column?: string;
}

/** What is marked while a relationship is drawn. */
export interface IToolHighlight {
    /** The figures picked, and the one under the pointer. */
    figures: string[];
    /** Rows of columns: picked, and the one under the pointer. */
    rows: Array<{ figureId: string; column: string }>;
}

/** The panel of "Place a Relationship Using Existing Columns". */
export interface IToolPanel {
    title: string;
    text: string;
    /** The columns picked: `name TYPE`. */
    columns: string[];
    /** The column whose referenced column is picked next, by index. */
    current?: number;
    /** Whether the button that moves on to the referenced table shows. */
    button: boolean;
}

/** A picture picked to place: a data URL and its own size. */
export interface IPickedImage {
    dataUrl: string;
    width: number;
    height: number;
}

/** An edit in place of an item of a card, as a tool opens it. */
export type IToolEdit = Pick<IEditSpec, "text" | "label" | "placeholder"
    | "choices" | "commit" | "cancel">;

/** The figure set, as the tools see it. */
export interface IToolTarget {
    readonly catalog: ISchemaCatalog;
    readonly history: UndoStack;
    /** @returns The diagram shown. */
    diagram(): IModelDiagram;
    /** @returns The figure under the pointer, and the column row. */
    hit(probe: IProbe): IToolHit | undefined;
    /** @returns The page point under the pointer, on the page's plane. */
    pointOf(probe: IProbe): IPoint | undefined;
    /** @returns Where a figure of the shown diagram is on the page. */
    figureRect(id: string): IRect | undefined;
    /** @returns The figure of the shown diagram, by id. */
    figure(id: string): IModelFigure | undefined;
    /**
     * Adds a figure to the shown diagram and draws it. One without a
     * layer is at a page position, and is filed under the layer it lies
     * on.
     */
    addFigure(figure: IModelFigure): void;
    /** Removes a figure, and returns the connections that went with it. */
    removeFigure(id: string): IModelConnection[];
    /** Adds a layer, which takes the figures lying fully on it. */
    addLayer(layer: IModelLayer): void;
    /** Removes a layer; its figures stay where they are on the page. */
    removeLayer(id: string): void;
    addConnection(connection: IModelConnection): void;
    removeConnection(id: string): void;
    /** Lays every card out again from the catalog. */
    refresh(): void;
    /**
     * Opens an input over an item of a figure's card.
     *
     * @param figureId The figure.
     * @param find Finds the item, in the card as it is laid out then.
     * @param edit The edit.
     */
    editItem(figureId: string, find: (item: ICardItem) => boolean,
        edit: IToolEdit): void;
    highlight(highlight?: IToolHighlight): void;
    /** Shows the area a layer is dragged out over, or no more. */
    band(rect?: IRect): void;
    select(ids: string[]): void;
    hint(text: string): void;
    /** Hands the pointer back to the pointer tool. */
    done(): void;
    /**
     * Sends schema edits, with the shown diagram as it is now.
     *
     * @param edits The edits.
     * @param failed Takes it back where msm refuses it, given msm's
     *               message; without it, a refusal reads the project
     *               again.
     */
    schemaEdit(edits: IMsmSchemaEdit[], failed?: (message: string) => void): void;
    /** Asks for a picture to place; nothing where none was picked. */
    pickImage(): Promise<IPickedImage | undefined>;
    panel(panel?: IToolPanel): void;
}

/**
 * @returns A new id for a figure, a layer or a connection: a UUID, as msm
 *          makes them.
 */
export const newId = (): string => {
    if (typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => { return byte.toString(16).padStart(2, "0"); })
        .join("");

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-`
        + `${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/**
 * @param text What a column's editor holds: `name TYPE`.
 *
 * @returns The name, and the type (empty where none is typed yet).
 */
export const parseColumnText = (text: string): { name: string; type: string } => {
    const trimmed = text.trim();
    const space = trimmed.search(/\s/);

    return space < 0
        ? { name: trimmed, type: "" }
        : { name: trimmed.slice(0, space),
            type: trimmed.slice(space).trim().replace(/\s+/g, " ") };
};

/** What a group figure lists, and how a new member is made. */
interface IGroupMember {
    /**
     * What it is: the name a new one is numbered from, the kind of the
     * card's rows, and what the messages call it.
     */
    kind: "routine" | "event";
    /** The names in use. */
    taken: string[];
    change: (name: string) => ISchemaChange;
    /** What the status line says once it is made. */
    created: (name: string) => string;
    /** Adds it again with a name msm refused, to fix. */
    again: (name: string) => void;
}

/** A table placed whose name and columns are being entered. */
interface IPendingTable {
    figure: IModelFigure;
    columns: IOutlineColumn[];
}

/** Where a relationship being drawn stands. */
interface IRelationshipState {
    tool: string;
    /** The table that receives the foreign key, and its figure. */
    child?: { figureId: string; table: string };
    /** For an existing-columns relationship: its columns, picked. */
    columns: string[];
    /** The referenced table, once a referenced column is picked. */
    parent?: { figureId: string; table: string };
    referenced: string[];
    /** Whether the referenced columns are picked now. */
    picking: "source" | "target";
    /**
     * For an existing-columns relationship whose table was picked rather
     * than columns: a 1:n one with new columns, as in Workbench.
     */
    tableOnly?: boolean;
    hover?: IToolHit;
}

export class DiagramTools {
    readonly #target: IToolTarget;
    #relationship?: IRelationshipState;
    /** A press of the eraser or a placement does nothing else meanwhile. */
    #busy = false;

    public constructor(target: IToolTarget) {
        this.#target = target;
    }

    /**
     * A press with a tool.
     *
     * @param tool The tool.
     * @param probe Where.
     *
     * @returns What follows until the release: a layer's area.
     */
    public down(tool: string, probe: IProbe): IToolSession | undefined {
        if (this.#busy) {
            return undefined;
        }
        if (tool.startsWith("rel")) {
            this.#relationshipDown(tool, probe);

            return undefined;
        }
        const point = this.#target.pointOf(probe);
        switch (tool) {
            case "eraser": {
                this.#erase(probe);
                break;
            }

            case "layer": {
                return point === undefined ? undefined : this.#dragLayer(point);
            }

            case "note": {
                if (point !== undefined) {
                    this.#placeNote(point);
                }
                break;
            }

            case "image": {
                if (point !== undefined) {
                    // Asked for at once: the file dialog needs the press.
                    void this.#placeImage(point, this.#target.pickImage());
                }
                break;
            }

            case "table": {
                if (point !== undefined) {
                    this.#placeTable(point);
                }
                break;
            }

            case "view": {
                if (point !== undefined) {
                    this.#placeView(point);
                }
                break;
            }

            case "routineGroup": {
                if (point !== undefined) {
                    this.#placeRoutineGroup(point);
                }
                break;
            }

            case "eventGroup": {
                if (point !== undefined) {
                    this.#placeEventGroup(point);
                }
                break;
            }

            case "sequence": {
                if (point !== undefined) {
                    this.#placeSequence(point);
                }
                break;
            }

            case "trigger": {
                const hit = this.#target.hit(probe);
                const figure = hit === undefined || hit.layer === true
                    ? undefined : this.#target.figure(hit.figureId);
                if (figure?.table === undefined) {
                    this.#target.hint("Select a table to add a trigger to.");
                } else {
                    this.#addTrigger(figure.id);
                }
                break;
            }

            default:
        }

        return undefined;
    }

    /**
     * The pointer moved with a tool, unpressed: a relationship tool marks
     * the table, or the column, under it.
     *
     * @param tool The tool.
     * @param probe Where.
     */
    public hover(tool: string, probe: IProbe): void {
        if (!tool.startsWith("rel")) {
            return;
        }
        const hit = this.#target.hit(probe);
        const state = this.#relationship ?? this.#startRelationship(tool);
        const hover = hit?.table === undefined ? undefined
            : tool === "relpick" ? hit : { ...hit, column: undefined };
        if (hover?.figureId !== state.hover?.figureId
            || hover?.column !== state.hover?.column) {
            state.hover = hover;
            this.#highlight();
        }
    }

    /** The tool was put down: a relationship half drawn ends. */
    public cancel(): void {
        const state = this.#relationship;
        this.#relationship = undefined;
        this.#target.highlight(undefined);
        this.#target.band(undefined);
        this.#target.panel(undefined);
        if (state?.child !== undefined) {
            this.#target.hint("Cancelled.");
        }
    }

    // --- Diagram objects --------------------------------------------------

    /** Records adding a figure of the diagram alone, and selects it. */
    #placeFigure(figure: IModelFigure, label: string): void {
        const target = this.#target;
        target.history.execute({
            label,
            redo: () => { target.addFigure(figure); },
            undo: () => { target.removeFigure(figure.id); },
        });
        target.select([figure.id]);
        target.hint(`Placed ${figure.name}`);
        target.done();
    }

    /**
     * Places objects the schema has already: dropped from a tree, or added
     * with a row's Add to Diagram. One action of the history; a table
     * comes with the connections of its foreign keys to the tables shown.
     *
     * @param refs The objects.
     * @param point Where the first goes; the others follow in rows.
     *
     * @returns Nothing.
     */
    public placeObjects(refs: readonly DiagramObjectRef[], point: IPoint): void {
        const target = this.#target;
        const { figures, connections, skipped } = placementOf(refs,
            target.diagram(), target.catalog.objects(), point, newId);
        const why = skipped.length === 0 ? ""
            : ` Not placed: ${skipped.join("; ")}.`;
        if (figures.length === 0) {
            target.hint(why.trim());

            return;
        }
        const names = figures.map((figure) => { return figure.name; });
        target.history.execute({
            label: names.length === 1
                ? `Place ${names[0]}` : `Place ${names.length} Objects`,
            redo: () => {
                for (const figure of figures) {
                    target.addFigure(figure);
                }
                for (const connection of connections) {
                    target.addConnection(connection);
                }
            },
            undo: () => {
                for (const connection of connections) {
                    target.removeConnection(connection.id);
                }
                for (const figure of figures) {
                    target.removeFigure(figure.id);
                }
            },
        });
        target.select(figures.map((figure) => { return figure.id; }));
        target.hint(`Placed ${names.join(", ")}.${why}`);
    }

    #placeNote(point: IPoint): void {
        const name = this.#figureName("text");
        this.#placeFigure({
            id: newId(),
            type: NOTE_FIGURE,
            name,
            left: Math.round(point.x),
            top: Math.round(point.y),
            text: "Text",
            color: FIGURE_COLORS[NOTE_FIGURE],
        }, `Place Text Object ${name}`);
    }

    async #placeImage(
        point: IPoint,
        picking: Promise<IPickedImage | undefined>,
    ): Promise<void> {
        this.#busy = true;
        try {
            const picked = await picking;
            if (picked === undefined) {
                this.#target.done();

                return;
            }
            const scale = Math.min(1,
                MAX_PICTURE_SIDE / Math.max(picked.width, picked.height, 1));
            const name = this.#figureName("image");
            this.#placeFigure({
                id: newId(),
                type: IMAGE_FIGURE,
                name,
                left: Math.round(point.x),
                top: Math.round(point.y),
                width: Math.max(1, Math.round(picked.width * scale)),
                height: Math.max(1, Math.round(picked.height * scale)),
                image: picked.dataUrl,
                keepAspectRatio: true,
            }, `Place Image ${name}`);
        } catch (error) {
            this.#target.hint(error instanceof Error ? error.message
                : String(error));
            this.#target.done();
        } finally {
            this.#busy = false;
        }
    }

    #dragLayer(start: IPoint): IToolSession {
        const target = this.#target;
        const rectTo = (point: IPoint): IRect => {
            return {
                left: Math.min(start.x, point.x),
                top: Math.min(start.y, point.y),
                width: Math.abs(point.x - start.x),
                height: Math.abs(point.y - start.y),
            };
        };
        let rect: IRect = { left: start.x, top: start.y, width: 0, height: 0 };

        return {
            move: (probe) => {
                const point = target.pointOf(probe);
                if (point !== undefined) {
                    rect = rectTo(point);
                    target.band(rect);
                }
            },
            finish: (probe) => {
                const point = target.pointOf(probe);
                if (point !== undefined) {
                    rect = rectTo(point);
                }
                target.band(undefined);
                if (rect.width < MIN_BAND || rect.height < MIN_BAND) {
                    target.hint("Please select a larger area.");

                    return;
                }
                const layer: IModelLayer = {
                    id: newId(),
                    name: "New Layer",
                    left: Math.round(rect.left),
                    top: Math.round(rect.top),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                    color: LAYER_COLOR,
                    figures: [],
                };
                target.history.execute({
                    label: "Place New Layer",
                    redo: () => { target.addLayer(layer); },
                    undo: () => { target.removeLayer(layer.id); },
                });
                target.select([layer.id]);
                target.hint("Created new layer.");
                target.done();
            },
        };
    }

    #erase(probe: IProbe): void {
        const target = this.#target;
        const hit = target.hit(probe);
        if (hit === undefined) {
            return;
        }
        if (hit.layer === true) {
            const layer = target.diagram().layers.find((entry) => {
                return entry.id === hit.figureId;
            });
            if (layer !== undefined) {
                // Its figures stay where they are on the page.
                target.history.execute({
                    label: `Delete Layer ${layer.name}`,
                    redo: () => { target.removeLayer(layer.id); },
                    undo: () => { target.addLayer(layer); },
                });
                target.hint(`Removed the layer ${layer.name}.`);
            }

            return;
        }
        const figure = target.figure(hit.figureId);
        if (figure === undefined) {
            return;
        }
        // The figure goes, not the object it shows: the SQL keeps it.
        let connections: IModelConnection[] = [];
        target.history.execute({
            label: `Delete ${figure.name}`,
            redo: () => { connections = target.removeFigure(figure.id); },
            undo: () => {
                target.addFigure(figure);
                for (const connection of connections) {
                    target.addConnection(connection);
                }
            },
        });
        target.hint(`Removed ${figure.name} from the diagram.`);
    }

    // --- Schema objects ----------------------------------------------------

    /**
     * Makes a schema change that places nothing, such as a relationship's
     * new kind: shown at once, sent, and undoable as the tools' are.
     *
     * @param change The change.
     */
    public changeSchema(change: ISchemaChange): void {
        const target = this.#target;
        target.catalog.edit(change.edits);
        target.refresh();
        this.#recordSchemaChange(change, () => { /* nothing placed */ },
            () => { /* nothing to take away */ });
    }

    /**
     * Records a schema change already shown, and sends it: undone, the
     * figures go and the inverse edits are sent; redone, both again.
     *
     * @param change The change.
     * @param show Shows what the change places (its figures).
     * @param hide Takes that away.
     * @param reopen Where msm refuses the change: takes what was typed up
     *               again instead of just taking the change back (the
     *               action is out of the history either way).
     */
    #recordSchemaChange(
        change: ISchemaChange,
        show: () => void,
        hide: () => void,
        reopen?: (message: string) => void,
    ): void {
        const target = this.#target;
        const action: IUndoableAction = {
            label: change.label,
            undo: () => {
                hide();
                target.catalog.edit(change.inverse);
                target.refresh();
                target.schemaEdit(change.inverse);
            },
            redo: () => {
                target.catalog.edit(change.edits);
                show();
                target.refresh();
                target.schemaEdit(change.edits);
            },
        };
        // msm makes an edit whole or not at all: a refused one left the
        // SQL as it was, which the viewer goes back to, its history and
        // view kept.
        target.schemaEdit(change.edits, (message) => {
            target.history.discard(action);
            if (reopen === undefined) {
                this.#takeBack(change, hide, message);
            } else {
                reopen(message);
            }
        });
        target.history.record(action);
    }

    /**
     * Takes back a schema change msm refused: what it showed goes, and the
     * status line says why.
     *
     * @param change The change.
     * @param hide Takes away what it placed.
     * @param message msm's message.
     */
    #takeBack(change: ISchemaChange, hide: () => void, message: string): void {
        const target = this.#target;
        hide();
        target.catalog.edit(change.inverse);
        target.refresh();
        target.hint(message);
    }

    /** @returns The names tables and views share, taken. */
    #relationNames(): string[] {
        const { tables, views, sequences } = this.#target.catalog.objects();

        return [...tables, ...views, ...sequences].map((object) => {
            return object.name;
        });
    }

    /**
     * @param base The name a new figure is numbered from.
     *
     * @returns The first numbered name no figure of the diagram has.
     */
    #figureName(base: string): string {
        return numberedName(base, this.#target.diagram().figures.map((figure) => {
            return figure.name;
        }));
    }

    #placeTable(point: IPoint): void {
        const target = this.#target;
        const name = numberedName("table", this.#relationNames());
        const figure: IModelFigure = {
            id: newId(),
            type: TABLE_FIGURE,
            name,
            table: name,
            left: Math.round(point.x),
            top: Math.round(point.y),
        };
        // Shown at once, with a row for the first column's editor; made
        // in the SQL once its columns are entered.
        target.catalog.edit([{ op: "add_table",
            table: { name, columns: [{ name: "", type: "" }] } }]);
        target.addFigure(figure);
        target.select([figure.id]);
        target.done();
        target.hint("Type the table's name, then Enter.");
        this.#editTableName({ figure, columns: [] });
    }

    /** Drops a table placed before it was made. */
    #dropPendingTable(pending: IPendingTable): void {
        const target = this.#target;
        target.removeFigure(pending.figure.id);
        target.catalog.edit([{ op: "drop_table",
            table: pending.figure.table }]);
        target.refresh();
    }

    #editTableName(pending: IPendingTable): void {
        const target = this.#target;
        const { figure } = pending;
        target.editItem(figure.id, (item) => { return item.kind === "title"; }, {
            text: figure.table ?? figure.name,
            label: "Table name",
            commit: (text) => {
                const name = text.trim();
                const old = figure.table ?? figure.name;
                if (name === "") {
                    this.#dropPendingTable(pending);
                    target.hint("");

                    return;
                }
                if (!sameName(name, old) && this.#relationNames().some(
                    (taken) => { return sameName(taken, name); })) {
                    target.hint(`A table or view named ${name} exists already.`);
                    this.#editTableName(pending);

                    return;
                }
                target.catalog.renameTable(old, name);
                figure.name = name;
                figure.table = name;
                this.#relayoutPending(pending);
                target.hint("Type a column's name and its type; Enter on an "
                    + "empty name or Escape ends the table.");
                this.#editColumn(pending);
            },
            cancel: () => {
                this.#dropPendingTable(pending);
                target.hint("");
            },
        });
    }

    /** Lays the table being entered out again, as wide as it needs. */
    #relayoutPending(pending: IPendingTable): void {
        delete pending.figure.width;
        this.#target.refresh();
    }

    /**
     * Opens the editor of a column of the table being entered: the next
     * one, in the empty row, or one entered already (msm refused it).
     *
     * @param pending The table.
     * @param at The column entered already, by index.
     */
    #editColumn(pending: IPendingTable, at?: number): void {
        const target = this.#target;
        const { figure } = pending;
        const entered = at === undefined ? undefined : pending.columns[at];
        const index = at ?? pending.columns.length;
        // The first column is the key, `id UUID`; the next ones are
        // VARCHAR(45) until another type is picked.
        const type = index === 0 ? KEY_COLUMN_TYPE : DEFAULT_COLUMN_TYPE;
        target.editItem(figure.id, (item) => {
            return item.kind === "column" && item.text === (entered?.name ?? "");
        }, {
            text: entered !== undefined ? `${entered.name} ${entered.type}`
                : index === 0 ? `id ${KEY_COLUMN_TYPE}` : "",
            label: "Column name and type",
            placeholder: "column_name TYPE",
            choices: { items: COLUMN_TYPES, preferred: type },
            commit: (text, how) => {
                this.#columnEntered(pending, text, how, at);
            },
            cancel: () => { this.#finishTable(pending); },
        });
    }

    /**
     * Takes a column typed into the table being entered.
     *
     * @param pending The table.
     * @param text The column's `name TYPE`.
     * @param how By Enter, or by leaving the input.
     * @param at The column entered already that it replaces, by index.
     */
    #columnEntered(
        pending: IPendingTable,
        text: string,
        how: EditCommit,
        at?: number,
    ): void {
        const target = this.#target;
        const { name, type } = parseColumnText(text);
        const table = target.catalog.table(pending.figure.table ?? "");
        const next = (): void => {
            this.#relayoutPending(pending);
            if (how === "blur") {
                this.#finishTable(pending);
            } else {
                this.#editColumn(pending);
            }
        };
        if (name === "") {
            if (at === undefined) {
                this.#finishTable(pending);
            } else {
                // A column emptied goes.
                pending.columns.splice(at, 1);
                table?.columns.splice(at, 1);
                next();
            }

            return;
        }
        if (pending.columns.some((column, index) => {
            return index !== at && sameName(column.name, name);
        })) {
            target.hint(`The table has a column ${name} already.`);
            this.#editColumn(pending, at);

            return;
        }
        const index = at ?? pending.columns.length;
        const column: IOutlineColumn = {
            name,
            type: type !== "" ? type
                : index === 0 ? KEY_COLUMN_TYPE : DEFAULT_COLUMN_TYPE,
            nullable: index === 0 ? false : undefined,
        };
        if (at === undefined) {
            pending.columns.push(column);
            // Before the empty row the next column is entered in.
            table?.columns.splice(table.columns.length - 1, 0, { ...column });
        } else {
            pending.columns[at] = column;
            table?.columns.splice(at, 1, { ...column });
        }
        next();
    }

    /** Makes the table entered: in the SQL, and as one action. */
    #finishTable(pending: IPendingTable): void {
        const target = this.#target;
        const { figure } = pending;
        const name = figure.table ?? figure.name;
        if (pending.columns.length === 0) {
            // A table needs a column: none entered, none made.
            this.#dropPendingTable(pending);
            target.hint("");

            return;
        }
        const change = newTableChange(name, pending.columns);
        target.catalog.edit([{ op: "drop_table", table: name },
            ...change.edits]);
        this.#relayoutPending(pending);
        this.#recordSchemaChange(change,
            () => { target.addFigure(figure); },
            () => { target.removeFigure(figure.id); },
            (message) => { this.#reopenTable(pending, message); });
        target.hint(`Table '${name}' created.`);
    }

    /**
     * Takes up a table msm refused, as it was entered: a column it names
     * (a type it does not know) is edited again, else the table's name.
     * Nothing typed is lost; Enter on the empty row, or Escape, sends it
     * again.
     *
     * @param pending The table.
     * @param message Why msm refused it, as "column `price`: ...".
     */
    #reopenTable(pending: IPendingTable, message: string): void {
        const target = this.#target;
        const { figure } = pending;
        const name = figure.table ?? figure.name;
        target.catalog.edit([
            { op: "drop_table", table: name },
            { op: "add_table", table: { name, columns: [
                ...pending.columns.map((column) => { return { ...column }; }),
                { name: "", type: "" },
            ] } },
        ]);
        if (target.figure(figure.id) === undefined) {
            target.addFigure(figure);
        }
        this.#relayoutPending(pending);
        target.hint(message);
        // msm passes the language server's message on, after its own
        // words: "... could not be made (bad-request): column `price`: ...".
        const column = /column `([^`]+)`:/.exec(message)?.[1];
        const at = column === undefined ? -1 : pending.columns.findIndex(
            (entry) => { return sameName(entry.name, column); });
        if (at >= 0) {
            this.#editColumn(pending, at);
        } else {
            this.#editTableName(pending);
        }
    }

    /**
     * Places a view and opens its name.
     *
     * @param point Where.
     * @param text The name to show in the editor: the one msm refused.
     */
    #placeView(point: IPoint, text?: string): void {
        const target = this.#target;
        const name = numberedName("view", this.#relationNames());
        const figure: IModelFigure = {
            id: newId(),
            type: VIEW_FIGURE,
            name,
            view: name,
            left: Math.round(point.x),
            top: Math.round(point.y),
        };
        target.catalog.edit([{ op: "add_view",
            view: { name, definition: "SELECT 1" } }]);
        target.addFigure(figure);
        target.select([figure.id]);
        target.done();
        const drop = (): void => {
            target.removeFigure(figure.id);
            target.catalog.edit([{ op: "drop_view", view: figure.view }]);
            target.refresh();
            target.hint("");
        };
        target.editItem(figure.id, (item) => { return item.kind === "title"; }, {
            text: text ?? name,
            label: "View name",
            commit: (text) => {
                const entered = text.trim();
                if (entered === "") {
                    drop();

                    return;
                }
                if (!sameName(entered, name) && this.#relationNames().some(
                    (taken) => { return sameName(taken, entered); })) {
                    target.hint(`A table or view named ${entered} exists `
                        + "already.");
                    drop();

                    return;
                }
                const change = newViewChange(entered);
                target.catalog.edit([{ op: "drop_view", view: name },
                    ...change.edits]);
                figure.name = entered;
                figure.view = entered;
                target.refresh();
                const hide = (): void => { target.removeFigure(figure.id); };
                this.#recordSchemaChange(change,
                    () => { target.addFigure(figure); },
                    hide,
                    (message) => {
                        // Placed again where it was, its name to fix.
                        const rect = target.figureRect(figure.id);
                        this.#takeBack(change, hide, message);
                        if (rect !== undefined) {
                            this.#placeView({ x: rect.left, y: rect.top },
                                entered);
                            target.hint(message);
                        }
                    });
                target.hint(`View '${entered}' created; its SELECT is to be `
                    + "written in the SQL.");
            },
            cancel: drop,
        });
    }

    #placeRoutineGroup(point: IPoint): void {
        this.#placeGroup(point, ROUTINE_GROUP_FIGURE, "routines", "Routine");
    }

    #placeEventGroup(point: IPoint): void {
        this.#placeGroup(point, EVENT_GROUP_FIGURE, "events", "Event");
    }

    /**
     * Places an empty group, its name entered in place: a figure of the
     * diagram alone, its routines or events added from its menu.
     *
     * @param point Where.
     * @param type The figure's type.
     * @param member What it lists.
     * @param what What it is a group of, for the labels.
     */
    #placeGroup(point: IPoint, type: string, member: "routines" | "events",
        what: string): void {
        const target = this.#target;
        const name = this.#figureName(member);
        const figure: IModelFigure = {
            id: newId(),
            type,
            name,
            [member]: [],
            left: Math.round(point.x),
            top: Math.round(point.y),
        };
        target.addFigure(figure);
        target.select([figure.id]);
        target.done();
        target.editItem(figure.id, (item) => { return item.kind === "title"; }, {
            text: name,
            label: `${what} group name`,
            commit: (text) => {
                figure.name = text.trim() === "" ? name : text.trim();
                target.refresh();
                target.removeFigure(figure.id);
                this.#placeFigure(figure, `Place ${what} Group ${figure.name}`);
            },
            cancel: () => {
                target.removeFigure(figure.id);
                target.hint("");
            },
        });
    }

    /**
     * Adds a new procedure to a routine group: its name entered in place,
     * then made in the SQL.
     *
     * @param figureId The routine group's figure.
     * @param text The name to show in the editor: the one msm refused.
     */
    public addRoutine(figureId: string, text?: string): void {
        this.#addMember(figureId, {
            kind: "routine",
            taken: this.#target.catalog.objects().routines.map((routine) => {
                return routine.name;
            }),
            change: newRoutineChange,
            created: (name) => {
                return `Procedure '${name}' created; its body is to be `
                    + "written in the SQL.";
            },
            again: (name) => { this.addRoutine(figureId, name); },
        }, text);
    }

    /**
     * Adds a new event to an event group: its name entered in place, then
     * made in the SQL, run every day until its schedule is written.
     *
     * @param figureId The event group's figure.
     * @param text The name to show in the editor: the one msm refused.
     */
    public addEvent(figureId: string, text?: string): void {
        this.#addMember(figureId, {
            kind: "event",
            taken: this.#target.catalog.objects().events.map(
                (event) => { return event.name; }),
            change: newEventChange,
            created: (name) => {
                return `Event '${name}' created; its schedule and body are `
                    + "to be written in the SQL.";
            },
            again: (name) => { this.addEvent(figureId, name); },
        }, text);
    }

    /**
     * Adds a new object to a group's figure: it stands in the catalog
     * while its name is entered in place, then is made in the SQL.
     *
     * @param figureId The group's figure.
     * @param spec What the group lists, and how a new one is made.
     * @param text The name to show in the editor: the one msm refused.
     */
    #addMember(figureId: string, spec: IGroupMember, text?: string): void {
        const target = this.#target;
        const figure = target.figure(figureId);
        if (figure === undefined) {
            return;
        }
        const member = spec.kind === "routine" ? "routines" : "events";
        const name = numberedName(spec.kind, spec.taken);
        // By name: other members may come and go meanwhile.
        let shown = name;
        const show = (entry: string): void => {
            shown = entry;
            const members = figure[member] ?? [];
            if (!members.some((other) => { return sameName(other, entry); })) {
                figure[member] = [...members, entry];
            }
        };
        const hide = (): void => {
            figure[member] = (figure[member] ?? []).filter(
                (other) => { return !sameName(other, shown); });
        };
        // Stands in the catalog while its name is entered.
        const placeholder = spec.change(name);
        target.catalog.edit(placeholder.edits);
        show(name);
        target.refresh();
        target.editItem(figureId, (item) => {
            // `routine1(` or `event1`: not `routine10(`'s or `event10`'s row.
            return item.kind === spec.kind && (item.text === name
                || item.text.startsWith(`${name}(`));
        }, {
            text: text ?? name,
            label: `${spec.kind[0]!.toUpperCase()}${spec.kind.slice(1)} name`,
            commit: (text) => {
                const entered = text.trim();
                target.catalog.edit(placeholder.inverse);
                if (entered === "" || (!sameName(entered, name)
                    && spec.taken.some((other) => {
                        return sameName(other, entered);
                    }))) {
                    hide();
                    target.refresh();
                    target.hint(entered === "" ? ""
                        : `A ${spec.kind} named ${entered} exists already.`);

                    return;
                }
                const change = spec.change(entered);
                target.catalog.edit(change.edits);
                // The placeholder's row goes; the routine's comes.
                hide();
                show(entered);
                target.refresh();
                this.#recordSchemaChange(change,
                    () => { show(entered); },
                    hide,
                    (message) => {
                        this.#takeBack(change, hide, message);
                        spec.again(entered);
                        target.hint(message);
                    });
                target.hint(spec.created(entered));
            },
            cancel: () => {
                target.catalog.edit(placeholder.inverse);
                hide();
                target.refresh();
            },
        });
    }

    /**
     * Adds a new trigger to the table a figure shows: BEFORE INSERT, its
     * name entered in place in the card's Triggers section, then made in
     * the SQL.
     *
     * @param figureId The table's figure.
     * @param text The name to show in the editor: the one msm refused.
     */
    #addTrigger(figureId: string, text?: string): void {
        const target = this.#target;
        const figure = target.figure(figureId);
        const table = figure?.table;
        if (figure === undefined || table === undefined) {
            return;
        }
        const taken = target.catalog.objects().triggers.map(
            (trigger) => { return trigger.name; });
        const name = freeName(`${table}_BEFORE_INSERT`, taken);
        // The section shows the new trigger to name.
        figure.triggersExpanded = undefined;
        const placeholder = newTriggerChange(table, name);
        target.catalog.edit(placeholder.edits);
        target.refresh();
        target.done();
        target.editItem(figureId, (item) => {
            return item.kind === "trigger" && item.text === name;
        }, {
            text: text ?? name,
            label: "Trigger name",
            commit: (text) => {
                const entered = text.trim();
                target.catalog.edit(placeholder.inverse);
                if (entered === "" || (!sameName(entered, name)
                    && taken.some((other) => { return sameName(other, entered); }))) {
                    target.refresh();
                    target.hint(entered === "" ? ""
                        : `A trigger named ${entered} exists already.`);

                    return;
                }
                const change = newTriggerChange(table, entered);
                target.catalog.edit(change.edits);
                target.refresh();
                this.#recordSchemaChange(change, () => { /* in the card */ },
                    () => { /* the catalog takes it back */ },
                    (message) => {
                        this.#takeBack(change, () => { /* nothing placed */ },
                            message);
                        this.#addTrigger(figureId, entered);
                        target.hint(message);
                    });
                target.hint(`Trigger '${entered}' created on ${table}; when it `
                    + "fires and its body are to be written in the SQL.");
            },
            cancel: () => {
                target.catalog.edit(placeholder.inverse);
                target.refresh();
            },
        });
    }

    /**
     * Places a new sequence, its name entered in place, then made in the
     * SQL. Sequences share their names with tables and views.
     *
     * @param point Where.
     * @param text The name to show in the editor: the one msm refused.
     */
    #placeSequence(point: IPoint, text?: string): void {
        const target = this.#target;
        const name = numberedName("sequence", this.#relationNames());
        const figure: IModelFigure = {
            id: newId(),
            type: SEQUENCE_FIGURE,
            name,
            sequence: name,
            left: Math.round(point.x),
            top: Math.round(point.y),
        };
        const placeholder = newSequenceChange(name);
        target.catalog.edit(placeholder.edits);
        target.addFigure(figure);
        target.select([figure.id]);
        target.done();
        const drop = (): void => {
            target.removeFigure(figure.id);
            target.catalog.edit(placeholder.inverse);
            target.refresh();
        };
        target.editItem(figure.id, (item) => { return item.kind === "title"; }, {
            text: text ?? name,
            label: "Sequence name",
            commit: (text) => {
                const entered = text.trim();
                if (entered === "") {
                    drop();
                    target.hint("");

                    return;
                }
                if (!sameName(entered, name) && this.#relationNames().some(
                    (taken) => { return sameName(taken, entered); })) {
                    drop();
                    target.hint(`A table, view or sequence named ${entered} `
                        + "exists already.");

                    return;
                }
                const change = newSequenceChange(entered);
                target.catalog.edit([...placeholder.inverse, ...change.edits]);
                figure.name = entered;
                figure.sequence = entered;
                target.refresh();
                const hide = (): void => { target.removeFigure(figure.id); };
                this.#recordSchemaChange(change,
                    () => { target.addFigure(figure); },
                    hide,
                    (message) => {
                        const rect = target.figureRect(figure.id);
                        this.#takeBack(change, hide, message);
                        if (rect !== undefined) {
                            this.#placeSequence({ x: rect.left, y: rect.top },
                                entered);
                            target.hint(message);
                        }
                    });
                target.hint(`Sequence '${entered}' created.`);
            },
            cancel: () => {
                drop();
                target.hint("");
            },
        });
    }

    // --- Relationships -------------------------------------------------------

    #startRelationship(tool: string): IRelationshipState {
        const state: IRelationshipState = { tool, columns: [], referenced: [],
            picking: "source" };
        this.#relationship = state;
        if (tool === "relpick") {
            this.#showPanel(state);
        }

        return state;
    }

    /** Marks what is picked, and what is under the pointer. */
    #highlight(): void {
        const state = this.#relationship;
        if (state === undefined) {
            this.#target.highlight(undefined);

            return;
        }
        const figures = [state.child?.figureId, state.parent?.figureId,
            state.hover?.figureId].filter((id): id is string => {
            return id !== undefined;
        });
        const rows = [
            ...state.columns.map((column) => {
                return { figureId: state.child!.figureId, column };
            }),
            ...state.referenced.map((column) => {
                return { figureId: state.parent!.figureId, column };
            }),
            ...state.hover?.column === undefined ? []
                : [{ figureId: state.hover.figureId, column: state.hover.column }],
        ];
        this.#target.highlight({ figures, rows });
    }

    #showPanel(state: IRelationshipState): void {
        const table = state.child === undefined ? undefined
            : this.#target.catalog.table(state.child.table);
        const columns = state.columns.map((name) => {
            const type = table?.columns.find((column) => {
                return sameName(column.name, name);
            })?.type ?? "";

            return `${name} ${type.slice(0, 20)}`.trim();
        });
        this.#target.panel(state.picking === "source"
            ? {
                title: "Foreign Key Columns",
                text: "Pick one or more columns for the foreign key.",
                columns,
                button: state.columns.length > 0,
            }
            : {
                title: "Referenced Columns",
                text: "Pick matching columns for the referenced table.",
                columns,
                current: state.referenced.length,
                button: false,
            });
    }

    /**
     * Moves an existing-columns relationship on to its referenced table:
     * the panel's "Pick Referenced Columns".
     */
    public pickReferenced(): void {
        const state = this.#relationship;
        if (state === undefined || state.columns.length === 0) {
            return;
        }
        state.picking = "target";
        this.#showPanel(state);
        this.#target.hint("Please pick referenced columns or table.");
    }

    #relationshipDown(tool: string, probe: IProbe): void {
        const target = this.#target;
        const state = this.#relationship?.tool === tool
            ? this.#relationship
            : this.#startRelationship(tool);
        const hit = target.hit(probe);
        const table = hit?.table === undefined ? undefined
            : target.catalog.table(hit.table);
        if (tool === "relpick" && state.tableOnly !== true) {
            this.#pickColumn(state, hit);

            return;
        }
        if (state.child === undefined) {
            if (hit?.table === undefined || table === undefined) {
                target.hint(tool === "relnm"
                    ? "Please select the first table to be joined."
                    : "Please select the table to receive the Foreign Key.");

                return;
            }
            if (tool === "relnm" && !(table.indexes ?? []).some((index) => {
                return index.kind === "primary";
            })) {
                target.hint(noPrimaryKey(table));

                return;
            }
            state.child = { figureId: hit.figureId, table: table.name };
            this.#highlight();
            target.hint(tool === "relnm"
                ? `'${table.name}' selected. Please select the second Table.`
                : `'${table.name}' selected. Please select the Referenced `
                    + "Table.");

            return;
        }
        if (hit?.table === undefined || table === undefined) {
            target.hint(tool === "relnm"
                ? "Please select the second table."
                : "Please select the referenced table.");

            return;
        }
        const child = target.catalog.table(state.child.table);
        if (child === undefined) {
            this.cancel();

            return;
        }
        const tables = target.catalog.objects().tables;
        if (tool === "relnm") {
            const result = associativeTableChange(child, table, tables);
            if ("error" in result) {
                target.hint(result.error);

                return;
            }
            this.#joinThrough(state.child.figureId, hit.figureId, result.table,
                result.change);

            return;
        }
        const kind = RELATIONSHIPS[tool] ?? RELATIONSHIPS.rel1n!;
        const result = relationshipChange(child, table, kind, tables);
        if ("error" in result) {
            target.hint(result.error);

            return;
        }
        this.#connect(state.child.figureId, hit.figureId, child.name,
            result.foreignKey.name, result.change, table.name);
    }

    #pickColumn(state: IRelationshipState, hit: IToolHit | undefined): void {
        const target = this.#target;
        if (hit?.table === undefined) {
            target.hint(state.picking === "source" && state.columns.length === 0
                ? "Select the Table to receive the Foreign Key or the "
                    + "Column(s) to turn into a Foreign Key."
                : "Please pick the referenced column.");

            return;
        }
        if (state.picking === "source") {
            if (hit.column === undefined) {
                if (state.columns.length === 0) {
                    // The table alone: a 1:n relationship with new columns.
                    state.tableOnly = true;
                    state.child = { figureId: hit.figureId, table: hit.table };
                    target.panel(undefined);
                    this.#highlight();
                    target.hint(`'${hit.table}' selected. Please select the `
                        + "Referenced Table.");
                } else {
                    target.hint("Pick other columns that belong to the Foreign "
                        + "Key or proceed to pick the referenced table or "
                        + "matching columns in it.");
                }

                return;
            }
            if (state.child === undefined) {
                state.child = { figureId: hit.figureId, table: hit.table };
            } else if (state.child.figureId !== hit.figureId) {
                if (state.columns.length === 1) {
                    // One column, then one of another table: that is the
                    // referenced column, as in Workbench.
                    state.picking = "target";
                    this.#pickReferencedColumn(state, hit);
                } else {
                    target.hint("Foreign Key columns must belong to the same "
                        + "table.");
                }

                return;
            }
            if (state.columns.some((column) => { return sameName(column, hit.column); })) {
                target.hint("Column has already been picked, please pick "
                    + "another or pick the referenced table.");

                return;
            }
            state.columns.push(hit.column);
            this.#highlight();
            this.#showPanel(state);
            target.hint(`Column '${hit.column}' selected.`);

            return;
        }
        this.#pickReferencedColumn(state, hit);
    }

    #pickReferencedColumn(state: IRelationshipState, hit: IToolHit): void {
        const target = this.#target;
        if (hit.column === undefined || hit.table === undefined) {
            target.hint("Please pick the referenced column.");

            return;
        }
        if (state.parent === undefined) {
            state.parent = { figureId: hit.figureId, table: hit.table };
        } else if (state.parent.figureId !== hit.figureId) {
            target.hint("Referenced columns must belong to the same table.");

            return;
        }
        state.referenced.push(hit.column);
        this.#highlight();
        this.#showPanel(state);
        target.hint(`Column '${hit.column}' selected.`);
        if (state.referenced.length < state.columns.length) {
            return;
        }
        const child = target.catalog.table(state.child!.table);
        const parent = target.catalog.table(state.parent.table);
        if (child === undefined || parent === undefined) {
            this.cancel();

            return;
        }
        const { change, foreignKey } = existingColumnsChange(child,
            state.columns, parent, state.referenced,
            target.catalog.objects().tables);
        this.#connect(state.child!.figureId, state.parent.figureId, child.name,
            foreignKey.name, change, parent.name);
    }

    /** Makes a relationship between two figures' tables, and draws it. */
    #connect(
        childFigure: string,
        parentFigure: string,
        child: string,
        foreignKey: string,
        change: ISchemaChange,
        parent: string,
    ): void {
        const target = this.#target;
        const connection: IModelConnection = {
            id: newId(),
            foreignKey,
            table: child,
            startFigure: childFigure,
            endFigure: parentFigure,
            visible: true,
        };
        target.catalog.edit(change.edits);
        target.refresh();
        target.addConnection(connection);
        this.#recordSchemaChange(change,
            () => { target.addConnection(connection); },
            () => { target.removeConnection(connection.id); });
        this.#endRelationship(`Relationship between '${child}' and `
            + `'${parent}' created.`);
    }

    /** Makes an n:m relationship: its table, placed between the two. */
    #joinThrough(
        firstFigure: string,
        secondFigure: string,
        table: IOutlineTable,
        change: ISchemaChange,
    ): void {
        const target = this.#target;
        const first = target.figureRect(firstFigure);
        const second = target.figureRect(secondFigure);
        const figure: IModelFigure = {
            id: newId(),
            type: TABLE_FIGURE,
            name: table.name,
            table: table.name,
            left: Math.round(((first?.left ?? 0) + (second?.left ?? 0)) / 2),
            top: Math.round(((first?.top ?? 0) + (second?.top ?? 0)) / 2),
        };
        const [toFirst, toSecond] = table.foreign_keys ?? [];
        const ends: Array<[IOutlineForeignKey | undefined, string]> = [
            [toFirst, firstFigure], [toSecond, secondFigure]];
        const connections: IModelConnection[] = ends.flatMap(([key, end]) => {
            return key === undefined ? [] : [{
                id: newId(),
                foreignKey: key.name,
                table: table.name,
                startFigure: figure.id,
                endFigure: end,
                visible: true,
            }];
        });
        const show = (): void => {
            target.addFigure(figure);
            for (const connection of connections) {
                target.addConnection(connection);
            }
        };
        target.catalog.edit(change.edits);
        target.refresh();
        show();
        this.#recordSchemaChange(change, show,
            () => { target.removeFigure(figure.id); });
        this.#endRelationship("Relationship between "
            + `'${toFirst?.references.table ?? ""}' and `
            + `'${toSecond?.references.table ?? ""}' created through an `
            + "associative table.");
    }

    #endRelationship(hint: string): void {
        this.#relationship = undefined;
        this.#target.highlight(undefined);
        this.#target.panel(undefined);
        this.#target.hint(hint);
        this.#target.done();
    }
}
