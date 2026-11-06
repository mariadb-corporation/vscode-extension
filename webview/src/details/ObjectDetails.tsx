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
 * The Object Details view's page: the object selected, compressed for a
 * side bar and read only - a table's columns (one line each, with the
 * diagram card's icons), indexes, foreign keys and comment; a view's
 * columns; a routine's parameters; a trigger's, an event's and a
 * sequence's settings; SQL folded away. Changing an object is the object
 * editor's.
 */

import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import type {
    DetailsHostMessage,
    IObjectDetailsView,
    ObjectDetailsBody,
} from "../../../src/details/objectDetails.js";
import type {
    IOutlineColumn,
    IOutlineEvent,
    IOutlineRoutine,
    IOutlineSequence,
    IOutlineTable,
    IOutlineTrigger,
    IOutlineView,
} from "../../../src/modeler/modelFormat.js";
import columnSvg from "../assets/modeler/schemaTableColumn.svg?raw";
import notNullSvg from "../assets/modeler/schemaTableColumnNN.svg?raw";
import keySvg from "../assets/modeler/schemaTableColumnPK.svg?raw";
import foreignKeySvg from "../assets/modeler/schemaTableForeignKey.svg?raw";
import indexSvg from "../assets/modeler/schemaTableIndex.svg?raw";
import { primaryKeyColumns } from "../modeler/catalog.js";
import { post } from "../vscodeApi.js";

/**
 * @param svg An icon's markup.
 *
 * @returns It as an image's source.
 */
