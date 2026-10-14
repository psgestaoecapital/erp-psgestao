"use client";
// Hub · HB2 — editor das regras da Calculadora por empresa (incluir/editar/restaurar). Valores de referência de mercado, a validar.
import { useEffect, useState } from "react";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { supabaseBrowser } from "@/lib/authFetch";
import { mesclarRegras, regrasReferencia, type SistemaCalc } from "@/lib/calculadora/regras-empresa";
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
  const [validada, setValidada] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    const atual = mesclarRegras(ref, regraSalva);
    const v: Record<string, string> = {};
    for (const c of CAMPOS_REGRA[sistema]) v[c.caminho] = String(lerCampo(atual, c.caminho) ?? "").replace(".", ",");
    setValores(v); setMsg(null);
  }, [ref, sistema, regraSalva]);

  async function salvar() {
    const r = montarRegras(ref, valores, sistema);
    if (!r.ok) { setMsg({ ok: false, texto: r.erro }); return; }
    setOcupado(true);
    const { data, error } = await supabaseBrowser().rpc("fn_calc_regra_salvar", { p_company_id: companyId, p_sistema: sistema, p_regras: r.regras, p_validada: validada });
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
