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
 * The diagram item selected, in Object Details: a table figure's or a
 * layer's place and size (X / Y / Z, W / H, and a figure's Auto, laid out
 * as a design tool's transform panel), a layer's tables, or a
 * relationship line's tables, kind (1:1 or 1:n, identifying or not: a
 * schema change), middle segment offset and split. Each field changes the diagram when it is committed:
 * Enter or leaving it; Escape puts back what it showed.
 */

import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import type {
    DiagramItem,
    DiagramItemChange,
    IDiagramConnectionItem,
    IDiagramFigureItem,
    IDiagramLayerItem,
    DockSide,
} from "../../../src/details/objectDetails.js";
import {
    FIGURE_PALETTE,
    LAYER_COLOR,
    paletteColorOf,
} from "../../../src/modeler/modelFormat.js";
import { ColorSwatches } from "../dialogParts.js";

/** Page units with one decimal at most, in the user's notation. */
const NUMBER_FORMAT = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    useGrouping: false,
});

/**
 * @param value A number of page units.
 *
 * @returns It as the field shows it.
 */
export const formatUnits = (value: number): string => {
    return NUMBER_FORMAT.format(value);
};

/**
 * @param text What was typed: a decimal point or comma, "px" or not.
 *
 * @returns The number, or nothing where it is none.
 */
export const parseUnits = (text: string): number | undefined => {
    const cleaned = text.trim().replace(/\s*px$/i, "").replace(",", ".");
    if (cleaned === "") {
        return undefined;
    }
    const value = Number(cleaned);

    return Number.isFinite(value) ? value : undefined;
};

interface INumberFieldProps {
    label: string;
    /** The accessible name, where the label is a letter. */
    title: string;
    value: number;
    readOnly: boolean;
    onCommit(value: number): void;
}

/** A label, a number input and its unit. */
const NumberField = ({ label, title, value, readOnly, onCommit }:
    INumberFieldProps): JSX.Element => {
    const shown = formatUnits(value);
    const [text, setText] = useState(shown);
    // What the diagram says wins over what was typed and not committed.
    useEffect(() => { setText(shown); }, [shown]);

    const commit = (): void => {
        const parsed = parseUnits(text);
        if (parsed === undefined || formatUnits(parsed) === shown) {
            setText(shown);

            return;
        }
        onCommit(parsed);
    };

    return <>
        <label className="itemLabel" title={title}>{label}:</label>
        <span className="itemInput">
            <input type="text" inputMode="decimal" value={text}
                aria-label={title} readOnly={readOnly}
                onInput={(event) => { setText(event.currentTarget.value); }}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === "Enter") {
                        commit();
                    } else if (event.key === "Escape") {
                        setText(shown);
                    }
                }} />
            <span className="itemUnit">px</span>
        </span>
    </>;
};

interface ICheckFieldProps {
    label: string;
    checked: boolean;
    readOnly: boolean;
    onChange(checked: boolean): void;
}

/** A checkbox and its label. */
const CheckField = ({ label, checked, readOnly, onChange }:
    ICheckFieldProps): JSX.Element => {
    return <label className="itemCheck">
        <input type="checkbox" checked={checked} disabled={readOnly}
            onChange={(event) => {
                const wanted = event.currentTarget.checked;
                // It shows what the diagram says: the change, once made;
                // nothing new where it is refused.
                event.currentTarget.checked = checked;
                onChange(wanted);
            }} />
        {label}
    </label>;
};

type ChangeItem = (change: DiagramItemChange) => void;

/** The sides, as the view names them. */
const SIDE_NAMES: Record<DockSide, string> = {
    left: "Left", right: "Right", top: "Top", bottom: "Bottom",
};

/**
 * A line's end placed by hand: its side, and a button that puts it back
 * on the automatic layout.
 */
