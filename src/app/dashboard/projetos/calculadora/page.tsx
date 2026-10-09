"use client";

// Hub de Projetos · HB2 — Calculadora de Obra PS (fatia 2: tela). Parede simples e forro F530 sobre o motor de
// src/lib/calculadora/motor.ts (regras como dado; coeficientes de referência a validar). "Ver a conta" em cada item.
import { useMemo, useState } from "react";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import {
  REGRAS_FORRO_F530, REGRAS_PAREDE_SIMPLES_ST, calcularForroF530, calcularParede, type Resultado,
} from "@/lib/calculadora/motor";

const n = (v: string) => parseFloat(v.replace(",", ".")) || 0;
const campo = "w-full rounded-lg border border-neutral-300 px-3 py-2 text-base";

function Campo({ rotulo, chave, valor, set }: { rotulo: string; chave: string; valor: string; set: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-sm font-medium">{rotulo}<AjudaCampo chave={chave} /></span>
      <input inputMode="decimal" className={campo} value={valor} onChange={(e) => set(e.target.value)} />
    </label>
  );
}

export default function CalculadoraObraPage() {
  const [sistema, setSistema] = useState<"parede" | "forro">("parede");
  const [comp, setComp] = useState("12,5");
  const [pd, setPd] = useState("2,8");
  const [vaos, setVaos] = useState("1,68");
  const [larg, setLarg] = useState("3");
  const [compF, setCompF] = useState("4");

  const res: Resultado = useMemo(
    () => sistema === "parede"
      ? calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: n(comp), peDireito: n(pd), vaos: n(vaos) })
      : calcularForroF530(REGRAS_FORRO_F530, { largura: n(larg), comprimento: n(compF) }),
    [sistema, comp, pd, vaos, larg, compF],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <header>
        <h1 className="text-2xl font-semibold">Calculadora de obra</h1>
        <p className="text-sm text-neutral-600">Digite as medidas e veja o material de compra, com a conta aberta. Coeficientes de referência de mercado, a validar com o fabricante.</p>
      </header>

      <label className="block">
        <span className="mb-1 flex items-center gap-1 text-sm font-medium">Sistema<AjudaCampo chave="projetos.calculadora.sistema" /></span>
        <select className={campo} value={sistema} onChange={(e) => setSistema(e.target.value as "parede" | "forro")}>
          <option value="parede">Parede simples</option>
          <option value="forro">Forro F530</option>
        </select>
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        {sistema === "parede" ? (<>
          <Campo rotulo="Comprimento (m)" chave="projetos.calculadora.comprimento" valor={comp} set={setComp} />
          <Campo rotulo="Pé-direito (m)" chave="projetos.calculadora.pe_direito" valor={pd} set={setPd} />
          <Campo rotulo="Vãos a descontar (m²)" chave="projetos.calculadora.vaos" valor={vaos} set={setVaos} />
        </>) : (<>
          <Campo rotulo="Largura (m)" chave="projetos.calculadora.largura" valor={larg} set={setLarg} />
          <Campo rotulo="Comprimento (m)" chave="projetos.calculadora.comprimento_forro" valor={compF} set={setCompF} />
        </>)}
      </div>

      {!res.ok ? (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{res.erro}</p>
      ) : (
        <section aria-label="Resultado">
          <p className="mb-2 text-sm text-neutral-600">Área: <strong>{res.area.toLocaleString("pt-BR")} m²</strong></p>
          <ul className="divide-y rounded-lg border">
            {res.itens.map((i) => (
              <li key={i.chave} className="p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{i.descricao}</span>
                  <span className="text-lg font-semibold">{i.quantidade} <span className="text-sm font-normal text-neutral-600">{i.unidadeCompra}</span></span>
                </div>
                <details className="mt-1 text-sm text-neutral-600">
                  <summary className="flex cursor-pointer items-center gap-1">Ver a conta<AjudaCampo chave="projetos.calculadora.ver_conta" /></summary>
                  <p className="mt-1">{i.conta} = {i.quantidadeBruta.toLocaleString("pt-BR")} → arredonda para cima: {i.quantidade}</p>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
