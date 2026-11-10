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
    copyrightField,
    copyrightYears,
    CUSTOM_LICENSE,
    LICENSE_PLACEHOLDERS,
    currentYear,
    type IMsmCopyrightValues,
    type IMsmEditValues,
    msmProblem,
    nextPatchVersion,
    onlineAlterField,
    allTicked,
    liveNamesOf,
    projectFolderName,
    tickedObjects,
    type IMsmCreateValues,
    type IMsmDeployValues,
    type IMsmImportValues,
    type IMsmProblem,
    type IMsmProjectContext,
    type IMsmReleaseValues,
    type MsmDialogKind,
    type MsmValues,
} from "../../src/msm/msmFields.js";
import {
    IMPORTED_KINDS,
    liveObjectsOf,
    type ImportedKind,
} from "../../src/mcp/msmApi.js";
import type {
    IMsmLoadMessage,
    IMsmOpenMessage,
    MsmHostMessage,
    MsmWebviewMessage,
} from "../../src/msm/msmProtocol.js";
import {
    COUNT_KEYS,
    type CountKey,
    ONLINE_ALTER_HINTS,
    ONLINE_ALTER_LABELS,
    SIZE_EXAMPLES,
    type SizeKey,
    SIZE_KEYS,
    sizeText,
} from "../../src/tableEditor/onlineAlter.js";
import { newestFirst } from "../../src/versionOrder.js";
import {
    ColorSwatches,
    Field,
    ProgressBar,
    TabBody,
    TabStrip,
} from "./dialogParts.js";
import { post } from "./vscodeApi.js";

/**
 * The MariaDB Schema Management dialogs: New MSM Project, a project's
 * information, Prepare Release, Generate Deployment Script and Deploy
 * Schema. Which one it is, and what it starts with, comes from the
 * extension; the fields are checked here as they are typed, and again by
 * the extension.
 */

/**
 * What each dialog's main button says, and what it says while it works.
 * The project information has nothing to do: its one button is Close.
 */
const ACTIONS: Record<Exclude<MsmDialogKind, "info">, [string, string]> = {
    create: ["Create Project", "Creating the project..."],
    import: ["Create Project", "Starting the import..."],
    edit: ["Update", "Updating the project..."],
    release: ["Prepare Release", "Preparing the release..."],
    deploymentScript: ["Generate", "Generating the deployment script..."],
    deploy: ["Deploy", "Deploying the schema..."],
};

/** What each dialog is for, under its title. */
const DESCRIPTIONS: Record<MsmDialogKind, string> = {
    create: "Creates a schema project folder: the development script the "
        + "schema is written in, and the folders its releases and "
        + "deployment scripts go to.",
    import: "Creates a schema project from a schema on a server: the "
        + "CREATE statements of the objects chosen, without their DEFINER "
        + "clauses, the schema's name or AUTO_INCREMENT counters, so it "
        + "deploys anywhere. No data, users or grants.",
    edit: "Changes the version development goes on with, the project's "
        + "copyrights, how the MSM Projects view files and shows it, and how "
        + "its tables are altered online.",
    info: "What the project's files say about it.",
    release: "Writes the development script out as a released version, "
        + "with the update script from the version before, and moves "
        + "development on to the next version.",
    deploymentScript: "Writes the one script that deploys a released "
        + "version: creating the schema, or updating it from any earlier "
        + "version.",
    deploy: "Runs a deployment script on a server, creating the schema or "
        + "updating it to the version chosen.",
};

/**
 * The pages of the two dialogs too long for one: New MSM Project, a
 * wizard that leads through them with Back and Next, and Edit MSM
 * Project, as tabs. Each page's fields, so a problem can be shown on its
 * page.
 */
type MsmPage = "Schema Objects" | "Project" | "Copyright" | "Location"
    | "MSM Projects View" | "Online Schema Change";

/** The pages of each dialog that has them, in order. */
const PAGES: Partial<Record<MsmDialogKind, readonly MsmPage[]>> = {
    create: ["Project", "Location", "MSM Projects View"],
    import: ["Schema Objects", "Project", "Location", "MSM Projects View"],
    edit: ["Project", "Copyright", "MSM Projects View",
        "Online Schema Change"],
};

/** The dialogs that are wizards: Back, Next, and their button at the end. */
const WIZARDS: ReadonlySet<MsmDialogKind> = new Set(["create", "import"]);

/** The fields on each page. */
const PAGE_FIELDS: Record<MsmPage, readonly string[]> = {
    // Each kind's: `objects.tables`.
    "Schema Objects": ["objects"],
    Project: ["schemaName", "license", "customLicense", "copyrightHolder",
        "yearOfCreation",
        "allowSpecialChars", "developmentVersion"],
    // Each holder's fields: `copyrights.0.holder`.
    Copyright: ["copyrights"],
    Location: ["targetPath", "createTargetPath", "overwriteExisting"],
    "MSM Projects View": ["folder", "caption", "color", "mcpAccess"],
    // Each value's field: `onlineAlter.lockWait`.
    "Online Schema Change": ["onlineAlter"],
};

