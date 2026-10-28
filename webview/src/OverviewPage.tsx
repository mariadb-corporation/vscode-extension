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

import { useEffect, useRef, useState } from "preact/hooks";

import {
    existingFolder,
    folderContents,
    folderTrail,
    parentFolder,
    type IOverviewConnection,
    type IOverviewSnapshot,
} from "../../src/overview/overviewModel.js";
import type {
    IOverviewConnectionRef,
    OverviewConnectionAction,
    OverviewHostMessage,
    OverviewWebviewMessage,
} from "../../src/overview/overviewProtocol.js";
import { openContextMenu } from "./contextMenu.js";
import { loadState, post, saveState } from "./vscodeApi.js";

/**
 * The MariaDB Workbench overview, as the MySQL Shell's DB Connection
 * Overview was: a welcome text that can be closed, and a tile for each
 * connection and folder of the folder shown, with a breadcrumb above to
 * go back up. A connection's tile opens a SQL editor; hovering it shows
 * its actions - its menu, a new DB Notebook (not available yet) and a new
 * SQL editor.
 */

/** The welcome text, the MySQL Shell's own, made to fit. */
export const GREETING = "Welcome to the MariaDB Shell for VS Code "
    + "extension.\n\n"
    + "Click the [New Connection] tile to add a new database connection. "
    + "Click a [Database Connection] tile to open a new SQL editor.";

/** What the page keeps across a reload: the folder it shows. */
interface IOverviewState {
    folder: string;
}

/** How long a tile ignores further clicks once clicked. */
const CLICK_GUARD_MS = 200;

/** What a connection's More Actions menu offers, in order. */
const CONNECTION_MENU: Array<[string, OverviewConnectionAction] | undefined> = [
    ["Edit Connection…", "edit"],
    ["Copy Connection URI", "copyUri"],
    undefined,
    ["Delete Connection…", "delete"],
];

/**
 * @param connection A connection.
 *
 * @returns The two halves of what identifies it.
 */
const refOf = (connection: IOverviewConnection): IOverviewConnectionRef => {
    return { uri: connection.uri, kind: connection.kind };
};

/**
 * @param connection A connection.
 *
 * @returns The line under its tile's caption: its address where the
 *          caption replaces it, and whether it is shared with MCP clients
 *          or the default.
 */
const descriptionOf = (connection: IOverviewConnection): string => {
    const parts = [
        ...(connection.caption === undefined ? [] : [connection.address]),
        ...(connection.kind === "mcp" ? ["MCP"] : []),
        ...(connection.isDefault ? ["default"] : []),
    ];

    return parts.length === 0 ? "Database Connection" : parts.join(" · ");
};

/** One tile: what it is, and what a click on it does. */
interface ITileProps {
    variant: "connection" | "folder" | "back" | "createNew";
    caption: string;
    description: string;
    /** Its picture: an `overview-icon-<icon>` class. */
    icon: string;
    /** A connection's color, drawn down its left edge. */
    color?: string;
    title?: string;
    onOpen(): void;
    /** The actions shown on hover; a connection's tile only. */
    actions?: {
        onMenu(anchor: HTMLElement): void;
        onSqlEditor(): void;
    };
}

/**
 * A tile. It is a `div` with the button role rather than a `button`,
 * since its actions are buttons and a button cannot hold another.
 *
 * @param props What it shows and does.
 *
 * @returns The tile.
 */
