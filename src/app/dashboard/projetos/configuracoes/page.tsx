// src/app/dashboard/projetos/configuracoes/page.tsx
// Configuracoes do modulo Projetos: BDI interativo + margens + defaults operacionais
// Autosave com debounce 800ms; trigger backend recalcula bdi_total_pct

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Settings,
  Sliders,
  Target,
  FileText,
  Lock,
  Repeat,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { supabaseBrowser } from "@/lib/authFetch";
import { BdiSlider } from "@/components/projetos/BdiSlider";
import {
  BdiPreview,
  type BdiComponentes,
  type ImpactoServico,
} from "@/components/projetos/BdiPreview";

interface Config {
  company_id: string;
  // BDI componentes (em %)
  bdi_administracao_central_pct: number;
  bdi_seguros_pct: number;
  bdi_riscos_pct: number;
  bdi_garantia_pct: number;
  bdi_despesas_financeiras_pct: number;
  bdi_lucro_pct: number;
  bdi_impostos_pct: number;
  bdi_total_pct: number;
  // Margens
  margem_alvo_pct: number | null;
  margem_minima_pct: number | null;
  // Defaults operacionais
  validade_proposta_dias: number | null;
  prazo_pagamento_padrao_dias: number | null;
  prefixo_orcamento: string | null;
  prefixo_obra: string | null;
  prefixo_proposta: string | null;
  // Permissoes
  vendedor_pode_alterar_preco: boolean | null;
  vendedor_pode_aprovar_proposta: boolean | null;
  exige_aprovacao_engenheiro: boolean | null;
  // Integracoes
  sincroniza_omie_estoque: boolean | null;
  sincroniza_omie_pagar: boolean | null;
}

const PRESETS: Array<{ id: string; label: string; descricao: string }> = [
  {
    id: "simples_nacional",
    label: "Simples Nacional",
    descricao: "Empresas no Simples (até R$ 4,8M/ano)",
  },
  {
    id: "lucro_presumido",
    label: "Lucro Presumido",
    descricao: "Faixa intermediária de tributação",
  },
  {
    id: "lucro_real",
    label: "Lucro Real",
    descricao: "Empresas com receita acima de R$ 78M/ano",
  },
  { id: "mei", label: "MEI", descricao: "Microempreendedor individual" },
];

function n(v: unknown, fallback = 0): number {
  if (v === null || v === undefined) return fallback;
  const num = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(num) ? num : fallback;
}

function cargaInicial(): Partial<Config> {
  return {
    bdi_administracao_central_pct: 5,
    bdi_seguros_pct: 1,
    bdi_riscos_pct: 1.5,
    bdi_garantia_pct: 1,
    bdi_despesas_financeiras_pct: 2,
    bdi_lucro_pct: 12,
    bdi_impostos_pct: 9.25,
    margem_alvo_pct: 15,
    margem_minima_pct: 8,
    validade_proposta_dias: 30,
    prazo_pagamento_padrao_dias: 30,
    prefixo_orcamento: "ORC",
    prefixo_obra: "OBR",
    prefixo_proposta: "PROP",
    vendedor_pode_alterar_preco: false,
    vendedor_pode_aprovar_proposta: false,
    exige_aprovacao_engenheiro: true,
    sincroniza_omie_estoque: false,
    sincroniza_omie_pagar: true,
  };
}

