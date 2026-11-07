"use client";

// Hub · HB2 — Calculadora de Obra PS (fatia 5b): editar as regras da empresa (perda, rendimentos, embalagens).
// Grava em erp_calc_regra via fn_calc_regra_salvar; "Voltar à referência" remove a regra própria. "?" em todo campo (RD-95).
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { supabaseBrowser } from "@/lib/authFetch";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { mesclarRegras, regrasReferencia, type SistemaCalc } from "@/lib/calculadora/regras-empresa";
import { CAMPOS_REGRA } from "@/lib/calculadora/campos-regra";

const ROTA = "/dashboard/projetos/calculadora/regras";
const toStr = (v: number) => String(v).replace(".", ",");
const toNum = (s: string) => Number(s.replace(",", "."));

export default function RegrasCalculadoraPage() {
  const { sel } = useCompanyIds();
  const companyId = sel && !sel.startsWith("group_") && sel !== "consolidado" ? sel : null;
  const [sistema, setSistema] = useState<SistemaCalc>("parede");
  const [salva, setSalva] = useState<unknown>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [validada, setValidada] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const campos = CAMPOS_REGRA[sistema];
  const ref = regrasReferencia(sistema) as unknown as Record<string, number>;

  const carregar = useCallback(async () => {
    setMsg(null);
    if (!companyId) { setSalva(null); return; }
    const { data } = await supabaseBrowser().from("erp_calc_regra").select("regras,validada").eq("company_id", companyId).eq("sistema", sistema).maybeSingle();
    setSalva(data?.regras ?? null);
    setValidada(!!data?.validada);
  }, [companyId, sistema]);
  useEffect(() => { void carregar(); }, [carregar]);

  const atuais = useMemo(() => mesclarRegras(regrasReferencia(sistema), salva) as unknown as Record<string, number>, [sistema, salva]);
  useEffect(() => { setValores(Object.fromEntries(campos.map((c) => [c.chave, toStr(atuais[c.chave])]))); }, [atuais, campos]);

  async function salvar() {
    if (!companyId) return;
    const regras: Record<string, number> = {};
    for (const c of campos) {
      const v = toNum(valores[c.chave] ?? "");
      if (!Number.isFinite(v) || v < 0 || (c.minimoExclusivo && v <= 0)) { setMsg({ ok: false, texto: `Valor inválido em "${c.rotulo}".` }); return; }
      regras[c.chave] = v;
    }
    const { data, error } = await supabaseBrowser().rpc("fn_calc_regra_salvar", { p_company_id: companyId, p_sistema: sistema, p_regras: regras, p_validada: validada });
    if (error || !data?.ok) { setMsg({ ok: false, texto: "Não consegui salvar: " + (error?.message ?? data?.erro) }); return; }
    setMsg({ ok: true, texto: "Regras salvas. A calculadora já usa os novos valores." });
    await carregar();
  }

  async function restaurar() {
    if (!companyId) return;
    const { data, error } = await supabaseBrowser().rpc("fn_calc_regra_restaurar", { p_company_id: companyId, p_sistema: sistema });
    if (error || !data?.ok) { setMsg({ ok: false, texto: "Não consegui restaurar: " + (error?.message ?? data?.erro) }); return; }
    setMsg({ ok: true, texto: "Voltou à referência de mercado." });
    await carregar();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 text-[#2A1A10]">
      <div className="mb-1 flex items-center gap-2"><SlidersHorizontal size={20} className="text-[#C8941A]" /><h1 className="text-xl font-semibold text-[#C8941A]">Regras da calculadora</h1></div>
      <p className="mb-4 text-sm text-[#7A6A5E]">Ajuste perda, rendimentos e embalagens à realidade da sua empresa. Sem regra própria, vale a referência de mercado (a validar com o fabricante). <Link href="/dashboard/projetos/calculadora" className="underline">Voltar à calculadora</Link></p>
      {!companyId && <p className="rounded-lg border border-[#E8E2D6] bg-white p-3 text-sm">Selecione uma empresa (não grupo) para editar as regras.</p>}
      <div className="mb-4 flex gap-2" role="tablist">
        {(["parede", "forro_f530"] as const).map((s) => (
          <button key={s} role="tab" aria-selected={sistema === s} data-testid={`regras-sistema-${s}`} onClick={() => setSistema(s)}
            className={`rounded-lg border px-3 py-2 text-sm ${sistema === s ? "border-[#C8941A] bg-[#C8941A]/10 font-medium" : "border-[#E8E2D6] bg-white"}`}>
            {s === "parede" ? "Parede simples" : "Forro F530"}
          </button>
        ))}
      </div>
      <div className="grid gap-3 rounded-xl border border-[#E8E2D6] bg-white p-4 sm:grid-cols-2">
        {campos.map((c) => (
          <label key={c.chave} className="block">
            <span className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wider text-[#7A6A5E]">{c.rotulo} <span className="normal-case">({c.unidade})</span><AjudaCampo chave={`projetos.calculadora.regra.${c.chave}`} rota={ROTA} /></span>
            <input inputMode="decimal" value={valores[c.chave] ?? ""} data-testid={`regra-${c.chave}`} disabled={!companyId}
              onChange={(e) => setValores((v) => ({ ...v, [c.chave]: e.target.value.replace(/[^\d.,]/g, "") }))}
              className="w-full rounded-lg border border-[#E8E2D6] bg-white px-3 py-2 text-right font-mono text-sm focus:border-[#C8941A] focus:outline-none" />
            <span className="mt-0.5 block text-[11px] text-[#7A6A5E]">Referência: {toStr(ref[c.chave])}</span>
          </label>
        ))}
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={validada} onChange={(e) => setValidada(e.target.checked)} data-testid="regra-validada" />
        Validada com o fabricante <AjudaCampo chave="projetos.calculadora.regra.validada" rota={ROTA} />
      </label>
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={salvar} disabled={!companyId} data-testid="regra-salvar" className="rounded-lg bg-[#3D2314] px-4 py-2 text-sm text-white disabled:opacity-40">Salvar regras</button>
        <button onClick={restaurar} disabled={!companyId} data-testid="regra-restaurar" className="rounded-lg border border-[#E8E2D6] bg-white px-4 py-2 text-sm disabled:opacity-40">Voltar à referência</button>
        <AjudaCampo chave="projetos.calculadora.regra.restaurar" rota={ROTA} />
      </div>
      {msg && <p role="status" className={`mt-3 text-sm ${msg.ok ? "text-[#1baf7a]" : "text-[#c0392b]"}`}>{msg.texto}</p>}
    </div>
  );
}
