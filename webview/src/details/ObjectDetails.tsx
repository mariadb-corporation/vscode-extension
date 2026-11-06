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
 * The Object Details view's page: a table's columns, keys, indexes,
 * foreign keys and comment, a view's columns and SELECT, a routine's
 * parameters. A project's table is changed in place: each field sends its
 * change once it is left or Enter is pressed, and the view shows what msm
 * made of it.
 */

import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import type { TableDetailChange } from "../../../src/details/detailEdits.js";
import type {
    DetailsHostMessage,
    IObjectDetailsView,
} from "../../../src/details/objectDetails.js";
import type {
    IOutlineColumn,
    IOutlineRoutine,
    IOutlineTable,
    IOutlineView,
} from "../../../src/modeler/modelFormat.js";
import {
    COLUMN_TYPES,
    DEFAULT_COLUMN_TYPE,
} from "../../../src/sql/columnTypes.js";
import { post } from "../vscodeApi.js";

/** The id of the list of column types the type inputs offer. */
const TYPES_LIST = "objectDetailsTypes";

/** What each object type is called. */
const TYPE_LABELS: Record<string, string> = {
    table: "Table",
    view: "View",
    procedure: "Procedure",
    function: "Function",
};

interface IEditableTextProps {
    value: string;
    disabled: boolean;
    label: string;
    placeholder?: string;
    list?: string;
    /** Called with the text once it is left or Enter is pressed, changed. */
    onCommit: (text: string) => void;
}

/**
 * A text field that sends its change when it is left or Enter is pressed,
 * and goes back to the value on Escape.
 */
const EditableText = (props: IEditableTextProps): JSX.Element => {
    const [text, setText] = useState(props.value);
    useEffect(() => { setText(props.value); }, [props.value]);
    const commit = (): void => {
        if (text !== props.value) {
            props.onCommit(text);
        }
    };

    return <input
        className="detailsInput"
        value={text}
        disabled={props.disabled}
        aria-label={props.label}
        title={props.label}
        placeholder={props.placeholder}
        list={props.list}
        onInput={(event) => { setText(event.currentTarget.value); }}
        onBlur={commit}
        onKeyDown={(event) => {
            if (event.key === "Enter") {
                event.currentTarget.blur();
            } else if (event.key === "Escape") {
                setText(props.value);
            }
        }}
    />;
};

interface ITableProps {
    table: IOutlineTable;
    disabled: boolean;
    change: (change: TableDetailChange) => void;
}

/** A table's columns, with its primary key marked. */
const ColumnsSection = ({ table, disabled, change }: ITableProps):
    JSX.Element => {
    const key = table.indexes?.find((index) => {
        return index.kind === "primary";
    })?.columns ?? [];
    const [newName, setNewName] = useState("");
    const [newType, setNewType] = useState(DEFAULT_COLUMN_TYPE);
    const modify = (column: IOutlineColumn,
        changed: Partial<IOutlineColumn>): void => {
        change({ kind: "modifyColumn", column: column.name,
            definition: { ...column, ...changed } });
    };
    const add = (): void => {
        if (newName.trim() !== "" && newType.trim() !== "") {
            change({ kind: "addColumn", definition: { name: newName.trim(),
                type: newType.trim() } });
            setNewName("");
        }
    };

    return <section>
        <h3>Columns</h3>
        <div className="detailsScroll"><table className="detailsGrid">
            <thead>
                <tr>
                    <th title="Primary key">PK</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th title="Not null">NN</th>
                    <th title="Auto increment">AI</th>
                    <th>Default</th>
                    <th>Comment</th>
                    {disabled ? null : <th />}
                </tr>
            </thead>
            <tbody>
                {table.columns.map((column) => {
                    const inKey = key.includes(column.name);

                    return <tr key={column.name}>
                        <td><input type="checkbox" checked={inKey}
                            disabled={disabled} aria-label="Primary key"
                            onChange={() => {
                                change({ kind: "setPrimaryKey",
                                    columns: table.columns.filter((entry) => {
                                        return entry.name === column.name
                                            ? !inKey : key.includes(entry.name);
                                    }).map((entry) => { return entry.name; }) });
                            }} /></td>
                        <td><EditableText value={column.name} label="Name"
                            disabled={disabled} onCommit={(name) => {
                                change({ kind: "renameColumn",
                                    column: column.name, name: name.trim() });
                            }} /></td>
                        <td><EditableText value={column.type} label="Type"
                            list={TYPES_LIST} disabled={disabled}
                            onCommit={(type) => {
                                modify(column, { type: type.trim() });
                            }} /></td>
                        <td><input type="checkbox"
                            checked={column.nullable === false}
                            disabled={disabled} aria-label="Not null"
                            onChange={(event) => {
                                modify(column,
                                    { nullable: !event.currentTarget.checked });
                            }} /></td>
                        <td><input type="checkbox"
                            checked={column.auto_increment === true}
                            disabled={disabled} aria-label="Auto increment"
                            onChange={(event) => {
                                modify(column, { auto_increment:
                                    event.currentTarget.checked });
                            }} /></td>
                        <td><EditableText value={column.default ?? ""}
                            label="Default" placeholder="NULL"
                            disabled={disabled} onCommit={(value) => {
                                modify(column,
                                    { default: value === "" ? null : value });
                            }} /></td>
                        <td><EditableText value={column.comment ?? ""}
                            label="Comment" disabled={disabled}
                            onCommit={(value) => {
                                modify(column,
                                    { comment: value === "" ? null : value });
                            }} /></td>
                        {disabled ? null : <td><button className="detailsDrop"
                            title={`Drop ${column.name}`}
                            onClick={() => {
                                change({ kind: "dropColumn",
                                    column: column.name });
                            }}>✕</button></td>}
                    </tr>;
                })}
                {disabled ? null : <tr className="detailsAdd">
                    <td />
                    <td><input className="detailsInput" value={newName}
                        placeholder="New column" aria-label="New column's name"
                        onInput={(event) => {
                            setNewName(event.currentTarget.value);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                add();
                            }
                        }} /></td>
                    <td><input className="detailsInput" value={newType}
                        list={TYPES_LIST} aria-label="New column's type"
                        onInput={(event) => {
                            setNewType(event.currentTarget.value);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                add();
                            }
                        }} /></td>
                    <td colSpan={4} />
                    <td><button className="detailsDrop" title="Add the column"
                        onClick={add}>+</button></td>
                </tr>}
            </tbody>
        </table></div>
    </section>;
};

