"use client";
// P&M · Social mínimo — Planejamento (CEO 03/10, spec aprovada com as correções do Eng. Chefe).
// Lista dos planejamentos do mês (cliente do cadastro único erp_clientes, campanha, situação, posts e jobs) e o editor:
// dados do planejamento + posts com briefing estruturado. Post aprovado (com peça e publicação) vira job SOZINHO no banco
// (gatilho da migration 20261003120000), com prazo = publicação − antecedência da peça; mudar a publicação move o prazo.
// Mais de um planejamento por cliente e mês é permitido, um por campanha (o banco recusa a repetida).
// Celular primeiro: cartões em uma coluna, editor em tela cheia. "?" em todo campo. Lixeira em vez de apagar (RD-30).

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarRange, Plus, ChevronRight, X, Trash2, CheckCheck, Send, CheckCircle2, Megaphone, Undo2, Pencil, Briefcase } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { ClienteErpBusca } from "@/components/pm/social/ClienteErpBusca";
import { SocialNav } from "@/components/pm/social/SocialNav";
import { PostForm, postVazio, type Opcao, type Peca, type Post, type PostRascunho, type Usuario } from "@/components/pm/social/PostForm";
import {
  STATUS_PLANEJAMENTO, dataBR, hojeSP, inicioDoMes, mensagemErro, quandoBR, rotuloMes, siglaRede, statusPlanejamento, statusPost,
  type StatusPlanejamento,
} from "@/lib/pm/social";

type Planejamento = {
  id: string; company_id: string; cliente_id: string; mes: string; campanha: string | null; titulo: string;
  status: StatusPlanejamento; responsavel_id: string | null; observacoes: string | null; created_at: string;
};
type Job = { id: string; numero: string | null; data_prazo: string | null; status: string | null };
type Contagem = { posts: number; aprovados: number; emAprovacao: number };
type FormPlan = { id?: string; cliente_id: string; cliente_nome: string; mes: string; campanha: string; titulo: string; status: StatusPlanejamento; responsavel_id: string; observacoes: string };

const inp = "w-full rounded-xl border border-[#3D2314]/15 bg-white px-3 py-2.5 text-[14px] text-[#3D2314] focus:border-[#C8941A] focus:outline-none";
const rot = "mb-1 flex items-center text-[12px] font-semibold text-[#3D2314]";
const btnSec = "inline-flex items-center gap-1.5 rounded-xl border border-[#3D2314]/15 bg-white px-3 py-2 text-[12.5px] font-medium text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-40";

function Campo({ texto, ajuda, children }: { texto: string; ajuda: string; children: React.ReactNode }) {
  return (
    <label className="block" data-ajuda={ajuda}>
      <span className={rot}>{texto}<AjudaCampo chave={ajuda} /></span>
      {children}
    </label>
  );
}

