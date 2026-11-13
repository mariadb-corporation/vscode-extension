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

import type { JSX } from "preact";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "preact/hooks";

import tableIcon from "../assets/modeler/schemaTable.svg?raw";
import columnIcon from "../assets/modeler/schemaTableColumn.svg?raw";
import columnNotNullIcon from "../assets/modeler/schemaTableColumnNN.svg?raw";
import columnPrimaryKeyIcon from "../assets/modeler/schemaTableColumnPK.svg?raw";
import foreignKeyIcon from "../assets/modeler/schemaTableForeignKey.svg?raw";
import indexIcon from "../assets/modeler/schemaTableIndex.svg?raw";
import viewIcon from "../assets/modeler/schemaView.svg?raw";
import routineIcon from "../assets/modeler/schemaRoutine.svg?raw";
import triggerIcon from "../assets/modeler/schemaTrigger.svg?raw";
import eventIcon from "../assets/modeler/schemaEvent.svg?raw";
import sequenceIcon from "../assets/modeler/schemaSequence.svg?raw";
import restObjectIcon from "../assets/modeler/restObject.svg?raw";

import type { DiagramItem } from "../../../src/details/objectDetails.js";
import type { IMsmSchemaEdit } from "../../../src/mcp/msmApi.js";
import {
    diagramDocument,
    type IModelDiagram,
    type ISchemaModel,
} from "../../../src/modeler/modelFormat.js";
import { matchingTypes } from "../../../src/sql/columnTypes.js";
import {
    isPlaceOf,
    parseSchemaObjectUris,
    type IDiagramView,
    type IRestObjectPaths,
    type ModelerHostMessage,
    type ModelerTarget,
    type SaveState,
} from "../../../src/modeler/modelerProtocol.js";
import type { IPageSettings } from "../../../src/modeler/pageSettings.js";
import { Canvas, ZOOM_RANGE } from "../canvas/Canvas.js";
import {
    CanvasMenu,
    MenuButton,
    pointUnder,
} from "../canvas/CanvasMenu.js";
import { CanvasToolbar, ToolbarSection } from "../canvas/CanvasToolbar.js";
import type {
    EditCommit,
    ICanvasOverlay,
    IEditChoice,
    IEditRequest,
    IMenuEntry,
    INavigatorState,
    Tool,
    ViewMode,
} from "../canvas/canvasTypes.js";
import {
    CUSTOM_ISO_PRESET,
    customPreset,
    ISO_PRESETS,
    isoPreset,
    type IIsoAngles,
} from "../canvas/geometry.js";
import { Navigator } from "../canvas/Navigator.js";
import { readTheme } from "../canvas/theme.js";
import { loadState, post, saveState } from "../vscodeApi.js";
import { catalogFromModel } from "./catalog.js";
import {
    DIAGRAM_TOOLS,
    MAX_PICTURE_BYTES,
    type IPickedImage,
    type IToolPanel,
} from "./diagramTools.js";
import { DiagramToolbar, ToolPanel } from "./DiagramToolbar.js";
import { EerFigureSet } from "./EerFigureSet.js";
import { objectsOfFigures } from "./placeObjects.js";
import { svgImage, type CardIcons } from "./tableCard.js";

/**
 * The schema model viewer: the canvas showing the model's EER diagrams as
 * a figure set, its toolbar, the Navigator, the menus, and the input laid
 * over a name while it is edited in place.
 */

/**
 * Loads the card icons in a colour.
 *
 * @param color The colour.
 *
 * @returns The icons.
 */
const loadIcons = async (color: string): Promise<CardIcons> => {
    const [table, primaryKey, notNull, nullable, index, foreignKey, view,
        routine, trigger, event, sequence, rest] = await Promise.all([
        svgImage(tableIcon, color),
        svgImage(columnPrimaryKeyIcon, color),
        svgImage(columnNotNullIcon, color),
        svgImage(columnIcon, color),
        svgImage(indexIcon, color),
        svgImage(foreignKeyIcon, color),
        svgImage(viewIcon, color),
        svgImage(routineIcon, color),
        svgImage(triggerIcon, color),
        svgImage(eventIcon, color),
        svgImage(sequenceIcon, color),
        svgImage(restObjectIcon, color),
    ]);

    return { table, primaryKey, notNull, nullable, index, foreignKey, view,
        routine, trigger, event, sequence, rest };
};

/** What the viewer keeps across a reload of the webview. */
interface IViewerState {
    /** The 3D view last chosen. */
    isoPreset?: string;
    /** The angles the user orbited to last, if ever. */
    custom?: { tilt: number; turn: number };
    /** Whether the Navigator is shown; it is unless hidden. */
    navigator?: boolean;
    /** Whether the tool palette is shown; it is unless hidden. */
    tools?: boolean;
    /** Whether the printable areas are marked; they are not unless asked. */
    margins?: boolean;
    /**
     * What the panel shows, which VS Code hands back to the extension to
     * restore the panel after a restart.
     */
    target?: ModelerTarget;
}

/**
 * @returns What the viewer kept, or nothing usable.
 */
const viewerState = (): IViewerState => {
    const state = loadState();

    return typeof state === "object" && state !== null
        ? state as IViewerState
        : {};
};

/**
 * Keeps part of the viewer's state.
 *
 * @param change What changes.
 */
const keepState = (change: Partial<IViewerState>): void => {
    saveState({ ...viewerState(), ...change });
};

