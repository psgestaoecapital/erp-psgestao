"use client";

// Aba "Precificação" das Configurações do módulo Projetos (Hub de Projetos · S0/S1).
// Lê/salva erp_precificacao_config por empresa/linha via fn_precificacao_config_obter /
// fn_precificacao_config_salvar. Tudo editável (princípio CEO: a conferência vem depois).
// custo_fixo R$/m² é DERIVADO do rateio (GE) — read-only aqui (RD-52, uma fonte de verdade).
import { useCallback, useEffect, useState } from "react";
import { DollarSign, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabaseBrowser } from "@/lib/authFetch";

type Linha = { id: string; nome: string };
type Cfg = Record<string, number | string | null> & { business_line_id: string | null };
type Obter = { ok: boolean; erro?: string; linhas?: Linha[]; config?: Cfg[] };

const CAMPO_KEYS = [
  "creditos_pct", "icms_pct", "pis_cofins_pct", "margem_material_pct",
  "custo_folha_hora", "tempo_m2_min", "imposto_mo_pct", "margem_mo_pct",
  "comissao_pct", "meta_producao_m2",
] as const;

const GRUPOS: { grupo: string; campos: { k: string; l: string; suf: string }[] }[] = [
  { grupo: "Tributário", campos: [
    { k: "creditos_pct", l: "Créditos", suf: "%" },
    { k: "icms_pct", l: "ICMS", suf: "%" },
    { k: "pis_cofins_pct", l: "PIS/COFINS", suf: "%" },
  ] },
  { grupo: "Material", campos: [
    { k: "margem_material_pct", l: "Margem Material", suf: "%" },
  ] },
  { grupo: "Mão de obra", campos: [
    { k: "custo_folha_hora", l: "Custo Folha/Hora", suf: "R$" },
    { k: "tempo_m2_min", l: "Tempo por m²", suf: "min" },
    { k: "imposto_mo_pct", l: "Imposto MO", suf: "%" },
    { k: "margem_mo_pct", l: "Margem MO", suf: "%" },
  ] },
  { grupo: "Comercial", campos: [
    { k: "comissao_pct", l: "Comissão", suf: "%" },
    { k: "meta_producao_m2", l: "Meta Produção", suf: "m²/mês" },
  ] },
];

const EMPRESA_TODA = "__empresa__";

