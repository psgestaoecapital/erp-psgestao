// src/app/dashboard/projetos/page.tsx
// Painel inicial premium do Hub Projetos
// Estrutura: Hero centralizado + Novidades + Indicadores + Funil + Obras por situação + Próximos passos
// Fontes (PDCA 23/10 — "dado não bate com banco"): obras e margem prevista de v_obra_resultado (security_invoker),
// valor das obras de fn_obras_kpis, funil de erp_crm_oportunidade (RLS), propostas de erp_orcamentos. Todo indicador tem "?" (RD-95).

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Hammer, ArrowRight } from "lucide-react";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { supabaseBrowser } from "@/lib/authFetch";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";

interface ResumoEmpresa {
  obras_ativas: number;
  propostas_pendentes: number;
  valor_orcamento_ativo: number;
  margem_prevista_pct: number | null;
  pagar_aberto: number;
  receber_aberto: number;
  obras_por_status: Record<string, number>;
  funil_abertas: number;
  funil_valor_aberto: number;
  funil_ganhas: number;
  funil_perdidas: number;
}

const SITUACOES = [
  { s: "em_andamento", l: "Em andamento" },
  { s: "pausada", l: "Pausadas" },
  { s: "concluida", l: "Concluídas" },
  { s: "cancelada", l: "Canceladas" },
];

