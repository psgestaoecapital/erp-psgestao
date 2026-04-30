// src/app/dashboard/projetos/configuracoes/page.tsx
// Fase 0 — UNICA aba PARCIALMENTE funcional: editar BDI da empresa

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { supabaseBrowser } from "@/lib/authFetch";

interface Config {
  company_id: string;
  // BDI fracionado (0-1) ou em % — backend usa percentual (0-100)
  bdi_administracao_central_pct: number;
  bdi_seguros_pct: number;
  bdi_riscos_pct: number;
  bdi_garantia_pct: number;
  bdi_despesas_financeiras_pct: number;
  bdi_impostos_pct: number;
  bdi_lucro_pct: number;
  bdi_total_pct: number;
  // Contadores
  proximo_numero_orcamento: number | null;
  proximo_numero_obra: number | null;
  proximo_numero_proposta: number | null;
  // Permissões
  vendedor_pode_alterar_preco?: boolean;
  vendedor_pode_aprovar_proposta?: boolean;
  exige_aprovacao_engenheiro?: boolean;
}

const CAMPOS_BDI: Array<{ key: keyof Config; label: string; hint: string }> = [
  { key: "bdi_administracao_central_pct", label: "Administração Central (AC)", hint: "Custos administrativos rateados" },
  { key: "bdi_seguros_pct", label: "Seguros (S)", hint: "Seguro de obra/responsabilidade civil" },
  { key: "bdi_riscos_pct", label: "Riscos (R)", hint: "Provisão para imprevistos" },
  { key: "bdi_garantia_pct", label: "Garantia (G)", hint: "Garantia técnica de obra" },
  { key: "bdi_despesas_financeiras_pct", label: "Despesas Financeiras (DF)", hint: "Custo do capital de giro" },
  { key: "bdi_impostos_pct", label: "Impostos (I)", hint: "ISS + PIS + COFINS sobre serviço" },
  { key: "bdi_lucro_pct", label: "Lucro (L)", hint: "Margem de lucro líquido" },
];

// Fórmula NBR: BDI = ((1 + AC + S + R + G + DF) / (1 - I - L)) - 1
function calcularBdi(c: Config): number {
  const num = 1 +
    (c.bdi_administracao_central_pct / 100) +
    (c.bdi_seguros_pct / 100) +
    (c.bdi_riscos_pct / 100) +
    (c.bdi_garantia_pct / 100) +
    (c.bdi_despesas_financeiras_pct / 100);
  const den = 1 - (c.bdi_impostos_pct / 100) - (c.bdi_lucro_pct / 100);
  if (den <= 0) return 0;
  return ((num / den) - 1) * 100;
}

