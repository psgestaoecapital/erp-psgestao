// src/app/dashboard/projetos/page.tsx
// Painel inicial do Hub Projetos
// Lê v_projetos_resumo_empresa + projetos_modulo_config

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { supabaseBrowser } from "@/lib/authFetch";

interface ResumoEmpresa {
  obras_ativas: number;
  obras_concluidas_mes: number;
  propostas_pendentes: number;
  valor_orcamento_ativo: number;
  margem_media_pct: number;
  pagar_aberto: number;
  receber_aberto: number;
  bdi_lucro_pct: number;
}

interface ConfigBdi {
  bdi_administracao_central_pct: number;
  bdi_seguros_pct: number;
  bdi_riscos_pct: number;
  bdi_garantia_pct: number;
  bdi_despesas_financeiras_pct: number;
  bdi_impostos_pct: number;
  bdi_lucro_pct: number;
  bdi_total_pct: number;
}

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function ProjetosPainelPage() {
  const { sel, companyIds, companies } = useCompanyIds();
  const companyId = sel && !sel.startsWith("group_") && sel !== "consolidado" ? sel : null;
  const empresa = companies.find((c) => c.id === companyId);
  const empresaNome = empresa?.nome_fantasia || empresa?.razao_social || "—";

  const [resumo, setResumo] = useState<ResumoEmpresa | null>(null);
  const [config, setConfig] = useState<ConfigBdi | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const supabase = supabaseBrowser();
        const [resR, cfgR] = await Promise.all([
          supabase
            .from("v_projetos_resumo_empresa")
            .select("*")
            .eq("company_id", companyId)
            .maybeSingle(),
          supabase
            .from("projetos_modulo_config")
            .select("*")
            .eq("company_id", companyId)
            .maybeSingle(),
        ]);
        if (cancel) return;
        if (resR.error && resR.error.code !== "PGRST116") throw resR.error;
        if (cfgR.error && cfgR.error.code !== "PGRST116") throw cfgR.error;
        setResumo((resR.data as any) || null);
        setConfig((cfgR.data as any) || null);
      } catch (e: any) {
        if (!cancel) setErro(e.message || "Falha ao carregar painel");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [companyId]);

  if (!companyId) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="rounded-2xl bg-[#FAF7F2] p-12 text-center">
          <div className="mb-4 text-5xl">🏗️</div>
          <h2 className="text-xl font-bold text-[#3D2314]">
            Selecione uma empresa para acessar o Hub Projetos
          </h2>
          <p className="mt-2 text-sm text-[#3D2314]/70">
            O módulo Projetos opera por empresa específica. Use o seletor no topo do ERP.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      {/* Header */}
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-[#3D2314]">
          Projetos · {empresaNome}
        </h1>
        <p className="text-xs text-[#3D2314]/60">
          Hub de Engenharia, CRM de obra, precificação e acompanhamento
        </p>
      </header>

      {erro && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>
      )}

      {/* Banner boas-vindas */}
      <section className="mb-6 rounded-2xl bg-[#3D2314] p-5 text-[#FAF7F2]">
        <h2 className="text-lg font-bold">👷 Bem-vindo ao Hub Projetos!</h2>
        <p className="mt-2 text-sm text-[#FAF7F2]/80 leading-relaxed">
          Esta área está sendo construída. Em breve você poderá gerenciar todo o ciclo de obras:
          do primeiro contato com cliente até a entrega final, passando por engenharia,
          orçamento, propostas comerciais e acompanhamento financeiro.
        </p>
      </section>

      {/* KPIs principais (zerados inicialmente) */}
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Obras ativas" valor={resumo?.obras_ativas ?? 0} />
        <KpiCard label="Propostas pendentes" valor={resumo?.propostas_pendentes ?? 0} />
        <KpiCard
          label="Orçamento ativo"
          valor={resumo?.valor_orcamento_ativo ? fmtBRL(resumo.valor_orcamento_ativo) : fmtBRL(0)}
        />
        <KpiCard
          label="Margem média"
          valor={`${resumo?.margem_media_pct?.toFixed(1) ?? "0.0"}%`}
        />
      </section>

      {/* KPIs auxiliares (já populados pelo backend) */}
      <section className="mb-6 grid grid-cols-2 gap-3">
        <SecKpi
          label="Contas a pagar abertas"
          valor={resumo?.pagar_aberto ? fmtBRL(resumo.pagar_aberto) : fmtBRL(0)}
          tom="vermelho"
        />
        <SecKpi
          label="Contas a receber abertas"
          valor={resumo?.receber_aberto ? fmtBRL(resumo.receber_aberto) : fmtBRL(0)}
          tom="verde"
        />
      </section>

      {/* Próximos passos */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#3D2314]/70">
          🚀 Próximos passos
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <NextStep
            href="/dashboard/projetos/clientes"
            titulo="Cadastrar primeiro cliente"
            desc="Adicione clientes finais (PF/PJ) e suas obras."
            disponivel={false}
            faseLabel="Fase 2"
          />
          <NextStep
            href="/dashboard/projetos/catalogo"
            titulo="Configurar catálogo"
            desc="Cadastre serviços oferecidos (forro, drywall, sanca) com CPU."
            disponivel={false}
            faseLabel="Fase 1"
          />
          <NextStep
            href="/dashboard/projetos/configuracoes"
            titulo={loading ? "Carregando BDI..." : "Configurar BDI"}
            desc={
              config?.bdi_total_pct
                ? `BDI atual: ${config.bdi_total_pct.toFixed(2)}% (lucro ${config.bdi_lucro_pct?.toFixed(1)}%, impostos ${config.bdi_impostos_pct?.toFixed(2)}%)`
                : "Defina os percentuais de BDI da empresa."
            }
            disponivel={true}
            faseLabel="Disponível"
          />
        </div>
      </section>
    </main>
  );
}

