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
 * What the New Deployment wizard offers on each page. Pure, so the
 * webview and its host read the same list: the host refuses what the
 * list says is not available yet.
 */

/** What the first page asks: a new deployment, or one that exists. */
export type DeploymentStart = "new" | "import";

/** What the second page of a new deployment asks: what to deploy. */
export type DeploymentType = "sandbox" | "standalone" | "cluster";

/** One option of a page. */
export interface IDeploymentChoice<T extends string> {
    value: T;
    /** The option's caption. */
    label: string;
    /** What it does, under the caption. */
    description: string;
    /**
     * What it is drawn with: a codicon, without the `codicon-` prefix, or
     * the extension's own image, the `wizard-image-<image>` class of the
     * wizard's stylesheet.
     */
    icon: { codicon: string } | { image: string };
    /** False where the wizard cannot go on from it yet. */
    available: boolean;
}

/** The first page. */
export const DEPLOYMENT_STARTS: Array<IDeploymentChoice<DeploymentStart>> = [
    {
        value: "new",
        label: "Create a New Deployment",
        description: "Deploy a MariaDB server instance, a MariaDB Cluster "
            + "or a simple local MariaDB sandbox instance, and manage it "
            + "from here.",
        icon: { codicon: "add" },
        available: true,
    },
    {
        value: "import",
        label: "Import an Existing Deployment",
        description: "Manage a MariaDB deployment that is running already.",
        icon: { codicon: "cloud-download" },
        available: false,
    },
];

/** The second page of a new deployment. */
export const DEPLOYMENT_TYPES: Array<IDeploymentChoice<DeploymentType>> = [
    {
        value: "sandbox",
        label: "MariaDB Sandbox Instance",
        description: "A MariaDB server on this machine, in the default "
            + "sandbox directory, for development and trying things out.",
        icon: { codicon: "vm" },
        available: true,
    },
    {
        value: "standalone",
        label: "MariaDB Standalone Instance",
        description: "A single MariaDB server, set up to run on its own.",
        icon: { image: "standalone" },
        available: false,
    },
    {
        value: "cluster",
        label: "MariaDB Cluster",
        description: "Several MariaDB servers that replicate each other.",
        icon: { image: "cluster" },
        available: false,
    },
];

/**
 * @param choices A page's options.
 * @param value The one picked.
 *
 * @returns Whether the wizard can go on from it.
 */
export const isAvailable = <T extends string>(
    choices: Array<IDeploymentChoice<T>>,
    value: T,
): boolean => {
    return choices.some((choice) => {
        return choice.value === value && choice.available;
    });
};