/** What each page holds, as its tab's tooltip. */
const PAGE_TOOLTIPS: Record<MsmPage, string> = {
    "Schema Objects": "The objects of the schema the project is made from.",
    Project: "The schema, its license and copyright, and its version.",
    Copyright: "Who holds the project's copyright, and the years its "
        + "notices name.",
    Location: "Where the project folder is created.",
    "MSM Projects View": "How the MSM Projects view files and shows the "
        + "project, and whether LLMs may work on it.",
    "Online Schema Change": "How deployments run the project's ALTER TABLE "
        + "statements: online, and within which limits.",
};


/**
 * @param kind The dialog.
 * @param field A field's name.
 *
 * @returns The index of its page among the dialog's, or -1 for none.
 */
const pageOf = (kind: MsmDialogKind | undefined, field: string | undefined,
): number => {
    return field === undefined ? -1 : (PAGES[kind ?? "info"] ?? []).findIndex(
        (page) => {
            return PAGE_FIELDS[page].some((name) => {
                return field === name || field.startsWith(`${name}.`);
            });
        });
};

/**
 * @param object An object or array.
 * @param path The keys down to a value: `copyrights`, `0`, `holder`.
 * @param value The value to put there.
 *
 * @returns A copy with it, each object on the way copied too.
 */
const withPath = (object: unknown, path: string[], value: unknown,
): unknown => {
    const [key, ...rest] = path;
    const at = rest.length === 0 ? value
        : withPath((object as Record<string, unknown>)[key], rest, value);
    if (Array.isArray(object)) {
        const copy = [...object] as unknown[];
        copy[Number(key)] = at;

        return copy;
    }

    return { ...(object as Record<string, unknown>), [key]: at };
};