const PASSOS = [
  { href: "/dashboard/projetos/oportunidades", titulo: "1. Funil de oportunidades", texto: "Registre o cliente e a obra que quer orçar." },
  { href: "/dashboard/projetos/obras", titulo: "2. Obras", texto: "Acompanhe escopo, status e fiscal de cada obra." },
  { href: "/dashboard/projetos/obras/resultado", titulo: "3. Resultado por obra", texto: "Previsto x realizado: custo, compras e margem." },
];

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtPct(v: number) {
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export default function PainelProjetos() {
  const { sel, companies } = useCompanyIds();
  const companyId = sel && !sel.startsWith("group_") && sel !== "consolidado" ? sel : null;
  const empresa = companies.find((c) => c.id === companyId);
  const empresaNome = empresa?.nome_fantasia || empresa?.razao_social || "—";

  const [resumo, setResumo] = useState<ResumoEmpresa | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (!companyId) {
      setResumo(null);
      return;
    }
    let cancel = false;
    setErro(false);
    (async () => {
      try {
        const supabase = supabaseBrowser();
        const [{ data: v }, { data: k, error: ek }, { count: propostas, error: ep }, { data: obras, error: eo }, { data: opps, error: eop }] = await Promise.all([
          supabase.from("v_projetos_resumo_empresa").select("contas_pagar_abertas,contas_receber_abertas").eq("company_id", companyId).maybeSingle(),
          supabase.rpc("fn_obras_kpis", { p_company_ids: [companyId] }),
          supabase.from("erp_orcamentos").select("id", { count: "exact", head: true }).eq("company_id", companyId).in("status", ["rascunho", "enviado"]),
          supabase.from("v_obra_resultado").select("status,receita_prevista,custo_previsto").eq("company_id", companyId),
          supabase.from("erp_crm_oportunidade").select("etapa,valor_estimado,valor_proposta").eq("company_id", companyId).is("deleted_at", null),
        ]);
        if (ek || ep || eo || eop) throw new Error("indicadores");
        const kp = (k as { em_andamento?: number; valor_em_andamento?: number } | null) ?? {};
        const fin = v as { contas_pagar_abertas: number | null; contas_receber_abertas: number | null } | null;
        const porStatus: Record<string, number> = {};
        let receita = 0, custo = 0;
        for (const o of (obras as { status: string; receita_prevista: number | null; custo_previsto: number | null }[] | null) ?? []) {
          porStatus[o.status] = (porStatus[o.status] ?? 0) + 1;
          if (o.status === "em_andamento") { receita += Number(o.receita_prevista ?? 0); custo += Number(o.custo_previsto ?? 0); }
        }
        let abertas = 0, valorAberto = 0, ganhas = 0, perdidas = 0;
        for (const o of (opps as { etapa: string; valor_estimado: number | null; valor_proposta: number | null }[] | null) ?? []) {
          if (o.etapa === "ganho") ganhas++;
          else if (o.etapa === "perdido") perdidas++;
          else { abertas++; valorAberto += Number(o.valor_proposta ?? o.valor_estimado ?? 0); }
        }
        if (!cancel) {
          setResumo({
            obras_ativas: porStatus.em_andamento ?? Number(kp.em_andamento ?? 0),
            propostas_pendentes: propostas ?? 0,
            valor_orcamento_ativo: Number(kp.valor_em_andamento ?? 0),
            margem_prevista_pct: receita > 0 ? ((receita - custo) / receita) * 100 : null,
            pagar_aberto: Number(fin?.contas_pagar_abertas ?? 0),
            receber_aberto: Number(fin?.contas_receber_abertas ?? 0),
            obras_por_status: porStatus,
            funil_abertas: abertas,
            funil_valor_aberto: valorAberto,
            funil_ganhas: ganhas,
            funil_perdidas: perdidas,
          });
        }
      } catch {
        if (!cancel) { setResumo(null); setErro(true); }
      }
    })();
    return () => { cancel = true; };
  }, [companyId]);

  if (!companyId) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20 text-center">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#3D2314]/8 mb-6">
          <Hammer size={28} className="text-[#C8941A]" />
        </div>
        <h1
          className="mb-2 text-2xl font-medium text-[#3D2314]"
          style={{ fontFamily: "var(--ps-font-body)" }}
        >
          Selecione uma empresa
        </h1>
        <p className="text-[#3D2314]/60 max-w-md mx-auto">
          O Hub Projetos opera por empresa específica. Use o seletor no topo do ERP
          para escolher a empresa que vai gerenciar.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      {/* HERO */}
      <section className="text-center py-12">
        <div className="mx-auto inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-[#3D2314]/8 mb-6">
          <Hammer size={28} className="text-[#C8941A]" />
        </div>
        <h1
          className="text-3xl font-medium text-[#3D2314] mb-2"
          style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal", letterSpacing: "-0.01em" }}
        >
          Projetos · {empresaNome}
        </h1>
        <p className="text-[#3D2314]/60 mb-8 max-w-xl mx-auto">
          Hub de engenharia, CRM de obra e acompanhamento
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/dashboard/projetos/configuracoes"
            className="inline-flex items-center gap-2 rounded-lg bg-[#3D2314] px-5 py-2.5 text-sm font-medium text-[#FAF7F2] transition-colors hover:bg-[#3D2314]/90"
          >
            Configurar BDI da empresa
            <ArrowRight size={14} />
          </Link>
          <AjudaCampo chave="projetos.painel.acao.configurar_bdi" />
          <Link
            href="/dashboard/projetos/oportunidades"
            className="text-sm text-[#3D2314]/60 hover:text-[#3D2314]"
          >
            Abrir o funil de oportunidades
          </Link>
          <AjudaCampo chave="projetos.painel.acao.abrir_funil" />
        </div>
      </section>

      {/* NOVIDADES DO HUB — toda entrega nova do Hub precisa aparecer aqui, no menu e nas abas */}
      <section className="mt-4" data-testid="novidades-hub">
        <SectionLabel>Novidades do Hub</SectionLabel>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Link href="/dashboard/projetos/obras/resultado?area=hub" data-testid="novidade-resultado" className="rounded-xl border border-[#C8941A]/40 bg-white p-4 shadow-sm transition-colors hover:bg-[#C8941A]/5">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#C8941A]">Novo</div>
            <div className="text-base font-medium text-[#3D2314]">Resultado por obra</div>
            <div className="mt-1 text-sm text-[#3D2314]/60">Receita, custo e margem de cada obra, previsto × realizado, com o consolidado.</div>
            <div className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[#C8941A]">Abrir <ArrowRight size={14} /></div>
          </Link>
          <Link href="/dashboard/projetos/cockpit?area=hub" data-testid="novidade-cockpit" className="rounded-xl border border-[#C8941A]/40 bg-white p-4 shadow-sm transition-colors hover:bg-[#C8941A]/5">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#C8941A]">Novo</div>
            <div className="text-base font-medium text-[#3D2314]">Cockpit da obra</div>
            <div className="mt-1 text-sm text-[#3D2314]/60">Avanço, custo, margem e pendências de uma obra numa tela só.</div>
            <div className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[#C8941A]">Abrir <ArrowRight size={14} /></div>
          </Link>
        </div>
      </section>

      {/* INDICADORES */}
      <section className="mt-16" data-testid="painel-indicadores">
        <SectionLabel>Indicadores</SectionLabel>

        <div className="mb-3 mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiPrincipal label="Obras em andamento" chave="projetos.painel.kpi.obras_ativas" testid="kpi-obras-ativas" valor={resumo ? String(resumo.obras_ativas) : "…"} />
          <KpiPrincipal
            label="Valor das obras em andamento"
            chave="projetos.painel.kpi.valor_obras"
            valor={resumo ? fmtBRL(resumo.valor_orcamento_ativo) : "…"}
          />
          <KpiPrincipal
            label="Margem prevista das obras"
            chave="projetos.painel.kpi.margem_prevista"
            testid="kpi-margem-prevista"
            valor={!resumo ? "…" : resumo.margem_prevista_pct === null ? "—" : `${fmtPct(resumo.margem_prevista_pct)}`}
          />
          <KpiPrincipal label="Propostas pendentes" chave="projetos.painel.kpi.propostas_pendentes" valor={resumo ? String(resumo.propostas_pendentes) : "…"} />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <KpiSecundario
            label="Contas a pagar abertas"
            chave="projetos.painel.kpi.pagar_aberto"
            valor={resumo ? fmtBRL(resumo.pagar_aberto) : "…"}
          />
          <KpiSecundario
            label="Contas a receber abertas"
            chave="projetos.painel.kpi.receber_aberto"
            valor={resumo ? fmtBRL(resumo.receber_aberto) : "…"}
          />
        </div>
      </section>

      {/* FUNIL — contador honesto, cada número leva para o funil */}
      <section className="mt-12" data-testid="painel-funil">
        <div className="flex items-center gap-1">
          <SectionLabel>Funil de oportunidades</SectionLabel>
          <AjudaCampo chave="projetos.painel.funil" />
        </div>
        <Link href="/dashboard/projetos/oportunidades" className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-[#3D2314]/12 bg-white p-4 shadow-sm hover:border-[#C8941A] md:grid-cols-4">
          <Numero label="Em aberto" valor={resumo ? String(resumo.funil_abertas) : "…"} testid="funil-abertas" />
          <Numero label="Valor em aberto" valor={resumo ? fmtBRL(resumo.funil_valor_aberto) : "…"} />
          <Numero label="Ganhas" valor={resumo ? String(resumo.funil_ganhas) : "…"} />
          <Numero label="Perdidas" valor={resumo ? String(resumo.funil_perdidas) : "…"} />
        </Link>
      </section>

      {/* OBRAS POR SITUAÇÃO */}
      <section className="mt-12" data-testid="painel-obras-situacao">
        <div className="flex items-center gap-1">
          <SectionLabel>Obras por situação</SectionLabel>
          <AjudaCampo chave="projetos.painel.obras_situacao" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {SITUACOES.map((x) => (
            <Link key={x.s} href="/dashboard/projetos/obras" data-testid={`situacao-${x.s}`} className="rounded-xl border border-[#3D2314]/12 bg-white p-4 shadow-sm hover:border-[#C8941A]">
              <Numero label={x.l} valor={resumo ? String(resumo.obras_por_status[x.s] ?? 0) : "…"} />
            </Link>
          ))}
        </div>
      </section>

      {erro && (
        <p role="alert" className="mt-4 rounded-lg border border-[#3D2314]/12 bg-white p-3 text-sm text-[#3D2314]/70">
          Não foi possível carregar os indicadores agora. Atualize a página; se persistir, avise o suporte.
        </p>
      )}
      {!erro && resumo && resumo.obras_ativas === 0 && resumo.propostas_pendentes === 0 && (
        <p className="mt-4 rounded-lg border border-[#3D2314]/12 bg-white p-3 text-sm text-[#3D2314]/70">
          Zero não é erro: ainda não há obra em andamento nem proposta pendente nesta empresa. Comece cadastrando uma oportunidade no funil — ela vira proposta e depois obra.
        </p>
      )}

      {/* PRÓXIMOS PASSOS */}
      <section className="mt-16">
        <SectionLabel>Por onde começar</SectionLabel>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          {PASSOS.map((p) => (
            <Link key={p.href} href={p.href} className="rounded-xl border border-[#3D2314]/12 bg-white p-4 shadow-sm hover:border-[#C8941A]">
              <div className="text-sm font-medium text-[#3D2314]">{p.titulo}</div>
              <div className="mt-1 text-xs text-[#3D2314]/60">{p.texto}</div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-sm font-semibold uppercase tracking-wider text-[#3D2314]/60"
      style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal", letterSpacing: "0.08em" }}
    >
      {children}
    </h2>
  );
}

function Numero({ label, valor, testid }: { label: string; valor: string; testid?: string }) {
  return (
    <div>
      <div className="mb-1 text-xs text-[#3D2314]/50">{label}</div>
      <div data-testid={testid} className="text-lg font-medium text-[#3D2314]" style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}>
        {valor}
      </div>
    </div>
  );
}

function KpiPrincipal({ label, valor, chave, testid }: { label: string; valor: string; chave: string; testid?: string }) {
  return (
    <div className="rounded-xl border border-[#3D2314]/12 bg-white p-5 shadow-sm">
      <div className="mb-2 flex items-center gap-1 text-xs text-[#3D2314]/50">{label}<AjudaCampo chave={chave} /></div>
      <div
        data-testid={testid}
        className="text-2xl font-medium text-[#3D2314]"
        style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
      >
        {valor}
      </div>
    </div>
  );
}

function KpiSecundario({ label, valor, chave }: { label: string; valor: string; chave: string }) {
  // Sem cor semântica vermelho/verde quando dado é normal/zero.
  // Reservado para futuras condições de alerta real (vencidos > 30d etc).
  return (
    <div className="rounded-xl border border-[#3D2314]/12 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-1 text-xs text-[#3D2314]/50">{label}<AjudaCampo chave={chave} /></div>
      <div
        className="text-lg font-medium text-[#3D2314]"
        style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
      >
        {valor}
      </div>
    </div>
  );
}