const DockRow = ({ label, side, readOnly, onReset }: {
    label: string;
    side: DockSide;
    readOnly: boolean;
    onReset(): void;
}): JSX.Element => {
    return <tr>
        <th>{label}</th>
        <td className="itemDock">
            <span>{SIDE_NAMES[side]} side</span>
            <span className="detailsMuted">placed by hand</span>
            {readOnly ? null
                : <button type="button" className="itemReset"
                    title="Reset to the automatic layout"
                    aria-label={`Reset the ${label.toLowerCase()} to the `
                        + "automatic layout"}
                    onClick={onReset}>
                    <svg viewBox="0 0 16 16" width="14" height="14"
                        aria-hidden="true">
                        <g fill="none" stroke="currentColor"
                            stroke-width="1.3" stroke-linecap="round"
                            stroke-linejoin="round">
                            <path d="M3.5 8a4.5 4.5 0 1 0 1.3-3.2" />
                            <path d="M4.5 2v3h3" />
                        </g>
                    </svg>
                </button>}
        </td>
    </tr>;
};

/**
 * A table figure or a layer: X / W, Y / H, Z and a figure's Auto-Height
 * and Upright.
 */
const FigureFields = ({ item, change }: {
    item: IDiagramFigureItem | IDiagramLayerItem;
    change: ChangeItem;
}): JSX.Element => {
    const readOnly = !item.editable;

    return <section className="itemSection">
        <h3>Figure</h3>
        <div className="itemGrid">
            <NumberField label="X" title="X position" value={item.x}
                readOnly={readOnly} onCommit={(x) => { change({ x }); }} />
            <NumberField label="W" title="Width" value={item.width}
                readOnly={readOnly}
                onCommit={(width) => { change({ width }); }} />
            <NumberField label="Y" title="Y position" value={item.y}
                readOnly={readOnly} onCommit={(y) => { change({ y }); }} />
            <NumberField label="H" title="Height" value={item.height}
                readOnly={readOnly}
                onCommit={(height) => { change({ height }); }} />
            <NumberField label="Z" title={item.kind === "layer"
                ? "Elevation above the page" : "Elevation above its layer"}
                value={item.z} readOnly={readOnly}
                onCommit={(z) => { change({ z }); }} />
            {item.kind === "figure" ? <span className="itemCheckCell">
                <CheckField label="Auto-Height" checked={item.autoHeight}
                    readOnly={readOnly}
                    onChange={(autoHeight) => { change({ autoHeight }); }} />
            </span> : null}
            {/* Standing, H is how high; lying, how deep on the page. */}
            {item.kind === "figure" ? <span
                className="itemCheckCell itemCheckFollows">
                <CheckField label="Upright" checked={item.upright}
                    readOnly={readOnly}
                    onChange={(upright) => { change({ upright }); }} />
            </span> : null}
        </div>
        <FigureColor item={item} readOnly={readOnly} change={change} />
    </section>;
};

/**
 * A figure's or a layer's colour, as the editors' Color field offers one:
 * stored with the diagram. None is a figure's kind's colour, or a new
 * layer's.
 */
const FigureColor = ({ item, readOnly, change }: {
    item: IDiagramFigureItem | IDiagramLayerItem;
    readOnly: boolean;
    change: ChangeItem;
}): JSX.Element => {
    // A layer's default is a colour of its own, which None stands for.
    const stored = item.kind === "layer" && item.color === LAYER_COLOR
        ? "" : item.color;
    const picked = paletteColorOf(stored);

    return <div className="itemColor">
        <ColorSwatches id="itemColorCaption" value={picked ?? "custom"}
            disabled={readOnly} palette={FIGURE_PALETTE}
            // Only a colour no swatch shows is worth a word.
            hint={picked === undefined
                ? `A color of its own (${stored}), kept until another is `
                    + "picked."
                : undefined}
            onPick={(color) => {
                change({ color: color === "" ? "" : FIGURE_PALETTE[color] });
            }} />
    </div>;
};

/** A layer: the tables on it, then its place and size. */
const LayerFields = ({ item, change }:
    { item: IDiagramLayerItem; change: ChangeItem }): JSX.Element => {
    return <>
        <section>
            <h3>Tables</h3>
            {item.tables.length === 0
                ? <div className="detailsNote">None</div>
                : <ul className="detailsList">
                    {item.tables.map((table) => {
                        return <li key={table}>
                            <span className="detailsItem">{table}</span>
                        </li>;
                    })}
                </ul>}
        </section>
        <FigureFields item={item} change={change} />
    </>;
};

