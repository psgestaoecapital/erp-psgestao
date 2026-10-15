"use client";
// Hub · HB2 — editor das regras da Calculadora por empresa (incluir/editar/restaurar). Valores de referência de mercado, a validar.
import { useEffect, useState } from "react";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { supabaseBrowser } from "@/lib/authFetch";
import { mesclarRegras, regrasReferencia, type SistemaCalc } from "@/lib/calculadora/regras-empresa";
import { BITOLAS, ESPACAMENTOS, MAX_FAIXAS, faixasIguais, faixasParaForm, montarFaixas, type FaixaForm } from "@/lib/calculadora/faixas-editor";
import type { RegrasParede } from "@/lib/calculadora/motor";
import { CAMPOS_REGRA, chaveAjudaRegra, lerCampo, montarRegras } from "@/lib/calculadora/campos-regras";

const ROTA = "/dashboard/projetos/calculadora";

function CampoRegra({ rotulo, unidade, chave, valor, set, testid }: { rotulo: string; unidade: string; chave: string; valor: string; set: (v: string) => void; testid: string }) {
  return (
    <label className="block">
      <span className="flex items-center text-[11px] uppercase tracking-wider text-[#3D2314]/55">{rotulo} ({unidade})<AjudaCampo chave={chave} rota={ROTA} /></span>
      <input value={valor} onChange={(e) => set(e.target.value)} inputMode="decimal" data-testid={testid}
        className="mt-1 w-full rounded-lg border border-[#3D2314]/12 bg-white px-2.5 py-1.5 text-sm" />
    </label>
  );
}

