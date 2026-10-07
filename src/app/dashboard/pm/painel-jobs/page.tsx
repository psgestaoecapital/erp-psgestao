"use client";
// P&M · Painel de Jobs (PM-K, blueprint v8 tela 15): 6 indicadores, 8 gráficos, filtro de 13 campos, opções salvas
// por usuário, PDF/Excel e Insights com IA. Só leitura de jobs/rodadas/horas (RLS por empresa); nada é lançado.
// Job parado há mais de 180 dias e não concluído = "Encerrado (legado)", fora dos números (decisão CEO 05/10).

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Filter, Save, Trash2, FileDown, FileSpreadsheet, Sparkles } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";
import {
  CABECALHO_FLUXO, SITUACOES, contarFiltroPainel, filtrarJobs, graficos, indicadores, legado, limparFiltroPainel, linhaParaArray, linhasFluxo, resumoParaIA,
  type Barra, type FiltroPainel, type Hora, type JobPainel, type Nomes, type Rodada,
} from "@/lib/pm/painel";

type Nome = { id: string; nome: string };
type Opcao = { id: string; nome: string; filtros: FiltroPainel };
const CORES = ["#3D2314", "#C8941A", "#8a6a4f", "#b98b5e", "#5b7a6a", "#a35a4b", "#6b5444", "#d9b36a", "#4f6d8a", "#9aa59b"];
const cartao = "rounded-2xl border border-[#3D2314]/10 bg-white p-4";
const campo = "w-full rounded-lg border border-[#E7DED3] bg-white px-2 py-2 text-[13px] text-[#3D2314] min-h-[40px]";
const rotulo = "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[#3D2314]/60";
const fmt = (n: number | null, suf = "") => (n === null ? "—" : `${n.toLocaleString("pt-BR")}${suf}`);

function Multi({ valor, opcoes, onChange }: { valor?: string[]; opcoes: Nome[]; onChange: (v: string[]) => void }) {
  return (
    <select multiple className={campo + " h-[84px]"} value={valor ?? []} onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))}>
      {opcoes.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
    </select>
  );
}

