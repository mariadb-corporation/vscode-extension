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
    parentFolder,
    ROOT_FOLDER,
} from "../../src/connections/connectionFolders.js";
import {
    existingFolder,
    folderContents,
    folderTrail,
    type IOverviewConnection,
    type IOverviewContents,
    type IOverviewDeployment,
    type IOverviewSnapshot,
} from "../../src/overview/overviewModel.js";
import type {
    IOverviewConnectionRef,
    OverviewConnectionAction,
    OverviewHostMessage,
    OverviewWebviewMessage,
} from "../../src/overview/overviewProtocol.js";
import { openMenuAt, type IContextMenuItem } from "./contextMenu.js";
import { loadState, post, saveState } from "./vscodeApi.js";

/**
 * The MariaDB Workbench overview, as the MySQL Shell's DB Connection
 * Overview was: a welcome text that can be closed, and a tile for each
 * connection and folder of the folder shown, with a breadcrumb above to
 * go back up. A connection's tile opens a SQL editor; hovering it shows
 * its actions - its menu, a new DB Notebook (not available yet) and a new
 * SQL editor.
 */

/** The welcome text, the first line of the MySQL Shell's. */
export const GREETING =
    "Welcome to the MariaDB Shell for VS Code extension.";

/**
 * What the page keeps across a reload: the folder each section shows,
 * none where the user has not picked one and it starts where
 * `startingFolder` says.
 */
interface IOverviewState {
    folder?: string;
    deploymentFolder?: string;
}

/** How long a tile ignores further clicks once clicked. */
const CLICK_GUARD_MS = 200;

/**
 * @param asked The folder the section was asked to show; none where the
 *        user has not picked one.
 * @param items What the section lists, once listed.
 * @param extraFolders Folders there are with nothing in them.
 *
 * @returns The folder it shows: the one asked for, its starting folder,
 *          or the nearest one above either still there.
 */
const shownFolder = (
    asked: string | undefined,
    items: ReadonlyArray<{ path: string }> | undefined,
    extraFolders?: readonly string[],
): string => {
    return items === undefined
        ? asked ?? ROOT_FOLDER
        : existingFolder(items, asked, extraFolders);
};

/**
 * The folder asked for follows the one shown: a folder made again under a
 * path the section has left is not to pull it back in unasked. A starting
 * folder other than the top level is kept the same way, so the second
 * connection made in it does not throw the section back out.
 *
 * @param asked The folder asked for; none where the user has not picked one.
 * @param shown The folder shown.
 *
 * @returns The folder to ask for from now on.
 */
const keptFolder = (
    asked: string | undefined,
    shown: string,
): string | undefined => {
    return asked === undefined && shown === ROOT_FOLDER ? undefined : shown;
};

