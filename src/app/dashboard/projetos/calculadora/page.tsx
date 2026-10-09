// src/app/dashboard/projetos/calculadora/page.tsx
// Hub · Calculadora de Obra PS (blueprint Parte O, fatia 2): tela do motor src/lib/calculadora/motor.ts.
// Sistemas: parede simples e forro F530. Cada item tem "ver a conta". Regras de referência a validar com o fabricante.
"use client";

import { useMemo, useState } from "react";
import { Calculator, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import {
  calcularForroF530, calcularParede, REGRAS_FORRO_F530, REGRAS_PAREDE_SIMPLES_ST, type Resultado,
} from "@/lib/calculadora/motor";

const num = (s: string) => { const n = Number(String(s ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0 };
const inp = "w-full border border-[#3D2314]/15 rounded-md px-3 py-2 text-[14px] text-[#3D2314] bg-white";
const rot = "flex items-center gap-1.5 text-[13px] font-medium text-[#3D2314] mb-1";

export default function CalculadoraObraPage() {
  const [sistema, setSistema] = useState<"parede" | "forro">("parede");
  const [comprimento, setComprimento] = useState("12,5");
  const [peDireito, setPeDireito] = useState("2,8");
  const [vaos, setVaos] = useState("1,68");
  const [largura, setLargura] = useState("4");
  const [aberto, setAberto] = useState<string | null>(null);

  const r: Resultado = useMemo(() => sistema === "parede"
    ? calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: num(comprimento), peDireito: num(peDireito), vaos: num(vaos) })
    : calcularForroF530(REGRAS_FORRO_F530, { largura: num(largura), comprimento: num(comprimento) }),
  [sistema, comprimento, peDireito, vaos, largura]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <header className="flex items-center gap-3">
        <Calculator className="w-6 h-6 text-[#C8941A]" aria-hidden />
        <div>
          <h1 className="text-xl font-semibold text-[#3D2314]">Calculadora de obra</h1>
          <p className="text-[13px] text-[#3D2314]/70">Informe as medidas e veja o material a comprar, com a conta de cada item.</p>
        </div>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <span className={rot}>O que vai construir <AjudaCampo chave="projetos.calculadora.sistema" /></span>
          <div className="flex gap-2">
            {([["parede", "Parede de drywall"], ["forro", "Forro F530"]] as const).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setSistema(v)} aria-pressed={sistema === v}
                className={`px-3 py-2 rounded-md text-[13px] border ${sistema === v ? "bg-[#C8941A] border-[#C8941A] text-[#3D2314] font-medium" : "border-[#3D2314]/15 text-[#3D2314]"}`}>{l}</button>
            ))}
          </div>
        </div>
        <label>
          <span className={rot}>{sistema === "parede" ? "Comprimento (m)" : "Comprimento do ambiente (m)"} <AjudaCampo chave="projetos.calculadora.comprimento" /></span>
          <input className={inp} inputMode="decimal" value={comprimento} onChange={(e) => setComprimento(e.target.value)} />
        </label>
        {sistema === "parede" ? (
          <>
            <label>
              <span className={rot}>Pé-direito (m) <AjudaCampo chave="projetos.calculadora.pe_direito" /></span>
              <input className={inp} inputMode="decimal" value={peDireito} onChange={(e) => setPeDireito(e.target.value)} />
            </label>
            <label>
              <span className={rot}>Vãos a descontar (m²) <AjudaCampo chave="projetos.calculadora.vaos" /></span>
              <input className={inp} inputMode="decimal" value={vaos} onChange={(e) => setVaos(e.target.value)} />
            </label>
          </>
        ) : (
          <label>
            <span className={rot}>Largura do ambiente (m) <AjudaCampo chave="projetos.calculadora.largura" /></span>
            <input className={inp} inputMode="decimal" value={largura} onChange={(e) => setLargura(e.target.value)} />
          </label>
        )}
      </section>

      {!r.ok ? (
        <p role="alert" className="flex items-start gap-2 text-[13px] text-[#8A2D1B] bg-[#8A2D1B]/5 rounded-md p-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />{r.erro}
        </p>
      ) : (
        <section aria-live="polite" className="space-y-3">
          <h2 className="text-[15px] font-semibold text-[#3D2314]">
            Material para {r.area.toLocaleString("pt-BR")} m² <AjudaCampo chave="projetos.calculadora.resultado" />
          </h2>
          <ul className="divide-y divide-[#3D2314]/10 border border-[#3D2314]/10 rounded-lg bg-white">
            {r.itens.map((it) => (
              <li key={it.chave} className="px-4 py-3">
                <button type="button" className="w-full flex items-center justify-between gap-3 text-left"
                  onClick={() => setAberto(aberto === it.chave ? null : it.chave)} aria-expanded={aberto === it.chave}>
                  <span className="text-[14px] text-[#3D2314]">{it.descricao}</span>
                  <span className="flex items-center gap-2 text-[14px] font-medium text-[#3D2314] whitespace-nowrap">
                    {it.quantidade.toLocaleString("pt-BR")} {it.unidadeCompra}
                    {aberto === it.chave ? <ChevronDown className="w-4 h-4" aria-hidden /> : <ChevronRight className="w-4 h-4" aria-hidden />}
                  </span>
                </button>
                {aberto === it.chave && (
                  <p className="mt-2 text-[12.5px] text-[#3D2314]/75">
                    Conta: {it.conta} = {it.quantidadeBruta.toLocaleString("pt-BR")}, arredondado para cima por embalagem.
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-[#3D2314]/60">Coeficientes de referência de mercado, a validar com o fabricante (NBR 15758/14715).</p>
        </section>
      )}
    </div>
  );
}
