"use client";
// Calculadora de Obra PS (Hub HB2, blueprint Parte O) — fatia 2: tela sobre o motor (src/lib/calculadora/motor.ts).
// Parede simples e forro F530. Entradas mínimas na frente, "ver a conta" em cada item, unidade de compra + quantidade real.
// Regras ainda são as de referência (a validar com o fabricante); edição por empresa vem nas fatias seguintes.
import { useMemo, useState } from "react";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import {
  REGRAS_FORRO_F530, REGRAS_PAREDE_SIMPLES_ST, calcularForroF530, calcularParede, type Resultado,
} from "@/lib/calculadora/motor";

type Sistema = "parede" | "forro";
const num = (s: string) => { const n = parseFloat(s.replace(",", ".")); return Number.isFinite(n) ? n : 0; };

function Campo({ chave, rotulo, valor, onChange, sufixo }: { chave: string; rotulo: string; valor: string; onChange: (v: string) => void; sufixo?: string }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-[#3D2314]">{rotulo}<AjudaCampo chave={chave} /></span>
      <span className="flex items-center gap-2">
        <input inputMode="decimal" value={valor} onChange={e => onChange(e.target.value)}
          className="w-full rounded-lg border border-[#3D2314]/20 bg-white px-3 py-2.5 text-base text-[#3D2314] focus:border-[#C8941A] focus:outline-none" />
        {sufixo && <span className="text-sm text-[#3D2314]/60">{sufixo}</span>}
      </span>
    </label>
  );
}

export default function CalculadoraObraPage() {
  const [sistema, setSistema] = useState<Sistema>("parede");
  const [comp, setComp] = useState("12,5");
  const [pd, setPd] = useState("2,8");
  const [vaos, setVaos] = useState("1,68");
  const [larg, setLarg] = useState("3");
  const [compForro, setCompForro] = useState("4");
  const [conta, setConta] = useState<string | null>(null);

  const res: Resultado = useMemo(() => sistema === "parede"
    ? calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: num(comp), peDireito: num(pd), vaos: num(vaos) })
    : calcularForroF530(REGRAS_FORRO_F530, { largura: num(larg), comprimento: num(compForro) }),
  [sistema, comp, pd, vaos, larg, compForro]);

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-4 sm:px-6">
      <h1 className="text-2xl font-semibold text-[#3D2314]">Calculadora de Obra</h1>
      <p className="mt-1 text-sm text-[#3D2314]/65">Informe as medidas e veja o material já na unidade em que você compra.</p>

      <div className="mt-5 flex gap-2" role="tablist" aria-label="Sistema">
        {([["parede", "Parede simples"], ["forro", "Forro F530"]] as const).map(([k, t]) => (
          <button key={k} role="tab" aria-selected={sistema === k} onClick={() => { setSistema(k); setConta(null); }}
            className={`rounded-full px-4 py-2 text-sm font-medium ${sistema === k ? "bg-[#3D2314] text-white" : "bg-white text-[#3D2314] ring-1 ring-[#3D2314]/20"}`}>{t}</button>
        ))}
      </div>

      <div className="mt-5 grid gap-4 rounded-xl bg-white p-4 ring-1 ring-[#3D2314]/10 sm:grid-cols-3">
        {sistema === "parede" ? (<>
          <Campo chave="calc.parede.comprimento" rotulo="Comprimento da parede" valor={comp} onChange={setComp} sufixo="m" />
          <Campo chave="calc.parede.pe_direito" rotulo="Pé-direito" valor={pd} onChange={setPd} sufixo="m" />
          <Campo chave="calc.parede.vaos" rotulo="Vãos a descontar" valor={vaos} onChange={setVaos} sufixo="m²" />
        </>) : (<>
          <Campo chave="calc.forro.largura" rotulo="Largura do forro" valor={larg} onChange={setLarg} sufixo="m" />
          <Campo chave="calc.forro.comprimento" rotulo="Comprimento do forro" valor={compForro} onChange={setCompForro} sufixo="m" />
        </>)}
      </div>

      {!res.ok ? (
        <p role="alert" className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-800">{res.erro}</p>
      ) : (
        <section className="mt-5" aria-label="Material">
          <p className="mb-2 flex items-center gap-1.5 text-sm text-[#3D2314]/70">Área calculada: <b className="text-[#3D2314]">{res.area.toLocaleString("pt-BR")} m²</b><AjudaCampo chave="calc.resultado.area" /></p>
          <ul className="divide-y divide-[#3D2314]/10 rounded-xl bg-white ring-1 ring-[#3D2314]/10">
            {res.itens.map(i => (
              <li key={i.chave} className="p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-[#3D2314]">{i.descricao}</span>
                  <span className="text-right text-base font-semibold text-[#3D2314]">{i.quantidade} <span className="text-xs font-normal text-[#3D2314]/60">{i.unidadeCompra}</span></span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-[#3D2314]/60">
                  <span>necessário {i.quantidadeBruta.toLocaleString("pt-BR")}</span>
                  <button onClick={() => setConta(conta === i.chave ? null : i.chave)} className="font-medium text-[#C8941A] underline">ver a conta</button>
                  <AjudaCampo chave="calc.resultado.ver_conta" />
                </div>
                {conta === i.chave && <p className="mt-1 rounded bg-[#FAF7F2] p-2 text-xs text-[#3D2314]/80">{i.conta}</p>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-[#3D2314]/55">Coeficientes de referência de mercado, a validar com o fabricante. Perda de 5% já incluída.</p>
        </section>
      )}
    </div>
  );
}
