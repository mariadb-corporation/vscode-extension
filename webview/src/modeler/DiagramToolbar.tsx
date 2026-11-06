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

import type { JSX } from "preact";

import type { IDiagramTool, IToolPanel } from "./diagramTools.js";

/**
 * The diagram's tool palette: a floating vertical panel over the canvas's
 * top left corner, as the Navigator floats over its top right one, with
 * Workbench's tools in Workbench's groups. Each tool's tooltip names the
 * key that picks it.
 */

export interface IDiagramToolbarProps {
    /** The tools offered: the editing ones only where the diagram is. */
    tools: readonly IDiagramTool[];
    tool: string;
    onTool: (tool: string) => void;
    /** Whether the diagram is locked: then only the canvas's tools work. */
    locked: boolean;
}

/**
 * @param key A tool's key, as `KeyboardEvent.key` has it.
 *
 * @returns It as a tooltip names it.
 */
const keyName = (key: string): string => {
    return key === "Escape" ? "Esc" : key.toUpperCase();
};

export const DiagramToolbar = (props: IDiagramToolbarProps): JSX.Element => {
    const groups = [...new Set(props.tools.map((tool) => { return tool.group; }))];

    return <div className="diagramToolbar" role="toolbar"
        aria-label="Diagram Tools" aria-orientation="vertical">
        {groups.map((group, index) => {
            return <div key={group} className="diagramToolGroup">
                {index > 0 && <span className="diagramToolDivider" />}
                {props.tools.filter((tool) => {
                    return tool.group === group;
                }).map((tool) => {
                    const title = tool.key === undefined ? tool.title
                        : `${tool.title} (${keyName(tool.key)})`;

                    return <button
                        key={tool.id}
                        type="button"
                        className={`toolbarIcon diagramTool ${tool.icon}`
                            + (props.tool === tool.id ? " toggled" : "")}
                        title={title}
                        aria-label={title}
                        aria-pressed={props.tool === tool.id}
                        disabled={props.locked && tool.edits}
                        onClick={() => { props.onTool(tool.id); }}
                    />;
                })}
            </div>;
        })}
    </div>;
};

export interface IToolPanelProps {
    panel: IToolPanel;
    /** The panel's button: on to the referenced table's columns. */
    onPickReferenced: () => void;
}

/**
 * The panel "Place a Relationship Using Existing Columns" shows while its
 * columns are picked, as Workbench's floater does: the columns picked so
 * far, and the one whose referenced column is picked next.
 */
export const ToolPanel = (props: IToolPanelProps): JSX.Element => {
    const { panel } = props;

    return <div className="toolPanel" role="region" aria-label={panel.title}>
        <div className="toolPanelTitle">{panel.title}</div>
        <div className="toolPanelText">{panel.text}</div>
        {panel.columns.length > 0 && <ul className="toolPanelColumns">
            {panel.columns.map((column, index) => {
                return <li
                    key={index}
                    className={index === panel.current ? "current" : undefined}
                >{column}</li>;
            })}
        </ul>}
        {panel.button && <button type="button" className="toolPanelButton"
            onClick={props.onPickReferenced}>Pick Referenced Columns</button>}
    </div>;
};
