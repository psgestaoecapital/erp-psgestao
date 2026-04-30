// src/components/projetos/EmptyStateImportar.tsx
// Empty state quando empresa não importou catálogo público ainda

"use client";

import type { LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  titulo: string;
  descricao: string;
  qtdItens?: number;
  ctaImportar: string;
  ctaSecundario?: string;
  onImportar: () => void;
  onCriarManual?: () => void;
  importando?: boolean;
}

export function EmptyStateImportar({
  icon: Icon,
  titulo,
  descricao,
  qtdItens,
  ctaImportar,
  ctaSecundario,
  onImportar,
  onCriarManual,
  importando,
}: Props) {
  return (
    <div className="rounded-2xl border border-[#3D2314]/8 bg-white p-12 text-center shadow-sm">
      <div className="mx-auto mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#3D2314]/8">
        <Icon size={28} className="text-[#C8941A]" />
      </div>
      <h3
        className="text-xl font-medium text-[#3D2314]"
        style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
      >
        {titulo}
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-[#3D2314]/60">
        {descricao}
        {qtdItens != null && (
          <>
            {" "}
            <span className="font-medium text-[#3D2314]">({qtdItens} itens)</span>
          </>
        )}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={onImportar}
          disabled={importando}
          className="inline-flex items-center gap-2 rounded-lg bg-[#3D2314] px-5 py-2.5 text-sm font-medium text-[#FAF7F2] transition-colors hover:bg-[#3D2314]/90 disabled:opacity-50"
        >
          {importando ? "Importando…" : ctaImportar}
        </button>
        {onCriarManual && ctaSecundario && (
          <button
            onClick={onCriarManual}
            className="text-sm text-[#3D2314]/60 hover:text-[#3D2314]"
          >
            {ctaSecundario}
          </button>
        )}
      </div>
    </div>
  );
}
