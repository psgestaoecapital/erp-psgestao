"use client";
// P&M · Social mínimo — Calendário de publicações (CEO 03/10). Semana ou mês, no fuso de São Paulo, com cliente, redes,
// situação e o job de cada post. Celular primeiro: a semana vira lista por dia; o mês vira grade compacta com pontos e
// a lista do dia tocado. Tocar num post abre o planejamento dele com o post aberto. "?" em todo campo.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Briefcase } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { SocialNav } from "@/components/pm/social/SocialNav";
import {
  DIAS_SEMANA, STATUS_POST, dataBR, diaSP, diasDaSemana, gradeDoMes, hojeSP, inicioDoMes, intervaloISO, partesSP, rotuloMes,
  siglaRede, somarDias, somarMeses, statusPost, type StatusPost,
} from "@/lib/pm/social";

type PostCal = { id: string; planejamento_id: string; cliente_id: string; assunto: string; publicar_em: string; redes: string[]; servico_id: string | null; status: StatusPost; job_id: string | null };
type Visao = "semana" | "mes";

const inp = "w-full rounded-xl border border-[#3D2314]/15 bg-white px-3 py-2 text-[13.5px] text-[#3D2314] focus:border-[#C8941A] focus:outline-none";
const rot = "mb-1 flex items-center text-[11.5px] font-semibold text-[#3D2314]/75";
const BORDA: Record<StatusPost, string> = { rascunho: "border-l-[#3D2314]/30", em_aprovacao: "border-l-[#C8941A]", aprovado: "border-l-[#2F5A1F]", publicado: "border-l-[#3D2314]" };
const PONTO: Record<StatusPost, string> = { rascunho: "bg-[#3D2314]/30", em_aprovacao: "bg-[#C8941A]", aprovado: "bg-[#2F5A1F]", publicado: "bg-[#3D2314]" };