export default function ConfiguracoesPage() {
  const { sel, companies } = useCompanyIds();
  const companyId = sel && !sel.startsWith("group_") && sel !== "consolidado" ? sel : null;
  const empresa = companies.find((c) => c.id === companyId);

  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) { setLoading(false); return; }
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const supabase = supabaseBrowser();
        const { data, error } = await supabase
          .from("projetos_modulo_config")
          .select("*")
          .eq("company_id", companyId)
          .maybeSingle();
        if (error && error.code !== "PGRST116") throw error;
        if (cancel) return;
        setConfig((data as any) || null);
      } catch (e: any) {
        if (!cancel) setErro(e.message || "Falha ao carregar config");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [companyId]);

  function set<K extends keyof Config>(k: K, v: Config[K]) {
    if (!config) return;
    setConfig({ ...config, [k]: v });
  }

  async function salvar() {
    if (!config || !companyId) return;
    setSalvando(true);
    setErro(null);
    try {
      const total = calcularBdi(config);
      const supabase = supabaseBrowser();
      const { error } = await supabase
        .from("projetos_modulo_config")
        .update({
          bdi_administracao_central_pct: config.bdi_administracao_central_pct,
          bdi_seguros_pct: config.bdi_seguros_pct,
          bdi_riscos_pct: config.bdi_riscos_pct,
          bdi_garantia_pct: config.bdi_garantia_pct,
          bdi_despesas_financeiras_pct: config.bdi_despesas_financeiras_pct,
          bdi_impostos_pct: config.bdi_impostos_pct,
          bdi_lucro_pct: config.bdi_lucro_pct,
          bdi_total_pct: total,
          vendedor_pode_alterar_preco: !!config.vendedor_pode_alterar_preco,
          vendedor_pode_aprovar_proposta: !!config.vendedor_pode_aprovar_proposta,
          exige_aprovacao_engenheiro: !!config.exige_aprovacao_engenheiro,
        })
        .eq("company_id", companyId);
      if (error) throw error;
      setConfig({ ...config, bdi_total_pct: total });
      setAviso("Configurações salvas com sucesso");
      setTimeout(() => setAviso(null), 4000);
    } catch (e: any) {
      setErro(e.message || "Falha ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  if (!companyId) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="rounded-2xl bg-[#FAF7F2] p-12 text-center">
          <h2 className="text-xl font-bold text-[#3D2314]">Selecione uma empresa</h2>
          <p className="mt-2 text-sm text-[#3D2314]/70">
            Configurações de BDI são por empresa específica.
          </p>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10 text-[#3D2314]">Carregando configurações…</main>
    );
  }

  if (!config) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="rounded-2xl bg-yellow-50 p-6 text-center">
          <h2 className="text-lg font-bold text-yellow-900">Configuração não encontrada</h2>
          <p className="mt-2 text-sm text-yellow-800">
            Esta empresa ainda não tem configuração do módulo Projetos. Contate o administrador.
          </p>
          <Link href="/dashboard/projetos" className="mt-4 inline-block text-sm text-[#C8941A] hover:underline">
            ← Voltar ao painel
          </Link>
        </div>
      </main>
    );
  }

  const bdiTotal = calcularBdi(config);
  const empresaNome = empresa?.nome_fantasia || empresa?.razao_social || "—";

  return (
    <main className="mx-auto max-w-3xl px-6 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-[#3D2314]">Configurações do Módulo</h1>
        <p className="text-xs text-[#3D2314]/60">{empresaNome}</p>
      </header>

      {erro && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>}
      {aviso && <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">✓ {aviso}</div>}

      {/* BDI */}
      <section className="mb-6 rounded-2xl bg-[#FAF7F2] p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#3D2314]">
            BDI da empresa
          </h2>
          <div className="rounded-full bg-[#3D2314] px-4 py-1 text-sm font-bold text-[#FAF7F2]">
            BDI total: {bdiTotal.toFixed(2)}%
          </div>
        </div>
        <p className="mb-4 text-xs text-[#3D2314]/60">
          Fórmula NBR: BDI = ((1 + AC + S + R + G + DF) / (1 − I − L)) − 1
        </p>

        <div className="space-y-3">
          {CAMPOS_BDI.map((c) => (
            <div key={c.key} className="grid grid-cols-[1fr_120px] items-center gap-3">
              <div>
                <label className="text-sm font-medium text-[#3D2314]">{c.label}</label>
                <p className="text-xs text-[#3D2314]/60">{c.hint}</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  value={(config[c.key] as number) ?? 0}
                  onChange={(e) => set(c.key, parseFloat(e.target.value) || 0 as any)}
                  className="w-full rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2 text-right text-sm focus:border-[#C8941A] focus:outline-none"
                />
                <span className="text-sm text-[#3D2314]/60">%</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Permissões */}
      <section className="mb-6 rounded-2xl bg-[#FAF7F2] p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#3D2314]">
          Permissões
        </h2>
        <div className="space-y-3">
          <Toggle
            label="Vendedor pode alterar preço de venda"
            hint="Permite ajustar preço final fora do CPU"
            valor={!!config.vendedor_pode_alterar_preco}
            onChange={(v) => set("vendedor_pode_alterar_preco", v)}
          />
          <Toggle
            label="Vendedor pode aprovar proposta"
            hint="Sem precisar de revisão de supervisor"
            valor={!!config.vendedor_pode_aprovar_proposta}
            onChange={(v) => set("vendedor_pode_aprovar_proposta", v)}
          />
          <Toggle
            label="Exige aprovação do engenheiro"
            hint="Take-off precisa ser revisado antes de virar proposta"
            valor={!!config.exige_aprovacao_engenheiro}
            onChange={(v) => set("exige_aprovacao_engenheiro", v)}
          />
        </div>
      </section>

      {/* Contadores (read-only) */}
      <section className="mb-6 rounded-2xl bg-[#FAF7F2] p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#3D2314]">
          Próximas numerações
        </h2>
        <div className="grid grid-cols-3 gap-3 text-center">
          <Counter label="Orçamento" valor={config.proximo_numero_orcamento ?? 1} />
          <Counter label="Obra" valor={config.proximo_numero_obra ?? 1} />
          <Counter label="Proposta" valor={config.proximo_numero_proposta ?? 1} />
        </div>
        <p className="mt-3 text-xs text-[#3D2314]/60">
          Contadores são incrementados automaticamente quando uma nova entidade é criada.
        </p>
      </section>

      <div className="flex gap-2">
        <Link
          href="/dashboard/projetos"
          className="flex-1 rounded-lg bg-[#FAF7F2] py-3 text-center text-sm text-[#3D2314] hover:bg-[#3D2314]/10"
        >
          Cancelar
        </Link>
        <button
          onClick={salvar}
          disabled={salvando}
          className="flex-1 rounded-lg bg-[#3D2314] py-3 text-sm font-semibold text-[#FAF7F2] hover:bg-[#5C3A24] disabled:opacity-50"
        >
          {salvando ? "Salvando…" : "Salvar configurações"}
        </button>
      </div>
    </main>
  );
}

function Toggle({
  label, hint, valor, onChange,
}: {
  label: string; hint: string; valor: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg bg-white p-3 hover:bg-white/80">
      <div className="flex-1">
        <div className="text-sm font-medium text-[#3D2314]">{label}</div>
        <div className="text-xs text-[#3D2314]/60">{hint}</div>
      </div>
      <input
        type="checkbox"
        checked={valor}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-5 w-5 rounded accent-[#C8941A]"
      />
    </label>
  );
}

function Counter({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="rounded-lg bg-white p-3">
      <div className="text-xs uppercase text-[#3D2314]/60">{label}</div>
      <div className="mt-1 text-xl font-bold text-[#3D2314]">#{valor}</div>
    </div>
  );
}
