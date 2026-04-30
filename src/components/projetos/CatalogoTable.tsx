// src/components/projetos/CatalogoTable.tsx
// Tabela genérica para catálogos do Hub Projetos (insumos, mão de obra etc)

"use client";

import { ReactNode } from "react";

export interface CatalogoColumn<T> {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  className?: string;
  hiddenOnMobile?: boolean;
  render: (row: T) => ReactNode;
}

interface Props<T> {
  rows: T[];
  columns: CatalogoColumn<T>[];
  loading?: boolean;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  actions?: (row: T) => ReactNode;
}

export function CatalogoTable<T>({
  rows,
  columns,
  loading,
  rowKey,
  onRowClick,
  emptyMessage = "Nenhum item encontrado",
  actions,
}: Props<T>) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[#3D2314]/8 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-[#3D2314]/5 text-xs uppercase tracking-wider text-[#3D2314]/60">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 ${
                  col.align === "right"
                    ? "text-right"
                    : col.align === "center"
                    ? "text-center"
                    : "text-left"
                } ${col.hiddenOnMobile ? "hidden md:table-cell" : ""} ${col.className || ""}`}
              >
                {col.label}
              </th>
            ))}
            {actions && (
              <th className="px-4 py-3 text-right text-xs uppercase tracking-wider text-[#3D2314]/60">
                Ações
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#3D2314]/8">
          {loading && (
            <tr>
              <td
                colSpan={columns.length + (actions ? 1 : 0)}
                className="px-4 py-8 text-center text-[#3D2314]/50"
              >
                Carregando…
              </td>
            </tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td
                colSpan={columns.length + (actions ? 1 : 0)}
                className="px-4 py-8 text-center text-[#3D2314]/50"
              >
                {emptyMessage}
              </td>
            </tr>
          )}
          {!loading &&
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={() => onRowClick?.(row)}
                className={`${onRowClick ? "cursor-pointer" : ""} hover:bg-[#3D2314]/3`}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 ${
                      col.align === "right"
                        ? "text-right"
                        : col.align === "center"
                        ? "text-center"
                        : "text-left"
                    } ${col.hiddenOnMobile ? "hidden md:table-cell" : ""} ${col.className || ""}`}
                  >
                    {col.render(row)}
                  </td>
                ))}
                {actions && (
                  <td
                    className="px-4 py-3 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {actions(row)}
                  </td>
                )}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
