"use client";

import { useMemo, type ReactNode } from "react";
import { useTable } from "@tanstack/react-table";
import { createSortedRowModel, rowSortingFeature, sortFn_alphanumeric, sortFn_text, tableFeatures } from "@tanstack/table-core";
import { cn } from "@/lib/ui";
import { EmptyState } from "./StateBlocks";

/**
 * Sortable data table.
 *
 * Used where a list is long enough that a customer must be able to reorder it (POS sales,
 * payments, inventory, reports). TanStack Table owns the headless model — the feature
 * registration, the sorting state, the sort handlers and the ordered row model — while every
 * pixel comes from the shared `.jata-table` design-system styles, so a table looks identical in
 * the POS and in the dashboard.
 *
 * Accessibility: real `<thead>`/`<th scope="col">`/`<tbody>`, the sort control is a real
 * `<button>` with `aria-sort` on its header cell, the sort direction is also spelled out in the
 * button's accessible name, and an empty table announces the empty state instead of rendering
 * nothing.
 */
export type DataTableColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Value used for ordering. Numeric columns sort numerically, text columns alphabetically. */
  sortValue?: (row: T) => string | number | null | undefined;
  align?: "start" | "end";
  /** Defaults to true for every column; set false for action columns. */
  sortable?: boolean;
  headerClassName?: string;
  cellClassName?: string;
};

// Registered once for the whole platform: sorting plus the two comparators actually used.
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
});

export function DataTable<T extends { id: string }>({
  rows,
  columns,
  caption,
  emptyTitle = "Nothing to show yet",
  emptyText,
  className,
  initialSort,
}: {
  rows: T[];
  columns: DataTableColumn<T>[];
  caption?: string;
  emptyTitle?: string;
  emptyText?: ReactNode;
  className?: string;
  initialSort?: { id: string; desc?: boolean };
}) {
  const firstRow = rows[0];
  const tableColumns = useMemo(
    () =>
      columns.map((column) => {
        const sample = firstRow && column.sortValue ? column.sortValue(firstRow) : undefined;
        const numeric = typeof sample === "number";
        return {
          id: column.id,
          accessorFn: (row: T) => column.sortValue?.(row) ?? (row as Record<string, unknown>)[column.id],
          enableSorting: column.sortable !== false,
          sortFn: numeric ? ("alphanumeric" as const) : ("text" as const),
        };
      }),
    [columns, firstRow],
  );

  const table = useTable({
    features,
    data: rows,
    columns: tableColumns,
    initialState: initialSort ? { sorting: [{ id: initialSort.id, desc: Boolean(initialSort.desc) }] } : undefined,
  });

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle}>{emptyText}</EmptyState>;
  }

  const headerGroups = table.getHeaderGroups() as Array<{ id: string; headers: unknown[] }>;

  return (
    <div className={cn("jata-table-wrap", className)}>
      <table className="jata-table">
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          {headerGroups.map((headerGroup) => (
            <tr key={headerGroup.id}>
              {columns.map((column, index) => {
                const header = headerGroup.headers[index] as
                  | { column: { getCanSort: () => boolean; getIsSorted: () => false | "asc" | "desc"; getToggleSortingHandler: () => ((event: unknown) => void) | undefined } }
                  | undefined;
                const sorted = header?.column.getIsSorted() ?? false;
                const canSort = header?.column.getCanSort() ?? false;
                const alignEnd = column.align === "end";
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={sorted ? (sorted === "asc" ? "ascending" : "descending") : canSort ? "none" : undefined}
                    className={cn(alignEnd && "text-right", column.headerClassName)}
                  >
                    {canSort ? (
                      <button
                        type="button"
                        className="jata-table__sort"
                        onClick={header?.column.getToggleSortingHandler()}
                        aria-label={`Sort by ${column.header}${sorted === "asc" ? " (currently ascending)" : sorted === "desc" ? " (currently descending)" : ""}`}
                      >
                        {column.header}
                        <span aria-hidden="true">{sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : "↕"}</span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {(table.getRowModel().rows as Array<{ id: string; original: T }>).map((row) => (
            <tr key={row.id}>
              {columns.map((column) => (
                <td key={column.id} className={cn(column.align === "end" && "text-right", column.cellClassName)}>
                  {column.cell(row.original)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