export default function EditorRegras({ companyId, sistema, regraSalva, aoSalvar }: { companyId: string; sistema: SistemaCalc; regraSalva: unknown; aoSalvar: () => void }) {
  const ref = regrasReferencia(sistema);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [faixas, setFaixas] = useState<FaixaForm[]>([]);
  const [validada, setValidada] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    const atual = mesclarRegras(ref, regraSalva);
    const v: Record<string, string> = {};
    for (const c of CAMPOS_REGRA[sistema]) v[c.caminho] = String(lerCampo(atual, c.caminho) ?? "").replace(".", ",");
    if (sistema === "parede") setFaixas(faixasParaForm((atual as RegrasParede).faixas));
    setValores(v); setMsg(null);
  }, [ref, sistema, regraSalva]);

  async function salvar() {
    const r = montarRegras(ref, valores, sistema);
    if (!r.ok) { setMsg({ ok: false, texto: r.erro }); return; }
    const regras: Record<string, unknown> = { ...r.regras };
    if (sistema === "parede") {
      const fx = montarFaixas(faixas);
      if (!fx.ok) { setMsg({ ok: false, texto: fx.erro }); return; }
      if (!faixasIguais(fx.faixas, (ref as RegrasParede).faixas)) regras.faixas = fx.faixas;
    }
    setOcupado(true);
    const { data, error } = await supabaseBrowser().rpc("fn_calc_regra_salvar", { p_company_id: companyId, p_sistema: sistema, p_regras: regras, p_validada: validada });
    setOcupado(false);
    const d = data as { ok?: boolean; erro?: string } | null;
    if (error || !d?.ok) { setMsg({ ok: false, texto: "Não consegui salvar: " + (error?.message ?? d?.erro ?? "erro") }); return; }
    setMsg({ ok: true, texto: "Regras da sua empresa salvas." }); aoSalvar();
  }
  async function restaurar() {
    setOcupado(true);
    const { data, error } = await supabaseBrowser().rpc("fn_calc_regra_restaurar", { p_company_id: companyId, p_sistema: sistema });
    setOcupado(false);
    const d = data as { ok?: boolean; erro?: string } | null;
    if (error || !d?.ok) { setMsg({ ok: false, texto: "Não consegui restaurar: " + (error?.message ?? d?.erro ?? "erro") }); return; }
    setMsg({ ok: true, texto: "Voltou ao valor de referência de mercado." }); aoSalvar();
  }

  return (
    <div className="mt-3 rounded-xl border border-[#3D2314]/8 bg-[#FAF7F2] p-4" data-testid="calc-editor-regras">
      <p className="mb-3 text-sm text-[#3D2314]/70">Ajuste as regras da <b>sua empresa</b>. Os valores de referência de mercado estão <b>a validar com o fabricante</b>.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {CAMPOS_REGRA[sistema].map((c) => (
          <CampoRegra key={c.caminho} rotulo={c.rotulo} unidade={c.unidade} chave={chaveAjudaRegra(sistema, c.caminho)}
            valor={valores[c.caminho] ?? ""} set={(v) => setValores((o) => ({ ...o, [c.caminho]: v }))} testid={`calc-regra-${c.caminho}`} />
        ))}
      </div>
      {sistema === "parede" && (
        <div className="mt-4" data-testid="calc-faixas">
          <p className="flex items-center text-sm font-medium text-[#3D2314]">Faixas de pé-direito<AjudaCampo chave="projetos.calculadora.regra.parede.faixas" rota={ROTA} /></p>
          <div className="mt-2 space-y-2">
            {faixas.map((f, i) => {
              const set = (p: Partial<FaixaForm>) => setFaixas((o) => o.map((x, j) => (j === i ? { ...x, ...p } : x)));
              const cls = "w-full rounded-lg border border-[#3D2314]/12 bg-white px-2 py-1.5 text-sm";
              return (
                <div key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-6" data-testid={`calc-faixa-${i}`}>
                  <label className="block"><span className="flex items-center text-[11px] text-[#3D2314]/55">De (m)<AjudaCampo chave="projetos.calculadora.regra.parede.faixa.de" rota={ROTA} /></span>
                    <input className={cls} inputMode="decimal" value={f.de} onChange={(e) => set({ de: e.target.value })} data-testid={`calc-faixa-${i}-de`} /></label>
                  <label className="block"><span className="flex items-center text-[11px] text-[#3D2314]/55">Até (m)<AjudaCampo chave="projetos.calculadora.regra.parede.faixa.ate" rota={ROTA} /></span>
                    <input className={cls} inputMode="decimal" value={f.ate} onChange={(e) => set({ ate: e.target.value })} data-testid={`calc-faixa-${i}-ate`} /></label>
                  <label className="block"><span className="flex items-center text-[11px] text-[#3D2314]/55">Perfil<AjudaCampo chave="projetos.calculadora.regra.parede.faixa.bitola" rota={ROTA} /></span>
                    <select className={cls} value={f.bitola} onChange={(e) => set({ bitola: e.target.value })}>{BITOLAS.map((b) => <option key={b}>{b}</option>)}</select></label>
                  <label className="block"><span className="flex items-center text-[11px] text-[#3D2314]/55">Montante a cada<AjudaCampo chave="projetos.calculadora.regra.parede.faixa.espacamento" rota={ROTA} /></span>
                    <select className={cls} value={f.espacamento} onChange={(e) => set({ espacamento: e.target.value })}>{ESPACAMENTOS.map((x) => <option key={x} value={String(x)}>{String(x).replace(".", ",")} m</option>)}</select></label>
                  <label className="flex items-center gap-1 pb-2 text-sm text-[#3D2314]/70"><input type="checkbox" checked={f.duplo} onChange={(e) => set({ duplo: e.target.checked })} />Duplo<AjudaCampo chave="projetos.calculadora.regra.parede.faixa.duplo" rota={ROTA} /></label>
                  <button onClick={() => setFaixas((o) => o.filter((_, j) => j !== i))} data-testid={`calc-faixa-${i}-remover`} className="rounded-full bg-[#3D2314]/5 px-3 py-1.5 text-sm text-[#3D2314]">Remover<AjudaCampo chave="projetos.calculadora.regra.parede.faixa.remover" rota={ROTA} /></button>
                </div>
              );
            })}
          </div>
          <button onClick={() => setFaixas((o) => [...o, { de: "", ate: "", bitola: "M48", espacamento: "0.6", duplo: false }])} disabled={faixas.length >= MAX_FAIXAS} data-testid="calc-faixa-adicionar"
            className="mt-2 rounded-full bg-[#3D2314]/5 px-4 py-1.5 text-sm text-[#3D2314] disabled:opacity-40">Adicionar faixa<AjudaCampo chave="projetos.calculadora.regra.parede.faixa.adicionar" rota={ROTA} /></button>
        </div>
      )}
      <label className="mt-3 flex items-center gap-2 text-sm text-[#3D2314]/70">
        <input type="checkbox" checked={validada} onChange={(e) => setValidada(e.target.checked)} data-testid="calc-regra-validada" />
        <span className="flex items-center">Validei com o fabricante<AjudaCampo chave="projetos.calculadora.regra.validada" rota={ROTA} /></span>
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={() => void salvar()} disabled={ocupado} data-testid="calc-regra-salvar" className="rounded-full bg-[#3D2314] px-4 py-2 text-sm text-white disabled:opacity-40">
          Salvar regras<AjudaCampo chave="projetos.calculadora.regra.salvar" rota={ROTA} />
        </button>
        <button onClick={() => void restaurar()} disabled={ocupado} data-testid="calc-regra-restaurar" className="rounded-full bg-[#3D2314]/5 px-4 py-2 text-sm text-[#3D2314] disabled:opacity-40">
          Voltar à referência<AjudaCampo chave="projetos.calculadora.regra.restaurar" rota={ROTA} />
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`} data-testid="calc-regra-msg">{msg.texto}</span>}
      </div>
    </div>
  );
}
