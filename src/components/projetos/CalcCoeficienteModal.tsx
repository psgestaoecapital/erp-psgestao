// src/components/projetos/CalcCoeficienteModal.tsx
// PR 2 do CPU (CEO 24/11) — calculadora do coeficiente de consumo (Qtd) de um item do BOM.
// 5 formas: Direto, Rendimento, Consumo técnico, Vida útil/período, Por pessoa x tempo.
// Calcula a Qtd (coeficiente por unidade do serviço, ex. por m2), mostra o custo/unidade e
// preenche a observação com a conta. Genérico para qualquer vertical do Hub. RD-95/96/98/100, mobile.
"use client";

import { useState } from "react";
import { X, Calculator } from "lucide-react";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { parseNumBR } from "@/lib/num";

const ROTA_AJUDA = "/dashboard/projetos/catalogo/[id]";

export type MetodoCoef = "manual" | "rendimento" | "tecnico" | "vida_util" | "por_pessoa";

export interface CoefResultado {
  quantidade: number;
  metodo_coeficiente: MetodoCoef;
  periodo_valor: number | null;
  periodo_unidade: "dias" | "horas" | "meses" | null;
  qtd_por_periodo: number | null;
  observacao: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  itemNome: string;
  unidadeServico: string | null; // unidade da produtividade (ex.: m2)
  unidadeItem: string | null; // unidade do item (ex.: un, kg)
  custoUnitario: number | null; // custo de 1 unidade do item
  produtividade: number | null; // produtividade_unidade_dia do serviço
  equipePadrao: string | null; // texto livre; tentamos extrair o nº de pessoas
  diasUteisMes: number; // config da empresa (padrão 22)
  horasDia?: number; // jornada; padrão 8
  atual: {
    quantidade: number | null;
    metodo_coeficiente?: MetodoCoef;
    periodo_valor?: number | null;
    periodo_unidade?: "dias" | "horas" | "meses" | null;
    qtd_por_periodo?: number | null;
    observacao?: string;
  };
  onConfirm: (r: CoefResultado) => void;
}

function num(s: string): number | null {
  return parseNumBR(s);
}
function fmtCoef(v: number): string {
  // coeficiente costuma ser pequeno (ex.: 0,000265) — até 6 casas, sem lixo
  return Number(v.toFixed(6)).toLocaleString("pt-BR", { maximumFractionDigits: 6 });
}
function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function pessoasDeEquipe(txt: string | null): number {
  if (!txt) return 1;
  const m = txt.match(/\d+/);
  return m ? Math.max(1, parseInt(m[0], 10)) : 1;
}

