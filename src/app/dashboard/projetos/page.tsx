// src/app/dashboard/projetos/page.tsx
// Painel inicial premium do Hub Projetos
// Estrutura: Hero centralizado + Novidades + Indicadores + Funil + Obras por situação + Próximos passos
// Fontes (PDCA 23/10 — "dado não bate com banco"): obras e margem prevista de v_obra_resultado (security_invoker),
// valor das obras de fn_obras_kpis, funil de erp_crm_oportunidade (RLS), propostas de erp_orcamentos. Todo indicador tem "?" (RD-95).

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Hammer, ArrowRight, Clock, FileClock, CalendarDays, AlertTriangle } from "lucide-react";
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
  aprovacoes_pendentes: number;
  orcamentos_parados: number;
  compromissos_7d: number;
  obras_atrasadas: number;
  obras_andamento: ObraAndamento[];
}

// Obras em andamento do painel: mesma fonte e mesma conta da "Margem prevista das obras" (receita − custo previstos).
// §310 "avanço financeiro de cada uma" + pedido do Diego/FC ("resultado por obra: previsto × realizado"):
// além do previsto, o painel traz a margem REALIZADA (margem_realizada da v_obra_resultado = receita realizada −
// custo realizado), lado a lado, para o sócio ver o previsto × realizado sem abrir a tela de Resultado por obra.
interface ObraAndamento {
  obra_id: string;
  numero: string | null;
  nome: string | null;
  receita_prevista: number;
  custo_previsto: number;
  receita_realizada: number;
  margem_realizada: number;
}

const SITUACOES = [
  { s: "em_andamento", l: "Em andamento" },
  { s: "pausada", l: "Pausadas" },
  { s: "concluida", l: "Concluídas" },
  { s: "cancelada", l: "Canceladas" },
];

