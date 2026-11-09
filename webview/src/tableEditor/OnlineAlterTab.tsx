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
 * The table editor's Online Alter Table tab: whether the table's ALTER
 * TABLE statements run online, and within which limits. A field left
 * empty takes the value shown in it, the project's or msm's default.
 */

import {
    COUNT_KEYS,
    type IOnlineAlterData,
    NO_LIMIT,
    ONLINE_ALTER_LABELS,
    type OnlineAlterTexts,
    SIZE_KEYS,
    sizeText,
} from "../../../src/tableEditor/onlineAlter.js";

/** What each field is for. */
const HINTS: Record<keyof OnlineAlterTexts, string> = {
    enabled: "",
    maxRebuildBytes: "The largest table an online rebuild (ALGORITHM="
        + "INPLACE or COPY, LOCK=NONE) runs on; 0 never rebuilds.",
    galeraMaxBytes: "On Galera, the largest table for a step other than "
        + "INSTANT.",
    nboLock: "On Galera, the lock a non-blocking operation (NBO) may take: "
        + "it blocks writes, EXCLUSIVE reads too.",
    maxLockedBytes: "The largest table a step that blocks writes "
        + "(LOCK=SHARED or EXCLUSIVE) runs on.",
    lockWait: "How long each attempt waits for the table's metadata lock.",
    maxRetries: "How often an attempt whose lock wait ran out is made again.",
};

interface IOnlineAlterTabProps {
    data?: IOnlineAlterData;
    /** Why there are no settings. */
    problem?: string;
    texts?: OnlineAlterTexts;
    onChange(texts: OnlineAlterTexts): void;
}

/**
 * @param props The tab's settings and fields.
 *
 * @returns The tab.
 */
export const OnlineAlterTab = (props: IOnlineAlterTabProps):
    preact.JSX.Element => {
    const { data, texts } = props;
    if (data === undefined || texts === undefined) {
        return (
            <div class="online-alter">
                <div class="warning">{props.problem
                    ?? "Online ALTER TABLE is not offered here."}</div>
            </div>
        );
    }
    const inherited = data.inherited;
    const change = (patch: Partial<OnlineAlterTexts>): void => {
        props.onChange({ ...texts, ...patch });
    };
    const enabled = texts.enabled === "" ? inherited.enabled
        : texts.enabled === "on";
    const from = data.keptIn === "project" ? "project" : "default";

    return (
        <div class="online-alter">
            <p class="muted">
                Runs each ALTER TABLE of this table the least disruptive way
                the server accepts: ALGORITHM=INSTANT, then NOCOPY, INPLACE
                and COPY with LOCK=NONE, then a Galera NBO where allowed, then
                LOCK=SHARED and LOCK=EXCLUSIVE. A step the server refuses
                changes nothing; where no allowed step can run it, the table
                is left as it was.
            </p>
            <div class="online-alter-fields">
                <label class="field-label" for="online-alter-enabled">
                    Online ALTER TABLE
                </label>
                <select id="online-alter-enabled" value={texts.enabled}
                    onChange={(event) => {
                        change({ enabled: event.currentTarget.value as
                            OnlineAlterTexts["enabled"] });
                    }}>
                    <option value="">
                        {`As the ${from} (${inherited.enabled ? "on" : "off"})`}
                    </option>
                    <option value="on">On</option>
                    <option value="off">Off: run as written</option>
                </select>
                <span />
                {SIZE_KEYS.map((key) => {
                    return [
                        <label key={`${key}-label`} class="field-label"
                            for={`online-alter-${key}`}>
                            {ONLINE_ALTER_LABELS[key]}
                        </label>,
                        <input key={key} id={`online-alter-${key}`}
                            class="text-field" spellcheck={false}
                            disabled={!enabled} value={texts[key]}
                            placeholder={sizeText(inherited[key])}
                            onInput={(event) => {
                                change({ [key]: event.currentTarget.value });
                            }} />,
                        <span key={`${key}-hint`} class="muted hint">
                            {HINTS[key]}
                        </span>,
                    ];
                })}
                <label class="field-label" for="online-alter-nboLock">
                    Galera NBO lock
                </label>
                <select id="online-alter-nboLock" value={texts.nboLock}
                    disabled={!enabled} onChange={(event) => {
                        change({ nboLock: event.currentTarget.value as
                            OnlineAlterTexts["nboLock"] });
                    }}>
                    <option value="">
                        {`As the ${from} (${inherited.nboLock ?? "none"})`}
                    </option>
                    <option value="off">None</option>
                    <option value="SHARED">SHARED</option>
                    <option value="EXCLUSIVE">EXCLUSIVE</option>
                </select>
                <span class="muted hint">{HINTS.nboLock}</span>
                {COUNT_KEYS.map((key) => {
                    return [
                        <label key={`${key}-label`} class="field-label"
                            for={`online-alter-${key}`}>
                            {ONLINE_ALTER_LABELS[key]}
                        </label>,
                        <input key={key} id={`online-alter-${key}`}
                            class="text-field" spellcheck={false}
                            disabled={!enabled} value={texts[key]}
                            placeholder={String(inherited[key])}
                            onInput={(event) => {
                                change({ [key]: event.currentTarget.value });
                            }} />,
                        <span key={`${key}-hint`} class="muted hint">
                            {HINTS[key]}
                        </span>,
                    ];
                })}
            </div>
            <p class="muted">
                {`Sizes as 10 GiB, 512 MiB, 0 or ${NO_LIMIT}; a field left `
                    + `empty takes the ${from}'s value it shows. `}
                {data.keptIn === "project"
                    ? "Saved in the project's msm.project.json: deployments "
                        + "run the table's ALTER TABLE statements so."
                    : "Kept in this workspace: Apply Changes runs the "
                        + "table's ALTER TABLE statements so, each as a task "
                        + "of the Tasks view, which Cancel stops."}
            </p>
        </div>
    );
};