export default function PlanejamentoPage() {
  const { selInfo, companyIds } = useCompanyIds();
  const empresa = selInfo.tipo === "empresa" && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null);

  const [mes, setMes] = useState(() => inicioDoMes(hojeSP()).slice(0, 7));
  const [filtroStatus, setFiltroStatus] = useState<"" | StatusPlanejamento>("");
  const [planos, setPlanos] = useState<Planejamento[]>([]);
  const [contagem, setContagem] = useState<Record<string, Contagem>>({});
  const [nomesCli, setNomesCli] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [redes, setRedes] = useState<Opcao[]>([]);
  const [pecas, setPecas] = useState<Peca[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);

  const [aberto, setAberto] = useState<Planejamento | null>(null);
  const [form, setForm] = useState<FormPlan | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [postEdit, setPostEdit] = useState<PostRascunho | null>(null);
  const [postErro, setPostErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [erroPlan, setErroPlan] = useState<string | null>(null);
  const [toast, setToast] = useState<{ texto: string; jobId?: string } | null>(null);

  // listas da empresa: redes (semeadas no 1º uso), peças do catálogo, usuários ativos
  useEffect(() => {
    if (!empresa) return;
    void supabase.rpc("fn_agency_config_listar", { p_company_id: empresa, p_lista: "rede_social" }).then(({ data }) => setRedes(((data ?? []) as Opcao[]).map((r) => ({ valor: r.valor, rotulo: r.rotulo }))));
    void supabase.from("agency_servico").select("id, nome, antecedencia_dias").eq("company_id", empresa).eq("ativo", true).order("ordem").order("nome")
      .then(({ data }) => setPecas((data ?? []) as Peca[]));
    void supabase.rpc("fn_usuarios_da_empresa", { p_company_id: empresa }).then(({ data }) =>
      setUsuarios(((data ?? []) as { id: string; full_name: string | null; email: string | null; is_active: boolean }[])
        .filter((u) => u.is_active).map((u) => ({ id: u.id, nome: u.full_name || u.email || "Usuário" })).sort((a, b) => a.nome.localeCompare(b.nome))));
  }, [empresa]);

  const carregar = useCallback(async () => {
    if (!empresa) { setPlanos([]); setLoading(false); return; }
    setLoading(true);
    let q = supabase.from("agency_planejamentos").select("*").eq("company_id", empresa).is("excluido_em", null).eq("mes", `${mes}-01`).order("created_at");
    if (filtroStatus) q = q.eq("status", filtroStatus);
    const { data } = await q;
    const lista = (data ?? []) as Planejamento[];
    setPlanos(lista);
    const ids = lista.map((p) => p.id);
    const cli = [...new Set(lista.map((p) => p.cliente_id))];
    const [{ data: ps }, { data: cl }] = await Promise.all([
      ids.length ? supabase.from("agency_posts").select("planejamento_id, status, job_id").in("planejamento_id", ids).is("excluido_em", null) : Promise.resolve({ data: [] }),
      cli.length ? supabase.from("erp_clientes").select("id, nome_fantasia, razao_social").in("id", cli) : Promise.resolve({ data: [] }),
    ]);
    const cont: Record<string, Contagem> = {};
    for (const p of (ps ?? []) as { planejamento_id: string; status: string; job_id: string | null }[]) {
      const c = (cont[p.planejamento_id] ??= { posts: 0, aprovados: 0, emAprovacao: 0 });
      c.posts++; if (p.job_id) c.aprovados++; if (p.status === "em_aprovacao") c.emAprovacao++;
    }
    setContagem(cont);
    setNomesCli((prev) => ({ ...prev, ...Object.fromEntries(((cl ?? []) as { id: string; nome_fantasia: string | null; razao_social: string | null }[]).map((c) => [c.id, c.nome_fantasia || c.razao_social || "Cliente"])) }));
    setLoading(false);
  }, [empresa, mes, filtroStatus]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 7000); return () => clearTimeout(t); }, [toast]);

  const carregarPosts = useCallback(async (planId: string) => {
    const { data } = await supabase.from("agency_posts").select("*").eq("planejamento_id", planId).is("excluido_em", null).order("publicar_em", { nullsFirst: false }).order("ordem");
    const lista = (data ?? []) as Post[];
    setPosts(lista);
    const jobIds = lista.map((p) => p.job_id).filter(Boolean) as string[];
    if (jobIds.length) {
      const { data: js } = await supabase.from("agency_jobs").select("id, numero, data_prazo, status").in("id", jobIds);
      setJobs(Object.fromEntries(((js ?? []) as Job[]).map((j) => [j.id, j])));
    } else setJobs({});
    return lista;
  }, []);

  const abrir = useCallback(async (p: Planejamento, postId?: string | null) => {
    setAberto(p); setErroPlan(null);
    setForm({ id: p.id, cliente_id: p.cliente_id, cliente_nome: nomesCli[p.cliente_id] ?? "", mes: p.mes.slice(0, 7), campanha: p.campanha ?? "", titulo: p.titulo, status: p.status, responsavel_id: p.responsavel_id ?? "", observacoes: p.observacoes ?? "" });
    try { window.history.replaceState(null, "", `/dashboard/pm/planejamento?p=${p.id}`); } catch { /* noop */ }
    const lista = await carregarPosts(p.id);
    if (!nomesCli[p.cliente_id]) {
      const { data } = await supabase.from("erp_clientes").select("nome_fantasia, razao_social").eq("id", p.cliente_id).maybeSingle();
      const nome = (data as { nome_fantasia: string | null; razao_social: string | null } | null);
      if (nome) setForm((f) => (f && f.id === p.id ? { ...f, cliente_nome: nome.nome_fantasia || nome.razao_social || "Cliente" } : f));
    }
    const alvo = postId ? lista.find((x) => x.id === postId) : null;
    if (alvo) { setPostErro(null); setPostEdit({ ...alvo }); }
  }, [carregarPosts, nomesCli]);

  // link direto: ?p=<planejamento>&post=<post> (vem do calendário)
  useEffect(() => {
    if (!empresa) return;
    let params: URLSearchParams;
    try { params = new URLSearchParams(window.location.search); } catch { return; }
    const pid = params.get("p");
    if (!pid) return;
    void supabase.from("agency_planejamentos").select("*").eq("id", pid).is("excluido_em", null).maybeSingle().then(({ data }) => {
      const p = data as Planejamento | null;
      if (p) { setMes(p.mes.slice(0, 7)); void abrir(p, params.get("post")); }
    });
  }, [empresa]); // eslint-disable-line react-hooks/exhaustive-deps

  function fechar() {
    setAberto(null); setForm(null); setPosts([]); setJobs({}); setPostEdit(null);
    try { window.history.replaceState(null, "", "/dashboard/pm/planejamento"); } catch { /* noop */ }
  }
  function novo() {
    setAberto(null); setPosts([]); setJobs({}); setErroPlan(null);
    setForm({ cliente_id: "", cliente_nome: "", mes, campanha: "", titulo: "", status: "rascunho", responsavel_id: "", observacoes: "" });
  }

  async function salvarPlano() {
    if (!empresa || !form) return;
    if (!form.cliente_id) { setErroPlan("Escolha o cliente."); return; }
    if (!form.titulo.trim()) { setErroPlan("Dê um título ao planejamento."); return; }
    setBusy(true); setErroPlan(null);
    const campos = { cliente_id: form.cliente_id, mes: `${form.mes}-01`, campanha: form.campanha.trim() || null, titulo: form.titulo.trim(), status: form.status, responsavel_id: form.responsavel_id || null, observacoes: form.observacoes.trim() || null };
    const r = form.id
      ? await supabase.from("agency_planejamentos").update(campos).eq("id", form.id).select("*").single()
      : await supabase.from("agency_planejamentos").insert({ ...campos, company_id: empresa }).select("*").single();
    setBusy(false);
    if (r.error) { setErroPlan(mensagemErro(r.error)); return; }
    const p = r.data as Planejamento;
    setNomesCli((n) => ({ ...n, [p.cliente_id]: form.cliente_nome }));
    setToast({ texto: form.id ? "Planejamento salvo." : "Planejamento criado — agora inclua os posts." });
    if (p.mes.slice(0, 7) !== mes) setMes(p.mes.slice(0, 7)); else void carregar();
    void abrir(p);
  }

  async function lixeiraPlano() {
    if (!aberto) return;
    if (!confirm(`Mandar "${aberto.titulo}" para a lixeira? Os posts vão junto; os jobs já criados continuam na pauta.`)) return;
    setBusy(true);
    const { error } = await supabase.from("agency_planejamentos").update({ excluido_em: new Date().toISOString() }).eq("id", aberto.id);
    setBusy(false);
    if (error) { setToast({ texto: mensagemErro(error) }); return; }
    fechar(); setToast({ texto: "Planejamento na lixeira." }); void carregar();
  }

  async function salvarPost(p: PostRascunho) {
    if (!empresa || !aberto) return;
    setBusy(true); setPostErro(null);
    const campos = { assunto: p.assunto, publicar_em: p.publicar_em, redes: p.redes, servico_id: p.servico_id, arte: p.arte || null, texto_arte: p.texto_arte || null, legenda: p.legenda || null, hashtags: p.hashtags || null, responsavel_id: p.responsavel_id, status: p.status };
    const r = p.id
      ? await supabase.from("agency_posts").update(campos).eq("id", p.id).select("*").single()
      : await supabase.from("agency_posts").insert({ ...campos, company_id: empresa, planejamento_id: aberto.id, cliente_id: aberto.cliente_id, ordem: posts.length + 1 }).select("*").single();
    setBusy(false);
    if (r.error) { setPostErro(mensagemErro(r.error)); return; }
    const salvo = r.data as Post;
    setPostEdit(null);
    await aposMudarPost(salvo, !p.job_id && !!salvo.job_id);
  }

  async function mudarStatus(post: Post, status: Post["status"]) {
    setBusy(true);
    const { data, error } = await supabase.from("agency_posts").update({ status }).eq("id", post.id).select("*").single();
    setBusy(false);
    if (error) { setToast({ texto: mensagemErro(error) }); return; }
    await aposMudarPost(data as Post, !post.job_id && !!(data as Post).job_id);
  }

  async function lixeiraPost(post: Post) {
    if (!confirm(`Mandar o post "${post.assunto}" para a lixeira?${post.job_id ? " O job dele continua na pauta." : ""}`)) return;
    const { error } = await supabase.from("agency_posts").update({ excluido_em: new Date().toISOString() }).eq("id", post.id);
    if (error) { setToast({ texto: mensagemErro(error) }); return; }
    if (aberto) await carregarPosts(aberto.id);
    void carregar();
  }

  async function aposMudarPost(salvo: Post, virouJob: boolean) {
    if (!aberto) return;
    await carregarPosts(aberto.id);
    void carregar();
    if (virouJob && salvo.job_id) {
      const { data } = await supabase.from("agency_jobs").select("numero, data_prazo").eq("id", salvo.job_id).maybeSingle();
      const j = data as { numero: string | null; data_prazo: string | null } | null;
      setToast({ texto: `Post aprovado — job ${j?.numero ?? ""} criado com prazo ${dataBR(j?.data_prazo)}.`, jobId: salvo.job_id });
    } else setToast({ texto: "Post salvo." });
  }

  // aprova de uma vez os posts prontos (peça + data); os demais ficam como estão
  async function aprovarProntos() {
    if (!aberto) return;
    const prontos = posts.filter((p) => (p.status === "rascunho" || p.status === "em_aprovacao") && p.servico_id && p.publicar_em);
    if (!prontos.length) { setToast({ texto: "Nenhum post pronto: cada post precisa de peça e data de publicação." }); return; }
    if (!confirm(`Aprovar ${prontos.length} post(s)? Cada um vira job com prazo antes da publicação.`)) return;
    setBusy(true);
    const { error } = await supabase.from("agency_posts").update({ status: "aprovado" }).in("id", prontos.map((p) => p.id));
    if (!error && aberto.status !== "aprovado") await supabase.from("agency_planejamentos").update({ status: "aprovado" }).eq("id", aberto.id);
    setBusy(false);
    if (error) { setToast({ texto: mensagemErro(error) }); return; }
    setForm((f) => (f ? { ...f, status: "aprovado" } : f));
    await carregarPosts(aberto.id); void carregar();
    setToast({ texto: `${prontos.length} post(s) aprovados — os jobs estão na pauta.` });
  }

  const kpis = useMemo(() => {
    const vals = Object.values(contagem);
    return { planos: planos.length, posts: vals.reduce((s, c) => s + c.posts, 0), jobs: vals.reduce((s, c) => s + c.aprovados, 0), aprov: vals.reduce((s, c) => s + c.emAprovacao, 0) };
  }, [planos, contagem]);
  const nomeRede = (v: string) => redes.find((r) => r.valor === v)?.rotulo ?? v;
  const nomePeca = (id: string | null) => pecas.find((p) => p.id === id)?.nome ?? "sem peça";

  if (!empresa) return <div className="min-h-screen bg-[#FAF7F2] p-8 text-[13px] text-[#3D2314]/70">Selecione uma empresa no topo.</div>;

  return (
    <div className="min-h-screen bg-[#FAF7F2] px-4 pb-24 pt-4 text-[#3D2314] md:px-6 md:pt-6" data-testid="planejamento-page">
      <div className="mx-auto max-w-6xl">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#C8941A]"><CalendarRange size={13} /> P&amp;M · Social</div>
            <h1 className="text-[26px] font-medium leading-tight">Planejamento</h1>
            <p className="max-w-xl text-[13px] text-[#3D2314]/60">O mês de cada cliente em posts com briefing completo. Post aprovado vira job sozinho, com prazo antes da publicação.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SocialNav ativo="planejamento" />
            <button onClick={novo} className="inline-flex items-center gap-1.5 rounded-xl bg-[#3D2314] px-4 py-2.5 text-[13.5px] font-medium text-white shadow-sm hover:bg-[#3D2314]/90" data-testid="planejamento-novo"><Plus size={15} /> Novo planejamento</button>
          </div>
        </header>

        <div className="mb-4 grid grid-cols-2 gap-3 rounded-2xl border border-[#3D2314]/10 bg-white p-3 sm:flex sm:flex-wrap sm:items-end">
          <Campo texto="Mês" ajuda="pm.planejamento.filtro_mes">
            <input type="month" className={`${inp} sm:w-48`} value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} data-testid="planejamento-filtro-mes" />
          </Campo>
          <Campo texto="Situação" ajuda="pm.planejamento.filtro_status">
            <select className={`${inp} sm:w-48`} value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as "" | StatusPlanejamento)} data-testid="planejamento-filtro-status">
              <option value="">Todas</option>
              {STATUS_PLANEJAMENTO.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
          </Campo>
          <div className="col-span-2 self-center text-[12.5px] capitalize text-[#3D2314]/55 sm:ml-auto">{rotuloMes(`${mes}-01`)}</div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([["Planejamentos", kpis.planos], ["Posts", kpis.posts], ["Em aprovação", kpis.aprov], ["Viraram job", kpis.jobs]] as const).map(([l, v]) => (
            <div key={l} className="rounded-2xl border border-[#3D2314]/10 bg-white px-4 py-3">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[#3D2314]/55">{l}</div>
              <div className="text-[22px] font-medium">{v}</div>
            </div>
          ))}
        </div>

        {loading ? <div className="p-10 text-center text-[13px] text-[#3D2314]/55">Carregando…</div>
          : planos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#3D2314]/20 bg-white p-10 text-center" data-testid="planejamento-vazio">
              <div className="text-[15px] font-medium">Nenhum planejamento em {rotuloMes(`${mes}-01`)}</div>
              <p className="mt-1 text-[13px] text-[#3D2314]/60">Monte o mês do cliente: os posts, as redes e o briefing de cada peça.</p>
              <button onClick={novo} className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[#C8941A] px-4 py-2 text-[13px] font-medium text-white"><Plus size={14} /> Novo planejamento</button>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {planos.map((p) => {
                const c = contagem[p.id] ?? { posts: 0, aprovados: 0, emAprovacao: 0 };
                const st = statusPlanejamento(p.status);
                const pct = c.posts ? Math.round((c.aprovados / c.posts) * 100) : 0;
                return (
                  <button key={p.id} onClick={() => void abrir(p)} className="group rounded-2xl border border-[#3D2314]/10 bg-white p-4 text-left shadow-[0_1px_0_rgba(61,35,20,0.04)] transition hover:border-[#C8941A]/50 hover:shadow-md" data-testid="planejamento-card">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[11.5px] font-semibold uppercase tracking-wide text-[#C8941A]">{nomesCli[p.cliente_id] ?? "Cliente"}</div>
                        <div className="truncate text-[15.5px] font-medium">{p.titulo}</div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.l}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-[#3D2314]/60">
                      {p.campanha && <span className="inline-flex items-center gap-1 rounded-full bg-[#FFF3D6] px-2 py-0.5 text-[#6B4A0E]"><Megaphone size={11} /> {p.campanha}</span>}
                      <span>{c.posts} post(s)</span><span>·</span><span>{c.emAprovacao} em aprovação</span><span>·</span><span>{c.aprovados} job(s)</span>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#3D2314]/8"><div className="h-full rounded-full bg-[#C8941A]" style={{ width: `${pct}%` }} /></div>
                      <ChevronRight size={16} className="text-[#3D2314]/35 transition group-hover:translate-x-0.5 group-hover:text-[#C8941A]" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
      </div>

      {form && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/35" onClick={fechar}>
          <div className="flex h-full w-full flex-col bg-[#FAF7F2] shadow-2xl md:max-w-3xl" onClick={(e) => e.stopPropagation()} data-testid="planejamento-editor">
            <div className="flex items-center justify-between gap-2 border-b border-[#3D2314]/10 bg-white px-5 py-3.5">
              <div className="min-w-0">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#C8941A]">{form.id ? "Planejamento" : "Novo planejamento"}</div>
                <h2 className="truncate text-[18px] font-medium">{form.titulo || "Sem título"}</h2>
              </div>
              <div className="flex items-center gap-1">
                {form.id && <button onClick={() => void lixeiraPlano()} disabled={busy} className="rounded-full p-2 text-[#791F1F]/80 hover:bg-[#791F1F]/8" aria-label="mandar para a lixeira" data-testid="planejamento-lixeira"><Trash2 size={17} /></button>}
                <button onClick={fechar} aria-label="fechar" className="rounded-full p-2 text-[#3D2314]/60 hover:bg-[#3D2314]/6"><X size={18} /></button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <section className="rounded-2xl border border-[#3D2314]/10 bg-white p-4">
                <div className="space-y-3">
                  <ClienteErpBusca empresa={empresa} valorNome={form.cliente_nome} ajuda="pm.planejamento.cliente" testId="planejamento-cliente"
                    onEscolher={(id, nome) => setForm({ ...form, cliente_id: id, cliente_nome: nome, titulo: form.titulo || `${nome} · redes sociais de ${rotuloMes(`${form.mes}-01`).split(" de ")[0]}` })}
                    onLimpar={() => setForm({ ...form, cliente_id: "", cliente_nome: "" })} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Campo texto="Mês *" ajuda="pm.planejamento.mes">
                      <input type="month" className={inp} value={form.mes} onChange={(e) => e.target.value && setForm({ ...form, mes: e.target.value })} data-testid="planejamento-mes" />
                    </Campo>
                    <Campo texto="Campanha" ajuda="pm.planejamento.campanha">
                      <input className={inp} value={form.campanha} onChange={(e) => setForm({ ...form, campanha: e.target.value })} placeholder="Ex.: Outubro Rosa (opcional)" data-testid="planejamento-campanha" />
                    </Campo>
                  </div>
                  <Campo texto="Título *" ajuda="pm.planejamento.titulo">
                    <input className={inp} value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ex.: Café Serra Azul · redes sociais de outubro" data-testid="planejamento-titulo" />
                  </Campo>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Campo texto="Situação" ajuda="pm.planejamento.status">
                      <select className={inp} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as StatusPlanejamento })} data-testid="planejamento-status">
                        {STATUS_PLANEJAMENTO.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
                      </select>
                    </Campo>
                    <Campo texto="Responsável" ajuda="pm.planejamento.responsavel">
                      <select className={inp} value={form.responsavel_id} onChange={(e) => setForm({ ...form, responsavel_id: e.target.value })} data-testid="planejamento-responsavel">
                        <option value="">—</option>
                        {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                      </select>
                    </Campo>
                  </div>
                  <Campo texto="Observações" ajuda="pm.planejamento.observacoes">
                    <textarea rows={3} className={`${inp} resize-y`} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} placeholder="Combinados do mês, datas importantes, o que evitar" data-testid="planejamento-observacoes" />
                  </Campo>
                  {erroPlan && <div className="rounded-xl border border-[#791F1F]/25 bg-[#FBEAEA] px-3 py-2 text-[13px] text-[#791F1F]" data-testid="planejamento-erro">{erroPlan}</div>}
                  <div className="flex justify-end">
                    <button disabled={busy} onClick={() => void salvarPlano()} className="rounded-xl bg-[#3D2314] px-5 py-2.5 text-[13.5px] font-medium text-white disabled:opacity-40" data-testid="planejamento-salvar">{busy ? "Salvando…" : form.id ? "Salvar planejamento" : "Criar planejamento"}</button>
                  </div>
                </div>
              </section>

              {form.id && aberto && (
                <section className="mt-5" data-testid="planejamento-posts">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-[15px] font-medium">Posts <span className="text-[#3D2314]/50">({posts.length})</span></h3>
                    <div className="flex flex-wrap gap-2">
                      <button disabled={busy} onClick={() => void aprovarProntos()} className={btnSec} data-testid="planejamento-aprovar-prontos"><CheckCheck size={14} /> Aprovar prontos</button>
                      <button onClick={() => { setPostErro(null); setPostEdit(postVazio()); }} className="inline-flex items-center gap-1.5 rounded-xl bg-[#C8941A] px-3.5 py-2 text-[12.5px] font-medium text-white" data-testid="post-novo"><Plus size={14} /> Novo post</button>
                    </div>
                  </div>
                  {!posts.length && <div className="rounded-2xl border border-dashed border-[#3D2314]/20 bg-white p-6 text-center text-[13px] text-[#3D2314]/60">Nenhum post ainda. Comece pelo primeiro post do mês.</div>}
                  <div className="space-y-2">
                    {posts.map((p) => {
                      const st = statusPost(p.status);
                      const job = p.job_id ? jobs[p.job_id] : null;
                      return (
                        <article key={p.id} className="rounded-2xl border border-[#3D2314]/10 bg-white p-3.5" data-testid="post-item" data-status={p.status}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-[11.5px] font-medium text-[#3D2314]/55">{quandoBR(p.publicar_em)} · {nomePeca(p.servico_id)}</div>
                              <div className="text-[14.5px] font-medium">{p.assunto}</div>
                            </div>
                            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.l}</span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            {p.redes.map((r) => <span key={r} title={nomeRede(r)} className="rounded-md bg-[#3D2314]/6 px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide text-[#3D2314]/75">{siglaRede(r)} <span className="hidden font-normal sm:inline">{nomeRede(r)}</span></span>)}
                            {job && (
                              <Link href={`/dashboard/pm/pauta?job=${job.id}`} className="ml-auto inline-flex items-center gap-1 rounded-full bg-[#DCEFD7] px-2.5 py-0.5 text-[11.5px] font-medium text-[#2F5A1F]" data-testid="post-job">
                                <Briefcase size={12} /> job {job.numero} · prazo {dataBR(job.data_prazo)}
                              </Link>
                            )}
                          </div>
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            <button onClick={() => { setPostErro(null); setPostEdit({ ...p }); }} className={btnSec} data-testid="post-editar"><Pencil size={13} /> Editar</button>
                            {p.status === "rascunho" && <button disabled={busy} onClick={() => void mudarStatus(p, "em_aprovacao")} className={btnSec} data-testid="post-enviar"><Send size={13} /> Enviar para aprovação</button>}
                            {(p.status === "rascunho" || p.status === "em_aprovacao") && (
                              <button disabled={busy} onClick={() => void mudarStatus(p, "aprovado")} className="inline-flex items-center gap-1.5 rounded-xl border border-[#2F5A1F] bg-white px-3 py-2 text-[12.5px] font-medium text-[#2F5A1F] disabled:opacity-40" data-testid="post-aprovar"><CheckCircle2 size={13} /> Aprovar{p.job_id ? "" : " → job"}</button>
                            )}
                            {p.status === "aprovado" && <button disabled={busy} onClick={() => void mudarStatus(p, "publicado")} className={btnSec} data-testid="post-publicado"><Megaphone size={13} /> Publicado</button>}
                            {p.status !== "rascunho" && p.status !== "publicado" && <button disabled={busy} onClick={() => void mudarStatus(p, "rascunho")} className={btnSec}><Undo2 size={13} /> Rascunho</button>}
                            <button onClick={() => void lixeiraPost(p)} className="ml-auto rounded-xl p-2 text-[#791F1F]/70 hover:bg-[#791F1F]/8" aria-label="post para a lixeira"><Trash2 size={14} /></button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      )}

      {postEdit && (
        <PostForm key={postEdit.id ?? "novo"} inicial={postEdit} redes={redes} pecas={pecas} usuarios={usuarios} busy={busy} erro={postErro}
          onCancelar={() => setPostEdit(null)} onSalvar={(p) => void salvarPost(p)} />
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-[60] flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-2xl bg-[#3D2314] px-4 py-2.5 text-[13px] text-white shadow-lg" data-testid="planejamento-toast">
          <span>{toast.texto}</span>
          {toast.jobId && <Link href={`/dashboard/pm/pauta?job=${toast.jobId}`} className="shrink-0 font-semibold text-[#E8C474] underline">abrir o job</Link>}
        </div>
      )}
    </div>
  );
}
