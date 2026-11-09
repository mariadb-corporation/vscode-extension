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
 * The table editor, laid out as DBX's: the table's name and comment, then
 * tabs (DDL, Columns, Indexes, Foreign Keys, Triggers) with each tab's
 * actions to their right (Refresh Structure and a menu last), and
 * below them the SQL preview of what Apply runs. In VS Code's colours.
 *
 * The page edits a draft of the table; the edits are worked out from it
 * (`tableEdits`) whenever it changes, and the extension answers with the
 * statements they come to, for the preview.
 */

import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { COLUMN_TYPES } from "../../../src/sql/columnTypes.js";
import {
    draftOf,
    draftProblems,
    INDEX_KINDS,
    joinType,
    keyPartsText,
    nameListText,
    newRowKey,
    parseKeyParts,
    parseNameList,
    REFERENTIAL_ACTIONS,
    renameColumn,
    splitType,
    tableEdits,
    type IDraftColumn,
    type IDraftForeignKey,
    type IDraftIndex,
    type IDraftTrigger,
    type ITableDraft,
} from "../../../src/tableEditor/tableDraft.js";
import type {
    ITableEditorData,
    TableEditorHostMessage,
    TableEditorWebviewMessage,
} from "../../../src/tableEditor/tableEditorProtocol.js";
import { openMenuBelow } from "../contextMenu.js";
import { loadState, post, saveState } from "../vscodeApi.js";
import {
    cellRow,
    checkBox,
    comboInput,
    ControlGrid,
    iconButton,
    selectInput,
    textInput,
    type IGridColumn,
} from "./ControlGrid.js";

const TABS = ["DDL", "Columns", "Indexes", "Foreign Keys", "Triggers"] as const;
type Tab = typeof TABS[number];

const DENSITIES = ["Compact", "Standard", "Comfortable"] as const;
type Density = typeof DENSITIES[number];

/** What the page keeps across a reload of the webview. */
interface IPageState {
    tab?: Tab;
    density?: Density;
}

