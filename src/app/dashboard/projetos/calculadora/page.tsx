"use client";

// Hub · HB2 — Calculadora de Obra PS (fatia 2: tela). Motor em src/lib/calculadora/motor.ts (regras como dado).
// Parede simples e forro F530. "Ver a conta" em cada item; unidade de compra + quantidade real; "?" em todo campo (RD-95).
import { useMemo, useState } from "react";
import { Calculator, AlertTriangle } from "lucide-react";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import {
  REGRAS_FORRO_F530, REGRAS_PAREDE_SIMPLES_ST, calcularForroF530, calcularParede, type Resultado,
} from "@/lib/calculadora/motor";

type Sistema = "parede" | "forro";
const n = (v: string) => Number((v || "0").replace(",", ".")) || 0
const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
const inCls = "w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-right font-mono text-sm text-[#3D2314] focus:border-[#C8941A] focus:outline-none";
const lbCls = "mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wider text-[#3D2314]/55";

function Campo({ rotulo, chave, valor, set, testid }: { rotulo: string; chave: string; valor: string; set: (v: string) => void; testid: string }) {
  return (
    <label className="block">
      <span className={lbCls}>{rotulo}<AjudaCampo chave={chave} rota="/dashboard/projetos/calculadora" /></span>
      <input inputMode="decimal" value={valor} data-testid={testid} onChange={(e) => set(e.target.value.replace(/[^\d.,]/g, ""))} className={inCls} />
    </label>
  );
}

export default function CalculadoraObraPage() {
  const [sistema, setSistema] = useState<Sistema>("parede");
  const [comp, setComp] = useState("12,5");
  const [pd, setPd] = useState("2,8");
  const [vaos, setVaos] = useState("1,68");
  const [larg, setLarg] = useState("3");
  const [compF, setCompF] = useState("4");
  const [avancado, setAvancado] = useState(false);

  const res: Resultado = useMemo(() => sistema === "parede"
    ? calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: n(comp), peDireito: n(pd), vaos: n(vaos) })
    : calcularForroF530(REGRAS_FORRO_F530, { largura: n(larg), comprimento: n(compF) }), [sistema, comp, pd, vaos, larg, compF]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex items-start gap-3">
        <div className="rounded-2xl bg-[#3D2314]/8 p-2.5"><Calculator size={20} className="text-[#C8941A]" /></div>
        <div>
          <h1 className="text-2xl font-medium text-[#3D2314]">Calculadora de Obra</h1>
          <p className="mt-0.5 text-sm text-[#3D2314]/60">Informe as medidas e veja quanto comprar, com a conta de cada item aberta.</p>
        </div>
      </header>

      <section className="mb-5 rounded-2xl border border-[#3D2314]/8 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist">
          <span className="text-[11px] uppercase tracking-wider text-[#3D2314]/55">Sistema<AjudaCampo chave="projetos.calculadora.sistema" rota="/dashboard/projetos/calculadora" /></span>
          {([["parede", "Parede simples (drywall)"], ["forro", "Forro de gesso F530"]] as const).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={sistema === k} data-testid={`calc-sistema-${k}`} onClick={() => setSistema(k)}
              className={`rounded-full px-3 py-1.5 text-sm ${sistema === k ? "bg-[#3D2314] text-white" : "bg-[#3D2314]/5 text-[#3D2314]"}`}>{t}</button>
          ))}
        </div>
        {sistema === "parede" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Campo rotulo="Comprimento (m)" chave="projetos.calculadora.comprimento" valor={comp} set={setComp} testid="calc-comprimento" />
            <Campo rotulo="Pé-direito (m)" chave="projetos.calculadora.pe_direito" valor={pd} set={setPd} testid="calc-pe-direito" />
            <Campo rotulo="Vãos a descontar (m²)" chave="projetos.calculadora.vaos" valor={vaos} set={setVaos} testid="calc-vaos" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo rotulo="Largura (m)" chave="projetos.calculadora.largura" valor={larg} set={setLarg} testid="calc-largura" />
            <Campo rotulo="Comprimento (m)" chave="projetos.calculadora.comprimento" valor={compF} set={setCompF} testid="calc-comprimento-forro" />
          </div>
        )}
        <button className="mt-4 text-sm text-[#3D2314]/70 underline" onClick={() => setAvancado(!avancado)} data-testid="calc-avancado">
          {avancado ? "Esconder" : "Mostrar"} parâmetros avançados<AjudaCampo chave="projetos.calculadora.avancado" rota="/dashboard/projetos/calculadora" />
        </button>
        {avancado && (
          <p className="mt-2 rounded-lg bg-[#FAF7F2] p-3 text-sm text-[#3D2314]/70">
            Regras de referência de mercado, <b>a validar com o fabricante</b>: perda {fmt((sistema === "parede" ? REGRAS_PAREDE_SIMPLES_ST : REGRAS_FORRO_F530).perda)}×,
            chapa de {fmt(2.16)} m². A edição por empresa vem na próxima fatia.
          </p>
        )}
      </section>

      {!res.ok ? (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800" data-testid="calc-erro"><AlertTriangle className="mb-0.5 mr-1 inline" size={15} />{res.erro}</div>
      ) : (
        <section className="rounded-2xl border border-[#3D2314]/8 bg-white p-5 shadow-sm" data-testid="calc-resultado">
          <h2 className="mb-3 text-base font-medium text-[#3D2314]">O que comprar <span className="text-sm text-[#3D2314]/50">· área {fmt(res.area)} m²</span><AjudaCampo chave="projetos.calculadora.resultado" rota="/dashboard/projetos/calculadora" /></h2>
          <ul className="divide-y divide-[#3D2314]/8">
            {res.itens.map((i) => (
              <li key={i.chave} className="py-2.5" data-testid={`calc-item-${i.chave}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-[#3D2314]">{i.descricao}</span>
                  <span className="font-mono text-sm text-[#3D2314]"><b data-testid={`calc-qtd-${i.chave}`}>{i.quantidade}</b> × {i.unidadeCompra}</span>
                </div>
                <details className="mt-1 text-xs text-[#3D2314]/60">
                  <summary className="cursor-pointer">ver a conta</summary>
                  {i.conta} = {fmt(i.quantidadeBruta)} → compra {i.quantidade}
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