interface ILoaded {
    model: ISchemaModel;
    set: EerFigureSet;
    source: string;
    pageSettings: IPageSettings;
    /** Whether diagrams are saved and schema objects renamed (a project). */
    editable: boolean;
    /** Each diagram's document as last sent to be saved, by name. */
    sent: Map<string, string>;
    /** What the viewer shows: a dropped object has to be of its schema. */
    target: ModelerTarget;
}

/**
 * @param save Where a project's saves stand.
 *
 * @returns What the status line says of it.
 */
const saveText = (save: SaveState | undefined): string => {
    switch (save?.state) {
        case "pending": {
            return " · Changed";
        }

        case "saving": {
            return " · Saving…";
        }

        case "saved": {
            return " · Saved";
        }

        case "failed": {
            return ` · Not saved: ${save.message}`;
        }

        default: {
            return "";
        }
    }
};

/**
 * @param loaded The model shown.
 *
 * @returns Its diagrams' documents as they are saved, by name.
 */
const documentsOf = (loaded: Pick<ILoaded, "model">): Map<string, string> => {
    return new Map(loaded.model.diagrams.map((diagram) => {
        return [diagram.name,
            JSON.stringify(diagramDocument(diagram, loaded.model))];
    }));
};

/** Whose a menu is: an item's, the Navigator's or the toolbar's. */
type MenuOwner = { kind: "item"; id: string } | { kind: "navigator" }
    | { kind: "toolbar" };

/**
 * @param a A menu's owner.
 * @param b Another.
 *
 * @returns Whether they are the same.
 */
const sameOwner = (a: MenuOwner | undefined, b: MenuOwner): boolean => {
    return a !== undefined && a.kind === b.kind
        && (a.kind !== "item" || a.id === (b as { id: string }).id);
};

/** A menu open over the canvas host. */
interface IOpenMenu {
    owner: MenuOwner;
    items: IMenuEntry[];
    x: number;
    y: number;
    onCommand: (command: string) => void;
}

/** How long loading may take before a spinner shows. */
const SPINNER_DELAY_MS = 300;

/**
 * @param id A 3D preset's id, as kept.
 * @param hasCustom Whether the user's own angles come with it.
 *
 * @returns The preset to show: the user's angles where they are there,
 *          else a known preset, the default for one not known.
 */
const presetIdOf = (id: string | undefined, hasCustom: boolean): string => {
    return id === CUSTOM_ISO_PRESET && hasCustom
        ? CUSTOM_ISO_PRESET : isoPreset(id).id;
};

/** How long the view stays put before it is kept: a pan is over. */
const VIEW_KEEP_DELAY_MS = 500;

/** The size a picture without one of its own (an SVG) is placed at. */
const DEFAULT_PICTURE = { width: 160, height: 120 };

/**
 * How long the pointer has to have been still or away before a move counts
 * as its coming back: after a drag, which the page sees none of.
 */
const ARRIVAL_PAUSE_MS = 400;

/**
 * Reads a picture file picked for the image tool.
 *
 * @param file The file.
 *
 * @returns Its data URL and its size.
 */
const readPicture = async (file: File): Promise<IPickedImage> => {
    if (file.size > MAX_PICTURE_BYTES) {
        throw new Error(`${file.name} is larger than `
            + `${String(MAX_PICTURE_BYTES / 1024)} KB.`);
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => { resolve(String(reader.result)); };
        reader.onerror = () => {
            reject(new Error(`${file.name} cannot be read.`));
        };
        reader.readAsDataURL(file);
    });
    const size = await new Promise<{ width: number; height: number }>(
        (resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                resolve(image.naturalWidth > 0 && image.naturalHeight > 0
                    ? { width: image.naturalWidth, height: image.naturalHeight }
                    : DEFAULT_PICTURE);
            };
            image.onerror = () => {
                reject(new Error(`${file.name} is not a picture that can be `
                    + "shown."));
            };
            image.src = dataUrl;
        });

    return { dataUrl, ...size };
};

