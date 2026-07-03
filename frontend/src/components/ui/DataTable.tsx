import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T, idx: number) => string;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({ rows, columns, rowKey, empty, onRowClick }: Props<T>) {
  if (!rows.length) {
    return (
      <div className="card p-10 text-center text-sand-100/55 text-sm">
        {empty ?? "Nenhum item encontrado."}
      </div>
    );
  }
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-app-subtle/40 text-[0.65rem] uppercase tracking-mono-xwide font-semibold text-sand-100/55">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`p-3 ${c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left"} ${c.className ?? ""}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={rowKey(r, i)}
              className={`border-t hairline ${onRowClick ? "cursor-pointer hover:bg-app-subtle/30" : ""}`}
              onClick={() => onRowClick?.(r)}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`p-3 ${c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left"} ${c.className ?? ""}`}
                >
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