/** A table's indexes other than its primary key. */
const IndexesSection = ({ table, disabled, change }: ITableProps):
    JSX.Element | null => {
    const [name, setName] = useState("");
    const [kind, setKind] = useState("index");
    const [columns, setColumns] = useState("");
    const indexes = (table.indexes ?? []).filter((index) => {
        return index.kind !== "primary";
    });
    const add = (): void => {
        const list = columns.split(",").map((entry) => {
            return entry.trim();
        }).filter((entry) => { return entry !== ""; });
        if (name.trim() !== "" && list.length > 0) {
            change({ kind: "addIndex", index: { name: name.trim(), kind,
                columns: list } });
            setName("");
            setColumns("");
        }
    };
    if (indexes.length === 0 && disabled) {
        return null;
    }

    return <section>
        <h3>Indexes</h3>
        <div className="detailsScroll"><table className="detailsGrid">
            <tbody>
                {indexes.map((index, at) => {
                    return <tr key={index.name ?? at}>
                        <td>{index.name ?? "(unnamed)"}</td>
                        <td>{index.kind.toUpperCase()}</td>
                        <td>{index.columns.join(", ")}</td>
                        {disabled || index.name === null ? <td /> : <td>
                            <button className="detailsDrop"
                                title={`Drop ${index.name}`} onClick={() => {
                                    change({ kind: "dropIndex",
                                        name: index.name! });
                                }}>✕</button></td>}
                    </tr>;
                })}
                {disabled ? null : <tr className="detailsAdd">
                    <td><input className="detailsInput" value={name}
                        placeholder="New index" aria-label="New index's name"
                        onInput={(event) => {
                            setName(event.currentTarget.value);
                        }} /></td>
                    <td><select value={kind} aria-label="New index's kind"
                        onChange={(event) => {
                            setKind(event.currentTarget.value);
                        }}>
                        <option value="index">INDEX</option>
                        <option value="unique">UNIQUE</option>
                        <option value="fulltext">FULLTEXT</option>
                    </select></td>
                    <td><input className="detailsInput" value={columns}
                        placeholder="column, column"
                        aria-label="New index's columns"
                        onInput={(event) => {
                            setColumns(event.currentTarget.value);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                add();
                            }
                        }} /></td>
                    <td><button className="detailsDrop" title="Add the index"
                        onClick={add}>+</button></td>
                </tr>}
            </tbody>
        </table></div>
    </section>;
};

/** A table's foreign keys. */
const ForeignKeysSection = ({ table, disabled, change }: ITableProps):
    JSX.Element | null => {
    const keys = table.foreign_keys ?? [];
    if (keys.length === 0) {
        return null;
    }

    return <section>
        <h3>Foreign Keys</h3>
        <div className="detailsScroll"><table className="detailsGrid">
            <tbody>
                {keys.map((key) => {
                    const actions = [
                        key.on_delete ? `ON DELETE ${key.on_delete}` : "",
                        key.on_update ? `ON UPDATE ${key.on_update}` : "",
                    ].filter((entry) => { return entry !== ""; }).join(" ");

                    return <tr key={key.name}>
                        <td>{key.name}</td>
                        <td>{key.columns.join(", ")} → {key.references.table}
                            ({key.references.columns.join(", ")})
                            {actions === "" ? null : <div className="detailsNote">
                                {actions}</div>}</td>
                        {disabled ? <td /> : <td><button className="detailsDrop"
                            title={`Drop ${key.name}`} onClick={() => {
                                change({ kind: "dropForeignKey",
                                    name: key.name });
                            }}>✕</button></td>}
                    </tr>;
                })}
            </tbody>
        </table></div>
    </section>;
};