const iconSource = (svg: string): string => {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

/** The diagram card's icons, as the rows of a table's card have them. */
const COLUMN_ICON = iconSource(columnSvg);
const NOT_NULL_ICON = iconSource(notNullSvg);
const KEY_ICON = iconSource(keySvg);
const FOREIGN_KEY_ICON = iconSource(foreignKeySvg);
const INDEX_ICON = iconSource(indexSvg);

/**
 * An icon of a row, in the theme's colour: the card's icons are drawn in
 * black, which a dark side bar would swallow, so each is a mask.
 */
const Icon = ({ src, label }: { src: string; label?: string }):
    JSX.Element => {
    return <span className="detailsIcon" role={label ? "img" : undefined}
        aria-label={label} style={{ maskImage: `url("${src}")`,
            WebkitMaskImage: `url("${src}")` }} />;
};

/** What each object type is called. */
const TYPE_LABELS: Record<string, string> = {
    table: "Table",
    view: "View",
    procedure: "Procedure",
    function: "Function",
    trigger: "Trigger",
    event: "Event",
    sequence: "Sequence",
};

/**
 * @param column A column.
 *
 * @returns What its row says beyond its name and type: the flags and the
 *          default, in a few characters.
 */
const columnFlags = (column: IOutlineColumn): string => {
    return [
        column.auto_increment === true ? "AI" : "",
        column.default === null || column.default === undefined
            ? "" : `= ${column.default}`,
    ].filter((part) => { return part !== ""; }).join(" ");
};

/** A table's columns, one line each, its primary key marked. */
const ColumnsSection = ({ table }: { table: IOutlineTable }): JSX.Element => {
    const key = primaryKeyColumns(table);

    return <section>
        <h3>Columns</h3>
        <ul className="detailsList">
            {table.columns.map((column) => {
                const inKey = key.has(column.name.toLowerCase());
                const flags = columnFlags(column);

                return <li key={column.name} title={[`${column.name} ${column.type}`,
                    flags, column.comment ?? ""].filter((part) => {
                    return part !== "";
                }).join(" · ")}>
                    <Icon label={inKey ? "Primary key"
                        : column.nullable === false ? "Not null" : undefined}
                        src={inKey ? KEY_ICON : column.nullable === false
                            ? NOT_NULL_ICON : COLUMN_ICON} />
                    <span className="detailsItem">{column.name}</span>
                    <span className="detailsDataType">{column.type}
                        {flags === "" ? null
                            : <span className="detailsMuted"> {flags}</span>}
                    </span>
                </li>;
            })}
        </ul>
    </section>;
};

/** A table's indexes other than its primary key. */
const IndexesSection = ({ table }: { table: IOutlineTable }):
    JSX.Element | null => {
    const indexes = (table.indexes ?? []).filter((index) => {
        return index.kind !== "primary";
    });
    if (indexes.length === 0) {
        return null;
    }

    return <section>
        <h3>Indexes</h3>
        <ul className="detailsList">
            {indexes.map((index, at) => {
                return <li key={index.name ?? at} title={`${index.kind
                    .toUpperCase()} (${index.columns.join(", ")})`}>
                    <Icon src={INDEX_ICON} />
                    <span className="detailsItem">
                        {index.name ?? index.columns.join("_")}</span>
                    <span className="detailsDataType">
                        {index.kind === "index" ? "" : `${index.kind
                            .toUpperCase()} `}({index.columns.join(", ")})
                    </span>
                </li>;
            })}
        </ul>
    </section>;
};

/** A table's foreign keys. */
const ForeignKeysSection = ({ table }: { table: IOutlineTable }):
    JSX.Element | null => {
    const keys = table.foreign_keys ?? [];
    if (keys.length === 0) {
        return null;
    }

    return <section>
        <h3>Foreign Keys</h3>
        <ul className="detailsList">
            {keys.map((key) => {
                const actions = [
                    key.on_delete ? `ON DELETE ${key.on_delete}` : "",
                    key.on_update ? `ON UPDATE ${key.on_update}` : "",
                ].filter((entry) => { return entry !== ""; }).join(", ");

                return <li key={key.name} title={[`${key.name}: (${key.columns
                    .join(", ")}) → ${key.references.table}(${key.references
                    .columns.join(", ")})`, actions].filter((part) => {
                    return part !== "";
                }).join(" · ")}>
                    <Icon src={FOREIGN_KEY_ICON} />
                    <span className="detailsItem">{key.name}</span>
                    <span className="detailsDataType">({key.columns.join(", ")})
                        {" → "}{key.references.table}
                        ({key.references.columns.join(", ")})</span>
                </li>;
            })}
        </ul>
    </section>;
};

/** A table in full. */
const TableDetails = ({ table }: { table: IOutlineTable }): JSX.Element => {
    const comment = table.options?.comment;

    return <>
        {typeof comment === "string" && comment !== ""
            ? <div className="detailsComment">{comment}</div> : null}
        <ColumnsSection table={table} />
        <IndexesSection table={table} />
        <ForeignKeysSection table={table} />
    </>;
};

/** A view: its columns and its SELECT. */
const ViewDetails = ({ view }: { view: IOutlineView }): JSX.Element => {
    return <>
        {(view.columns ?? []).length === 0 ? null : <section>
            <h3>Columns</h3>
            <ul className="detailsList">
                {view.columns!.map((column) => {
                    return <li key={column}>
                        <Icon src={COLUMN_ICON} />
                        <span className="detailsItem">{column}</span>
                    </li>;
                })}
            </ul>
        </section>}
        <Code title="Definition" text={view.definition} />
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
                : <ul className="detailsList">
                    {parameters.map((parameter) => {
                        return <li key={parameter.name}>
                            <span className="detailsItem">
                                {parameter.mode ? <span className="detailsMuted">
                                    {parameter.mode} </span> : null}
                                {parameter.name}</span>
                            <span className="detailsDataType">
                                {parameter.type ?? ""}</span>
                        </li>;
                    })}
                </ul>}
        </section>
        {routine.returns ? <section>
            <Fields fields={[["Returns", routine.returns]]} />
        </section> : null}
    </>;
};

/** A trigger: when it fires, on what, and its body. */
const TriggerDetails = ({ trigger }: { trigger: IOutlineTrigger }):
    JSX.Element => {
    return <>
        {trigger.table === "" ? null : <section>
            <Fields fields={[
                ["Table", trigger.table],
                ["Fires", `${trigger.timing} ${trigger.events}`
                    + ((trigger.update_columns ?? []).length > 0
                        ? ` OF ${trigger.update_columns!.join(", ")}` : "")],
                ["Order", trigger.order
                    ? `${trigger.order.kind} ${trigger.order.trigger}` : ""],
                ["Definer", trigger.definer ?? ""],
            ]} />
        </section>}
        <Code title="Body" text={trigger.body} />
    </>;
};