export default function PrecificacaoConfigPanel({ companyId }: { companyId: string }) {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [configs, setConfigs] = useState<Cfg[]>([]);
  const [escopo, setEscopo] = useState<string>(EMPRESA_TODA); // EMPRESA_TODA ou business_line_id
  const [form, setForm] = useState<Record<string, string>>({});
  const [base, setBase] = useState<"meta" | "realizado">("meta");
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const escopoBlId = escopo === EMPRESA_TODA ? null : escopo;
  const cfgAtual = configs.find((c) => (c.business_line_id ?? null) === escopoBlId) ?? null;

  const preencher = useCallback((cfg: Cfg | null) => {
    const f: Record<string, string> = {};
    for (const k of CAMPO_KEYS) f[k] = cfg && cfg[k] != null ? String(cfg[k]) : "";
    setForm(f);
    setBase((cfg?.base_custo_fixo as "meta" | "realizado") ?? "meta");
  }, []);

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.rpc("fn_precificacao_config_obter", { p_company_id: companyId });
    setLoading(false);
    if (error) { setErro(error.message); return; }
    const j = data as Obter;
    if (!j?.ok) { setErro(j?.erro ?? "Falha ao carregar premissas"); return; }
    setLinhas(j.linhas ?? []);
    setConfigs(j.config ?? []);
  }, [companyId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar(); }, [carregar]);
  // Ao trocar de escopo (ou recarregar configs), popula o form com a config daquele escopo (ou vazio).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    preencher(configs.find((c) => (c.business_line_id ?? null) === escopoBlId) ?? null);
  }, [escopo, configs, escopoBlId, preencher]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);

  const setCampo = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v.replace(/[^\d.,-]/g, "") }));
  const numOrNull = (s: string): number | null => { const t = (s ?? "").trim().replace(",", "."); if (t === "") return null; const v = parseFloat(t); return Number.isFinite(v) ? v : null; };

  async function salvar() {
    setSalvando(true); setErro(null);
    const premissas: Record<string, unknown> = { base_custo_fixo: base };
    for (const k of CAMPO_KEYS) premissas[k] = numOrNull(form[k] ?? "");
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.rpc("fn_precificacao_config_salvar", {
      p_company_id: companyId, p_business_line_id: escopoBlId, p_premissas: premissas,
    });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    const j = data as { ok?: boolean; erro?: string } | null;
    if (!j?.ok) { setErro(j?.erro ?? "Falha ao salvar"); return; }
    setToast("Premissas ALTERADAS");
    await carregar();
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-[#3D2314]/8 bg-white p-10 text-center shadow-sm">
        <Loader2 className="mx-auto animate-spin text-[#C8941A]" size={24} />
        <p className="mt-3 text-sm text-[#3D2314]/60">Carregando premissas…</p>
      </div>
    );
  }
  if (erro) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 shadow-sm">
        <AlertTriangle className="mb-1 inline" size={16} /> {erro}
        <button onClick={() => void carregar()} className="ml-3 rounded border border-red-300 px-2 py-0.5 text-xs">tentar de novo</button>
      </div>
    );
  }

  const temConfig = !!cfgAtual;
  const escopoNome = escopo === EMPRESA_TODA ? "Empresa toda" : (linhas.find((l) => l.id === escopo)?.nome ?? "linha");

  return (
    <section className="rounded-2xl border border-[#3D2314]/8 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <DollarSign size={16} className="text-[#C8941A]" />
        <h2 className="text-base font-medium text-[#3D2314]" style={{ fontFamily: "var(--ps-font-body)" }}>
          Premissas de precificação
        </h2>
      </div>

      {/* Seletor de escopo */}
      <label className="mb-4 block max-w-sm">
        <span className="mb-1 block text-xs uppercase tracking-wider text-[#3D2314]/60">Escopo</span>
        <select
          value={escopo}
          onChange={(e) => setEscopo(e.target.value)}
          className="w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm text-[#3D2314] focus:border-[#C8941A] focus:outline-none"
        >
          <option value={EMPRESA_TODA}>Empresa toda</option>
          {linhas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
        </select>
      </label>

      {!temConfig && (
        <div className="mb-4 rounded-lg border border-[#C8941A]/30 bg-[#FBF4E4] p-3 text-sm text-[#3D2314]">
          <b>{escopoNome}</b> ainda não tem premissas próprias. Preencha os campos e salve para <b>definir as premissas desta linha</b>.
        </div>
      )}

      <div className="space-y-5">
        {GRUPOS.map((g) => (
          <div key={g.grupo}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#3D2314]/60">{g.grupo}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {g.campos.map((c) => (
                <label key={c.k} className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-wider text-[#3D2314]/55">{c.l} <span className="text-[#3D2314]/35">({c.suf})</span></span>
                  <input
                    inputMode="decimal"
                    value={form[c.k] ?? ""}
                    onChange={(e) => setCampo(c.k, e.target.value)}
                    placeholder="—"
                    className="w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-right font-mono text-sm text-[#3D2314] placeholder:text-[#3D2314]/30 focus:border-[#C8941A] focus:outline-none focus:ring-2 focus:ring-[#C8941A]/20"
                  />
                </label>
              ))}
              {g.grupo === "Comercial" && (
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-wider text-[#3D2314]/55">Base do custo fixo</span>
                  <select
                    value={base}
                    onChange={(e) => setBase(e.target.value as "meta" | "realizado")}
                    className="w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm text-[#3D2314] focus:border-[#C8941A] focus:outline-none"
                  >
                    <option value="meta">Meta</option>
                    <option value="realizado">Realizado</option>
                  </select>
                </label>
              )}
            </div>
          </div>
        ))}

        {/* Derivado read-only */}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#3D2314]/60">Derivado</h3>
          <div className="max-w-xs rounded-lg border border-dashed border-[#3D2314]/20 bg-[#FAF7F2] px-3 py-2">
            <span className="block text-[11px] uppercase tracking-wider text-[#3D2314]/55">Custo Fixo (R$/m²)</span>
            <span className="font-mono text-sm text-[#3D2314]/50">— calculado pelo rateio (vem do GE)</span>
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={() => void salvar()}
          disabled={salvando}
          className="inline-flex items-center gap-2 rounded-lg bg-[#C8941A] px-5 py-2 text-sm font-semibold text-[#3D2314] hover:bg-[#b3831640] disabled:opacity-50"
          style={{ background: salvando ? "rgba(200,148,26,0.5)" : "#C8941A" }}
        >
          {salvando ? <Loader2 size={14} className="animate-spin" /> : null}
          {salvando ? "Salvando…" : "Salvar"}
        </button>
        {toast && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            <CheckCircle2 size={12} /> {toast}
          </span>
        )}
      </div>
    </section>
  );
}