export const MsmDialog = (): preact.JSX.Element => {
    // What the dialog is: set once, by the extension.
    const [load, setLoad] = useState<IMsmLoadMessage | undefined>();
    const [values, setValues] = useState<MsmValues>({} as MsmValues);
    // The fields typed into; every one once the button was pressed.
    const [touched, setTouched] = useState<Set<string>>(new Set());
    const [submitted, setSubmitted] = useState(false);
    // A problem the host found: shown until something is changed.
    const [hostProblem, setHostProblem] = useState<IMsmProblem | undefined>();
    const [busy, setBusy] = useState(false);
    // The page shown, of a dialog that has pages.
    const [page, setPage] = useState(0);

    useEffect(() => {
        const onMessage = (event: MessageEvent<MsmHostMessage>): void => {
            const message = event.data;
            switch (message.type) {
                case "load": {
                    setLoad(message);
                    setValues(message.values);
                    setTouched(new Set());
                    setSubmitted(false);
                    setHostProblem(undefined);
                    setPage(0);
                    break;
                }

                case "browsed": {
                    setValues((current) => {
                        return {
                            ...current, [message.field]: message.path,
                        } as MsmValues;
                    });
                    setTouched((current) => {
                        return new Set([...current, message.field]);
                    });
                    setHostProblem(undefined);
                    break;
                }

                case "error": {
                    setHostProblem(message);
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
        post<MsmWebviewMessage>({ type: "ready" });

        return () => { window.removeEventListener("message", onMessage); };
    }, []);

    // The host's problem is shown on its field's page: a wizard's last
    // page is not where the schema name is.
    useEffect(() => {
        const at = pageOf(load?.kind, hostProblem?.field);
        if (at !== -1) {
            setPage(at);
        }
    }, [hostProblem, load]);

    if (load === undefined) {
        return <div class="editor" />;
    }
    const { kind, title, project } = load;
    const licenses = load.licenses ?? [];
    const connections = load.connections ?? [];
    const folders = load.folders ?? [];

    // What the fields themselves get wrong: only that holds the button
    // back, as what the host said may be gone on a second try.
    const fieldProblem = msmProblem(kind, project, values);
    const problem = hostProblem ?? fieldProblem;
    // A problem with no field is the dialog's: shown at once, as there
    // is nothing to type that would mend it.
    const shownProblem = problem !== undefined && (problem.field === undefined
        || submitted || touched.has(problem.field)) ? problem : undefined;

    const update = (name: string, value: unknown): void => {
        setValues((current) => {
            const next = withPath(current, name.split("."),
                value) as MsmValues;
            const release = current as IMsmReleaseValues;
            if (kind === "release" && name === "version"
                && release.nextVersion
                    === nextPatchVersion(release.version.trim())) {
                // The next version follows the released one while it is
                // the one after it, not one typed in.
                (next as IMsmReleaseValues).nextVersion =
                    nextPatchVersion(String(value).trim());
            }

            return next;
        });
        setTouched((current) => { return new Set([...current, name]); });
        setHostProblem(undefined);
    };

    const hint = (field: string, text: string): string => {
        return shownProblem?.field === field ? shownProblem.message : text;
    };

    const invalid = (name: string): boolean => {
        return shownProblem?.field === name;
    };

    /** A field's value, by its name. */
    const field = (name: string): unknown => {
        return name.split(".").reduce<unknown>((value, key) => {
            return (value as Record<string, unknown> | undefined)?.[key];
        }, values);
    };

    const cancel = (): void => {
        post<MsmWebviewMessage>({ type: "cancel" });
    };

    const pages = PAGES[kind];
    const isWizard = WIZARDS.has(kind);
    const lastPage = (pages?.length ?? 1) - 1;

    const submit = (): void => {
        setSubmitted(true);
        if (fieldProblem !== undefined) {
            // Shown on its page, which may not be the one showing.
            const at = pageOf(kind, fieldProblem.field);
            if (at !== -1) {
                setPage(at);
            }

            return;
        }
        post<MsmWebviewMessage>({ type: "submit", values });
    };

    /**
     * The wizard's Next: on to the next page, unless this page (or one
     * before it) has a problem, which is then shown. A problem further on
     * waits for its page: the checks run in the pages' order.
     */
    const next = (): void => {
        const at = pageOf(kind, fieldProblem?.field);
        if (fieldProblem?.field !== undefined && at !== -1 && at <= page) {
            const { field: name } = fieldProblem;
            setTouched((current) => { return new Set([...current, name]); });
            setPage(at);

            return;
        }
        setPage(Math.min(page + 1, lastPage));
    };

    const open = (what: IMsmOpenMessage["what"]): void => {
        post<MsmWebviewMessage>({ type: "open", what });
    };

    const text = (
        name: string,
        placeholder?: string,
        list?: string,
        off = false,
    ): preact.JSX.Element => {
        return (
            <input
                type="text"
                name={name}
                list={list}
                class={invalid(name) ? "invalid" : undefined}
                aria-invalid={invalid(name)}
                value={String(field(name) ?? "")}
                placeholder={placeholder}
                spellcheck={false}
                disabled={busy || off}
                onInput={(event) => {
                    update(name, (event.target as HTMLInputElement).value);
                }}
            />
        );
    };

    const box = (name: string, label: string,
        tooltip: string): preact.JSX.Element => {
        return (
            <label class="checkbox" data-tooltip={tooltip}>
                <input
                    type="checkbox"
                    name={name}
                    checked={field(name) === true}
                    disabled={busy}
                    onChange={(event) => {
                        update(name,
                            (event.target as HTMLInputElement).checked);
                    }}
                />
                <span>{label}</span>
            </label>
        );
    };

    const boxProblem = (name: string): preact.JSX.Element | null => {
        return shownProblem?.field === name ? (
                <p class="field-hint field-problem">{shownProblem.message}</p>
            ) : null;
    };

    const select = (name: string, choices: Array<[string, string]>,
        empty?: string, off = false): preact.JSX.Element => {
        return (
            <select
                name={name}
                class={invalid(name) ? "invalid" : undefined}
                aria-invalid={invalid(name)}
                value={String(field(name) ?? "")}
                disabled={busy || off}
                onChange={(event) => {
                    update(name, (event.target as HTMLSelectElement).value);
                }}
            >
                {empty === undefined ? null : <option value="">{empty}</option>}
                {choices.map(([value, label]) => {
                    return <option key={value} value={value}>{label}</option>;
                })}
            </select>
        );
    };

    const browse = (name: string): preact.JSX.Element => {
        return (
            <button
                type="button"
                disabled={busy}
                onClick={(event) => {
                    // Not the label's own click, which would focus the
                    // input instead.
                    event.preventDefault();
                    post<MsmWebviewMessage>({ type: "browse", field: name,
                        current: String(field(name) ?? "") });
                }}
            >
                Browse...
            </button>
        );
    };

    /** The MSM Projects list's settings, of New and Edit MSM Project. */
    const listSettings = (): preact.JSX.Element => {
        return (
            <section class="grid">
                <Field caption="Folder" hint={hint("folder",
                    "The folder of the view it is filed in; / is the top "
                    + "level.")}>
                    {text("folder", undefined, "msm-folders")}
                    <datalist id="msm-folders">
                        {folders.map((folder) => {
                            return <option key={folder} value={folder} />;
                        })}
                    </datalist>
                </Field>
                <Field caption="Caption" hint={hint("caption",
                    "Shown in place of the schema name; empty for none.")}>
                    {text("caption")}
                </Field>
                <ColorSwatches
                    id="msm-color-caption"
                    value={String(field("color") ?? "")}
                    disabled={busy}
                    hint="The color the MSM Projects view draws it in."
                    onPick={(color) => { update("color", color); }}
                />
                <div class="group flags">
                    {box("mcpAccess", "Allow MCP Access",
                        "Let LLMs work on the project through the MariaDB "
                        + "MCP server, as Copilot does. Off, only this "
                        + "extension can.")}
                </div>
            </section>
        );
    };

    /**
     * The license, of New and Edit MSM Project: a template, or Custom with
     * the text the project's scripts start with.
     */
    const licenseFields = (): preact.JSX.Element => {
        const custom = field("license") === CUSTOM_LICENSE;

        return (
            <>
                <Field caption="License" hint={custom
                    ? "The project's own license, the text below."
                    : "The license the project's scripts are put under."}>
                    {select("license", [...licenses.map(
                        (license): [string, string] => {
                            return [license, license];
                        }), [CUSTOM_LICENSE, "Custom"]])}
                </Field>
                {custom ? (
                    <div class="wide">
                        <Field caption="License Text" hint={hint(
                            "customLicense", "An SQL comment at the top of "
                            + "every script. msm fills in "
                            + LICENSE_PLACEHOLDERS.map((name) => {
                                return `\${${name}}`;
                            }).join(", ") + "; $$ is a $.")}>
                            <textarea
                                name="customLicense"
                                class={`msm-license${invalid("customLicense")
                                    ? " invalid" : ""}`}
                                aria-invalid={invalid("customLicense")}
                                rows={8}
                                spellcheck={false}
                                disabled={busy}
                                value={String(field("customLicense") ?? "")}
                                onInput={(event) => {
                                    update("customLicense",
                                        event.currentTarget.value);
                                }}
                            />
                        </Field>
                    </div>
                ) : null}
            </>
        );
    };

    /** New MSM Project's first page: the schema and whose it is. */
    const createProject = (): preact.JSX.Element => {
        const create = values as IMsmCreateValues;
        // From Schema: the schema's own name, which msm takes as it is.
        const imported = kind === "import";
        const folder = create.schemaName.trim() === ""
            ? "<schema>.msm.project"
            : projectFolderName(create.schemaName);

        return (
            <section class="grid">
                <Field caption="Schema Name" hint={hint("schemaName",
                    imported
                        ? `The schema's own name. The project folder is `
                            + `${folder}.`
                        : `The project folder is ${folder}.`)}>
                    {text("schemaName", "sakila", undefined, imported)}
                </Field>
                {licenseFields()}
                <Field caption="Copyright Holder" hint={hint(
                    "copyrightHolder", "Your name, or your company's: "
                    + "written into every script's header.")}>
                    {text("copyrightHolder")}
                </Field>
                <Field caption="Year of Creation" hint={hint(
                    "yearOfCreation", "The first year the copyright "
                    + "notices name: an earlier one for work begun before.")}>
                    {text("yearOfCreation", currentYear())}
                </Field>
                {imported ? null : (
                    <div class="group flags">
                        {box("allowSpecialChars",
                            "Allow Special Characters",
                            "Allow a schema name that has to be quoted.")}
                    </div>
                )}
            </section>
        );
    };

    /**
     * New MSM Project from Schema's first page: the schema's objects by
     * kind, each ticked to be imported; a table's triggers are named under
     * it, coming with it.
     */
    const schemaObjects = (): preact.JSX.Element => {
        const live = load.liveSchema;
        if (live === undefined) {
            return <section />;
        }
        const ticked = (values as IMsmImportValues).objects;
        const tick = (objectKind: ImportedKind, names: readonly string[],
            on: boolean): void => {
            update("objects", tickedObjects(live, ticked, objectKind, names,
                on));
        };
        const tickBox = (name: string, checked: boolean, label: string,
            onTick: (on: boolean) => void, value?: string,
            tooltip?: string, some = false): preact.JSX.Element => {
            return (
                <label class="checkbox" data-tooltip={tooltip}>
                    <input
                        type="checkbox"
                        name={name}
                        value={value}
                        checked={checked}
                        // A kind some of whose objects are ticked: neither.
                        ref={(element) => {
                            if (element !== null) {
                                element.indeterminate = some;
                            }
                        }}
                        disabled={busy}
                        onChange={(event) => {
                            onTick(event.currentTarget.checked);
                        }}
                    />
                    <span>{label}</span>
                </label>
            );
        };
        const kinds = IMPORTED_KINDS.filter((objectKind) => {
            return live[objectKind].length > 0;
        });

        return (
            <section class="msm-objects">
                <p class="note">
                    {`Schema ${live.schema} on ${load.source ?? "the server"}`}
                    {live.schema_version === null ? "."
                        : `, deployed by msm at version ${live.schema_version}.`}
                </p>
                {kinds.length === 0 ? (
                    <p class="note">The schema has no objects to import.</p>
                ) : kinds.map((objectKind) => {
                    const objects = liveObjectsOf(live, objectKind);
                    const on = new Set(ticked[objectKind]);
                    const name = `objects.${objectKind}`;

                    return (
                        <fieldset key={objectKind} class="msm-object-kind"
                            name={name}>
                            <legend>
                                {tickBox(`${name}.all`,
                                    allTicked(live, ticked, objectKind),
                                    `${KIND_CAPTIONS[objectKind]} `
                                        + `(${String(objects.length)})`,
                                    (all) => {
                                        tick(objectKind,
                                            liveNamesOf(live, objectKind), all);
                                    }, undefined, undefined,
                                    on.size > 0
                                        && !allTicked(live, ticked, objectKind))}
                            </legend>
                            <ul>
                                {objects.map((object) => {
                                    const triggers = object.triggers ?? [];

                                    return (
                                        <li key={object.name}>
                                            {tickBox(name, on.has(object.name),
                                                object.name, (one) => {
                                                    tick(objectKind,
                                                        [object.name], one);
                                                }, object.name,
                                                object.comment || undefined)}
                                            {triggers.length > 0 && (
                                                <span class="field-hint msm-triggers">
                                                    {"Triggers, with the "
                                                        + "table: "
                                                        + triggers.join(", ")}
                                                </span>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        </fieldset>
                    );
                })}
                {boxProblem("objects")}
                {live.left_out.length > 0 && (
                    <p class="field-hint">
                        {"Left out, as msm's own: "
                            + live.left_out.join(", ") + "."}
                    </p>
                )}
            </section>
        );
    };

    /** New MSM Project's second page: where the folder is created. */
    const createLocation = (): preact.JSX.Element => {
        return (
            <section class="grid">
                <div class="wide">
                    <Field caption="Create In" hint={hint(
                        "targetPath",
                        "The folder the project folder is created in.",
                    )}>
                        <div class="row path-row">
                            {text("targetPath")}
                            {browse("targetPath")}
                        </div>
                    </Field>
                </div>
                <div class="group flags">
                    {box("createTargetPath", "Create the Folder",
                        "Create the folder above where it does not "
                        + "exist yet.")}
                    {box("overwriteExisting",
                        "Replace Existing Project",
                        "Delete a project folder of the same name "
                        + "first.")}
                </div>
            </section>
        );
    };

    /** Edit MSM Project's first tab: the project, and its version. */
    const editProject = (): preact.JSX.Element => {
        const last = project?.lastReleasedVersion;
        const rows: Array<[string, string]> = project === undefined
            ? [] : [
                ["Schema", project.schemaName],
            ];

        return (
            <section class="grid">
                {summary(project)}
                <div class="wide msm-info">{infoRows(rows)}</div>
                <Field caption="Development Version" hint={hint(
                    "developmentVersion", last === undefined
                        ? "The version the development script is for."
                        : `The last release was ${last}.`)}>
                    {text("developmentVersion")}
                </Field>
                {licenseFields()}
            </section>
        );
    };

    /**
     * Edit MSM Project's Online Schema Change tab: the project's general
     * online ALTER TABLE values, which a table's own take precedence over.
     */
    const onlineAlterSettings = (): preact.JSX.Element => {
        const online = load.onlineAlter;
        if (online === undefined) {
            return (
                <section class="grid">
                    <p class="wide message error">{load.onlineAlterProblem
                        ?? "The project's online ALTER TABLE settings could "
                        + "not be read."}</p>
                </section>
            );
        }
        const { defaults } = online;
        const name = onlineAlterField;
        const enabled = field(name("enabled")) !== "off";
        const input = (key: SizeKey | CountKey,
            placeholder: string): preact.JSX.Element => {
            return (
                <Field caption={ONLINE_ALTER_LABELS[key]}
                hint={hint(name(key), ONLINE_ALTER_HINTS[key])}>
                    {/* Off, a field msm refuses still holds Update back:
                        it stays open to be mended. */}
                    {text(name(key), placeholder, undefined,
                        !enabled && !invalid(name(key)))}
                </Field>
            );
        };
        const tables = online.tables;

        return (
            <section class="grid">
                <p class="wide field-hint">
                    {"msm runs each ALTER TABLE of a deployment the least "
                        + "disruptive way the server accepts: ALGORITHM="
                        + "INSTANT, then NOCOPY, INPLACE and COPY with "
                        + "LOCK=NONE, then a Galera NBO where allowed, then "
                        + "LOCK=SHARED and LOCK=EXCLUSIVE. These are the "
                        + "project's defaults; a field left empty takes "
                        + "msm's, shown in it. Sizes as "
                        + `${SIZE_EXAMPLES}.`}
                </p>
                <Field caption="Online ALTER TABLE"
                    hint={hint(name("enabled"), ONLINE_ALTER_HINTS.enabled)}>
                    {select(name("enabled"), [["on", "On"],
                        ["off", "Off: run as written"]],
                    "As msm's default (on)")}
                </Field>
                {SIZE_KEYS.map((key) => {
                    return input(key, sizeText(defaults[key]));
                })}
                <Field caption="Galera NBO Lock"
                    hint={hint(name("nboLock"), ONLINE_ALTER_HINTS.nboLock)}>
                    {select(name("nboLock"), [["off", "None"],
                        ["SHARED", "SHARED"], ["EXCLUSIVE", "EXCLUSIVE"]],
                    `As msm's default (${defaults.nboLock ?? "none"})`,
                    !enabled)}
                </Field>
                {COUNT_KEYS.map((key) => {
                    return input(key, String(defaults[key]));
                })}
                <p class="wide field-hint">
                    {tables.length === 0
                        ? "No table has settings of its own: all take these."
                        : `${tables.join(", ")} ${tables.length === 1
                            ? "has settings of its own"
                            : "have settings of their own"}, set on the `
                            + "table editor's Online Alter Table tab, which "
                            + "take precedence."}
                </p>
            </section>
        );
    };

    /**
     * Edit MSM Project's Copyright tab: each holder, with the years the
     * notices name. msm rewrites the development files' notices on
     * Update; released files keep theirs.
     */
    const copyrightSettings = (): preact.JSX.Element => {
        const copyrights = (values as IMsmEditValues).copyrights;
        const year = currentYear();
        const setCopyrights = (list: IMsmCopyrightValues[]): void => {
            update("copyrights", list);
        };
        const listProblem = pageOf(kind, shownProblem?.field)
            === PAGES.edit?.indexOf("Copyright") ? shownProblem : undefined;

        return (
            <section class="msm-copyrights">
                <div class="msm-copyright-grid" role="table">
                    <span class="field-caption">Holder</span>
                    <span class="field-caption">First Year</span>
                    <span class="field-caption">Last Year</span>
                    <span class="field-caption">Follows Updates</span>
                    <span />
                    {copyrights.map((copyright, index) => {
                        const name = (key: keyof IMsmCopyrightValues,
                        ): string => {
                            return copyrightField(index, key);
                        };

                        return [
                            <span key={`${index}-holder`}>
                                {text(name("holder"), "Your name, or your "
                                    + "company's")}
                            </span>,
                            <span key={`${index}-first`}>
                                {text(name("yearOfCreation"), year)}
                            </span>,
                            <span key={`${index}-last`}>
                                {/* What it becomes when left empty: msm
                                    moves a holder that follows updates on
                                    to this year with the change. */}
                                {text(name("yearOfLastUpdate"),
                                    copyright.tracksUpdates ? year
                                        : copyright.yearOfCreation)}
                            </span>,
                            <span key={`${index}-tracks`}>
                                {box(name("tracksUpdates"), "",
                                    "msm moves the last year on with the "
                                    + "first change of each new year.")}
                            </span>,
                            <button key={`${index}-remove`} type="button"
                                disabled={busy || copyrights.length === 1}
                                title={`Remove ${copyright.holder || "the "
                                    + "holder"}`}
                                onClick={() => {
                                    setCopyrights(copyrights.filter((_, at) => {
                                        return at !== index;
                                    }));
                                }}>
                                Remove
                            </button>,
                        ];
                    })}
                </div>
                {listProblem === undefined ? null : (
                    <p class="field-hint field-problem">
                        {listProblem.message}
                    </p>
                )}
                <div class="row">
                    <button type="button" disabled={busy} onClick={() => {
                        setCopyrights([...copyrights, { holder: "",
                            yearOfCreation: year,
                            yearOfLastUpdate: "", tracksUpdates: true }]);
                    }}>
                        Add Holder
                    </button>
                </div>
                <p class="field-hint">
                    {"Each notice reads Copyright (c) <first year>, <last "
                        + "year>, <holder>; the last year is left out where "
                        + "it is empty or the same. On Update, msm rewrites "
                        + "the notices of the development files; released "
                        + "files keep theirs."}
                </p>
            </section>
        );
    };

    /** The page showing, of a dialog that has pages. */
    const pageBody = (): preact.JSX.Element => {
        switch (pages?.[page]) {
            case "Location": {
                return createLocation();
            }

            case "MSM Projects View": {
                return listSettings();
            }
            case "Schema Objects": {
                return schemaObjects();
            }
            case "Online Schema Change": {
                return onlineAlterSettings();
            }
            case "Copyright": {
                return copyrightSettings();
            }

            default: {
                return kind === "edit" ? editProject() : createProject();
            }
        }
    };

    const body = (): preact.JSX.Element => {
        switch (kind) {
            case "create":
            case "import":
            case "edit": {
                return pageBody();
            }

            case "info": {
                return info();
            }

            case "release": {
                const last = project?.lastReleasedVersion;

                return (
                    <section class="grid">
                        {summary(project)}
                        <Field caption="Version to Release" hint={hint(
                            "version", last === undefined
                                ? "The first release of the schema."
                                : `The last release was ${last}.`)}>
                            {text("version")}
                        </Field>
                        <Field caption="Next Development Version" hint={hint(
                            "nextVersion", "The version development goes on "
                            + "with.")}>
                            {text("nextVersion")}
                        </Field>
                        <div class="group flags">
                            {box("allowToStayOnSameVersion",
                                "Stay on the Same Version",
                                "Go on developing the version released, "
                                + "rather than the next one.")}
                            {box("overwriteExisting", "Replace Existing Files",
                                "Release a version again that has been "
                                + "released already.")}
                            {boxProblem("overwriteExisting")}
                        </div>
                    </section>
                );
            }

            case "deploymentScript": {
                const released = newestFirst(project?.releasedVersions ?? []);
                const scripts = project?.deploymentScriptVersions ?? [];

                return (
                    <section class="grid">
                        {summary(project)}
                        <Field caption="Version" hint={hint("version",
                            "The released version to deploy.")}>
                            {select("version", released.map((version) => {
                                return [version, scripts.includes(version)
                                    ? `${version} (has a deployment script)`
                                    : version];
                            }))}
                        </Field>
                        <div class="group flags">
                            {box("overwriteExisting", "Replace Existing File",
                                "Generate a deployment script again that "
                                + "exists already.")}
                            {boxProblem("overwriteExisting")}
                        </div>
                    </section>
                );
            }

            default: {
                const deploy = values as IMsmDeployValues;
                const scripts = newestFirst(
                    project?.deploymentScriptVersions ?? []);

                return (
                    <section class="grid">
                        {summary(project)}
                        <Field caption="Connection" hint={hint("connection",
                            connections.length === 0
                                ? "There is no connection. Add one in the "
                                + "Connections view first."
                                : "The server to deploy onto.")}>
                            {select("connection", connections.map((choice) => {
                                return [choice.uri, choice.label];
                            }), "Choose a connection")}
                        </Field>
                        <Field caption="Version" hint={hint("version",
                            "The version to deploy, from its deployment "
                            + "script.")}>
                            {select("version", scripts.map((version) => {
                                return [version, version];
                            }))}
                        </Field>
                        <div class="group flags">
                            {box("backup", "Back Up the Schema First",
                                "Dump an existing schema before updating it, "
                                + "and load it back should the update fail.")}
                        </div>
                        {deploy.backup ? (
                            <div class="wide">
                                <Field caption="Backup Folder" hint={hint(
                                    "backupDirectory", "Left empty, the "
                                    + "project's backups folder.")}>
                                    <div class="row path-row">
                                        {text("backupDirectory")}
                                        {browse("backupDirectory")}
                                    </div>
                                </Field>
                            </div>
                        ) : null}
                    </section>
                );
            }
        }
    };

    const info = (): preact.JSX.Element => {
        const shown = project;
        if (shown === undefined) {
            return <section />;
        }
        const released = newestFirst(shown.releasedVersions);
        const scripts = newestFirst(shown.deploymentScriptVersions);
        const rows: Array<[string, string]> = [
            ["Schema", shown.schemaName],
            ["Project Folder", shown.projectPath],
            ["License", shown.license],
            ["Copyright", shown.copyrights.map((copyright) => {
                return `${copyright.holder} (${copyrightYears(copyright)})`;
            }).join("; ") || "None"],
            ["Development Version", shown.currentDevelopmentVersion],
            ["Last Release", shown.lastReleasedVersion ?? "Not released yet"],
            ["Released Versions", released.join(", ") || "None"],
            ["Deployment Scripts", scripts.join(", ") || "None"],
        ];

        return (
            <section class="msm-info">
                {infoRows(rows)}
                <div class="row wrap">
                    <button type="button" onClick={() => {
                        open("developmentFile");
                    }}>
                        Open Development Script
                    </button>
                    <button type="button" onClick={() => { open("release"); }}>
                        Prepare Release...
                    </button>
                    <button
                        type="button"
                        disabled={released.length === 0}
                        title={released.length === 0
                            ? "No version has been released yet." : undefined}
                        onClick={() => { open("deploymentScript"); }}
                    >
                        Generate Deployment Script...
                    </button>
                    <button
                        type="button"
                        disabled={scripts.length === 0}
                        title={scripts.length === 0
                            ? "There is no deployment script yet." : undefined}
                        onClick={() => { open("deploy"); }}
                    >
                        Deploy Schema...
                    </button>
                </div>
            </section>
        );
    };

    const dialogProblem = shownProblem?.field === undefined
        ? shownProblem : undefined;

    return (
        <div class="editor">
            <header class="editor-header">
                <h1>{title}</h1>
                <p class="editor-description">{DESCRIPTIONS[kind]}</p>
            </header>

            {pages === undefined ? body() : (
                <>
                    {isWizard ? (
                        <ol class="wizard-steps">
                            {pages.map((name, index) => {
                                return (
                                    <li
                                        key={name}
                                        class={index === page ? "current"
                                            : index < page ? "done" : ""}
                                        aria-current={index === page
                                            ? "step" : undefined}
                                    >
                                        {/* Back to a page done, never on
                                            past Next's checks. */}
                                        {index < page ? (
                                            <button
                                                type="button"
                                                class="wizard-step"
                                                disabled={busy}
                                                onClick={() => {
                                                    setPage(index);
                                                }}
                                            >
                                                {name}
                                            </button>
                                        ) : name}
                                    </li>
                                );
                            })}
                        </ol>
                    ) : (
                        <TabStrip
                            tabs={pages}
                            current={pages[page]}
                            tooltips={PAGE_TOOLTIPS}
                            onSelect={(name) => {
                                setPage(pages.indexOf(name));
                            }}
                        />
                    )}
                    <TabBody>{body()}</TabBody>
                </>
            )}

            {busy && kind !== "info"
                ? <ProgressBar label={ACTIONS[kind][1]} /> : null}
            {dialogProblem === undefined ? null : (
                <p class="message error">{dialogProblem.message}</p>
            )}

            <footer class="editor-footer">
                <span class="spacer" />
                {kind === "info" ? (
                    <button type="button" class="primary" onClick={cancel}>
                        Close
                    </button>
                ) : (
                    <>
                        <button type="button" disabled={busy} onClick={cancel}>
                            Cancel
                        </button>
                        {isWizard ? (
                            <button
                                type="button"
                                disabled={busy || page === 0}
                                onClick={() => {
                                    setPage(Math.max(page - 1, 0));
                                }}
                            >
                                Back
                            </button>
                        ) : null}
                        {isWizard && page < lastPage ? (
                            <button
                                key="next"
                                type="button"
                                class="primary"
                                disabled={busy}
                                onClick={next}
                            >
                                Next
                            </button>
                        ) : (
                            <button
                                // Not Next's element: a double click on
                                // Next must not create the project.
                                key="submit"
                                type="button"
                                class="primary"
                                disabled={busy
                                    || (submitted
                                        && fieldProblem !== undefined)}
                                title={submitted && fieldProblem !== undefined
                                    ? fieldProblem.message : undefined}
                                onClick={submit}
                            >
                                {ACTIONS[kind][0]}
                            </button>
                        )}
                    </>
                )}
            </footer>
        </div>
    );
};

/**
 * @param rows Each fact of a project, by its caption.
 *
 * @returns Them as a list of captions and values.
 */
const infoRows = (rows: Array<[string, string]>): preact.JSX.Element => {
    return (
        <dl>
            {rows.map(([caption, value]) => {
                return (
                    <div key={caption} class="msm-info-row">
                        <dt>{caption}</dt>
                        <dd>{value}</dd>
                    </div>
                );
            })}
        </dl>
    );
};

/**
 * @param project The project.
 *
 * @returns The line on top of a project's dialog: which project, and
 *          where its development stands.
 */
const summary = (
    project: IMsmProjectContext | undefined,
): preact.JSX.Element | null => {
    if (project === undefined) {
        return null;
    }

    return (
        <p class="note wide msm-summary">
            <code>{project.projectPath}</code>
            <span>
                {`Development version ${project.currentDevelopmentVersion}`}
                {project.lastReleasedVersion === undefined
                    ? ", not released yet."
                    : `, last released ${project.lastReleasedVersion}.`}
            </span>
        </p>
    );
};

/** Each kind's caption on the Schema Objects page. */
const KIND_CAPTIONS: Record<ImportedKind, string> = {
    tables: "Tables",
    sequences: "Sequences",
    views: "Views",
    procedures: "Procedures",
    functions: "Functions",
    events: "Events",
};
