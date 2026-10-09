"use client";

// Hub · Calculadora de Obra PS (HB2, Parte O) — fatia 2: tela de parede simples e forro F530 sobre o motor com regras como dado.
// Mostra "ver a conta" em cada item, unidade de compra e quantidade real. Parâmetros avançados ficam recolhidos.
import { useMemo, useState } from "react";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import {
  REGRAS_FORRO_F530, REGRAS_PAREDE_SIMPLES_ST, calcularForroF530, calcularParede, type Resultado,
} from "@/lib/calculadora/motor";

type Sistema = "parede" | "forro";
const n = (v: string) => { const x = parseFloat(v.replace(",", ".")); return Number.isFinite(x) ? x : 0; };
const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

const campo = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 focus:border-amber-600 focus:outline-none";
const rotulo = "mb-1 flex items-center gap-1.5 text-sm font-medium text-slate-700";

export default function CalculadoraObraPage() {
  const [sistema, setSistema] = useState<Sistema>("parede");
  const [comp, setComp] = useState("12,5");
  const [pd, setPd] = useState("2,8");
  const [vaos, setVaos] = useState("1,68");
  const [larg, setLarg] = useState("3");
  const [avancado, setAvancado] = useState(false);
  const [perda, setPerda] = useState("1,05");

  const res: Resultado = useMemo(() => {
    const p = n(perda) > 0 ? n(perda) : 1.05;
    if (sistema === "parede") {
      return calcularParede({ ...REGRAS_PAREDE_SIMPLES_ST, perda: p }, { comprimento: n(comp), peDireito: n(pd), vaos: n(vaos) });
    }
    return calcularForroF530({ ...REGRAS_FORRO_F530, perda: p }, { largura: n(larg), comprimento: n(comp) });
  }, [sistema, comp, pd, vaos, larg, perda]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
      <h1 className="text-2xl font-semibold text-slate-900">Calculadora de obra</h1>
      <p className="mt-1 text-sm text-slate-600">Quantidade de material por sistema, com a conta aberta em cada item.</p>

      <div className="mt-5 inline-flex rounded-lg border border-slate-300 bg-white p-1" role="tablist">
        {([["parede", "Parede simples"], ["forro", "Forro F530"]] as const).map(([k, t]) => (
          <button key={k} role="tab" aria-selected={sistema === k} onClick={() => setSistema(k)}
            className={`rounded-md px-4 py-2 text-sm font-medium ${sistema === k ? "bg-slate-900 text-white" : "text-slate-700"}`}>{t}</button>
        ))}
      </div>

      <section className="mt-5 grid gap-4 sm:grid-cols-3">
        {sistema === "forro" && (
          <label className="block"><span className={rotulo}>Largura (m)<AjudaCampo chave="projetos.calculadora.largura" /></span>
            <input className={campo} inputMode="decimal" value={larg} onChange={e => setLarg(e.target.value)} /></label>
        )}
        <label className="block"><span className={rotulo}>Comprimento (m)<AjudaCampo chave="projetos.calculadora.comprimento" /></span>
          <input className={campo} inputMode="decimal" value={comp} onChange={e => setComp(e.target.value)} /></label>
        {sistema === "parede" && (
          <>
            <label className="block"><span className={rotulo}>Pé-direito (m)<AjudaCampo chave="projetos.calculadora.pe_direito" /></span>
              <input className={campo} inputMode="decimal" value={pd} onChange={e => setPd(e.target.value)} /></label>
            <label className="block"><span className={rotulo}>Vãos a descontar (m²)<AjudaCampo chave="projetos.calculadora.vaos" /></span>
              <input className={campo} inputMode="decimal" value={vaos} onChange={e => setVaos(e.target.value)} /></label>
          </>
        )}
      </section>

      <button onClick={() => setAvancado(v => !v)} className="mt-4 text-sm font-medium text-amber-700 underline">
        {avancado ? "Ocultar parâmetros avançados" : "Parâmetros avançados"}
      </button>
      {avancado && (
        <div className="mt-3 max-w-xs">
          <label className="block"><span className={rotulo}>Fator de perda<AjudaCampo chave="projetos.calculadora.perda" /></span>
            <input className={campo} inputMode="decimal" value={perda} onChange={e => setPerda(e.target.value)} /></label>
        </div>
      )}

      <section className="mt-6" aria-live="polite">
        {!res.ok ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{res.erro}</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-700">Área considerada: <strong>{fmt(res.area)} m²</strong></p>
            <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
              {res.itens.map(i => (
                <li key={i.chave} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-slate-900">{i.descricao}</span>
                    <span className="text-lg font-semibold text-slate-900">{i.quantidade} <span className="text-sm font-normal text-slate-600">{i.unidadeCompra}</span></span>
                  </div>
                  <details className="mt-1 text-sm text-slate-600">
                    <summary className="cursor-pointer text-amber-700">Ver a conta</summary>
                    <p className="mt-1">{i.conta} = {fmt(i.quantidadeBruta)}, arredondado para cima.</p>
                  </details>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">Coeficientes de referência de mercado, a validar com o fabricante da empresa.</p>
          </>
        )}
      </section>
    </main>
  );
}
