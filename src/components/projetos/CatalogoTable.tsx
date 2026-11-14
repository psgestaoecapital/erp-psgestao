// src/components/projetos/CatalogoTable.tsx
// Tabela genérica para catálogos do Hub Projetos (insumos, mão de obra etc)
// No celular (< md) a lista vira cartões (HB0 · correção 9): a 1ª coluna sem hiddenOnMobile é o título do cartão,
// as demais visíveis viram pares rótulo/valor e as ações ficam no rodapé. No computador segue a tabela.

"use client";

import { ReactNode } from "react";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";

export interface CatalogoColumn<T> {
  key: string;
  label: string;
  /** chave do "?" (RD-95) do cabeçalho da coluna */
  ajuda?: string;
  align?: "left" | "right" | "center";
  className?: string;
  hiddenOnMobile?: boolean;
  /** Coluna secundária: no computador pode ser recolhida (prop `collapseSecondary`) para os
   *  valores (custo/preço) caberem sem rolagem horizontal. No celular (cartão) nada muda. */
  secondary?: boolean;
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
  /** Recolhe no computador as colunas marcadas como `secondary`, para as colunas de valor
   *  (custo/preço) ficarem visíveis sem rolagem horizontal. O cartão do celular não é afetado. */
  collapseSecondary?: boolean;
}

export function CatalogoTable<T>({
  rows,
  columns,
  loading,
  rowKey,
  onRowClick,
  emptyMessage = "Nenhum item encontrado",
  actions,
  collapseSecondary,
}: Props<T>) {
  // A tabela só aparece no computador (md+). Uma coluna secundária recolhida fica oculta aí; o cartão
  // do celular usa um caminho próprio (filtro por hiddenOnMobile) e não enxerga estas classes.
  // Não emitimos md:table-cell e md:hidden juntos (evita depender da ordem das classes do Tailwind).
  const colClass = (col: CatalogoColumn<T>) => {
    const recolhida = Boolean(collapseSecondary && col.secondary);
    const vis = recolhida
      ? col.hiddenOnMobile ? "hidden" : "md:hidden"
      : col.hiddenOnMobile ? "hidden md:table-cell" : "";
    return `${vis} ${col.className || ""}`;
  };
  const [titulo, ...camposCartao] = columns.filter((c) => !c.hiddenOnMobile);
  return (
    <>
    <div className="space-y-2 md:hidden" data-testid="catalogo-cartoes">
      {loading && (
        <div className="rounded-xl border border-[#3D2314]/8 bg-white px-4 py-8 text-center text-sm text-[#3D2314]/50">Carregando…</div>
      )}
      {!loading && rows.length === 0 && (
        <div className="rounded-xl border border-[#3D2314]/8 bg-white px-4 py-8 text-center text-sm text-[#3D2314]/50">{emptyMessage}</div>
      )}
      {!loading &&
        rows.map((row) => (
          <div
            key={rowKey(row)}
            onClick={() => onRowClick?.(row)}
            className={`rounded-xl border border-[#3D2314]/8 bg-white p-4 text-sm shadow-sm ${onRowClick ? "cursor-pointer active:bg-[#3D2314]/3" : ""}`}
          >
            {titulo && <div className="min-w-0 break-words font-medium text-[#3D2314]">{titulo.render(row)}</div>}
            {camposCartao.length > 0 && (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                {camposCartao.map((col) => (
                  <div key={col.key} className="min-w-0">
                    <dt className="text-[11px] uppercase tracking-wider text-[#3D2314]/50">{col.label}{col.ajuda && <AjudaCampo chave={col.ajuda} />}</dt>
                    <dd className="mt-0.5 break-words">{col.render(row)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {actions && (
              <div className="mt-3 border-t border-[#3D2314]/8 pt-2" onClick={(e) => e.stopPropagation()}>
                {actions(row)}
              </div>
            )}
          </div>
        ))}
    </div>
    <div className="hidden overflow-x-auto rounded-xl border border-[#3D2314]/8 bg-white shadow-sm md:block">
      <table className="w-full text-sm">
        <thead className="bg-[#3D2314]/5 text-xs uppercase tracking-wider text-[#3D2314]/60">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`whitespace-nowrap px-3 py-3 ${
                  col.align === "right"
                    ? "text-right"
                    : col.align === "center"
                    ? "text-center"
                    : "text-left"
                } ${colClass(col)}`}
              >
                {col.label}{col.ajuda && <AjudaCampo chave={col.ajuda} />}
              </th>
            ))}
            {actions && (
              // Ações fixada à direita (auditor 27/10: com muitas colunas a tabela rolava e a coluna de ações
              // saía da captura/da tela). Pinada, ela fica sempre visível e acessível sem rolagem horizontal.
              <th className="sticky right-0 z-10 whitespace-nowrap bg-[#F6F3F1] px-3 py-3 text-right text-xs uppercase tracking-wider text-[#3D2314]/60 shadow-[-8px_0_8px_-8px_rgba(61,35,20,0.18)]">
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
                    className={`px-3 py-3 ${
                      col.align === "right"
                        ? "text-right"
                        : col.align === "center"
                        ? "text-center"
                        : "text-left"
                    } ${colClass(col)}`}
                  >
                    {col.render(row)}
                  </td>
                ))}
                {actions && (
                  <td
                    className="sticky right-0 z-10 bg-white px-3 py-3 text-right shadow-[-8px_0_8px_-8px_rgba(61,35,20,0.18)]"
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
    </>
  );
}
