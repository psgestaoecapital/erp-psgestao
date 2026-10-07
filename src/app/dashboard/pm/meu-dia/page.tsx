"use client";
// P&M · Meu Dia (PM-D, CEO 02/10): a tela de abertura de cada pessoa da agência.
// Cronômetro (sobrevive ao recarregar), o que é meu para hoje (atrasados, hoje, próximos dias), aprovações dos meus
// jobs que vencem, menções com @ para mim, minhas últimas ações e minhas anotações (privadas — nem o gestor vê).
// Lê a mesma regra da Pauta (fn_pauta_listar com o atalho "meus"); nada de tabela nova. Todo campo tem o "?".

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Sun, AtSign, History, StickyNote, Pin, PinOff, Archive, CalendarClock, ListChecks, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { Cronometro, type JobCurto } from "@/components/pm/Cronometro";
import { BotaoPlay } from "@/components/pm/BotaoPlay";
import { prazoAprovacao, textoAtraso, type ItemPauta } from "@/lib/pm/pauta";
import { juntarAcoes, partesComMencao, type Acao, type Pessoa } from "@/lib/pm/meuDia";

type Nota = { id: string; texto: string; fixada: boolean; job_id: string | null; atualizado_em: string };
type Mencao = { id: string; job_id: string; texto: string; criado_em: string; autor_id: string | null };
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const cartao = "rounded-2xl border border-[#3D2314]/10 bg-white p-4 shadow-[0_1px_0_rgba(61,35,20,0.04)]";
const titulo = "mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-[#3D2314]/60";

