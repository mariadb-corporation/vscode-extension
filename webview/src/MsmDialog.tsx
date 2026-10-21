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
    msmProblem,
    nextPatchVersion,
    projectFolderName,
    type IMsmCreateValues,
    type IMsmDeployValues,
    type IMsmProblem,
    type IMsmProjectContext,
    type IMsmReleaseValues,
    type MsmDialogKind,
    type MsmValues,
} from "../../src/msm/msmFields.js";
import type {
    IMsmLoadMessage,
    IMsmOpenMessage,
    MsmHostMessage,
    MsmWebviewMessage,
} from "../../src/msm/msmProtocol.js";
import { newestFirst } from "../../src/versionOrder.js";
import { Field, ProgressBar } from "./dialogParts.js";
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
    create: ["Create", "Creating the project..."],
    release: ["Prepare Release", "Preparing the release..."],
    deploymentScript: ["Generate", "Generating the deployment script..."],
    deploy: ["Deploy", "Deploying the schema..."],
};

/** What each dialog is for, under its title. */
const DESCRIPTIONS: Record<MsmDialogKind, string> = {
    create: "Creates a schema project folder: the development script the "
        + "schema is written in, and the folders its releases and "
        + "deployment scripts go to.",
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

    if (load === undefined) {
        return <div class="editor" />;
    }
    const { kind, title, project } = load;
    const licenses = load.licenses ?? [];
    const connections = load.connections ?? [];

    // What the fields themselves get wrong: only that holds the button
    // back, as what the host said may be gone on a second try.
    const fieldProblem = msmProblem(kind, project, values);
    const problem = hostProblem ?? fieldProblem;
    // A problem with no field is the dialog's: shown at once, as there
    // is nothing to type that would mend it.
    const shownProblem = problem !== undefined && (problem.field === undefined
        || submitted || touched.has(problem.field)) ? problem : undefined;

    const update = (name: string, value: boolean | string): void => {
        setValues((current) => {
            const next = { ...current, [name]: value } as MsmValues;
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
        return (values as unknown as Record<string, unknown>)[name];
    };

    const cancel = (): void => {
        post<MsmWebviewMessage>({ type: "cancel" });
    };

    const submit = (): void => {
        setSubmitted(true);
        if (fieldProblem !== undefined) {
            return;
        }
        post<MsmWebviewMessage>({ type: "submit", values });
    };

    const open = (what: IMsmOpenMessage["what"]): void => {
        post<MsmWebviewMessage>({ type: "open", what });
    };

    const text = (name: string, placeholder?: string): preact.JSX.Element => {
        return (
            <input
                type="text"
                name={name}
                class={invalid(name) ? "invalid" : undefined}
                aria-invalid={invalid(name)}
                value={String(field(name) ?? "")}
                placeholder={placeholder}
                spellcheck={false}
                disabled={busy}
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
        empty?: string): preact.JSX.Element => {
        return (
            <select
                name={name}
                class={invalid(name) ? "invalid" : undefined}
                aria-invalid={invalid(name)}
                value={String(field(name) ?? "")}
                disabled={busy}
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

    const body = (): preact.JSX.Element => {
        switch (kind) {
            case "create": {
                const create = values as IMsmCreateValues;
                const folder = create.schemaName.trim() === ""
                    ? "<schema>.msm.project"
                    : projectFolderName(create.schemaName);

                return (
                    <section class="grid">
                        <Field caption="Schema Name" hint={hint("schemaName",
                            `The project folder is ${folder}.`)}>
                            {text("schemaName", "sakila")}
                        </Field>
                        <Field caption="License" hint={"The license the "
                            + "project's scripts are put under."}>
                            {select("license", licenses.map((license) => {
                                return [license, license];
                            }))}
                        </Field>
                        <Field caption="Copyright Holder" hint={hint(
                            "copyrightHolder", "Your name, or your company's: "
                            + "written into every script's header.")}>
                            {text("copyrightHolder")}
                        </Field>
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
                            {box("allowSpecialChars",
                                "Allow Special Characters",
                                "Allow a schema name that has to be quoted.")}
                            {box("overwriteExisting",
                                "Replace Existing Project",
                                "Delete a project folder of the same name "
                                + "first.")}
                        </div>
                    </section>
                );
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
            ["Copyright", shown.copyrightHolders.join(", ") || "None"],
            ["Development Version", shown.currentDevelopmentVersion],
            ["Last Release", shown.lastReleasedVersion ?? "Not released yet"],
            ["Released Versions", released.join(", ") || "None"],
            ["Deployment Scripts", scripts.join(", ") || "None"],
        ];

        return (
            <section class="msm-info">
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

            {body()}

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
                        <button
                            type="button"
                            class="primary"
                            disabled={busy
                                || (submitted && fieldProblem !== undefined)}
                            title={submitted && fieldProblem !== undefined
                                ? fieldProblem.message : undefined}
                            onClick={submit}
                        >
                            {ACTIONS[kind][0]}
                        </button>
                    </>
                )}
            </footer>
        </div>
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
