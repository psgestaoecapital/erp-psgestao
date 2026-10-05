"use client";
// "Copiar de um job pronto" (P&M · spec aprovada pelo CEO, 03/10). Abre do Novo Job:
//   · busca que perdoa acento e erro de digitação (fn_pm_jobs_buscar — RLS de quem chama), filtros de cliente, peça,
//     período e situação, paginada;
//   · prévia do job escolhido (briefing, tarefas, anexos) e o que vai / o que não vai para o job novo;
//   · opções marcáveis (responsáveis, anexos), cliente e título do job novo e o prazo já calculado (pode trocar);
//   · "Copiar" chama fn_pm_job_copiar (guarda de empresa no banco). No celular abre em tela cheia.
// E "Jobs parecidos (N)" embaixo do título do Novo Job (fn_pm_jobs_parecidos, leve).
// Cada campo tem o "?" (AjudaCampo) — o gate scripts/gates/check-pm-copiar-job.ts confere.

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Copy, Filter, Paperclip, ListChecks, Search, Sparkles, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { ClienteBusca } from "@/components/pm/ClienteBusca";
import {
  TIPOS_PECA, rotuloPeca, prazoDaCopia, explicarPrazo, oQueCopia, montarOpcoes, limparFiltrosCopia, contarFiltrosCopia,
  diaEmSaoPaulo, tituloBuscavel, OPCOES_PADRAO, type FiltrosCopia, type OpcoesCopia,
} from "@/lib/pm/copiarJob";

const SITUACOES: Array<[string, string]> = [
  ["nao_iniciada", "Não iniciada"], ["em_producao", "Em produção"], ["aguardando", "Aguardando"],
  ["em_aprovacao", "Em aprovação"], ["concluida", "Concluída"], ["publicado", "Publicado"],
];
const rotuloSituacao = (s: string | null) => SITUACOES.find(([k]) => k === s)?.[1] ?? (s ?? "—");
const POR_PAGINA = 10;

export type ItemBusca = {
  id: string; numero: string | null; titulo: string | null; cliente_id: string | null; cliente: string | null
  tipo: string | null; peca: string | null; status: string | null; data_inicio: string | null; data_prazo: string | null
  criado_em: string | null; horas_estimadas: number | null; servico_id: string | null; responsavel_id: string | null
  tarefas: number; arquivos: number; resumo: string; relevancia: number
};
type Detalhe = {
  descricao: string | null; arquivos: Array<{ nome?: string; url?: string }>; servico_prazo: number | null
  tarefas: Array<{ id: string; titulo: string; checklist: unknown[] | null; responsavel_id: string | null }>
};
export type ResultadoCopia = { ok: boolean; job_id?: string; numero?: string; origem_numero?: string; data_prazo?: string | null; regra_prazo?: string; tarefas?: number; erro?: string; mensagem?: string };

