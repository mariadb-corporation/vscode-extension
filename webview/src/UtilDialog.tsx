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

import { useEffect, useState } from "preact/hooks";

import {
    dumpProblem,
    dumpSummary,
    selectionProblem,
    withZipSuffix,
} from "../../src/util/dumpSelection.js";
import {
    buildUtilOptions,
    type IUtilOperationSpec,
    type IUtilOptionSpec,
    type IUtilProblem,
    type UtilValues,
} from "../../src/util/utilFields.js";
import type {
    IDumpRead,
    IUtilTarget,
    UtilHostMessage,
    UtilWebviewMessage,
} from "../../src/util/utilProtocol.js";
import { Field, TabBody, TabStrip } from "./dialogParts.js";
import { DumpObjects } from "./DumpObjects.js";
import { post } from "./vscodeApi.js";

/**
 * The dialog that sets up a dump, load, copy, export or import. What it
 * asks for comes from the extension, as the operation's spec; it draws the
 * path or the target on top, and the utility's options on two tabs. A load
 * reads what its dump holds and lists it on an Objects tab first, to untick
 * what not to load.
 */

const TABS = ["Basic", "Advanced"] as const;
const LOAD_TABS = ["Objects", "Basic", "Advanced"] as const;

type Tab = (typeof LOAD_TABS)[number];

