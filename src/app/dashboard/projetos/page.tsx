// src/app/dashboard/projetos/page.tsx
// Painel inicial premium do Hub Projetos
// Estrutura: Hero centralizado + Indicadores + Roadmap horizontal

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

const FASES = [
  { num: 0, label: "Fundação",     atual: true  },
  { num: 1, label: "Cadastros",    atual: false },
  { num: 2, label: "CRM Obra",     atual: false },
  { num: 3, label: "Engenharia",   atual: false },
  { num: 4, label: "Precificação", atual: false },
  { num: 5, label: "Propostas",    atual: false },
  { num: 6, label: "Acompanhar",   atual: false },
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

  useEffect(() => {
    if (!companyId) {
      setResumo(null);
      return;
    }
    let cancel = false;
    (async () => {
      try {
        const supabase = supabaseBrowser();
        const { data } = await supabase
          .from("v_projetos_resumo_empresa")
          .select("*")
          .eq("company_id", companyId)
          .maybeSingle();
        if (!cancel) setResumo((data as any) || null);
      } catch {
        if (!cancel) setResumo(null);
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
          <a
            href="#roadmap"
            className="text-sm text-[#3D2314]/60 hover:text-[#3D2314]"
          >
            Ver roadmap completo
          </a>
        </div>
      </section>

      {/* INDICADORES */}
      <section className="mt-16">
        <SectionLabel>Indicadores</SectionLabel>

        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiPrincipal label="Obras ativas" valor={String(resumo?.obras_ativas ?? 0)} />
          <KpiPrincipal label="Propostas pendentes" valor={String(resumo?.propostas_pendentes ?? 0)} />
          <KpiPrincipal
            label="Orçamento ativo"
            valor={fmtBRL(resumo?.valor_orcamento_ativo ?? 0)}
          />
          <KpiPrincipal
            label="Margem média"
            valor={`${(resumo?.margem_media_pct ?? 0).toFixed(1)}%`}
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

      {/* ROADMAP */}
      <section id="roadmap" className="mt-16">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <SectionLabel>Roadmap de construção</SectionLabel>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#C8941A]/15 px-2.5 py-1 text-xs font-medium text-[#C8941A]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#C8941A]" />
            Fase 0 ativa · próximas liberadas após Onda 7
          </span>
        </div>
        <div className="rounded-xl border border-[#3D2314]/8 bg-white p-6 shadow-sm">
          <div className="relative flex items-start justify-between">
            {/* Linha conectora absoluta */}
            <div className="absolute left-3 right-3 top-3 h-px bg-[#3D2314]/15" />
            {FASES.map((fase) => (
              <div
                key={fase.num}
                className="relative flex flex-1 flex-col items-center text-center"
              >
                <div
                  className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                    fase.atual
                      ? "bg-[#C8941A] text-white shadow-sm"
                      : "border border-[#3D2314]/20 bg-white text-[#3D2314]/40"
                  }`}
                >
                  {fase.num}
                </div>
                <div
                  className={`mt-2 text-xs ${
                    fase.atual
                      ? "font-medium text-[#3D2314]"
                      : "text-[#3D2314]/60"
                  }`}
                >
                  {fase.label}
                </div>
              </div>
            ))}
          </div>
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
