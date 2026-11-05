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
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import tableIcon from "../assets/modeler/schemaTable.svg?raw";
import columnIcon from "../assets/modeler/schemaTableColumn.svg?raw";
import columnNotNullIcon from "../assets/modeler/schemaTableColumnNN.svg?raw";
import columnPrimaryKeyIcon from "../assets/modeler/schemaTableColumnPK.svg?raw";
import foreignKeyIcon from "../assets/modeler/schemaTableForeignKey.svg?raw";
import indexIcon from "../assets/modeler/schemaTableIndex.svg?raw";
import viewIcon from "../assets/modeler/schemaView.svg?raw";
import routineIcon from "../assets/modeler/schemaRoutine.svg?raw";

import type { IMsmSchemaEdit } from "../../../src/mcp/msmApi.js";
import {
    diagramDocument,
    type ISchemaModel,
} from "../../../src/modeler/modelFormat.js";
import type {
    ModelerHostMessage,
    ModelerTarget,
    SaveState,
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
    ICanvasOverlay,
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
import { EerFigureSet } from "./EerFigureSet.js";
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
        routine] = await Promise.all([
        svgImage(tableIcon, color),
        svgImage(columnPrimaryKeyIcon, color),
        svgImage(columnNotNullIcon, color),
        svgImage(columnIcon, color),
        svgImage(indexIcon, color),
        svgImage(foreignKeyIcon, color),
        svgImage(viewIcon, color),
        svgImage(routineIcon, color),
    ]);

    return { table, primaryKey, notNull, nullable, index, foreignKey, view,
        routine };
};

/** What the viewer keeps across a reload of the webview. */
interface IViewerState {
    /** The 3D view last chosen. */
    isoPreset?: string;
    /** The angles the user orbited to last, if ever. */
    custom?: { tilt: number; turn: number };
    /** Whether the Navigator is shown; it is unless hidden. */
    navigator?: boolean;
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

export const ModelViewer = (): JSX.Element => {
    const hostRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<Canvas>();
    const inputRef = useRef<HTMLInputElement>(null);

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
        return kept.isoPreset === CUSTOM_ISO_PRESET && kept.custom !== undefined
            ? CUSTOM_ISO_PRESET
            : isoPreset(kept.isoPreset).id;
    });
    const [gridVisible, setGridVisible] = useState(true);
    const [pagesVisible, setPagesVisible] = useState(true);
    const [locked, setLocked] = useState(false);
    const [navigatorVisible, setNavigatorVisible] = useState(
        kept.navigator !== false);
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
    const mirror = <K extends "tool" | "gridVisible" | "pagesVisible"
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
            // Every change of a project's diagram is kept and saved: those
            // whose document differs from what was sent last go.
            onHistory: () => {
                const shown = loadedRef.current;
                if (shown === undefined || !shown.editable) {
                    return;
                }
                for (const [name, text] of documentsOf(shown)) {
                    if (shown.sent.get(name) !== text) {
                        shown.sent.set(name, text);
                        post({
                            type: "diagramChanged",
                            document: JSON.parse(text) as ReturnType<
                                typeof diagramDocument>,
                        });
                    }
                }
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
                    // The diagram opened in the tree, else the first.
                    setDiagramName(message.diagram);
                    keepState({ target: message.target });
                    let edits = 0;
                    const set = new EerFigureSet({
                        catalog: catalogFromModel(message.model),
                        diagrams: message.model.diagrams,
                        loadIcons,
                        editable: message.editable,
                        onSchemaEdit: (schemaEdits: IMsmSchemaEdit[]) => {
                            edits += 1;
                            post({ type: "schemaEdit", id: edits,
                                edits: schemaEdits });
                        },
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
                    });
                    break;
                }

                case "image": {
                    loadedRef.current?.set.pictureArrived(message.figureId,
                        message.image, message.error);
                    break;
                }

                case "schemaEdited": {
                    // A failed edit reloads the model, from what the SQL
                    // still says; a done one brings the snapshot of it.
                    if (message.objects !== undefined) {
                        loadedRef.current?.set.replaceObjects(message.objects);
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
        loaded.set.show(diagram);
        canvas.load(loaded.set, loaded.pageSettings)
            .catch((reason: unknown) => {
                setError(String(reason));
            });
    }, [loaded, diagramIndex]);

    useEffect(() => {
        if (edit !== undefined) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [edit === undefined]);

    const closeEdit = (): void => {
        canvasRef.current?.cancelEdit();
        setEdit(undefined);
    };

    const commitEdit = (): void => {
        canvasRef.current?.commitEdit(editText);
        setEdit(undefined);
    };

    const showNavigator = (visible: boolean): void => {
        setNavigatorVisible(visible);
        // The Navigator tells the canvas its area is gone as it unmounts.
        keepState({ navigator: visible });
    };

    const diagrams = loaded?.model.diagrams.map((diagram) => {
        return diagram.name;
    }) ?? [];

    return <div className="modelViewer">
        <CanvasToolbar
            tool={tool}
            onTool={mirror("tool", setTool)}
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
            navigatorVisible={navigatorVisible}
            onNavigatorVisible={showNavigator}
            menuOpen={sameOwner(menu?.owner, { kind: "toolbar" })}
            onMenu={(button) => {
                // The menu lives over the canvas host, under the toolbar.
                const at = pointUnder(button, hostRef.current);
                setMenu({
                    owner: { kind: "toolbar" },
                    items: [{
                        id: "margins",
                        caption: "Show Printable Area",
                        checked: marginsVisible,
                    }],
                    x: at.x,
                    y: Math.max(0, at.y),
                    onCommand: (command) => {
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
        <div className="modelCanvasHost" ref={hostRef}>
            {overlays.map((overlay) => {
                return <MenuButton
                    key={overlay.id}
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
                    setEditText((event.target as HTMLInputElement).value);
                }}
                onKeyDown={(event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        commitEdit();
                    } else if (event.key === "Escape") {
                        event.preventDefault();
                        closeEdit();
                    }
                }}
                onBlur={commitEdit}
            />}
        </div>
        {error !== undefined && <div className="modelError" role="alert">
            {error}
        </div>}
        {loaded !== undefined && error === undefined && <div
            className="modelStatus">
            {`${loaded.model.schema} · ${loaded.source}`
                + (loaded.editable ? saveText(save) : "")}
        </div>}
    </div>;
};
