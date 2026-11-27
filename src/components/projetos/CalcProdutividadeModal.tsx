// src/components/projetos/CalcProdutividadeModal.tsx
// Mão de obra POR HORA (CEO 26/11) — produtividade POR PESSOA + conversão automática.
// Parametriza o técnico (quanto 1 pessoa produz) separado do comercial (como se paga).
// Fórmula única: custo por <unidade> = custo/h da equipe ÷ (nº pessoas × produção por pessoa/hora).
// O usuário informa coisas tangíveis (produção por pessoa, nº de pessoas, jornada); o "h por m²"
// aparece só como detalhe, nunca como campo de entrada. Os 5 métodos de material/EPI são outro modal.
// O coeficiente devolvido (quantidade) é consumido como custo/h (da equipe) × quantidade na linha.

"use client";

import { useState } from "react";
import { X, HardHat } from "lucide-react";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { parseNumBR } from "@/lib/num";

const ROTA = "/dashboard/projetos/catalogo/[id]";

export interface ProdResultado {
  quantidade: number;
  observacao: string | null;
  // CEO 26/11: devolve os inputs p/ a página do catálogo gravar no serviço e pré-preencher na próxima vez.
  produtividade_pessoa: number | null;
  produtividade_base: "hora" | "dia";
  equipe_pessoas: number | null;
  jornada_horas_dia: number | null;
}

const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });

export function CalcProdutividadeModal({
  open, onClose, itemNome, unidadeServico,
  produtividadePessoa, produtividadeBase, equipePessoas, jornada = 8,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  itemNome: string;
  unidadeServico: string | null;
  produtividadePessoa?: number | null;
  produtividadeBase?: "hora" | "dia" | null;
  equipePessoas?: number | null;
  jornada?: number | null;
  onConfirm: (r: ProdResultado) => void;
}) {
  const un = (unidadeServico && unidadeServico.trim()) || "m²";
  const [prod, setProd] = useState<string>(produtividadePessoa != null && produtividadePessoa > 0 ? String(produtividadePessoa) : "");
  const [base, setBase] = useState<"hora" | "dia">(produtividadeBase === "hora" ? "hora" : "dia");
  const [pessoas, setPessoas] = useState<string>(equipePessoas != null && equipePessoas > 0 ? String(equipePessoas) : "");
  const [jorn, setJorn] = useState<string>(String(jornada && jornada > 0 ? jornada : 8));
  const [origem, setOrigem] = useState<"propria" | "terceira">("propria");

  if (!open) return null;

  const prodN = parseNumBR(prod);
  const pessoasN = parseNumBR(pessoas);
  const jornN = parseNumBR(jorn);
  const jornOk = jornN && jornN > 0 ? jornN : 8;
  // produção por pessoa por HORA
  const prodPessoaHora = prodN && prodN > 0 ? (base === "hora" ? prodN : prodN / jornOk) : null;
  // produção da EQUIPE por hora = nº pessoas × produção por pessoa/hora
  const prodEquipeHora = prodPessoaHora != null && pessoasN && pessoasN > 0 ? pessoasN * prodPessoaHora : null;
  // coeficiente = horas (da equipe) por unidade → custo/un = custo/h (da equipe) × coeficiente
  const q = prodEquipeHora && prodEquipeHora > 0 ? 1 / prodEquipeHora : null;

  function confirmar() {
    if (q === null || prodEquipeHora === null) return;
    const obs = `Mão de obra por hora (${origem === "propria" ? "equipe própria" : "equipe terceira"}): ${fmt(pessoasN as number)} pessoa(s) × ${fmt(prodPessoaHora as number)} ${un}/pessoa/h = ${fmt(prodEquipeHora)} ${un}/h da equipe. Custo por ${un} = custo/h da equipe ÷ ${fmt(prodEquipeHora)} (= ${fmt(q as number)} h por ${un}).`;
    onConfirm({
      quantidade: Math.round((q as number) * 1000000) / 1000000,
      observacao: obs,
      produtividade_pessoa: prodN ?? null,
      produtividade_base: base,
      equipe_pessoas: pessoasN ?? null,
      jornada_horas_dia: jornOk,
    });
  }

  const inp = "rounded !border !border-[#3D2314]/12 !bg-white px-2 py-1.5 text-right text-sm !text-[#3D2314] focus:!border-[#C8941A] focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#3D2314]/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-[#3D2314]/8 p-5">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-[#3D2314]" style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}>
              <HardHat size={18} className="text-[#C8941A]" /> Produtividade da mão de obra
            </h2>
            <p className="mt-1 text-xs text-[#3D2314]/60">{itemNome} · por hora (equipe própria ou terceira)</p>
          </div>
          <button onClick={onClose} className="text-[#3D2314]/60 hover:text-[#3D2314]" aria-label="Fechar"><X size={18} /></button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm text-[#3D2314]/70">
            Diga quanto <b>uma pessoa</b> produz e quantas pessoas. O sistema multiplica e calcula o custo por {un} —
            sem você pensar em {`"horas por ${un}"`}. (Pagamento por {un}/empreitada é outro modo: use a unidade {un} e o valor por {un}.)
          </p>

          <div className="grid grid-cols-2 gap-3" data-ajuda="projetos.catalogo.servico.produtividade_pessoa">
            <label className="flex flex-col gap-1 text-xs">
              <span className="flex items-center text-[#3D2314]/70">Produção por pessoa ({un})
                <AjudaCampo chave="projetos.catalogo.servico.produtividade_pessoa" rota={ROTA} /></span>
              <input value={prod} onChange={(e) => setProd(e.target.value)} inputMode="decimal" data-testid="mo-produtividade-z" placeholder="3" className={inp} />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="flex items-center text-[#3D2314]/70">Por
                <AjudaCampo chave="projetos.catalogo.servico.produtividade_base" rota={ROTA} /></span>
              <select value={base} onChange={(e) => setBase(e.target.value as "hora" | "dia")} data-testid="mo-produtividade-base" className={inp.replace("text-right", "")}>
                <option value="hora">hora</option>
                <option value="dia">dia</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="flex items-center text-[#3D2314]/70">Nº de pessoas
                <AjudaCampo chave="projetos.catalogo.servico.equipe_pessoas" rota={ROTA} /></span>
              <input value={pessoas} onChange={(e) => setPessoas(e.target.value)} inputMode="decimal" data-testid="mo-produtividade-pessoas" placeholder="8" className={inp} />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="flex items-center text-[#3D2314]/70">Jornada (h/dia)
                <AjudaCampo chave="projetos.catalogo.servico.jornada_horas_dia" rota={ROTA} /></span>
              <input value={jorn} onChange={(e) => setJorn(e.target.value)} inputMode="decimal" data-testid="mo-produtividade-jornada" placeholder="8" className={inp} />
            </label>
          </div>

          <div className="flex gap-2 text-xs">
            {(["propria", "terceira"] as const).map((o) => (
              <button key={o} onClick={() => setOrigem(o)} type="button"
                className={`rounded-lg border px-3 py-1.5 ${origem === o ? "border-[#C8941A] bg-[#C8941A]/10 text-[#3D2314]" : "border-[#3D2314]/12 text-[#3D2314]/70"}`}>
                {o === "propria" ? "Equipe própria" : "Equipe terceira"}
              </button>
            ))}
          </div>

          <div className="rounded-lg bg-[#FAF7F2] p-3 text-sm">
            <div className="flex justify-between"><span className="text-[#3D2314]/60">Produção da equipe</span>
              <span className="font-mono font-semibold text-[#3D2314]" data-testid="mo-produtividade-equipe">{prodEquipeHora === null ? "—" : `${fmt(prodEquipeHora)} ${un}/h`}</span></div>
            <div className="mt-1 flex justify-between"><span className="text-[#3D2314]/60">Detalhe (h por {un})</span>
              <span className="font-mono text-[#3D2314]/70" data-testid="mo-produtividade-resultado">{q === null ? "—" : `${fmt(q)} h`}</span></div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[#3D2314]/8 p-4">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-[#3D2314]/70 hover:bg-[#3D2314]/5">Cancelar</button>
          <button onClick={confirmar} disabled={q === null} data-testid="mo-produtividade-aplicar"
            className="rounded-lg bg-[#C8941A] px-4 py-2 text-sm font-medium text-white hover:bg-[#b3820f] disabled:cursor-not-allowed disabled:opacity-40">
            Usar no item
          </button>
        </div>
      </div>
    </div>
  );
}
