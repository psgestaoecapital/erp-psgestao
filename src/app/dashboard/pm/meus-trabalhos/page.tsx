"use client";
// P&M · Meus Trabalhos (tela 25 do SIGA, blueprint V8): o que é meu, em 3 agrupamentos (Por prazo / Por início / Por situação),
// 6 indicadores, situação na própria linha e agenda semanal. Lê a regra da Pauta (atalho "meus") e minhas tarefas; só leitura.
// ▶ em cada job (onda 2 da P&M da Pdois, Parte S, atrito 18): apontar hora em 1 toque também na fila pessoal.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Briefcase, Play } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";
import EmpresaNaoResolvida from "@/components/pm/EmpresaNaoResolvida";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { BotaoPlay } from "@/components/pm/BotaoPlay";
import type { ItemPauta } from "@/lib/pm/pauta";
import { agendaSemana, agrupar, indicadores, rotuloSituacao, type Agrupamento, type TrabalhoJob, type TrabalhoTarefa } from "@/lib/pm/meusTrabalhos";

const cartao = "rounded-2xl border border-[#3D2314]/10 bg-white p-4";
const ABAS: { id: Agrupamento; rotulo: string }[] = [{ id: "prazo", rotulo: "Por prazo" }, { id: "inicio", rotulo: "Por início" }, { id: "situacao", rotulo: "Por situação" }];

