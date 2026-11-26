// src/components/projetos/CalcProdutividadeModal.tsx
// Auxílio SIMPLES de coeficiente para MÃO DE OBRA por hora (Modo A, CEO 24/11).
// Os 5 métodos (CalcCoeficienteModal) são de material/EPI/consumível; para mão de obra só este:
//   horas por <unidade> = horas da equipe no dia ÷ produtividade (quantos <unidade> a equipe faz por dia).
// O resultado vira a QUANTIDADE (coeficiente) da linha de mão de obra; o custo = custo/h × essa quantidade.

"use client";

import { useState } from "react";
import { X, HardHat } from "lucide-react";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { parseNumBR } from "@/lib/num";

const ROTA_AJUDA_SERVICO = "/dashboard/projetos/catalogo/[id]";

export interface ProdResultado {
  quantidade: number;
  observacao: string | null;
}

function fmtNum(v: number) {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

export function CalcProdutividadeModal({
  open,
  onClose,
  itemNome,
  unidadeServico,
  produtividade,
  horasDiaPadrao = 8,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  itemNome: string;
  unidadeServico: string | null;
  produtividade: number | null;
  horasDiaPadrao?: number;
  onConfirm: (r: ProdResultado) => void;
}) {
  const un = (unidadeServico && unidadeServico.trim()) || "m²";
  const [z, setZ] = useState<string>(produtividade != null && produtividade > 0 ? String(produtividade) : "");
  const [horas, setHoras] = useState<string>(String(horasDiaPadrao));

  if (!open) return null;

  const zN = parseNumBR(z);
  const hN = parseNumBR(horas);
  const q = zN && zN > 0 && hN != null && hN > 0 ? hN / zN : null;

  function confirmar() {
    if (q === null) return;
    const obs = `Produtividade: ${fmtNum(zN as number)} ${un}/dia · ${fmtNum(hN as number)} h/dia → ${fmtNum(q as number)} h por ${un}`;
    onConfirm({ quantidade: Math.round((q as number) * 10000) / 10000, observacao: obs });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#3D2314]/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-[#3D2314]/8 p-5">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-[#3D2314]" style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}>
              <HardHat size={18} className="text-[#C8941A]" /> Horas por {un}
            </h2>
            <p className="mt-1 text-xs text-[#3D2314]/60">{itemNome} · mão de obra por hora</p>
          </div>
          <button onClick={onClose} className="text-[#3D2314]/60 hover:text-[#3D2314]" aria-label="Fechar"><X size={18} /></button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm text-[#3D2314]/70">
            Quanto a equipe produz por dia e quantas horas ela trabalha no dia. Calculamos as horas por {un} para você — sem rendimento nem vida útil (isso é de material).
          </p>

          <div className="grid grid-cols-2 gap-3" data-ajuda="projetos.catalogo.bom.mo_produtividade">
            <label className="flex flex-col gap-1 text-xs">
              <span className="flex items-center text-[#3D2314]/70">
                Produz por dia ({un}/dia)
                <AjudaCampo chave="projetos.catalogo.bom.mo_produtividade" rota={ROTA_AJUDA_SERVICO} />
              </span>
              <input
                value={z}
                onChange={(e) => setZ(e.target.value)}
                inputMode="decimal"
                data-testid="mo-produtividade-z"
                placeholder="40"
                className="rounded !border !border-[#3D2314]/12 !bg-white px-2 py-1.5 text-right text-sm !text-[#3D2314] focus:!border-[#C8941A] focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="flex items-center text-[#3D2314]/70">
                Horas no dia
                <AjudaCampo chave="projetos.catalogo.bom.mo_produtividade" rota={ROTA_AJUDA_SERVICO} />
              </span>
              <input
                value={horas}
                onChange={(e) => setHoras(e.target.value)}
                inputMode="decimal"
                data-testid="mo-produtividade-horas"
                placeholder="8"
                className="rounded !border !border-[#3D2314]/12 !bg-white px-2 py-1.5 text-right text-sm !text-[#3D2314] focus:!border-[#C8941A] focus:outline-none"
              />
            </label>
          </div>

          <div className="rounded-lg bg-[#FAF7F2] p-3 text-sm">
            <span className="text-[#3D2314]/60">Horas por {un}: </span>
            <span className="font-mono font-semibold text-[#3D2314]" data-testid="mo-produtividade-resultado">
              {q === null ? "—" : `${fmtNum(q)} h`}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[#3D2314]/8 p-4">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-[#3D2314]/70 hover:bg-[#3D2314]/5">Cancelar</button>
          <button
            onClick={confirmar}
            disabled={q === null}
            data-testid="mo-produtividade-aplicar"
            className="rounded-lg bg-[#C8941A] px-4 py-2 text-sm font-medium text-white hover:bg-[#b3820f] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Usar {q === null ? "" : `${fmtNum(q)} h/${un}`}
          </button>
        </div>
      </div>
    </div>
  );
}