const Tile = (props: ITileProps): preact.JSX.Element => {
    const { variant, caption, description, icon, color, actions } = props;
    const guard = useRef(0);
    const actionsRef = useRef<HTMLDivElement>(null);

    // A double click would open two editors; the first click wins.
    const open = (): void => {
        const now = Date.now();
        if (now - guard.current < CLICK_GUARD_MS) {
            return;
        }
        guard.current = now;
        props.onOpen();
    };

    return (
        <div
            class={`overview-tile overview-tile-${variant}`
                + (color === undefined ? "" : " colored")}
            role="button"
            tabIndex={0}
            title={props.title}
            style={color === undefined
                ? undefined
                : { borderLeftColor: `var(--vscode-charts-${color})` }}
            onClick={open}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget) {
                    return;
                }
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    open();
                } else if (event.key === "a" && actions
                    && actionsRef.current) {
                    // The MySQL Shell's shortcut: A opens the tile's menu.
                    event.preventDefault();
                    actions.onMenu(actionsRef.current);
                }
            }}
        >
            <span class={`overview-tile-icon overview-icon-${icon}`} />
            <span class="overview-tile-text">
                <span class="overview-tile-caption">{caption}</span>
                <span class="overview-tile-description">{description}</span>
            </span>
            {actions && (
                <>
                    <div class="overview-tile-actions-background" />
                    <div class="overview-tile-actions" ref={actionsRef}>
                        <button
                            type="button"
                            class="overview-tile-action"
                            title="More Actions"
                            aria-label="More Actions"
                            onClick={(event) => {
                                event.stopPropagation();
                                actions.onMenu(
                                    event.currentTarget as HTMLElement);
                            }}
                        >
                            <span class="overview-icon-menu" />
                        </button>
                        {/* Drawn faded until DB Notebooks are there. */}
                        <button
                            type="button"
                            class="overview-tile-action"
                            title="Create New Notebook (not available yet)"
                            aria-label="Create New Notebook"
                            disabled
                            onClick={(event) => { event.stopPropagation(); }}
                        >
                            <span class="overview-icon-notebook" />
                        </button>
                        <button
                            type="button"
                            class="overview-tile-action"
                            title="Open New SQL Editor"
                            aria-label="Open New SQL Editor"
                            onClick={(event) => {
                                event.stopPropagation();
                                actions.onSqlEditor();
                            }}
                        >
                            <span class="overview-icon-script" />
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};

export const OverviewPage = (): preact.JSX.Element => {
    const [snapshot, setSnapshot] = useState<IOverviewSnapshot>();
    const [failed, setFailed] = useState<string>();
    const [showGreeting, setShowGreeting] = useState(false);
    const [folder, setFolder] = useState(() => {
        return (loadState() as IOverviewState | undefined)?.folder ?? "/";
    });

    useEffect(() => {
        const onMessage = (event: MessageEvent<OverviewHostMessage>): void => {
            const message = event.data;
            switch (message.type) {
                case "connections": {
                    setSnapshot({
                        connections: message.connections,
                        customFolders: message.customFolders,
                    });
                    setShowGreeting(message.showGreeting);
                    setFailed(undefined);
                    break;
                }

                case "failed": {
                    setFailed(message.message);
                    break;
                }

                default: {
                    break;
                }
            }
        };
        window.addEventListener("message", onMessage);
        post<OverviewWebviewMessage>({ type: "ready" });

        return () => { window.removeEventListener("message", onMessage); };
    }, []);

    // A folder moved, renamed or emptied away leaves the page in the
    // nearest one still there.
    const shown = snapshot === undefined
        ? folder : existingFolder(snapshot, folder);
    useEffect(() => {
        saveState({ folder: shown } satisfies IOverviewState);
    }, [shown]);

    const go = (path: string): void => { setFolder(path); };

    const openSqlEditor = (connection: IOverviewConnection): void => {
        post<OverviewWebviewMessage>({
            type: "open",
            connection: refOf(connection),
            editor: "script",
        });
    };

    const openMenu = (
        connection: IOverviewConnection,
        anchor: HTMLElement,
    ): void => {
        // Below the button, as the MySQL Shell's menu opened.
        const rect = anchor.getBoundingClientRect();
        openContextMenu(new MouseEvent("contextmenu", {
            clientX: rect.left,
            clientY: rect.bottom,
        }), CONNECTION_MENU.map((entry) => {
            if (entry === undefined) {
                return {};
            }
            const [label, action] = entry;

            return {
                label,
                onClick: () => {
                    post<OverviewWebviewMessage>({
                        type: "connectionAction",
                        action,
                        connection: refOf(connection),
                    });
                },
            };
        }));
    };

    const contents = snapshot === undefined
        ? undefined : folderContents(snapshot, shown);

    return (
        <div class="overview">
            {showGreeting && (
                <section class="overview-greeting">
                    <span class="overview-logo" aria-hidden="true" />
                    <h1 class="overview-title">MariaDB Workbench</h1>
                    <p class="overview-description">{GREETING}</p>
                    <button
                        type="button"
                        class="overview-close"
                        title="Close Greeting"
                        aria-label="Close Greeting"
                        onClick={() => {
                            setShowGreeting(false);
                            post<OverviewWebviewMessage>({
                                type: "closeGreeting",
                            });
                        }}
                    >
                        <span class="overview-icon-close" />
                    </button>
                </section>
            )}

            <div class="overview-heading">
                <span class="overview-content-title">
                    Database Connections
                </span>
                <nav class="overview-breadcrumb" aria-label="Folder">
                    <button
                        type="button"
                        class={"overview-crumb"
                            + (shown === "/" ? " current" : "")}
                        onClick={() => { go("/"); }}
                    >
                        /
                    </button>
                    {folderTrail(shown).map((step) => {
                        return (
                            <button
                                type="button"
                                key={step.path}
                                class={"overview-crumb"
                                    + (step.path === shown ? " current" : "")}
                                onClick={() => { go(step.path); }}
                            >
                                {`${step.name} /`}
                            </button>
                        );
                    })}
                </nav>
            </div>

            {failed !== undefined && (
                <p class="overview-message overview-failed">
                    The connections could not be listed: {failed}
                </p>
            )}
            {contents === undefined && failed === undefined && (
                <p class="overview-message">
                    Looking for MariaDB connections...
                </p>
            )}
            {contents !== undefined && (
                <div class="overview-tiles">
                    {shown !== "/" && (
                        <Tile
                            variant="back"
                            caption="Back"
                            description="Go up one folder level"
                            icon="back"
                            onOpen={() => { go(parentFolder(shown)); }}
                        />
                    )}
                    {contents.folders.map((entry) => {
                        return (
                            <Tile
                                key={`folder:${entry.path}`}
                                variant="folder"
                                caption={entry.name}
                                description="Connection Folder"
                                icon="folder"
                                title={entry.path}
                                onOpen={() => { go(entry.path); }}
                            />
                        );
                    })}
                    {contents.connections.map((connection) => {
                        return (
                            <Tile
                                key={`${connection.kind}:${connection.uri}`}
                                variant="connection"
                                caption={connection.caption
                                    ?? connection.address}
                                description={descriptionOf(connection)}
                                icon={connection.family}
                                color={connection.color}
                                title={connection.uri}
                                onOpen={() => { openSqlEditor(connection); }}
                                actions={{
                                    onMenu: (anchor) => {
                                        openMenu(connection, anchor);
                                    },
                                    onSqlEditor: () => {
                                        openSqlEditor(connection);
                                    },
                                }}
                            />
                        );
                    })}
                    <Tile
                        variant="createNew"
                        caption="New Connection"
                        description="Add a new database connection"
                        icon="plus"
                        onOpen={() => {
                            post<OverviewWebviewMessage>({
                                type: "newConnection",
                                folder: shown,
                            });
                        }}
                    />
                </div>
            )}
        </div>
    );
};