export default function MeusTrabalhosPage() {
  const { companyIds, loading: carregandoEmpresa, companies } = useCompanyIds();
  const empresa = companyIds[0] ?? null;
  const [modo, setModo] = useState<Agrupamento>("prazo");
  const [jobs, setJobs] = useState<TrabalhoJob[]>([]);
  const [tarefas, setTarefas] = useState<TrabalhoTarefa[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  // RD-51 (Pdois/Marciana 07/10): sem job seu, diga quantos a empresa tem — "nada para você" sem contexto parece tela quebrada
  const [totalEmpresa, setTotalEmpresa] = useState<number | null>(null);
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

  const carregar = useCallback(async () => {
    if (!empresa) return;
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id ?? null;
    setUserId(uid);
    const [ls, ct] = await Promise.all([
      supabase.rpc("fn_pauta_listar", { p_company_id: empresa, p_filtros: { atalho: "meus" }, p_situacao: null, p_agrupar: "prazo", p_pagina: 1, p_por_pagina: 200 }),
      supabase.rpc("fn_pauta_contadores", { p_company_id: empresa, p_filtros: {} }),
    ]);
    setTotalEmpresa(ct.error ? null : Number((ct.data as { total?: number } | null)?.total ?? 0));
    if (ls.error) { setErro(ls.error.message); setCarregando(false); return; }
    const itens = ((ls.data as { itens: ItemPauta[] } | null)?.itens ?? []);
    const ids = itens.map((i) => i.id);
    const [ini, ta] = await Promise.all([
      ids.length ? supabase.from("agency_jobs").select("id, data_inicio").in("id", ids) : Promise.resolve({ data: [] as { id: string; data_inicio: string | null }[] }),
      uid ? supabase.from("agency_tarefas").select("id, job_id, titulo, status, data_prazo, data_inicio").eq("company_id", empresa).eq("responsavel_id", uid).limit(500) : Promise.resolve({ data: [] }),
    ]);
    const inicio = new Map(((ini.data ?? []) as { id: string; data_inicio: string | null }[]).map((r) => [r.id, r.data_inicio]));
    setJobs(itens.map((i) => ({ id: i.id, codigo: i.codigo, titulo: i.titulo, cliente: i.cliente, status: i.status, data_prazo: i.data_prazo, data_inicio: inicio.get(i.id) ?? null, atrasado: i.atrasado })));
    setTarefas((ta.data ?? []) as TrabalhoTarefa[]);
    setCarregando(false);
  }, [empresa]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega quando a empresa muda
  useEffect(() => { void carregar(); }, [carregar]);

  const ind = useMemo(() => indicadores(jobs, tarefas, hoje), [jobs, tarefas, hoje]);
  const grupos = useMemo(() => agrupar(jobs, modo, hoje), [jobs, modo, hoje]);
  const agenda = useMemo(() => agendaSemana(jobs, tarefas, hoje), [jobs, tarefas, hoje]);
  const cods = useMemo(() => new Map(jobs.map((j) => [j.id, j.codigo])), [jobs]);

  if (!empresa) return <EmpresaNaoResolvida carregando={carregandoEmpresa} temEmpresa={companies.length > 0} tela="Meus trabalhos" />;
  const cards: [string, number, string][] = [
    ["Jobs ativos", ind.jobsAtivos, "jobs-ativos"], ["Jobs atrasados", ind.jobsAtrasados, "jobs-atrasados"],
    ["Tarefas ativas", ind.tarefasAtivas, "tarefas-ativas"], ["Tarefas atrasadas", ind.tarefasAtrasadas, "tarefas-atrasadas"],
    ["Início hoje", ind.inicioHoje, "inicio-hoje"], ["Prazo hoje", ind.prazoHoje, "prazo-hoje"],
  ];

  return (
    <div className="min-h-screen bg-[#FAF7F2] p-4 text-[#3D2314] md:p-6" data-testid="meus-trabalhos-page">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#C8941A]"><Briefcase size={13} /> Meus trabalhos<AjudaCampo chave="pm.meus_trabalhos.tela" /></div>
          <h1 className="text-[24px] font-medium leading-tight">O que é meu, em ordem</h1>
        </div>
        <Link href="/dashboard/pm/meu-dia" className="rounded-lg border border-[#3D2314]/15 bg-white px-3 py-2 text-[12.5px]">Meu dia</Link>
      </header>
      {erro && <div className="mb-3 rounded-lg bg-[#F7E1E1] px-3 py-2 text-[12.5px] text-[#791F1F]" onClick={() => setErro(null)}>{erro}</div>}
      {carregando && <div className="text-[12.5px] text-[#3D2314]/55">carregando…</div>}

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-6" data-testid="mt-indicadores">
        {cards.map(([rot, n, id]) => (
          <div key={id} className={`${cartao} ${n > 0 && id.includes("atrasad") ? "border-[#791F1F]/30" : ""}`} data-testid={`mt-ind-${id}`}>
            <div className="text-[11px] text-[#3D2314]/60">{rot}</div><div className="text-[24px] font-medium">{n}</div>
          </div>))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <section className={`${cartao} lg:col-span-2`} data-testid="mt-lista">
          <div className="mb-3 flex flex-wrap items-center gap-1" role="tablist">
            {ABAS.map((a) => (
              <button key={a.id} role="tab" aria-selected={modo === a.id} onClick={() => setModo(a.id)} data-testid={`mt-aba-${a.id}`}
                className={`rounded-lg px-3 py-1.5 text-[12.5px] ${modo === a.id ? "bg-[#3D2314] text-white" : "border border-[#3D2314]/15 bg-white"}`}>{a.rotulo}</button>))}
            <span className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-[#3D2314]/60"><Play size={11} fill="currentColor" /> aponta horas <AjudaCampo chave="pm.meus_trabalhos.apontar" /></span>
          </div>
          {!grupos.length && !carregando && !erro && (
            <div className="text-[12.5px] text-[#3D2314]/70" data-testid="mt-vazio">
              Nenhum job em andamento está com você como responsável.
              {totalEmpresa !== null && totalEmpresa > 0 && <> A pauta da empresa tem {totalEmpresa} job(s) com outras pessoas — <Link href="/dashboard/pm/pauta" className="font-medium text-[#C8941A] underline" data-testid="mt-ver-pauta">ver na Pauta</Link>.</>}
              {totalEmpresa === 0 && <> A empresa ainda não tem jobs na pauta.</>}
            </div>
          )}
          {grupos.map((g) => (
            <div key={g.grupo} className="mb-3" data-testid="mt-grupo">
              <div className={`text-[12px] font-semibold ${g.grupo === "Atrasados" ? "text-[#791F1F]" : "text-[#3D2314]/70"}`}>{g.grupo} · {g.itens.length}</div>
              <ul className="divide-y divide-[#3D2314]/6">
                {g.itens.map((j) => (
                  <li key={j.id} className="flex items-center gap-2 py-1.5 text-[13px]" data-testid="mt-job">
                    <BotaoPlay empresa={empresa} userId={userId} jobId={j.id} rotulo={j.codigo} />
                    <Link href={`/dashboard/pm/pauta?job=${j.id}`} className="shrink-0 rounded-md bg-[#3D2314]/8 px-1.5 py-0.5 text-[12px] font-semibold hover:bg-[#C8941A]/20">{j.codigo}</Link>
                    <span className="min-w-0 flex-1 truncate">{j.titulo}<span className="block truncate text-[11px] text-[#3D2314]/55">{j.cliente ?? ""}</span></span>
                    <span className="shrink-0 rounded-full bg-[#FAEEDA] px-2 py-0.5 text-[11px]" data-testid="mt-situacao">{rotuloSituacao(j.status)}</span>
                  </li>))}
              </ul>
            </div>))}
        </section>

        <section className={cartao} data-testid="mt-agenda">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#3D2314]/60">Agenda da semana</div>
          <ul className="space-y-1.5">
            {agenda.map((d) => (
              <li key={d.data} className={`rounded-lg px-2.5 py-1.5 text-[12.5px] ${d.data === hoje ? "bg-[#FAEEDA]" : "bg-[#FAF7F2]"}`} data-testid="mt-agenda-dia">
                <div className="font-medium">{d.rotulo}{d.data === hoje ? " · hoje" : ""}</div>
                {!d.jobs.length && !d.tarefas.length && <div className="text-[11.5px] text-[#3D2314]/45">livre</div>}
                {d.jobs.map((j) => <div key={j.id} className="truncate text-[11.5px]"><b>{j.codigo}</b> {j.titulo}</div>)}
                {d.tarefas.map((t) => <div key={t.id} className="truncate text-[11.5px] text-[#3D2314]/70">tarefa · {t.titulo}{cods.get(t.job_id) ? ` (${cods.get(t.job_id)})` : ""}</div>)}
              </li>))}
          </ul>
        </section>
      </div>
    </div>
  );
}