export const UtilDialog = (): preact.JSX.Element => {
    const [spec, setSpec] = useState<IUtilOperationSpec | undefined>();
    const [values, setValues] = useState<UtilValues>({});
    const [targets, setTargets] = useState<IUtilTarget[]>([]);
    const [tab, setTab] = useState<Tab>("Basic");
    const [problem, setProblem] = useState<IUtilProblem | undefined>();
    const [startError, setStartError] = useState<string | undefined>();
    const [busy, setBusy] = useState(false);
    const [dump, setDump] = useState<IDumpRead | undefined>();
    const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());

    useEffect(() => {
        const onMessage = (event: MessageEvent<UtilHostMessage>): void => {
            const message = event.data;
            switch (message.type) {
                case "load": {
                    setSpec(message.spec);
                    setValues(message.values);
                    setTargets(message.targets);
                    setProblem(undefined);
                    setStartError(undefined);
                    setTab(message.spec.inspects === true ? "Objects" : "Basic");
                    break;
                }

                case "inspected": {
                    // A dump read anew comes with the boxes to start with;
                    // the same one read again keeps them.
                    if (message.excluded !== undefined) {
                        setExcluded(new Set(message.excluded));
                    }
                    setDump({ path: message.path, info: message.info,
                        error: message.error });
                    setStartError(undefined);
                    break;
                }

                case "browsed": {
                    setValues((current) => {
                        return { ...current, path: message.path };
                    });
                    // A load's dump picked anew is read: not the last one.
                    setDump((current) => {
                        return current === undefined
                            || current.path === message.path
                            ? current : { path: message.path };
                    });
                    setProblem(undefined);
                    break;
                }

                case "startError": {
                    if (message.field === undefined) {
                        setStartError(message.message);
                    } else {
                        setProblem({
                            field: message.field, message: message.message,
                        });
                    }
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
        post<UtilWebviewMessage>({ type: "ready" });

        return () => { window.removeEventListener("message", onMessage); };
    }, []);

    if (spec === undefined) {
        return <div class="editor" />;
    }

    const update = (name: string, value: boolean | string): void => {
        setValues((current) => {
            // Dump to Self-Contained ZIP File names the path a zip, or not.
            return name === "zip" ? { ...current, zip: value,
                path: withZipSuffix(String(current.path ?? ""), value === true) }
                : { ...current, [name]: value };
        });
        setProblem(undefined);
        setStartError(undefined);
    };

    const inspects = spec.inspects === true;
    const path = String(values.path ?? "").trim();
    const zip = values.zip === true && spec.path?.zip !== undefined;
    // The path's label and hint, a zip's while the box is ticked.
    const pathSpec = zip ? spec.path?.zip : spec.path;
    // What keeps a load's dump from being loaded here, said in its place.
    const loadProblem = dump?.info === undefined ? dump?.error
        : dumpProblem(dump.info, spec.intoSchema);
    const canLoad = !inspects || (dump?.info !== undefined
        && loadProblem === undefined && dump.path === path);

    const hintOf = (field: string, hint: string): string => {
        return problem?.field === field ? problem.message : hint;
    };

    const start = (): void => {
        if (inspects && dump?.info !== undefined) {
            const nothing = selectionProblem(dump.info, excluded,
                spec.intoSchema);
            if (nothing !== undefined) {
                setTab("Objects");
                setStartError(nothing);

                return;
            }
        }
        const built = buildUtilOptions(spec, values);
        if ("problem" in built) {
            setProblem(built.problem);
            const option = spec.options.find((candidate) => {
                return candidate.name === built.problem.field;
            });
            // Brought into view: a problem on the other tab would otherwise
            // leave the button doing nothing that can be seen.
            if (option !== undefined) {
                setTab(option.advanced === true ? "Advanced" : "Basic");
            }

            return;
        }

        setStartError(undefined);
        post<UtilWebviewMessage>({ type: "start", values,
            ...(inspects ? { excluded: [...excluded] } : {}) });
    };

    /** A path typed: read the dump there, if it is another. */
    const inspectTyped = (): void => {
        if (inspects && path !== dump?.path) {
            setDump({ path });
            post<UtilWebviewMessage>({ type: "inspect", path });
        }
    };

    const objects = (): preact.JSX.Element => {
        if (dump === undefined || (dump.info === undefined
            && dump.error === undefined)) {
            return (
                <p class="message">
                    {path === ""
                        ? "Choose the dump to load."
                        : "Reading what the dump holds..."}
                </p>
            );
        }
        if (loadProblem !== undefined || dump.info === undefined) {
            return <p class="message error dump-problem">{loadProblem}</p>;
        }

        return (
            <DumpObjects
                // Another dump starts with its rows closed again.
                key={dump.info.url}
                info={dump.info}
                intoSchema={spec.intoSchema}
                excluded={excluded}
                disabled={busy}
                onChange={(next) => {
                    setExcluded(next);
                    setStartError(undefined);
                }}
                onComplete={(schema) => {
                    post<UtilWebviewMessage>({ type: "inspectSchema", schema });
                }}
            />
        );
    };

    const input = (option: IUtilOptionSpec): preact.JSX.Element => {
        const invalid = problem?.field === option.name;

        if (option.type === "choice") {
            return (
                <select
                    name={option.name}
                    value={String(values[option.name])}
                    disabled={busy}
                    onChange={(event) => {
                        update(option.name,
                            (event.target as HTMLSelectElement).value);
                    }}
                >
                    {(option.choices ?? []).map((choice) => {
                        return <option key={choice} value={choice}>{choice}</option>;
                    })}
                </select>
            );
        }

        return (
            <input
                type="text"
                name={option.name}
                class={invalid ? "invalid" : undefined}
                aria-invalid={invalid}
                value={String(values[option.name] ?? "")}
                spellcheck={false}
                disabled={busy}
                onInput={(event) => {
                    update(option.name,
                        (event.target as HTMLInputElement).value);
                }}
            />
        );
    };

    const options = (advanced: boolean): preact.JSX.Element => {
        const shown = spec.options.filter((option) => {
            return (option.advanced === true) === advanced;
        });
        const fields = shown.filter((option) => { return option.type !== "bool"; });
        const boxes = shown.filter((option) => { return option.type === "bool"; });

        return (
            <section class="grid">
                {fields.map((option) => {
                    return (
                        <Field
                            key={option.name}
                            caption={option.label}
                            hint={hintOf(option.name, option.hint)}
                        >
                            {input(option)}
                        </Field>
                    );
                })}
                {boxes.length === 0 ? null : (
                    <div class="group flags">
                        {boxes.map((option) => {
                            return (
                                <label
                                    key={option.name}
                                    class="checkbox"
                                    data-tooltip={option.hint}
                                >
                                    <input
                                        type="checkbox"
                                        name={option.name}
                                        checked={values[option.name] === true}
                                        disabled={busy}
                                        onChange={(event) => {
                                            update(option.name, (event.target as
                                                HTMLInputElement).checked);
                                        }}
                                    />
                                    <span>{option.label}</span>
                                    {problem?.field === option.name ? (
                                        <span class="field-hint field-problem">
                                            {problem.message}
                                        </span>
                                    ) : null}
                                </label>
                            );
                        })}
                    </div>
                )}
            </section>
        );
    };

    const hasAdvanced = spec.options.some((option) => {
        return option.advanced === true;
    });
    const tabs = inspects ? LOAD_TABS : TABS;

    return (
        <div class="editor">
            <header class="editor-header">
                <h1>{spec.title}</h1>
                <p class="editor-description">{spec.description}</p>
            </header>

            <section class="grid util-where">
                {spec.path === undefined ? null : (
                    <Field
                        caption={pathSpec?.label ?? ""}
                        hint={hintOf("path", pathSpec?.hint ?? "")}
                    >
                        <div class="row path-row">
                            <input
                                type="text"
                                name="path"
                                class={problem?.field === "path" ? "invalid" : undefined}
                                aria-invalid={problem?.field === "path"}
                                value={String(values.path ?? "")}
                                spellcheck={false}
                                disabled={busy}
                                onInput={(event) => {
                                    update("path",
                                        (event.target as HTMLInputElement).value);
                                }}
                                onChange={inspectTyped}
                            />
                            <button
                                type="button"
                                disabled={busy}
                                onClick={(event) => {
                                    // Not the label's own click, which would
                                    // focus the input instead.
                                    event.preventDefault();
                                    post<UtilWebviewMessage>({
                                        type: "browse",
                                        current: String(values.path ?? ""),
                                        ...(zip ? { zip } : {}),
                                    });
                                }}
                            >
                                Browse...
                            </button>
                        </div>
                    </Field>
                )}
                {spec.target !== true ? null : (
                    <Field
                        caption="Target Connection"
                        hint={hintOf("target", targets.length === 0
                            ? "There is no other connection to copy to. "
                            + "Add one in the Connections view first."
                            : "The server to copy to.")}
                    >
                        <select
                            name="target"
                            class={problem?.field === "target" ? "invalid" : undefined}
                            value={String(values.target ?? "")}
                            disabled={busy}
                            onChange={(event) => {
                                update("target",
                                    (event.target as HTMLSelectElement).value);
                            }}
                        >
                            <option value="">Choose a connection</option>
                            {targets.map((target) => {
                                return (
                                    <option key={target.uri} value={target.uri}>
                                        {target.label}
                                    </option>
                                );
                            })}
                        </select>
                    </Field>
                )}
            </section>

            {inspects && dump?.info !== undefined ? (
                <section class="dump-summary">
                    {dumpSummary(dump.info).map((line) => {
                        return <p key={line}>{line}</p>;
                    })}
                </section>
            ) : null}

            {hasAdvanced || inspects ? (
                <TabStrip
                    tabs={tabs}
                    current={tab}
                    onSelect={(name) => { setTab(name); }}
                />
            ) : null}

            <TabBody>
                {inspects && tab === "Objects" ? objects()
                    : options(hasAdvanced && tab === "Advanced")}
            </TabBody>

            {busy ? (
                <div class="dialog-busy">
                    <p class="message">Starting...</p>
                    <div
                        class="progress"
                        role="progressbar"
                        aria-label="Starting..."
                    >
                        <div class="progress-bar" />
                    </div>
                </div>
            ) : null}
            {startError === undefined ? null : (
                <p class="message error">{startError}</p>
            )}

            <footer class="editor-footer">
                <span class="spacer" />
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                        post<UtilWebviewMessage>({ type: "cancel" });
                    }}
                >
                    Cancel
                </button>
                <button
                    type="button"
                    class="primary"
                    disabled={busy || !canLoad}
                    onClick={start}
                >
                    {spec.action}
                </button>
            </footer>
        </div>
    );
};
