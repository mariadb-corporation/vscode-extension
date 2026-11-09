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
 *
 * Up and Down in a text input move to the same field of the row above or
 * below; Down in the last row asks the page for a new row, where it has
 * one to give. A combo's input keeps them for its list of choices. The
 * page asks for a control to be focused with `focus`, which the grid
 * honours once the rows it is in are built.
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

/** A control the page wants focused: its row and field. */
export interface IGridFocus {
    key: string;
    field: string;
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
    /** A control to focus, once it is built; `onFocused` clears it. */
    focus?: IGridFocus;
    onFocused?(): void;
    /** Down in the last row: the page adds a row, and asks for a focus. */
    onAddRow?(): void;
}): preact.JSX.Element => {
    const host = useRef<HTMLDivElement>(null);
    const table = useRef<Tabulator | undefined>(undefined);
    const built = useRef(false);
    const latest = useRef(props);
    latest.current = props;

    /**
     * @param target A row and field.
     *
     * @returns Its control, where it is built.
     */
    const controlOf = (target: IGridFocus): HTMLElement | null => {
        return host.current?.querySelector<HTMLElement>(
            `[data-key="${CSS.escape(target.key)}"][data-field="${
                CSS.escape(target.field)}"]`) ?? null;
    };

    /**
     * Focuses the control the page asked for, where it is built.
     *
     * @returns Whether it did.
     */
    const focusAsked = (): boolean => {
        const asked = latest.current.focus;
        const control = asked === undefined ? null : controlOf(asked);
        if (control === null) {
            return false;
        }
        control.focus();
        if (control instanceof HTMLInputElement) {
            control.setSelectionRange(control.value.length,
                control.value.length);
        }
        latest.current.onFocused?.();

        return true;
    };

    /**
     * Up or Down in a text input: the same field a row up or down, the
     * rows of dropped columns and the like skipped; Down past the last
     * row asks for a new one.
     *
     * @param event The key.
     */
    const onArrow = (event: KeyboardEvent): void => {
        const instance = table.current;
        const input = event.target;
        if ((event.key !== "ArrowUp" && event.key !== "ArrowDown")
            || event.altKey || event.ctrlKey || event.metaKey
            || event.shiftKey || instance === undefined
            || !(input instanceof HTMLInputElement) || input.type !== "text"
            || input.closest(".cell-combo") !== null) {
            return;
        }
        const { key, field } = input.dataset;
        if (key === undefined || field === undefined) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const keys = instance.getRows("active").map((row) => {
            return (row.getData() as IGridRow).key;
        });
        const step = event.key === "ArrowUp" ? -1 : 1;
        // Taken first: what the next control's commit sees includes it.
        input.dispatchEvent(new Event("change"));
        let at = keys.indexOf(key) + step;
        while (at >= 0 && at < keys.length && (controlOf({ key: keys[at],
            field }) as HTMLInputElement | null)?.disabled === true) {
            at += step;
        }
        if (at < 0) {
            return;
        }
        if (at >= keys.length) {
            latest.current.onAddRow?.();

            return;
        }
        const next = { key: keys[at], field };
        void instance.scrollToRow(next.key, "nearest", false).then(() => {
            const control = controlOf(next);
            if (control instanceof HTMLInputElement) {
                control.focus();
                control.setSelectionRange(control.value.length,
                    control.value.length);
            }
        });
    };

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
            void instance.replaceData(latest.current.rows).then(focusAsked);
        });
        instance.on("rowClick", (event, row) => {
            const target = event.target as HTMLElement;
            if (target.closest("input, select, textarea, button") === null) {
                latest.current.onRowClick?.(row.getData() as T);
            }
        });
        table.current = instance;
        // Before the input's own keys, which keep Tabulator's out.
        const element = host.current;
        element.addEventListener("keydown", onArrow, true);

        return () => {
            element.removeEventListener("keydown", onArrow, true);
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
            if (focusAsked() || key === undefined || field === undefined) {
                return;
            }
            const again = controlOf({ key, field });
            if (again === null) {
                return;
            }
            // Focused again, not by the user: a combo opens no list.
            again.dataset.refocus = "true";
            again.focus();
            delete again.dataset.refocus;
            if (again instanceof HTMLInputElement && caret !== null) {
                again.setSelectionRange(caret, caret);
            }
        });
    }, [props.rows]);

    // A focus asked for a control built already: the rows did not change.
    useEffect(() => {
        if (built.current) {
            focusAsked();
        }
    }, [props.focus]);

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
    // What was committed last: a change dispatched before the input is
    // left is not committed again on leaving.
    let committed = value;
    input.addEventListener("change", () => {
        if (input.value !== committed) {
            committed = input.value;
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

/** The one combo list open, if any: a combo's list lives on the body. */
let openList: { close(): void } | undefined;

/**
 * A text input with a ▾ beside it that offers choices. Focused, its text
 * is selected (typing replaces it) and the list opens; typing narrows it
 * to the choices that start so, Up and Down move through it, putting the
 * choice in the input, and Enter or a click takes one. Typing stays free.
 *
 * @param target The row and field.
 * @param value The text.
 * @param choices What the list offers: a value and what is shown for it.
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
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    const chevron = document.createElement("button");
    chevron.type = "button";
    chevron.className = "cell-combo-choices";
    chevron.tabIndex = -1;
    chevron.title = "Choose";
    chevron.disabled = options.disabled === true;

    let list: HTMLDivElement | undefined;
    let shown: ReadonlyArray<{ value: string; label: string }> = [];
    let active = -1;

    const close = (): void => {
        list?.remove();
        list = undefined;
        input.setAttribute("aria-expanded", "false");
        if (openList === handle) {
            openList = undefined;
        }
    };
    const handle = { close };

    const mark = (): void => {
        list?.querySelectorAll(".cell-combo-option").forEach((item, at) => {
            item.classList.toggle("active", at === active);
            if (at === active) {
                item.scrollIntoView({ block: "nearest" });
            }
        });
    };

    const take = (choice: string): void => {
        input.value = choice;
        close();
        input.dispatchEvent(new Event("change"));
    };

    /** @param filter Narrows the list to choices starting with the text. */
    const open = (filter: boolean): void => {
        const typed = input.value.trim().toLowerCase();
        shown = filter ? choices.filter((choice) => {
            return choice.value.toLowerCase().startsWith(typed);
        }) : choices;
        active = shown.findIndex((choice) => {
            return choice.value.toLowerCase() === typed;
        });
        if (filter && active < 0 && shown.length > 0) {
            active = 0;
        }
        if (shown.length === 0) {
            close();

            return;
        }
        if (openList !== handle) {
            openList?.close();
        }
        list?.remove();
        list = document.createElement("div");
        list.className = "cell-combo-list";
        list.setAttribute("role", "listbox");
        for (const choice of shown) {
            const item = document.createElement("div");
            item.className = "cell-combo-option";
            item.setAttribute("role", "option");
            item.textContent = choice.label;
            // Down, not click: the input keeps the focus.
            item.addEventListener("mousedown", (event) => {
                event.preventDefault();
                take(choice.value);
            });
            list.append(item);
        }
        const box = input.getBoundingClientRect();
        list.style.left = `${box.left}px`;
        list.style.top = `${box.bottom}px`;
        list.style.minWidth = `${wrapper.getBoundingClientRect().width}px`;
        document.body.append(list);
        input.setAttribute("aria-expanded", "true");
        openList = handle;
        mark();
    };

    // A click that focuses it keeps the text selected.
    let selectedOnFocus = false;
    input.addEventListener("focus", () => {
        if (input.dataset.refocus !== undefined) {
            // Built again under the focus: the list of the input it
            // replaced goes.
            openList?.close();

            return;
        }
        input.select();
        selectedOnFocus = true;
        open(false);
    });
    input.addEventListener("mouseup", (event) => {
        if (selectedOnFocus) {
            event.preventDefault();
            selectedOnFocus = false;
        }
    });
    input.addEventListener("blur", () => {
        selectedOnFocus = false;
        close();
    });
    input.addEventListener("input", () => {
        selectedOnFocus = false;
        open(true);
    });
    // Before the input's own keys: Enter takes the choice before the
    // input commits.
    wrapper.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (list === undefined) {
                open(false);

                return;
            }
            const step = event.key === "ArrowDown" ? 1 : -1;
            active = Math.min(shown.length - 1, Math.max(0, active + step));
            input.value = shown[active].value;
            input.select();
            mark();
        } else if (event.key === "Enter" && list !== undefined
            && active >= 0) {
            input.value = shown[active].value;
            close();
        } else if (event.key === "Escape" || event.key === "Tab") {
            close();
        }
    }, true);
    chevron.addEventListener("mousedown", (event) => {
        event.preventDefault();
        if (list === undefined) {
            if (document.activeElement === input) {
                open(false);
            } else {
                input.focus();
            }
        } else {
            close();
        }
    });
    wrapper.append(input, chevron);

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