export function CalcCoeficienteModal({
  open, onClose, itemNome, unidadeServico, unidadeItem, custoUnitario,
  produtividade, equipePadrao, diasUteisMes, horasDia = 8, atual, onConfirm,
}: Props) {
  const un = unidadeServico || "un";
  const [metodo, setMetodo] = useState<MetodoCoef>((atual.metodo_coeficiente as MetodoCoef) || "manual");
  // campos por método
  const [direto, setDireto] = useState<string>(atual.quantidade != null ? String(atual.quantidade) : "");
  const [rendimento, setRendimento] = useState<string>(""); // 1 un rende Y
  const [tecnico, setTecnico] = useState<string>(""); // X por unidade
  const [periodoValor, setPeriodoValor] = useState<string>(atual.periodo_valor != null ? String(atual.periodo_valor) : "");
  const [periodoUnidade, setPeriodoUnidade] = useState<"dias" | "horas" | "meses">(
    (atual.periodo_unidade as "dias" | "horas" | "meses") || "meses"
  );
  const [qtdPeriodo, setQtdPeriodo] = useState<string>(atual.qtd_por_periodo != null ? String(atual.qtd_por_periodo) : "1");
  const [pessoas, setPessoas] = useState<string>(String(pessoasDeEquipe(equipePadrao)));
  const [obsManual, setObsManual] = useState<string | null>(null);

  const diasNoPeriodo = (valor: number, unidade: string): number => {
    if (unidade === "dias") return valor;
    if (unidade === "horas") return valor / (horasDia || 8);
    return valor * diasUteisMes; // meses
  };

  const calc = ((): { coef: number | null; obs: string; custoUn: number | null } => {
    const prod = produtividade ?? 0;
    const cu = custoUnitario ?? 0;
    let coef: number | null = null;
    let obs = "";
    if (metodo === "manual") {
      coef = num(direto);
      obs = obsManual ?? "";
    } else if (metodo === "rendimento") {
      const y = num(rendimento);
      if (y && y > 0) { coef = 1 / y; obs = `Rendimento: 1 ${unidadeItem || "un"} rende ${fmtCoef(y)} ${un} → coeficiente = 1 ÷ ${fmtCoef(y)} = ${fmtCoef(coef)}/${un}.`; }
    } else if (metodo === "tecnico") {
      const x = num(tecnico);
      if (x != null) { coef = x; obs = `Consumo técnico (ficha do fabricante): ${fmtCoef(x)} ${unidadeItem || "un"} por ${un}.`; }
    } else if (metodo === "vida_util" || metodo === "por_pessoa") {
      const pv = num(periodoValor);
      const qp = num(qtdPeriodo);
      const np = metodo === "por_pessoa" ? (num(pessoas) ?? 1) : 1;
      if (pv && pv > 0 && qp != null && prod > 0) {
        const dias = diasNoPeriodo(pv, periodoUnidade);
        const m2Periodo = prod * dias;
        const itens = qp * np;
        if (m2Periodo > 0) {
          coef = itens / m2Periodo;
          const porPessoa = metodo === "por_pessoa" ? `${fmtCoef(qp)}/pessoa × ${np} pessoa(s) = ${fmtCoef(itens)}` : `${fmtCoef(qp)} no período`;
          obs = `Vida útil ${fmtCoef(pv)} ${periodoUnidade} = ${fmtCoef(dias)} dias úteis (dias úteis/mês = ${diasUteisMes}${periodoUnidade === "horas" ? `, jornada ${horasDia}h/dia` : ""}); produtividade ${fmtCoef(prod)} ${un}/dia → ${fmtCoef(m2Periodo)} ${un} no período. Itens: ${porPessoa}. Coeficiente = ${fmtCoef(itens)} ÷ ${fmtCoef(m2Periodo)} = ${fmtCoef(coef)}/${un}.`;
        }
      }
    }
    const custoUn = coef != null ? coef * cu : null;
    return { coef, obs, custoUn };
  })();

  if (!open) return null;

  const faltaProd = (metodo === "vida_util" || metodo === "por_pessoa") && !(produtividade && produtividade > 0);
  const podeConfirmar = calc.coef != null && calc.coef >= 0 && !faltaProd;

  function confirmar() {
    if (calc.coef == null) return;
    const porPeriodo = metodo === "vida_util" || metodo === "por_pessoa";
    onConfirm({
      quantidade: Number(calc.coef.toFixed(6)),
      metodo_coeficiente: metodo,
      periodo_valor: porPeriodo ? num(periodoValor) : null,
      periodo_unidade: porPeriodo ? periodoUnidade : null,
      qtd_por_periodo: porPeriodo ? num(qtdPeriodo) : null,
      observacao: metodo === "manual" ? (obsManual ?? "") : calc.obs,
    });
  }

  const inputCls = "w-full rounded-lg !border !border-[#3D2314]/15 !bg-white px-3 py-2 text-sm !text-[#3D2314] focus:!border-[#C8941A] focus:outline-none";
  const metodos: Array<{ id: MetodoCoef; titulo: string; desc: string }> = [
    { id: "manual", titulo: "Direto", desc: "Digito o consumo por " + un + " (como hoje)." },
    { id: "rendimento", titulo: "Rendimento do insumo", desc: "1 unidade rende Y " + un + " → 1 ÷ Y." },
    { id: "tecnico", titulo: "Consumo técnico", desc: "Ficha do fabricante: X por " + un + "." },
    { id: "vida_util", titulo: "Vida útil / período", desc: "Dura X tempo; consumo ÷ " + un + " produzidos no período." },
    { id: "por_pessoa", titulo: "Por pessoa × tempo", desc: "Pessoas × consumo no período ÷ " + un + " do período." },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-[#FAF7F2] p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold text-[#3D2314]">
            <Calculator size={18} className="text-[#C8941A]" /> Calcular consumo
          </h3>
          <button onClick={onClose} aria-label="Fechar" className="rounded-lg p-1.5 text-[#3D2314]/60 hover:bg-[#3D2314]/5">
            <X size={18} />
          </button>
        </div>
        <p className="mb-3 text-xs text-[#3D2314]/60">{itemNome} — consumo por <b>{un}</b> do serviço.</p>

        {/* método */}
        <div data-ajuda="projetos.catalogo.bom.metodo_coeficiente" className="mb-4">
          <label className="mb-1.5 flex items-center gap-1 text-xs font-medium text-[#3D2314]/70">
            Como calcular? <AjudaCampo chave="projetos.catalogo.bom.metodo_coeficiente" rota={ROTA_AJUDA} />
          </label>
          <div className="grid grid-cols-1 gap-1.5">
            {metodos.map((m) => (
              <button
                key={m.id}
                onClick={() => setMetodo(m.id)}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition ${metodo === m.id ? "border-[#C8941A] bg-[#C8941A]/10 text-[#3D2314]" : "border-[#3D2314]/12 bg-white text-[#3D2314]/80 hover:border-[#3D2314]/25"}`}
              >
                <span className="font-medium">{m.titulo}</span>
                <span className="block text-xs text-[#3D2314]/55">{m.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* campos por método */}
        {metodo === "manual" && (
          <div data-ajuda="projetos.catalogo.bom.observacao" className="mb-3">
            <label className="mb-1 block text-xs font-medium text-[#3D2314]/70">Consumo por {un}</label>
            <input className={inputCls} inputMode="decimal" value={direto} onChange={(e) => setDireto(e.target.value)} placeholder={`ex.: 0,05 por ${un}`} aria-label="Consumo por unidade" />
          </div>
        )}
        {metodo === "rendimento" && (
          <div data-ajuda="projetos.catalogo.bom.metodo_coeficiente" className="mb-3">
            <label className="mb-1 block text-xs font-medium text-[#3D2314]/70">1 {unidadeItem || "unidade"} rende quantos {un}?</label>
            <input className={inputCls} inputMode="decimal" value={rendimento} onChange={(e) => setRendimento(e.target.value)} placeholder={`ex.: 20 (1 balde rende 20 ${un})`} aria-label="Rendimento por unidade" />
          </div>
        )}
        {metodo === "tecnico" && (
          <div data-ajuda="projetos.catalogo.bom.metodo_coeficiente" className="mb-3">
            <label className="mb-1 block text-xs font-medium text-[#3D2314]/70">Consumo técnico por {un} ({unidadeItem || "un"})</label>
            <input className={inputCls} inputMode="decimal" value={tecnico} onChange={(e) => setTecnico(e.target.value)} placeholder={`ex.: 1,2 por ${un}`} aria-label="Consumo técnico por unidade" />
          </div>
        )}
        {(metodo === "vida_util" || metodo === "por_pessoa") && (
          <div className="mb-3 space-y-3">
            <div data-ajuda="projetos.catalogo.bom.periodo" className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 flex items-center gap-1 text-xs font-medium text-[#3D2314]/70">Vida útil <AjudaCampo chave="projetos.catalogo.bom.periodo" rota={ROTA_AJUDA} /></label>
                <input className={inputCls} inputMode="decimal" value={periodoValor} onChange={(e) => setPeriodoValor(e.target.value)} placeholder="ex.: 6" aria-label="Período de vida útil" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#3D2314]/70">Unidade</label>
                <select className={inputCls} value={periodoUnidade} onChange={(e) => setPeriodoUnidade(e.target.value as "dias" | "horas" | "meses")} aria-label="Unidade do período">
                  <option value="meses">meses</option>
                  <option value="dias">dias</option>
                  <option value="horas">horas</option>
                </select>
              </div>
            </div>
            <div data-ajuda="projetos.catalogo.bom.qtd_por_periodo">
              <label className="mb-1 flex items-center gap-1 text-xs font-medium text-[#3D2314]/70">
                Quantidade {metodo === "por_pessoa" ? "por pessoa" : "no período"} <AjudaCampo chave="projetos.catalogo.bom.qtd_por_periodo" rota={ROTA_AJUDA} />
              </label>
              <input className={inputCls} inputMode="decimal" value={qtdPeriodo} onChange={(e) => setQtdPeriodo(e.target.value)} placeholder="ex.: 1" aria-label="Quantidade por período" />
            </div>
            {metodo === "por_pessoa" && (
              <div data-ajuda="projetos.catalogo.bom.metodo_coeficiente">
                <label className="mb-1 block text-xs font-medium text-[#3D2314]/70">Pessoas na equipe</label>
                <input className={inputCls} inputMode="numeric" value={pessoas} onChange={(e) => setPessoas(e.target.value)} aria-label="Pessoas na equipe" />
                {equipePadrao && <p className="mt-1 text-[11px] text-[#3D2314]/50">Equipe padrão do serviço: {equipePadrao}</p>}
              </div>
            )}
            {faltaProd && (
              <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                Informe a <b>produtividade (por dia)</b> do serviço para calcular por período.
              </p>
            )}
          </div>
        )}

        {/* prévia */}
        {calc.coef != null && !faltaProd && (
          <div className="mb-3 rounded-xl border border-[#C8941A]/30 bg-[#C8941A]/5 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-[#3D2314]/70">Coeficiente (Qtd)</span>
              <span className="font-mono font-semibold text-[#3D2314]">{fmtCoef(calc.coef)} / {un}</span>
            </div>
            {calc.custoUn != null && (
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[#3D2314]/70">Custo por {un}</span>
                <span className="font-mono text-[#3D2314]">{fmtBRL(calc.custoUn)}</span>
              </div>
            )}
          </div>
        )}

        {/* observação (auto, editável) */}
        <div data-ajuda="projetos.catalogo.bom.observacao" className="mb-4">
          <label className="mb-1 flex items-center gap-1 text-xs font-medium text-[#3D2314]/70">
            Observação do cálculo <AjudaCampo chave="projetos.catalogo.bom.observacao" rota={ROTA_AJUDA} />
          </label>
          <textarea
            className={inputCls + " min-h-[64px] resize-y"}
            value={metodo === "manual" ? (obsManual ?? "") : (obsManual ?? calc.obs)}
            onChange={(e) => setObsManual(e.target.value)}
            placeholder="Como o consumo foi calculado (preenchido automaticamente nos métodos de cálculo)."
            aria-label="Observação do cálculo"
          />
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg border border-[#3D2314]/15 bg-white px-4 py-2 text-sm font-medium text-[#3D2314]/80 hover:bg-[#3D2314]/5">
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={!podeConfirmar}
            className="flex-1 rounded-lg bg-[#3D2314] px-4 py-2 text-sm font-medium text-[#FAF7F2] hover:bg-[#3D2314]/90 disabled:opacity-40"
          >
            Aplicar ao item
          </button>
        </div>
      </div>
    </div>
  );
}