function saudacao(d = new Date()) { const h = d.getHours(); return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"; }

export default function MeuDiaPage() {
  const { selInfo, companyIds } = useCompanyIds();
  const empresa = selInfo.tipo === "empresa" && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null);
  const [userId, setUserId] = useState<string | null>(null);
  const [meuNome, setMeuNome] = useState("");
  const [equipe, setEquipe] = useState<Pessoa[]>([]);
  const [meus, setMeus] = useState<ItemPauta[]>([]);
  const [aprov, setAprov] = useState<{ job_id: string; prazo_em: string }[]>([]);
  const [mencoes, setMencoes] = useState<Mencao[]>([]);
  const [acoes, setAcoes] = useState<Acao[]>([]);
  const [notas, setNotas] = useState<Nota[]>([]);
  const [novaNota, setNovaNota] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    if (!empresa) return;
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id ?? null;
    setUserId(uid);
    if (!uid) { setCarregando(false); return; }
    const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [eq, ls, me, co, ts, lo, an] = await Promise.all([
      // mesma lista de pessoas da Pauta (Bloco 1): usuários ativos da empresa — agency_equipe não é legível pelo usuário
      supabase.rpc("fn_usuarios_da_empresa", { p_company_id: empresa }),
      supabase.rpc("fn_pauta_listar", { p_company_id: empresa, p_filtros: { atalho: "meus" }, p_situacao: null, p_agrupar: "prazo", p_pagina: 1, p_por_pagina: 200 }),
      supabase.from("agency_job_comentarios").select("id, job_id, texto, criado_em, autor_id").eq("company_id", empresa).contains("mencoes", [uid]).is("excluido_em", null).gte("criado_em", desde).order("criado_em", { ascending: false }).limit(10),
      supabase.from("agency_job_comentarios").select("criado_em, texto, job_id").eq("company_id", empresa).eq("autor_id", uid).is("excluido_em", null).order("criado_em", { ascending: false }).limit(15),
      supabase.from("agency_timesheet").select("inicio_em, created_at, horas, job_id, fim_em").eq("company_id", empresa).eq("user_id", uid).order("created_at", { ascending: false }).limit(15),
      supabase.from("agency_pauta_lote").select("criado_em, acao, job_ids, desfeito_em").eq("company_id", empresa).eq("user_id", uid).order("criado_em", { ascending: false }).limit(10),
      supabase.from("agency_anotacoes").select("id, texto, fixada, job_id, atualizado_em").eq("company_id", empresa).is("excluido_em", null).order("fixada", { ascending: false }).order("atualizado_em", { ascending: false }).limit(30),
    ]);
    if (ls.error) { setErro(ls.error.message); setCarregando(false); return; }
    const pessoas = ((eq.data ?? []) as { id: string; full_name: string | null; email: string | null; is_active: boolean }[])
      .filter((u) => u.is_active).map((u) => ({ id: u.id, nome: u.full_name || u.email || "usuário" }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    setEquipe(pessoas);
    setMeuNome(pessoas.find((p) => p.id === uid)?.nome?.split(" ")[0] ?? "");
    const itens = ((ls.data as { itens: ItemPauta[] } | null)?.itens ?? []).filter((i) => !["concluida", "publicado"].includes(i.status));
    setMeus(itens);
    const emAprov = itens.filter((i) => i.status === "em_aprovacao").map((i) => i.id);
    if (emAprov.length) {
      const { data: ap } = await supabase.from("agency_aprovacoes").select("job_id, prazo_em").in("job_id", emAprov).is("decisao", null).order("prazo_em");
      setAprov((ap ?? []) as { job_id: string; prazo_em: string }[]);
    } else setAprov([]);
    setMencoes((me.data ?? []) as Mencao[]);
    setAcoes(juntarAcoes((co.data ?? []) as { criado_em: string; texto: string; job_id: string }[],
      (ts.data ?? []) as { inicio_em: string | null; created_at: string; horas: number; job_id: string | null; fim_em: string | null }[],
      (lo.data ?? []) as { criado_em: string; acao: string; job_ids: string[] | null; desfeito_em: string | null }[]));
    setNotas((an.data ?? []) as Nota[]);
    setCarregando(false);
  }, [empresa]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega o Meu Dia quando a empresa muda
  useEffect(() => { void carregar(); }, [carregar]);

  const porId = useMemo(() => new Map(meus.map((m) => [m.id, m])), [meus]);
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const atrasados = meus.filter((m) => m.atrasado);
  const deHoje = meus.filter((m) => !m.atrasado && m.data_prazo?.slice(0, 10) === hoje);
  const proximos = meus.filter((m) => !m.atrasado && (m.data_prazo?.slice(0, 10) ?? "9999") > hoje).slice(0, 8);
  const jobsCrono: JobCurto[] = meus.map((m) => ({ id: m.id, codigo: m.codigo, titulo: m.titulo }));
  const codigoDe = (id: string | null | undefined) => (id ? porId.get(id)?.codigo ?? "" : "");

  async function salvarNota() {
    if (!empresa || !userId || !novaNota.trim()) return;
    const { error } = await supabase.from("agency_anotacoes").insert({ company_id: empresa, user_id: userId, texto: novaNota.trim() });
    if (error) { setErro(error.message); return; }
    setNovaNota(""); void carregar();
  }
  async function mexerNota(n: Nota, campos: Partial<{ fixada: boolean; excluido_em: string }>) {
    const { error } = await supabase.from("agency_anotacoes").update({ ...campos, atualizado_em: new Date().toISOString() }).eq("id", n.id);
    if (error) { setErro(error.message); return; }
    void carregar();
  }

  if (!empresa) return <div className="p-6 text-[13px] text-[#3D2314]/70">Escolha uma empresa no seletor para ver o seu dia.</div>;

  const Linha = ({ it }: { it: ItemPauta }) => (
    <li className="flex items-center gap-2 py-1.5 text-[13px]" data-testid={`dia-job-${it.numero}`}>
      <Link href={`/dashboard/pm/pauta?job=${it.id}`} className="shrink-0 rounded-md bg-[#3D2314]/8 px-1.5 py-0.5 text-[12px] font-semibold hover:bg-[#C8941A]/20">{it.codigo}</Link>
      <span className="min-w-0 flex-1 truncate">{it.titulo}<span className="block truncate text-[11px] text-[#3D2314]/55">{it.cliente ?? ""}{it.atrasado ? ` · atrasado ${textoAtraso(it.dias_atraso)}` : ""}</span></span>
      {userId && <BotaoPlay empresa={empresa} userId={userId} jobId={it.id} rotulo={it.codigo} />}
    </li>
  );

  return (
    <div className="min-h-screen bg-[#FAF7F2] p-4 text-[#3D2314] md:p-6" data-testid="meu-dia-page">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#C8941A]"><Sun size={13} /> Meu dia</div>
          <h1 className="text-[26px] font-medium leading-tight">{saudacao()}{meuNome ? `, ${meuNome}` : ""}.</h1>
          <p className="text-[13px] text-[#3D2314]/60">{new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })} · {atrasados.length} atrasado(s) · {deHoje.length} para hoje · {mencoes.length} menção(ões)</p>
        </div>
        <Link href="/dashboard/pm/pauta" className="inline-flex items-center gap-1.5 rounded-lg border border-[#3D2314]/15 bg-white px-3 py-2 text-[12.5px]"><ListChecks size={14} /> Abrir a Pauta</Link>
      </header>
      {erro && <div className="mb-3 rounded-lg bg-[#F7E1E1] px-3 py-2 text-[12.5px] text-[#791F1F]" onClick={() => setErro(null)}>{erro}</div>}
      {carregando && <div className="text-[12.5px] text-[#3D2314]/55">carregando…</div>}

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {userId && <Cronometro empresa={empresa} userId={userId} jobs={jobsCrono} onMudou={() => void carregar()} />}

          <section className={cartao} data-testid="dia-para-hoje">
            <div className={titulo}><CalendarClock size={14} /> O que é meu</div>
            {!!atrasados.length && <>
              <div className="mt-1 text-[12px] font-semibold text-[#791F1F]">Atrasados · {atrasados.length}</div>
              <ul className="divide-y divide-[#3D2314]/6" data-testid="dia-atrasados">{atrasados.map((it) => <Linha key={it.id} it={it} />)}</ul>
            </>}
            <div className="mt-2 text-[12px] font-semibold text-[#6B4A0E]">Hoje · {deHoje.length}</div>
            <ul className="divide-y divide-[#3D2314]/6" data-testid="dia-hoje">{deHoje.map((it) => <Linha key={it.id} it={it} />)}</ul>
            {!deHoje.length && <div className="text-[12.5px] text-[#3D2314]/50">Nada vencendo hoje.</div>}
            <div className="mt-2 text-[12px] font-semibold text-[#3D2314]/70">Próximos dias</div>
            <ul className="divide-y divide-[#3D2314]/6">{proximos.map((it) => <Linha key={it.id} it={it} />)}</ul>
          </section>

          <section className={cartao} data-testid="dia-aprovacoes">
            <div className={titulo}><AlertTriangle size={14} /> Aprovações dos meus jobs</div>
            {!aprov.length && <div className="text-[12.5px] text-[#3D2314]/50">Nenhuma aprovação aberta.</div>}
            <ul className="space-y-1">
              {aprov.map((a) => { const p = prazoAprovacao(a.prazo_em); const j = porId.get(a.job_id); return (
                <li key={a.job_id} className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] ${p.nivel === "vencida" ? "bg-[#F7E1E1] text-[#791F1F]" : p.nivel === "hoje" ? "bg-[#FAEEDA]" : "bg-[#FAF7F2]"}`} data-nivel={p.nivel}>
                  <span className="min-w-0 truncate"><b>{j?.codigo}</b> · {j?.titulo}</span><span className="shrink-0">{p.texto}</span>
                </li>); })}
            </ul>
          </section>

          <section className={cartao} data-testid="dia-acoes">
            <div className={titulo}><History size={14} /> Minhas últimas ações</div>
            {!acoes.length && <div className="text-[12.5px] text-[#3D2314]/50">Nada ainda hoje.</div>}
            <ol className="space-y-1.5">
              {acoes.map((a, i) => (
                <li key={i} className="flex gap-2 text-[12.5px]" data-testid="dia-acao">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.tipo === "horas" ? "bg-[#2F5A1F]" : a.tipo === "acao" ? "bg-[#C8941A]" : a.tipo === "massa" ? "bg-[#791F1F]" : "bg-[#3D2314]/40"}`} />
                  <span className="min-w-0">{codigoDe(a.job_id) && <b className="mr-1">{codigoDe(a.job_id)}</b>}{a.texto}<span className="block text-[11px] text-[#3D2314]/50">{quando(a.quando)}</span></span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="space-y-3">
          <section className={cartao} data-testid="dia-mencoes">
            <div className={titulo}><AtSign size={14} /> Menções para mim</div>
            {!mencoes.length && <div className="text-[12.5px] text-[#3D2314]/50">Ninguém te chamou nos últimos 7 dias.</div>}
            <ul className="space-y-2">
              {mencoes.map((m) => (
                <li key={m.id} className="rounded-lg bg-[#FAF7F2] px-2.5 py-1.5 text-[12.5px]" data-testid="dia-mencao">
                  <div className="text-[11px] text-[#3D2314]/55"><b>{equipe.find((p) => p.id === m.autor_id)?.nome ?? "Equipe"}</b> · {quando(m.criado_em)}{codigoDe(m.job_id) ? ` · ${codigoDe(m.job_id)}` : ""}</div>
                  <div>{partesComMencao(m.texto, equipe).map((p, i) => p.mencao ? <span key={i} className="rounded bg-[#C8941A]/20 px-0.5 font-medium">{p.texto}</span> : <span key={i}>{p.texto}</span>)}</div>
                </li>
              ))}
            </ul>
          </section>

          <section className={cartao} data-testid="dia-anotacoes">
            <div className={titulo}><StickyNote size={14} /> Minhas anotações</div>
            <label className="block">
              <span className="mb-1 flex items-center text-[11.5px] font-medium text-[#3D2314]/70">Nova anotação (só você vê)<AjudaCampo chave="pm.dia.anotacao.texto" /></span>
              <textarea className="min-h-[64px] w-full rounded-lg border border-[#3D2314]/15 px-2.5 py-2 text-[13px] focus:border-[#C8941A] focus:outline-none" value={novaNota} onChange={(e) => setNovaNota(e.target.value)} placeholder="Ex.: ligar para a Clínica Sorriso às 15h sobre o banner" data-testid="dia-nota-texto" />
            </label>
            <button className="mt-1 rounded-lg bg-[#3D2314] px-3 py-1.5 text-[12.5px] text-white disabled:opacity-40" disabled={!novaNota.trim()} onClick={() => void salvarNota()} data-testid="dia-nota-salvar">Guardar</button>
            <ul className="mt-2 space-y-1.5">
              {notas.map((n) => (
                <li key={n.id} className={`flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] ${n.fixada ? "bg-[#FAEEDA]" : "bg-[#FAF7F2]"}`} data-testid="dia-nota">
                  <span className="min-w-0 flex-1 whitespace-pre-wrap">{n.texto}<span className="block text-[11px] text-[#3D2314]/50">{quando(n.atualizado_em)}</span></span>
                  <button onClick={() => void mexerNota(n, { fixada: !n.fixada })} aria-label={n.fixada ? "desafixar" : "fixar"} title={n.fixada ? "desafixar" : "fixar no topo"}>{n.fixada ? <PinOff size={14} /> : <Pin size={14} />}</button>
                  <button onClick={() => void mexerNota(n, { excluido_em: new Date().toISOString() })} aria-label="arquivar" title="arquivar"><Archive size={14} /></button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
