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
 * A Tabulator grid whose cells are controls (inputs, checkboxes, selects)
 * that are always showing, as DBX's table editor has them, rather than
 * Tabulator's click-to-edit editors. Each column builds its cell from the
 * row; a control commits its value through the callbacks the page gives,
 * and the page hands the grid new rows.
 *
 * New rows replace the grid's data (`replaceData`, which keeps the scroll
 * position), so every cell is built again: the control that had the focus
 * is found again by its row key and field (`data-key`, `data-field`) and
 * focused, its caret where it was, so Tab from one input to the next
 * survives the commit the first one made on leaving.
 */

import { useEffect, useRef } from "preact/hooks";
import {
    FormatModule,
    InteractionModule,
    ResizeColumnsModule,
    Tabulator,
    type ColumnDefinition,
} from "tabulator-tables";

Tabulator.registerModule([FormatModule, InteractionModule,
    ResizeColumnsModule]);

/** A row of a control grid: its key tells it from the others. */
export interface IGridRow {
    key: string;
}

/** A column of a control grid. */
export interface IGridColumn<T extends IGridRow> {
    field: string;
    title: string;
    width?: number;
    minWidth?: number;
    /** Takes the space left over. */
    grow?: boolean;
    hozAlign?: "left" | "center" | "right";
    /** Builds the cell's content. */
    render(row: T, position: number): HTMLElement;
}

/**
 * @param props The rows, the columns, and the classes a row gets.
 *
 * @returns The grid.
 */
export const ControlGrid = <T extends IGridRow>(props: {
    rows: T[];
    columns: Array<IGridColumn<T>>;
    rowClass?(row: T): string[];
    placeholder: string;
    /** Changes when the density does: the rows are measured again. */
    density?: string;
    /** A click on a row outside its controls. */
    onRowClick?(row: T): void;
}): preact.JSX.Element => {
    const host = useRef<HTMLDivElement>(null);
    const table = useRef<Tabulator | undefined>(undefined);
    const built = useRef(false);
    const latest = useRef(props);
    latest.current = props;

    useEffect(() => {
        if (host.current === null) {
            return;
        }
        const columns: ColumnDefinition[] = latest.current.columns.map((column) => {
            return {
                title: column.title,
                field: column.field,
                headerSort: false,
                // One line, cut short with an ellipsis, the whole title
                // its tooltip: a wrapped header costs a row of the grid.
                titleFormatter: () => {
                    const title = document.createElement("span");
                    title.textContent = column.title;
                    title.title = column.title;

                    return title;
                },
                resizable: true,
                hozAlign: column.hozAlign ?? "left",
                vertAlign: "middle",
                ...(column.width === undefined ? {} : { width: column.width }),
                ...(column.minWidth === undefined
                    ? {} : { minWidth: column.minWidth }),
                ...(column.grow === true ? { widthGrow: 1 } : {}),
                // The page's columns of this render, not of the first: their
                // callbacks see the draft as it is now.
                formatter: (cell) => {
                    const row = cell.getRow();
                    const now = latest.current.columns.find((candidate) => {
                        return candidate.field === column.field;
                    }) ?? column;

                    return now.render(row.getData() as T,
                        row.getPosition() as number);
                },
            };
        });
        const instance = new Tabulator(host.current, {
            data: [],
            index: "key",
            columns,
            layout: "fitColumns",
            height: "100%",
            placeholder: latest.current.placeholder,
            rowFormatter: (row) => {
                const element = row.getElement();
                const classes = latest.current.rowClass?.(row.getData() as T)
                    ?? [];
                element.dataset.rowClasses = classes.join(" ");
                for (const name of [...element.classList]) {
                    if (name.startsWith("grid-")) {
                        element.classList.remove(name);
                    }
                }
                element.classList.add(...classes.map((name) => {
                    return `grid-${name}`;
                }));
            },
        });
        instance.on("tableBuilt", () => {
            built.current = true;
            void instance.replaceData(latest.current.rows);
        });
        instance.on("rowClick", (event, row) => {
            const target = event.target as HTMLElement;
            if (target.closest("input, select, textarea, button") === null) {
                latest.current.onRowClick?.(row.getData() as T);
            }
        });
        table.current = instance;

        return () => {
            built.current = false;
            instance.destroy();
            table.current = undefined;
        };
    }, []);

    useEffect(() => {
        const instance = table.current;
        if (instance === undefined || !built.current) {
            return;
        }
        const focused = document.activeElement as HTMLElement | null;
        const key = focused?.dataset.key;
        const field = focused?.dataset.field;
        const caret = focused instanceof HTMLInputElement
            ? focused.selectionStart : null;
        void instance.replaceData(props.rows).then(() => {
            if (key === undefined || field === undefined
                || host.current === null) {
                return;
            }
            const again = host.current.querySelector<HTMLElement>(
                `[data-key="${CSS.escape(key)}"][data-field="${
                    CSS.escape(field)}"]`);
            again?.focus();
            if (again instanceof HTMLInputElement && caret !== null) {
                again.setSelectionRange(caret, caret);
            }
        });
    }, [props.rows]);

    useEffect(() => {
        if (built.current) {
            table.current?.redraw(true);
        }
    }, [props.density]);

    return <div class="control-grid" ref={host} />;
};

// ---------------------------------------------------------------------------
// The controls cells are made of.

/** Where a control's value goes, and what tells it apart for focus. */
interface IControlTarget {
    key: string;
    field: string;
}