/** An event: its schedule, status and body. */
const EventDetails = ({ event }: { event: IOutlineEvent }): JSX.Element => {
    return <>
        <section>
            <Fields fields={[
                ["Schedule", event.schedule ?? ""],
                ["Status", event.status ?? ""],
                ["On completion", event.on_completion_preserve === true
                    ? "PRESERVE" : event.on_completion_preserve === false
                        ? "NOT PRESERVE" : ""],
                ["Comment", event.comment ?? ""],
                ["Definer", event.definer ?? ""],
            ]} />
        </section>
        <Code title="Body" text={event.body} />
    </>;
};

/** A sequence: its type and numbers. */
const SequenceDetails = ({ sequence }: { sequence: IOutlineSequence }):
    JSX.Element => {
    return <section>
        <Fields fields={[
            ["Type", sequence.type ?? ""],
            ["Start", sequence.start ?? ""],
            ["Increment", sequence.increment ?? ""],
            ["Min value", sequence.minvalue ?? ""],
            ["Max value", sequence.maxvalue ?? ""],
            ["Cache", sequence.cache ?? ""],
            ["Cycle", sequence.cycle === true ? "CYCLE"
                : sequence.cycle === false ? "NOCYCLE" : ""],
        ]} />
    </section>;
};

/** Label and value rows; the empty ones are left out. */
const Fields = ({ fields }: { fields: Array<[string, string]> }):
    JSX.Element => {
    return <table className="detailsGrid"><tbody>
        {fields.filter(([, value]) => { return value !== ""; })
            .map(([label, value]) => {
                return <tr key={label}>
                    <th>{label}</th>
                    <td>{value}</td>
                </tr>;
            })}
    </tbody></table>;
};

/** SQL as written, folded away until asked for. */
const Code = ({ title, text }: { title: string; text?: string }):
    JSX.Element | null => {
    return text === undefined ? null : <details className="detailsFold">
        <summary>{title}</summary>
        <pre className="detailsCode">{text}</pre>
    </details>;
};

/**
 * @param object What is shown.
 *
 * @returns Its name.
 */
const objectName = (object: ObjectDetailsBody): string => {
    switch (object.type) {
        case "table": { return object.table.name; }
        case "view": { return object.view.name; }
        case "trigger": { return object.trigger.name; }
        case "event": { return object.event.name; }
        case "sequence": { return object.sequence.name; }
        default: { return object.routine.name; }
    }
};

/** What is shown of the object, by its type. */
const Body = ({ object }: { object: ObjectDetailsBody }): JSX.Element => {
    switch (object.type) {
        case "table": { return <TableDetails table={object.table} />; }
        case "view": { return <ViewDetails view={object.view} />; }
        case "trigger": { return <TriggerDetails trigger={object.trigger} />; }
        case "event": { return <EventDetails event={object.event} />; }
        case "sequence": {
            return <SequenceDetails sequence={object.sequence} />;
        }
        default: { return <RoutineDetails routine={object.routine} />; }
    }
};

/** The whole object. */
const Details = ({ details }: { details: IObjectDetailsView }):
    JSX.Element => {
    const object = details.object;

    return <>
        <header className="detailsHeader">
            <span className="detailsKind">{TYPE_LABELS[object.type]}</span>
            <span className="detailsName">{objectName(object)}</span>
            <span className="detailsWhere">
                {details.schema} · {details.where}</span>
        </header>
        <Body object={object} />
    </>;
};

/** The view's page. */
export const ObjectDetails = (): JSX.Element => {
    const [shown, setShown] = useState<DetailsHostMessage>();

    useEffect(() => {
        const onMessage = (event: MessageEvent<DetailsHostMessage>): void => {
            setShown(event.data);
        };
        window.addEventListener("message", onMessage);
        post({ type: "ready" });

        return () => { window.removeEventListener("message", onMessage); };
    }, []);

    return <div className="objectDetails">
        {shown?.details === undefined
            ? <div className="detailsNote">{shown?.message ?? ""}</div>
            : <Details details={shown.details} />}
    </div>;
};