export default function ConfiguracoesPage() {
  const { sel, companies } = useCompanyIds();
  const companyId =
    sel && !sel.startsWith("group_") && sel !== "consolidado" ? sel : null;
  const empresa = companies.find((c) => c.id === companyId);

  const [config, setConfig] = useState<Config | null>(null);
  const [impactos, setImpactos] = useState<ImpactoServico[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Autosave state
  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ignoreNextEffectRef = useRef(false);

  // Preset confirm modal
  const [presetParaAplicar, setPresetParaAplicar] = useState<string | null>(null);
  const [aplicandoPreset, setAplicandoPreset] = useState(false);

  // Carregar config + impactos
  const carregar = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      const [cfgR, impR] = await Promise.all([
        supabase
          .from("projetos_modulo_config")
          .select("*")
          .eq("company_id", companyId)
          .maybeSingle(),
        supabase
          .from("v_projetos_bdi_impacto")
          .select("*")
          .eq("company_id", companyId)
          .order("custo", { ascending: false })
          .limit(10),
      ]);
      if (cfgR.error && cfgR.error.code !== "PGRST116") throw cfgR.error;
      // Impactos: view pode nao existir em todos ambientes; ignora erro silenciosamente
      let dadosImp: ImpactoServico[] = [];
      if (!impR.error && Array.isArray(impR.data)) {
        dadosImp = (impR.data as any[]).map((r) => ({
          servico_id: r.servico_id ?? r.id,
          nome: r.nome ?? r.servico_nome ?? "Serviço",
          custo: r.custo ?? r.custo_unitario_total ?? null,
          preco_venda: r.preco_venda ?? r.preco_unitario_venda ?? null,
          margem_aparente_pct:
            r.margem_aparente_pct ?? r.margem_pct ?? r.margem ?? null,
        }));
      }
      const dados = (cfgR.data as Partial<Config>) || {};
      ignoreNextEffectRef.current = true;
      setConfig({
        company_id: companyId,
        bdi_administracao_central_pct: n(dados.bdi_administracao_central_pct, 5),
        bdi_seguros_pct: n(dados.bdi_seguros_pct, 1),
        bdi_riscos_pct: n(dados.bdi_riscos_pct, 1.5),
        bdi_garantia_pct: n(dados.bdi_garantia_pct, 1),
        bdi_despesas_financeiras_pct: n(dados.bdi_despesas_financeiras_pct, 2),
        bdi_lucro_pct: n(dados.bdi_lucro_pct, 12),
        bdi_impostos_pct: n(dados.bdi_impostos_pct, 9.25),
        bdi_total_pct: n(dados.bdi_total_pct, 0),
        margem_alvo_pct:
          dados.margem_alvo_pct == null ? 15 : n(dados.margem_alvo_pct),
        margem_minima_pct:
          dados.margem_minima_pct == null ? 8 : n(dados.margem_minima_pct),
        validade_proposta_dias:
          dados.validade_proposta_dias == null
            ? 30
            : n(dados.validade_proposta_dias),
        prazo_pagamento_padrao_dias:
          dados.prazo_pagamento_padrao_dias == null
            ? 30
            : n(dados.prazo_pagamento_padrao_dias),
        prefixo_orcamento: dados.prefixo_orcamento ?? "ORC",
        prefixo_obra: dados.prefixo_obra ?? "OBR",
        prefixo_proposta: dados.prefixo_proposta ?? "PROP",
        vendedor_pode_alterar_preco: !!dados.vendedor_pode_alterar_preco,
        vendedor_pode_aprovar_proposta: !!dados.vendedor_pode_aprovar_proposta,
        exige_aprovacao_engenheiro:
          dados.exige_aprovacao_engenheiro == null
            ? true
            : !!dados.exige_aprovacao_engenheiro,
        sincroniza_omie_estoque: !!dados.sincroniza_omie_estoque,
        sincroniza_omie_pagar:
          dados.sincroniza_omie_pagar == null
            ? true
            : !!dados.sincroniza_omie_pagar,
      });
      setImpactos(dadosImp);
    } catch (e: any) {
      setErro(e.message || "Falha ao carregar configurações");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // ----- Autosave debounced -----
  const salvar = useCallback(
    async (atual: Config) => {
      if (!companyId) return;
      setSavingState("saving");
      setErro(null);
      try {
        const supabase = supabaseBrowser();
        const payload = {
          bdi_administracao_central_pct: atual.bdi_administracao_central_pct,
          bdi_seguros_pct: atual.bdi_seguros_pct,
          bdi_riscos_pct: atual.bdi_riscos_pct,
          bdi_garantia_pct: atual.bdi_garantia_pct,
          bdi_despesas_financeiras_pct: atual.bdi_despesas_financeiras_pct,
          bdi_lucro_pct: atual.bdi_lucro_pct,
          bdi_impostos_pct: atual.bdi_impostos_pct,
          margem_alvo_pct: atual.margem_alvo_pct,
          margem_minima_pct: atual.margem_minima_pct,
          validade_proposta_dias: atual.validade_proposta_dias,
          prazo_pagamento_padrao_dias: atual.prazo_pagamento_padrao_dias,
          prefixo_orcamento: atual.prefixo_orcamento,
          prefixo_obra: atual.prefixo_obra,
          prefixo_proposta: atual.prefixo_proposta,
          vendedor_pode_alterar_preco: !!atual.vendedor_pode_alterar_preco,
          vendedor_pode_aprovar_proposta: !!atual.vendedor_pode_aprovar_proposta,
          exige_aprovacao_engenheiro: !!atual.exige_aprovacao_engenheiro,
          sincroniza_omie_estoque: !!atual.sincroniza_omie_estoque,
          sincroniza_omie_pagar: !!atual.sincroniza_omie_pagar,
        };
        const { data, error } = await supabase
          .from("projetos_modulo_config")
          .update(payload)
          .eq("company_id", companyId)
          .select("bdi_total_pct")
          .single();
        if (error) throw error;
        setSavingState("saved");
        setSavedAt(new Date());
        if (data && Number.isFinite((data as any).bdi_total_pct)) {
          ignoreNextEffectRef.current = true;
          setConfig((prev) =>
            prev
              ? { ...prev, bdi_total_pct: (data as any).bdi_total_pct }
              : prev
          );
        }
      } catch (e: any) {
        setSavingState("error");
        setErro(e.message || "Falha ao salvar");
      }
    },
    [companyId]
  );

  // Dispara autosave a cada mudanca em config (com debounce)
  useEffect(() => {
    if (!config) return;
    if (ignoreNextEffectRef.current) {
      ignoreNextEffectRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSavingState("saving");
    debounceRef.current = setTimeout(() => {
      salvar(config);
    }, 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    config?.bdi_administracao_central_pct,
    config?.bdi_seguros_pct,
    config?.bdi_riscos_pct,
    config?.bdi_garantia_pct,
    config?.bdi_despesas_financeiras_pct,
    config?.bdi_lucro_pct,
    config?.bdi_impostos_pct,
    config?.margem_alvo_pct,
    config?.margem_minima_pct,
    config?.validade_proposta_dias,
    config?.prazo_pagamento_padrao_dias,
    config?.prefixo_orcamento,
    config?.prefixo_obra,
    config?.prefixo_proposta,
    config?.vendedor_pode_alterar_preco,
    config?.vendedor_pode_aprovar_proposta,
    config?.exige_aprovacao_engenheiro,
    config?.sincroniza_omie_estoque,
    config?.sincroniza_omie_pagar,
  ]);

  function setField<K extends keyof Config>(k: K, v: Config[K]) {
    setConfig((prev) => (prev ? { ...prev, [k]: v } : prev));
  }

  async function aplicarPreset() {
    if (!companyId || !presetParaAplicar) return;
    setAplicandoPreset(true);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      const { error } = await supabase.rpc("fn_projetos_aplicar_preset_bdi", {
        p_company_id: companyId,
        p_preset: presetParaAplicar,
      });
      if (error) throw error;
      setAviso(
        `Preset "${
          PRESETS.find((p) => p.id === presetParaAplicar)?.label || presetParaAplicar
        }" aplicado`
      );
      setTimeout(() => setAviso(null), 4000);
      setPresetParaAplicar(null);
      await carregar();
    } catch (e: any) {
      setErro(e.message || "Falha ao aplicar preset");
    } finally {
      setAplicandoPreset(false);
    }
  }

  const componentes: BdiComponentes = useMemo(
    () => ({
      ac: n(config?.bdi_administracao_central_pct),
      sg: n(config?.bdi_seguros_pct),
      ri: n(config?.bdi_riscos_pct),
      ga: n(config?.bdi_garantia_pct),
      df: n(config?.bdi_despesas_financeiras_pct),
      lu: n(config?.bdi_lucro_pct),
      im: n(config?.bdi_impostos_pct),
    }),
    [config]
  );

  if (!companyId) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h1
          className="text-2xl font-medium text-[#3D2314]"
          style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
        >
          Selecione uma empresa
        </h1>
        <p className="mt-2 text-sm text-[#3D2314]/60">
          Configurações de BDI são por empresa específica.
        </p>
      </main>
    );
  }

  if (loading || !config) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-20 text-center">
        <Loader2 className="mx-auto animate-spin text-[#C8941A]" size={28} />
        <p className="mt-3 text-sm text-[#3D2314]/60">Carregando configurações…</p>
      </main>
    );
  }

  const empresaNome = empresa?.nome_fantasia || empresa?.razao_social || "—";

  const exemploNumero = `${config.prefixo_orcamento || "ORC"}-${new Date().getFullYear()}-0001`;

  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-[#3D2314]/8 p-2.5">
            <Settings size={20} className="text-[#C8941A]" />
          </div>
          <div>
            <h1
              className="text-2xl font-medium text-[#3D2314]"
              style={{
                fontFamily: "var(--ps-font-body)",
                fontStyle: "normal",
                letterSpacing: "-0.01em",
              }}
            >
              Configurações do módulo Projetos
            </h1>
            <p className="mt-0.5 text-sm text-[#3D2314]/60">{empresaNome}</p>
          </div>
        </div>
        <SaveIndicator state={savingState} savedAt={savedAt} />
      </header>

      {erro && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>
      )}
      {aviso && (
        <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          ✓ {aviso}
        </div>
      )}

      {/* SECAO 1: BDI Hero */}
      <section className="mb-6 rounded-2xl border border-[#3D2314]/8 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Sliders size={16} className="text-[#C8941A]" />
          <h2
            className="text-base font-medium text-[#3D2314]"
            style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
          >
            BDI — Benefícios e Despesas Indiretas
          </h2>
        </div>

        {/* Presets */}
        <div className="mb-4 flex flex-wrap gap-2">
          <span className="text-xs uppercase tracking-wider text-[#3D2314]/50">
            Presets:
          </span>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPresetParaAplicar(p.id)}
              className="rounded-full border border-[#3D2314]/12 bg-white px-3 py-1 text-xs font-medium text-[#3D2314] transition-colors hover:border-[#C8941A] hover:bg-[#C8941A]/5 hover:text-[#C8941A]"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Sliders */}
          <div className="space-y-2.5">
            <BdiSlider
              label="Administração Central (AC)"
              hint="Custos da estrutura administrativa rateados sobre a obra (escritório, gestão, RH)."
              valor={config.bdi_administracao_central_pct}
              onChange={(v) => setField("bdi_administracao_central_pct", v)}
              cor="gray"
            />
            <BdiSlider
              label="Seguros (SG)"
              hint="Seguro garantia, seguro de obras civis e responsabilidade civil."
              valor={config.bdi_seguros_pct}
              onChange={(v) => setField("bdi_seguros_pct", v)}
              cor="gray"
              max={10}
            />
            <BdiSlider
              label="Riscos (RI)"
              hint="Provisão para imprevistos, retrabalhos, variação cambial."
              valor={config.bdi_riscos_pct}
              onChange={(v) => setField("bdi_riscos_pct", v)}
              cor="gray"
              max={10}
            />
            <BdiSlider
              label="Garantias (GA)"
              hint="Garantia técnica de obra (NBR 15575), retenção contratual."
              valor={config.bdi_garantia_pct}
              onChange={(v) => setField("bdi_garantia_pct", v)}
              cor="gray"
              max={10}
            />
            <BdiSlider
              label="Despesas Financeiras (DF)"
              hint="Custo do capital de giro durante a execução da obra."
              valor={config.bdi_despesas_financeiras_pct}
              onChange={(v) => setField("bdi_despesas_financeiras_pct", v)}
              cor="gray"
              max={10}
            />
            <BdiSlider
              label="Lucro (LU)"
              hint="Margem de lucro líquido sobre o custo direto + benefícios indiretos."
              valor={config.bdi_lucro_pct}
              onChange={(v) => setField("bdi_lucro_pct", v)}
              cor="gold"
              destaque
            />
            <BdiSlider
              label="Impostos (IM)"
              hint="ISS + PIS + COFINS sobre faturamento. Varia conforme regime tributário."
              valor={config.bdi_impostos_pct}
              onChange={(v) => setField("bdi_impostos_pct", v)}
              cor="brown"
              max={20}
            />
          </div>

          {/* Preview */}
          <BdiPreview
            componentes={componentes}
            bdiTotalPct={config.bdi_total_pct}
            impactos={impactos}
            margemAlvoPct={config.margem_alvo_pct}
            margemMinimaPct={config.margem_minima_pct}
          />
        </div>
      </section>

      {/* SECAO 2: Margens */}
      <section className="mb-6 rounded-2xl border border-[#3D2314]/8 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Target size={16} className="text-[#C8941A]" />
          <h2
            className="text-base font-medium text-[#3D2314]"
            style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
          >
            Margens de referência
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <CampoNumero
            label="Margem alvo (%)"
            hint="Meta de margem aparente que serviços devem atingir"
            valor={config.margem_alvo_pct}
            onChange={(v) => setField("margem_alvo_pct", v)}
          />
          <CampoNumero
            label="Margem mínima (%)"
            hint="Abaixo deste valor, o serviço é destacado em vermelho e bloqueia propostas"
            valor={config.margem_minima_pct}
            onChange={(v) => setField("margem_minima_pct", v)}
          />
        </div>
        <p className="mt-3 text-xs text-[#3D2314]/60">
          Serviços com margem aparente abaixo da mínima são destacados em
          vermelho no catálogo e bloqueiam aprovação de propostas.
        </p>
      </section>

      {/* SECAO 3: Defaults operacionais */}
      <section className="mb-6 rounded-2xl border border-[#3D2314]/8 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <FileText size={16} className="text-[#C8941A]" />
          <h2
            className="text-base font-medium text-[#3D2314]"
            style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
          >
            Defaults operacionais
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <CampoNumero
            label="Validade da proposta (dias)"
            hint="Prazo padrão antes da proposta expirar"
            valor={config.validade_proposta_dias}
            onChange={(v) => setField("validade_proposta_dias", v)}
            inteiro
          />
          <CampoNumero
            label="Prazo de pagamento padrão (dias)"
            hint="Prazo entre emissão da fatura e vencimento"
            valor={config.prazo_pagamento_padrao_dias}
            onChange={(v) => setField("prazo_pagamento_padrao_dias", v)}
            inteiro
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <CampoTexto
            label="Prefixo de orçamento"
            valor={config.prefixo_orcamento}
            onChange={(v) => setField("prefixo_orcamento", v)}
            placeholder="ORC"
          />
          <CampoTexto
            label="Prefixo de obra"
            valor={config.prefixo_obra}
            onChange={(v) => setField("prefixo_obra", v)}
            placeholder="OBR"
          />
          <CampoTexto
            label="Prefixo de proposta"
            valor={config.prefixo_proposta}
            onChange={(v) => setField("prefixo_proposta", v)}
            placeholder="PROP"
          />
        </div>
        <p className="mt-2 text-xs text-[#3D2314]/60">
          Exemplo gerado: <span className="font-mono text-[#3D2314]">{exemploNumero}</span>
        </p>

        {/* Permissoes */}
        <div className="mt-6 border-t border-[#3D2314]/8 pt-5">
          <div className="mb-3 flex items-center gap-2">
            <Lock size={14} className="text-[#3D2314]/60" />
            <h3 className="text-sm font-medium uppercase tracking-wider text-[#3D2314]/60">
              Permissões
            </h3>
          </div>
          <div className="space-y-2">
            <Toggle
              label="Vendedor pode alterar preço final"
              hint="Permite ajustar preço final fora do CPU"
              valor={!!config.vendedor_pode_alterar_preco}
              onChange={(v) => setField("vendedor_pode_alterar_preco", v)}
            />
            <Toggle
              label="Vendedor pode aprovar proposta"
              hint="Sem precisar de revisão de supervisor"
              valor={!!config.vendedor_pode_aprovar_proposta}
              onChange={(v) => setField("vendedor_pode_aprovar_proposta", v)}
            />
            <Toggle
              label="Exige aprovação do engenheiro"
              hint="Take-off precisa ser revisado antes de virar proposta"
              valor={!!config.exige_aprovacao_engenheiro}
              onChange={(v) => setField("exige_aprovacao_engenheiro", v)}
            />
          </div>
        </div>

        {/* Integracoes */}
        <div className="mt-6 border-t border-[#3D2314]/8 pt-5">
          <div className="mb-3 flex items-center gap-2">
            <Repeat size={14} className="text-[#3D2314]/60" />
            <h3 className="text-sm font-medium uppercase tracking-wider text-[#3D2314]/60">
              Integrações
            </h3>
          </div>
          <div className="space-y-2">
            <Toggle
              label="Sincronizar estoque com Omie"
              hint="Movimenta estoque no Omie a cada saída de material"
              valor={!!config.sincroniza_omie_estoque}
              onChange={(v) => setField("sincroniza_omie_estoque", v)}
            />
            <Toggle
              label="Sincronizar contas a pagar com Omie"
              hint="Cria títulos a pagar no Omie ao confirmar fornecedor"
              valor={!!config.sincroniza_omie_pagar}
              onChange={(v) => setField("sincroniza_omie_pagar", v)}
            />
          </div>
        </div>
      </section>

      {/* Modal confirmar preset */}
      {presetParaAplicar && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#3D2314]/60 p-4"
          onClick={() => !aplicandoPreset && setPresetParaAplicar(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              className="text-lg font-medium text-[#3D2314]"
              style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
            >
              Aplicar preset?
            </h3>
            <p className="mt-2 text-sm text-[#3D2314]/70">
              {PRESETS.find((p) => p.id === presetParaAplicar)?.descricao}
              <br />
              <span className="text-yellow-700">
                Vai sobrescrever os valores atuais de BDI.
              </span>
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setPresetParaAplicar(null)}
                disabled={aplicandoPreset}
                className="rounded-lg border border-[#3D2314]/12 bg-white px-4 py-2 text-sm text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={aplicarPreset}
                disabled={aplicandoPreset}
                className="inline-flex items-center gap-2 rounded-lg bg-[#3D2314] px-4 py-2 text-sm font-medium text-[#FAF7F2] hover:bg-[#3D2314]/90 disabled:opacity-50"
              >
                {aplicandoPreset && <Loader2 size={14} className="animate-spin" />}
                Aplicar preset
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function SaveIndicator({
  state,
  savedAt,
}: {
  state: "idle" | "saving" | "saved" | "error";
  savedAt: Date | null;
}) {
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#C8941A]/15 px-3 py-1 text-xs font-medium text-[#C8941A]">
        <Loader2 size={12} className="animate-spin" />
        Salvando…
      </span>
    );
  }
  if (state === "saved" && savedAt) {
    const hh = savedAt.getHours().toString().padStart(2, "0");
    const mm = savedAt.getMinutes().toString().padStart(2, "0");
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
        <CheckCircle2 size={12} />
        Salvo às {hh}:{mm}
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700">
        Erro ao salvar
      </span>
    );
  }
  return null;
}

function CampoNumero({
  label,
  hint,
  valor,
  onChange,
  inteiro = false,
}: {
  label: string;
  hint?: string;
  valor: number | null;
  onChange: (v: number | null) => void;
  inteiro?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wider text-[#3D2314]/60">
        {label}
      </span>
      <input
        type="number"
        step={inteiro ? 1 : 0.01}
        value={valor ?? ""}
        onChange={(e) => {
          const t = e.target.value;
          if (t === "") return onChange(null);
          const v = parseFloat(t);
          onChange(Number.isFinite(v) ? v : null);
        }}
        className="w-full rounded-lg !border !border-[#3D2314]/12 !bg-white px-4 py-2 text-right font-mono text-sm !text-[#3D2314] placeholder:!text-[#3D2314]/40 focus:!border-[#C8941A] focus:outline-none focus:ring-2 focus:ring-[#C8941A]/20 transition-colors"
      />
      {hint && <p className="mt-1 text-[11px] text-[#3D2314]/50">{hint}</p>}
    </label>
  );
}

function CampoTexto({
  label,
  valor,
  onChange,
  placeholder,
}: {
  label: string;
  valor: string | null;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wider text-[#3D2314]/60">
        {label}
      </span>
      <input
        type="text"
        value={valor ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={10}
        className="w-full rounded-lg !border !border-[#3D2314]/12 !bg-white px-4 py-2 font-mono text-sm uppercase !text-[#3D2314] placeholder:!text-[#3D2314]/40 focus:!border-[#C8941A] focus:outline-none focus:ring-2 focus:ring-[#C8941A]/20 transition-colors"
      />
    </label>
  );
}

function Toggle({
  label,
  hint,
  valor,
  onChange,
}: {
  label: string;
  hint: string;
  valor: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-[#3D2314]/8 bg-white p-3 hover:bg-[#FAF7F2]">
      <div className="flex-1">
        <div className="text-sm font-medium text-[#3D2314]">{label}</div>
        <div className="text-xs text-[#3D2314]/60">{hint}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={valor}
        onClick={() => onChange(!valor)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          valor ? "bg-[#C8941A]" : "bg-[#3D2314]/15"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            valor ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}