/** What a connection's More Actions menu offers, in order; `{}` divides. */
const CONNECTION_MENU: Array<{ label?: string;
    action?: OverviewConnectionAction; }> = [
    { label: "Edit Connection…", action: "edit" },
    { label: "Copy Connection URI", action: "copyUri" },
    {},
    { label: "Delete Connection…", action: "delete" },
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

/**
 * Opens a menu below an element, as the MySQL Shell's opened below the
 * button.
 *
 * @param anchor The element.
 * @param items What it offers, in order; one with no label divides.
 *
 * @returns Nothing.
 */
const openMenuBelow = (anchor: HTMLElement, items: IContextMenuItem[]): void => {
    const rect = anchor.getBoundingClientRect();
    openMenuAt({ x: rect.left, y: rect.bottom }, items);
};

/**
 * @param deployment A sandbox.
 *
 * @returns Its menu, as the host worked it out: each group of commands -
 *          the sandbox's, then each REST Daemon's - divided from the next.
 */
const deploymentMenu = (deployment: IOverviewDeployment): IContextMenuItem[] => {
    return deployment.menu.filter((group) => { return group.length > 0; })
        .flatMap((group, index) => {
            return [
                ...(index === 0 ? [] : [{}]),
                ...group.map((entry): IContextMenuItem => {
                    return {
                        label: entry.title,
                        onClick: () => {
                            post<OverviewWebviewMessage>({
                                type: "deploymentCommand",
                                command: entry.command,
                                port: deployment.port,
                                ...(entry.directory === undefined
                                    ? {} : { directory: entry.directory }),
                            });
                        },
                    };
                }),
            ];
        });
};

/**
 * @param deployment A sandbox.
 *
 * @returns Its icon's classes: its row's codicon, `~spin` made the
 *          codicon modifier.
 */
const deploymentIcon = (deployment: IOverviewDeployment): string => {
    const [id, modifier] = deployment.icon.split("~");

    return `codicon codicon-${id ?? ""}`
        + (modifier === undefined ? "" : ` codicon-modifier-${modifier}`);
};

/** One tile: what it is, and what a click on it does. */
interface ITileProps {
    variant: "connection" | "deployment" | "folder" | "back" | "createNew";
    caption: string;
    description: string;
    /**
     * Its picture's classes: `overview-icon-<file>` for a mask, or a
     * codicon's.
     */
    icon: string;
    /**
     * Its color, as `--tile-color`: down a connection's left edge, over a
     * folder's whole tile.
     */
    color?: string;
    /** Its icon's color, a theme color's CSS variable. */
    iconColor?: string;
    title?: string;
    /** What a click does; handed the tile, for a menu to open below it. */
    onOpen(tile: HTMLElement): void;
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
    const { variant, caption, description, icon, color, iconColor, actions } =
        props;
    const guard = useRef(0);
    const actionsRef = useRef<HTMLDivElement>(null);

    // A double click would open two editors; the first click wins.
    const open = (tile: HTMLElement): void => {
        const now = Date.now();
        if (now - guard.current < CLICK_GUARD_MS) {
            return;
        }
        guard.current = now;
        props.onOpen(tile);
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
                : { "--tile-color": `var(--vscode-charts-${color})` }}
            onClick={(event) => { open(event.currentTarget); }}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget) {
                    return;
                }
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    open(event.currentTarget);
                } else if (event.key === "a" && actions
                    && actionsRef.current) {
                    // The MySQL Shell's shortcut: A opens the tile's menu.
                    event.preventDefault();
                    actions.onMenu(actionsRef.current);
                }
            }}
        >
            <span
                class={`overview-tile-icon ${icon}`}
                style={iconColor === undefined ? undefined : {
                    color: `var(--vscode-${iconColor.replaceAll(".", "-")})`,
                }}
            />
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

/** What a section is filled from: its listing, or why there is none. */
interface IListing<T> {
    data?: T;
    failed?: string;
}

/**
 * One section of the page: its title and the way to the folder it shows,
 * then its tiles - Back, the folders, what the folder holds, and the one
 * that adds something - or what it says while it has none.
 *
 * @param props What it shows.
 *
 * @returns The section.
 */
const Section = <T,>(props: {
    title: string;
    /** What it lists, in the plural: `connections`. */
    noun: string;
    shown: string;
    go(path: string): void;
    listing: IListing<unknown>;
    contents?: IOverviewContents<T>;
    folderDescription: string;
    item(item: T): preact.JSX.Element;
    create: { caption: string; description: string; onOpen(): void };
}): preact.JSX.Element => {
    const { title, noun, shown, go, listing, contents, create } = props;

    return (
        <section class="overview-section" aria-label={title}>
            <div class="overview-heading">
                <span class="overview-content-title">{title}</span>
                <nav class="overview-breadcrumb" aria-label={`${title} folder`}>
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

            {listing.failed !== undefined && (
                <p class="overview-message overview-failed">
                    The {noun} could not be listed: {listing.failed}
                </p>
            )}
            {contents === undefined && listing.failed === undefined && (
                <p class="overview-message">
                    Looking for MariaDB {noun}...
                </p>
            )}
            {contents !== undefined && (
                <div class="overview-tiles">
                    {shown !== "/" && (
                        <Tile
                            variant="back"
                            caption="Back"
                            description="Go up one folder level"
                            icon="overview-icon-back"
                            onOpen={() => { go(parentFolder(shown)); }}
                        />
                    )}
                    {contents.folders.map((entry) => {
                        return (
                            <Tile
                                key={`folder:${entry.path}`}
                                variant="folder"
                                caption={entry.name}
                                description={props.folderDescription}
                                icon="overview-icon-folder"
                                color={entry.color}
                                title={entry.path}
                                onOpen={() => { go(entry.path); }}
                            />
                        );
                    })}
                    {contents.items.map(props.item)}
                    <Tile
                        variant="createNew"
                        caption={create.caption}
                        description={create.description}
                        icon="overview-icon-plus"
                        onOpen={create.onOpen}
                    />
                </div>
            )}
        </section>
    );
};