function GraficoBarras({ titulo, dados, cor = "#3D2314" }: { titulo: string; dados: Barra[]; cor?: string }) {
  return (
    <div className={cartao}>
      <h3 className="mb-2 text-[13px] font-semibold text-[#3D2314]">{titulo}</h3>
      {dados.length === 0 ? <p className="py-8 text-center text-[12px] text-[#6b5444]">Sem dados no filtro.</p> : (
        <div style={{ height: Math.max(160, dados.length * 28 + 30) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dados} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E7DED3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="nome" width={120} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="valor" fill={cor} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default function PainelJobsPage() {
  const { selInfo, companyIds } = useCompanyIds();
  const empresa = selInfo.tipo === "empresa" && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null);
  const [jobs, setJobs] = useState<JobPainel[]>([]);
  const [rodadas, setRodadas] = useState<Rodada[]>([]);
  const [horas, setHoras] = useState<Hora[]>([]);
  const [nomes, setNomes] = useState<Nomes>({ clientes: {}, responsaveis: {}, servicos: {}, grupoDoCliente: {} });
  const [listas, setListas] = useState<{ clientes: Nome[]; grupos: Nome[]; campanhas: Nome[]; responsaveis: Nome[]; servicos: Nome[] }>({ clientes: [], grupos: [], campanhas: [], responsaveis: [], servicos: [] });
  const [opcoes, setOpcoes] = useState<Opcao[]>([]);
  const [rascunho, setRascunho] = useState<FiltroPainel>({});
  const [filtro, setFiltro] = useState<FiltroPainel>({});
  const [filtroAberto, setFiltroAberto] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [nomeOpcao, setNomeOpcao] = useState("");
  const [insights, setInsights] = useState<{ titulo: string; detalhe: string }[] | null>(null);
  const [avisoIA, setAvisoIA] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);

  const carregarOpcoes = useCallback(async () => {
    if (!empresa) return;
    const { data } = await supabase.from("agency_painel_opcao").select("id, nome, filtros").eq("company_id", empresa).is("excluido_em", null).order("criado_em");
    setOpcoes((data ?? []) as Opcao[]);
  }, [empresa]);

  useEffect(() => {
    if (!empresa) { setCarregando(false); return; }
    let vivo = true;
    setCarregando(true); setErro(null);
    void (async () => {
      const [j, r, h, cl, gr, ca, sv, eq] = await Promise.all([
        supabase.from("agency_jobs").select("id, numero, titulo, status, prioridade, cliente_id, campanha_id, responsavel_id, servico_id, tipo, data_inicio, data_prazo, data_entrega, created_at, updated_at, rodada_ajuste, horas_estimadas, horas_realizadas").eq("company_id", empresa).is("excluido_em", null).limit(5000),
        supabase.from("agency_job_rodadas").select("job_id, motivo").eq("company_id", empresa).limit(20000),
        supabase.from("agency_timesheet").select("user_id, cliente_id, horas").eq("company_id", empresa).limit(50000),
        supabase.from("agency_clientes").select("id, nome, nome_fantasia, grupo_id").eq("company_id", empresa).limit(2000),
        supabase.from("agency_grupos_clientes").select("id, nome").eq("company_id", empresa),
        supabase.from("agency_campanhas").select("id, nome").eq("company_id", empresa).is("excluido_em", null),
        supabase.from("agency_servico").select("id, nome").eq("company_id", empresa),
        supabase.rpc("fn_usuarios_da_empresa", { p_company_id: empresa }),
      ]);
      if (!vivo) return;
      if (j.error) { setErro(j.error.message); setCarregando(false); return; }
      const clientes = ((cl.data ?? []) as { id: string; nome: string; nome_fantasia: string | null; grupo_id: string | null }[]);
      const equipe = ((eq.data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((u) => ({ id: u.id, nome: u.full_name || u.email || "Usuário" }));
      const servicos = (sv.data ?? []) as Nome[];
      setJobs((j.data ?? []) as JobPainel[]);
      setRodadas((r.data ?? []) as Rodada[]);
      setHoras((h.data ?? []) as Hora[]);
      setNomes({
        clientes: Object.fromEntries(clientes.map((c) => [c.id, c.nome_fantasia || c.nome])),
        responsaveis: Object.fromEntries(equipe.map((u) => [u.id, u.nome])),
        servicos: Object.fromEntries(servicos.map((s) => [s.id, s.nome])),
        grupoDoCliente: Object.fromEntries(clientes.map((c) => [c.id, c.grupo_id])),
      });
      setListas({ clientes: clientes.map((c) => ({ id: c.id, nome: c.nome_fantasia || c.nome })), grupos: (gr.data ?? []) as Nome[], campanhas: (ca.data ?? []) as Nome[], responsaveis: equipe, servicos });
      setCarregando(false);
    })();
    void carregarOpcoes();
    return () => { vivo = false; };
  }, [empresa, carregarOpcoes]);

  const visiveis = useMemo(() => filtrarJobs(jobs, filtro, nomes), [jobs, filtro, nomes]);
  const ids = useMemo(() => new Set(visiveis.map((j) => j.id)), [visiveis]);
  const rodadasVis = useMemo(() => rodadas.filter((r) => ids.has(r.job_id)), [rodadas, ids]);
  const ind = useMemo(() => indicadores(visiveis, rodadasVis), [visiveis, rodadasVis]);
  const gr = useMemo(() => graficos(visiveis, rodadasVis, horas, nomes), [visiveis, rodadasVis, horas, nomes]);
  const fluxo = useMemo(() => linhasFluxo(visiveis, rodadasVis, nomes), [visiveis, rodadasVis, nomes]);
  const nLegado = useMemo(() => jobs.filter((j) => legado(j)).length, [jobs]);
  const nFiltros = contarFiltroPainel(filtro);

  const set = <K extends keyof FiltroPainel>(k: K, v: FiltroPainel[K]) => setRascunho((f) => ({ ...f, [k]: v }));
  const aplicar = () => { setFiltro(limparFiltroPainel(rascunho)); setInsights(null); };
  const limpar = () => { setRascunho({}); setFiltro({}); setInsights(null); };

  async function salvarOpcao() {
    const nome = nomeOpcao.trim();
    if (!empresa || !nome) return;
    const { error } = await supabase.from("agency_painel_opcao").insert({ company_id: empresa, nome, filtros: limparFiltroPainel(rascunho) });
    if (error) { setErro(error.message); return; }
    setNomeOpcao(""); await carregarOpcoes();
  }
  async function apagarOpcao(o: Opcao) {
    const { error } = await supabase.from("agency_painel_opcao").update({ excluido_em: new Date().toISOString() }).eq("id", o.id);
    if (error) setErro(error.message); else await carregarOpcoes();
  }
  async function excel() {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([CABECALHO_FLUXO, ...fluxo.map(linhaParaArray)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fluxo de trabalho");
    XLSX.writeFile(wb, `painel-de-jobs-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }
  async function gerarInsights() {
    if (!empresa) return;
    setGerando(true); setAvisoIA(null); setInsights(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/pm/painel/insights", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ companyId: empresa, resumo: resumoParaIA(ind, gr) }),
      });
      const j = await res.json();
      if (j.ok) setInsights(j.insights); else setAvisoIA(j.aviso || j.erro || "Não foi possível gerar agora.");
    } catch { setAvisoIA("Não foi possível gerar agora."); }
    setGerando(false);
  }

  if (!empresa) return <div className="p-8 text-[#6b5444]">Selecione uma empresa no topo.</div>;

  const cartoes: { r: string; v: string; d?: string }[] = [
    { r: "Total de jobs", v: fmt(ind.total) },
    { r: "Alterações", v: fmt(ind.alteracoes), d: `média ${fmt(ind.mediaAlteracoes)} por job` },
    { r: "Realizado / estimado", v: ind.realizadoSobreEstimado === null ? "—" : `${fmt(ind.realizadoSobreEstimado)}%`, d: `${fmt(ind.realizado)} h de ${fmt(ind.estimado)} h` },
    { r: "Dias da conclusão", v: fmt(ind.diasConclusao), d: "média dos concluídos" },
    { r: "Dias de atraso", v: fmt(ind.diasAtraso), d: "média dos abertos vencidos" },
    { r: "Média de alterações", v: fmt(ind.mediaAlteracoes), d: "por job" },
  ];

  return (
    <div className="min-h-screen bg-[#FAF7F2] px-4 py-6 text-[#3D2314] print:bg-white">
      <div className="mx-auto max-w-[1200px]">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-[#C8941A]">🏭 P&amp;M · Relatórios</div>
            <h1 className="flex items-center gap-2 text-[26px] font-bold"><BarChart3 size={24} /> Painel de Jobs</h1>
            <p className="text-[13px] text-[#6b5444]">{ind.total} jobs no filtro{nLegado > 0 && !filtro.incluir_legado ? ` · ${nLegado} encerrados (legado) fora dos números` : ""}</p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <button onClick={() => setFiltroAberto((v) => !v)} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#E7DED3] bg-white px-3 text-[13px]"><Filter size={14} /> Filtro{nFiltros ? ` (${nFiltros})` : ""}</button>
            <button onClick={excel} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#E7DED3] bg-white px-3 text-[13px]"><FileSpreadsheet size={14} /> Excel</button>
            <button onClick={() => window.print()} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#E7DED3] bg-white px-3 text-[13px]"><FileDown size={14} /> PDF</button>
            <button onClick={gerarInsights} disabled={gerando || ind.total === 0} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#3D2314] px-3 text-[13px] text-white disabled:opacity-50"><Sparkles size={14} /> {gerando ? "Analisando…" : "Insights com IA"}</button>
          </div>
        </header>

        {erro && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-800">{erro}</div>}

        {filtroAberto && (
          <section className={cartao + " mb-4 print:hidden"}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className={rotulo + " mb-0"}>Minhas opções:</span>
              {opcoes.length === 0 && <span className="text-[12px] text-[#6b5444]">nenhuma salva ainda</span>}
              {opcoes.map((o) => (
                <span key={o.id} className="inline-flex items-center gap-1 rounded-full border border-[#E7DED3] bg-[#FAF7F2] px-2 py-1 text-[12px]">
                  <button onClick={() => { setRascunho(o.filtros); setFiltro(limparFiltroPainel(o.filtros)); setInsights(null); }}>{o.nome}</button>
                  <button aria-label={`Apagar ${o.nome}`} onClick={() => apagarOpcao(o)}><Trash2 size={12} /></button>
                </span>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><label className={rotulo}>Cliente</label><Multi valor={rascunho.clientes} opcoes={listas.clientes} onChange={(v) => set("clientes", v)} /></div>
              <div><label className={rotulo}>Grupo de clientes</label><Multi valor={rascunho.grupos} opcoes={listas.grupos} onChange={(v) => set("grupos", v)} /></div>
              <div><label className={rotulo}>Campanha</label><Multi valor={rascunho.campanhas} opcoes={listas.campanhas} onChange={(v) => set("campanhas", v)} /></div>
              <div><label className={rotulo}>Responsável</label><Multi valor={rascunho.responsaveis} opcoes={listas.responsaveis} onChange={(v) => set("responsaveis", v)} /></div>
              <div><label className={rotulo}>Peça / serviço</label><Multi valor={rascunho.servicos} opcoes={listas.servicos} onChange={(v) => set("servicos", v)} /></div>
              <div><label className={rotulo}>Situação</label><Multi valor={rascunho.status} opcoes={SITUACOES.map((s) => ({ id: s.v, nome: s.l }))} onChange={(v) => set("status", v)} /></div>
              <div><label className={rotulo}>Prioridade</label><Multi valor={rascunho.prioridades} opcoes={["baixa", "media", "alta", "urgente"].map((p) => ({ id: p, nome: p }))} onChange={(v) => set("prioridades", v)} /></div>
              <div><label className={rotulo}>Título contém</label><input className={campo} value={rascunho.titulo ?? ""} onChange={(e) => set("titulo", e.target.value)} /></div>
              <div><label className={rotulo}>Código do job</label><input className={campo} value={rascunho.codigo ?? ""} onChange={(e) => set("codigo", e.target.value)} /></div>
              <div><label className={rotulo}>Data de</label>
                <select className={campo} value={rascunho.data_tipo ?? "prazo"} onChange={(e) => set("data_tipo", e.target.value as FiltroPainel["data_tipo"])}>
                  <option value="prazo">Prazo</option><option value="criacao">Criação</option><option value="entrega">Entrega</option>
                </select></div>
              <div><label className={rotulo}>De</label><input type="date" className={campo} value={rascunho.data_de ?? ""} onChange={(e) => set("data_de", e.target.value)} /></div>
              <div><label className={rotulo}>Até</label><input type="date" className={campo} value={rascunho.data_ate ?? ""} onChange={(e) => set("data_ate", e.target.value)} /></div>
              <div><label className={rotulo}>Atrasados</label>
                <select className={campo} value={rascunho.atrasados ?? ""} onChange={(e) => set("atrasados", (e.target.value || undefined) as FiltroPainel["atrasados"])}>
                  <option value="">Todos</option><option value="sim">Só atrasados</option><option value="nao">Sem atraso</option>
                </select></div>
            </div>
            <label className="mt-3 flex items-center gap-2 text-[12px] text-[#6b5444]"><input type="checkbox" checked={!!rascunho.incluir_legado} onChange={(e) => set("incluir_legado", e.target.checked)} /> Incluir encerrados (legado: parados há mais de 180 dias)</label>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button onClick={aplicar} className="min-h-[40px] rounded-lg bg-[#3D2314] px-4 text-[13px] text-white">Aplicar</button>
              <button onClick={limpar} className="min-h-[40px] rounded-lg border border-[#E7DED3] px-4 text-[13px]">Limpar</button>
              <input className={campo + " !w-48"} placeholder="Nome da opção" value={nomeOpcao} onChange={(e) => setNomeOpcao(e.target.value)} />
              <button onClick={salvarOpcao} disabled={!nomeOpcao.trim()} className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-[#E7DED3] px-3 text-[13px] disabled:opacity-50"><Save size={14} /> Salvar opção</button>
            </div>
          </section>
        )}

        {carregando ? <div className="py-16 text-center text-[#6b5444]">Carregando…</div> : (
          <>
            <section className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
              {cartoes.map((c) => (
                <div key={c.r} className={cartao}>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#3D2314]/60">{c.r}</div>
                  <div className="mt-1 text-[24px] font-bold">{c.v}</div>
                  {c.d && <div className="text-[11px] text-[#6b5444]">{c.d}</div>}
                </div>
              ))}
            </section>

            {(insights || avisoIA) && (
              <section className={cartao + " mb-4 border-[#C8941A]/40"}>
                <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold"><Sparkles size={14} /> Insights com IA</h2>
                {avisoIA && <p className="text-[13px] text-[#6b5444]">{avisoIA}</p>}
                <ul className="space-y-2">{insights?.map((i, n) => <li key={n} className="text-[13px]"><b>{i.titulo}.</b> {i.detalhe}</li>)}</ul>
                <p className="mt-2 text-[11px] text-[#6b5444]">A IA só comenta os números do painel; confira antes de agir.</p>
              </section>
            )}

            <section className="grid gap-3 lg:grid-cols-2">
              <GraficoBarras titulo="Peças (por serviço)" dados={gr.pecas} />
              <div className={cartao}>
                <h3 className="mb-2 text-[13px] font-semibold">Classificação (situação dos jobs)</h3>
                {gr.classificacao.length === 0 ? <p className="py-8 text-center text-[12px] text-[#6b5444]">Sem dados no filtro.</p> : (
                  <div style={{ height: 220 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart><Pie data={gr.classificacao} dataKey="valor" nameKey="nome" outerRadius={80} label={(p) => `${p.name}: ${p.value}`}>
                        {gr.classificacao.map((_, n) => <Cell key={n} fill={CORES[n % CORES.length]} />)}</Pie><Tooltip /></PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
              <GraficoBarras titulo="Motivos de alteração" dados={gr.motivos} cor="#C8941A" />
              <GraficoBarras titulo="Clientes com mais alterações" dados={gr.clientesAlteracoes} cor="#a35a4b" />
              <div className={cartao}>
                <h3 className="mb-2 text-[13px] font-semibold">Jobs × alterações por cliente</h3>
                {gr.dispersao.length === 0 ? <p className="py-8 text-center text-[12px] text-[#6b5444]">Sem dados no filtro.</p> : (
                  <div style={{ height: 240 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ left: 0, right: 16, top: 8 }}>
                        <CartesianGrid stroke="#E7DED3" />
                        <XAxis type="number" dataKey="jobs" name="Jobs" allowDecimals={false} tick={{ fontSize: 11 }} />
                        <YAxis type="number" dataKey="alteracoes" name="Alterações" allowDecimals={false} tick={{ fontSize: 11 }} />
                        <ZAxis range={[60, 60]} />
                        <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={(v, n) => [v as number, n as string]} labelFormatter={() => ""} />
                        <Scatter data={gr.dispersao} fill="#3D2314" />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
              <GraficoBarras titulo="Jobs por responsável" dados={gr.porResponsavel} />
              <GraficoBarras titulo="Horas por colaborador" dados={gr.horasColaborador} cor="#5b7a6a" />
              <GraficoBarras titulo="Horas por cliente" dados={gr.horasCliente} cor="#4f6d8a" />
            </section>

            <section className={cartao + " mt-4 overflow-x-auto"}>
              <h3 className="mb-2 text-[13px] font-semibold">Fluxo de trabalho</h3>
              {fluxo.length === 0 ? <p className="py-6 text-center text-[12px] text-[#6b5444]">Nenhum job no filtro.</p> : (
                <table className="w-full text-left text-[12px]">
                  <thead><tr className="text-[#6b5444]">{CABECALHO_FLUXO.map((h) => <th key={h} className="px-2 py-1 font-semibold">{h}</th>)}</tr></thead>
                  <tbody>
                    {fluxo.slice(0, 300).map((l) => (
                      <tr key={l.codigo + l.titulo} className="border-t border-[#E7DED3]">
                        {linhaParaArray(l).map((c, n) => <td key={n} className={"px-2 py-1 " + (n === 6 && Number(c) > 0 ? "font-semibold text-red-700" : "")}>{c}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {fluxo.length > 300 && <p className="mt-2 text-[11px] text-[#6b5444]">Mostrando 300 de {fluxo.length}; o Excel leva todos.</p>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
