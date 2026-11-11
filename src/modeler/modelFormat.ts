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
 * A schema's diagrams, as msm keeps them in MSM Section 160 of a schema
 * project: one document per row of the `msm_schema_diagrams` view - the
 * schema snapshot (`msm-schema/1`: the objects the CREATE statements
 * define, as the MariaDB SQL language server's outline writes them) and one
 * document per EER diagram (`msm-diagram/1`: layers, figures and
 * connections, with MySQL Workbench's camelCase keys). The format is msm's
 * (mariadb-shell-plugins `msm_plugin/lib/diagrams.py`), the snapshot's
 * objects the outline's (lsp-server `docs/outline-format.md`).
 *
 * Shared by the extension (which reads and saves it) and the model viewer
 * webview (which draws it), so this file is free of `vscode`.
 */

/** A column of a table, as the outline writes it. */
export interface IOutlineColumn {
    name: string;
    /** As written: `VARCHAR(45)`, `INT UNSIGNED`. */
    type: string;
    nullable?: boolean;
    default?: string | null;
    auto_increment?: boolean;
    comment?: string | null;
    /** Lower-cased; null where the column has none of its own. */
    charset?: string | null;
    collation?: string | null;
    /** A generated column's expression, parentheses included. */
    generated?: string | null;
    /** `VIRTUAL`, `PERSISTENT` or `STORED` as written. */
    generated_storage?: string | null;
    /** The `ON UPDATE` expression: `CURRENT_TIMESTAMP(6)`. */
    on_update?: string | null;
    invisible?: boolean;
}

/** A key part of an index, as the outline writes it. */
export interface IOutlineKeyPart {
    column: string;
    /** The prefix length, `a(10)`. */
    length?: number | null;
    /** `ASC` or `DESC`; null where not written. */
    order?: string | null;
}

/** An index of a table, as the outline writes it. */
export interface IOutlineIndex {
    /** Null where unnamed. */
    name: string | null;
    /** `primary`, `unique`, `index`, `fulltext`, `spatial`, `vector`. */
    kind: string;
    columns: string[];
    /** The columns with their prefix lengths and order. */
    key_parts?: IOutlineKeyPart[];
    /** `BTREE`, `HASH` or `RTREE`. */
    using?: string | null;
    comment?: string | null;
}

/** A foreign key of a table, as msm's snapshot has it. */
export interface IOutlineForeignKey {
    /** Every foreign key has one: msm names unnamed ones as MariaDB does. */
    name: string;
    columns: string[];
    references: {
        schema: string | null;
        table: string;
        columns: string[];
    };
    on_delete?: string | null;
    on_update?: string | null;
    /** Whether rows may share a parent: no unique key covers the columns. */
    many?: boolean;
    /** Whether a parent needs a child (always true: SQL cannot say). */
    mandatory?: boolean;
    /** Whether every row needs a parent: no column is nullable. */
    referenced_mandatory?: boolean;
}

/** A table of the snapshot. */
export interface IOutlineTable {
    name: string;
    columns: IOutlineColumn[];
    indexes?: IOutlineIndex[];
    foreign_keys?: IOutlineForeignKey[];
    options?: { comment?: string; [key: string]: unknown };
}

/** A view of the snapshot. */
export interface IOutlineView {
    name: string;
    /** The declared column list only; empty where the SQL has none. */
    columns?: string[];
    definition?: string;
}

/** A procedure or function of the snapshot. */
export interface IOutlineRoutine {
    name: string;
    kind?: "procedure" | "function";
    parameters?: Array<{ mode?: string | null; name: string; type?: string }>;
    /** What a function returns; null for a procedure. */
    returns?: string | null;
}

/** A trigger of the snapshot, on its table. */
export interface IOutlineTrigger {
    name: string;
    /** `BEFORE` or `AFTER`. */
    timing: string;
    /** `INSERT`, or `UPDATE OR DELETE` for several, as the outline writes it. */
    events: string;
    /** The table it is on, without its schema. */
    table: string;
    /** The columns of `UPDATE OF a, b`. */
    update_columns?: string[];
    body?: string;
    order?: { kind: string; trigger: string } | null;
    definer?: string | null;
}

/** An event of the snapshot. */
export interface IOutlineEvent {
    name: string;
    /** `AT ...` or `EVERY ... [STARTS ...] [ENDS ...]`, as written. */
    schedule?: string;
    on_completion_preserve?: boolean | null;
    /** `ENABLE`, `DISABLE`, `DISABLE ON SLAVE`. */
    status?: string | null;
    comment?: string | null;
    body?: string;
    definer?: string | null;
}

/** A sequence of the snapshot; its numbers as written. */
export interface IOutlineSequence {
    name: string;
    type?: string | null;
    start?: string | null;
    increment?: string | null;
    minvalue?: string | null;
    maxvalue?: string | null;
    cache?: string | null;
    cycle?: boolean | null;
    options?: Record<string, unknown>;
}

/** A layer of a diagram: a coloured area grouping figures. */
export interface IModelLayer {
    id: string;
    name: string;
    left: number;
    top: number;
    width: number;
    height: number;
    color: string;
    description?: string;
    /** The ids of the figures on the layer. */
    figures: string[];
    /**
     * How far the layer stands above the page in the 3D view, with the
     * figures on it. The viewer's own; Workbench has no such thing.
     */
    elevation?: number;
}

/** The kinds of figure msm keeps. */
export const TABLE_FIGURE = "TableFigure";
export const VIEW_FIGURE = "ViewFigure";
export const ROUTINE_GROUP_FIGURE = "RoutineGroupFigure";
/** A group of events, listed as a routine group lists routines. */
export const EVENT_GROUP_FIGURE = "EventGroupFigure";
export const SEQUENCE_FIGURE = "SequenceFigure";
export const NOTE_FIGURE = "NoteFigure";
export const IMAGE_FIGURE = "ImageFigure";

/** The colours of new figures by kind, Workbench's. */
export const FIGURE_COLORS: Record<string, string> = {
    [TABLE_FIGURE]: "#98BFDA",
    [VIEW_FIGURE]: "#FEDE58",
    [ROUTINE_GROUP_FIGURE]: "#98D8A5",
    [EVENT_GROUP_FIGURE]: "#F5C39A",
    [SEQUENCE_FIGURE]: "#C9B8E8",
    [NOTE_FIGURE]: "#FEFDED",
    [IMAGE_FIGURE]: "#FFFFFF",
};

/**
 * A figure of a diagram; `left` and `top` are relative to the layer where
 * the figure has one, else to the diagram. What it shows depends on its
 * `type` (a table where it has none).
 */
export interface IModelFigure {
    id: string;
    type?: string;
    name: string;
    left: number;
    top: number;
    /** Left out, the viewer sizes the figure to what it shows. */
    width?: number;
    height?: number;
    color?: string;
    /** The id of the layer the figure lies on, if any. */
    layer?: string;
    /**
     * How far the figure stands above its layer (or the page) in the 3D
     * view. The viewer's own, as a layer's `elevation`.
     */
    elevation?: number;
    /** A TableFigure's table. */
    table?: string;
    /** A ViewFigure's view. */
    view?: string;
    /** A RoutineGroupFigure's routines, by name. */
    routines?: string[];
    /** An EventGroupFigure's events, by name. */
    events?: string[];
    /** A SequenceFigure's sequence. */
    sequence?: string;
    /** A NoteFigure's text, its font (`Helvetica Bold 12`) and colour. */
    text?: string;
    font?: string;
    textColor?: string;
    /** An ImageFigure's picture, a data URL. */
    image?: string;
    /**
     * An ImageFigure's picture's length, where msm left the picture out
     * (`msm.get_schema_diagrams`); the viewer asks for it by the figure's
     * id.
     */
    image_size?: number;
    keepAspectRatio?: boolean;
    expanded?: boolean;
    columnsExpanded?: boolean;
    indicesExpanded?: boolean;
    foreignKeysExpanded?: boolean;
    triggersExpanded?: boolean;
    manualSizing?: boolean;
}

/** A connection of a diagram: a foreign key drawn between two figures. */
export interface IModelConnection {
    id: string;
    foreignKey: string;
    /** The table owning the foreign key (the "many" side). */
    table: string;
    startFigure: string;
    endFigure: string;
    visible: boolean;
    caption?: string;
    middleSegmentOffset?: number;
    drawSplit?: boolean;
    /**
     * Ends placed by hand on a side of their table, and where among the
     * lines there (0 to 1 along it). The viewer's own; Workbench has none.
     */
    startDock?: IConnectionDock;
    endDock?: IConnectionDock;
}

/** A side of a table figure: where a connection leaves or enters it. */
export type FigureSide = "left" | "right" | "top" | "bottom";

/** A connection's end placed by hand on a side of its table. */
export interface IConnectionDock {
    side: FigureSide;
    at: number;
}

/** An EER diagram. */
export interface IModelDiagram {
    id?: string;
    name: string;
    description?: string;
    width: number;
    height: number;
    zoom?: number;
    layers: IModelLayer[];
    figures: IModelFigure[];
    connections: IModelConnection[];
}

/**
 * A schema model as the viewer shows it: the snapshot's objects and the
 * schema's diagrams, put together from the rows of its
 * `msm_schema_diagrams` view (see `assembleSchemaModel`).
 */
export interface ISchemaModel {
    schema: string;
    /**
     * The snapshot's `source_hash`: what schema edits are made against,
     * so msm can refuse them where the snapshot was made again since.
     */
    sourceHash?: string;
    figureNotation?: string;
    connectionNotation?: string;
    tables: IOutlineTable[];
    views: IOutlineView[];
    routines: IOutlineRoutine[];
    triggers: IOutlineTrigger[];
    events: IOutlineEvent[];
    sequences: IOutlineSequence[];
    diagrams: IModelDiagram[];
}

/** The format of the schema snapshot's document. */
export const SCHEMA_DEFINITION_FORMAT = "msm-schema/1";

/** The format of a diagram's document. */
export const DIAGRAM_FORMAT = "msm-diagram/1";

/** The schema snapshot: the objects the diagrams draw. */
export interface ISchemaDefinition {
    format: typeof SCHEMA_DEFINITION_FORMAT;
    schema: string;
    source_hash?: string;
    tables: IOutlineTable[];
    views?: IOutlineView[];
    routines?: IOutlineRoutine[];
    triggers?: IOutlineTrigger[];
    events?: IOutlineEvent[];
    sequences?: IOutlineSequence[];
}

/** A diagram's document: one EER diagram, in a notation. */
export interface IDiagramDocument extends IModelDiagram {
    format: typeof DIAGRAM_FORMAT;
    figureNotation?: string;
    connectionNotation?: string;
}

/** A row of a schema's `msm_schema_diagrams` view. */
export interface IDiagramRow {
    name: string;
    format: string;
    /** The JSON document: as text, or already parsed by the driver. */
    document: unknown;
}

/** The view a schema's diagrams are kept in. */
export const DIAGRAMS_VIEW = "msm_schema_diagrams";

/**
 * @param figure A figure.
 *
 * @returns Its type: a table where it names none.
 */
export const figureType = (figure: IModelFigure): string => {
    return figure.type ?? TABLE_FIGURE;
};

/**
 * @param figure A figure.
 *
 * @returns Its colour: its own, else its kind's, else a table's.
 */
export const figureColor = (figure: IModelFigure): string => {
    return figure.color || FIGURE_COLORS[figureType(figure)]
        || FIGURE_COLORS[TABLE_FIGURE];
};

/**
 * @param figures A diagram's figures.
 *
 * @returns The figures without their pictures, which msm keeps apart.
 */
export const withoutPictures = (
    figures: IModelFigure[],
): IModelFigure[] => {
    return figures.map((figure) => {
        const { image: _image, image_size: _size, ...kept } = figure;

        return kept;
    });
};

/**
 * @param routine A routine of the snapshot.
 *
 * @returns The row a routine group figure shows for it, as msm's
 *          `routine_label`: its name with the parameters' types, and what
 *          a function returns.
 */
export const routineLabel = (routine: IOutlineRoutine): string => {
    const parameters = (routine.parameters ?? []).map((parameter) => {
        return parameter.type ?? "";
    }).join(", ");
    const returns = routine.returns ? `: ${routine.returns}` : "";

    return `${routine.name}(${parameters})${returns}`;
};

/**
 * Parses a row's document.
 *
 * @param row The row.
 *
 * @returns The document as an object.
 * @throws If it is not a JSON object.
 */
export const documentOf = (row: IDiagramRow): Record<string, unknown> => {
    const value: unknown = typeof row.document === "string"
        ? JSON.parse(row.document)
        : row.document;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`The document of ${row.name} is not a JSON object.`);
    }

    return value as Record<string, unknown>;
};