export const OverviewPage = (): preact.JSX.Element => {
    const [kept] = useState(() => {
        return loadState() as IOverviewState | undefined;
    });
    const [showGreeting, setShowGreeting] = useState(false);
    const [connections, setConnections] =
        useState<IListing<IOverviewSnapshot>>({});
    const [deployments, setDeployments] =
        useState<IListing<IOverviewDeployment[]>>({});
    const [folder, setFolder] = useState(kept?.folder);
    const [deploymentFolder, setDeploymentFolder] =
        useState(kept?.deploymentFolder);

    useEffect(() => {
        const onMessage = (event: MessageEvent<OverviewHostMessage>): void => {
            const message = event.data;
            switch (message.type) {
                case "greeting": {
                    setShowGreeting(message.showGreeting);
                    break;
                }

                case "connections": {
                    // The message is the snapshot, with its type on top.
                    setConnections({ data: message });
                    break;
                }

                case "deployments": {
                    setDeployments({ data: message.deployments });
                    break;
                }

                case "failed": {
                    // What was listed before stays, beside why it is stale.
                    const failed = message.message;
                    if (message.section === "connections") {
                        setConnections((listing) => {
                            return { ...listing, failed };
                        });
                    } else {
                        setDeployments((listing) => {
                            return { ...listing, failed };
                        });
                    }
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

    // A section the user has not walked yet starts in its one item's
    // folder; a folder moved, renamed or emptied away leaves it in the
    // nearest one still there.
    const snapshot = connections.data;
    const shown = shownFolder(folder, snapshot?.connections,
        snapshot?.customFolders);
    const shownDeployments = shownFolder(deploymentFolder, deployments.data);
    useEffect(() => {
        const nextFolder = keptFolder(folder, shown);
        const nextDeploymentFolder =
            keptFolder(deploymentFolder, shownDeployments);
        if (nextFolder !== folder
            || nextDeploymentFolder !== deploymentFolder) {
            // Saved by the run the change brings.
            setFolder(nextFolder);
            setDeploymentFolder(nextDeploymentFolder);

            return;
        }
        saveState({ folder, deploymentFolder } satisfies IOverviewState);
    }, [shown, shownDeployments, folder, deploymentFolder]);

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
        openMenuBelow(anchor, CONNECTION_MENU.map((entry): IContextMenuItem => {
            const { label, action } = entry;

            return action === undefined ? {} : {
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

    return (
        <div class="overview">
            {showGreeting && (
                <section class="overview-greeting">
                    <div class="overview-greeting-heading">
                        <span class="overview-logo" aria-hidden="true" />
                        <h1 class="overview-title">
                            <span class="overview-title-product">MariaDB Shell</span>
                            {" "}
                            <span class="overview-title-workbench">Workbench</span>
                        </h1>
                    </div>
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

            <Section
                title="Database Connections"
                noun="connections"
                shown={shown}
                go={setFolder}
                listing={connections}
                contents={snapshot === undefined ? undefined : folderContents(
                    snapshot.connections, shown, snapshot.customFolders,
                    snapshot.folderColors)}
                folderDescription="Connection Folder"
                item={(connection) => {
                    return (
                        <Tile
                            key={`${connection.kind}:${connection.uri}`}
                            variant="connection"
                            caption={connection.caption ?? connection.address}
                            description={descriptionOf(connection)}
                            icon={`overview-icon-${connection.icon}`}
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
                }}
                create={{
                    caption: "New Connection",
                    description: "Add a new database connection",
                    onOpen: () => {
                        post<OverviewWebviewMessage>({
                            type: "newConnection",
                            folder: shown,
                        });
                    },
                }}
            />

            <Section
                title="Database Deployments"
                noun="deployments"
                shown={shownDeployments}
                go={setDeploymentFolder}
                listing={deployments}
                contents={deployments.data === undefined ? undefined
                    : folderContents(deployments.data, shownDeployments)}
                folderDescription="Deployment Folder"
                item={(deployment) => {
                    const caption = `localhost:${String(deployment.port)}`;

                    return (
                        <Tile
                            key={`sandbox:${caption}`}
                            variant="deployment"
                            caption={caption}
                            description={deployment.description}
                            icon={deploymentIcon(deployment)}
                            iconColor={deployment.iconColor}
                            title={`Sandbox on port ${String(deployment.port)}`}
                            onOpen={(tile) => {
                                const items = deploymentMenu(deployment);
                                if (items.length > 0) {
                                    openMenuBelow(tile, items);
                                }
                            }}
                        />
                    );
                }}
                create={{
                    caption: "New Deployment",
                    description: "Deploy a new MariaDB server",
                    onOpen: () => {
                        post<OverviewWebviewMessage>({
                            type: "newDeployment",
                        });
                    },
                }}
            />
        </div>
    );
};