/** A relationship line: its tables, middle segment offset and split. */
const ConnectionFields = ({ item, change }:
    { item: IDiagramConnectionItem; change: ChangeItem }): JSX.Element => {
    const readOnly = !item.editable;

    return <section className="itemSection">
        <table className="detailsGrid"><tbody>
            <tr><th>Source table</th><td>{item.source}</td></tr>
            <tr><th>Target table</th><td>{item.target}</td></tr>
            {item.startDock === undefined ? null
                : <DockRow label="Source end" side={item.startDock}
                    readOnly={readOnly}
                    onReset={() => { change({ resetDock: "start" }); }} />}
            {item.endDock === undefined ? null
                : <DockRow label="Target end" side={item.endDock}
                    readOnly={readOnly}
                    onReset={() => { change({ resetDock: "end" }); }} />}
        </tbody></table>
        {item.many === undefined || item.identifying === undefined ? null
            : <div className="itemGrid itemGridWide">
                <label className="itemLabel" htmlFor="relationshipKind">
                    Kind:</label>
                <select id="relationshipKind" className="itemSelect"
                    value={item.many ? "1:n" : "1:1"} disabled={readOnly}
                    onChange={(event) => {
                        const many = event.currentTarget.value === "1:n";
                        // Back to what the diagram says until it changes:
                        // a refused change leaves it as it was.
                        event.currentTarget.value = item.many ? "1:n" : "1:1";
                        change({ many });
                    }}>
                    <option value="1:1">1:1</option>
                    <option value="1:n">1:n</option>
                </select>
                <span className="itemCheckCell">
                    <CheckField label="Identifying"
                        checked={item.identifying} readOnly={readOnly}
                        onChange={(identifying) => {
                            change({ identifying });
                        }} />
                </span>
            </div>}
        <div className="itemGrid itemGridWide">
            <NumberField label="Offset" title="Middle segment offset"
                value={item.offset} readOnly={readOnly || item.split}
                onCommit={(offset) => { change({ offset }); }} />
            <span className="itemCheckCell">
                <CheckField label="Split" checked={item.split}
                    readOnly={readOnly}
                    onChange={(split) => { change({ split }); }} />
            </span>
        </div>
    </section>;
};

/** The diagram item selected, its fields by its kind. */
export const DiagramItemFields = ({ item, change }:
    { item: DiagramItem; change: ChangeItem }): JSX.Element => {
    switch (item.kind) {
        case "figure": { return <FigureFields item={item} change={change} />; }
        case "layer": { return <LayerFields item={item} change={change} />; }
        default: { return <ConnectionFields item={item} change={change} />; }
    }
};

/**
 * The head of whatever the view shows: the icon, the name, then what it
 * is, on one line cut short with "…" rather than wrapped; a rule below it
 * from where the name starts (as the column names and the inputs below
 * do) to the right edge; under the rule, where it is (its schema, a REST
 * object's path), from the same place.
 *
 * @param props.icon The icon, if it has one; its place is kept anyway.
 * @param props.name What it is called.
 * @param props.kind What it is: "Table".
 * @param props.under What goes under the rule, if anything.
 * @param props.underTitle That line's tooltip.
 */
export const DetailsHeader = ({ icon, name, kind, under, underTitle }: {
    icon?: JSX.Element;
    name: string;
    kind: string;
    under?: string;
    underTitle?: string;
}): JSX.Element => {
    return <header className="detailsHeader">
        <div className="detailsTitle">
            <span className="detailsTitleIcon">{icon}</span>
            <span className="detailsTitleText" title={`${name} ${kind}`}>
                <span className="detailsName">{name}</span>
                {" "}
                <span className="detailsKind">{kind}</span>
            </span>
        </div>
        <div className="detailsRule" />
        {under === undefined ? null
            : <div className="detailsWhere" title={underTitle}>{under}</div>}
    </header>;
};

/**
 * A layer or a relationship line selected: no schema object to show.
 * The icon, where it has one, goes first, as an object's type icon does.
 */
export const ItemHeader = ({ item, icon }: {
    item: IDiagramLayerItem | IDiagramConnectionItem;
    icon?: JSX.Element;
}): JSX.Element => {
    return <DetailsHeader icon={icon}
        name={item.kind === "layer" ? item.name
            : `${item.source} → ${item.target}`}
        kind={item.kind === "layer" ? "Layer" : "Relationship"} />;
};