/**
 * @param target The row and field.
 * @param element The control.
 *
 * @returns It, marked to be focused again after a redraw.
 */
const marked = <E extends HTMLElement>(target: IControlTarget,
    element: E): E => {
    element.dataset.key = target.key;
    element.dataset.field = target.field;

    return element;
};

/**
 * @param target The row and field.
 * @param value The text.
 * @param commit Takes a changed value, once the input is left or Enter
 *               is pressed.
 * @param options Its placeholder, class, and whether it is read only.
 *
 * @returns A text input.
 */
export const textInput = (
    target: IControlTarget,
    value: string,
    commit: (value: string) => void,
    options: { placeholder?: string; className?: string;
        disabled?: boolean; list?: string } = {},
): HTMLInputElement => {
    const input = marked(target, document.createElement("input"));
    input.type = "text";
    input.value = value;
    input.spellcheck = false;
    input.className = `cell-input ${options.className ?? ""}`.trim();
    input.placeholder = options.placeholder ?? "";
    input.disabled = options.disabled === true;
    if (options.list !== undefined) {
        input.setAttribute("list", options.list);
    }
    input.addEventListener("change", () => {
        if (input.value !== value) {
            commit(input.value);
        }
    });
    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            input.dispatchEvent(new Event("change"));
        } else if (event.key === "Escape") {
            input.value = value;
        }
        // Tabulator's own keys (arrows move between cells) stay out of it.
        event.stopPropagation();
    });

    return input;
};

/**
 * @param target The row and field.
 * @param checked Whether it is ticked.
 * @param commit Takes the new state.
 * @param options Its label, and whether it can be changed.
 *
 * @returns A checkbox, with its label where it has one.
 */
export const checkBox = (
    target: IControlTarget,
    checked: boolean,
    commit: (checked: boolean) => void,
    options: { label?: string; disabled?: boolean; title?: string } = {},
): HTMLElement => {
    const box = marked(target, document.createElement("input"));
    box.type = "checkbox";
    box.checked = checked;
    box.disabled = options.disabled === true;
    box.addEventListener("change", () => { commit(box.checked); });
    if (options.label === undefined) {
        box.className = "cell-check";
        box.title = options.title ?? "";

        return box;
    }
    const label = document.createElement("label");
    label.className = "cell-check-label";
    label.title = options.title ?? "";
    label.append(box, options.label);

    return label;
};

/**
 * A text input with a ▾ beside it that offers choices: picking one sets
 * the input. Typing stays free.
 *
 * @param target The row and field.
 * @param value The text.
 * @param choices What the ▾ offers: a value and what is shown for it.
 * @param commit Takes a changed value.
 * @param options As for {@link textInput}.
 *
 * @returns The input and its ▾.
 */
export const comboInput = (
    target: IControlTarget,
    value: string,
    choices: ReadonlyArray<{ value: string; label: string }>,
    commit: (value: string) => void,
    options: { placeholder?: string; className?: string;
        disabled?: boolean } = {},
): HTMLElement => {
    const wrapper = document.createElement("div");
    wrapper.className = "cell-combo";
    const input = textInput(target, value, commit, options);
    const select = document.createElement("select");
    select.className = "cell-combo-choices";
    select.tabIndex = -1;
    select.title = "Choose";
    select.disabled = options.disabled === true;
    const none = document.createElement("option");
    none.value = "\u0000";
    none.textContent = "";
    none.hidden = true;
    select.append(none, ...choices.map((choice) => {
        const option = document.createElement("option");
        option.value = choice.value;
        option.textContent = choice.label;

        return option;
    }));
    select.value = "\u0000";
    select.addEventListener("change", () => {
        if (select.value !== "\u0000" && select.value !== value) {
            commit(select.value);
        }
        select.value = "\u0000";
    });
    wrapper.append(input, select);

    return wrapper;
};

/**
 * @param target The row and field.
 * @param value The value picked.
 * @param choices The values and what is shown for each.
 * @param commit Takes the new value.
 * @param options Whether it can be changed.
 *
 * @returns A select.
 */
export const selectInput = (
    target: IControlTarget,
    value: string,
    choices: ReadonlyArray<{ value: string; label: string }>,
    commit: (value: string) => void,
    options: { disabled?: boolean; className?: string } = {},
): HTMLSelectElement => {
    const select = marked(target, document.createElement("select"));
    select.className = `cell-select ${options.className ?? ""}`.trim();
    select.disabled = options.disabled === true;
    const known = choices.some((choice) => { return choice.value === value; });
    for (const choice of known ? choices
        : [{ value, label: value }, ...choices]) {
        const option = document.createElement("option");
        option.value = choice.value;
        option.textContent = choice.label;
        select.append(option);
    }
    select.value = value;
    select.addEventListener("change", () => { commit(select.value); });

    return select;
};

/**
 * @param icon The codicon's name.
 * @param title Its tooltip.
 * @param run What a click does.
 * @param options Whether it can be clicked.
 *
 * @returns An icon button.
 */
export const iconButton = (
    icon: string,
    title: string,
    run: () => void,
    options: { disabled?: boolean } = {},
): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `icon-button codicon codicon-${icon}`;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.disabled = options.disabled === true;
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        run();
    });

    return button;
};

/**
 * @param children What goes in it.
 * @param className Its class.
 *
 * @returns A span holding them in a row.
 */
export const cellRow = (
    children: Array<HTMLElement | string>,
    className = "cell-row",
): HTMLElement => {
    const span = document.createElement("span");
    span.className = className;
    span.append(...children);

    return span;
};
