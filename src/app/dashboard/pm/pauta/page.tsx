"use client";
// P&M · Pauta de Jobs (SPEC "P&M · Pauta", seções 5 e 6 — fase P2). Filtro no painel lateral (salvo por pessoa),
// atalhos de um toque, visões salvas, filtro por frase (IA confere, nunca aplica sozinha), abas por situação com
// contador (a mesma regra da lista: fn_pauta_contadores e fn_pauta_listar usam fn__pauta_filtrar), lista agrupada
// por prazo com "Atrasados" no topo, ações em massa com desfazer (24 h), lixeira, impressão A4 e planilha.
// Margem e valores só para gestor/financeiro (o banco devolve nulo para os demais). Todo campo tem o "?" da ajuda.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Filter, Printer, Download, Trash2, RotateCcw, Play, Paperclip, Link2, MessageCircle, Star, X, Undo2, Sparkles, ListChecks, Copy, Users, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { ClienteBusca } from "@/components/pm/ClienteBusca";
import { JobFluxo } from "@/components/pm/JobFluxo";
import { exportarExcel, type Coluna } from "@/lib/export/relatorioLista";
import {
  agrupar, atalhosVisiveis, juntarResponsaveis, type UsuarioEmpresa, type MembroEquipe, contarFiltros, limparFiltros, linkVisao, prazoAprovacao, seloEscopo, textoAguardando, textoAtraso, visaoDaUrl,
  AGRUPAMENTOS, PRIORIDADES, POR_PAGINA, type Agrupar, type Atalho, type FiltrosPauta, type ItemPauta,
} from "@/lib/pm/pauta";

type Opcao = { valor: string; rotulo: string };
type Nome = { id: string; nome: string; cliente_id?: string | null; grupo_id?: string | null };
type Visao = { id: string; nome: string; filtros: FiltrosPauta; compartilhada: boolean; dono_id: string };
type Lista = { total: number; pode_ver_margem: boolean; itens: ItemPauta[] };
const brl = (v: number | null) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const hora = (iso: string | null) => (iso && iso.length > 10 ? iso.slice(11, 16) : "");
const inp = "w-full rounded-md border border-[#3D2314]/15 bg-white px-2 py-1.5 text-[13px] text-[#3D2314]";
const btn = "rounded-md border border-[#3D2314]/15 bg-white px-2.5 py-1.5 text-[12.5px] text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-40 inline-flex items-center gap-1.5";