export const ModelViewer = (): JSX.Element => {
    const hostRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<Canvas>();
    const inputRef = useRef<HTMLInputElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    /**
     * Sends every diagram of a project whose document differs from what
     * was sent last: kept and saved.
     */
    const saveChanged = (): void => {
        const shown = loadedRef.current;
        if (shown === undefined || !shown.editable) {
            return;
        }
        for (const diagram of shown.model.diagrams) {
            const saved = diagramDocument(diagram, shown.model);
            const text = JSON.stringify(saved);
            if (shown.sent.get(diagram.name) !== text) {
                shown.sent.set(diagram.name, text);
                post({ type: "diagramChanged", document: saved });
            }
        }
    };
    /** The items selected, for the one Object Details shows. */
    const selectedRef = useRef<string[]>([]);
    /** @returns The one item selected, as Object Details shows it. */
    const selectedItem = (shown: { set: EerFigureSet; editable: boolean })
        : DiagramItem | undefined => {
        const ids = selectedRef.current;

        return ids.length === 1
            ? shown.set.itemProps(ids[0], shown.editable) : undefined;
    };
    /**
     * What takes back each schema edit sent, in order (msm answers them
     * one at a time): nothing for one the project is read again for.
     */
    const editsSentRef = useRef<Array<((message: string) => void) | undefined>>([]);
    /** Settles the image tool's request once a file is picked, or none. */
    const pickRef = useRef<(picked: Promise<IPickedImage | undefined>) => void>();
    /**
     * How each diagram was last looked at, by name: what VS Code kept,
     * and what changed since. A diagram opens as it was left.
     */
    const viewsRef = useRef(new Map<string, IDiagramView>());
    /** The diagram on the canvas, whose view a change is of. */
    const shownRef = useRef<string>();
    /** The diagram the canvas has finished loading, which can be revealed in. */
    const readyRef = useRef<string>();
    /** An item to show once its diagram is loaded (Show in Diagram). */
    const revealRef = useRef<{ diagram: string; id: string }>();
    /** Shows the item waiting, where its diagram is loaded. */
    const revealWaiting = (): void => {
        const waiting = revealRef.current;
        if (waiting !== undefined && readyRef.current === waiting.diagram
            && canvasRef.current?.reveal(waiting.id) === true) {
            revealRef.current = undefined;
        }
    };
    /** Keeps the view once it settles. */
    const viewTimerRef = useRef<ReturnType<typeof setTimeout>>();

    const [loaded, setLoaded] = useState<ILoaded>();
    const [error, setError] = useState<string>();
    // A spinner, only where loading takes a moment.
    const [slow, setSlow] = useState(false);
    /** The diagram shown, by name: the tree opens one by its name. */
    const [diagramName, setDiagramName] = useState<string>();
    const [tool, setTool] = useState<Tool>("pointer");
    const [view, setView] = useState<ViewMode>("2d");
    // What the viewer kept, read once.
    const [kept] = useState(viewerState);
    const [custom, setCustom] = useState<IIsoAngles | undefined>(() => {
        return kept.custom === undefined ? undefined
            : customPreset(kept.custom.tilt, kept.custom.turn);
    });
    const [isoPresetId, setIsoPresetId] = useState(() => {
        return presetIdOf(kept.isoPreset, kept.custom !== undefined);
    });
    // Read when the view is kept, which happens outside a render.
    const isoPresetRef = useRef(isoPresetId);
    isoPresetRef.current = isoPresetId;

    /**
     * Keeps how the diagram on the canvas is looked at, here and by
     * VS Code, where it changed.
     */
    const keepView = (): void => {
        clearTimeout(viewTimerRef.current);
        viewTimerRef.current = undefined;
        const canvas = canvasRef.current;
        const diagram = shownRef.current;
        if (canvas === undefined || diagram === undefined) {
            return;
        }
        const view: IDiagramView = {
            ...canvas.view,
            isoPreset: isoPresetRef.current,
        };
        const before = viewsRef.current.get(diagram);
        if (before === undefined
            || JSON.stringify(before) !== JSON.stringify(view)) {
            viewsRef.current.set(diagram, view);
            post({ type: "viewChanged", diagram, view });
        }
    };

    const [gridVisible, setGridVisible] = useState(true);
    const [pagesVisible, setPagesVisible] = useState(true);
    const [locked, setLocked] = useState(false);
    const [navigatorVisible, setNavigatorVisible] = useState(
        kept.navigator !== false);
    const [toolsVisible, setToolsVisible] = useState(kept.tools !== false);
    /** What the tool expects next, as the status line says it. */
    const [hint, setHint] = useState("");
    const [toolPanel, setToolPanel] = useState<IToolPanel>();
    /** Whether the edit's list of choices is open, and where it is. */
    const [choicesOpen, setChoicesOpen] = useState(false);
    const [choiceAt, setChoiceAt] = useState(0);
    const [choicesBox, setChoicesBox] = useState<{ left: number; top: number }>();
    const [navigator, setNavigator] = useState<INavigatorState>();
    const [marginsVisible, setMarginsVisible] = useState(kept.margins === true);
    const [zoom, setZoom] = useState(1);
    const [edit, setEdit] = useState<IEditRequest>();
    const [editText, setEditText] = useState("");
    const [overlays, setOverlays] = useState<ICanvasOverlay[]>([]);
    const [menu, setMenu] = useState<IOpenMenu>();
    const [save, setSave] = useState<SaveState>();
    /** The model shown, for the canvas's events, which outlive renders. */
    const loadedRef = useRef<ILoaded>();
    loadedRef.current = loaded;
    const closeMenu = useCallback(() => { setMenu(undefined); }, []);
    /**
     * Places the objects of a drop's `text/uri-list` that are of this
     * diagram's schema, at a point of the page; says why where none is.
     * Reads refs only: the host's answer to a tree drop calls it too.
     */
    const placeDropped = (uriList: string, x: number, y: number): void => {
        const shown = loadedRef.current;
        if (shown === undefined) {
            return;
        }
        const dropped = parseSchemaObjectUris(uriList);
        const ours = dropped.filter(({ place }) => {
            return isPlaceOf(place, shown.target);
        });
        const point = canvasRef.current?.pageAt(x, y);
        if (ours.length === 0) {
            setHint(dropped.length === 0
                ? "Only tables, views, routines, triggers, events, "
                    + "sequences and REST objects can be placed on a diagram."
                : "Only objects of this diagram's schema can be placed on it.");

            return;
        }
        if (point !== undefined) {
            shown.set.placeObjects(ours.map(({ ref }) => { return ref; }),
                point);
        }
    };
    // VS Code drops nothing dragged from a tree into a webview, Shift or
    // not. The page gets no pointer events while a drag is on, so its
    // first move after a pause, which is where a drag over it ended, asks
    // the extension for the objects of a drag that has just ended; it
    // answers only then (treeDropped).
    useEffect(() => {
        let last = 0;
        const moved = (event: MouseEvent): void => {
            const now = Date.now();
            const paused = now - last > ARRIVAL_PAUSE_MS;
            last = now;
            if (paused && event.type === "mousemove"
                && loadedRef.current !== undefined) {
                post({ type: "pointerArrived", x: event.clientX,
                    y: event.clientY });
            }
        };
        const types = ["mousemove", "mousedown", "wheel"] as const;
        for (const type of types) {
            window.addEventListener(type, moved as EventListener, true);
        }

        return () => {
            for (const type of types) {
                window.removeEventListener(type, moved as EventListener, true);
            }
        };
    }, []);
    const diagramIndex = Math.max(0, loaded?.model.diagrams.findIndex(
        (diagram) => { return diagram.name === diagramName; }) ?? 0);

    /**
     * A setting of the canvas the toolbar switches: kept as the toolbar's
     * state, and set on the canvas.
     *
     * @param key The canvas's property.
     * @param set Sets the state.
     *
     * @returns What the toolbar calls.
     */
    const mirror = <K extends "gridVisible" | "pagesVisible"
        | "locked" | "marginsVisible">(key: K, set: (value: Canvas[K]) => void) => {
        return (value: Canvas[K]): void => {
            set(value);
            if (canvasRef.current) {
                canvasRef.current[key] = value;
            }
        };
    };

    /** The 3D views to choose from: the presets, and the user's own. */
    const presets = custom === undefined ? ISO_PRESETS : [...ISO_PRESETS, custom];
    const presetFor = (id: string): IIsoAngles => {
        return id === CUSTOM_ISO_PRESET && custom !== undefined
            ? custom
            : isoPreset(id);
    };

    /**
     * Opens an item's menu at a point of the canvas host.
     *
     * @param id The item.
     * @param x Where the menu's top left corner goes.
     * @param y Where it goes.
     */
    const openItemMenu = (id: string, x: number, y: number): void => {
        const canvas = canvasRef.current;
        const items = canvas?.menu(id) ?? [];
        if (canvas !== undefined && items.length > 0) {
            setMenu({
                owner: { kind: "item", id },
                items,
                x,
                y,
                onCommand: (command) => { canvas.runCommand(id, command); },
            });
        }
    };

    // The canvas lives as long as the host element.
    useEffect(() => {
        const host = hostRef.current;
        if (host === null) {
            return;
        }
        const canvas = new Canvas(host, readTheme(), {
            onZoom: setZoom,
            onEditRequest: (request) => {
                setEdit(request);
                setEditText(request.text);
                setChoicesOpen(false);
            },
            onTool: (next) => { setTool(next); },
            onHint: setHint,
            onSelection: (ids) => {
                selectedRef.current = ids;
                const shown = loadedRef.current;
                if (shown === undefined) {
                    return;
                }
                // Nothing selected (a click on the canvas): Object Details
                // empties, the object with the item.
                if (ids.length === 0) {
                    post({ type: "selection", objects: [] });

                    return;
                }
                // What the figures show, for the Object Details view, and
                // the one item selected as itself.
                post({
                    type: "selection",
                    objects: objectsOfFigures(shown.set.diagram, ids,
                        shown.set.objects()),
                    item: selectedItem(shown),
                });
            },
            onEditPlacement: (placement) => {
                // The input follows its text as the view pans, zooms or
                // turns; nothing else of the edit changes.
                setEdit((current) => {
                    return current === undefined
                        ? current
                        : { ...current, placement };
                });
            },
            onEditEnd: () => { setEdit(undefined); },
            onOverlays: setOverlays,
            onContextMenu: (id, x, y) => { openItemMenu(id, x, y); },
            onViewMode: setView,
            onIsoAngles: (angles, final) => {
                // Orbiting makes the user's own 3D view, kept as such once
                // the orbit ends.
                setCustom(angles);
                setIsoPresetId(CUSTOM_ISO_PRESET);
                if (final) {
                    keepState({
                        isoPreset: CUSTOM_ISO_PRESET,
                        custom: { tilt: angles.tilt, turn: angles.turn },
                    });
                }
            },
            onNavigator: setNavigator,
            // Kept once it settles, not on every step of a pan.
            onViewChanged: () => {
                clearTimeout(viewTimerRef.current);
                // It reads refs only: the first render's does as well.
                viewTimerRef.current = setTimeout(keepView,
                    VIEW_KEEP_DELAY_MS);
            },
            // Every change of a project's diagram is kept and saved: those
            // whose document differs from what was sent last go.
            onHistory: () => {
                const shown = loadedRef.current;
                if (shown === undefined) {
                    return;
                }
                // Moved, resized, undone: Object Details follows.
                if (selectedRef.current.length === 1) {
                    post({ type: "item", item: selectedItem(shown) });
                }
                saveChanged();
            },
        });
        canvas.setIsoAngles(presetFor(isoPresetId));
        canvas.marginsVisible = marginsVisible;
        canvasRef.current = canvas;

        // VS Code switches the theme by swapping the body's class.
        const observer = new MutationObserver(() => {
            void canvas.setTheme(readTheme());
        });
        observer.observe(document.body, { attributes: true,
            attributeFilter: ["class"] });

        const onMessage = (event: MessageEvent<ModelerHostMessage>): void => {
            const message = event.data;
            switch (message.type) {
                case "load": {
                    setError(undefined);
                    // The edits still under way are answered in turn: their
                    // places are kept, what took them back goes with the
                    // figures it worked on.
                    editsSentRef.current = editsSentRef.current.map(() => {
                        return undefined;
                    });
                    // The diagram opened in the tree, else the first.
                    setDiagramName(message.diagram);
                    // What VS Code kept; a view changed here since is newer.
                    for (const [name, view] of Object.entries(
                        message.views ?? {})) {
                        if (!viewsRef.current.has(name)) {
                            viewsRef.current.set(name, view);
                        }
                    }
                    keepState({ target: message.target });
                    const set = new EerFigureSet({
                        catalog: catalogFromModel(message.model),
                        diagrams: message.model.diagrams,
                        loadIcons,
                        editable: message.editable,
                        restObjects: message.model.restObjects ?? [],
                        onEditTable: (table: string) => {
                            post({ type: "editTable", table });
                        },
                        // A project's only: a live schema's diagrams have
                        // no REST object figures.
                        ...(message.target.kind === "project" ? {
                            onEditRestObject: (object: IRestObjectPaths) => {
                                post({ type: "editRestObject", ...object });
                            },
                        } : {}),
                        // The lines followed the foreign keys: saved, as an
                        // action would be.
                        onConnectionsSynced: saveChanged,
                        onSchemaEdit: (schemaEdits: IMsmSchemaEdit[],
                            changed?: IModelDiagram[],
                            failed?: (message: string) => void) => {
                            const shown = loadedRef.current;
                            // The diagrams go with the edit, saved once it
                            // is made: not again as changes of their own.
                            const documents = shown === undefined
                                ? undefined
                                : changed?.map((diagram) => {
                                    const document = diagramDocument(diagram,
                                        shown.model);
                                    shown.sent.set(diagram.name,
                                        JSON.stringify(document));

                                    return document;
                                });
                            editsSentRef.current.push(failed);
                            post({ type: "schemaEdit", edits: schemaEdits,
                                ...(documents === undefined ? {} : { documents }),
                                ...(failed === undefined ? {} : { recover: true }) });
                        },
                        pickImage: () => {
                            return new Promise<IPickedImage | undefined>(
                                (resolve) => {
                                    const input = fileRef.current;
                                    if (input === null) {
                                        resolve(undefined);

                                        return;
                                    }
                                    pickRef.current = (picked) => {
                                        pickRef.current = undefined;
                                        picked.then(resolve, (reason: unknown) => {
                                            setHint(reason instanceof Error
                                                ? reason.message : String(reason));
                                            resolve(undefined);
                                        });
                                    };
                                    input.value = "";
                                    // In the press that placed it: a file
                                    // dialog opens only from a user's action.
                                    input.click();
                                });
                        },
                        onToolPanel: setToolPanel,
                        requestImage: (diagram, figureId) => {
                            post({ type: "imageWanted", diagram, figureId });
                        },
                    });
                    setLoaded({
                        model: message.model,
                        set,
                        source: message.source,
                        pageSettings: message.pageSettings,
                        editable: message.editable,
                        sent: documentsOf(message),
                        target: message.target,
                    });
                    break;
                }

                case "image": {
                    loadedRef.current?.set.pictureArrived(message.diagram,
                        message.figureId,
                        message.image, message.error);
                    break;
                }

                case "schemaEdited": {
                    // A done edit brings the snapshot of the SQL. A failed
                    // one is taken back by what sent it, or the model is
                    // read again from what the SQL still says.
                    const failed = editsSentRef.current.shift();
                    if (message.objects !== undefined) {
                        loadedRef.current?.set.replaceObjects(message.objects);
                    } else if (message.error !== undefined) {
                        failed?.(message.error);
                    }
                    break;
                }

                case "saveState": {
                    setSave(message.save);
                    break;
                }

                case "showDiagram": {
                    setDiagramName(message.name);
                    break;
                }

                case "selectItem": {
                    if (readyRef.current === message.diagram) {
                        canvasRef.current?.selectItems([message.id]);
                    }
                    break;
                }

                case "revealItem": {
                    revealRef.current = { diagram: message.diagram,
                        id: message.id };
                    if (shownRef.current !== message.diagram) {
                        setDiagramName(message.diagram);
                    }
                    revealWaiting();
                    break;
                }

                case "applySchemaChange": {
                    loadedRef.current?.set.applySchemaChange(message.change);
                    break;
                }

                case "changeItem": {
                    if (loadedRef.current?.editable === true) {
                        loadedRef.current.set.changeItem(message.id,
                            message.change);
                    }
                    break;
                }

                case "placeObjects": {
                    const point = canvas.viewCenter();
                    if (point !== undefined) {
                        loadedRef.current?.set.placeObjects(message.objects,
                            point);
                    }
                    break;
                }

                case "restObjects": {
                    loadedRef.current?.set.replaceRestObjects(message.objects);
                    break;
                }

                case "treeDropped": {
                    placeDropped(message.uriList, message.x, message.y);
                    break;
                }

                case "error": {
                    setError(message.message);
                    break;
                }

                default:
            }
        };
        window.addEventListener("message", onMessage);
        post({ type: "ready" });
        const spinner = setTimeout(() => { setSlow(true); }, SPINNER_DELAY_MS);

        return () => {
            clearTimeout(spinner);
            window.removeEventListener("message", onMessage);
            observer.disconnect();
            canvas.dispose();
            canvasRef.current = undefined;
        };
    }, []);

    // A diagram is shown whenever the model or the choice changes. The set
    // is the model's, so its history spans its diagrams.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas === undefined || loaded === undefined) {
            return;
        }
        // The one asked for by name, else the first.
        const diagram = loaded.model.diagrams[diagramIndex];
        if (diagram === undefined) {
            return;
        }
        // For the tab's title, however it was picked, and for the panel
        // restored after a restart.
        post({ type: "diagramShown", name: diagram.name });
        const target = viewerState().target;
        if (target !== undefined) {
            keepState({ target: { ...target, diagram: diagram.name } });
        }
        canvas.cancelEdit();
        setEdit(undefined);
        setMenu(undefined);
        // The diagram left is kept as it was left. The same one read again
        // (a schema edit) stays where it is; another opens as it was left,
        // or fitted, the first time.
        keepView();
        const view = viewsRef.current.get(diagram.name);
        shownRef.current = diagram.name;
        if (view !== undefined) {
            if (view.isoPreset === CUSTOM_ISO_PRESET) {
                setCustom(customPreset(view.tilt, view.turn));
            }
            setIsoPresetId(presetIdOf(view.isoPreset, true));
        }
        loaded.set.show(diagram);
        // A reveal waits until the load has put the view where it goes.
        readyRef.current = undefined;
        canvas.load(loaded.set, loaded.pageSettings, view)
            .then(() => {
                readyRef.current = diagram.name;
                revealWaiting();
            })
            .catch((reason: unknown) => {
                setError(String(reason));
            });
    }, [loaded, diagramIndex]);

    // Every new edit takes the focus, the next column's too.
    useEffect(() => {
        if (edit !== undefined) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [edit?.serial]);

    const closeEdit = (): void => {
        setEdit(undefined);
        setChoicesOpen(false);
        canvasRef.current?.cancelEdit();
    };

    /**
     * Makes the edit; its commit may open the next one at once (a new
     * table's next column), which then stays open.
     *
     * @param how By Enter, or by leaving the input.
     * @param text The text, where it is not what the input holds.
     */
    const commitEdit = (how: EditCommit, text = editText): void => {
        setEdit(undefined);
        setChoicesOpen(false);
        canvasRef.current?.commitEdit(text, how);
    };

    // The choices of an edit: the types for what follows a column's name.
    const choices = edit?.choices;
    const space = editText.search(/\s/);
    const matches = choices === undefined || space < 0 ? []
        : matchingTypes(editText.slice(space + 1), choices.items);

    /**
     * Opens the list of choices, on the preferred one while nothing is
     * typed for it.
     *
     * @param text The edit's text, with the space that opens the list.
     */
    const openChoices = (text: string): void => {
        setEditText(text);
        const typed = text.slice(text.search(/\s/) + 1);
        const found = choices === undefined ? []
            : matchingTypes(typed, choices.items);
        const preferred = found.findIndex((entry) => {
            return entry.label === choices?.preferred;
        });
        setChoiceAt(typed.trim() === "" && preferred >= 0 ? preferred : 0);
        setChoicesOpen(true);
    };

    /**
     * Puts a picked choice after the column's name: commits a complete
     * type, or leaves one whose values are typed next (`ENUM(`) open.
     *
     * @param entry The choice picked.
     */
    const pickChoice = (entry: IEditChoice): void => {
        const text = `${editText.slice(0, space)} ${entry.insert}`;
        if (entry.complete) {
            commitEdit("enter", text);
        } else {
            setEditText(text);
            setChoicesOpen(false);
        }
    };

    /** Keys of an edit with choices; true where the key was taken. */
    const choiceKey = (event: KeyboardEvent): boolean => {
        if (choices === undefined) {
            return false;
        }
        if (event.key === " " && space < 0) {
            event.preventDefault();
            if (editText.trim() !== "") {
                openChoices(`${editText.trim()} `);
            }

            return true;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            if (editText.trim() === "") {
                commitEdit("enter");
            } else if (space < 0) {
                // Enter after the name asks for the type, as Space does.
                openChoices(`${editText.trim()} `);
            } else if (choicesOpen && matches[choiceAt] !== undefined) {
                pickChoice(matches[choiceAt]);
            } else {
                commitEdit("enter");
            }

            return true;
        }
        if (choicesOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setChoiceAt((at) => {
                return Math.max(0, Math.min(matches.length - 1, at + step));
            });

            return true;
        }

        return false;
    };

    // The list hangs under the input as it is on the screen, upright in
    // the 3D view too.
    useLayoutEffect(() => {
        const input = inputRef.current;
        const host = hostRef.current;
        if (!choicesOpen || input === null || host === null) {
            setChoicesBox(undefined);

            return;
        }
        const box = input.getBoundingClientRect();
        const origin = host.getBoundingClientRect();
        const left = box.left - origin.left;
        const top = box.bottom - origin.top + 2;
        // The same box as the view pans: no second render follows.
        setChoicesBox((old) => {
            return old?.left === left && old.top === top ? old : { left, top };
        });
    }, [choicesOpen, edit]);

    // The choice picked shows: UUID, halfway down the list, at once.
    useEffect(() => {
        document.querySelector(".editChoices .highlighted")
            ?.scrollIntoView({ block: "nearest" });
    }, [choiceAt, choicesBox]);

    const editable = loaded?.editable === true;
    const tools = DIAGRAM_TOOLS.filter((entry) => {
        return editable || !entry.edits;
    });

    /**
     * Picks a tool of the palette.
     *
     * @param id The tool.
     */
    const selectTool = (id: string): void => {
        const picked = tools.find((entry) => { return entry.id === id; });
        if (picked === undefined || (locked && picked.edits)) {
            return;
        }
        setTool(id);
        if (canvasRef.current !== undefined) {
            canvasRef.current.tool = id;
        }
        setHint(picked.hint);
    };
    const selectToolRef = useRef(selectTool);
    selectToolRef.current = selectTool;

    // The palette's keys, as Workbench has them: a letter or a digit,
    // Escape for the pointer. Not while typing, nor with a modifier.
    useEffect(() => {
        const onKey = (event: KeyboardEvent): void => {
            const target = event.target as HTMLElement | null;
            if (event.metaKey || event.ctrlKey || event.altKey
                || target?.closest("input, textarea, select") != null) {
                return;
            }
            const key = event.key === "Escape" ? "Escape" : event.key.toLowerCase();
            const match = DIAGRAM_TOOLS.find((entry) => { return entry.key === key; });
            if (match !== undefined) {
                selectToolRef.current(match.id);
            }
        };
        window.addEventListener("keydown", onKey);

        return () => { window.removeEventListener("keydown", onKey); };
    }, []);

    const showTools = (visible: boolean): void => {
        setToolsVisible(visible);
        keepState({ tools: visible });
    };

    const showNavigator = (visible: boolean): void => {
        setNavigatorVisible(visible);
        // The Navigator tells the canvas its area is gone as it unmounts.
        keepState({ navigator: visible });
    };

    const diagrams = loaded?.model.diagrams.map((diagram) => {
        return diagram.name;
    }) ?? [];

    /**
     * Lets tables, views and routines dragged from a tree be dropped. VS
     * Code lets a drag into a webview only with Shift held, and hands it
     * none of what the tree set (its `text/uri-list` is empty), so any
     * drag is taken.
     */
    const onDragOver = (event: DragEvent): void => {
        if (loaded !== undefined && event.dataTransfer !== null) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
        }
    };
    /**
     * Places the schema's objects dropped where the pointer is; for a drop
     * without any the page can read (rows of a tree), asks the extension
     * for the objects last dragged.
     */
    const onDrop = (event: DragEvent): void => {
        if (loaded === undefined || event.dataTransfer === null) {
            return;
        }
        event.preventDefault();
        const list = event.dataTransfer.getData("text/uri-list");
        if (parseSchemaObjectUris(list).length > 0) {
            placeDropped(list, event.clientX, event.clientY);
        } else {
            post({ type: "treeDrop", x: event.clientX, y: event.clientY,
                types: [...event.dataTransfer.types] });
        }
    };

    return <div className="modelViewer">
        <CanvasToolbar
            view={view}
            onView={(next) => {
                setView(next);
                canvasRef.current?.setView(next);
            }}
            gridVisible={gridVisible}
            onGridVisible={mirror("gridVisible", setGridVisible)}
            pagesVisible={pagesVisible}
            onPagesVisible={mirror("pagesVisible", setPagesVisible)}
            locked={locked}
            onLocked={mirror("locked", setLocked)}
            toolsVisible={toolsVisible}
            onToolsVisible={showTools}
            navigatorVisible={navigatorVisible}
            onNavigatorVisible={showNavigator}
            menuOpen={sameOwner(menu?.owner, { kind: "toolbar" })}
            onMenu={(button) => {
                // The menu lives over the canvas host, under the toolbar.
                const at = pointUnder(button, hostRef.current);
                // A project's diagram is laid out by msm, which saves it.
                const shown = loaded?.model.diagrams[diagramIndex]?.name;
                setMenu({
                    owner: { kind: "toolbar" },
                    items: [{
                        id: "margins",
                        caption: "Show Printable Area",
                        checked: marginsVisible,
                    }, ...(editable && shown !== undefined ? [{
                        id: "layout",
                        caption: "Auto Layout...",
                    }] : [])],
                    x: at.x,
                    y: Math.max(0, at.y),
                    onCommand: (command) => {
                        if (command === "layout" && shown !== undefined) {
                            post({ type: "layoutDiagram", diagram: shown });
                        }
                        if (command === "margins") {
                            keepState({ margins: !marginsVisible });
                            mirror("marginsVisible", setMarginsVisible)(
                                !marginsVisible);
                        }
                    },
                });
            }}
            onFit={() => { canvasRef.current?.fit(); }}
            onActualSize={() => { canvasRef.current?.zoomTo(1); }}
            zoom={zoom}
            isoPresets={presets}
            isoPreset={isoPresetId}
            onIsoPreset={(id) => {
                // Picking a 3D view also goes to it.
                setIsoPresetId(id);
                keepState({ isoPreset: id });
                canvasRef.current?.setIsoAngles(presetFor(id));
                setView("iso");
                canvasRef.current?.setView("iso");
            }}
        >
            <span className="toolbarDivider" />
            <ToolbarSection label="Diagram:">
                <select
                    className="toolbarSelect"
                    aria-label="Diagram"
                    value={diagramIndex}
                    onChange={(event) => {
                        setDiagramName(loaded?.model.diagrams[Number(
                            (event.target as HTMLSelectElement).value)]?.name);
                    }}
                >
                    {diagrams.map((name, index) => {
                        return <option key={index} value={index}>{name}</option>;
                    })}
                </select>
            </ToolbarSection>
        </CanvasToolbar>
        <div className="modelCanvasHost" ref={hostRef}
            onDragOver={onDragOver} onDrop={onDrop}>
            {overlays.map((overlay) => {
                return <MenuButton
                    key={overlay.key}
                    overlay={overlay}
                    open={sameOwner(menu?.owner, { kind: "item", id: overlay.id })}
                    onOpen={(x, y) => { openItemMenu(overlay.id, x, y); }}
                />;
            })}
            {navigatorVisible && loaded !== undefined && <Navigator
                state={navigator}
                zoom={zoom}
                zoomRange={ZOOM_RANGE}
                onZoom={(next) => { canvasRef.current?.zoomTo(next); }}
                onFit={() => { canvasRef.current?.fit(); }}
                onArea={(area, panel) => {
                    canvasRef.current?.setNavigatorArea(area, panel);
                }}
                onPan={(dx, dy) => { canvasRef.current?.navigatorPan(dx, dy); }}
                onCenter={(x, y) => {
                    canvasRef.current?.navigatorCenter(x, y);
                }}
                menuOpen={sameOwner(menu?.owner, { kind: "navigator" })}
                onMenu={(x, y) => {
                    setMenu({
                        owner: { kind: "navigator" },
                        items: [
                            { id: "fit", caption: "Fit Diagram" },
                            { id: "actual", caption: "Actual Size" },
                            { id: "separator" },
                            { id: "hide", caption: "Hide Navigator" },
                        ],
                        x,
                        y,
                        onCommand: (command) => {
                            switch (command) {
                                case "fit": {
                                    canvasRef.current?.fit();
                                    break;
                                }
                                case "actual": {
                                    canvasRef.current?.zoomTo(1);
                                    break;
                                }
                                case "hide": {
                                    showNavigator(false);
                                    break;
                                }
                                default:
                            }
                        },
                    });
                }}
            />}
            {toolsVisible && loaded !== undefined && <DiagramToolbar
                tools={tools}
                tool={tool}
                onTool={selectTool}
                locked={locked}
            />}
            {toolPanel !== undefined && <ToolPanel
                panel={toolPanel}
                onPickReferenced={() => { loaded?.set.pickReferenced(); }}
            />}
            <input
                ref={fileRef}
                type="file"
                className="hiddenFileInput"
                accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(event) => {
                    const file = (event.target as HTMLInputElement).files?.[0];
                    pickRef.current?.(file === undefined
                        ? Promise.resolve(undefined) : readPicture(file));
                }}
                onCancel={() => { pickRef.current?.(Promise.resolve(undefined)); }}
            />
            {loaded === undefined && error === undefined && slow && <div
                className="modelLoading"
                role="status"
                aria-label="Loading the diagram"
            />}
            {menu !== undefined && <CanvasMenu
                items={menu.items}
                x={menu.x}
                y={menu.y}
                onCommand={menu.onCommand}
                onClose={closeMenu}
            />}
            {edit !== undefined && <input
                ref={inputRef}
                className="inlineEditor"
                aria-label={edit.label}
                placeholder={edit.placeholder}
                role={choices === undefined ? undefined : "combobox"}
                aria-expanded={choices === undefined ? undefined : choicesOpen}
                aria-autocomplete={choices === undefined ? undefined : "list"}
                spellcheck={false}
                value={editText}
                style={{
                    // Exactly the text's box, so the transform lays it
                    // onto its item in 2D and 3D alike.
                    width: `${edit.placement.width}px`,
                    height: `${edit.placement.height}px`,
                    fontSize: `${edit.placement.fontSize}px`,
                    transform: edit.placement.transform,
                    fontWeight: edit.bold ? "bold" : "normal",
                }}
                onInput={(event) => {
                    const value = (event.target as HTMLInputElement).value;
                    if (choices !== undefined && /\s/.test(value.trimStart())) {
                        openChoices(value);
                    } else {
                        setEditText(value);
                    }
                }}
                onKeyDown={(event) => {
                    if (event.key === "Escape") {
                        event.preventDefault();
                        // The list closes first; then the edit ends.
                        if (choicesOpen) {
                            setChoicesOpen(false);
                        } else {
                            closeEdit();
                        }
                    } else if (!choiceKey(event) && event.key === "Enter") {
                        event.preventDefault();
                        commitEdit("enter");
                    }
                }}
                onBlur={() => { commitEdit("blur"); }}
            />}
            {edit !== undefined && choicesOpen && choicesBox !== undefined
                && matches.length > 0 && <ul
                className="editChoices"
                role="listbox"
                aria-label="Data Types"
                style={{ left: `${choicesBox.left}px`,
                    top: `${choicesBox.top}px` }}
            >
                {matches.map((entry, index) => {
                    return <li
                        key={entry.label}
                        role="option"
                        aria-selected={index === choiceAt}
                        className={index === choiceAt ? "highlighted" : undefined}
                        // Before the input loses the focus.
                        onMouseDown={(event) => {
                            event.preventDefault();
                            pickChoice(entry);
                        }}
                        onMouseEnter={() => { setChoiceAt(index); }}
                    >{entry.label}</li>;
                })}
            </ul>}
        </div>
        {error !== undefined && <div className="modelError" role="alert">
            {error}
        </div>}
        {loaded !== undefined && error === undefined && <div
            className="modelStatus">
            {hint !== "" && <span className="modelHint" role="status">
                {hint}
            </span>}
            <span>{`${loaded.model.schema} · ${loaded.source}`
                + (loaded.editable ? saveText(save) : "")}</span>
        </div>}
    </div>;
};