/** A table in full. */
const TableDetails = (props: ITableProps): JSX.Element => {
    const comment = props.table.options?.comment;

    return <>
        <section>
            <label className="detailsField">
                <span>Comment</span>
                <EditableText value={typeof comment === "string" ? comment : ""}
                    label="Comment" disabled={props.disabled}
                    onCommit={(text) => {
                        props.change({ kind: "setComment", comment: text });
                    }} />
            </label>
        </section>
        <ColumnsSection {...props} />
        <IndexesSection {...props} />
        <ForeignKeysSection {...props} />
    </>;
};

/** A view: its columns and its SELECT. */
const ViewDetails = ({ view }: { view: IOutlineView }): JSX.Element => {
    return <>
        {(view.columns ?? []).length === 0 ? null : <section>
            <h3>Columns</h3>
            <div>{view.columns?.join(", ")}</div>
        </section>}
        {view.definition === undefined ? null : <section>
            <h3>Definition</h3>
            <pre className="detailsCode">{view.definition}</pre>
        </section>}
    </>;
};

/** A routine: its parameters and what it returns. */
const RoutineDetails = ({ routine }: { routine: IOutlineRoutine }):
    JSX.Element => {
    const parameters = routine.parameters ?? [];

    return <>
        <section>
            <h3>Parameters</h3>
            {parameters.length === 0 ? <div className="detailsNote">None</div>
                : <div className="detailsScroll"><table className="detailsGrid"><tbody>
                    {parameters.map((parameter) => {
                        return <tr key={parameter.name}>
                            <td>{parameter.mode ?? ""}</td>
                            <td>{parameter.name}</td>
                            <td>{parameter.type ?? ""}</td>
                        </tr>;
                    })}
                </tbody></table></div>}
        </section>
        {routine.returns ? <section>
            <h3>Returns</h3>
            <div>{routine.returns}</div>
        </section> : null}
    </>;
};

/** The whole object. */
const Details = ({ details, busy }: { details: IObjectDetailsView;
    busy: boolean }): JSX.Element => {
    const object = details.object;
    const disabled = !details.editable || busy;
    const change = (next: TableDetailChange): void => {
        post({ type: "change", change: next });
    };
    const name = object.type === "table" ? object.table.name
        : object.type === "view" ? object.view.name : object.routine.name;

    return <>
        <header className="detailsHeader">
            <span className="detailsType">{TYPE_LABELS[object.type]}</span>
            {object.type === "table" && details.editable
                ? <EditableText value={name} label="Table name"
                    disabled={disabled} onCommit={(text) => {
                        change({ kind: "renameTable", name: text.trim() });
                    }} />
                : <span className="detailsName">{name}</span>}
            <span className="detailsWhere">
                {details.schema} · {details.where}</span>
        </header>
        {object.type === "table"
            ? <TableDetails table={object.table} disabled={disabled}
                change={change} />
            : object.type === "view"
                ? <ViewDetails view={object.view} />
                : <RoutineDetails routine={object.routine} />}
        {details.partial === undefined ? null
            : <div className="detailsNote">{details.partial}</div>}
    </>;
};

/** The view's page. */
export const ObjectDetails = (): JSX.Element => {
    const [shown, setShown] = useState<Extract<DetailsHostMessage,
        { type: "show" }>>();
    const [error, setError] = useState<string>();
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const onMessage = (event: MessageEvent<DetailsHostMessage>): void => {
            const message = event.data;
            if (message.type === "show") {
                setShown(message);
                setBusy(false);
            } else {
                setError(message.error);
                setBusy(message.busy === true);
            }
        };
        window.addEventListener("message", onMessage);
        post({ type: "ready" });

        return () => { window.removeEventListener("message", onMessage); };
    }, []);

    return <div className="objectDetails">
        <datalist id={TYPES_LIST}>
            {COLUMN_TYPES.map((type) => {
                return <option key={type.label} value={type.insert} />;
            })}
        </datalist>
        {error === undefined ? null
            : <div className="detailsError" role="alert">{error}</div>}
        {shown?.details === undefined
            ? <div className="detailsNote">{shown?.message ?? ""}</div>
            : <Details details={shown.details} busy={busy} />}
    </div>;
};