const fmtData = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
// briefing é texto/markdown: NUNCA vira HTML — só tira marcação para a prévia
const textoPuro = (s: string | null | undefined) => (s ?? "").replace(/<[^>]*>/g, " ").replace(/[*_#>`]/g, " ").replace(/[ \t]+/g, " ").trim();

const inp = "w-full rounded-xl border border-[#3D2314]/15 bg-white px-3 py-2 text-[13.5px] text-[#3D2314] focus:border-[#C8941A] focus:outline-none";
const rot = "mb-1 flex items-center text-[12px] font-semibold text-[#3D2314]";

export function CopiarJob({ empresa, jobInicial, responsaveis, onFechar, onCopiado }: {
  empresa: string; jobInicial?: string | null
  responsaveis: Array<{ id: string; email: string | null; full_name?: string | null }>
  onFechar: () => void; onCopiado: (r: ResultadoCopia) => void
}) {
  const [q, setQ] = useState("");
  const [filtros, setFiltros] = useState<FiltrosCopia>({});
  const [clienteFiltroNome, setClienteFiltroNome] = useState("");
  const [verFiltros, setVerFiltros] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [itens, setItens] = useState<ItemBusca[]>([]);
  const [total, setTotal] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState<string | null>(null);
  const [sel, setSel] = useState<ItemBusca | null>(null);
  const seq = useRef(0);

  // busca com espera curta (digitação)
  useEffect(() => {
    const minha = ++seq.current;
    const t = setTimeout(() => {
      setBuscando(true);
      void supabase.rpc("fn_pm_jobs_buscar", { p_company_id: empresa, p_texto: q, p_filtros: limparFiltrosCopia(filtros), p_pagina: pagina, p_por_pagina: POR_PAGINA })
        .then(({ data, error }) => {
          if (minha !== seq.current) return;
          setBuscando(false);
          if (error) { setErroBusca(error.message); setItens([]); setTotal(0); return; }
          setErroBusca(null);
          const r = data as { total: number; itens: ItemBusca[] } | null;
          setItens(r?.itens ?? []); setTotal(r?.total ?? 0);
        });
    }, 260);
    return () => clearTimeout(t);
  }, [q, filtros, pagina, empresa]);

  // aberto a partir de "Jobs parecidos": já entra na prévia do job
  useEffect(() => {
    if (!jobInicial) return;
    void supabase.from("agency_jobs").select("id, numero, titulo, cliente_id, tipo, status, data_inicio, data_prazo, created_at, horas_estimadas, servico_id, responsavel_id, agency_clientes(nome, nome_fantasia)")
      .eq("id", jobInicial).eq("company_id", empresa).maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const j = data as unknown as Omit<ItemBusca, "cliente" | "criado_em" | "tarefas" | "arquivos" | "resumo" | "relevancia" | "peca"> & { created_at: string; agency_clientes: { nome: string | null; nome_fantasia: string | null } | null };
        setSel({ ...j, criado_em: j.created_at, cliente: j.agency_clientes?.nome_fantasia || j.agency_clientes?.nome || null, peca: rotuloPeca(j.tipo), tarefas: 0, arquivos: 0, resumo: "", relevancia: 0 });
      });
  }, [jobInicial, empresa]);

  const mudarFiltro = (f: FiltrosCopia) => { setFiltros(f); setPagina(1); };
  const nFiltros = contarFiltrosCopia(filtros);
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div className="fixed inset-0 z-[90] flex items-stretch justify-center bg-black/45 sm:items-start sm:p-4" data-testid="copiar-job">
      <div className="flex h-full w-full flex-col overflow-hidden bg-[#FAF7F2] sm:h-auto sm:max-h-[calc(100vh-32px)] sm:max-w-5xl sm:rounded-2xl sm:shadow-2xl">
        {/* cabeçalho */}
        <div className="flex items-center justify-between gap-3 border-b border-[#3D2314]/10 bg-white px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {sel && (
              <button type="button" onClick={() => setSel(null)} className="rounded-lg p-1.5 text-[#3D2314] hover:bg-[#FAEEDA] lg:hidden" aria-label="Voltar para a lista" data-testid="copiar-voltar">
                <ArrowLeft size={18} />
              </button>
            )}
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#3D2314] text-[#C8941A]"><Copy size={16} /></span>
            <div className="min-w-0">
              <h2 className="truncate text-[16px] font-semibold text-[#3D2314]">Copiar de um job pronto</h2>
              <p className="truncate text-[12px] text-[#3D2314]/60">Ache um job parecido e comece o novo a partir dele.</p>
            </div>
          </div>
          <button type="button" onClick={onFechar} className="flex h-10 w-10 items-center justify-center rounded-lg text-[#3D2314]/70 hover:bg-[#FAEEDA]" aria-label="Fechar" data-testid="copiar-fechar"><X size={20} /></button>
        </div>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* ── lista ── */}
          <section className={`${sel ? "hidden lg:flex" : "flex"} min-h-0 flex-col border-r border-[#3D2314]/10`}>
            <div className="space-y-2 border-b border-[#3D2314]/10 bg-white px-4 py-3">
              <label className="block">
                <span className={rot}>Buscar job pronto<AjudaCampo chave="pm.copiar.busca" /></span>
                <span className="flex items-center gap-2 rounded-xl border border-[#3D2314]/15 bg-white px-3 focus-within:border-[#C8941A]">
                  <Search size={15} className="text-[#3D2314]/45" />
                  <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setPagina(1); }} data-testid="copiar-busca"
                    placeholder="Ex.: carrossel dia das crianças, número do job, cliente…" className="w-full border-0 bg-transparent py-2 text-[13.5px] focus:outline-none" />
                </span>
              </label>
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => setVerFiltros(!verFiltros)} data-testid="copiar-filtros-abrir"
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-medium ${nFiltros ? "border-[#C8941A] bg-[#FAEEDA] text-[#3D2314]" : "border-[#3D2314]/15 bg-white text-[#3D2314]/80"}`}>
                  <Filter size={13} /> Filtros{nFiltros ? ` (${nFiltros})` : ""}
                </button>
                <span className="text-[12px] text-[#3D2314]/60" data-testid="copiar-total">{buscando ? "Buscando…" : `${total} job${total === 1 ? "" : "s"}`}</span>
              </div>
              {verFiltros && (
                <div className="grid gap-2 rounded-xl border border-[#3D2314]/10 bg-[#FAF7F2] p-2.5 sm:grid-cols-2" data-testid="copiar-filtros">
                  <div className="sm:col-span-2">
                    <ClienteBusca empresa={empresa} modo="filtro" rotulo="Cliente" ajuda="pm.copiar.cliente_filtro" testId="copiar-filtro-cliente"
                      valorNome={clienteFiltroNome}
                      onEscolher={(id, nome) => { setClienteFiltroNome(nome); mudarFiltro({ ...filtros, clientes: [id] }); }}
                      onLimpar={() => { setClienteFiltroNome(""); mudarFiltro({ ...filtros, clientes: [] }); }} />
                  </div>
                  <label className="block">
                    <span className={rot}>Peça<AjudaCampo chave="pm.copiar.peca_filtro" /></span>
                    <select className={inp} value={filtros.pecas?.[0] ?? ""} data-testid="copiar-filtro-peca"
                      onChange={(e) => mudarFiltro({ ...filtros, pecas: e.target.value ? [e.target.value] : [] })}>
                      <option value="">Todas</option>
                      {TIPOS_PECA.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className={rot}>Situação<AjudaCampo chave="pm.copiar.situacao_filtro" /></span>
                    <select className={inp} value={filtros.situacoes?.[0] ?? ""} data-testid="copiar-filtro-situacao"
                      onChange={(e) => mudarFiltro({ ...filtros, situacoes: e.target.value ? [e.target.value] : [] })}>
                      <option value="">Todas</option>
                      {SITUACOES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className={rot}>De<AjudaCampo chave="pm.copiar.periodo" /></span>
                    <input type="date" className={inp} value={filtros.data_de ?? ""} data-testid="copiar-filtro-de"
                      onChange={(e) => mudarFiltro({ ...filtros, data_de: e.target.value || undefined })} />
                  </label>
                  <label className="block">
                    <span className={rot}>Até<AjudaCampo chave="pm.copiar.periodo" /></span>
                    <input type="date" className={inp} value={filtros.data_ate ?? ""} data-testid="copiar-filtro-ate"
                      onChange={(e) => mudarFiltro({ ...filtros, data_ate: e.target.value || undefined })} />
                  </label>
                  {nFiltros > 0 && (
                    <button type="button" className="text-left text-[12px] text-[#3D2314]/70 underline sm:col-span-2"
                      onClick={() => { setClienteFiltroNome(""); mudarFiltro({}); }}>Limpar filtros</button>
                  )}
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" data-testid="copiar-lista">
              {erroBusca && <p className="rounded-lg bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#791F1F]">{erroBusca}</p>}
              {!erroBusca && !buscando && itens.length === 0 && (
                <div className="px-3 py-10 text-center text-[13px] text-[#3D2314]/60">
                  Nenhum job encontrado{q ? <> para <b>“{q}”</b></> : ""}. Tente outra palavra ou tire um filtro.
                </div>
              )}
              <ul className="space-y-2">
                {itens.map((it) => (
                  <li key={it.id}>
                    <button type="button" onClick={() => setSel(it)} data-testid="copiar-item" data-numero={it.numero ?? ""}
                      className={`w-full rounded-xl border bg-white p-3 text-left transition hover:border-[#C8941A] hover:shadow-sm ${sel?.id === it.id ? "border-[#C8941A] ring-2 ring-[#C8941A]/25" : "border-[#3D2314]/10"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[13.5px] font-semibold leading-snug text-[#3D2314]">{it.titulo || "Sem título"}</span>
                        <span className="shrink-0 rounded-md bg-[#3D2314]/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-[#3D2314]/70">{it.numero ?? "—"}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11.5px] text-[#3D2314]/60">
                        {it.cliente && <span>{it.cliente}</span>}
                        {it.peca && <span>· {it.peca}</span>}
                        <span>· {rotuloSituacao(it.status)}</span>
                        {it.data_prazo && <span>· prazo {fmtData(it.data_prazo)}</span>}
                      </div>
                      {it.resumo && <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-[#3D2314]/55">{it.resumo}</p>}
                      <div className="mt-1.5 flex gap-3 text-[11px] text-[#3D2314]/55">
                        <span className="inline-flex items-center gap-1"><ListChecks size={12} /> {it.tarefas} tarefa{it.tarefas === 1 ? "" : "s"}</span>
                        {it.arquivos > 0 && <span className="inline-flex items-center gap-1"><Paperclip size={12} /> {it.arquivos}</span>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              {paginas > 1 && (
                <div className="mt-3 flex items-center justify-between text-[12.5px]">
                  <button type="button" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)} className="rounded-lg border border-[#3D2314]/15 bg-white px-3 py-1.5 disabled:opacity-40" data-testid="copiar-pagina-anterior">‹ Anterior</button>
                  <span className="text-[#3D2314]/60">Página {pagina} de {paginas}</span>
                  <button type="button" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)} className="rounded-lg border border-[#3D2314]/15 bg-white px-3 py-1.5 disabled:opacity-40" data-testid="copiar-pagina-proxima">Próxima ›</button>
                </div>
              )}
            </div>
          </section>

          {/* ── prévia + opções ── */}
          <section className={`${sel ? "flex" : "hidden lg:flex"} min-h-0 flex-col bg-white`}>
            {sel ? <Previa key={sel.id} empresa={empresa} job={sel} responsaveis={responsaveis} onCopiado={onCopiado} /> : (
              <div className="m-auto max-w-xs px-6 py-12 text-center text-[13px] text-[#3D2314]/55">
                <Sparkles size={22} className="mx-auto mb-2 text-[#C8941A]" />
                Escolha um job da lista para ver o briefing, as tarefas e o que vai para o job novo.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Previa({ empresa, job, responsaveis, onCopiado }: {
  empresa: string; job: ItemBusca
  responsaveis: Array<{ id: string; email: string | null; full_name?: string | null }>
  onCopiado: (r: ResultadoCopia) => void
}) {
  const [det, setDet] = useState<Detalhe | null>(null);
  const [op, setOp] = useState<OpcoesCopia>(OPCOES_PADRAO);
  const [cliente, setCliente] = useState<{ id: string | null; nome: string } | null>(null); // null = o do original
  const [titulo, setTitulo] = useState(job.titulo ?? "");
  const [prazo, setPrazo] = useState<string>("");
  const [prazoMexido, setPrazoMexido] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const hoje = diaEmSaoPaulo(new Date());

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [j, t] = await Promise.all([
        supabase.from("agency_jobs").select("descricao, arquivos, servico_id, agency_servico(prazo_dias_padrao)").eq("id", job.id).maybeSingle(),
        supabase.from("agency_tarefas").select("id, titulo, checklist, responsavel_id").eq("job_id", job.id).order("ordem").order("created_at"),
      ]);
      if (!vivo) return;
      const jd = (j.data ?? {}) as { descricao?: string | null; arquivos?: unknown; agency_servico?: { prazo_dias_padrao: number | null } | null };
      setDet({
        descricao: jd.descricao ?? null,
        arquivos: Array.isArray(jd.arquivos) ? (jd.arquivos as Detalhe["arquivos"]) : [],
        servico_prazo: jd.agency_servico?.prazo_dias_padrao ?? null,
        tarefas: (t.data ?? []) as Detalhe["tarefas"],
      });
    })();
    return () => { vivo = false; };
  }, [job.id]);

  // prazo: calculado (mesma regra do banco) até a pessoa trocar; trocado, vai como "informado"
  const origemPrazo = { data_inicio: job.data_inicio, data_prazo: job.data_prazo, criado_em: job.criado_em };
  const calculado = prazoDaCopia(origemPrazo, hoje, det?.servico_prazo ?? null);
  const previsto = prazoMexido && prazo ? prazoDaCopia(origemPrazo, hoje, null, prazo) : calculado;
  const prazoMostrado = prazoMexido ? prazo : (calculado.data_prazo ?? "");

  const nomeResp = (id: string | null) => {
    const u = responsaveis.find((x) => x.id === id);
    return u ? (u.full_name || u.email || "—") : null;
  };
  const { vai, naoVai } = oQueCopia(op);
  const briefing = textoPuro(det?.descricao);

  async function copiar() {
    if (prazoMexido && prazo && prazo < hoje) { setErro("O prazo do job novo não pode ser no passado."); return; }
    setOcupado(true); setErro(null);
    const { data, error } = await supabase.rpc("fn_pm_job_copiar", {
      p_job_id: job.id,
      p_opcoes: montarOpcoes({ ...op, cliente_id: cliente ? cliente.id : undefined, titulo, data_prazo: prazoMexido ? prazo || null : null }),
    });
    setOcupado(false);
    const r = (data ?? null) as ResultadoCopia | null;
    if (error || !r?.ok) { setErro(error?.message ?? r?.mensagem ?? "Não foi possível copiar."); return; }
    onCopiado(r);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="copiar-previa">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* job de origem */}
        <div>
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[15px] font-semibold leading-snug text-[#3D2314]">{job.titulo || "Sem título"}</h3>
            <span className="shrink-0 rounded-md bg-[#3D2314] px-2 py-0.5 font-mono text-[11.5px] text-[#C8941A]">{job.numero ?? "—"}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11.5px]">
            {job.cliente && <span className="rounded-full bg-[#FAEEDA] px-2 py-0.5 text-[#3D2314]">{job.cliente}</span>}
            {job.tipo && <span className="rounded-full bg-[#3D2314]/[0.06] px-2 py-0.5 text-[#3D2314]/80">{rotuloPeca(job.tipo)}</span>}
            <span className="rounded-full bg-[#3D2314]/[0.06] px-2 py-0.5 text-[#3D2314]/80">{rotuloSituacao(job.status)}</span>
            {(job.horas_estimadas ?? 0) > 0 && <span className="rounded-full bg-[#3D2314]/[0.06] px-2 py-0.5 text-[#3D2314]/80">{job.horas_estimadas}h estimadas</span>}
            {job.data_prazo && <span className="rounded-full bg-[#3D2314]/[0.06] px-2 py-0.5 text-[#3D2314]/80">prazo era {fmtData(job.data_prazo)}</span>}
          </div>
        </div>

        <div className="rounded-xl border border-[#3D2314]/10 bg-[#FAF7F2] p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#8A5A00]">Briefing</p>
          {!det ? <p className="text-[12.5px] text-[#3D2314]/50">Carregando…</p> : briefing
            ? <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#3D2314]/85" data-testid="copiar-previa-briefing">{briefing}</p>
            : <p className="text-[12.5px] text-[#3D2314]/50">Sem briefing.</p>}
        </div>

        {det && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[#3D2314]/10 p-3">
              <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[#8A5A00]"><ListChecks size={12} /> Tarefas ({det.tarefas.length})</p>
              {det.tarefas.length === 0 ? <p className="text-[12.5px] text-[#3D2314]/50">Sem tarefas.</p> : (
                <ol className="space-y-1 text-[12.5px] text-[#3D2314]/85" data-testid="copiar-previa-tarefas">
                  {det.tarefas.map((t, i) => (
                    <li key={t.id} className="flex justify-between gap-2">
                      <span>{i + 1}. {t.titulo}{Array.isArray(t.checklist) && t.checklist.length ? <span className="text-[#3D2314]/50"> · {t.checklist.length} itens</span> : null}</span>
                      {op.responsaveis && nomeResp(t.responsavel_id) && <span className="shrink-0 text-[11px] text-[#3D2314]/55">{nomeResp(t.responsavel_id)}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div className="rounded-xl border border-[#3D2314]/10 p-3">
              <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[#8A5A00]"><Paperclip size={12} /> Anexos ({det.arquivos.length})</p>
              {det.arquivos.length === 0 ? <p className="text-[12.5px] text-[#3D2314]/50">Sem anexos.</p> : (
                <ul className="space-y-0.5 text-[12.5px] text-[#3D2314]/85">{det.arquivos.slice(0, 6).map((a, i) => <li key={i} className="truncate">{a.nome || a.url || "arquivo"}</li>)}</ul>
              )}
            </div>
          </div>
        )}

        {/* job novo */}
        <div className="space-y-3 rounded-xl border border-[#C8941A]/40 bg-[#FFFCF5] p-3">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-[#8A5A00]">Job novo</p>
          <ClienteBusca empresa={empresa} rotulo="Cliente do job novo" ajuda="pm.copiar.cliente" testId="copiar-cliente"
            valorNome={cliente ? cliente.nome : (job.cliente ?? "")}
            onEscolher={(id, nome) => setCliente({ id, nome })}
            onLimpar={() => setCliente({ id: null, nome: "" })} />
          <label className="block">
            <span className={rot}>Título do job novo<AjudaCampo chave="pm.copiar.titulo" /></span>
            <input className={inp} value={titulo} onChange={(e) => setTitulo(e.target.value)} data-testid="copiar-titulo" />
          </label>
          <label className="block">
            <span className={rot}>Prazo do job novo<AjudaCampo chave="pm.copiar.prazo" /></span>
            <input type="date" className={inp} value={prazoMostrado} min={hoje} data-testid="copiar-prazo"
              onChange={(e) => { setPrazo(e.target.value); setPrazoMexido(true); }} />
            <span className="mt-1 block text-[11.5px] text-[#3D2314]/60" data-testid="copiar-prazo-regra" data-regra={previsto.regra}>{explicarPrazo(previsto)}</span>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2 text-[13px] text-[#3D2314]">
              <input type="checkbox" checked={op.responsaveis} onChange={(e) => setOp({ ...op, responsaveis: e.target.checked })} data-testid="copiar-op-responsaveis" className="h-4 w-4 accent-[#C8941A]" />
              Copiar responsáveis<AjudaCampo chave="pm.copiar.responsaveis" />
            </label>
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2 text-[13px] text-[#3D2314]">
              <input type="checkbox" checked={op.anexos} onChange={(e) => setOp({ ...op, anexos: e.target.checked })} data-testid="copiar-op-anexos" className="h-4 w-4 accent-[#C8941A]" />
              Copiar anexos<AjudaCampo chave="pm.copiar.anexos" />
            </label>
          </div>
          <div className="grid gap-2 text-[12px] sm:grid-cols-2" data-testid="copiar-o-que-vai">
            <div>
              <p className="mb-1 font-semibold text-[#1F5A1F]">Vai para o job novo</p>
              <ul className="space-y-0.5 text-[#3D2314]/80">{vai.map((v) => <li key={v}>✓ {v}</li>)}</ul>
            </div>
            <div>
              <p className="mb-1 font-semibold text-[#791F1F]">Não vai</p>
              <ul className="space-y-0.5 text-[#3D2314]/60">{naoVai.map((v) => <li key={v}>— {v}</li>)}</ul>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-[#3D2314]/10 bg-white px-4 py-3">
        {erro && <p className="mb-2 rounded-lg bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#791F1F]" data-testid="copiar-erro">{erro}</p>}
        <button type="button" onClick={() => void copiar()} disabled={ocupado || !titulo.trim()} data-testid="copiar-confirmar"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#3D2314] px-4 py-3 text-[14px] font-semibold text-white shadow-md hover:bg-[#3D2314]/90 disabled:opacity-50">
          <Copy size={16} /> {ocupado ? "Copiando…" : "Copiar e criar o job"}
        </button>
      </div>
    </div>
  );
}

// "Jobs parecidos (N)" — embaixo do título do Novo Job
export function JobsParecidos({ empresa, titulo, onAbrir }: { empresa: string; titulo: string; onAbrir: (jobId: string) => void }) {
  const [res, setRes] = useState<{ total: number; itens: Array<{ id: string; numero: string | null; titulo: string | null; cliente: string | null; status: string | null; semelhanca: number }> } | null>(null);
  const [aberto, setAberto] = useState(false);
  const seq = useRef(0);

  const ativo = !!empresa && tituloBuscavel(titulo);

  useEffect(() => {
    const minha = ++seq.current;
    if (!ativo) return;
    const t = setTimeout(() => {
      void supabase.rpc("fn_pm_jobs_parecidos", { p_company_id: empresa, p_titulo: titulo, p_limite: 5 }).then(({ data }) => {
        if (minha === seq.current) setRes((data as typeof res) ?? null);
      });
    }, 400);
    return () => clearTimeout(t);
  }, [ativo, empresa, titulo]);

  if (!ativo || !res || res.total === 0) return null;
  return (
    <div className="mt-1 rounded-xl border border-[#C8941A]/40 bg-[#FFFCF5] px-3 py-2" data-testid="jobs-parecidos">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => setAberto(!aberto)} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#3D2314]" data-testid="jobs-parecidos-abrir">
          <Sparkles size={13} className="text-[#C8941A]" /> Jobs parecidos ({res.total}) {aberto ? "▾" : "▸"}
        </button>
        <AjudaCampo chave="pm.job.parecidos" />
      </div>
      {aberto && (
        <ul className="mt-1.5 space-y-1">
          {res.itens.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5 text-[12.5px]">
              <span className="min-w-0 truncate text-[#3D2314]"><span className="font-mono text-[11px] text-[#3D2314]/55">{it.numero}</span> {it.titulo}{it.cliente ? <span className="text-[#3D2314]/55"> · {it.cliente}</span> : null}</span>
              <button type="button" onClick={() => onAbrir(it.id)} className="shrink-0 rounded-md border border-[#C8941A] px-2 py-1 text-[11.5px] font-medium text-[#3D2314] hover:bg-[#FAEEDA]" data-testid="jobs-parecidos-copiar">Copiar este</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
