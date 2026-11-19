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

import { useMemo, useState } from "preact/hooks";

import type { IDumpInfo, IDumpSchemaInfo } from "../../src/mcp/utilApi.js";
import {
    DUMP_GROUPS,
    groupKey,
    isCapped,
    objectKey,
    offersUsers,
    partlyTicked,
    schemaKey,
    userKey,
    USERS_KEY,
} from "../../src/util/dumpSelection.js";
import { counted, formatBytes } from "../../src/text.js";

/**
 * The Load dialog's Objects tab: what the dump holds, as a tree of boxes -
 * its schemas, each with its tables, views, functions, procedures and
 * events, and its user accounts. A box unticked leaves out what is under
 * it; the boxes under it keep their own state, greyed out, for when it is
 * ticked again. A box with some of what is under it unticked shows as
 * partly ticked.
 */

interface IProps {
    info: IDumpInfo;
    /** Load Table Dump: the schema it goes into. */
    intoSchema?: string;
    excluded: ReadonlySet<string>;
    disabled: boolean;
    onChange(excluded: Set<string>): void;
    /** A schema whose names were cut short was opened: read them all. */
    onComplete(schema: string): void;
}

/** What every row shares: the boxes' state, and opening rows. */
interface ITree {
    excluded: ReadonlySet<string>;
    partly: ReadonlySet<string>;
    open: ReadonlySet<string>;
    disabled: boolean;
    toggle(key: string): void;
    toggleOpen(key: string, onOpen?: () => void): void;
}

/**
 * One row: the disclosure where it has rows under it, its box and its
 * caption, and the rows under it while it is open.
 */
const Row = (props: {
    tree: ITree;
    /** The box's key (`dumpSelection.ts`), also its input's name. */
    boxKey: string;
    /** Whether every box above it is ticked. */
    above: boolean;
    label: string;
    /** Its counts and sizes. */
    extra?: string;
    /** Whether it has rows under it to open. */
    expandable?: boolean;
    /** Called as it is opened. */
    onOpen?(): void;
    children?: preact.ComponentChildren;
}): preact.JSX.Element => {
    const { tree, boxKey, label } = props;
    const checked = props.above && !tree.excluded.has(boxKey);
    const expanded = props.expandable === true && tree.open.has(boxKey);

    return (
        <li class="dump-object" role="treeitem"
            aria-expanded={props.expandable === true ? expanded : undefined}>
            <div class="dump-object-row">
                {props.expandable === true ? (
                    <button
                        type="button"
                        class={`dump-twisty codicon ${expanded
                            ? "codicon-chevron-down" : "codicon-chevron-right"}`}
                        aria-label={expanded ? `Close ${label}` : `Open ${label}`}
                        onClick={() => { tree.toggleOpen(boxKey, props.onOpen); }}
                    />
                ) : (
                    <span class="dump-twisty" />
                )}
                <label class="checkbox">
                    <input
                        type="checkbox"
                        name={boxKey}
                        checked={checked}
                        indeterminate={checked && tree.partly.has(boxKey)}
                        disabled={tree.disabled || !props.above}
                        onChange={() => { tree.toggle(boxKey); }}
                    />
                    <span>{label}</span>
                </label>
                {props.extra === undefined ? null : (
                    <span class="dump-object-extra">{props.extra}</span>
                )}
            </div>
            {expanded ? <ul role="group">{props.children}</ul> : null}
        </li>
    );
};

/** The "...and N more" under a list cut short. */
const More = (props: { count: number; shown: number }) => {
    return props.count > props.shown ? (
        <li class="dump-object dump-more">
            {`...and ${String(props.count - props.shown)} more, read when opened`}
        </li>
    ) : null;
};

