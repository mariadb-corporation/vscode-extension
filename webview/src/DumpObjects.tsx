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

import { useState } from "preact/hooks";

import type { IDumpInfo, IDumpSchemaInfo } from "../../src/mcp/utilApi.js";
import {
    countText,
    DUMP_GROUPS,
    groupKey,
    isCapped,
    objectKey,
    offersUsers,
    schemaKey,
    sizeText,
    userKey,
    USERS_KEY,
    type DumpGroup,
} from "../../src/util/dumpSelection.js";

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

/** The singular of each kind, for the counts. */
const NOUNS: Record<DumpGroup, string> = {
    tables: "table", views: "view", functions: "function",
    procedures: "procedure", events: "event",
};

export const DumpObjects = (props: IProps): preact.JSX.Element => {
    const { info, excluded } = props;
    const [open, setOpen] = useState<ReadonlySet<string>>(() => {
        // One schema has nothing to choose between: open it.
        return new Set(info.schemas.length === 1
            ? [schemaKey(info.schemas[0].name)] : []);
    });

    const toggleOpen = (key: string, onOpen?: () => void): void => {
        const next = new Set(open);
        if (next.has(key)) {
            next.delete(key);
        } else {
            next.add(key);
            onOpen?.();
        }
        setOpen(next);
    };

    const toggle = (key: string): void => {
        const next = new Set(excluded);
        if (next.has(key)) {
            next.delete(key);
        } else {
            next.add(key);
        }
        props.onChange(next);
    };

    /**
     * One row: the disclosure, the box and the caption.
     *
     * @param key The box's key.
     * @param above Whether every box above it is ticked.
     * @param label What it is.
     * @param extra Its counts and sizes.
     * @param children The keys under it, for its partly ticked state, and
     *                 what to draw under it when open.
     */
    const row = (key: string, above: boolean, label: string,
        extra?: string, children?: {
            keys: string[];
            draw(): preact.JSX.Element;
            onOpen?(): void;
        }): preact.JSX.Element => {
        const own = !excluded.has(key);
        const checked = above && own;
        const partly = checked && children !== undefined
            && children.keys.some((child) => { return excluded.has(child); });
        const expanded = children !== undefined && open.has(key);

        return (
            <li key={key} class="dump-object" role="treeitem"
                aria-expanded={children === undefined ? undefined : expanded}>
                <div class="dump-object-row">
                    {children === undefined ? (
                        <span class="dump-twisty" />
                    ) : (
                        <button
                            type="button"
                            class={`dump-twisty codicon ${expanded
                                ? "codicon-chevron-down"
                                : "codicon-chevron-right"}`}
                            aria-label={expanded ? `Close ${label}`
                                : `Open ${label}`}
                            onClick={() => {
                                toggleOpen(key, children.onOpen);
                            }}
                        />
                    )}
                    <label class="checkbox">
                        <input
                            type="checkbox"
                            data-key={key}
                            checked={checked}
                            indeterminate={partly}
                            disabled={props.disabled || !above}
                            onChange={() => { toggle(key); }}
                        />
                        <span>{label}</span>
                    </label>
                    {extra === undefined ? null : (
                        <span class="dump-object-extra">{extra}</span>
                    )}
                </div>
                {expanded ? children.draw() : null}
            </li>
        );
    };

    /** The "...and N more" under a list cut short. */
    const more = (count: number, shown: number): preact.JSX.Element | null => {
        return count > shown ? (
            <li class="dump-object dump-more">
                {`...and ${String(count - shown)} more, read when opened`}
            </li>
        ) : null;
    };

    const groupRows = (schema: IDumpSchemaInfo,
        above: boolean): preact.JSX.Element[] => {
        return DUMP_GROUPS.filter(({ count }) => {
            return schema[count] > 0;
        }).map(({ group, label, count }) => {
            const key = groupKey(schema.name, group);
            const names = schema[group];
            const groupAbove = above && !excluded.has(key);

            return row(key, above, label, countText(schema[count],
                NOUNS[group]), {
                keys: names.map((name) => {
                    return objectKey(schema.name, group, name);
                }),
                onOpen: isCapped(schema, group)
                    ? () => { props.onComplete(schema.name); } : undefined,
                draw: () => {
                    return (
                        <ul role="group">
                            {names.map((name) => {
                                return row(objectKey(schema.name, group, name),
                                    groupAbove, name);
                            })}
                            {more(schema[count], names.length)}
                        </ul>
                    );
                },
            });
        });
    };

    const schemaExtra = (schema: IDumpSchemaInfo): string => {
        return [
            countText(schema.table_count, "table"),
            ...(schema.view_count > 0
                ? [countText(schema.view_count, "view")] : []),
            ...(schema.rows === undefined ? []
                : [countText(schema.rows, "row")]),
            ...(schema.data_bytes === undefined ? []
                : [sizeText(schema.data_bytes)]),
        ].join(", ");
    };

    // Into a schema: the one schema's objects, without a row for it.
    const single = props.intoSchema !== undefined
        && info.schemas.length === 1 ? info.schemas[0] : undefined;

    return (
        <section class="dump-objects">
            {single === undefined ? null : (
                <p class="dump-into">
                    {`From ${single.name}, into ${props.intoSchema ?? ""}:`}
                </p>
            )}
            <ul class="dump-tree" role="tree">
                {single !== undefined
                    ? groupRows(single, !excluded.has(schemaKey(single.name)))
                    : info.schemas.map((schema) => {
                        const key = schemaKey(schema.name);

                        return row(key, true, schema.name, schemaExtra(schema), {
                            keys: DUMP_GROUPS.flatMap(({ group }) => {
                                return [groupKey(schema.name, group),
                                    ...schema[group].map((name) => {
                                        return objectKey(schema.name, group,
                                            name);
                                    })];
                            }),
                            draw: () => {
                                return (
                                    <ul role="group">
                                        {groupRows(schema, !excluded.has(key))}
                                    </ul>
                                );
                            },
                        });
                    })}
                {offersUsers(info, props.intoSchema) ? row(USERS_KEY, true,
                    "User accounts", countText(info.user_count, "account"), {
                        keys: info.users.map(userKey),
                        // Inspecting any schema lists every account.
                        onOpen: info.user_count > info.users.length
                            && info.schemas.length > 0
                            ? () => { props.onComplete(info.schemas[0].name); }
                            : undefined,
                        draw: () => {
                            const above = !excluded.has(USERS_KEY);

                            return (
                                <ul role="group">
                                    {info.users.map((account) => {
                                        return row(userKey(account), above,
                                            account);
                                    })}
                                    {more(info.user_count, info.users.length)}
                                </ul>
                            );
                        },
                    }) : null}
            </ul>
        </section>
    );
};
