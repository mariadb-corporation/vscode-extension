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

import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry }
    from "three/examples/jsm/lines/LineSegmentsGeometry.js";

import type { IMsmSchemaEdit } from "../../../src/mcp/msmApi.js";
import {
    figureColor,
    figureType,
    IMAGE_FIGURE,
    NOTE_FIGURE,
    ROUTINE_GROUP_FIGURE,
    TABLE_FIGURE,
    VIEW_FIGURE,
    type IModelConnection,
    type IModelDiagram,
    type IModelFigure,
    type IModelLayer,
    type IOutlineRoutine,
} from "../../../src/modeler/modelFormat.js";
import type {
    ISchemaObjectRef,
    ISchemaObjects,
} from "../../../src/modeler/modelerProtocol.js";
import type { IRect } from "../../../src/modeler/pageSettings.js";
import type {
    ICanvasHost,
    ICanvasItem,
    IEditSpec,
    IElevateSession,
    IFigureSet,
    IMenuEntry,
    IMoveSession,
    IProbe,
    IResizeSession,
    IToolSession,
} from "../canvas/canvasTypes.js";
import type { IPoint, Segment } from "../canvas/geometry.js";
import {
    disposeGroup,
    DRAW_ORDER,
    planeCenter,
    polylineSegments,
    rectSegments,
    roundedRect,
    segmentsGeometry,
    setDrawOrder,
    Z,
} from "../canvas/threeHelpers.js";
import { foreignKeyOf, sameName, type ISchemaCatalog } from "./catalog.js";
import {
    DiagramTools,
    type IPickedImage,
    type IToolEdit,
    type IToolHighlight,
    type IToolHit,
    type IToolPanel,
    type IToolTarget,
} from "./diagramTools.js";
import {
    crowsFoot,
    oneMarker,
    routeConnection,
    splitStubs,
} from "./connectionGeometry.js";
import {
    containsPoint,
    containsRect,
    fitAround,
    layerAtPoint,
    layerRect,
    layerUnder,
    MIN_LAYER_HEIGHT,
    MIN_LAYER_WIDTH,
} from "./layerRules.js";
import {
    drawImageFigure,
    drawNote,
    plainFigureSize,
    sizedPicture,
    cssFont,
    parseWorkbenchFont,
} from "./noteCard.js";
import {
    CARD,
    cardItemAt,
    cardWidth,
    contrastingText,
    drawLabel,
    drawTableCard,
    editRect,
    layoutCard,
    MIN_FIGURE_WIDTH,
    routineCardContent,
    tableCardContent,
    tableOf,
    viewCardContent,
    viewOf,
    type CardIcons,
    type ICardContent,
    type ICardItem,
    type ICardLayout,
    type MeasureText,
} from "./tableCard.js";

/**
 * The EER diagram as a figure set of the canvas: layers on the page, the
 * tables (Workbench's table figures) on them rising in the 3D view, and
 * the foreign keys between the tables in the crow's foot notation.
 *
 * One set per model: it shows one of the model's diagrams at a time
 * (`show`), and keeps the model's history across them, since a table
 * renamed on one diagram is renamed on all.
 *
 * The rules of tables and layers are Workbench's (see `layerRules.ts`): a
 * table lies on the smallest layer it lies fully inside, and is filed
 * under it with its position relative to it. Moving a layer moves every
 * table lying fully on it; raising one (Option + drag, 3D) raises the
 * tables filed under it.
 */

/**
 * How wide the connections are drawn, in CSS pixels. Fat lines: WebGL's
 * own are a pixel wide whatever is asked.
 */
const CONNECTION_WIDTH = 0.8;

/** How thick a card is: the slab under it, in page units. */
const CARD_THICKNESS = 8;

/** How far a card's slab lies inside the card's edge, in page units. */
const SLAB_INSET = 1;

/** How far a card's shadow reaches past the card on each side. */
const SHADOW_SPREAD = 2;

/** The corner radius of a layer: a little less than a card's. */
const LAYER_RADIUS = 5;

/** A layer's name: where it sits, in page units from the layer's corner. */
const LAYER_LABEL = { left: 6, top: 4, height: 18, fontSize: 12 } as const;

/** How high a layer can be raised, in page units. */
const MAX_LAYER_ELEVATION = 240;

/** The texture scales a card is drawn at: device pixels per unit. */
const RASTER_STEPS = [0.25, 0.5, 1, 2, 3, 4];

/**
 * Where the light comes from that shades the slabs' sides, in the plane's
 * coordinates (x right, y up the page, z towards the 2D camera): from the
 * upper left, so the left sides are lit and the front ones, facing the 3D
 * camera at the page's bottom, are in shade.
 */
const SLAB_LIGHT = new THREE.Vector3(-0.7, 0.3, 0.65).normalize();

/**
 * A table's shadow: a rounded rectangle around the card's, centred on the
 * origin, its corners concentric with the card's rounded ones.
 *
 * @param width The card's width.
 * @param height The card's height.
 *
 * @returns The geometry.
 */
const shadowGeometry = (width: number, height: number): THREE.BufferGeometry => {
    const w = width + 2 * SHADOW_SPREAD;
    const h = height + 2 * SHADOW_SPREAD;

    return new THREE.ShapeGeometry(
        roundedRect(-w / 2, -h / 2, w, h, CARD.radius + SHADOW_SPREAD), 6);
};

/**
 * A card's slab: the card's rounded outline extruded downwards, centred on
 * the origin with its top at z = 0, its sides shaded by the way they face.
 * The canvas's materials are unlit, so the shading is baked into vertex
 * colours.
 *
 * @param width The card's width.
 * @param height The card's height.
 * @param color The slab's colour, fully lit.
 *
 * @returns The geometry.
 */
