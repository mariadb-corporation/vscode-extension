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

/**
 * The rows under a diagram of the MSM Projects view: its layers, and the
 * figures showing schema objects and REST objects, filed under the layer
 * they lie on. Notes and images show no object and are left out. Pure:
 * the view's provider draws them.
 */

import type {
    DiagramItem,
    IDiagramFigureItem,
    IDiagramLayerItem,
} from "../details/objectDetails.js";
import type { ObjectType } from "../mcp/types.js";
import {
    EVENT_GROUP_FIGURE,
    figureType,
    inElevationRange,
    REST_OBJECT_FIGURE,
    ROUTINE_GROUP_FIGURE,
    SEQUENCE_FIGURE,
    TABLE_FIGURE,
    VIEW_FIGURE,
    type IModelDiagram,
    type IModelFigure,
    type IModelLayer,
    type ISchemaDefinition,
} from "../modeler/modelFormat.js";
import type { ISchemaObjectRef } from "../modeler/modelerProtocol.js";

/** The diagram a row is of. */
export interface IDiagramPlace {
    projectPath: string;
    /** The diagram's name. */
    diagram: string;
}

/** What a figure shows, as a row draws it. */
export type DiagramFigureKind = "table" | "view" | "sequence"
    | "routineGroup" | "eventGroup" | "rest";

/** A layer of a diagram, with the figures lying on it. */
export interface IDiagramLayerNode extends IDiagramPlace {
    kind: "diagramLayer";
    layer: IModelLayer;
    figures: IDiagramFigureNode[];
}

/** A figure showing a schema object, a group of them, or a REST object. */
export interface IDiagramFigureNode extends IDiagramPlace {
    kind: "diagramFigure";
    figureKind: DiagramFigureKind;
    figure: IModelFigure;
    /** The layer its position is relative to: the one it is filed under. */
    layer?: IModelLayer;
    /** What a row says: the object's name, a group's, a REST path. */
    label: string;
    /** A group's routines or events. */
    members: IDiagramMemberNode[];
}

/** A routine or event a group figure lists. */
export interface IDiagramMemberNode extends IDiagramPlace {
    kind: "diagramMember";
    figureId: string;
    objectType: ObjectType;
    name: string;
}

export type DiagramRowNode = IDiagramLayerNode | IDiagramFigureNode
    | IDiagramMemberNode;

/** The order figures are listed in: by kind, then by label. */
const KIND_ORDER: readonly DiagramFigureKind[] = ["table", "view",
    "sequence", "routineGroup", "eventGroup", "rest"];

/**
 * @param figure A figure.
 *
 * @returns What it shows, or nothing for a note, an image or a kind not
 *          known here.
 */
export const figureKindOf = (
    figure: IModelFigure,
): DiagramFigureKind | undefined => {
    switch (figureType(figure)) {
        case TABLE_FIGURE: { return "table"; }
        case VIEW_FIGURE: { return "view"; }
        case SEQUENCE_FIGURE: { return "sequence"; }
        case ROUTINE_GROUP_FIGURE: { return "routineGroup"; }
        case EVENT_GROUP_FIGURE: { return "eventGroup"; }
        case REST_OBJECT_FIGURE: { return "rest"; }
        default: { return undefined; }
    }
};

/**
 * @param figure A figure.
 * @param kind What it shows.
 *
 * @returns What its row says.
 */
const labelOf = (figure: IModelFigure, kind: DiagramFigureKind): string => {
    switch (kind) {
        case "table": { return figure.table ?? figure.name; }
        case "view": { return figure.view ?? figure.name; }
        case "sequence": { return figure.sequence ?? figure.name; }
        case "rest": {
            return `${figure.restSchema ?? ""}${figure.restObject ?? ""}`
                || figure.name;
        }
        default: { return figure.name; }
    }
};

/**
 * @param figure A routine or event group figure.
 * @param kind Which.
 * @param place Its diagram.
 * @param definition The project's snapshot: whether a routine is a
 *                   procedure or a function.
 *
 * @returns The rows of what it lists, in its order.
 */
const membersOf = (
    figure: IModelFigure,
    kind: DiagramFigureKind,
    place: IDiagramPlace,
    definition: ISchemaDefinition | undefined,
): IDiagramMemberNode[] => {
    if (kind === "eventGroup") {
        return (figure.events ?? []).map((name) => {
            return { ...place, kind: "diagramMember", figureId: figure.id,
                objectType: "event", name };
        });
    }
    if (kind !== "routineGroup") {
        return [];
    }

    return (figure.routines ?? []).map((name) => {
        const routine = definition?.routines?.find((entry) => {
            return entry.name.toLowerCase() === name.toLowerCase();
        });

        return { ...place, kind: "diagramMember", figureId: figure.id,
            objectType: routine?.kind ?? "procedure", name };
    });
};

/**
 * @param a A figure row.
 * @param b Another.
 *
 * @returns Their order: by kind, then by label.
 */