/** The type names the Type column offers, without lengths. */
const TYPE_CHOICES = [...new Set(COLUMN_TYPES.map((choice) => {
    return splitType(choice.insert.replace(/\($/, "")).base.toLowerCase();
}))].map((type) => { return { value: type, label: type }; });

/** Default lengths, by type: what choosing one fills in. */
const DEFAULT_LENGTHS = new Map(COLUMN_TYPES.flatMap((choice) => {
    const parts = splitType(choice.insert);

    return parts.length === "" ? []
        : [[parts.base.toLowerCase(), parts.length] as const];
}));

const DEFAULT_CHOICES = ["''", "NULL", "0", "1", "CURRENT_TIMESTAMP",
    "CURRENT_DATE", "CURRENT_TIME", "UUID()"].map((value) => {
    return { value, label: value };
});

const TRIGGER_EVENTS = ["INSERT", "UPDATE", "DELETE"];

/** An index's colour on the rows of its columns, as DBX draws it. */
const indexMark = (kind: string): string => {
    return kind === "primary" ? "primary" : kind === "unique" ? "unique"
        : kind === "fulltext" ? "fulltext" : kind === "spatial" ? "spatial"
            : "index";
};

/**
 * @param list Rows.
 * @param key A row's key.
 * @param patch What changes in it.
 *
 * @returns The rows with that one changed.
 */
const patched = <T extends { key: string }>(
    list: T[],
    key: string,
    patch: Partial<T>,
): T[] => {
    return list.map((row) => {
        return row.key === key ? { ...row, ...patch } : row;
    });
};

/**
 * @param list Rows.
 * @param key A row's key.
 *
 * @returns The rows with that one marked to go, or left out if it is new;
 *          a row marked already is restored.
 */
const dropped = <T extends { key: string; origin?: number;
    dropped?: boolean }>(list: T[], key: string): T[] => {
    return list.flatMap((row) => {
        if (row.key !== key) {
            return [row];
        }

        return row.origin === undefined ? []
            : [{ ...row, dropped: row.dropped !== true }];
    });
};

/** The page. */
export const TableEditor = (): preact.JSX.Element => {
    const kept = (loadState() ?? {}) as IPageState;
    const [data, setData] = useState<ITableEditorData | undefined>();
    const [loadError, setLoadError] = useState<string | undefined>();
    const [draft, setDraft] = useState<ITableDraft | undefined>();
    const [tab, setTab] = useState<Tab>(kept.tab ?? "Columns");
    const [density, setDensity] = useState<Density>(kept.density ?? "Compact");
    const [search, setSearch] = useState("");
    const [preview, setPreview] = useState<{ statements: string[];
        notes: string[]; error?: string }>({ statements: [], notes: [] });
    const [busy, setBusy] = useState(false);
    const [outcome, setOutcome] = useState<{ ok: boolean;
        text: string } | undefined>();
    const [confirmRefresh, setConfirmRefresh] = useState(false);
    const [selectedTrigger, setSelectedTrigger] = useState<string>();
    const [previewOpen, setPreviewOpen] = useState(true);
    const request = useRef(0);

    const send = (message: TableEditorWebviewMessage): void => {
        post(message);
    };

    useEffect(() => {
        saveState({ tab, density } satisfies IPageState);
    }, [tab, density]);

    useEffect(() => {
        const onMessage = (event: MessageEvent<TableEditorHostMessage>): void => {
            const message = event.data;
            switch (message.type) {
                case "load": {
                    setData(message.data);
                    setDraft(draftOf(message.data.table,
                        message.data.triggers));
                    setLoadError(undefined);
                    setConfirmRefresh(false);
                    break;
                }

                case "loadFailed": {
                    setLoadError(message.message);
                    break;
                }

                case "preview": {
                    if (message.request === request.current) {
                        setPreview({ statements: message.statements,
                            notes: message.notes, error: message.error });
                    }
                    break;
                }

                case "applied": {
                    setOutcome({ ok: true, text: message.notes.length > 0
                        ? `Applied. ${message.notes.join(" ")}` : "Applied." });
                    break;
                }

                case "applyFailed": {
                    setOutcome({ ok: false, text: message.done.length > 0
                        ? `${message.message} The ${message.done.length} `
                        + "statement(s) before it ran; the table was read "
                        + "again as it is now."
                        : message.message });
                    break;
                }

                case "busy": {
                    setBusy(message.busy);
                    break;
                }

                default:
            }
        };
        window.addEventListener("message", onMessage);
        send({ type: "ready" });

        return () => { window.removeEventListener("message", onMessage); };
    }, []);

    const edits = useMemo(() => {
        return data === undefined || draft === undefined ? []
            : tableEdits(data.table, data.triggers, draft);
    }, [data, draft]);
    const problems = useMemo(() => {
        return draft === undefined ? [] : draftProblems(draft);
    }, [draft]);

    useEffect(() => {
        request.current += 1;
        if (edits.length === 0 || problems.length > 0) {
            setPreview({ statements: [], notes: [] });

            return;
        }
        const asked = request.current;
        const timer = setTimeout(() => {
            send({ type: "preview", request: asked, edits });
        }, 250);

        return () => { clearTimeout(timer); };
    }, [edits, problems]);

    if (data === undefined || draft === undefined) {
        return (
            <div class="table-editor loading">
                {loadError === undefined ? "Reading the table…" : (
                    <div class="outcome failed">
                        {loadError}
                        <button type="button" class="ghost"
                            onClick={() => { send({ type: "refresh" }); }}>
                            Try Again
                        </button>
                    </div>
                )}
            </div>
        );
    }

    const change = (next: Partial<ITableDraft>): void => {
        setOutcome(undefined);
        setDraft({ ...draft, ...next });
    };
    const changeColumn = (key: string, patch: Partial<IDraftColumn>): void => {
        change({ columns: patched(draft.columns, key, patch) });
    };
    const changeIndex = (key: string, patch: Partial<IDraftIndex>): void => {
        change({ indexes: patched(draft.indexes, key, patch) });
    };
    const changeKey = (key: string, patch: Partial<IDraftForeignKey>): void => {
        change({ foreignKeys: patched(draft.foreignKeys, key, patch) });
    };
    const changeTrigger = (key: string, patch: Partial<IDraftTrigger>): void => {
        change({ triggers: patched(draft.triggers, key, patch) });
    };

    const dirty = edits.length > 0;
    const refresh = (): void => {
        if (dirty && !confirmRefresh) {
            setConfirmRefresh(true);

            return;
        }
        setOutcome(undefined);
        send({ type: "refresh" });
    };

    // Which index each column is in: the colour bar and key icons.
    const marks = new Map<string, string[]>();
    const primary = draft.columns.filter((column) => {
        return column.primary && column.dropped !== true;
    });
    for (const column of primary) {
        marks.set(column.key, ["primary"]);
    }
    for (const index of draft.indexes) {
        if (index.dropped === true) {
            continue;
        }
        for (const part of index.keyParts) {
            const column = draft.columns.find((candidate) => {
                return candidate.name.toLowerCase() === part.column.toLowerCase();
            });
            if (column !== undefined) {
                marks.set(column.key, [...marks.get(column.key) ?? [],
                    indexMark(index.kind)]);
            }
        }
    }

    const charsets = [...new Set(data.collations.map((choice) => {
        return choice.charset;
    }))];
    const columnNames = draft.columns.filter((column) => {
        return column.dropped !== true;
    }).map((column) => { return column.name; });

    const addColumn = (): void => {
        const column: IDraftColumn = { key: newRowKey("c"), name: "",
            type: "varchar(45)", nullable: true, primary: false };
        change({ columns: [...draft.columns, column] });
        setTab("Columns");
        requestAnimationFrame(() => {
            document.querySelector<HTMLInputElement>(
                `[data-key="${column.key}"][data-field="name"]`)?.focus();
        });
    };

    // -- Columns ------------------------------------------------------------
    const columnGrid: Array<IGridColumn<IDraftColumn>> = [
        {
            field: "position", title: "#", width: 52, hozAlign: "right",
            render: (column) => {
                const at = draft.columns.findIndex((candidate) => {
                    return candidate.key === column.key;
                }) + 1;
                const icons = (marks.get(column.key) ?? []).map((mark) => {
                    const icon = document.createElement("span");
                    icon.className = `codicon codicon-key key-${mark}`;
                    icon.title = mark === "primary" ? "Primary key"
                        : `In ${mark === "index" ? "an" : "a"} ${mark} index`;

                    return icon;
                });

                // The key before the number: the numbers line up at the
                // right, with a key or without.
                return cellRow([...icons.slice(0, 1), String(at)],
                    "cell-row position");
            },
        },
        {
            field: "actions", title: "Actions", width: 76,
            render: (column) => {
                return cellRow([
                    iconButton("copy", "Copy Column", () => {
                        const at = draft.columns.findIndex((candidate) => {
                            return candidate.key === column.key;
                        });
                        const copy: IDraftColumn = { ...column,
                            key: newRowKey("c"), origin: undefined,
                            dropped: undefined, primary: false,
                            auto_increment: false,
                            name: `${column.name}_copy` };
                        change({ columns: [...draft.columns.slice(0, at + 1),
                            copy, ...draft.columns.slice(at + 1)] });
                    }),
                    column.dropped === true
                        ? iconButton("discard", "Restore Column", () => {
                            change({ columns: dropped(draft.columns,
                                column.key) });
                        })
                        : iconButton(column.origin === undefined ? "close"
                            : "trash", column.origin === undefined
                            ? "Remove Column" : "Drop Column", () => {
                            change({ columns: dropped(draft.columns,
                                column.key) });
                        }),
                ]);
            },
        },
        {
            field: "name", title: "Column", minWidth: 120, grow: true,
            render: (column) => {
                return textInput({ key: column.key, field: "name" },
                    column.name, (name) => {
                        setOutcome(undefined);
                        setDraft(renameColumn(draft, column.key, name));
                    }, { className: "name", placeholder: "column name",
                        disabled: column.dropped === true });
            },
        },
        {
            field: "type", title: "Type", width: 170,
            render: (column) => {
                const parts = splitType(column.type);
                const shown = [parts.base, parts.rest].filter((part) => {
                    return part !== "";
                }).join(" ");

                return comboInput({ key: column.key, field: "type" }, shown,
                    TYPE_CHOICES, (typed) => {
                        const match = /^(.*?)\s*((?:\b(?:unsigned|signed|zerofill)\b\s*)*)$/i
                            .exec(typed.trim());
                        const base = match?.[1] ?? typed.trim();
                        const length = parts.length !== "" ? parts.length
                            : DEFAULT_LENGTHS.get(base.toLowerCase()) ?? "";
                        changeColumn(column.key, { type: joinType({ base,
                            length, rest: match?.[2] ?? "" }) });
                    }, { className: "type",
                        disabled: column.dropped === true });
            },
        },
        {
            field: "length", title: "Length", width: 90,
            render: (column) => {
                const parts = splitType(column.type);

                return textInput({ key: column.key, field: "length" },
                    parts.length, (length) => {
                        changeColumn(column.key,
                            { type: joinType({ ...parts, length }) });
                    }, { disabled: column.dropped === true });
            },
        },
        {
            field: "nullable", title: "Nullable", width: 80,
            hozAlign: "center",
            render: (column) => {
                return checkBox({ key: column.key, field: "nullable" },
                    column.nullable !== false && !column.primary,
                    (nullable) => {
                        changeColumn(column.key, { nullable });
                    }, { disabled: column.primary || column.dropped === true,
                        title: "Nullable" });
            },
        },
        {
            field: "primary", title: "Primary Key", width: 70,
            hozAlign: "center",
            render: (column) => {
                return checkBox({ key: column.key, field: "primary" },
                    column.primary, (isPrimary) => {
                        changeColumn(column.key, { primary: isPrimary,
                            ...(isPrimary ? { nullable: false } : {}) });
                    }, { disabled: column.dropped === true,
                        title: "Primary key" });
            },
        },
        {
            field: "default", title: "Default", width: 150,
            render: (column) => {
                return comboInput({ key: column.key, field: "default" },
                    column.default ?? "", DEFAULT_CHOICES, (value) => {
                        changeColumn(column.key,
                            { default: value.trim() === "" ? null : value });
                    }, { className: "default", placeholder: "",
                        disabled: column.dropped === true });
            },
        },
        {
            field: "comment", title: "Comment", minWidth: 120, grow: true,
            render: (column) => {
                return textInput({ key: column.key, field: "comment" },
                    column.comment ?? "", (comment) => {
                        changeColumn(column.key,
                            { comment: comment === "" ? null : comment });
                    }, { disabled: column.dropped === true });
            },
        },
        {
            field: "charset", title: "Charset", width: 110,
            render: (column) => {
                return selectInput({ key: column.key, field: "charset" },
                    column.charset ?? "", [{ value: "", label: "Default" },
                        ...charsets.map((charset) => {
                            return { value: charset, label: charset };
                        })], (charset) => {
                        changeColumn(column.key, { charset: charset || null,
                            collation: null });
                    }, { disabled: column.dropped === true });
            },
        },
        {
            field: "collation", title: "Collation", width: 160,
            render: (column) => {
                return selectInput({ key: column.key, field: "collation" },
                    column.collation ?? "", [{ value: "", label: "Default" },
                        ...data.collations.filter((choice) => {
                            return !column.charset
                                || choice.charset === column.charset;
                        }).map((choice) => {
                            return { value: choice.collation,
                                label: choice.collation };
                        })], (collation) => {
                        changeColumn(column.key,
                            { collation: collation || null });
                    }, { disabled: column.dropped === true });
            },
        },
        {
            field: "extended", title: "Extended", minWidth: 320, grow: true,
            render: (column) => {
                const off = column.dropped === true;
                const virtual = column.generated !== null
                    && column.generated !== undefined;
                const parts: HTMLElement[] = [
                    checkBox({ key: column.key, field: "virtual" }, virtual,
                        (checked) => {
                            changeColumn(column.key, checked
                                ? { generated: "()", generated_storage: null,
                                    auto_increment: false }
                                : { generated: null,
                                    generated_storage: null });
                        }, { label: "Virtual", disabled: off,
                            title: "A generated column: its value is an "
                            + "expression of the others" }),
                ];
                if (virtual) {
                    parts.push(textInput({ key: column.key,
                        field: "generated" }, column.generated ?? "",
                    (generated) => {
                        changeColumn(column.key, { generated });
                    }, { className: "expression", placeholder: "(expression)",
                        disabled: off }),
                    selectInput({ key: column.key, field: "storage" },
                        column.generated_storage ?? "", [
                            { value: "", label: "VIRTUAL" },
                            { value: "PERSISTENT", label: "PERSISTENT" },
                            { value: "STORED", label: "STORED" },
                        ], (storage) => {
                            changeColumn(column.key,
                                { generated_storage: storage || null });
                        }, { disabled: off, className: "storage" }));
                }
                parts.push(
                    checkBox({ key: column.key, field: "auto_increment" },
                        column.auto_increment === true, (checked) => {
                            changeColumn(column.key,
                                { auto_increment: checked });
                        }, { label: "Auto Increment",
                            disabled: off || virtual }),
                    checkBox({ key: column.key, field: "on_update" },
                        column.on_update !== null
                            && column.on_update !== undefined, (checked) => {
                            changeColumn(column.key, { on_update: checked
                                ? "CURRENT_TIMESTAMP" : null });
                        }, { label: "Auto Update Time", disabled: off,
                            title: "ON UPDATE CURRENT_TIMESTAMP" }),
                );

                return cellRow(parts, "cell-row extended");
            },
        },
    ];

    const visibleColumns = search.trim() === "" ? draft.columns
        : draft.columns.filter((column) => {
            return column.name.toLowerCase().includes(
                search.trim().toLowerCase());
        });

    // -- Indexes ------------------------------------------------------------
    const indexGrid: Array<IGridColumn<IDraftIndex>> = [
        {
            field: "actions", title: "", width: 44,
            render: (index) => {
                return iconButton(index.dropped === true ? "discard"
                    : index.origin === undefined ? "close" : "trash",
                index.dropped === true ? "Restore Index" : index.origin
                    === undefined ? "Remove Index" : "Drop Index", () => {
                    change({ indexes: dropped(draft.indexes, index.key) });
                });
            },
        },
        {
            field: "name", title: "Index", minWidth: 140, grow: true,
            render: (index) => {
                return textInput({ key: index.key, field: "name" }, index.name,
                    (name) => { changeIndex(index.key, { name }); },
                    { className: "name", placeholder: "(named by the server)",
                        disabled: index.dropped === true });
            },
        },
        {
            field: "kind", title: "Kind", width: 110,
            render: (index) => {
                return selectInput({ key: index.key, field: "kind" }, index.kind,
                    INDEX_KINDS.map((kind) => {
                        return { value: kind, label: kind.toUpperCase() };
                    }), (kind) => { changeIndex(index.key, { kind }); },
                    { disabled: index.dropped === true });
            },
        },
        {
            field: "columns", title: "Columns", minWidth: 200, grow: true,
            render: (index) => {
                return comboInput({ key: index.key, field: "columns" },
                    keyPartsText(index.keyParts), columnNames.map((name) => {
                        return { value: keyPartsText([...index.keyParts,
                            { column: name }]), label: `+ ${name}` };
                    }), (text) => {
                        const parts = parseKeyParts(text);
                        if (typeof parts !== "string") {
                            changeIndex(index.key, { keyParts: parts });
                        }
                    }, { placeholder: "col, col(10) DESC",
                        disabled: index.dropped === true });
            },
        },
        {
            field: "using", title: "Using", width: 100,
            render: (index) => {
                return selectInput({ key: index.key, field: "using" },
                    index.using ?? "", [{ value: "", label: "Default" },
                        { value: "BTREE", label: "BTREE" },
                        { value: "HASH", label: "HASH" },
                        { value: "RTREE", label: "RTREE" }], (using) => {
                        changeIndex(index.key, { using: using || null });
                    }, { disabled: index.dropped === true });
            },
        },
        {
            field: "comment", title: "Comment", minWidth: 140, grow: true,
            render: (index) => {
                return textInput({ key: index.key, field: "comment" },
                    index.comment ?? "", (comment) => {
                        changeIndex(index.key, { comment: comment || null });
                    }, { disabled: index.dropped === true });
            },
        },
    ];

    // -- Foreign keys ---------------------------------------------------------
    const tableNames = Object.keys(data.tables).sort();
    const actionChoices = [{ value: "", label: "(default)" },
        ...REFERENTIAL_ACTIONS.map((action) => {
            return { value: action, label: action };
        })];
    const keyGrid: Array<IGridColumn<IDraftForeignKey>> = [
        {
            field: "actions", title: "", width: 44,
            render: (key) => {
                return iconButton(key.dropped === true ? "discard"
                    : key.origin === undefined ? "close" : "trash",
                key.dropped === true ? "Restore Foreign Key"
                    : key.origin === undefined ? "Remove Foreign Key"
                        : "Drop Foreign Key", () => {
                    change({ foreignKeys: dropped(draft.foreignKeys,
                        key.key) });
                });
            },
        },
        {
            field: "name", title: "Name", minWidth: 140, grow: true,
            render: (key) => {
                return textInput({ key: key.key, field: "name" }, key.name,
                    (name) => { changeKey(key.key, { name }); },
                    { className: "name", disabled: key.dropped === true });
            },
        },
        {
            field: "columns", title: "Columns", minWidth: 140, grow: true,
            render: (key) => {
                return comboInput({ key: key.key, field: "columns" },
                    nameListText(key.columns), columnNames.map((name) => {
                        return { value: nameListText([...key.columns, name]),
                            label: `+ ${name}` };
                    }), (text) => {
                        changeKey(key.key, { columns: parseNameList(text) });
                    }, { disabled: key.dropped === true });
            },
        },
        {
            field: "table", title: "Referenced Table", width: 170,
            render: (key) => {
                return comboInput({ key: key.key, field: "table" },
                    key.referencedTable, tableNames.map((name) => {
                        return { value: name, label: name };
                    }), (referencedTable) => {
                        changeKey(key.key, { referencedTable });
                    }, { disabled: key.dropped === true });
            },
        },
        {
            field: "referenced", title: "Referenced Columns", minWidth: 140,
            grow: true,
            render: (key) => {
                const choices = data.tables[key.referencedTable] ?? [];

                return comboInput({ key: key.key, field: "referenced" },
                    nameListText(key.referencedColumns), choices.map((name) => {
                        return { value: nameListText([...key.referencedColumns,
                            name]), label: `+ ${name}` };
                    }), (text) => {
                        changeKey(key.key,
                            { referencedColumns: parseNameList(text) });
                    }, { disabled: key.dropped === true });
            },
        },
        {
            field: "onUpdate", title: "On Update", width: 120,
            render: (key) => {
                return selectInput({ key: key.key, field: "onUpdate" },
                    key.onUpdate ?? "", actionChoices, (action) => {
                        changeKey(key.key, { onUpdate: action || null });
                    }, { disabled: key.dropped === true });
            },
        },
        {
            field: "onDelete", title: "On Delete", width: 120,
            render: (key) => {
                return selectInput({ key: key.key, field: "onDelete" },
                    key.onDelete ?? "", actionChoices, (action) => {
                        changeKey(key.key, { onDelete: action || null });
                    }, { disabled: key.dropped === true });
            },
        },
    ];

    // -- Triggers -------------------------------------------------------------
    const triggerGrid: Array<IGridColumn<IDraftTrigger>> = [
        {
            field: "actions", title: "", width: 44,
            render: (trigger) => {
                return iconButton(trigger.dropped === true ? "discard"
                    : trigger.origin === undefined ? "close" : "trash",
                trigger.dropped === true ? "Restore Trigger"
                    : trigger.origin === undefined ? "Remove Trigger"
                        : "Drop Trigger", () => {
                    change({ triggers: dropped(draft.triggers,
                        trigger.key) });
                });
            },
        },
        {
            field: "name", title: "Trigger", minWidth: 160, grow: true,
            render: (trigger) => {
                return textInput({ key: trigger.key, field: "name" },
                    trigger.name, (name) => {
                        changeTrigger(trigger.key, { name });
                    }, { className: "name",
                        disabled: trigger.dropped === true });
            },
        },
        {
            field: "timing", title: "Timing", width: 110,
            render: (trigger) => {
                return selectInput({ key: trigger.key, field: "timing" },
                    trigger.timing, ["BEFORE", "AFTER"].map((timing) => {
                        return { value: timing, label: timing };
                    }), (timing) => { changeTrigger(trigger.key, { timing }); },
                    { disabled: trigger.dropped === true });
            },
        },
        {
            field: "events", title: "Event", width: 170,
            render: (trigger) => {
                return selectInput({ key: trigger.key, field: "events" },
                    trigger.events, TRIGGER_EVENTS.map((events) => {
                        return { value: events, label: events };
                    }), (events) => { changeTrigger(trigger.key, { events }); },
                    { disabled: trigger.dropped === true });
            },
        },
    ];
    const shownTrigger = draft.triggers.find((trigger) => {
        return trigger.key === selectedTrigger;
    }) ?? draft.triggers[0];

    const addIndex = (): void => {
        change({ indexes: [...draft.indexes, { key: newRowKey("i"),
            name: `idx_${draft.name}_${draft.indexes.length + 1}`,
            kind: "index", keyParts: [], using: null, comment: null }] });
    };
    const addForeignKey = (): void => {
        change({ foreignKeys: [...draft.foreignKeys, { key: newRowKey("f"),
            name: `fk_${draft.name}_${draft.foreignKeys.length + 1}`,
            columns: [], referencedSchema: null, referencedTable: "",
            referencedColumns: [], onDelete: null, onUpdate: null }] });
    };
    const addTrigger = (): void => {
        const trigger: IDraftTrigger = { key: newRowKey("t"),
            name: `${draft.name}_BEFORE_INSERT`, timing: "BEFORE",
            events: "INSERT", body: "BEGIN\nEND" };
        change({ triggers: [...draft.triggers, trigger] });
        setSelectedTrigger(trigger.key);
    };

    const copyColumnNames = (): void => {
        void navigator.clipboard.writeText(columnNames.join(", "));
    };

    const statements = preview.statements;
    const sql = statements.map((statement) => {
        return `${statement};`;
    }).join("\n\n");

    return (
        <div class={`table-editor density-${density.toLowerCase()}`}>
            <div class="table-fields">
                <label class="field-label" for="table-name">Table</label>
                <input id="table-name" class="text-field table-name"
                    value={draft.name} spellcheck={false}
                    onChange={(event) => {
                        change({ name: event.currentTarget.value });
                    }} />
                <label class="field-label" for="table-comment">Comment</label>
                <input id="table-comment" class="text-field table-comment"
                    value={draft.comment} placeholder="Enter table comment…"
                    onChange={(event) => {
                        change({ comment: event.currentTarget.value });
                    }} />
            </div>
            <div class="toolbar">
                <nav class="tabs" role="tablist">
                    {TABS.map((name) => {
                        return (
                            <button key={name} type="button" role="tab"
                                aria-selected={tab === name}
                                class={tab === name ? "tab active" : "tab"}
                                onClick={() => { setTab(name); }}>
                                <span class="tabCaption">{name}</span>
                            </button>
                        );
                    })}
                </nav>
                <span class="spacer" />
                {data.live && (
                    <button type="button" class="ghost"
                        onClick={() => { send({ type: "viewData" }); }}>
                        <span class="codicon codicon-table" />View Data
                    </button>
                )}
                {tab === "Columns" && (
                    <>
                        <span class="search">
                            <span class="codicon codicon-search" />
                            <input type="search" placeholder="Search column"
                                value={search} onInput={(event) => {
                                    setSearch(event.currentTarget.value);
                                }} />
                        </span>
                        <button type="button" class="primary"
                            onClick={addColumn}>
                            <span class="codicon codicon-add" />Add Column
                        </button>
                    </>
                )}
                {tab === "Indexes" && (
                    <button type="button" class="primary" onClick={addIndex}>
                        <span class="codicon codicon-add" />Add Index
                    </button>
                )}
                {tab === "Foreign Keys" && (
                    <button type="button" class="primary"
                        onClick={addForeignKey}>
                        <span class="codicon codicon-add" />Add Foreign Key
                    </button>
                )}
                {tab === "Triggers" && (
                    <button type="button" class="primary" onClick={addTrigger}>
                        <span class="codicon codicon-add" />Add Trigger
                    </button>
                )}
                {tab === "DDL" && (
                    <button type="button" class="ghost" onClick={() => {
                        void navigator.clipboard.writeText(data.ddl);
                    }}>
                        <span class="codicon codicon-copy" />Copy DDL
                    </button>
                )}
                {/* An icon alone; with changes not applied, it asks first,
                    in words. */}
                <button type="button"
                    class={confirmRefresh ? "bare refresh-button confirm"
                        : "bare refresh-button"}
                    title="Refresh Structure" aria-label="Refresh Structure"
                    disabled={busy} onClick={refresh}>
                    <span class="codicon codicon-refresh" />
                    {confirmRefresh && "Discard Changes and Refresh?"}
                </button>
                {/* Last, right of the tab's Add button: the tab's other
                    actions, and the rows' spacing, which every grid has. */}
                <button type="button" class="bare menu-button"
                    title="More Actions" aria-label="More Actions"
                    aria-haspopup="menu"
                    onClick={(event) => {
                        openMenuBelow(event.currentTarget, [
                            ...(tab === "Columns"
                                ? [{ label: "Copy Column Names",
                                    onClick: copyColumnNames }, {}]
                                : []),
                            ...DENSITIES.map((name) => {
                                return {
                                    label: name,
                                    checked: density === name,
                                    onClick: () => { setDensity(name); },
                                };
                            }),
                        ]);
                    }}>
                    <span class="codicon codicon-menu" />
                </button>
            </div>
            <main class="tab-content">
                {tab === "DDL" && <pre class="ddl">{data.ddl}</pre>}
                {tab === "Columns" && (
                    <ControlGrid rows={visibleColumns} columns={columnGrid}
                        density={density} placeholder="The table has no columns."
                        rowClass={(column) => {
                            return [...(marks.get(column.key) ?? []).slice(0, 1),
                                ...(column.dropped === true ? ["dropped"] : []),
                                ...(column.origin === undefined ? ["new"] : [])];
                        }} />
                )}
                {tab === "Indexes" && (
                    <ControlGrid rows={draft.indexes} columns={indexGrid}
                        density={density}
                        placeholder={"No indexes besides the primary key, "
                            + "which the Columns tab sets."}
                        rowClass={(index) => {
                            return [indexMark(index.kind),
                                ...(index.dropped === true ? ["dropped"] : [])];
                        }} />
                )}
                {tab === "Foreign Keys" && (
                    <ControlGrid rows={draft.foreignKeys} columns={keyGrid}
                        density={density}
                        placeholder="The table has no foreign keys."
                        rowClass={(key) => {
                            return key.dropped === true ? ["dropped"] : [];
                        }} />
                )}
                {tab === "Triggers" && (
                    <div class="triggers">
                        <ControlGrid rows={draft.triggers} columns={triggerGrid}
                            density={density}
                            placeholder="The table has no triggers."
                            onRowClick={(trigger) => {
                                setSelectedTrigger(trigger.key);
                            }}
                            rowClass={(trigger) => {
                                return [...(trigger.key === shownTrigger?.key
                                    ? ["selected"] : []),
                                ...(trigger.dropped === true ? ["dropped"]
                                    : [])];
                            }} />
                        {shownTrigger !== undefined && (
                            <div class="trigger-body">
                                <div class="trigger-body-title">
                                    Body of {shownTrigger.name}
                                </div>
                                <textarea spellcheck={false}
                                    value={shownTrigger.body}
                                    disabled={shownTrigger.dropped === true}
                                    onChange={(event) => {
                                        changeTrigger(shownTrigger.key,
                                            { body: event.currentTarget.value });
                                    }} />
                            </div>
                        )}
                    </div>
                )}
            </main>
            <section class={previewOpen ? "sql-preview open" : "sql-preview"}>
                <div class="sql-preview-header">
                    <button type="button" class="ghost toggle"
                        onClick={() => { setPreviewOpen(!previewOpen); }}>
                        <span class={`codicon codicon-chevron-${previewOpen
                            ? "down" : "right"}`} />
                        SQL Preview
                    </button>
                    <span class={dirty && problems.length === 0
                        && preview.error === undefined ? "badge ready"
                        : "badge"}>
                        {!dirty ? "No changes" : problems.length > 0
                            ? "Not ready" : `${statements.length} statement${
                                statements.length === 1 ? "" : "s"}`}
                    </span>
                    <span class="spacer" />
                    <button type="button" class="ghost" disabled={sql === ""}
                        onClick={() => { void navigator.clipboard.writeText(sql); }}>
                        <span class="codicon codicon-copy" />Copy SQL
                    </button>
                    <button type="button" class="ghost"
                        disabled={!dirty || busy}
                        onClick={() => {
                            setOutcome(undefined);
                            setDraft(draftOf(data.table, data.triggers));
                        }}>
                        Discard Changes
                    </button>
                    <button type="button" class="primary"
                        disabled={!dirty || busy || problems.length > 0
                            || preview.error !== undefined}
                        onClick={() => {
                            setOutcome(undefined);
                            // Busy at once: a second click sends no second
                            // Save before the panel's busy comes back.
                            setBusy(true);
                            send({ type: "apply", edits });
                        }}>
                        {busy ? "Applying…" : data.live ? "Apply Changes"
                            : "Save to Project"}
                    </button>
                </div>
                {previewOpen && (
                    <div class="sql-preview-body">
                        {problems.map((problem) => {
                            return <div key={problem} class="warning">{problem}</div>;
                        })}
                        {preview.error !== undefined && (
                            <div class="outcome failed">{preview.error}</div>
                        )}
                        {preview.notes.map((note) => {
                            return <div key={note} class="warning">{note}</div>;
                        })}
                        {outcome !== undefined && (
                            <div class={outcome.ok ? "outcome done"
                                : "outcome failed"}>{outcome.text}</div>
                        )}
                        {sql !== "" ? <pre class="sql">{sql}</pre> : !dirty
                            && <div class="muted">No changes.</div>}
                    </div>
                )}
            </section>
        </div>
    );
};