// Ferramentas de Gestão (Blueprint Hub §310, relatório 03): atalhos de trabalho SEM numeração
// 1-2-3 (não é um passo a passo obrigatório) — o grid comporta novos atalhos conforme o Hub cresce.
const PASSOS = [
  { href: "/dashboard/projetos/oportunidades", titulo: "Funil de oportunidades", texto: "Registre o cliente e a obra que quer orçar." },
  { href: "/dashboard/projetos/obras", titulo: "Obras", texto: "Acompanhe escopo, status e fiscal de cada obra." },
  { href: "/dashboard/projetos/obras/resultado", titulo: "Resultado por obra", texto: "Previsto x realizado: custo, compras e margem." },
  { href: "/dashboard/projetos/agenda", titulo: "Agenda e tarefas", texto: "Compromissos, visitas e tarefas da obra em um só lugar." },
  { href: "/dashboard/hub/plano-acao", titulo: "Plano de ação 5W2H", texto: "Reuniões e ações por obra: o quê, quem e até quando." },
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
        // Obras por situação: MESMA fonte da tela /projetos/obras (projetos_obras, via fn_obras_kpis). Antes o Painel
        // contava por v_obra_resultado (view derivada) e podia divergir da lista (auditor 27/10: Painel "Concluídas 0"
        // x lista "Concluídas 1"). Uma fonte só = os números sempre batem. Só as obras em andamento vêm linha a linha
        // (receita/custo previstos) da v_obra_resultado para a tabela abaixo.
        // "Bloco do dia" (§310): orçamentos enviados sem retorno há mais de 7 dias (cobrar o cliente),
        // revisões de escopo aguardando aprovação (decisão travando a obra) e os compromissos da Agenda
        // comercial marcados de hoje até os próximos 7 dias. Erros destes blocos NÃO derrubam o painel
        // (try separado no throw): são blocos de apoio, não os indicadores principais.
        const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        // Compromissos: mesma fonte da Agenda do Hub (erp_agendamento origem_modulo='comercial', RD-26),
        // de hoje (inclusive) até +7 dias; ignora cancelados e títulos de robô/teste, como a própria Agenda.
        const hojeData = new Date().toISOString().slice(0, 10);
        const mais7Data = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const [{ data: v }, { data: k, error: ek }, { count: propostas, error: ep }, { data: obras, error: eo }, { data: opps, error: eop }, { count: orcParados, error: eorc }, { count: revPend, error: erev }, { count: compromissos, error: eag }, { count: obrasAtrasadas, error: eobr }] = await Promise.all([
          supabase.from("v_projetos_resumo_empresa").select("contas_pagar_abertas,contas_receber_abertas").eq("company_id", companyId).maybeSingle(),
          supabase.rpc("fn_obras_kpis", { p_company_ids: [companyId] }),
          supabase.from("erp_orcamentos").select("id", { count: "exact", head: true }).eq("company_id", companyId).in("status", ["rascunho", "enviado"]),
          supabase.from("v_obra_resultado").select("obra_id,numero,nome,status,receita_prevista,custo_previsto,receita_servico,receita_material,margem_realizada").eq("company_id", companyId).eq("status", "em_andamento"),
          supabase.from("erp_crm_oportunidade").select("etapa,valor_estimado").eq("company_id", companyId).is("deleted_at", null),
          supabase.from("erp_orcamentos").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "enviado").is("deleted_at", null).lt("updated_at", seteDiasAtras),
          supabase.from("projetos_obra_revisao").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "solicitada").is("excluido_em", null),
          supabase.from("erp_agendamento").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("origem_modulo", "comercial").neq("status", "cancelado").gte("data", hojeData).lte("data", mais7Data).not("titulo", "ilike", "%[BOT]%").not("titulo", "ilike", "%E2E%"),
          // Obras atrasadas (§310 "bloco de obras" · atrasadas): obra em andamento cujo prazo previsto de
          // término (data_prevista_fim) já passou. Fonte direta de projetos_obras (RLS por company), não a
          // v_obra_resultado (que não traz o prazo). Só em_andamento vencida = alerta de prazo acionável.
          supabase.from("projetos_obras").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "em_andamento").lt("data_prevista_fim", hojeData).is("deleted_at", null),
        ]);
        if (ek || ep || eo || eop) throw new Error("indicadores");
        const kp = (k as { em_andamento?: number; concluidas?: number; pausada?: number; cancelada?: number; valor_em_andamento?: number } | null) ?? {};
        const fin = v as { contas_pagar_abertas: number | null; contas_receber_abertas: number | null } | null;
        const porStatus: Record<string, number> = {
          em_andamento: Number(kp.em_andamento ?? 0),
          pausada: Number(kp.pausada ?? 0),
          concluida: Number(kp.concluidas ?? 0),
          cancelada: Number(kp.cancelada ?? 0),
        };
        let receita = 0, custo = 0;
        const andamento: ObraAndamento[] = [];
        for (const o of (obras as { obra_id: string; numero: string | null; nome: string | null; status: string; receita_prevista: number | null; custo_previsto: number | null; receita_servico: number | null; receita_material: number | null; margem_realizada: number | null }[] | null) ?? []) {
          receita += Number(o.receita_prevista ?? 0); custo += Number(o.custo_previsto ?? 0);
          andamento.push({ obra_id: o.obra_id, numero: o.numero, nome: o.nome, receita_prevista: Number(o.receita_prevista ?? 0), custo_previsto: Number(o.custo_previsto ?? 0), receita_realizada: Number(o.receita_servico ?? 0) + Number(o.receita_material ?? 0), margem_realizada: Number(o.margem_realizada ?? 0) });
        }
        andamento.sort((a, b) => b.receita_prevista - a.receita_prevista);
        let abertas = 0, valorAberto = 0, ganhas = 0, perdidas = 0;
        // #3335 · "Valor em aberto" sai de valor_estimado — a MESMA fonte do pipeline da tela de funil
        // (/projetos/oportunidades, somaValor(valor_estimado)). Antes o painel somava valor_proposta ?? valor_estimado
        // e divergia do funil para a mesma empresa (DEMO: painel R$ 931.748,80 × funil R$ 956.000,00), número errado
        // entre telas (RD-97). Uma fonte só = os dois batem (RD-38).
        for (const o of (opps as { etapa: string; valor_estimado: number | null }[] | null) ?? []) {
          if (o.etapa === "ganho") ganhas++;
          else if (o.etapa === "perdido") perdidas++;
          else { abertas++; valorAberto += Number(o.valor_estimado ?? 0); }
        }
        if (!cancel) {
          setResumo({
            obras_ativas: porStatus.em_andamento,
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
            aprovacoes_pendentes: erev ? 0 : Number(revPend ?? 0),
            orcamentos_parados: eorc ? 0 : Number(orcParados ?? 0),
            compromissos_7d: eag ? 0 : Number(compromissos ?? 0),
            obras_atrasadas: eobr ? 0 : Number(obrasAtrasadas ?? 0),
            obras_andamento: andamento,
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
    <main className="mx-auto max-w-5xl px-4 py-8 md:px-6">
      {/* HERO — compacto: os indicadores aparecem já na primeira dobra */}
      <section className="py-4 text-center">
        <div className="mx-auto mb-3 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#3D2314]/8">
          <Hammer size={22} className="text-[#C8941A]" />
        </div>
        <h1
          className="text-2xl font-medium text-[#3D2314] mb-1 md:text-3xl"
          style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal", letterSpacing: "-0.01em" }}
        >
          Projetos · {empresaNome}
        </h1>
        <p className="text-[#3D2314]/60 mb-5 max-w-xl mx-auto">
          Hub de engenharia, CRM de obra e acompanhamento
        </p>
        {/* §310 (relatório 03): topo focado no trabalho — o funil é a entrada. A configuração de
            BDI saiu do topo (fica ao fim, em "Configuração da empresa"). */}
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/dashboard/projetos/oportunidades"
            className="inline-flex items-center gap-2 rounded-lg bg-[#3D2314] px-5 py-2.5 text-sm font-medium text-[#FAF7F2] transition-colors hover:bg-[#3D2314]/90"
          >
            Abrir o funil de oportunidades
            <ArrowRight size={14} />
          </Link>
          <AjudaCampo chave="projetos.painel.acao.abrir_funil" />
        </div>
      </section>

      {/* INDICADORES */}
      <section className="mt-10" data-testid="painel-indicadores">
        <SectionLabel>Indicadores</SectionLabel>

        {/* Cada indicador leva à tela CRUD correspondente (drill-down). */}
        <div className="mb-3 mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiPrincipal label="Obras em andamento" chave="projetos.painel.kpi.obras_ativas" testid="kpi-obras-ativas" valor={resumo ? String(resumo.obras_ativas) : "…"} href="/dashboard/projetos/obras?status=em_andamento&area=hub" />
          <KpiPrincipal
            label="Valor das obras em andamento"
            chave="projetos.painel.kpi.valor_obras"
            valor={resumo ? fmtBRL(resumo.valor_orcamento_ativo) : "…"}
            href="/dashboard/projetos/obras/resultado?area=hub"
          />
          <KpiPrincipal
            label="Margem prevista das obras"
            chave="projetos.painel.kpi.margem_prevista"
            testid="kpi-margem-prevista"
            valor={!resumo ? "…" : resumo.margem_prevista_pct === null ? "—" : `${fmtPct(resumo.margem_prevista_pct)}`}
            href="/dashboard/projetos/obras/resultado?area=hub"
          />
          <KpiPrincipal label="Propostas pendentes" chave="projetos.painel.kpi.propostas_pendentes" valor={resumo ? String(resumo.propostas_pendentes) : "…"} href="/dashboard/projetos/propostas" />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <KpiSecundario
            label="Contas a pagar abertas"
            chave="projetos.painel.kpi.pagar_aberto"
            valor={resumo ? fmtBRL(resumo.pagar_aberto) : "…"}
            vazio={!!resumo && resumo.pagar_aberto === 0}
            vazioTexto="Sem conta a pagar em aberto — abrir o Financeiro"
            href="/dashboard/financeiro/pagar"
          />
          <KpiSecundario
            label="Contas a receber abertas"
            chave="projetos.painel.kpi.receber_aberto"
            valor={resumo ? fmtBRL(resumo.receber_aberto) : "…"}
            vazio={!!resumo && resumo.receber_aberto === 0}
            vazioTexto="Sem conta a receber em aberto — abrir o Financeiro"
            href="/dashboard/financeiro/receber"
          />
        </div>
      </section>

      {/* PARA HOJE — §310 (relatório 01 · reunião 20/11): bloco do dia. Hoje: compromissos da Agenda
          nos próximos 7 dias, aprovações de escopo paradas e orçamentos enviados sem retorno. Cada card
          é acionável e tem "?" (RD-95); estado calmo quando não há pendência (RD-98). */}
      <section className="mt-12" data-testid="painel-para-hoje">
        <div className="flex items-center gap-1">
          <Clock size={14} className="text-[#C8941A]" />
          <SectionLabel>Para hoje</SectionLabel>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <PendenciaCard
            icone={<CalendarDays size={18} className="text-[#C8941A]" />}
            label="Compromissos (próximos 7 dias)"
            chave="projetos.painel.pendencias.compromissos"
            testid="pendencia-compromissos"
            valor={resumo ? resumo.compromissos_7d : null}
            texto={(n) => n === 1 ? "compromisso agendado de hoje aos próximos 7 dias" : "compromissos agendados de hoje aos próximos 7 dias"}
            vazioTexto="Nenhum compromisso agendado nos próximos 7 dias."
            href="/dashboard/projetos/agenda"
          />
          <PendenciaCard
            icone={<FileClock size={18} className="text-[#C8941A]" />}
            label="Aprovações pendentes"
            chave="projetos.painel.pendencias.aprovacoes"
            testid="pendencia-aprovacoes"
            valor={resumo ? resumo.aprovacoes_pendentes : null}
            texto={(n) => n === 1 ? "revisão de escopo aguardando sua aprovação" : "revisões de escopo aguardando sua aprovação"}
            vazioTexto="Nenhuma revisão de escopo aguardando decisão."
            href="/dashboard/projetos/obras"
          />
          <PendenciaCard
            icone={<Clock size={18} className="text-[#C8941A]" />}
            label="Orçamentos sem retorno"
            chave="projetos.painel.pendencias.orcamentos_parados"
            testid="pendencia-orcamentos"
            valor={resumo ? resumo.orcamentos_parados : null}
            texto={(n) => n === 1 ? "proposta enviada há mais de 7 dias sem resposta" : "propostas enviadas há mais de 7 dias sem resposta"}
            vazioTexto="Nenhuma proposta enviada esperando resposta há mais de 7 dias."
            href="/dashboard/projetos/propostas"
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
          <Numero label="Em aberto" valor={resumo ? String(resumo.funil_abertas) : "…"} testid="funil-abertas" ajuda="projetos.painel.funil" />
          <Numero label="Valor em aberto" valor={resumo ? fmtBRL(resumo.funil_valor_aberto) : "…"} ajuda="projetos.painel.funil" />
          <Numero label="Ganhas" valor={resumo ? String(resumo.funil_ganhas) : "…"} ajuda="projetos.painel.funil" />
          <Numero label="Perdidas" valor={resumo ? String(resumo.funil_perdidas) : "…"} ajuda="projetos.painel.funil" />
        </Link>
      </section>

      {/* OBRAS POR SITUAÇÃO */}
      <section className="mt-12" data-testid="painel-obras-situacao">
        <div className="flex items-center gap-1">
          <SectionLabel>Obras por situação</SectionLabel>
          <AjudaCampo chave="projetos.painel.obras_situacao" />
        </div>
        {/* §310 "bloco de obras" · atrasadas: alerta de prazo das obras em andamento cujo término previsto
            já venceu. Só aparece quando há atraso (RD-98: zero não vira alarme falso). */}
        {resumo && resumo.obras_atrasadas > 0 && (
          <Link
            href="/dashboard/projetos/obras?status=em_andamento&area=hub"
            data-testid="painel-obras-atrasadas"
            className="mt-3 flex items-start gap-3 rounded-xl border border-[#C2410C]/30 bg-[#C2410C]/5 p-4 shadow-sm transition-colors hover:border-[#C2410C]"
          >
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#C2410C]/10">
              <AlertTriangle size={18} className="text-[#C2410C]" />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1 text-xs text-[#3D2314]/50">Obras atrasadas<AjudaCampo chave="projetos.painel.obras.atrasadas" /></span>
              <span className="mt-0.5 block text-sm text-[#3D2314]">
                <span className="text-lg font-medium" style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}>{resumo.obras_atrasadas}</span>{" "}
                {resumo.obras_atrasadas === 1 ? "obra em andamento passou do prazo previsto de término" : "obras em andamento passaram do prazo previsto de término"}
              </span>
            </span>
            <ArrowRight size={14} className="ml-auto mt-1 shrink-0 text-[#C2410C]" />
          </Link>
        )}
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {SITUACOES.map((x) => (
            <Link key={x.s} href={`/dashboard/projetos/obras?status=${x.s}&area=hub`} data-testid={`situacao-${x.s}`} className="rounded-xl border border-[#3D2314]/12 bg-white p-4 shadow-sm hover:border-[#C8941A]">
              <Numero label={x.l} valor={resumo ? String(resumo.obras_por_status[x.s] ?? 0) : "…"} ajuda="projetos.painel.obras_situacao" />
            </Link>
          ))}
        </div>
      </section>

      {/* OBRAS EM ANDAMENTO — cada obra abre o cockpit dela */}
      <section className="mt-12" data-testid="painel-obras-andamento">
        <div className="flex items-center gap-1">
          <SectionLabel>Obras em andamento</SectionLabel>
          <AjudaCampo chave="projetos.cockpit.escolher_obra" rota="/dashboard/projetos/cockpit" />
        </div>
        {!resumo ? (
          <p className="mt-3 text-sm text-[#3D2314]/50">…</p>
        ) : resumo.obras_andamento.length === 0 ? (
          <p className="mt-3 rounded-xl border border-[#3D2314]/12 bg-white p-4 text-sm text-[#3D2314]/60">
            Nenhuma obra em andamento. A obra nasce quando um orçamento é aprovado — veja em{" "}
            <Link href="/dashboard/projetos/obras" className="underline">Obras</Link>.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-[#3D2314]/12 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#3D2314]/10 text-left text-xs text-[#3D2314]/50">
                  <th className="px-4 py-2 font-medium">Obra</th>
                  <th className="px-4 py-2 text-right font-medium"><span className="inline-flex items-center gap-1">Receita prevista<AjudaCampo chave="projetos.resultado_obra.receita_prevista" rota="/dashboard/projetos/obras/resultado" /></span></th>
                  <th className="px-4 py-2 text-right font-medium"><span className="inline-flex items-center gap-1">Custo previsto<AjudaCampo chave="projetos.resultado_obra.custo_previsto" rota="/dashboard/projetos/obras/resultado" /></span></th>
                  <th className="px-4 py-2 text-right font-medium"><span className="inline-flex items-center gap-1">Margem prevista<AjudaCampo chave="projetos.painel.kpi.margem_prevista" /></span></th>
                  <th className="px-4 py-2 text-right font-medium"><span className="inline-flex items-center gap-1">Margem realizada<AjudaCampo chave="projetos.resultado_obra.kpi_margem" rota="/dashboard/projetos/obras/resultado" /></span></th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {resumo.obras_andamento.slice(0, 8).map((o) => {
                  const m = o.receita_prevista > 0 ? ((o.receita_prevista - o.custo_previsto) / o.receita_prevista) * 100 : null;
                  // Margem realizada em % = margem_realizada (R$) ÷ receita já realizada. Sem receita realizada
                  // ainda (obra recém-começada), mostra "—" em vez de 0 % (não há base para o percentual) — RD-98.
                  const mr = o.receita_realizada > 0 ? (o.margem_realizada / o.receita_realizada) * 100 : null;
                  return (
                    <tr key={o.obra_id} data-testid="painel-obra-linha" className="border-b border-[#3D2314]/5 last:border-0">
                      <td className="px-4 py-2.5 text-[#3D2314]">
                        <span className="text-[#3D2314]/50">{o.numero ? `${o.numero} · ` : ""}</span>{o.nome ?? "Obra sem nome"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[#3D2314]">{fmtBRL(o.receita_prevista)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[#3D2314]">{fmtBRL(o.custo_previsto)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[#3D2314]">{m === null ? "—" : fmtPct(m)}</td>
                      <td data-testid="painel-obra-margem-realizada" className="px-4 py-2.5 text-right tabular-nums text-[#3D2314]">{mr === null ? <span className="text-[#3D2314]/40">—</span> : fmtPct(mr)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Link href={`/dashboard/projetos/obras/${o.obra_id}/cockpit?area=hub`} className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-[#C8941A] hover:underline">
                          Cockpit <ArrowRight size={14} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {resumo.obras_andamento.length > 8 && (
              <Link href="/dashboard/projetos/obras/resultado?area=hub" className="block border-t border-[#3D2314]/10 px-4 py-2 text-sm text-[#3D2314]/60 hover:text-[#3D2314]">
                Ver as {resumo.obras_andamento.length} obras no Resultado por obra
              </Link>
            )}
          </div>
        )}
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

      {/* FERRAMENTAS DE GESTÃO */}
      <section className="mt-16">
        <SectionLabel>Ferramentas de Gestão</SectionLabel>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          {PASSOS.map((p) => (
            <Link key={p.href} href={p.href} className="rounded-xl border border-[#3D2314]/12 bg-white p-4 shadow-sm hover:border-[#C8941A]">
              <div className="text-sm font-medium text-[#3D2314]">{p.titulo}</div>
              <div className="mt-1 text-xs text-[#3D2314]/60">{p.texto}</div>
            </Link>
          ))}
        </div>
      </section>

      {/* NOVIDADES DO HUB — §310 (relatório 03): curtas e no fim da página (saíram do topo, que agora
          abre direto nos indicadores). Toda entrega nova do Hub aparece aqui, no menu e nas abas. */}
      <section className="mt-16" data-testid="novidades-hub">
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

      {/* CONFIGURAÇÃO DA EMPRESA — §310: a configuração de BDI saiu do topo e fica aqui, ao fim. */}
      <section className="mt-10 mb-2">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard/projetos/configuracoes"
            className="inline-flex items-center gap-2 rounded-lg border border-[#3D2314]/15 bg-white px-4 py-2 text-sm font-medium text-[#3D2314] transition-colors hover:border-[#C8941A]"
          >
            Configurar BDI da empresa
            <ArrowRight size={14} />
          </Link>
          <AjudaCampo chave="projetos.painel.acao.configurar_bdi" />
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

function Numero({ label, valor, testid, ajuda }: { label: string; valor: string; testid?: string; ajuda?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1 text-xs text-[#3D2314]/50">{label}{ajuda && <AjudaCampo chave={ajuda} />}</div>
      <div data-testid={testid} className="text-lg font-medium text-[#3D2314]" style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}>
        {valor}
      </div>
    </div>
  );
}

function PendenciaCard({ icone, label, chave, testid, valor, texto, vazioTexto, href }: { icone: React.ReactNode; label: string; chave: string; testid?: string; valor: number | null; texto: (n: number) => string; vazioTexto: string; href: string }) {
  const vazio = valor !== null && valor === 0;
  return (
    <Link
      href={href}
      data-testid={testid}
      className="flex items-start gap-3 rounded-xl border border-[#3D2314]/12 bg-white p-4 shadow-sm transition-colors hover:border-[#C8941A]"
    >
      <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#C8941A]/10">{icone}</span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-xs text-[#3D2314]/50">{label}<AjudaCampo chave={chave} /></span>
        {valor === null ? (
          <span className="mt-0.5 block text-lg font-medium text-[#3D2314]">…</span>
        ) : vazio ? (
          <span className="mt-0.5 block text-sm text-[#3D2314]/45">{vazioTexto}</span>
        ) : (
          <span className="mt-0.5 block text-sm text-[#3D2314]">
            <span className="text-lg font-medium" style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}>{valor}</span>{" "}
            {texto(valor)}
          </span>
        )}
      </span>
      <ArrowRight size={14} className="ml-auto mt-1 shrink-0 text-[#C8941A]" />
    </Link>
  );
}

function KpiPrincipal({ label, valor, chave, testid, href }: { label: string; valor: string; chave: string; testid?: string; href?: string }) {
  const conteudo = (
    <>
      <div className="mb-2 flex items-center gap-1 text-xs text-[#3D2314]/50">{label}<AjudaCampo chave={chave} /></div>
      <div
        data-testid={testid}
        className="text-2xl font-medium text-[#3D2314]"
        style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
      >
        {valor}
      </div>
    </>
  );
  const base = "rounded-xl border border-[#3D2314]/12 bg-white p-5 shadow-sm";
  return href ? (
    <Link href={href} className={`${base} block transition-colors hover:border-[#C8941A]`}>{conteudo}</Link>
  ) : (
    <div className={base}>{conteudo}</div>
  );
}

function KpiSecundario({ label, valor, chave, href, vazio, vazioTexto }: { label: string; valor: string; chave: string; href?: string; vazio?: boolean; vazioTexto?: string }) {
  // Sem cor semântica vermelho/verde quando dado é normal/zero.
  // Zero não é bug: quando não há conta em aberto, o valor vem acompanhado de um subtexto
  // explícito (nunca "R$ 0,00" mudo que parece erro de leitura do dado — RD-98 pilar 1).
  const conteudo = (
    <>
      <div className="mb-1 flex items-center gap-1 text-xs text-[#3D2314]/50">{label}<AjudaCampo chave={chave} /></div>
      <div
        className="text-lg font-medium text-[#3D2314]"
        style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
      >
        {valor}
      </div>
      {vazio && vazioTexto && (
        <div className="mt-0.5 text-xs text-[#3D2314]/45">{vazioTexto}</div>
      )}
    </>
  );
  const base = "rounded-xl border border-[#3D2314]/12 bg-white p-4 shadow-sm";
  return href ? (
    <Link href={href} className={`${base} block transition-colors hover:border-[#C8941A]`}>{conteudo}</Link>
  ) : (
    <div className={base}>{conteudo}</div>
  );
}