export default function CalendarioPage() {
  const { selInfo, companyIds } = useCompanyIds();
  const empresa = selInfo.tipo === "empresa" && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null);
  const hoje = hojeSP();

  const [visao, setVisao] = useState<Visao>("semana");
  const [ref, setRef] = useState(hoje);
  const [diaSel, setDiaSel] = useState(hoje);
  const [cliente, setCliente] = useState("");
  const [status, setStatus] = useState<"" | StatusPost>("");
  const [posts, setPosts] = useState<PostCal[]>([]);
  const [clientes, setClientes] = useState<{ id: string; nome: string }[]>([]);
  const [redes, setRedes] = useState<Record<string, string>>({});
  const [pecas, setPecas] = useState<Record<string, string>>({});
  const [jobs, setJobs] = useState<Record<string, { numero: string | null; data_prazo: string | null }>>({});
  const [loading, setLoading] = useState(true);

  // a visão escolhida (semana/mês) fica guardada neste navegador
  useEffect(() => { try { const v = window.localStorage.getItem("pm_cal_visao"); if (v === "mes" || v === "semana") setVisao(v); } catch { /* noop */ } }, []);
  useEffect(() => { try { window.localStorage.setItem("pm_cal_visao", visao); } catch { /* noop */ } }, [visao]);

  const dias = useMemo(() => (visao === "semana" ? diasDaSemana(ref) : gradeDoMes(ref).flat()), [visao, ref]);
  const semanas = useMemo(() => gradeDoMes(ref), [ref]);

  useEffect(() => {
    if (!empresa) return;
    void supabase.rpc("fn_agency_config_listar", { p_company_id: empresa, p_lista: "rede_social" }).then(({ data }) =>
      setRedes(Object.fromEntries(((data ?? []) as { valor: string; rotulo: string }[]).map((r) => [r.valor, r.rotulo]))));
    void supabase.from("agency_servico").select("id, nome").eq("company_id", empresa).then(({ data }) =>
      setPecas(Object.fromEntries(((data ?? []) as { id: string; nome: string }[]).map((s) => [s.id, s.nome]))));
    void supabase.from("agency_planejamentos").select("cliente_id").eq("company_id", empresa).is("excluido_em", null).then(async ({ data }) => {
      const ids = [...new Set(((data ?? []) as { cliente_id: string }[]).map((p) => p.cliente_id))];
      if (!ids.length) { setClientes([]); return; }
      const { data: cl } = await supabase.from("erp_clientes").select("id, nome_fantasia, razao_social").in("id", ids);
      setClientes(((cl ?? []) as { id: string; nome_fantasia: string | null; razao_social: string | null }[])
        .map((c) => ({ id: c.id, nome: c.nome_fantasia || c.razao_social || "Cliente" })).sort((a, b) => a.nome.localeCompare(b.nome)));
    });
  }, [empresa]);

  const carregar = useCallback(async () => {
    if (!empresa || !dias.length) { setLoading(false); return; }
    setLoading(true);
    const { de, ate } = intervaloISO(dias[0], dias[dias.length - 1]);
    let q = supabase.from("agency_posts").select("id, planejamento_id, cliente_id, assunto, publicar_em, redes, servico_id, status, job_id")
      .eq("company_id", empresa).is("excluido_em", null).gte("publicar_em", de).lt("publicar_em", ate).order("publicar_em");
    if (cliente) q = q.eq("cliente_id", cliente);
    if (status) q = q.eq("status", status);
    const { data } = await q;
    const lista = (data ?? []) as PostCal[];
    setPosts(lista);
    const jobIds = lista.map((p) => p.job_id).filter(Boolean) as string[];
    if (jobIds.length) {
      const { data: js } = await supabase.from("agency_jobs").select("id, numero, data_prazo").in("id", jobIds);
      setJobs(Object.fromEntries(((js ?? []) as { id: string; numero: string | null; data_prazo: string | null }[]).map((j) => [j.id, j])));
    } else setJobs({});
    setLoading(false);
  }, [empresa, dias, cliente, status]);
  useEffect(() => { void carregar(); }, [carregar]);

  const porDia = useMemo(() => {
    const m: Record<string, PostCal[]> = {};
    for (const p of posts) (m[diaSP(p.publicar_em)] ??= []).push(p);
    return m;
  }, [posts]);
  const nomeCli = (id: string) => clientes.find((c) => c.id === id)?.nome ?? "";

  const andar = (n: number) => { const r = visao === "semana" ? somarDias(ref, 7 * n) : somarMeses(ref, n); setRef(r); setDiaSel(visao === "semana" ? r : inicioDoMes(r)); };
  const titulo = visao === "semana"
    ? `${dataBR(dias[0]).slice(0, 5)} a ${dataBR(dias[6]).slice(0, 5)} · ${rotuloMes(dias[3])}`
    : rotuloMes(ref);

  const chip = (p: PostCal, compacto?: boolean) => {
    const st = statusPost(p.status);
    const job = p.job_id ? jobs[p.job_id] : null;
    return (
      <Link key={p.id} href={`/dashboard/pm/planejamento?p=${p.planejamento_id}&post=${p.id}`} data-testid="calendario-post" data-status={p.status}
        className={`block rounded-lg border border-l-[3px] border-[#3D2314]/10 bg-white px-2 py-1.5 text-left shadow-[0_1px_0_rgba(61,35,20,0.04)] transition hover:border-[#C8941A]/40 hover:shadow ${BORDA[p.status]}`}>
        <div className="flex items-center justify-between gap-1 text-[10.5px] text-[#3D2314]/55">
          <span className="font-semibold text-[#3D2314]/80">{partesSP(p.publicar_em).hora}</span>
          <span className="truncate">{nomeCli(p.cliente_id)}</span>
        </div>
        <div className={`${compacto ? "line-clamp-1" : "line-clamp-2"} text-[12.5px] font-medium leading-snug text-[#3D2314]`}>{p.assunto}</div>
        {!compacto && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {p.redes.map((r) => <span key={r} title={redes[r] ?? r} className="rounded bg-[#3D2314]/6 px-1 text-[9.5px] font-semibold tracking-wide text-[#3D2314]/70">{siglaRede(r)}</span>)}
            <span className={`rounded-full px-1.5 text-[9.5px] font-semibold ${st.cls}`}>{st.l}</span>
            {p.servico_id && <span className="truncate text-[10px] text-[#3D2314]/50">{pecas[p.servico_id]}</span>}
          </div>
        )}
        {!compacto && job && <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-[#2F5A1F]"><Briefcase size={10} /> job {job.numero} · prazo {dataBR(job.data_prazo).slice(0, 5)}</div>}
      </Link>
    );
  };

  if (!empresa) return <div className="min-h-screen bg-[#FAF7F2] p-8 text-[13px] text-[#3D2314]/70">Selecione uma empresa no topo.</div>;

  return (
    <div className="min-h-screen bg-[#FAF7F2] px-4 pb-20 pt-4 text-[#3D2314] md:px-6 md:pt-6" data-testid="calendario-page">
      <div className="mx-auto max-w-7xl">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#C8941A]"><CalendarDays size={13} /> P&amp;M · Social</div>
            <h1 className="text-[26px] font-medium leading-tight">Calendário</h1>
            <p className="text-[13px] text-[#3D2314]/60">Tudo o que vai ao ar, de todos os clientes — e o job de cada post.</p>
          </div>
          <SocialNav ativo="calendario" />
        </header>

        <div className="mb-3 grid grid-cols-2 gap-3 rounded-2xl border border-[#3D2314]/10 bg-white p-3 md:grid-cols-4">
          <div>
            <span className={rot}>Visão<AjudaCampo chave="pm.calendario.visao" /></span>
            <div className="inline-flex w-full rounded-xl border border-[#3D2314]/15 bg-[#FAF7F2] p-0.5" role="radiogroup">
              {(["semana", "mes"] as Visao[]).map((v) => (
                <button key={v} role="radio" aria-checked={visao === v} onClick={() => { setVisao(v); setDiaSel(ref); }} data-testid={`calendario-visao-${v}`}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-[13px] font-medium ${visao === v ? "bg-[#3D2314] text-[#F5E6C8]" : "text-[#3D2314]/70"}`}>{v === "semana" ? "Semana" : "Mês"}</button>
              ))}
            </div>
          </div>
          <label className="block"><span className={rot}>Ir para<AjudaCampo chave="pm.calendario.data" /></span>
            <input type="date" className={inp} value={ref} onChange={(e) => { if (e.target.value) { setRef(e.target.value); setDiaSel(e.target.value); } }} data-testid="calendario-data" /></label>
          <label className="block"><span className={rot}>Cliente<AjudaCampo chave="pm.calendario.cliente" /></span>
            <select className={inp} value={cliente} onChange={(e) => setCliente(e.target.value)} data-testid="calendario-cliente">
              <option value="">Todos</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select></label>
          <label className="block"><span className={rot}>Situação do post<AjudaCampo chave="pm.calendario.status" /></span>
            <select className={inp} value={status} onChange={(e) => setStatus(e.target.value as "" | StatusPost)} data-testid="calendario-status">
              <option value="">Todas</option>
              {STATUS_POST.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select></label>
        </div>

        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button onClick={() => andar(-1)} className="rounded-full border border-[#3D2314]/15 bg-white p-2 hover:bg-[#3D2314]/5" aria-label="anterior" data-testid="calendario-anterior"><ChevronLeft size={16} /></button>
            <button onClick={() => andar(1)} className="rounded-full border border-[#3D2314]/15 bg-white p-2 hover:bg-[#3D2314]/5" aria-label="próximo" data-testid="calendario-proximo"><ChevronRight size={16} /></button>
            <button onClick={() => { setRef(hoje); setDiaSel(hoje); }} className="ml-1 rounded-full border border-[#3D2314]/15 bg-white px-3 py-1.5 text-[12.5px] font-medium">Hoje</button>
          </div>
          <div className="text-right text-[14px] font-medium capitalize" data-testid="calendario-titulo">{titulo}</div>
        </div>

        <div className="mb-3 flex flex-wrap gap-3 text-[11px] text-[#3D2314]/60">
          {STATUS_POST.map((s) => <span key={s.v} className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${PONTO[s.v]}`} /> {s.l}</span>)}
          <span className="ml-auto">{loading ? "carregando…" : `${posts.length} post(s)`}</span>
        </div>

        {visao === "semana" ? (
          <>
            {/* computador: 7 colunas */}
            <div className="hidden grid-cols-7 gap-2 md:grid" data-testid="calendario-semana">
              {dias.map((d, i) => (
                <div key={d} className={`min-h-[220px] rounded-2xl border p-2 ${d === hoje ? "border-[#C8941A] bg-[#FFF8E7]" : "border-[#3D2314]/10 bg-white/60"}`}>
                  <div className="mb-2 flex items-baseline justify-between px-0.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[#3D2314]/55">{DIAS_SEMANA[i]}</span>
                    <span className={`text-[15px] font-medium ${d === hoje ? "text-[#C8941A]" : ""}`}>{d.slice(8, 10)}</span>
                  </div>
                  <div className="space-y-1.5">{(porDia[d] ?? []).map((p) => chip(p))}</div>
                </div>
              ))}
            </div>
            {/* celular: lista por dia */}
            <div className="space-y-2 md:hidden" data-testid="calendario-semana-lista">
              {dias.map((d, i) => (
                <div key={d} className={`rounded-2xl border p-3 ${d === hoje ? "border-[#C8941A] bg-[#FFF8E7]" : "border-[#3D2314]/10 bg-white"}`}>
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <span className={`text-[18px] font-medium ${d === hoje ? "text-[#C8941A]" : ""}`}>{d.slice(8, 10)}</span>
                    <span className="text-[12px] font-semibold uppercase tracking-wide text-[#3D2314]/55">{DIAS_SEMANA[i]}{d === hoje ? " · hoje" : ""}</span>
                  </div>
                  {(porDia[d] ?? []).length ? <div className="space-y-1.5">{porDia[d].map((p) => chip(p))}</div>
                    : <div className="text-[12px] text-[#3D2314]/40">Nada programado.</div>}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-2xl border border-[#3D2314]/10 bg-white md:block" data-testid="calendario-mes">
              <div className="grid grid-cols-7 border-b border-[#3D2314]/10 bg-[#FAF7F2]">
                {DIAS_SEMANA.map((d) => <div key={d} className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#3D2314]/55">{d}</div>)}
              </div>
              {semanas.map((s) => (
                <div key={s[0]} className="grid grid-cols-7 border-b border-[#3D2314]/8 last:border-b-0">
                  {s.map((d) => {
                    const lista = porDia[d] ?? [];
                    const fora = d.slice(0, 7) !== ref.slice(0, 7);
                    return (
                      <div key={d} className={`min-h-[118px] border-r border-[#3D2314]/8 p-1.5 last:border-r-0 ${fora ? "bg-[#FAF7F2]/70 text-[#3D2314]/35" : ""} ${d === hoje ? "bg-[#FFF8E7]" : ""}`}>
                        <div className={`mb-1 text-right text-[12px] font-medium ${d === hoje ? "text-[#C8941A]" : ""}`}>{d.slice(8, 10)}</div>
                        <div className="space-y-1">
                          {lista.slice(0, 3).map((p) => chip(p, true))}
                          {lista.length > 3 && <button onClick={() => { setVisao("semana"); setRef(d); }} className="w-full text-left text-[11px] font-medium text-[#C8941A]">+{lista.length - 3} na semana</button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {/* celular: grade compacta com pontos + lista do dia tocado */}
            <div className="md:hidden" data-testid="calendario-mes-celular">
              <div className="rounded-2xl border border-[#3D2314]/10 bg-white p-2">
                <div className="grid grid-cols-7 text-center text-[10.5px] font-semibold uppercase text-[#3D2314]/50">{DIAS_SEMANA.map((d) => <div key={d} className="py-1">{d.slice(0, 1)}</div>)}</div>
                {semanas.map((s) => (
                  <div key={s[0]} className="grid grid-cols-7">
                    {s.map((d) => {
                      const lista = porDia[d] ?? [];
                      const fora = d.slice(0, 7) !== ref.slice(0, 7);
                      return (
                        <button key={d} onClick={() => setDiaSel(d)} className={`m-0.5 flex h-11 flex-col items-center justify-center rounded-xl text-[13px] ${diaSel === d ? "bg-[#3D2314] text-[#F5E6C8]" : d === hoje ? "bg-[#FFF8E7] text-[#C8941A]" : fora ? "text-[#3D2314]/30" : ""}`} data-testid="calendario-dia">
                          {Number(d.slice(8, 10))}
                          <span className="mt-0.5 flex h-1.5 gap-0.5">{lista.slice(0, 3).map((p) => <span key={p.id} className={`h-1.5 w-1.5 rounded-full ${PONTO[p.status]}`} />)}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-1.5">
                <div className="text-[12.5px] font-semibold text-[#3D2314]/70">{DIAS_SEMANA[new Date(`${diaSel}T12:00:00Z`).getUTCDay()]} {dataBR(diaSel)}</div>
                {(porDia[diaSel] ?? []).length ? porDia[diaSel].map((p) => chip(p)) : <div className="rounded-xl border border-dashed border-[#3D2314]/15 bg-white p-4 text-center text-[12.5px] text-[#3D2314]/50">Nada programado neste dia.</div>}
              </div>
            </div>
          </>
        )}

        {!loading && !posts.length && (
          <div className="mt-4 rounded-2xl border border-dashed border-[#3D2314]/20 bg-white p-6 text-center text-[13px] text-[#3D2314]/60" data-testid="calendario-vazio">
            Nenhum post neste período. <Link href="/dashboard/pm/planejamento" className="font-medium text-[#C8941A] underline">Abrir o planejamento</Link>
          </div>
        )}
      </div>
    </div>
  );
}