const byKindAndLabel = (a: IDiagramFigureNode,
    b: IDiagramFigureNode): number => {
    return KIND_ORDER.indexOf(a.figureKind) - KIND_ORDER.indexOf(b.figureKind)
        || a.label.localeCompare(b.label);
};

/**
 * The rows under a diagram: its layers by name, each with the figures
 * lying on it, then the figures on no layer.
 *
 * @param place The diagram.
 * @param diagram Its document.
 * @param definition The project's snapshot, for the kinds of routines.
 *
 * @returns The rows.
 */
export const diagramRowsOf = (
    place: IDiagramPlace,
    diagram: Pick<IModelDiagram, "layers" | "figures">,
    definition?: ISchemaDefinition,
): Array<IDiagramLayerNode | IDiagramFigureNode> => {
    const layerById = new Map(diagram.layers.map((layer) => {
        return [layer.id, layer];
    }));
    const listedOn = new Map<string, string>();
    for (const layer of diagram.layers) {
        for (const id of layer.figures) {
            if (!listedOn.has(id)) {
                listedOn.set(id, layer.id);
            }
        }
    }
    const onLayer = new Map<string, IDiagramFigureNode[]>();
    const loose: IDiagramFigureNode[] = [];
    for (const figure of diagram.figures) {
        const figureKind = figureKindOf(figure);
        if (figureKind === undefined) {
            continue;
        }
        const filedUnder = figure.layer === undefined
            ? undefined
            : layerById.get(figure.layer);
        const row: IDiagramFigureNode = { ...place, kind: "diagramFigure",
            figureKind, figure, label: labelOf(figure, figureKind),
            members: membersOf(figure, figureKind, place, definition),
            ...filedUnder === undefined ? {} : { layer: filedUnder } };
        // Filed under its layer, as the viewer keeps it; one naming a
        // layer the diagram has not is on none.
        const layer = filedUnder?.id ?? listedOn.get(figure.id);
        if (layer === undefined) {
            loose.push(row);
        } else {
            const rows = onLayer.get(layer);
            if (rows === undefined) {
                onLayer.set(layer, [row]);
            } else {
                rows.push(row);
            }
        }
    }
    const layers = [...diagram.layers]
        .sort((a, b) => { return a.name.localeCompare(b.name); })
        .map((layer): IDiagramLayerNode => {
            return { ...place, kind: "diagramLayer", layer,
                figures: (onLayer.get(layer.id) ?? []).sort(byKindAndLabel) };
        });

    return [...layers, ...loose.sort(byKindAndLabel)];
};

/**
 * What Object Details shows of a layer or figure row where its diagram is
 * not open, read from the diagram as saved: as the viewer's
 * `EerFigureSet.itemProps` gives it, read only, as nothing here can
 * change it.
 *
 * @param node A layer or figure row.
 *
 * @returns The item, or nothing for a group member.
 */
export const diagramRowItem = (
    node: DiagramRowNode,
): DiagramItem | undefined => {
    if (node.kind === "diagramLayer") {
        const { layer } = node;
        const item: IDiagramLayerItem = {
            kind: "layer", id: layer.id, name: layer.name,
            x: layer.left, y: layer.top,
            z: inElevationRange(layer.elevation),
            width: layer.width, height: layer.height,
            tables: node.figures.filter((row) => {
                return row.figureKind === "table";
            }).map((row) => { return row.label; })
                .sort((a, b) => { return a.localeCompare(b); }),
            color: layer.color,
            editable: false,
        };

        return item;
    }
    if (node.kind !== "diagramFigure") {
        return undefined;
    }
    const { figure } = node;
    const item: IDiagramFigureItem = {
        kind: "figure", id: figure.id,
        // On the page: its layer's position included.
        x: figure.left + (node.layer?.left ?? 0),
        y: figure.top + (node.layer?.top ?? 0),
        z: inElevationRange(figure.elevation),
        width: figure.width ?? 0,
        height: figure.height ?? 0,
        autoHeight: figure.manualSizing !== true,
        // A REST object stands unless set otherwise; the rest lie.
        upright: figure.upright ?? node.figureKind === "rest",
        color: figure.color ?? "",
        editable: false,
        ...node.figureKind === "rest" ? { rest: {
            service: figure.restService ?? "",
            schema: figure.restSchema ?? "",
            object: figure.restObject ?? "",
        } } : {},
    };

    return item;
};

/**
 * @param node A row under a diagram.
 *
 * @returns The schema object it shows, for Object Details: a table's,
 *          view's or sequence's figure, or a routine or event of a group;
 *          nothing for a layer, a group or a REST object.
 */
export const diagramRowObject = (
    node: DiagramRowNode,
): ISchemaObjectRef | undefined => {
    if (node.kind === "diagramMember") {
        return { type: node.objectType, name: node.name };
    }
    if (node.kind === "diagramFigure" && (node.figureKind === "table"
        || node.figureKind === "view" || node.figureKind === "sequence")) {
        return { type: node.figureKind, name: node.label };
    }

    return undefined;
};
