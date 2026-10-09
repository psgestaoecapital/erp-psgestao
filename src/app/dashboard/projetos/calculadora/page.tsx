// src/app/dashboard/projetos/calculadora/page.tsx
// Hub · Calculadora de Obra PS (HB2, fatia 2): a tela do motor src/lib/hub/calculadoraObra.ts. Escolhe o sistema, informa as
// medidas e vê a lista de materiais já em unidade de compra, com a conta de cada item. Regras = dado (referência de mercado a validar).
"use client";

import { useMemo, useState } from "react";
import { Calculator } from "lucide-react";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { calcular, type SistemaRegra } from "@/lib/hub/calculadoraObra";
import { SISTEMAS_REFERENCIA } from "@/lib/hub/calculadoraObraReferencia";

const ROTA_AJUDA = "/dashboard/projetos/calculadora";
const numBR = (s: string) => { const n = Number(String(s ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const inp = "w-full border border-[#3D2314]/15 rounded-md px-2 py-2 text-[14px] text-[#3D2314] bg-white";

function Campo({ rotulo, ajuda, children }: { rotulo: string; ajuda: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-[12px]"><span className="text-[#3D2314]/70">{rotulo}<AjudaCampo chave={ajuda} rota={ROTA_AJUDA} /></span>{children}</label>;
}

export default function CalculadoraObraPage() {
  const [codigo, setCodigo] = useState(SISTEMAS_REFERENCIA[0].codigo);
  const [comp, setComp] = useState("12,5");
  const [alt, setAlt] = useState("2,8");
  const [vaos, setVaos] = useState("1,68");
  const [chapa, setChapa] = useState("2,16");
  const [perda, setPerda] = useState("1,05");
  const [avancado, setAvancado] = useState(false);

  const sistema: SistemaRegra = SISTEMAS_REFERENCIA.find((s) => s.codigo === codigo) ?? SISTEMAS_REFERENCIA[0];
  const forro = sistema.tipo === "forro";
  const r = useMemo(() => calcular(sistema, {
    comprimento: numBR(comp), altura: numBR(alt), vaos_m2: numBR(vaos),
    parametros: { chapa_m2: numBR(chapa) || sistema.parametros.chapa_m2, perda: numBR(perda) || sistema.parametros.perda },
  }), [sistema, comp, alt, vaos, chapa, perda]);

  return (
    <div className="px-6 pb-10 max-w-5xl" data-testid="calculadora-obra">
      <h1 className="flex items-center gap-2 text-[22px] font-semibold text-[#3D2314] mt-2"><Calculator size={22} /> Calculadora de obra</h1>
      <p className="text-[13px] text-[#3D2314]/60 mb-4">Informe as medidas e veja o que comprar, já em unidade de compra, com a conta de cada item. Coeficientes são referência de mercado a validar — cada empresa ajusta os seus.</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white border border-[#3D2314]/10 rounded-lg p-4">
        <Campo rotulo="Sistema" ajuda="projetos.calculadora.sistema">
          <select className={inp} value={codigo} onChange={(e) => setCodigo(e.target.value)} data-testid="calc-sistema">
            {SISTEMAS_REFERENCIA.map((s) => <option key={s.codigo} value={s.codigo}>{s.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo={forro ? "Comprimento do forro (m)" : "Comprimento da parede (m)"} ajuda="projetos.calculadora.comprimento">
          <input className={inp} inputMode="decimal" value={comp} onChange={(e) => setComp(e.target.value)} data-testid="calc-comprimento" />
        </Campo>
        <Campo rotulo={forro ? "Largura do forro (m)" : "Pé-direito (m)"} ajuda="projetos.calculadora.altura">
          <input className={inp} inputMode="decimal" value={alt} onChange={(e) => setAlt(e.target.value)} data-testid="calc-altura" />
        </Campo>
        <Campo rotulo="Vãos a descontar (m²)" ajuda="projetos.calculadora.vaos">
          <input className={inp} inputMode="decimal" value={vaos} onChange={(e) => setVaos(e.target.value)} data-testid="calc-vaos" />
        </Campo>
      </div>

      <button className="mt-3 text-[13px] text-[#3D2314]/70 underline" onClick={() => setAvancado(!avancado)}>{avancado ? "Esconder" : "Mostrar"} parâmetros avançados</button>
      {avancado && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2 bg-white border border-[#3D2314]/10 rounded-lg p-4">
          <Campo rotulo="Área da chapa (m²)" ajuda="projetos.calculadora.chapa">
            <input className={inp} inputMode="decimal" value={chapa} onChange={(e) => setChapa(e.target.value)} />
          </Campo>
          <Campo rotulo="Fator de perda" ajuda="projetos.calculadora.perda">
            <input className={inp} inputMode="decimal" value={perda} onChange={(e) => setPerda(e.target.value)} />
          </Campo>
        </div>
      )}

      <div className="mt-4">
        {!r.ok ? (
          <div className="rounded-md bg-amber-50 border border-amber-200 text-[13px] text-amber-900 p-3" data-testid="calc-erro">{r.erro}</div>
        ) : (
          <div className="bg-white border border-[#3D2314]/10 rounded-lg overflow-x-auto">
            <div className="px-4 pt-3 text-[13px] text-[#3D2314]/70">Área líquida: <b data-testid="calc-area">{r.area_liquida.toLocaleString("pt-BR")} m²</b></div>
            <table className="w-full text-[13px] mt-2" data-testid="calc-resultado">
              <thead><tr className="text-left text-[#3D2314]/60"><th className="px-4 py-2">Material</th><th className="px-2 text-right">Comprar</th><th className="px-2">Unidade</th><th className="px-4">Conta</th></tr></thead>
              <tbody>
                {r.linhas.map((l) => (
                  <tr key={l.codigo} className="border-t border-[#3D2314]/5" data-testid={`calc-linha-${l.codigo}`}>
                    <td className="px-4 py-2">{l.nome}</td>
                    <td className="px-2 text-right font-semibold">{l.quantidade_compra}</td>
                    <td className="px-2">{l.unidade_compra}</td>
                    <td className="px-4"><details><summary className="cursor-pointer text-[#3D2314]/60">ver a conta</summary><span className="text-[12px] text-[#3D2314]/70">{l.conta}</span></details></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
