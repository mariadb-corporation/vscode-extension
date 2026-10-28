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

import {
    DEPLOYMENT_STARTS,
    DEPLOYMENT_TYPES,
    type DeploymentStart,
    type DeploymentType,
    type IDeploymentChoice,
} from "../../src/deployments/deploymentChoices.js";
import type { DeploymentWebviewMessage }
    from "../../src/deployments/deploymentProtocol.js";
import { post } from "./vscodeApi.js";

/**
 * The New Deployment wizard: a page per question, Back and Next at the
 * foot. The first page asks whether to create a deployment or import one,
 * the second what to create. The third step, Deploy, is listed but is not
 * a page here: the second page's Next hands on to the dialog of the
 * deployment picked - New Sandbox, so far - which the host opens in the
 * wizard's place.
 */

/** The wizard's pages, in order. */
type Page = "start" | "type";

/** What each page is headed. */
const PAGE_TITLES: Record<Page, string> = {
    start: "What would you like to do?",
    type: "Which kind of deployment?",
};

/**
 * One page's options, as a group of radio buttons drawn as cards. An
 * option the wizard cannot go on from yet is shown, disabled, so the way
 * the wizard is going is plain.
 */
const Choices = <T extends string>({ name, choices, value, onChange }: {
    name: string;
    choices: Array<IDeploymentChoice<T>>;
    value: T;
    onChange: (value: T) => void;
}): preact.JSX.Element => {
    return (
        <div class="wizard-choices" role="radiogroup">
            {choices.map((choice) => {
                return (
                    <label
                        key={choice.value}
                        class={"wizard-choice"
                            + (choice.value === value ? " selected" : "")
                            + (choice.available ? "" : " unavailable")}
                    >
                        <input
                            type="radio"
                            name={name}
                            value={choice.value}
                            checked={choice.value === value}
                            disabled={!choice.available}
                            onChange={() => { onChange(choice.value); }}
                        />
                        <span class={"codicon" in choice.icon
                            ? `codicon codicon-${choice.icon.codicon}`
                            : `wizard-image wizard-image-${choice.icon.image}`}
                        />
                        <span class="wizard-choice-text">
                            <span class="wizard-choice-label">
                                {choice.label}
                                {choice.available ? null : (
                                    <span class="wizard-soon">
                                        Not available yet
                                    </span>
                                )}
                            </span>
                            <span class="wizard-choice-description">
                                {choice.description}
                            </span>
                        </span>
                    </label>
                );
            })}
        </div>
    );
};

export const DeploymentWizard = (): preact.JSX.Element => {
    const [page, setPage] = useState<Page>("start");
    const [start, setStart] = useState<DeploymentStart>("new");
    const [type, setType] = useState<DeploymentType>("sandbox");

    const next = (): void => {
        if (page === "start") {
            setPage("type");

            return;
        }

        post<DeploymentWebviewMessage>({ type: "new", deploymentType: type });
    };

    return (
        <div class="editor">
            <header class="editor-header">
                <h1>New Deployment</h1>
                <p class="editor-description">
                    A MariaDB deployment to manage from the MariaDB
                    Deployments view.
                </p>
            </header>

            <ol class="wizard-steps">
                <li class={page === "start" ? "current" : "done"}>Start</li>
                <li class={page === "type" ? "current" : ""}>
                    Deployment Type
                </li>
                {/* The deployment's own dialog, once the wizard hands on. */}
                <li>Deploy</li>
            </ol>

            <section class="wizard-page">
                <h2>{PAGE_TITLES[page]}</h2>
                {page === "start" ? (
                    <Choices
                        name="start"
                        choices={DEPLOYMENT_STARTS}
                        value={start}
                        onChange={setStart}
                    />
                ) : (
                    <Choices
                        name="deploymentType"
                        choices={DEPLOYMENT_TYPES}
                        value={type}
                        onChange={setType}
                    />
                )}
            </section>

            <footer class="editor-footer">
                <span class="spacer" />
                <button
                    type="button"
                    onClick={() => {
                        post<DeploymentWebviewMessage>({ type: "cancel" });
                    }}
                >
                    Cancel
                </button>
                <button
                    type="button"
                    disabled={page === "start"}
                    onClick={() => { setPage("start"); }}
                >
                    Back
                </button>
                <button type="button" class="primary" onClick={next}>
                    Next
                </button>
            </footer>
        </div>
    );
};