function KpiCard({ label, valor }: { label: string; valor: string | number }) {
  return (
    <div className="rounded-xl bg-[#FAF7F2] p-4">
      <div className="text-xs uppercase text-[#3D2314]/60">{label}</div>
      <div className="mt-1 text-2xl font-bold text-[#3D2314]">{valor}</div>
    </div>
  );
}

function SecKpi({ label, valor, tom }: { label: string; valor: string; tom: "verde" | "vermelho" }) {
  const cor = tom === "verde" ? "text-emerald-700" : "text-red-700";
  const bg = tom === "verde" ? "bg-emerald-50" : "bg-red-50";
  return (
    <div className={`rounded-xl p-4 ${bg}`}>
      <div className="text-xs uppercase text-[#3D2314]/70">{label}</div>
      <div className={`mt-1 text-xl font-bold ${cor}`}>{valor}</div>
    </div>
  );
}

function NextStep({
  href,
  titulo,
  desc,
  disponivel,
  faseLabel,
}: {
  href: string;
  titulo: string;
  desc: string;
  disponivel: boolean;
  faseLabel: string;
}) {
  const inner = (
    <div
      className={`rounded-2xl p-4 transition ${
        disponivel
          ? "bg-[#FAF7F2] hover:shadow-md cursor-pointer"
          : "bg-[#FAF7F2]/60 cursor-not-allowed"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            disponivel
              ? "bg-emerald-100 text-emerald-800"
              : "bg-[#C8941A]/20 text-[#C8941A]"
          }`}
        >
          {faseLabel}
        </span>
      </div>
      <h3 className={`font-semibold ${disponivel ? "text-[#3D2314]" : "text-[#3D2314]/60"}`}>
        {titulo}
      </h3>
      <p className="mt-1 text-xs text-[#3D2314]/60">{desc}</p>
    </div>
  );

  return disponivel ? <Link href={href}>{inner}</Link> : <div>{inner}</div>;
}