/**
 * @param rows The rows of a `msm_schema_diagrams` view.
 *
 * @returns Its schema snapshot (`msm-schema/1`), where it has one.
 * @throws If the snapshot's document is not a JSON object.
 */
export const schemaDefinitionOf = (
    rows: readonly IDiagramRow[],
): ISchemaDefinition | undefined => {
    const row = rows.find((entry) => {
        return entry.format === SCHEMA_DEFINITION_FORMAT;
    });

    return row === undefined
        ? undefined
        : documentOf(row) as unknown as ISchemaDefinition;
};

/**
 * Puts a schema model together out of the rows of its `msm_schema_diagrams`
 * view: the one snapshot (`msm-schema/1`), and every diagram
 * (`msm-diagram/1`) in the order the view has them. Rows of another format
 * are skipped, so the view can grow. A figure msm has not placed yet (no
 * `left` / `top`, which `msm.layout_schema_diagram` fills) is shown at the
 * corner of its layer or the diagram.
 *
 * @param rows The view's rows.
 *
 * @returns The model.
 * @throws If there is no snapshot, no diagram, or a document of the
 *         formats read is not what they say.
 */
export const assembleSchemaModel = (rows: readonly IDiagramRow[]): ISchemaModel => {
    let definition: ISchemaDefinition | undefined;
    const diagrams: IDiagramDocument[] = [];
    for (const row of rows) {
        if (row.format === SCHEMA_DEFINITION_FORMAT) {
            const document = documentOf(row);
            if (!Array.isArray(document.tables)) {
                throw new Error("The schema snapshot has no tables.");
            }
            definition = document as unknown as ISchemaDefinition;
        } else if (row.format === DIAGRAM_FORMAT) {
            const document = documentOf(row);
            for (const key of ["layers", "figures", "connections"]) {
                if (!Array.isArray(document[key])) {
                    throw new Error(`The diagram ${row.name} has no ${key}.`);
                }
            }
            const diagram = document as unknown as IDiagramDocument;
            for (const figure of diagram.figures) {
                figure.left = typeof figure.left === "number" ? figure.left : 0;
                figure.top = typeof figure.top === "number" ? figure.top : 0;
            }
            diagrams.push({
                ...diagram,
                // The row's name is what the tree lists and opens.
                name: row.name,
            });
        }
    }
    if (definition === undefined) {
        throw new Error(`The ${DIAGRAMS_VIEW} view has no schema snapshot `
            + `(${SCHEMA_DEFINITION_FORMAT}).`);
    }
    if (diagrams.length === 0) {
        throw new Error(`The ${DIAGRAMS_VIEW} view has no diagram `
            + `(${DIAGRAM_FORMAT}).`);
    }

    return {
        schema: definition.schema,
        ...(definition.source_hash === undefined
            ? {} : { sourceHash: definition.source_hash }),
        figureNotation: diagrams[0].figureNotation,
        connectionNotation: diagrams[0].connectionNotation,
        tables: definition.tables,
        views: definition.views ?? [],
        routines: definition.routines ?? [],
        triggers: definition.triggers ?? [],
        events: definition.events ?? [],
        sequences: definition.sequences ?? [],
        diagrams,
    };
};

/**
 * The document a diagram is saved as (`msm.set_schema_diagram`). The
 * pictures stay out: msm keeps the stored picture of an image figure sent
 * without one, by its id, so megabytes do not travel with every move.
 *
 * @param diagram The diagram.
 * @param model The model, for the notations.
 *
 * @returns The `msm-diagram/1` document.
 */
export const diagramDocument = (
    diagram: IModelDiagram,
    model: Pick<ISchemaModel, "figureNotation" | "connectionNotation">,
): IDiagramDocument => {
    return {
        ...diagram,
        format: DIAGRAM_FORMAT,
        ...(model.figureNotation === undefined
            ? {} : { figureNotation: model.figureNotation }),
        ...(model.connectionNotation === undefined
            ? {} : { connectionNotation: model.connectionNotation }),
        figures: withoutPictures(diagram.figures),
    };
};