// Campo com o "?" da ajuda ao lado do rótulo (o gate check-ajuda-campo confere que todo campo da Pauta tem o seu)
function Campo({ texto, ajuda, children }: { texto: string; ajuda: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 flex items-center text-[11.5px] font-medium text-[#3D2314]/70">{texto}<AjudaCampo chave={ajuda} /></span>
      {children}
    </div>
  );
}
// seleção múltipla simples (lista com busca) — sem dependência nova
function Multi({ texto, ajuda, itens, valor, onChange, testid, primeiro }: { texto: string; ajuda: string; itens: Nome[]; valor: string[]; onChange: (v: string[]) => void; testid: string; primeiro?: Nome }) {
  const [q, setQ] = useState("");
  const todos = primeiro ? [primeiro, ...itens] : itens;
  const vis = todos.filter((i) => !q || i.nome.toLowerCase().includes(q.toLowerCase())).slice(0, 80);
  return (
    <Campo texto={texto} ajuda={ajuda}><div data-testid={testid}>
      {todos.length > 8 && <input className={`${inp} mb-1`} placeholder="buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="buscar na lista" />}
      <div className="max-h-36 overflow-y-auto rounded-md border border-[#3D2314]/10 bg-white p-1">
        {vis.map((i) => (
          <label key={i.id} data-ajuda={ajuda} className="flex items-center gap-2 px-1 py-0.5 text-[12.5px]">
            <input type="checkbox" checked={valor.includes(i.id)} onChange={(e) => onChange(e.target.checked ? [...valor, i.id] : valor.filter((x) => x !== i.id))} />
            {i.nome}
          </label>
        ))}
        {!vis.length && <div className="px-1 py-0.5 text-[12px] text-[#3D2314]/50">nada</div>}
      </div>
    </div></Campo>
  );
}

export default function PautaPage() {
  const { selInfo, companyIds } = useCompanyIds();
  const empresa = selInfo.tipo === "empresa" && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null);
  const [userId, setUserId] = useState<string | null>(null);
  const [situacoes, setSituacoes] = useState<Opcao[]>([]);
  const [motivos, setMotivos] = useState<Opcao[]>([]);
  // PM-C: aprovação aberta (prazo) de cada job da página — selo "vence hoje" / "vencida" na lista
  const [prazos, setPrazos] = useState<Record<string, string>>({});
  const [clientes, setClientes] = useState<Nome[]>([]);
  const [equipe, setEquipe] = useState<Nome[]>([]);
  const [grupos, setGrupos] = useState<Nome[]>([]);
  const [campanhas, setCampanhas] = useState<Nome[]>([]);
  const [fees, setFees] = useState<Nome[]>([]);
  const [servicos, setServicos] = useState<Nome[]>([]);
  const [visoes, setVisoes] = useState<Visao[]>([]);
  const [podeGerir, setPodeGerir] = useState(false);
  // filtro aplicado (o que a lista usa) × rascunho do painel (o que a pessoa está montando)
  const [filtros, setFiltros] = useState<FiltrosPauta>({});
  const [rascunho, setRascunho] = useState<FiltrosPauta>({});
  const [agrup, setAgrup] = useState<Agrupar>("prazo");
  const [aba, setAba] = useState<string>("todas");
  const [painel, setPainel] = useState(false);
  const [maisFiltros, setMaisFiltros] = useState(false);
  const [contadores, setContadores] = useState<{ por_situacao: Record<string, number>; total: number; atrasados: number } | null>(null);
  const [lista, setLista] = useState<Lista | null>(null);
  const [pagina, setPagina] = useState(1);
  const [carregando, setCarregando] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  // aviso do link de visão: estado próprio — a recarga da lista limpa "erro" e apagava o aviso antes de ser lido
  const [avisoLink, setAvisoLink] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; lote?: string } | null>(null);
  const [massa, setMassa] = useState(false);
  const [aberto, setAberto] = useState<ItemPauta | null>(null);
  const [frase, setFrase] = useState("");
  const [sugestaoIA, setSugestaoIA] = useState<{ filtros: FiltrosPauta; explicacao: string } | null>(null);
  const [prefCarregada, setPrefCarregada] = useState(false);
  const [nomesCli, setNomesCli] = useState<Record<string, string>>({});
  // a empresa tem algum job? (Pauta vazia de verdade × filtro sem resultado)
  const [temJob, setTemJob] = useState<boolean | null>(null);
  // PM-B: visão em uso (vem do menu ou do link ?visao=…) — o link abre a mesma visão para quem a pode ver
  const [visaoAtual, setVisaoAtual] = useState<Visao | null>(null);

  // ── cargas iniciais: listas da empresa, preferência salva e visões ──
  useEffect(() => {
    if (!empresa) return;
    let vivo = true;
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      const [op, cl, eq, gr, ca, co, sv, vi, pg, pr] = await Promise.all([
        supabase.rpc("fn_pauta_opcoes", { p_company_id: empresa }),
        supabase.from("agency_clientes").select("id, nome, nome_fantasia, grupo_id").eq("company_id", empresa).order("nome").limit(1000),
        // Bloco 1 (CEO 02/10): responsáveis = usuários ativos da empresa + equipe da agência com usuário (juntarResponsaveis)
        Promise.all([supabase.rpc("fn_usuarios_da_empresa", { p_company_id: empresa }),
          supabase.from("agency_equipe").select("user_id, nome").eq("company_id", empresa).eq("ativo", true).not("user_id", "is", null)]),
        supabase.from("agency_grupos_clientes").select("id, nome").eq("company_id", empresa).order("nome"),
        supabase.from("agency_campanhas").select("id, nome, cliente_id").eq("company_id", empresa).order("nome"),
        supabase.from("agency_contratos").select("id, cliente_id, tipo, status").eq("company_id", empresa).limit(1000),
        supabase.from("agency_servico").select("id, nome").eq("company_id", empresa).order("nome"),
        supabase.from("agency_visoes_pauta").select("id, nome, filtros, compartilhada, dono_id").eq("company_id", empresa).is("excluido_em", null).order("ordem"),
        supabase.rpc("fn_acessos_pode_gerir", { p_company_id: empresa }),
        uid ? supabase.from("agency_pauta_preferencia").select("filtros, agrupar, aba").eq("company_id", empresa).eq("user_id", uid).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      const { count: nJobs } = await supabase.from("agency_jobs").select("id", { count: "exact", head: true }).eq("company_id", empresa);
      if (vivo) setTemJob((nJobs ?? 0) > 0);
      if (!vivo) return;
      setUserId(uid);
      if (op.error) { setErro(op.error.message); return; }
      setSituacoes(((op.data as { situacoes: Opcao[] } | null)?.situacoes) ?? []);
      setMotivos(((op.data as { motivos: Opcao[] | null } | null)?.motivos) ?? []);
      const cls = ((cl.data ?? []) as { id: string; nome: string; nome_fantasia: string | null; grupo_id: string | null }[]).map((c) => ({ id: c.id, nome: c.nome_fantasia || c.nome, grupo_id: c.grupo_id }));
      setClientes(cls);
      setEquipe(juntarResponsaveis((eq[0].data ?? []) as UsuarioEmpresa[], (eq[1].data ?? []) as MembroEquipe[]));
      setGrupos((gr.data ?? []) as Nome[]);
      setCampanhas((ca.data ?? []) as Nome[]);
      const nomeCli = new Map(cls.map((c) => [c.id, c.nome]));
      setFees(((co.data ?? []) as { id: string; cliente_id: string | null; tipo: string | null; status: string | null }[])
        .map((c) => ({ id: c.id, cliente_id: c.cliente_id, nome: `${nomeCli.get(c.cliente_id ?? "") ?? "Cliente"} · ${c.tipo === "projeto" ? "projeto" : "fee"}${c.status && c.status !== "ativo" ? ` (${c.status})` : ""}` })));
      setServicos((sv.data ?? []) as Nome[]);
      setVisoes((vi.data ?? []) as Visao[]);
      setPodeGerir(!!pg.data);
      const pref = pr.data as { filtros: FiltrosPauta; agrupar: Agrupar; aba: string | null } | null;
      if (pref) { setFiltros(pref.filtros ?? {}); setRascunho(pref.filtros ?? {}); setAgrup(pref.agrupar ?? "prazo"); setAba(pref.aba ?? "todas"); }
      // link da visão salva: abre direto a visão (vale mais que a preferência guardada)
      const idLink = visaoDaUrl(window.location.search);
      if (idLink) {
        const v = ((vi.data ?? []) as Visao[]).find((x) => x.id === idLink);
        if (v) { setFiltros(v.filtros ?? {}); setRascunho(v.filtros ?? {}); setAba("todas"); setVisaoAtual(v); }
        else setAvisoLink("Este link é de uma visão que não existe mais ou que não foi compartilhada com você. Peça a quem mandou para compartilhar com a equipe.");
      }
      setPrefCarregada(true);
    })();
    return () => { vivo = false; };
  }, [empresa]);

  // filtro de cada pessoa fica salvo entre visitas (seção 5)
  const salvarPreferencia = useCallback(async (f: FiltrosPauta, g: Agrupar, a: string) => {
    if (!empresa || !userId) return;
    await supabase.from("agency_pauta_preferencia").upsert(
      { company_id: empresa, user_id: userId, filtros: limparFiltros({ ...f, lixeira: undefined }), agrupar: g, aba: a, atualizado_em: new Date().toISOString() },
      { onConflict: "company_id,user_id" });
  }, [empresa, userId]);

  const filtrosAtivos = useMemo(() => limparFiltros(filtros), [filtros]);
  // cada recarga ganha um número; resposta de uma recarga mais antiga (atalho + agrupamento trocados em sequência)
  // é descartada, para o contador e a lista nunca ficarem com o resultado do filtro anterior
  const recarga = useRef(0);
  const carregar = useCallback(async (pag: number) => {
    if (!empresa) return;
    const minha = ++recarga.current;
    setCarregando(true); setErro(null);
    const [ct, ls] = await Promise.all([
      supabase.rpc("fn_pauta_contadores", { p_company_id: empresa, p_filtros: filtrosAtivos }),
      supabase.rpc("fn_pauta_listar", { p_company_id: empresa, p_filtros: filtrosAtivos, p_situacao: aba === "todas" ? null : aba, p_agrupar: agrup, p_pagina: pag, p_por_pagina: POR_PAGINA }),
    ]);
    if (minha !== recarga.current) return;
    setCarregando(false);
    if (ct.error || ls.error) { setErro((ct.error ?? ls.error)!.message); return; }
    setContadores(ct.data as { por_situacao: Record<string, number>; total: number; atrasados: number });
    const nova = ls.data as Lista;
    setLista((ant) => (pag > 1 && ant ? { ...nova, itens: [...ant.itens, ...nova.itens] } : nova));
    setPagina(pag);
    const ids = nova.itens.filter((i) => i.status === "em_aprovacao").map((i) => i.id);
    if (ids.length) {
      const { data: ap } = await supabase.from("agency_aprovacoes").select("job_id, prazo_em").in("job_id", ids).is("decisao", null);
      if (minha !== recarga.current) return;
      const m: Record<string, string> = {};
      for (const a of (ap ?? []) as { job_id: string; prazo_em: string }[]) m[a.job_id] = a.prazo_em;
      setPrazos((ant) => (pag > 1 ? { ...ant, ...m } : m));
    } else if (pag === 1) setPrazos({});
  }, [empresa, filtrosAtivos, aba, agrup]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- recarrega a pauta quando filtro/aba/agrupamento mudam
  useEffect(() => { if (prefCarregada) { setSel(new Set()); void carregar(1); } }, [carregar, prefCarregada]);

  // /dashboard/pm/pauta?job=<id> (ex.: "abrir o job" do Briefing) abre o job direto, sem mexer no filtro da pessoa
  const jobDoLink = useRef(false);
  useEffect(() => {
    if (!empresa || !prefCarregada || jobDoLink.current) return;
    const id = new URLSearchParams(window.location.search).get("job");
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return;
    jobDoLink.current = true;
    void (async () => {
      const { data: j } = await supabase.from("agency_jobs").select("numero").eq("id", id).maybeSingle();
      const numero = (j as { numero: string | null } | null)?.numero;
      const { data } = await supabase.rpc("fn_pauta_listar", { p_company_id: empresa, p_filtros: numero ? { codigo: numero } : {}, p_situacao: null, p_agrupar: "sem", p_pagina: 1, p_por_pagina: numero ? 20 : 500 });
      const it = ((data as Lista | null)?.itens ?? []).find((x) => x.id === id);
      if (it) setAberto(it);
    })();
  }, [empresa, prefCarregada]);

  function aplicar(f: FiltrosPauta, visao: Visao | null = null) {
    const limpo = limparFiltros(f);
    setFiltros(limpo); setRascunho(limpo); setPainel(false);
    setVisaoAtual(visao); setAvisoLink(null);
    // a barra de endereço acompanha: com visão, o endereço já é o link dela; sem visão, volta ao endereço limpo
    window.history.replaceState(null, "", visao ? `?visao=${visao.id}` : window.location.pathname);
    void salvarPreferencia(limpo, agrup, aba);
  }
  async function copiarLink(v: Visao) {
    const url = linkVisao(window.location.origin, v.id);
    try { await navigator.clipboard.writeText(url); } catch { window.prompt("Copie o link da visão:", url); }
    setAviso({ texto: v.compartilhada
      ? `Link da visão "${v.nome}" copiado. Quem é da equipe abre a pauta já filtrada.`
      : `Link copiado, mas a visão "${v.nome}" é só sua: para a equipe abrir, compartilhe-a.` });
  }
  async function compartilharVisao(v: Visao) {
    const { error } = await supabase.from("agency_visoes_pauta").update({ compartilhada: true }).eq("id", v.id);
    if (error) { setErro(error.message); return; }
    const nova = { ...v, compartilhada: true };
    setVisoes((xs) => xs.map((x) => (x.id === v.id ? nova : x))); setVisaoAtual(nova);
    setAviso({ texto: `Visão "${v.nome}" agora é da equipe — o link funciona para todos.` });
  }
  function trocarAtalho(a: Atalho) { aplicar({ ...filtros, atalho: filtros.atalho === a ? undefined : a }); }
  function trocarAba(a: string) { setAba(a); void salvarPreferencia(filtros, agrup, a); }
  function trocarAgrup(g: Agrupar) { setAgrup(g); void salvarPreferencia(filtros, g, aba); }

  async function salvarVisao() {
    if (!empresa) return;
    const nome = window.prompt("Nome da visão (ex.: Atrasados da equipe):")?.trim();
    if (!nome) return;
    const compartilhada = podeGerir && window.confirm("Compartilhar com a equipe? (OK = da equipe · Cancelar = só sua)");
    const { data: nova, error } = await supabase.from("agency_visoes_pauta").insert({ company_id: empresa, nome, filtros: limparFiltros(rascunho), compartilhada, ordem: visoes.length })
      .select("id, nome, filtros, compartilhada, dono_id").single();
    if (error) { setErro(error.message); return; }
    const { data } = await supabase.from("agency_visoes_pauta").select("id, nome, filtros, compartilhada, dono_id").eq("company_id", empresa).is("excluido_em", null).order("ordem");
    setVisoes((data ?? []) as Visao[]);
    aplicar((nova as Visao).filtros, nova as Visao);
    setAviso({ texto: `Visão "${nome}" salva${compartilhada ? " para a equipe" : ""}. Use "Copiar link" para mandar a alguém.` });
  }

  async function entenderFrase() {
    if (!empresa || !frase.trim()) return;
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch("/api/pm/pauta/filtro-ia", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` }, body: JSON.stringify({ companyId: empresa, texto: frase }) });
    const j = await r.json().catch(() => ({})) as { ok?: boolean; filtros?: FiltrosPauta; explicacao?: string; erro?: string; aviso?: string };
    if (!j.ok || !j.filtros) { setErro(j.aviso || j.erro || "Não entendi o pedido."); return; }
    setSugestaoIA({ filtros: j.filtros, explicacao: j.explicacao ?? "" });
  }

  // ── ações em massa (com desfazer) ──
  async function acaoMassa(fn: string, args: Record<string, unknown>, texto: string) {
    const { data, error } = await supabase.rpc(fn, args);
    const r = data as { ok?: boolean; erro?: string; mensagem?: string; lote_id?: string; alterados?: number } | null;
    if (error || !r?.ok) { setErro(r?.mensagem || error?.message || r?.erro || "Não foi possível."); return; }
    setAviso({ texto: `${texto} (${r.alterados ?? 0} job${r.alterados === 1 ? "" : "s"}).`, lote: r.lote_id });
    setMassa(false); setSel(new Set()); void carregar(1);
  }
  async function desfazer(lote: string) {
    const { data, error } = await supabase.rpc("fn_pauta_desfazer", { p_lote_id: lote });
    const r = data as { ok?: boolean; mensagem?: string; erro?: string; restaurados?: number } | null;
    if (error || !r?.ok) { setErro(r?.mensagem || error?.message || r?.erro || "Não foi possível desfazer."); return; }
    setAviso({ texto: `Desfeito: ${r.restaurados ?? 0} job(s) voltaram como estavam.` }); void carregar(1);
  }

  async function abrirJob(it: ItemPauta) {
    setAberto(it);
    if (empresa && userId) {
      await supabase.from("agency_job_visto").upsert({ company_id: empresa, user_id: userId, job_id: it.id, visto_em: new Date().toISOString() }, { onConflict: "user_id,job_id" });
    }
  }

  async function exportar() {
    if (!empresa || !lista) return;
    // planilha com o filtro inteiro (não só a página): busca em lotes de 500
    const todos: ItemPauta[] = [];
    for (let p = 1; p <= 20; p++) {
      const { data } = await supabase.rpc("fn_pauta_listar", { p_company_id: empresa, p_filtros: filtrosAtivos, p_situacao: aba === "todas" ? null : aba, p_agrupar: agrup, p_pagina: p, p_por_pagina: 500 });
      const itens = (data as Lista | null)?.itens ?? [];
      todos.push(...itens);
      if (itens.length < 500) break;
    }
    const nomeSit = new Map(situacoes.map((s) => [s.valor, s.rotulo]));
    const cols: Coluna<ItemPauta>[] = [
      { header: "Código", get: (r) => r.codigo }, { header: "Título", get: (r) => r.titulo ?? "", peso: 3 },
      { header: "Cliente", get: (r) => r.cliente ?? "" }, { header: "Responsável", get: (r) => r.responsavel ?? "" },
      { header: "Situação", get: (r) => nomeSit.get(r.status) ?? r.status }, { header: "Prazo", get: (r) => r.data_prazo, tipo: "data" },
      { header: "Tipo de peça", get: (r) => r.servico ?? "" }, { header: "Escopo", get: (r) => seloEscopo(r) ?? "" },
      ...(lista.pode_ver_margem ? [{ header: "Valor", get: (r: ItemPauta) => r.valor_job, tipo: "moeda" as const }, { header: "Margem", get: (r: ItemPauta) => r.margem, tipo: "moeda" as const }] : []),
    ];
    await exportarExcel({ titulo: "Pauta de Jobs", empresa: selInfo.nome, filtros: `${contarFiltros(filtros)} filtro(s)${aba !== "todas" ? ` · aba ${nomeSit.get(aba) ?? aba}` : ""}`, emitidoEmISO: new Date().toISOString() }, cols, todos);
  }

  if (!empresa) return <div className="p-6 text-[13px] text-[#3D2314]/70">Escolha uma empresa no seletor para ver a pauta.</div>;
  const itens = lista?.itens ?? [];
  const grupos_ = agrupar(itens, agrup);
  const naLixeira = !!filtros.lixeira;
  const nFiltros = contarFiltros(filtros);
  const r = rascunho;
  const setR = (p: Partial<FiltrosPauta>) => setRascunho((x) => ({ ...x, ...p }));
  const campanhasVis = campanhas.filter((c) => (!r.clientes?.length || r.clientes.includes(c.cliente_id ?? "")));
  const feesVis = fees.filter((f) => (!r.clientes?.length || r.clientes.includes(f.cliente_id ?? "")));

  return (
    <div className="space-y-3 p-4 text-[#3D2314] md:p-6" data-testid="pauta-page">
      <header className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-medium"><ListChecks size={22} /> Pauta de Jobs</h1>
          <p className="text-sm text-[#3D2314]/60">{selInfo.nome} · o que cada pessoa tem para fazer e o que está atrasado, parado ou estourando o escopo.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className={btn} value={visaoAtual?.id ?? ""} aria-label="Visões salvas" data-testid="pauta-visoes" onChange={(e) => { const v = visoes.find((x) => x.id === e.target.value); if (v) aplicar(v.filtros, v); else aplicar({}); }}>
            <option value="">Visões salvas…</option>
            {visoes.map((v) => <option key={v.id} value={v.id}>{v.nome}{v.compartilhada ? " (equipe)" : ""}</option>)}
          </select>
          <AjudaCampo chave="pm.pauta.visao" />
          <Link href="/dashboard/producao?novo=job" className="inline-flex items-center gap-1.5 rounded-md bg-[#3D2314] px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-[#3D2314]/90" data-testid="pauta-novo-job"><Plus size={14} /> Novo job</Link>
          <button className={btn} onClick={() => { setRascunho(filtros); setPainel(true); }} data-testid="pauta-abrir-filtro"><Filter size={14} /> Filtro{nFiltros ? ` (${nFiltros})` : ""}</button>
          <button className={btn} onClick={() => window.print()} data-testid="pauta-imprimir"><Printer size={14} /> Imprimir</button>
          <button className={btn} onClick={() => void exportar()} data-testid="pauta-exportar"><Download size={14} /> Planilha</button>
          <button className={`${btn} ${naLixeira ? "border-[#791F1F] text-[#791F1F]" : ""}`} onClick={() => aplicar({ ...filtros, lixeira: !naLixeira })} data-testid="pauta-lixeira"><Trash2 size={14} /> {naLixeira ? "Sair da lixeira" : "Lixeira"}</button>
        </div>
      </header>

      {/* visão em uso + link para mandar à equipe (PM-B) */}
      {visaoAtual && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#C8941A]/40 bg-gradient-to-r from-[#FAEEDA] to-[#FAF7F2] px-3 py-2 text-[12.5px] print:hidden" data-testid="pauta-visao-atual">
          <span className="font-medium">Visão: {visaoAtual.nome}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${visaoAtual.compartilhada ? "bg-[#3D2314] text-white" : "bg-white text-[#3D2314]/70"}`}>{visaoAtual.compartilhada ? "da equipe" : "só sua"}</span>
          <span className="ml-auto inline-flex flex-wrap items-center gap-2">
            <button className={btn} onClick={() => void copiarLink(visaoAtual)} data-testid="pauta-visao-copiar-link"><Copy size={13} /> Copiar link</button>
            <AjudaCampo chave="pm.pauta.visao_link" />
            {!visaoAtual.compartilhada && podeGerir && visaoAtual.dono_id === userId && (
              <button className={btn} onClick={() => void compartilharVisao(visaoAtual)} data-testid="pauta-visao-compartilhar"><Users size={13} /> Compartilhar com a equipe</button>
            )}
            <button className={btn} onClick={() => aplicar({})} aria-label="sair da visão" data-testid="pauta-visao-sair"><X size={13} /></button>
          </span>
        </div>
      )}

      {/* filtro por frase (IA): sugere, a pessoa confere e aplica */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <span className="flex items-center text-[12px] text-[#3D2314]/70"><Sparkles size={13} className="mr-1" />Descreva o que quer ver</span><AjudaCampo chave="pm.pauta.frase" />
        <input className={`${inp} max-w-md flex-1`} value={frase} onChange={(e) => setFrase(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void entenderFrase(); }} placeholder='ex.: "jobs da MBOX atrasados da Fernanda"' data-testid="pauta-frase" />
        <button className={btn} onClick={() => void entenderFrase()} disabled={!frase.trim()}>Entender</button>
      </div>
      {sugestaoIA && (
        <div className="rounded-md border border-[#C8941A]/50 bg-[#FAEEDA]/60 px-3 py-2 text-[12.5px] print:hidden" data-testid="pauta-sugestao-ia">
          <b>Confira antes de aplicar:</b> {sugestaoIA.explicacao || "filtros sugeridos"} · {Object.keys(sugestaoIA.filtros).length} campo(s) preenchido(s).
          <span className="ml-2 inline-flex gap-2">
            <button className={btn} onClick={() => { setRascunho({ ...filtros, ...sugestaoIA.filtros }); setSugestaoIA(null); setPainel(true); }}>Conferir no filtro</button>
            <button className={btn} onClick={() => { aplicar({ ...filtros, ...sugestaoIA.filtros }); setSugestaoIA(null); }}>Aplicar</button>
            <button className={btn} onClick={() => setSugestaoIA(null)}>Descartar</button>
          </span>
        </div>
      )}

      {/* atalhos de um toque (combinam com o filtro aberto) */}
      <div className="flex flex-wrap gap-1.5 print:hidden" data-testid="pauta-atalhos">
        {atalhosVisiveis(!!lista?.pode_ver_margem).map((a) => (
          <button key={a.id} onClick={() => trocarAtalho(a.id)} data-testid={`pauta-atalho-${a.id}`}
            className={`rounded-full border px-3 py-1 text-[12px] ${filtros.atalho === a.id ? "border-[#C8941A] bg-[#FAEEDA] font-medium" : "border-[#3D2314]/15 bg-white"}`}>{a.rotulo}</button>
        ))}
        <span className="ml-auto flex items-center gap-1 text-[12px]">
          <select className={btn} value={agrup} onChange={(e) => trocarAgrup(e.target.value as Agrupar)} aria-label="Agrupar por" data-testid="pauta-agrupar">
            {AGRUPAMENTOS.map((g) => <option key={g.id} value={g.id}>{g.rotulo}</option>)}
          </select>
          <AjudaCampo chave="pm.pauta.agrupar" />
        </span>
      </div>

      {(erro || avisoLink) && <div className="rounded-md bg-[#F7E1E1] px-3 py-2 text-[12.5px] text-[#791F1F] print:hidden" data-testid="pauta-erro" onClick={() => { setErro(null); setAvisoLink(null); }}>{erro ?? avisoLink}</div>}
      {aviso && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-[#E5F2E1] px-3 py-2 text-[12.5px] text-[#2F5A1F] print:hidden" data-testid="pauta-aviso">
          <span>{aviso.texto}</span>
          <span className="flex gap-2">
            {aviso.lote && <button className={btn} onClick={() => void desfazer(aviso.lote!)} data-testid="pauta-desfazer"><Undo2 size={13} /> Desfazer</button>}
            <button onClick={() => setAviso(null)} aria-label="fechar"><X size={14} /></button>
          </span>
        </div>
      )}

      {/* abas por situação com contador (o contador respeita o filtro) */}
      <nav className="flex flex-wrap gap-1 border-b border-[#3D2314]/10 print:hidden" data-testid="pauta-abas">
        {[{ valor: "todas", rotulo: "Todas" }, ...situacoes].map((s) => {
          const n = s.valor === "todas" ? contadores?.total ?? 0 : contadores?.por_situacao?.[s.valor] ?? 0;
          return (
            <button key={s.valor} onClick={() => trocarAba(s.valor)} data-testid={`pauta-aba-${s.valor}`}
              className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${aba === s.valor ? "border-[#C8941A] font-medium" : "border-transparent text-[#3D2314]/60"}`}>
              {s.rotulo} <span data-testid={`pauta-aba-n-${s.valor}`} className="ml-1 rounded-full bg-[#3D2314]/8 px-1.5 text-[11px]">{n}</span>
            </button>
          );
        })}
      </nav>

      {/* barra de ações em massa */}
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] print:hidden">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" data-testid="pauta-sel-todos" checked={!!itens.length && sel.size === itens.length} onChange={(e) => setSel(e.target.checked ? new Set(itens.map((i) => i.id)) : new Set())} />
          Selecionar todos<AjudaCampo chave="pm.pauta.selecao" />
        </label>
        <span className="text-[#3D2314]/60">{sel.size ? `${sel.size} selecionado(s)` : `${lista?.total ?? 0} job(s)${naLixeira ? " na lixeira" : ""}`}</span>
        {!!sel.size && !naLixeira && <>
          <button className={btn} onClick={() => setMassa(true)} data-testid="pauta-editar-massa">Editar em massa</button>
          <button className={btn} onClick={() => void acaoMassa("fn_pauta_excluir", { p_company_id: empresa, p_ids: [...sel] }, "Enviado para a lixeira")} data-testid="pauta-excluir"><Trash2 size={13} /> Excluir</button>
        </>}
        {!!sel.size && naLixeira && <button className={btn} onClick={() => void acaoMassa("fn_pauta_excluir", { p_company_id: empresa, p_ids: [...sel], p_restaurar: true }, "Restaurado")} data-testid="pauta-restaurar"><RotateCcw size={13} /> Restaurar</button>}
        {carregando && <span className="text-[#3D2314]/50">carregando…</span>}
      </div>

      {/* lista agrupada (no celular vira cartão) */}
      <div className="space-y-4" data-testid="pauta-lista">
        {!itens.length && !carregando && temJob === false && !naLixeira && (
          <div className="rounded-2xl border border-[#C8941A]/40 bg-gradient-to-br from-white to-[#FAEEDA] p-8 text-center" data-testid="pauta-vazia">
            <div className="text-[18px] font-medium">A pauta ainda está vazia</div>
            <p className="mx-auto mt-1 max-w-md text-[13.5px] text-[#3D2314]/70">Os jobs do SIGA ainda não foram trazidos — a importação entra assim que a exportação chegar. Enquanto isso, já dá para criar jobs novos aqui.</p>
            <Link href="/dashboard/producao?novo=job" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#3D2314] px-5 py-3 text-[14px] font-medium text-white shadow-md hover:bg-[#3D2314]/90" data-testid="pauta-vazia-novo-job"><Plus size={16} /> Novo job</Link>
            <div className="mt-2 flex items-center justify-center text-[12px] text-[#3D2314]/55">como funciona<AjudaCampo chave="pm.pauta.vazia" /></div>
          </div>
        )}
        {!itens.length && !carregando && temJob !== false && <div className="rounded-md border border-dashed border-[#3D2314]/20 p-6 text-center text-[13px] text-[#3D2314]/60">Nenhum job com esse filtro.</div>}
        {grupos_.map((g, gi) => (
          <section key={`${g.grupo}-${gi}`} className="break-inside-avoid">
            {g.grupo && <h2 className={`mb-1 text-[12.5px] font-medium ${g.grupo === "Atrasados" ? "text-[#791F1F]" : "text-[#3D2314]/70"}`} data-testid="pauta-grupo">{g.grupo} · {g.itens.length}</h2>}
            <div className="divide-y divide-[#3D2314]/8 rounded-md border border-[#3D2314]/10 bg-white">
              {g.itens.map((it) => {
                const selo = seloEscopo(it);
                return (
                  <div key={it.id} data-ajuda="pm.pauta.selecao" data-testid={`pauta-linha-${it.numero}`} className="grid grid-cols-[auto_1fr] items-start gap-x-2 gap-y-1 px-2 py-2 text-[12.5px] md:grid-cols-[24px_70px_110px_1fr_160px_150px_90px_28px] md:items-center">
                    <input type="checkbox" className="print:hidden" aria-label={`selecionar ${it.codigo}`} checked={sel.has(it.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(it.id); else n.delete(it.id); setSel(n); }} />
                    <span className={it.atrasado ? "text-[#791F1F]" : "text-[#3D2314]/70"}>{hora(it.data_prazo) || (it.data_prazo ? it.data_prazo.slice(8, 10) + "/" + it.data_prazo.slice(5, 7) : "—")}{it.atrasado && <span className="block text-[11px]">{textoAtraso(it.dias_atraso)}</span>}</span>
                    <button className="text-left font-medium underline-offset-2 hover:underline" onClick={() => void abrirJob(it)} data-testid={`pauta-codigo-${it.numero}`}>
                      {it.codigo}
                      <span className="ml-1 inline-flex gap-0.5 align-middle text-[#3D2314]/50">
                        {it.tem_anexo && <Paperclip size={12} aria-label="tem anexo" />}{it.tem_link && <Link2 size={12} aria-label="tem link de arquivo" />}
                        {it.comentarios_novos > 0 && <span className="inline-flex items-center text-[#C8941A]" title={`${it.comentarios_novos} comentário(s) novo(s)`}><MessageCircle size={12} />{it.comentarios_novos}</span>}
                      </span>
                    </button>
                    <span className="col-span-2 md:col-span-1">
                      {it.nota ? <span className="mr-1 inline-flex text-[#C8941A]" title={`nota ${it.nota}`}>{Array.from({ length: it.nota }).map((_, i) => <Star key={i} size={11} fill="currentColor" />)}</span> : null}
                      {it.titulo}
                      {it.rodada > 0 && <span className="ml-1 rounded bg-[#3D2314]/8 px-1 text-[10.5px]">rodada {it.rodada}</span>}
                      {it.status === "aguardando" && <span className="ml-1 rounded bg-[#FAEEDA] px-1 text-[10.5px]" data-testid="pauta-selo-aguardando">{textoAguardando(it.aguardando_de, it.aguardando_dias, motivos.find((m) => m.valor === it.aguardando_motivo)?.rotulo)}</span>}
                      {prazos[it.id] && (() => { const pr = prazoAprovacao(prazos[it.id]); return (
                        <span className={`ml-1 rounded px-1 text-[10.5px] ${pr.nivel === "vencida" ? "bg-[#F7E1E1] text-[#791F1F]" : pr.nivel === "hoje" ? "bg-[#FAEEDA] text-[#6B4A0E]" : "bg-[#3D2314]/8"}`} data-testid="pauta-selo-aprovacao" data-nivel={pr.nivel}>aprovação {pr.texto}</span>); })()}
                      {selo && <span className={`ml-1 rounded px-1 text-[10.5px] ${it.escopo_estourou ? "bg-[#F7E1E1] text-[#791F1F]" : "bg-[#3D2314]/8"}`} data-testid="pauta-selo-escopo">{selo}</span>}
                      <span className="block text-[11px] text-[#3D2314]/50">{it.servico ?? it.tipo ?? ""}</span>
                    </span>
                    <span className={it.atrasado ? "text-[#791F1F]" : ""}>{it.cliente ?? "—"}</span>
                    <span>{it.responsavel ?? "—"}</span>
                    <span className="text-right text-[11.5px]">{lista?.pode_ver_margem && it.margem != null ? <span className={it.margem < 0 ? "text-[#791F1F]" : "text-[#2F5A1F]"} title="margem do job">{brl(it.margem)}</span> : null}</span>
                    <Link href={`/dashboard/pm/apontamento-horas?job=${it.id}`} className="print:hidden" title="cronômetro neste job" aria-label="cronômetro neste job"><Play size={14} /></Link>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {lista && itens.length < lista.total && (
          <button className={`${btn} print:hidden`} onClick={() => void carregar(pagina + 1)} disabled={carregando} data-testid="pauta-mais">Carregar mais ({itens.length} de {lista.total})</button>
        )}
      </div>

      {/* painel de filtro (lateral; no celular, tela cheia) */}
      {painel && (
        <div className="fixed inset-0 z-[120] flex justify-end bg-black/30 print:hidden" onClick={() => setPainel(false)}>
          <div className="h-full w-full overflow-y-auto bg-[#FAF7F2] p-4 sm:w-[420px]" onClick={(e) => e.stopPropagation()} data-testid="pauta-painel">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-[16px] font-medium">Filtro</h2><button onClick={() => setPainel(false)} aria-label="fechar"><X size={16} /></button></div>
            <div className="space-y-3">
              <div data-testid="pauta-f-cliente">
                <ClienteBusca empresa={empresa} modo="filtro" valorNome="" rotulo="Cliente" ajuda="pm.pauta.filtro.cliente" testId="pauta-f-cliente-busca"
                  onEscolher={(id, nome) => { setNomesCli((m) => ({ ...m, [id]: nome })); setR({ clientes: [...new Set([...(r.clientes ?? []), id])] }); }} />
                {!!r.clientes?.length && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {r.clientes.map((id) => (
                      <span key={id} className="inline-flex items-center gap-1 rounded-full bg-[#FAEEDA] px-2 py-0.5 text-[12px]" data-testid="pauta-f-cliente-chip">
                        {nomesCli[id] ?? clientes.find((c) => c.id === id)?.nome ?? "cliente"}
                        <button onClick={() => setR({ clientes: (r.clientes ?? []).filter((x) => x !== id) })} aria-label="tirar cliente do filtro"><X size={12} /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <Multi texto="Responsável" ajuda="pm.pauta.filtro.responsavel" itens={equipe.filter((p) => p.id !== userId)} primeiro={userId ? { id: userId, nome: "Eu" } : undefined} valor={r.responsaveis ?? []} onChange={(v) => setR({ responsaveis: v })} testid="pauta-f-responsavel" />
              <Campo texto="Situação do job" ajuda="pm.pauta.filtro.situacao">
                <select className={inp} value={aba} onChange={(e) => trocarAba(e.target.value)} data-testid="pauta-f-situacao">
                  <option value="todas">Por abas</option>{situacoes.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
                </select></Campo>
              <button className="text-[12.5px] underline" onClick={() => setMaisFiltros((v) => !v)} data-testid="pauta-mais-filtros">{maisFiltros ? "Menos filtros" : "Mais filtros"}</button>
              {maisFiltros && <>
                <Campo texto="Data" ajuda="pm.pauta.filtro.data">
                  <div className="grid grid-cols-3 gap-1">
                    <select className={inp} value={r.data_tipo ?? "prazo"} onChange={(e) => setR({ data_tipo: e.target.value as FiltrosPauta["data_tipo"] })} aria-label="tipo de data">
                      <option value="prazo">prazo</option><option value="criacao">criação</option><option value="entrega">entrega</option><option value="conclusao">conclusão</option>
                    </select>
                    <input type="date" className={inp} value={r.data_de ?? ""} onChange={(e) => setR({ data_de: e.target.value })} aria-label="de" />
                    <input type="date" className={inp} value={r.data_ate ?? ""} onChange={(e) => setR({ data_ate: e.target.value })} aria-label="até" />
                  </div></Campo>
                <Campo texto="Título" ajuda="pm.pauta.filtro.titulo"><input className={inp} value={r.titulo ?? ""} onChange={(e) => setR({ titulo: e.target.value })} data-testid="pauta-f-titulo" /></Campo>
                <Campo texto="Código" ajuda="pm.pauta.filtro.codigo"><input className={inp} value={r.codigo ?? ""} onChange={(e) => setR({ codigo: e.target.value })} placeholder="113223 ou 113223A" data-testid="pauta-f-codigo" /></Campo>
                <Multi texto="Grupo de clientes" ajuda="pm.pauta.filtro.grupo" itens={grupos} valor={r.grupos ?? []} onChange={(v) => setR({ grupos: v })} testid="pauta-f-grupo" />
                <Multi texto="Campanha" ajuda="pm.pauta.filtro.campanha" itens={campanhasVis} valor={r.campanhas ?? []} onChange={(v) => setR({ campanhas: v })} testid="pauta-f-campanha" />
                <Multi texto="Fee (contrato)" ajuda="pm.pauta.filtro.fee" itens={feesVis} valor={r.fees ?? []} onChange={(v) => setR({ fees: v })} testid="pauta-f-fee" />
                <Multi texto="Situação do cliente" ajuda="pm.pauta.filtro.situacao_cliente" itens={[{ id: "ativo", nome: "Ativo" }, { id: "pausado", nome: "Pausado" }, { id: "encerrado", nome: "Encerrado" }]} valor={r.situacao_cliente ?? []} onChange={(v) => setR({ situacao_cliente: v })} testid="pauta-f-sitcliente" />
                <Multi texto="Tipo de peça" ajuda="pm.pauta.filtro.tipo_peca" itens={servicos} valor={r.servicos ?? []} onChange={(v) => setR({ servicos: v })} testid="pauta-f-servico" />
                <Campo texto="Aguardando" ajuda="pm.pauta.filtro.aguardando">
                  <select className={inp} value={r.aguardando == null ? "" : r.aguardando ? "sim" : "nao"} onChange={(e) => setR({ aguardando: e.target.value === "" ? undefined : e.target.value === "sim" })} aria-label="aguardando">
                    <option value="">tanto faz</option><option value="sim">sim</option><option value="nao">não</option>
                  </select>
                  <div className="mt-1"><Multi texto="De quem" ajuda="pm.pauta.filtro.aguardando" itens={[{ id: "cliente", nome: "Cliente" }, { id: "planejamento", nome: "Planejamento" }, { id: "fornecedor", nome: "Fornecedor" }, { id: "interno", nome: "Interno" }]} valor={r.aguardando_de ?? []} onChange={(v) => setR({ aguardando_de: v })} testid="pauta-f-aguardando-de" /></div></Campo>
              </>}
            </div>
            <div className="sticky bottom-0 mt-4 flex flex-wrap gap-2 bg-[#FAF7F2] py-2">
              <button className="rounded-md bg-[#3D2314] px-3 py-1.5 text-[13px] text-white" onClick={() => aplicar(rascunho)} data-testid="pauta-filtrar">Filtrar</button>
              <button className={btn} onClick={() => setRascunho({ lixeira: filtros.lixeira })} data-testid="pauta-limpar">Limpar</button>
              <span className="inline-flex items-center"><button className={btn} onClick={() => void salvarVisao()} data-testid="pauta-salvar-visao">Salvar como visão</button><AjudaCampo chave="pm.pauta.visao" /></span>
            </div>
          </div>
        </div>
      )}

      {/* edição em massa */}
      {massa && <EdicaoMassa n={sel.size} situacoes={situacoes} equipe={equipe} onCancelar={() => setMassa(false)}
        onAplicar={(campos) => void acaoMassa("fn_pauta_editar_em_massa", { p_company_id: empresa, p_ids: [...sel], p_campos: campos }, "Alterado")} />}

      {/* job aberto (resumo; a edição completa continua em Jobs) */}
      {aberto && (
        <div className="fixed inset-0 z-[120] flex justify-end bg-black/30 print:hidden" onClick={() => setAberto(null)}>
          <div className="h-full w-full overflow-y-auto bg-white p-4 sm:w-[480px]" onClick={(e) => e.stopPropagation()} data-testid="pauta-job">
            <div className="mb-2 flex items-center justify-between"><h2 className="text-[16px] font-medium">{aberto.codigo} · {aberto.titulo}</h2><button onClick={() => setAberto(null)} aria-label="fechar"><X size={16} /></button></div>
            <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-[13px]">
              <dt className="text-[#3D2314]/60">Cliente</dt><dd>{aberto.cliente ?? "—"}</dd>
              <dt className="text-[#3D2314]/60">Responsável</dt><dd>{aberto.responsavel ?? "—"}</dd>
              <dt className="text-[#3D2314]/60">Situação</dt><dd>{situacoes.find((s) => s.valor === aberto.status)?.rotulo ?? aberto.status}{aberto.status === "aguardando" ? ` · ${textoAguardando(aberto.aguardando_de, aberto.aguardando_dias, motivos.find((m) => m.valor === aberto.aguardando_motivo)?.rotulo)}` : ""}</dd>
              <dt className="text-[#3D2314]/60">Prazo</dt><dd className={aberto.atrasado ? "text-[#791F1F]" : ""}>{aberto.data_prazo?.slice(0, 10).split("-").reverse().join("/") ?? "—"} {textoAtraso(aberto.dias_atraso)}</dd>
              <dt className="text-[#3D2314]/60">Tipo de peça</dt><dd>{aberto.servico ?? aberto.tipo ?? "—"}</dd>
              <dt className="text-[#3D2314]/60">Escopo</dt><dd>{seloEscopo(aberto) ?? "sem limite de ajustes"}</dd>
              {lista?.pode_ver_margem && <><dt className="text-[#3D2314]/60">Valor · margem</dt><dd>{brl(aberto.valor_job)} · {brl(aberto.margem)}</dd></>}
            </dl>
            <JobFluxo key={aberto.id} jobId={aberto.id} motivos={motivos} situacoes={situacoes}
              onMudou={(codigo) => { if (codigo) setAberto((a) => (a ? { ...a, codigo } : a)); void carregar(1); }} />
            <div className="mt-3 flex gap-2">
              <Link className={btn} href={`/dashboard/producao`}>Abrir em Jobs</Link>
              <Link className={btn} href={`/dashboard/pm/apontamento-horas?job=${aberto.id}`}><Play size={13} /> Cronômetro</Link>
            </div>
          </div>
        </div>
      )}

      {/* impressão: pauta por responsável, A4, preto e branco, agrupada por prazo */}
      <div className="hidden print:block" data-testid="pauta-impressao">
        <h1 className="text-[14pt] font-semibold">Pauta de Jobs · {selInfo.nome} · {new Date().toLocaleDateString("pt-BR")}</h1>
        {agrupar([...itens].sort((a, b) => (a.responsavel ?? "").localeCompare(b.responsavel ?? "")), "responsavel").map((g) => (
          <section key={g.grupo} className="mt-3 break-inside-avoid">
            <h2 className="border-b border-black text-[11pt] font-semibold">{g.grupo}</h2>
            {agrupar(g.itens, "prazo").map((p) => (
              <div key={p.grupo} className="mt-1">
                <div className="text-[9.5pt] font-semibold">{p.grupo}</div>
                {p.itens.map((it) => <div key={it.id} className="text-[9.5pt]">☐ {it.codigo} · {it.titulo} · {it.cliente ?? ""}</div>)}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function EdicaoMassa({ n, situacoes, equipe, onCancelar, onAplicar }: {
  n: number; situacoes: Opcao[]; equipe: Nome[]; onCancelar: () => void; onAplicar: (c: Record<string, string | null>) => void;
}) {
  const [resp, setResp] = useState(""); const [prazo, setPrazo] = useState(""); const [sit, setSit] = useState(""); const [prio, setPrio] = useState("");
  const campos: Record<string, string | null> = {};
  if (resp) campos.responsavel_id = resp; if (prazo) campos.data_prazo = prazo; if (sit) campos.status = sit; if (prio) campos.prioridade = prio;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4 print:hidden" onClick={onCancelar}>
      <div className="w-full max-w-sm rounded-lg bg-white p-4" onClick={(e) => e.stopPropagation()} data-testid="pauta-massa">
        <h2 className="mb-1 text-[15px] font-medium">Editar {n} job(s)</h2>
        <p className="mb-3 text-[12px] text-[#3D2314]/60">Só muda o que você preencher. Dá para desfazer por 24 horas.</p>
        <div className="space-y-2">
          <Campo texto="Responsável" ajuda="pm.pauta.massa.responsavel">
            <select className={inp} value={resp} onChange={(e) => setResp(e.target.value)} data-testid="pauta-massa-responsavel"><option value="">não mudar</option>{equipe.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></Campo>
          <Campo texto="Prazo" ajuda="pm.pauta.massa.prazo"><input type="date" className={inp} value={prazo} onChange={(e) => setPrazo(e.target.value)} data-testid="pauta-massa-prazo" /></Campo>
          <Campo texto="Situação" ajuda="pm.pauta.massa.situacao">
            <select className={inp} value={sit} onChange={(e) => setSit(e.target.value)} data-testid="pauta-massa-situacao"><option value="">não mudar</option>{situacoes.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}</select></Campo>
          <Campo texto="Prioridade" ajuda="pm.pauta.massa.prioridade">
            <select className={inp} value={prio} onChange={(e) => setPrio(e.target.value)} data-testid="pauta-massa-prioridade"><option value="">não mudar</option>{PRIORIDADES.map((p) => <option key={p} value={p}>{p}</option>)}</select></Campo>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className={btn} onClick={onCancelar}>Cancelar</button>
          <button className="rounded-md bg-[#3D2314] px-3 py-1.5 text-[13px] text-white disabled:opacity-40" disabled={!Object.keys(campos).length} onClick={() => onAplicar(campos)} data-testid="pauta-massa-aplicar">Aplicar</button>
        </div>
      </div>
    </div>
  );
}