/** A schema's kinds of objects, each with its objects under it. */
const Groups = (props: {
    tree: ITree;
    schema: IDumpSchemaInfo;
    above: boolean;
    onComplete(schema: string): void;
}): preact.JSX.Element => {
    const { tree, schema } = props;

    return (
        <>
            {DUMP_GROUPS.filter(({ count }) => {
                return schema[count] > 0;
            }).map(({ group, label, noun, count }) => {
                const key = groupKey(schema.name, group);
                const groupAbove = props.above && !tree.excluded.has(key);

                return (
                    <Row key={key} tree={tree} boxKey={key} above={props.above}
                        label={label} extra={counted(schema[count], noun)}
                        expandable
                        onOpen={isCapped(schema, group)
                            ? () => { props.onComplete(schema.name); }
                            : undefined}>
                        {schema[group].map((name) => {
                            const objectBox = objectKey(schema.name, group, name);

                            return (
                                <Row key={objectBox} tree={tree} boxKey={objectBox}
                                    above={groupAbove} label={name} />
                            );
                        })}
                        <More count={schema[count]} shown={schema[group].length} />
                    </Row>
                );
            })}
        </>
    );
};

/** A schema's counts and sizes, beside its name. */
const schemaExtra = (schema: IDumpSchemaInfo): string => {
    return [
        counted(schema.table_count, "table"),
        ...(schema.view_count > 0 ? [counted(schema.view_count, "view")] : []),
        ...(schema.rows === undefined ? [] : [counted(schema.rows, "row")]),
        ...(schema.data_bytes === undefined ? []
            : [formatBytes(schema.data_bytes)]),
    ].join(", ");
};

export const DumpObjects = (props: IProps): preact.JSX.Element => {
    const { info, excluded } = props;
    const [open, setOpen] = useState<ReadonlySet<string>>(() => {
        // One schema has nothing to choose between: open it.
        return new Set(info.schemas.length === 1
            ? [schemaKey(info.schemas[0].name)] : []);
    });
    const partly = useMemo(() => { return partlyTicked(excluded); },
        [excluded]);

    const tree: ITree = {
        excluded, partly, open, disabled: props.disabled,
        toggle: (key) => {
            const next = new Set(excluded);
            if (!next.delete(key)) {
                next.add(key);
            }
            props.onChange(next);
        },
        toggleOpen: (key, onOpen) => {
            const next = new Set(open);
            if (!next.delete(key)) {
                next.add(key);
                onOpen?.();
            }
            setOpen(next);
        },
    };

    // Into a schema: the one schema's objects, without a row for it.
    const single = props.intoSchema !== undefined
        && info.schemas.length === 1 ? info.schemas[0] : undefined;
    // Reading any schema in full lists every account too.
    const completeUsers = info.user_count > info.users.length
        && info.schemas.length > 0
        ? () => { props.onComplete(info.schemas[0].name); } : undefined;

    return (
        <section class="dump-objects">
            {single === undefined ? null : (
                <p class="dump-into">
                    {`From ${single.name}, into ${props.intoSchema ?? ""}:`}
                </p>
            )}
            <ul class="dump-tree" role="tree">
                {single !== undefined ? (
                    <Groups tree={tree} schema={single}
                        above={!excluded.has(schemaKey(single.name))}
                        onComplete={props.onComplete} />
                ) : info.schemas.map((schema) => {
                    const key = schemaKey(schema.name);

                    return (
                        <Row key={key} tree={tree} boxKey={key} above
                            label={schema.name} extra={schemaExtra(schema)}
                            expandable>
                            <Groups tree={tree} schema={schema}
                                above={!excluded.has(key)}
                                onComplete={props.onComplete} />
                        </Row>
                    );
                })}
                {offersUsers(info, props.intoSchema) ? (
                    <Row tree={tree} boxKey={USERS_KEY} above
                        label="User accounts"
                        extra={counted(info.user_count, "account")}
                        expandable onOpen={completeUsers}>
                        {info.users.map((account) => {
                            return (
                                <Row key={account} tree={tree}
                                    boxKey={userKey(account)}
                                    above={!excluded.has(USERS_KEY)}
                                    label={account} />
                            );
                        })}
                        <More count={info.user_count} shown={info.users.length} />
                    </Row>
                ) : null}
            </ul>
        </section>
    );
};
