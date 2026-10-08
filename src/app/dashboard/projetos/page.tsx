// src/app/dashboard/projetos/page.tsx
// Painel inicial premium do Hub Projetos
// Estrutura: Hero centralizado + Indicadores + Próximos passos

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Hammer, ArrowRight } from "lucide-react";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { supabaseBrowser } from "@/lib/authFetch";

interface ResumoEmpresa {
  obras_ativas: number;
  propostas_pendentes: number;
  valor_orcamento_ativo: number;
  margem_media_pct: number;
  pagar_aberto: number;
  receber_aberto: number;
}

const PASSOS = [
  { href: "/dashboard/projetos/oportunidades", titulo: "1. Funil de oportunidades", texto: "Registre o cliente e a obra que quer orçar." },
  { href: "/dashboard/projetos/obras", titulo: "2. Obras", texto: "Acompanhe escopo, status e fiscal de cada obra." },
  { href: "/dashboard/projetos/obras/resultado", titulo: "3. Resultado por obra", texto: "Previsto x realizado: custo, compras e margem." },
];

const NOVIDADES = [
  { href: "/dashboard/projetos/obras/resultado", titulo: "Resultado por obra", texto: "Receita, custo direto, rateio e margem de cada obra, previsto × realizado." },
  { href: "/dashboard/projetos/obras/cockpit", titulo: "Cockpit da obra", texto: "Avanço, custo, margem, prazo e pendências do dia numa tela só." },
];

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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
        const [{ data: v }, { data: k }, { count: propostas }] = await Promise.all([
          supabase.from("v_projetos_resumo_empresa").select("contas_pagar_abertas,contas_receber_abertas").eq("company_id", companyId).maybeSingle(),
          supabase.rpc("fn_obras_kpis", { p_company_ids: [companyId] }),
          supabase.from("erp_orcamentos").select("id", { count: "exact", head: true }).eq("company_id", companyId).in("status", ["rascunho", "enviado"]),
        ]);
        const kp = (k as any) || {};
        if (!cancel) {
          setResumo({
            obras_ativas: Number(kp.em_andamento ?? 0),
            propostas_pendentes: propostas ?? 0,
            valor_orcamento_ativo: Number(kp.valor_em_andamento ?? 0),
            margem_media_pct: 0,
            pagar_aberto: Number((v as any)?.contas_pagar_abertas ?? 0),
            receber_aberto: Number((v as any)?.contas_receber_abertas ?? 0),
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
          <Link
            href="/dashboard/projetos/oportunidades"
            className="text-sm text-[#3D2314]/60 hover:text-[#3D2314]"
          >
            Abrir o funil de oportunidades
          </Link>
        </div>
      </section>

      {/* INDICADORES */}
      <section className="mt-16">
        <SectionLabel>Indicadores</SectionLabel>

        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3">
          <KpiPrincipal label="Obras ativas" valor={String(resumo?.obras_ativas ?? 0)} />
          <KpiPrincipal label="Propostas pendentes" valor={String(resumo?.propostas_pendentes ?? 0)} />
          <KpiPrincipal
            label="Valor das obras em andamento"
            valor={fmtBRL(resumo?.valor_orcamento_ativo ?? 0)}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <KpiSecundario
            label="Contas a pagar abertas"
            valor={fmtBRL(resumo?.pagar_aberto ?? 0)}
          />
          <KpiSecundario
            label="Contas a receber abertas"
            valor={fmtBRL(resumo?.receber_aberto ?? 0)}
          />
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

      {/* NOVIDADES DO HUB */}
      <section className="mt-16" data-testid="novidades-hub">
        <SectionLabel>Novidades do Hub</SectionLabel>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          {NOVIDADES.map((p) => (
            <Link key={p.href} href={p.href} className="rounded-xl border border-[#C8941A]/40 bg-white p-4 shadow-sm hover:border-[#C8941A]">
              <div className="text-sm font-medium text-[#3D2314]">{p.titulo}</div>
              <div className="mt-1 text-xs text-[#3D2314]/60">{p.texto}</div>
            </Link>
          ))}
        </div>
      </section>

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

function KpiPrincipal({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-xl border border-[#3D2314]/12 bg-white p-5 shadow-sm">
      <div className="mb-2 text-xs text-[#3D2314]/50">{label}</div>
      <div
        className="text-2xl font-medium text-[#3D2314]"
        style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
      >
        {valor}
      </div>
    </div>
  );
}

function KpiSecundario({ label, valor }: { label: string; valor: string }) {
  // Sem cor semântica vermelho/verde quando dado é normal/zero.
  // Reservado para futuras condições de alerta real (vencidos > 30d etc).
  return (
    <div className="rounded-xl border border-[#3D2314]/12 bg-white p-4 shadow-sm">
      <div className="mb-1 text-xs text-[#3D2314]/50">{label}</div>
      <div
        className="text-lg font-medium text-[#3D2314]"
        style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
      >
        {valor}
      </div>
    </div>
  );
}