const slabGeometry = (
    width: number,
    height: number,
    color: THREE.Color,
): THREE.BufferGeometry => {
    // Inset a unit, inside the card's border: the card's anti-aliased
    // corner pixels are partly clear, and a slab as large as the card
    // showed through them as a light fringe outside the border.
    const geometry = new THREE.ExtrudeGeometry(
        roundedRect(-width / 2 + SLAB_INSET, -height / 2 + SLAB_INSET,
            width - 2 * SLAB_INSET, height - 2 * SLAB_INSET,
            CARD.radius - SLAB_INSET),
        { depth: CARD_THICKNESS, bevelEnabled: false, curveSegments: 8 });
    geometry.translate(0, 0, -CARD_THICKNESS);
    geometry.computeVertexNormals();
    const normals = geometry.getAttribute("normal");
    const colors = new Float32Array(normals.count * 3);
    const normal = new THREE.Vector3();
    for (let index = 0; index < normals.count; index += 1) {
        normal.fromBufferAttribute(normals, index);
        const light = 0.55 + 0.45 * Math.max(0, normal.dot(SLAB_LIGHT));
        colors.set([color.r * light, color.g * light, color.b * light],
            index * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    return geometry;
};

/**
 * A colour laid over another at an opacity, mixed in sRGB as the
 * framebuffer blends a transparent material.
 *
 * @param color The colour on top.
 * @param under The colour under it.
 * @param opacity How much of the top colour shows.
 *
 * @returns The mixed colour.
 */
const tintOver = (
    color: THREE.Color,
    under: THREE.Color,
    opacity: number,
): THREE.Color => {
    const top = color.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
    const base = under.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
    const mix = (a: number, b: number): number => {
        return b + (a - b) * opacity;
    };

    return new THREE.Color().setRGB(mix(top.r, base.r), mix(top.g, base.g),
        mix(top.b, base.b), THREE.SRGBColorSpace);
};

/**
 * Fat line geometry for segments whose height varies along them: each
 * point at its own z.
 *
 * @param segments The segments, with a height per end.
 *
 * @returns The geometry.
 */
const sloped = (
    segments: Array<[IPoint & { z: number }, IPoint & { z: number }]>,
): LineSegmentsGeometry => {
    const positions = new Float32Array(segments.length * 6);
    segments.forEach(([from, to], index) => {
        positions.set([from.x, -from.y, from.z, to.x, -to.y, to.z], index * 6);
    });

    return new LineSegmentsGeometry().setPositions(positions);
};

/** What a user can change of a table figure. */
type FigureState = Pick<IModelFigure, "left" | "top" | "width" | "height"
    | "manualSizing" | "expanded" | "indicesExpanded"
    | "foreignKeysExpanded" | "layer">;

/** What a user can change of a layer. */
type LayerState = Pick<IModelLayer, "left" | "top" | "width" | "height"
    | "name" | "elevation">;

/** The shown diagram's figures and layers, as they are. */
interface ISnapshot {
    figures: Array<[IModelFigure, FigureState]>;
    layers: Array<[IModelLayer, LayerState]>;
}

const figureState = (figure: IModelFigure): FigureState => {
    return {
        left: figure.left,
        top: figure.top,
        width: figure.width,
        height: figure.height,
        manualSizing: figure.manualSizing,
        expanded: figure.expanded,
        indicesExpanded: figure.indicesExpanded,
        foreignKeysExpanded: figure.foreignKeysExpanded,
        layer: figure.layer,
    };
};

const layerState = (layer: IModelLayer): LayerState => {
    return {
        left: layer.left,
        top: layer.top,
        width: layer.width,
        height: layer.height,
        name: layer.name,
        elevation: layer.elevation,
    };
};

/**
 * @param a A state.
 * @param b Another of the same kind.
 *
 * @returns Whether they are the same.
 */
const sameState = <T extends object>(a: T, b: T): boolean => {
    return (Object.keys(a) as Array<keyof T>).every((key) => {
        return a[key] === b[key];
    });
};

/**
 * What a figure is drawn as: a card (a table, a view, a routine group),
 * a note, or a picture (an image; a figure of a type the viewer does not
 * know is a frame saying so).
 */
type FigureKind = "table" | "view" | "routines" | "note" | "picture";

/** A figure on the canvas. */
interface IFigureNode {
    kind: FigureKind;
    figure: IModelFigure;
    /** The layer the table is filed under, if any. */
    layer?: IModelLayer;
    layout: ICardLayout;
    mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    slab: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    shadow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    /** The size the geometries were made for, so a move keeps them. */
    builtSize?: string;
    /** Device pixels per unit the texture was drawn at. */
    rasterScale: number;
    item: ICanvasItem;
}

/** A layer on the canvas. */
interface ILayerNode {
    layer: IModelLayer;
    plate: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    border: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
    label: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    labelWidth: number;
    builtName?: string;
    builtSize?: string;
    item: ICanvasItem;
}

/** A foreign key on the canvas. */
interface IConnectionNode {
    connection: IModelConnection;
    start: IFigureNode;
    end: IFigureNode;
    line: LineSegments2;
    /** Whether rows may share a parent: a crow's foot, else a bar. */
    many: boolean;
    mandatory: boolean;
    referencedMandatory: boolean;
}

/** What the set needs to be made. */
export interface IEerFigureSetOptions {
    /** Where the figures' tables, views and routines come from. */
    catalog: ISchemaCatalog;
    /** Every diagram of the model: a renamed table is renamed on all. */
    diagrams: IModelDiagram[];
    /** Loads the card icons in a colour. */
    loadIcons: (color: string) => Promise<CardIcons>;
    /**
     * Whether schema objects can be renamed: an MSM project's, which msm
     * changes in the SQL. A live schema's view is msm's to write.
     */
    editable?: boolean;
    /**
     * Sends schema edits on, once the viewer shows them; with the diagrams
     * the change changed too (a figure placed for a new table), which are
     * saved only once the edit is made.
     */
    onSchemaEdit?: (edits: IMsmSchemaEdit[], diagrams?: IModelDiagram[],
        failed?: (message: string) => void) => void;
    /** Asks for a picture to place: the image tool's file dialog. */
    pickImage?: () => Promise<IPickedImage | undefined>;
    /** Shows the existing-columns relationship's panel, or no more. */
    onToolPanel?: (panel?: IToolPanel) => void;
    /** Asks for the picture msm left out of an image figure. */
    requestImage?: (diagram: string, figureId: string) => void;
}

/** A picture of an image figure, or why there is none yet. */
interface IPicture {
    image?: HTMLImageElement;
    status: string;
}

/**
 * @param figure A figure.
 *
 * @returns What it is drawn as.
 */
const kindOf = (figure: IModelFigure): FigureKind => {
    switch (figureType(figure)) {
        case TABLE_FIGURE: {
            return "table";
        }

        case VIEW_FIGURE: {
            return "view";
        }

        case ROUTINE_GROUP_FIGURE: {
            return "routines";
        }

        case NOTE_FIGURE: {
            return "note";
        }

        default: {
            return "picture";
        }
    }
};

/**
 * @param diagram A diagram's name.
 * @param figureId A figure of it.
 *
 * @returns The key its picture is kept under: figure ids are a diagram's
 *          own, so the same id can stand for another picture elsewhere.
 */
const pictureKey = (diagram: string, figureId: string): string => {
    return `${diagram}\u0000${figureId}`;
};

/**
 * @param kind What a figure is drawn as.
 *
 * @returns Whether it is a card: a schema object's, with a header and a
 *          menu, laid out from its content.
 */
const isCard = (kind: FigureKind): boolean => {
    return kind !== "note" && kind !== "picture";
};

export class EerFigureSet implements IFigureSet {
    readonly #options: IEerFigureSetOptions;
    #diagram: IModelDiagram;
    #host?: ICanvasHost;
    #icons?: CardIcons;
    /**
     * The card icons by colour, loaded once each: a mount (every diagram
     * switch) loads again only what a new theme's colours need.
     */
    #iconCache = new Map<string, Promise<CardIcons>>();
    /** Counts mounts and unmounts, so a mount overtaken while it waits stops. */
    #mounts = 0;
    /** The layers' stacking, by id: see `#restack`. */
    #stackRanks = new Map<string, number>();
    /** The tables whose cards are to be drawn again, on the next frame. */
    #rasterQueue = new Set<IFigureNode>();
    #rasterFrame?: number;
    /** The cards, for hit-testing: kept, since the pointer asks often. */
    #cardMeshes: THREE.Object3D[] = [];
    /**
     * The image figures' pictures, by `pictureKey`, kept across diagrams:
     * a picture can be placed on several diagrams, each figure sized and
     * placed as that diagram has it.
     */
    readonly #pictures = new Map<string, IPicture>();
    /** The pictures asked of the extension, so each is asked once. */
    readonly #picturesAsked = new Set<string>();
    /** Measures texts for the figures sized to their content. */
    #measureContext?: CanvasRenderingContext2D | null;
    #figures = new Map<string, IFigureNode>();
    #layers = new Map<string, ILayerNode>();
    #connections: IConnectionNode[] = [];
    /** What this set drew into the canvas's groups, to remove it. */
    #base = new THREE.Group();
    #lifted = new THREE.Group();
    /** The palette's tools, which place and connect figures. */
    readonly #tools: DiagramTools;
    /** What a relationship tool marks, and the marks drawn for it. */
    #toolHighlight?: IToolHighlight;
    #highlightMarks: THREE.Object3D[] = [];
    /** The marks of the area a layer is dragged out over. */
    #bandMarks: THREE.Object3D[] = [];

    public constructor(options: IEerFigureSetOptions) {
        this.#options = options;
        this.#diagram = options.diagrams[0];
        this.#tools = new DiagramTools(this.#toolTarget());
    }

    /** The diagram shown. */
    public get diagram(): IModelDiagram {
        return this.#diagram;
    }

    /**
     * Picks the diagram to show; the canvas's next `load` draws it.
     *
     * @param diagram One of the model's diagrams.
     */
    public show(diagram: IModelDiagram): void {
        this.#diagram = diagram;
    }

    // --- IFigureSet: building -----------------------------------------------

    public async mount(host: ICanvasHost): Promise<void> {
        const mounting = ++this.#mounts;
        this.#host = host;
        // In the theme's colour, which may have changed since the last mount.
        const icons = await this.#iconsIn(host.theme.foreground);
        // Unmounted, or mounted again, while the icons loaded: that mount
        // builds the scene, not this one.
        if (mounting !== this.#mounts) {
            return;
        }
        this.#icons = icons;
        host.base.add(this.#base);
        host.lifted.add(this.#lifted);
        for (const layer of this.#diagram.layers) {
            this.#buildLayer(layer);
        }
        for (const figure of this.#diagram.figures) {
            this.#buildFigure(figure);
        }
        for (const connection of this.#diagram.connections) {
            this.#buildConnection(connection);
        }
        this.#restack();
        this.viewChanged();
        host.invalidate();
    }

    public unmount(): void {
        this.#mounts += 1;
        if (this.#rasterFrame !== undefined) {
            cancelAnimationFrame(this.#rasterFrame);
            this.#rasterFrame = undefined;
        }
        this.#rasterQueue.clear();
        disposeGroup(this.#base);
        disposeGroup(this.#lifted);
        this.#base.removeFromParent();
        this.#lifted.removeFromParent();
        this.#figures.clear();
        this.#cardMeshes = [];
        this.#layers.clear();
        this.#connections = [];
        // Disposed with the groups.
        this.#highlightMarks = [];
        this.#bandMarks = [];
        this.#host = undefined;
    }

    public extent(): { width: number; height: number } {
        return { width: this.#diagram.width, height: this.#diagram.height };
    }

    // --- Items ----------------------------------------------------------------

    public item(id: string): ICanvasItem | undefined {
        return this.#figures.get(id)?.item ?? this.#layers.get(id)?.item;
    }

    public itemAt(probe: IProbe): ICanvasItem | undefined {
        const table = this.#figureHit(probe);
        if (table !== undefined) {
            return table.node.item;
        }

        return this.#layerAt(probe)?.item;
    }

    /** The table card under the pointer, and the point on it. */
    #figureHit(
        probe: IProbe,
    ): { node: IFigureNode; uv: THREE.Vector2 } | undefined {
        const hit = probe.raycaster.intersectObjects(this.#cardMeshes, false)[0];
        if (hit === undefined || hit.uv === undefined) {
            return undefined;
        }
        const node = this.#figures.get(
            (hit.object.userData as { figureId: string }).figureId);

        return node === undefined ? undefined : { node, uv: hit.uv };
    }

    /** The layer under the pointer: the inner one, at its own height. */
    #layerAt(probe: IProbe): ILayerNode | undefined {
        let found: ILayerNode | undefined;
        for (const node of this.#layers.values()) {
            const point = probe.pointOn("base", this.#elevation(node.layer));
            if (point !== undefined
                && layerAtPoint(point, [node.layer]) !== undefined
                && (found === undefined || node.layer.width * node.layer.height
                    < found.layer.width * found.layer.height)) {
                found = node;
            }
        }

        return found;
    }

    /** @returns A layer's elevation, kept in its range. */
    #elevation(layer: IModelLayer | undefined): number {
        return Math.min(MAX_LAYER_ELEVATION,
            Math.max(0, layer?.elevation ?? 0));
    }

    /** @returns Where a table is on the page. */
    #figureRect(node: IFigureNode): IRect {
        return {
            left: node.figure.left + (node.layer?.left ?? 0),
            top: node.figure.top + (node.layer?.top ?? 0),
            width: node.layout.width,
            height: node.layout.height,
        };
    }

    /** @returns The layer with an id on the shown diagram. */
    #layerById(id: string | undefined): IModelLayer | undefined {
        return id === undefined ? undefined : this.#layers.get(id)?.layer;
    }

    // --- Layers -----------------------------------------------------------

    #buildLayer(layer: IModelLayer): void {
        const theme = this.#host!.theme;
        const color = new THREE.Color(layer.color || "#e0e0e0");
        // Solid, so that the grid lies under the layer rather than showing
        // through it: the layer's tint over the paper, mixed the way the
        // see-through plate it replaces was blended.
        const plate = new THREE.Mesh(new THREE.BufferGeometry(),
            new THREE.MeshBasicMaterial({
                color: tintOver(color, new THREE.Color(theme.paper),
                    theme.dark ? 0.35 : 0.6),
            }));
        const border = new THREE.LineLoop(new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({
                color, transparent: true, opacity: 0.9,
            }));
        const label = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({ transparent: true }));
        setDrawOrder(plate, DRAW_ORDER.base);
        // A layer's border and name go over its plate.
        setDrawOrder(border, DRAW_ORDER.base + 0.5);
        setDrawOrder(label, DRAW_ORDER.base + 0.5);
        this.#base.add(plate, border, label);

        const node: ILayerNode = {
            layer, plate, border, label, labelWidth: 0,
            item: {
                id: layer.id,
                plane: "base",
                rect: () => { return layerRect(layer); },
                resizable: true,
                minWidth: MIN_LAYER_WIDTH,
                minHeight: MIN_LAYER_HEIGHT,
                elevation: () => { return this.#elevation(layer); },
                elevatable: true,
                menuBand: {
                    top: LAYER_LABEL.top,
                    height: LAYER_LABEL.height,
                    color: theme.foreground,
                },
            },
        };
        this.#layers.set(layer.id, node);
        this.#placeLayer(node);
    }

    /** Puts a layer's plate, border and name where the layer is. */
    #placeLayer(node: ILayerNode): void {
        const { layer } = node;
        const size = `${layer.width}x${layer.height}`;
        if (node.builtSize !== size) {
            node.builtSize = size;
            const shape = roundedRect(-layer.width / 2, -layer.height / 2,
                layer.width, layer.height, LAYER_RADIUS);
            node.plate.geometry.dispose();
            node.plate.geometry = new THREE.ShapeGeometry(shape, 6);
            node.border.geometry.dispose();
            node.border.geometry = new THREE.BufferGeometry()
                .setFromPoints(shape.getPoints(6));
        }
        if (node.builtName !== layer.name) {
            node.builtName = layer.name;
            const label = drawLabel(layer.name,
                `bold ${LAYER_LABEL.fontSize}px ${this.#host!.theme.fontFamily}`,
                this.#host!.theme.foreground,
                Math.max(1, window.devicePixelRatio) * 2, LAYER_LABEL.height);
            const texture = new THREE.CanvasTexture(label.canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            node.label.material.map?.dispose();
            node.label.material.map = texture;
            node.label.material.needsUpdate = true;
            node.label.geometry.dispose();
            node.label.geometry = new THREE.PlaneGeometry(
                Math.max(1, label.width), LAYER_LABEL.height);
            node.labelWidth = label.width;
        }
        const center = planeCenter(layerRect(layer));
        const z = this.#elevation(layer) * (this.#host?.lift() ?? 0);
        node.plate.position.set(center.x, center.y,
            z + Z.plate + this.#stackHeight(layer));
        node.border.position.set(center.x, center.y, z + Z.plateBorder);
        node.label.position.set(
            layer.left + LAYER_LABEL.left + node.labelWidth / 2,
            -(layer.top + LAYER_LABEL.top + LAYER_LABEL.height / 2),
            z + Z.plateText);
    }

    /**
     * How far a layer's plate lies above the others of its height: the
     * plates are solid, and two in one plane would fight over each pixel,
     * so the smaller a layer, the higher - an inner layer always over the
     * one around it. Small enough to stay under the borders and names.
     *
     * @param layer The layer.
     *
     * @returns The offset, in page units.
     */
    #stackHeight(layer: IModelLayer): number {
        return (this.#stackRanks.get(layer.id) ?? 0) * 0.003;
    }

    /**
     * Ranks the layers by size, largest first, for `#stackHeight`: once
     * when they are drawn and again when one is resized, rather than
     * comparing every layer with every other each time one is placed.
     */
    #restack(): void {
        const byArea = [...this.#diagram.layers].sort((a, b) => {
            return b.width * b.height - a.width * a.height;
        });
        this.#stackRanks.clear();
        byArea.forEach((layer, index) => {
            // Layers of one size share a rank, as they did.
            const previous = byArea[index - 1];
            const rank = previous !== undefined
                && previous.width * previous.height === layer.width * layer.height
                ? this.#stackRanks.get(previous.id)!
                : index;
            this.#stackRanks.set(layer.id, rank);
        });
    }

    /**
     * Files a table under the layer it lies on now, keeping its place on
     * the page.
     *
     * @param node The table.
     */
    #fileUnderLayer(node: IFigureNode): void {
        const rect = this.#figureRect(node);
        const target = layerUnder(rect, this.#diagram.layers);
        if (target?.id === node.figure.layer) {
            return;
        }
        node.figure.left = rect.left - (target?.left ?? 0);
        node.figure.top = rect.top - (target?.top ?? 0);
        node.figure.layer = target?.id;
        node.layer = target;
        this.#placeFigure(node);
    }

    /**
     * @param layer A layer.
     *
     * @returns The tables lying fully on it, whatever they are filed under.
     */
    #tablesOn(layer: IModelLayer): IFigureNode[] {
        const rect = layerRect(layer);

        return [...this.#figures.values()].filter((node) => {
            return containsRect(rect, this.#figureRect(node));
        });
    }

    // --- Tables -----------------------------------------------------------

    #buildFigure(figure: IModelFigure): void {
        const host = this.#host!;
        const kind = kindOf(figure);
        const layout = this.#layoutOf(kind, figure);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({ transparent: true }));
        mesh.userData = { figureId: figure.id };
        const slab = new THREE.Mesh(new THREE.BufferGeometry(),
            new THREE.MeshBasicMaterial({ vertexColors: true }));
        // The card is drawn after every slab, so that a slab in front
        // hides a card behind it, but no slab its own card.
        setDrawOrder(slab, DRAW_ORDER.lifted);
        setDrawOrder(mesh, DRAW_ORDER.lifted + 0.5);
        this.#lifted.add(slab, mesh);

        const shadow = new THREE.Mesh(new THREE.BufferGeometry(),
            new THREE.MeshBasicMaterial({
                color: host.theme.shadow,
                transparent: true,
                opacity: 0.18,
                depthWrite: false,
            }));
        setDrawOrder(shadow, DRAW_ORDER.shadows);
        this.#base.add(shadow);
        // A picture lies on its layer as it is: no card under it, which
        // would show through a transparent one.
        slab.visible = shadow.visible = kind !== "picture";

        const card = isCard(kind);
        const node: IFigureNode = {
            kind,
            figure,
            layer: this.#layerById(figure.layer),
            layout,
            mesh,
            slab,
            shadow,
            rasterScale: 0,
            item: {
                id: figure.id,
                plane: "lifted",
                rect: () => { return this.#figureRect(node); },
                resizable: true,
                minWidth: MIN_FIGURE_WIDTH,
                minHeight: card ? CARD.headerHeight : 20,
                elevation: () => { return this.#elevation(node.layer); },
                // Notes and pictures have no header, and no menu.
                ...(card ? {
                    menuBand: {
                        top: 0,
                        height: CARD.headerHeight,
                        color: contrastingText(figureColor(figure)),
                    },
                } : {}),
            },
        };
        this.#figures.set(figure.id, node);
        this.#cardMeshes.push(mesh);
        if (kind === "picture") {
            this.#preparePicture(figure);
        }
        this.#placeFigure(node);
        void this.#raster(node);
    }

    /**
     * Lays a figure out for what it shows. A figure without a width gets
     * the one its content needs, and keeps it; a card's height follows its
     * content unless sized by hand.
     *
     * @param kind What the figure is drawn as.
     * @param figure The figure.
     *
     * @returns The layout; a note's and a picture's have no items.
     */
    #layoutOf(kind: FigureKind, figure: IModelFigure): ICardLayout {
        if (!isCard(kind)) {
            const font = cssFont(parseWorkbenchFont(figure.font),
                this.#host?.theme.fontFamily ?? "sans-serif");
            const size = plainFigureSize(figure, (line) => {
                return this.#measureIn(font, line);
            });
            figure.width = size.width;
            figure.height = size.height;

            return { ...size, contentHeight: size.height, items: [] };
        }
        const content = this.#contentOf(kind, figure);
        figure.width ??= cardWidth(content, this.#measure);
        const layout = layoutCard(content, figure);
        keepAutoHeight(figure, layout);

        return layout;
    }

    /**
     * @param kind A card's kind.
     * @param figure The figure.
     *
     * @returns What its card shows, from the catalog.
     */
    #contentOf(kind: FigureKind, figure: IModelFigure): ICardContent {
        const catalog = this.#options.catalog;
        switch (kind) {
            case "view": {
                return viewCardContent(catalog.view(viewOf(figure)), figure);
            }

            case "routines": {
                const routines = (figure.routines ?? []).map((name) => {
                    return catalog.routine(name);
                }).filter((routine): routine is IOutlineRoutine => {
                    return routine !== undefined;
                });

                return routineCardContent(routines, figure);
            }

            default: {
                return tableCardContent(catalog.table(tableOf(figure)), figure,
                    this.#options.editable === true);
            }
        }
    }

    /** Measures a text in a card's fonts, in diagram units. */
    readonly #measure: MeasureText = (text, font) => {
        const family = this.#host?.theme.fontFamily ?? "sans-serif";
        const css = font === "title"
            ? `bold ${String(CARD.titleFontSize)}px ${family}`
            : `${font === "detail" ? "italic " : ""}`
                + `${String(CARD.rowFontSize)}px ${family}`;

        return this.#measureIn(css, text);
    };

    /**
     * @param font A CSS font.
     * @param text A text.
     *
     * @returns Its width; an estimate where the page cannot measure.
     */
    #measureIn(font: string, text: string): number {
        if (this.#measureContext === undefined) {
            this.#measureContext = document.createElement("canvas")
                .getContext("2d");
        }
        const context = this.#measureContext;
        if (context === null) {
            return text.length * 6.2;
        }
        context.font = font;

        return context.measureText(text).width;
    }

    /**
     * Loads an image figure's picture, or asks the extension for it where
     * msm left it out; the figure is drawn again once it is there.
     */
    #preparePicture(figure: IModelFigure): void {
        const key = pictureKey(this.#diagram.name, figure.id);
        if (this.#pictures.has(key)) {
            return;
        }
        if (figureType(figure) !== IMAGE_FIGURE) {
            this.#pictures.set(key, {
                status: `A figure of the type ${figureType(figure)}, `
                    + "which the viewer does not show",
            });

            return;
        }
        if (figure.image !== undefined) {
            this.#loadPicture(figure, figure.image);

            return;
        }
        if (figure.image_size !== undefined && this.#options.requestImage) {
            this.#pictures.set(key, { status: "Loading the picture…" });
            if (!this.#picturesAsked.has(key)) {
                this.#picturesAsked.add(key);
                this.#options.requestImage(this.#diagram.name, figure.id);
            }

            return;
        }
        this.#pictures.set(key, { status: "No picture" });
    }

    /** Loads a picture from its data URL, then draws its figure again. */
    #loadPicture(figure: IModelFigure, dataUrl: string): void {
        const diagram = this.#diagram.name;
        const key = pictureKey(diagram, figure.id);
        this.#pictures.set(key, { status: "Loading the picture…" });
        const image = new Image();
        image.onload = () => {
            this.#pictures.set(key, { image, status: "" });
            this.#redrawFigure(diagram, figure.id);
        };
        image.onerror = () => {
            this.#pictures.set(key, {
                status: "The picture cannot be shown",
            });
            this.#redrawFigure(diagram, figure.id);
        };
        image.src = sizedPicture(dataUrl, figure.width ?? 160,
            figure.height ?? 60);
    }

    /** Draws a figure of a diagram again, where that diagram is shown. */
    #redrawFigure(diagram: string, id: string): void {
        if (diagram !== this.#diagram.name) {
            return;
        }
        const node = this.#figures.get(id);
        if (node !== undefined) {
            node.rasterScale = 0;
            this.#requestRaster(node);
        }
    }

    /**
     * Takes the picture of an image figure the extension was asked for.
     *
     * @param diagram The figure's diagram.
     * @param figureId The figure.
     * @param image The picture, a data URL; none where it could not be
     *              had.
     * @param error Why not.
     */
    public pictureArrived(diagram: string, figureId: string, image?: string,
        error?: string): void {
        const figure = this.#options.diagrams.find((candidate) => {
            return candidate.name === diagram;
        })?.figures.find((candidate) => { return candidate.id === figureId; });
        if (figure === undefined) {
            return;
        }
        const key = pictureKey(diagram, figureId);
        if (image === undefined) {
            this.#pictures.set(key, {
                status: `The picture could not be read: ${error ?? ""}`,
            });
            this.#redrawFigure(diagram, figureId);

            return;
        }
        // Kept with the figure, so another diagram's mount has it; a save
        // leaves it out (`diagramDocument`).
        figure.image = image;
        // Loaded now where its diagram is shown, else when it is.
        this.#pictures.delete(key);
        if (diagram === this.#diagram.name) {
            this.#preparePicture(figure);
        }
    }

    /** Puts a table's card, slab and shadow where its rectangle is. */
    #placeFigure(node: IFigureNode): void {
        const rect = this.#figureRect(node);
        const center = planeCenter(rect);

        // The shapes depend on the size alone; a move only moves them.
        const size = `${rect.width}x${rect.height}`;
        if (node.builtSize !== size) {
            node.builtSize = size;
            node.mesh.geometry.dispose();
            node.mesh.geometry = new THREE.PlaneGeometry(rect.width,
                rect.height);
            node.slab.geometry.dispose();
            node.slab.geometry = slabGeometry(rect.width, rect.height,
                new THREE.Color(figureColor(node.figure)));
            node.shadow.geometry.dispose();
            node.shadow.geometry = shadowGeometry(rect.width, rect.height);
        }

        const lift = this.#host?.lift() ?? 0;
        const z = this.#elevation(node.layer) * lift;
        node.mesh.position.set(center.x, center.y, z + Z.face);
        // Just below the card, so the card's face wins the depth test.
        node.slab.position.set(center.x, center.y, z + Z.slab);
        // Flat in the 2D view, growing as the tables rise; never quite
        // zero, which would leave the geometry degenerate.
        node.slab.scale.z = Math.max(0.001, lift);
        node.shadow.position.set(center.x + 1, center.y - 2, z + Z.shadow);
    }

    /**
     * Lays a table out again, after a change to what it shows. Its card is
     * drawn again on the next frame; its connections are the caller's to
     * route, once for everything it changed.
     */
    #relayout(node: IFigureNode): void {
        node.layout = this.#layoutOf(node.kind, node.figure);
        this.#placeFigure(node);
        node.rasterScale = 0;
        this.#requestRaster(node);
    }

    /**
     * Draws a table's card again on the next frame, once however often it
     * is asked for until then: a resize drag asks on every pointer move.
     */
    #requestRaster(node: IFigureNode): void {
        this.#rasterQueue.add(node);
        this.#rasterFrame ??= requestAnimationFrame(() => {
            this.#rasterFrame = undefined;
            const queued = [...this.#rasterQueue];
            this.#rasterQueue.clear();
            for (const queuedNode of queued) {
                void this.#raster(queuedNode);
            }
        });
    }

    /** The texture scale the zoom calls for. */
    #wantedRasterScale(): number {
        const needed = (this.#host?.scale() ?? 1) * window.devicePixelRatio;

        return RASTER_STEPS.find((step) => { return step >= needed; })
            ?? RASTER_STEPS[RASTER_STEPS.length - 1];
    }

    /**
     * @param color A colour.
     *
     * @returns The card icons in it, loaded once.
     */
    #iconsIn(color: string): Promise<CardIcons> {
        let icons = this.#iconCache.get(color);
        if (icons === undefined) {
            icons = this.#options.loadIcons(color);
            this.#iconCache.set(color, icons);
            // A load that failed is tried again next time, not kept.
            icons.catch(() => { this.#iconCache.delete(color); });
        }

        return icons;
    }

    /** Draws a table's card at the zoom's scale, where it is not yet. */
    async #raster(node: IFigureNode): Promise<void> {
        const host = this.#host;
        const scale = this.#wantedRasterScale();
        if (host === undefined || node.rasterScale === scale
            || this.#icons === undefined) {
            return;
        }
        // In the header's TEXT colour: the figure's own colour is the
        // header's background, on which the icon would not show.
        const headerIcons = await this.#iconsIn(
            contrastingText(figureColor(node.figure)));
        if (this.#figures.get(node.figure.id) !== node) {
            return;
        }
        node.rasterScale = scale;
        const { width, height } = node.layout;
        let canvas: HTMLCanvasElement;
        if (node.kind === "note") {
            canvas = drawNote(node.figure, width, height, host.theme, scale);
        } else if (node.kind === "picture") {
            const picture = this.#pictures.get(
                pictureKey(this.#diagram.name, node.figure.id));
            canvas = drawImageFigure(node.figure, width, height,
                picture?.image, picture?.status ?? "", host.theme, scale);
        } else {
            canvas = drawTableCard(node.layout, node.figure, host.theme,
                this.#icons, headerIcons, scale);
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = host.maxAnisotropy;
        node.mesh.material.map?.dispose();
        node.mesh.material.map = texture;
        node.mesh.material.needsUpdate = true;
        host.invalidate();
    }

    // --- Connections ----------------------------------------------------------

    #buildConnection(connection: IModelConnection): void {
        const start = this.#figures.get(connection.startFigure);
        const end = this.#figures.get(connection.endFigure);
        // Foreign keys join tables; views and routines have none.
        if (start?.kind !== "table" || end?.kind !== "table") {
            return;
        }
        const foreignKey = foreignKeyOf(
            this.#options.catalog.table(connection.table),
            connection.foreignKey);
        const line = new LineSegments2(new LineSegmentsGeometry(),
            new LineMaterial({
                color: new THREE.Color(this.#host!.theme.connection),
                linewidth: CONNECTION_WIDTH,
            }));
        line.visible = connection.visible !== false;
        setDrawOrder(line, DRAW_ORDER.connections);
        this.#lifted.add(line);
        const node: IConnectionNode = {
            connection, start, end, line,
            many: foreignKey?.many ?? true,
            mandatory: foreignKey?.mandatory ?? true,
            referencedMandatory: foreignKey?.referenced_mandatory ?? true,
        };
        this.#connections.push(node);
        this.#route(node);
    }

    /**
     * Draws a foreign key along its route, sloping from the height of the
     * table it starts at to that of the one it ends at.
     */
    #route(node: IConnectionNode): void {
        const route = routeConnection(this.#figureRect(node.start),
            this.#figureRect(node.end));
        const lift = this.#host?.lift() ?? 0;
        const startZ = this.#elevation(node.start.layer) * lift + Z.connection;
        const endZ = this.#elevation(node.end.layer) * lift + Z.connection;
        const path = node.connection.drawSplit === true
            ? splitStubs(route)
            : polylineSegments(route.points);
        // Each end at the height of its own table; only the middle segment
        // spans the difference (a split connection's stubs have none).
        const middle = Math.floor((path.length - 1) / 2);
        const segments: Array<[IPoint & { z: number }, IPoint & { z: number }]> =
            node.connection.drawSplit === true
                ? [
                    [{ ...path[0][0], z: startZ }, { ...path[0][1], z: startZ }],
                    [{ ...path[1][0], z: endZ }, { ...path[1][1], z: endZ }],
                ]
                : path.map(([from, to], index) => {
                    const a = index <= middle ? startZ : endZ;
                    const b = index < middle ? startZ : endZ;

                    return [{ ...from, z: a }, { ...to, z: b }];
                });
        const at = (z: number) => {
            return ([from, to]: Segment): [IPoint & { z: number },
                IPoint & { z: number }] => {
                return [{ ...from, z }, { ...to, z }];
            };
        };
        segments.push(
            ...(node.many ? crowsFoot : oneMarker)(route.points[0],
                route.startSide, node.mandatory).map(at(startZ)),
            ...oneMarker(route.points[route.points.length - 1], route.endSide,
                node.referencedMandatory).map(at(endZ)),
        );
        node.line.geometry.dispose();
        node.line.geometry = sloped(segments);
    }

    #routeAll(): void {
        for (const node of this.#connections) {
            this.#route(node);
        }
    }

    /**
     * Routes the connections of some tables, the others being where they
     * were.
     *
     * @param tables The tables that moved or changed.
     */
    #routeOf(tables: ReadonlySet<IFigureNode>): void {
        for (const node of this.#connections) {
            if (tables.has(node.start) || tables.has(node.end)) {
                this.#route(node);
            }
        }
    }

    /**
     * @param layer A layer.
     *
     * @returns The tables filed under it.
     */
    #filedUnder(layer: IModelLayer): IFigureNode[] {
        return [...this.#figures.values()].filter((node) => {
            return node.figure.layer === layer.id;
        });
    }

    // --- IFigureSet: the view -----------------------------------------------

    public viewChanged(): void {
        // Fat lines are drawn against the canvas's size, which may have
        // changed with the view.
        const viewport = this.#host?.viewport();
        if (viewport !== undefined) {
            for (const node of this.#connections) {
                node.line.material.resolution.set(viewport.width,
                    viewport.height);
            }
        }
        for (const node of this.#layers.values()) {
            this.#placeLayer(node);
        }
        for (const node of this.#figures.values()) {
            this.#placeFigure(node);
        }
        this.#routeAll();
        this.#drawHighlight();
    }

    public zoomSettled(): void {
        for (const node of this.#figures.values()) {
            void this.#raster(node);
        }
    }

    // --- IFigureSet: moving, resizing, raising ------------------------------

    public beginMove(ids: readonly string[]): IMoveSession {
        const layers = ids.map((id) => { return this.#layers.get(id); })
            .filter((node): node is ILayerNode => { return node !== undefined; });
        const tables = ids.map((id) => { return this.#figures.get(id); })
            .filter((node): node is IFigureNode => { return node !== undefined; });
        // What moves: the selected tables, and every table lying fully on
        // a selected layer.
        const carried = new Set(tables);
        for (const layer of layers) {
            for (const node of this.#tablesOn(layer.layer)) {
                carried.add(node);
            }
        }
        const moving = new Set(layers.map((node) => { return node.layer.id; }));

        return {
            moveBy: (dx, dy) => {
                for (const node of layers) {
                    node.layer.left += dx;
                    node.layer.top += dy;
                    this.#placeLayer(node);
                }
                const placed = new Set<IFigureNode>();
                for (const node of this.#figures.values()) {
                    // A table's position is its layer's plus its own: one
                    // carried along keeps its layer's share, one whose
                    // layer moves without it gives that share back.
                    const isCarried = carried.has(node);
                    const layerMoves = node.figure.layer !== undefined
                        && moving.has(node.figure.layer);
                    const share = (isCarried ? 1 : 0) - (layerMoves ? 1 : 0);
                    if (share !== 0) {
                        node.figure.left += share * dx;
                        node.figure.top += share * dy;
                    }
                    if (isCarried || layerMoves) {
                        this.#placeFigure(node);
                        placed.add(node);
                    }
                }
                this.#routeOf(placed);
            },
            finish: () => {
                for (const node of carried) {
                    this.#fileUnderLayer(node);
                }
                this.#routeOf(carried);

                if (layers.length === 1 && tables.length === 0) {
                    return `Move Layer ${layers[0].layer.name}`;
                }
                if (tables.length === 1 && layers.length === 0) {
                    return `Move ${tables[0].figure.name}`;
                }

                return layers.length === 0
                    ? `Move ${tables.length} Tables`
                    : `Move ${layers.length + tables.length} Items`;
            },
        };
    }

    public beginResize(id: string): IResizeSession {
        const layer = this.#layers.get(id);
        if (layer !== undefined) {
            return this.#resizeLayer(layer);
        }
        const node = this.#figures.get(id)!;

        return {
            resizeTo: (rect, handle) => {
                const figure = node.figure;
                figure.left = rect.left - (node.layer?.left ?? 0);
                figure.top = rect.top - (node.layer?.top ?? 0);
                figure.width = rect.width;
                // The top or bottom edge sizes the height by hand from
                // then on; the left and right edges the width alone.
                if (handle.fy !== 0.5) {
                    figure.manualSizing = true;
                    figure.height = rect.height;
                }
                this.#relayout(node);
                this.#routeOf(new Set([node]));
            },
            finish: () => {
                this.#fileUnderLayer(node);
                this.#routeOf(new Set([node]));

                return `Resize ${node.figure.name}`;
            },
        };
    }

    /**
     * A layer's resize: the tables filed under it keep their places on the
     * page as its corner moves, and are filed again at the end - under it,
     * where they now lie fully on it, or elsewhere where they no longer do.
     */
    #resizeLayer(node: ILayerNode): IResizeSession {
        const { layer } = node;

        return {
            resizeTo: (rect) => {
                const dx = rect.left - layer.left;
                const dy = rect.top - layer.top;
                Object.assign(layer, {
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                });
                const filed = new Set(this.#filedUnder(layer));
                for (const table of filed) {
                    table.figure.left -= dx;
                    table.figure.top -= dy;
                    this.#placeFigure(table);
                }
                // A new size can change the stacking of every layer.
                this.#restack();
                for (const other of this.#layers.values()) {
                    this.#placeLayer(other);
                }
                this.#routeOf(filed);
            },
            finish: () => {
                const rect = layerRect(layer);
                for (const table of this.#figures.values()) {
                    if (table.figure.layer === layer.id
                        || containsRect(rect, this.#figureRect(table))) {
                        this.#fileUnderLayer(table);
                    }
                }
                this.#routeAll();

                return `Resize Layer ${layer.name}`;
            },
        };
    }

    public beginElevate(id: string): IElevateSession {
        const node = this.#layers.get(id)!;
        // The drag's own height, before the range cuts it, so that moving
        // back past the limit does not move the layer before the pointer
        // is back.
        let wanted = this.#elevation(node.layer);

        return {
            elevateBy: (dz) => {
                wanted += dz;
                node.layer.elevation = Math.min(MAX_LAYER_ELEVATION,
                    Math.max(0, wanted));
                // The layer, and the tables filed under it, rise.
                this.#placeLayer(node);
                const filed = new Set(this.#filedUnder(node.layer));
                for (const table of filed) {
                    this.#placeFigure(table);
                }
                this.#routeOf(filed);
            },
            finish: () => {
                return node.layer.elevation === 0
                    ? `Lower Layer ${node.layer.name}`
                    : `Raise Layer ${node.layer.name}`;
            },
        };
    }

    // --- IFigureSet: undo -------------------------------------------------

    public snapshot(): ISnapshot {
        return {
            figures: this.#diagram.figures.map((figure) => {
                return [figure, figureState(figure)];
            }),
            layers: this.#diagram.layers.map((layer) => {
                return [layer, layerState(layer)];
            }),
        };
    }

    public sameSnapshot(a: unknown, b: unknown): boolean {
        const first = a as ISnapshot;
        const second = b as ISnapshot;

        return first.figures.length === second.figures.length
            && first.layers.length === second.layers.length
            && first.figures.every(([figure, state], index) => {
                const [other, otherState] = second.figures[index];

                return figure === other && sameState(state, otherState);
            })
            && first.layers.every(([layer, state], index) => {
                const [other, otherState] = second.layers[index];

                return layer === other && sameState(state, otherState);
            });
    }

    public restore(snapshot: unknown): void {
        const { figures, layers } = snapshot as ISnapshot;
        for (const [layer, state] of layers) {
            Object.assign(layer, state);
        }
        const changed = new Set<IModelFigure>();
        for (const [figure, state] of figures) {
            if (!sameState(figureState(figure), state)) {
                Object.assign(figure, state);
                changed.add(figure);
            }
        }
        // Drawn again where shown: the snapshot may be of another diagram.
        this.#restack();
        for (const node of this.#layers.values()) {
            this.#placeLayer(node);
        }
        for (const node of this.#figures.values()) {
            node.layer = this.#layerById(node.figure.layer);
            if (changed.has(node.figure)) {
                this.#relayout(node);
            } else {
                this.#placeFigure(node);
            }
        }
        this.#routeAll();
    }

    // --- IFigureSet: menus ------------------------------------------------

    public menu(id: string): IMenuEntry[] {
        const layer = this.#layers.get(id);
        if (layer !== undefined) {
            const empty = this.#tablesOn(layer.layer).length === 0;

            return [
                { id: "renameLayer", caption: "Rename Layer" },
                { id: "selectTables", caption: "Select Tables on Layer",
                    disabled: empty },
                { id: "fitToTables", caption: "Fit to Tables",
                    disabled: empty },
            ];
        }
        const node = this.#figures.get(id);
        if (node === undefined || !isCard(node.kind)) {
            return [];
        }
        const figure = node.figure;
        const expanded = figure.expanded !== false;
        const autoSize: IMenuEntry = {
            id: "autoSize",
            caption: "Auto-Size Height",
            disabled: figure.manualSizing !== true,
        };
        if (node.kind === "routines") {
            return this.#options.editable === true
                ? [{ id: "addRoutine", caption: "Add Routine" },
                    { id: "separator1" }, autoSize]
                : [autoSize];
        }
        if (node.kind === "view") {
            return [
                { id: "toggleExpanded",
                    caption: expanded ? "Collapse" : "Expand" },
                { id: "separator1" },
                autoSize,
            ];
        }
        // Names are changed in the SQL, through msm: a project's only.
        const rename: IMenuEntry[] = this.#options.editable === true
            ? [{
                id: "rename",
                caption: "Rename Table",
                disabled: node.layout.items[0]?.editable !== true,
            }]
            : [];

        return [
            { id: "toggleExpanded", caption: expanded ? "Collapse" : "Expand" },
            { id: "separator1" },
            {
                id: "toggleIndices",
                caption: "Show Indexes",
                checked: figure.indicesExpanded === true,
                disabled: !expanded,
            },
            {
                id: "toggleForeignKeys",
                caption: "Show Foreign Keys",
                checked: figure.foreignKeysExpanded === true,
                disabled: !expanded,
            },
            { id: "separator2" },
            autoSize,
            ...rename,
        ];
    }

    public runCommand(id: string, command: string): void {
        const host = this.#host;
        if (host === undefined) {
            return;
        }
        const layer = this.#layers.get(id);
        if (layer !== undefined) {
            this.#runLayerCommand(host, layer, command);

            return;
        }
        const node = this.#figures.get(id);
        if (node === undefined) {
            return;
        }
        const name = node.figure.name;
        const change = (label: string, apply: (figure: IModelFigure) => void) => {
            host.change(label, () => {
                apply(node.figure);
                this.#relayout(node);
                this.#routeOf(new Set([node]));
            });
        };
        switch (command) {
            case "toggleExpanded": {
                const expanded = node.figure.expanded !== false;
                change(`${expanded ? "Collapse" : "Expand"} ${name}`,
                    (figure) => { figure.expanded = !expanded; });
                break;
            }

            case "toggleIndices": {
                const shown = node.figure.indicesExpanded === true;
                change(`${shown ? "Hide" : "Show"} Indexes of ${name}`,
                    (figure) => { figure.indicesExpanded = !shown; });
                break;
            }

            case "toggleForeignKeys": {
                const shown = node.figure.foreignKeysExpanded === true;
                change(`${shown ? "Hide" : "Show"} Foreign Keys of ${name}`,
                    (figure) => { figure.foreignKeysExpanded = !shown; });
                break;
            }

            case "autoSize": {
                change(`Auto-Size ${name}`,
                    (figure) => { figure.manualSizing = false; });
                break;
            }

            case "addRoutine": {
                this.#tools.addRoutine(node.figure.id);
                break;
            }

            case "rename": {
                const title = node.layout.items[0];
                if (title?.editable === true) {
                    this.#editCardItem(node, title);
                }
                break;
            }

            default:
        }
    }

    #runLayerCommand(host: ICanvasHost, node: ILayerNode, command: string): void {
        switch (command) {
            case "renameLayer": {
                this.#editLayerName(node);
                break;
            }

            case "selectTables": {
                host.select(this.#tablesOn(node.layer).map((table) => {
                    return table.figure.id;
                }));
                break;
            }

            case "fitToTables": {
                const tables = this.#tablesOn(node.layer);
                const rect = fitAround(tables.map((table) => {
                    return this.#figureRect(table);
                }));
                if (rect === undefined) {
                    return;
                }
                host.change(`Fit Layer ${node.layer.name} to Tables`, () => {
                    const session = this.#resizeLayer(node);
                    session.resizeTo(rect, { fx: 0, fy: 0, cursor: "" });
                    session.finish();
                });
                break;
            }

            default:
        }
    }

    // --- Editing names ------------------------------------------------------

    public doubleClick(id: string, probe: IProbe): void {
        const hit = this.#figureHit(probe);
        if (hit !== undefined && hit.node.figure.id === id) {
            const rect = this.#figureRect(hit.node);
            // The plane's UV runs from its bottom left; the card's items
            // are measured from its top left.
            const item = cardItemAt(hit.node.layout, hit.uv.x * rect.width,
                (1 - hit.uv.y) * rect.height);
            if (item?.editable === true) {
                this.#editCardItem(hit.node, item);
            }

            return;
        }
        const layer = this.#layers.get(id);
        if (layer !== undefined) {
            const point = probe.pointOn("base", this.#elevation(layer.layer));
            const band = {
                ...layerRect(layer.layer),
                height: LAYER_LABEL.top + LAYER_LABEL.height + 4,
            };
            if (point !== undefined && containsPoint(band, point)) {
                this.#editLayerName(layer);
            }
        }
    }

    /**
     * Opens the input over a table's or column's name.
     *
     * @param node The table's figure.
     * @param item The name's item.
     * @param text What the input holds: the name, or one msm refused.
     */
    #editCardItem(node: IFigureNode, item: ICardItem, text = item.text): void {
        const title = item.kind === "title";
        const spec: IEditSpec = {
            text,
            label: title ? "Table name" : "Column name",
            bold: title,
            fontSize: title ? CARD.titleFontSize : CARD.rowFontSize,
            plane: "lifted",
            elevation: () => { return this.#elevation(node.layer); },
            area: () => {
                if (this.#figures.get(node.figure.id) !== node) {
                    return undefined;
                }
                const rect = this.#figureRect(node);
                const area = editRect(item);

                return { ...area, left: rect.left + area.left,
                    top: rect.top + area.top };
            },
            commit: (text) => { this.#renameCardItem(node, item, text); },
        };
        this.#host?.startEdit(spec);
    }

    /** Opens the input over a layer's name. */
    #editLayerName(node: ILayerNode): void {
        const { layer } = node;
        this.#host?.startEdit({
            text: layer.name,
            label: "Layer name",
            bold: true,
            fontSize: LAYER_LABEL.fontSize,
            plane: "base",
            elevation: () => { return this.#elevation(layer); },
            area: () => {
                if (this.#layers.get(layer.id) !== node) {
                    return undefined;
                }

                return {
                    left: layer.left + LAYER_LABEL.left - 2,
                    top: layer.top + LAYER_LABEL.top,
                    width: Math.max(40, Math.min(
                        Math.max(node.labelWidth + 40, 120),
                        layer.width - LAYER_LABEL.left - 30)),
                    height: LAYER_LABEL.height,
                };
            },
            commit: (text) => {
                const name = text.trim();
                const old = layer.name;
                if (name === "" || name === old) {
                    return;
                }
                this.#host?.change(`Rename Layer ${old} to ${name}`, () => {
                    layer.name = name;
                    this.#placeLayer(node);
                });
            },
        });
    }

    /**
     * Renames a table or a column, as one action of the history: shown at
     * once, and sent to msm, which makes the change in the SQL (and, once
     * done, sends the snapshot that says so: `replaceObjects`). Undone, the
     * name goes back the same way.
     */
    #renameCardItem(node: IFigureNode, item: ICardItem, text: string): void {
        const host = this.#host;
        const catalog = this.#options.catalog;
        const name = text.trim();
        if (host === undefined || name === "" || name === item.text) {
            return;
        }
        const table = catalog.table(tableOf(node.figure));
        if (table === undefined) {
            return;
        }
        const tableName = table.name;
        if (item.kind === "title") {
            const other = catalog.table(name);
            if (other !== undefined && other !== table) {
                // Another table has that name; two would be one.
                return;
            }
            const rename = (from: string, to: string,
                failed?: (message: string) => void): void => {
                this.#renameTable(from, to);
                this.#options.onSchemaEdit?.([{
                    op: "rename_table", table: from, new_name: to,
                }], undefined, failed);
            };
            const action = {
                label: `Rename Table ${tableName} to ${name}`,
                undo: () => { rename(name, tableName); },
                redo: () => { rename(tableName, name); },
            };
            rename(tableName, name, (message) => {
                // Refused: the old name again, and the input over it with
                // the name typed, to fix.
                host.history.discard(action);
                this.#renameTable(name, tableName);
                host.hint(message);
                this.#reopenRename(node.figure.id, (entry) => {
                    return entry.kind === "title";
                }, name);
            });
            host.history.record(action);
        } else if (item.kind === "column") {
            const old = item.text;
            if (table.columns.some((column) => {
                return sameName(column.name, name) && !sameName(name, old);
            })) {
                return;
            }
            const figure = node.figure;
            // The table may have been renamed since; it is found through
            // the figure, which follows the table.
            const rename = (from: string, to: string,
                failed?: (message: string) => void): void => {
                const current = tableOf(figure);
                this.#options.catalog.renameColumn(current, from, to);
                this.#relayoutTable(current);
                this.#options.onSchemaEdit?.([{
                    op: "rename_column", table: current, column: from,
                    new_name: to,
                }], undefined, failed);
            };
            const action = {
                label: `Rename Column ${tableName}.${old} to ${name}`,
                undo: () => { rename(name, old); },
                redo: () => { rename(old, name); },
            };
            rename(old, name, (message) => {
                host.history.discard(action);
                const current = tableOf(figure);
                this.#options.catalog.renameColumn(current, name, old);
                this.#relayoutTable(current);
                host.hint(message);
                this.#reopenRename(figure.id, (entry) => {
                    return entry.kind === "column" && entry.text === old;
                }, name);
            });
            host.history.record(action);
        }
    }

    /**
     * Opens a name's input again over its item, with a name msm refused.
     *
     * @param figureId The figure.
     * @param find Finds the item.
     * @param text The name refused.
     */
    #reopenRename(
        figureId: string,
        find: (item: ICardItem) => boolean,
        text: string,
    ): void {
        const node = this.#figures.get(figureId);
        const item = node?.layout.items.find(find);
        if (node !== undefined && item !== undefined) {
            this.#editCardItem(node, item, text);
        }
    }

    /**
     * Renames a table: in the catalog, and on every figure and connection
     * of every diagram that names it, as msm does with the stored
     * diagrams.
     */
    #renameTable(from: string, to: string): void {
        this.#options.catalog.renameTable(from, to);
        for (const diagram of this.#options.diagrams) {
            for (const figure of diagram.figures) {
                if (kindOf(figure) === "table"
                    && sameName(tableOf(figure), from)) {
                    if (sameName(figure.name, from)) {
                        figure.name = to;
                    }
                    figure.table = to;
                }
            }
            for (const connection of diagram.connections) {
                if (sameName(connection.table, from)) {
                    connection.table = to;
                }
            }
        }
        this.#relayoutTable(to);
    }

    /** Draws every shown figure of a table again. */
    #relayoutTable(tableName: string): void {
        const changed = new Set<IFigureNode>();
        for (const node of this.#figures.values()) {
            if (node.kind === "table" && sameName(tableOf(node.figure), tableName)) {
                this.#relayout(node);
                changed.add(node);
            }
        }
        this.#routeOf(changed);
        this.#host?.invalidate();
    }

    /**
     * Takes the snapshot msm made after a schema edit - what the SQL now
     * says - and draws every figure from it.
     *
     * @param objects The snapshot's objects.
     */
    public replaceObjects(objects: ISchemaObjects): void {
        this.#options.catalog.replace(objects);
        this.#refresh();
    }

    /** Lays every card out again from the catalog, and routes again. */
    #refresh(): void {
        if (this.#host === undefined) {
            return;
        }
        for (const node of this.#figures.values()) {
            if (isCard(node.kind)) {
                this.#relayout(node);
            }
        }
        this.#routeAll();
        this.#host.invalidate();
    }

    // --- The palette's tools ------------------------------------------------

    public toolDown(tool: string, probe: IProbe): IToolSession | undefined {
        return this.#tools.down(tool, probe);
    }

    public toolHover(tool: string, probe: IProbe): void {
        this.#tools.hover(tool, probe);
    }

    public toolCancel(): void {
        this.#tools.cancel();
    }

    /**
     * Moves an existing-columns relationship on to its referenced columns:
     * the button of its panel.
     */
    public pickReferenced(): void {
        this.#tools.pickReferenced();
    }

    /**
     * Places objects the schema has on the diagram shown.
     *
     * @param refs The objects.
     * @param point Where the first goes.
     *
     * @returns Nothing.
     */
    public placeObjects(refs: readonly ISchemaObjectRef[], point: IPoint): void {
        this.#tools.placeObjects(refs, point);
    }

    /** @returns The set as the tools see it. */
    #toolTarget(): IToolTarget {
        const set = this;

        return {
            catalog: this.#options.catalog,
            get history() { return set.#host!.history; },
            diagram: () => { return this.#diagram; },
            hit: (probe) => { return this.#toolHit(probe); },
            pointOf: (probe) => { return probe.pointOn("base", 0); },
            figureRect: (id) => {
                const node = this.#figures.get(id);

                return node === undefined ? undefined : this.#figureRect(node);
            },
            figure: (id) => {
                return this.#diagram.figures.find((figure) => {
                    return figure.id === id;
                });
            },
            addFigure: (figure) => { this.#addFigure(figure); },
            removeFigure: (id) => { return this.#removeFigure(id); },
            addLayer: (layer) => { this.#addLayer(layer); },
            removeLayer: (id) => { this.#removeLayer(id); },
            addConnection: (connection) => { this.#addConnection(connection); },
            removeConnection: (id) => { this.#removeConnection(id); },
            refresh: () => { this.#refresh(); },
            editItem: (id, find, edit) => { this.#editItem(id, find, edit); },
            highlight: (highlight) => {
                this.#toolHighlight = highlight;
                this.#drawHighlight();
            },
            band: (rect) => { this.#drawBand(rect); },
            select: (ids) => { this.#host?.select(ids); },
            hint: (text) => { this.#host?.hint(text); },
            done: () => { this.#host?.toolDone(); },
            schemaEdit: (edits, failed) => {
                this.#options.onSchemaEdit?.(edits, [this.#diagram], failed);
            },
            pickImage: () => {
                return this.#options.pickImage?.() ?? Promise.resolve(undefined);
            },
            panel: (panel) => { this.#options.onToolPanel?.(panel); },
        };
    }

    /** What is under the pointer for a tool: a figure and its row, or a layer. */
    #toolHit(probe: IProbe): IToolHit | undefined {
        const hit = this.#figureHit(probe);
        if (hit === undefined) {
            const layer = this.#layerAt(probe);

            return layer === undefined ? undefined
                : { figureId: layer.layer.id, layer: true };
        }
        const { node } = hit;
        if (node.kind !== "table") {
            return { figureId: node.figure.id };
        }
        const rect = this.#figureRect(node);
        const item = cardItemAt(node.layout, hit.uv.x * rect.width,
            (1 - hit.uv.y) * rect.height);

        return {
            figureId: node.figure.id,
            table: tableOf(node.figure),
            column: item?.kind === "column" ? item.text : undefined,
        };
    }

    #addFigure(figure: IModelFigure): void {
        if (!this.#diagram.figures.includes(figure)) {
            this.#diagram.figures.push(figure);
        }
        if (this.#host === undefined || this.#figures.has(figure.id)) {
            return;
        }
        this.#buildFigure(figure);
        const node = this.#figures.get(figure.id);
        if (node !== undefined && figure.layer === undefined) {
            this.#fileUnderLayer(node);
        }
        this.#host.invalidate();
    }

    /** Removes a figure, and the connections to it, which it returns. */
    #removeFigure(id: string): IModelConnection[] {
        const diagram = this.#diagram;
        const connections = diagram.connections.filter((connection) => {
            return connection.startFigure === id || connection.endFigure === id;
        });
        for (const connection of connections) {
            this.#removeConnection(connection.id);
        }
        diagram.figures = diagram.figures.filter((figure) => {
            return figure.id !== id;
        });
        const node = this.#figures.get(id);
        if (node !== undefined) {
            for (const object of [node.mesh, node.slab, node.shadow]) {
                object.removeFromParent();
                disposeGroup(object);
            }
            this.#figures.delete(id);
            this.#rasterQueue.delete(node);
            this.#cardMeshes = this.#cardMeshes.filter((mesh) => {
                return mesh !== node.mesh;
            });
            this.#host?.select([]);
            this.#host?.invalidate();
        }

        return connections;
    }

    /** Adds a layer, and files the figures lying on it under it. */
    #addLayer(layer: IModelLayer): void {
        if (!this.#diagram.layers.includes(layer)) {
            this.#diagram.layers.push(layer);
        }
        if (this.#host === undefined) {
            return;
        }
        this.#buildLayer(layer);
        this.#restack();
        this.#refile();
    }

    /** Removes a layer; its figures keep their places on the page. */
    #removeLayer(id: string): void {
        const layer = this.#diagram.layers.find((entry) => {
            return entry.id === id;
        });
        this.#diagram.layers = this.#diagram.layers.filter((entry) => {
            return entry.id !== id;
        });
        for (const figure of this.#diagram.figures) {
            if (layer !== undefined && figure.layer === id) {
                figure.left += layer.left;
                figure.top += layer.top;
                figure.layer = undefined;
            }
        }
        const node = this.#layers.get(id);
        if (node !== undefined) {
            for (const object of [node.plate, node.border, node.label]) {
                object.removeFromParent();
                disposeGroup(object);
            }
            this.#layers.delete(id);
            this.#host?.select([]);
        }
        if (this.#host !== undefined) {
            for (const figure of this.#figures.values()) {
                figure.layer = this.#layerById(figure.figure.layer);
            }
            this.#restack();
            this.#refile();
        }
    }

    /** Files every figure under the layer it lies on, and draws them. */
    #refile(): void {
        for (const node of this.#layers.values()) {
            this.#placeLayer(node);
        }
        for (const node of this.#figures.values()) {
            this.#fileUnderLayer(node);
            this.#placeFigure(node);
        }
        this.#routeAll();
        this.#host?.invalidate();
    }

    #addConnection(connection: IModelConnection): void {
        if (!this.#diagram.connections.includes(connection)) {
            this.#diagram.connections.push(connection);
        }
        if (this.#host !== undefined && !this.#connections.some((node) => {
            return node.connection === connection;
        })) {
            this.#buildConnection(connection);
            this.viewChanged();
            this.#host.invalidate();
        }
    }

    #removeConnection(id: string): void {
        this.#diagram.connections = this.#diagram.connections.filter(
            (connection) => { return connection.id !== id; });
        this.#connections = this.#connections.filter((node) => {
            if (node.connection.id !== id) {
                return true;
            }
            node.line.removeFromParent();
            node.line.geometry.dispose();
            node.line.material.dispose();

            return false;
        });
        this.#host?.invalidate();
    }

    /** Opens an input over an item of a figure's card, for a tool. */
    #editItem(
        figureId: string,
        find: (item: ICardItem) => boolean,
        edit: IToolEdit,
    ): void {
        const node = this.#figures.get(figureId);
        const item = node?.layout.items.find(find);
        if (node === undefined || item === undefined) {
            edit.cancel?.();

            return;
        }
        const title = item.kind === "title";
        this.#host?.startEdit({
            ...edit,
            bold: title,
            fontSize: title ? CARD.titleFontSize : CARD.rowFontSize,
            plane: "lifted",
            elevation: () => { return this.#elevation(node.layer); },
            area: () => {
                // Found again: the card may be laid out anew meanwhile.
                const current = this.#figures.get(figureId);
                const found = current?.layout.items.find(find);
                if (current === undefined || found === undefined) {
                    return undefined;
                }
                const rect = this.#figureRect(current);
                const area = editRect(found);

                return { ...area, left: rect.left + area.left,
                    top: rect.top + area.top };
            },
        });
    }

    /**
     * Takes marks a tool drew off the scene, and frees them.
     *
     * @param marks The marks.
     */
    #clearMarks(marks: readonly THREE.Object3D[]): void {
        for (const mark of marks) {
            mark.removeFromParent();
            disposeGroup(mark);
        }
    }

    /** Draws what a relationship tool marks: tables, and column rows. */
    #drawHighlight(): void {
        this.#clearMarks(this.#highlightMarks);
        this.#highlightMarks = [];
        const highlight = this.#toolHighlight;
        const host = this.#host;
        if (highlight === undefined || host === undefined) {
            host?.invalidate();

            return;
        }
        const color = new THREE.Color(host.theme.selection);
        const lift = host.lift();
        for (const id of new Set(highlight.figures)) {
            const node = this.#figures.get(id);
            if (node === undefined) {
                continue;
            }
            const rect = this.#figureRect(node);
            const outline = new THREE.LineLoop(new THREE.BufferGeometry()
                .setFromPoints(roundedRect(rect.left - 2, -(rect.top - 2)
                    - (rect.height + 4), rect.width + 4, rect.height + 4,
                CARD.radius + 2).getPoints(6)),
            new THREE.LineBasicMaterial({ color }));
            outline.position.z = this.#elevation(node.layer) * lift
                + Z.liftedDecoration;
            setDrawOrder(outline, DRAW_ORDER.decorations);
            this.#lifted.add(outline);
            this.#highlightMarks.push(outline);
        }
        for (const row of highlight.rows) {
            const node = this.#figures.get(row.figureId);
            const item = node?.layout.items.find((entry) => {
                return entry.kind === "column" && sameName(entry.text, row.column);
            });
            if (node === undefined || item === undefined) {
                continue;
            }
            const card = this.#figureRect(node);
            const rect = { left: card.left + item.rect.left,
                top: card.top + item.rect.top, width: item.rect.width,
                height: item.rect.height };
            const center = planeCenter(rect);
            const fill = new THREE.Mesh(
                new THREE.PlaneGeometry(rect.width, rect.height),
                new THREE.MeshBasicMaterial({ color, transparent: true,
                    opacity: 0.3, depthWrite: false }));
            fill.position.set(center.x, center.y,
                this.#elevation(node.layer) * lift + Z.liftedDecoration);
            setDrawOrder(fill, DRAW_ORDER.decorations);
            this.#lifted.add(fill);
            this.#highlightMarks.push(fill);
        }
        host.invalidate();
    }

    /**
     * Draws the area a layer is dragged out over.
     *
     * @param rect The area; none takes the marks away.
     */
    #drawBand(rect?: IRect): void {
        this.#clearMarks(this.#bandMarks);
        this.#bandMarks = [];
        const host = this.#host;
        if (rect === undefined || host === undefined) {
            host?.invalidate();

            return;
        }
        const color = new THREE.Color(host.theme.selection);
        const center = planeCenter(rect);
        const fill = new THREE.Mesh(
            new THREE.PlaneGeometry(Math.max(1, rect.width),
                Math.max(1, rect.height)),
            new THREE.MeshBasicMaterial({ color, transparent: true,
                opacity: 0.12, depthWrite: false }));
        fill.position.set(center.x, center.y, Z.baseDecoration);
        const border = new THREE.LineSegments(
            segmentsGeometry(rectSegments(rect), Z.baseDecoration),
            new THREE.LineBasicMaterial({ color }));
        for (const mark of [fill, border]) {
            setDrawOrder(mark, DRAW_ORDER.decorations);
            this.#base.add(mark);
            this.#bandMarks.push(mark);
        }
        host.invalidate();
    }
}

/**
 * Keeps a figure's height in the model where it follows its content, so
 * that what is stored is what is drawn.
 *
 * @param figure The figure.
 * @param layout Its card's layout.
 */
const keepAutoHeight = (figure: IModelFigure, layout: ICardLayout): void => {
    if (figure.manualSizing !== true) {
        figure.height = layout.height;
    }
};
