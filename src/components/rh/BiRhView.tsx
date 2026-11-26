// src/app/dashboard/industrial/rh/bi/page.tsx
// Indústria · RH — BI de RH (CEO 25/11). Reusa PainelGente (horas), QuadroView (quadro×real + turnover) e
// CustoFolhaSetor (custo da folha). Novos: infrações agregadas (fn_rh_bi_infracoes; nominal restrito e registrado
// por fn_ponto_infracoes) e cobertura do cadastro de custo (fn_rh_bi_cobertura_cadastro). RD-95: "?" em cada filtro.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, AlertTriangle, Users, Clock, ClipboardList, Wallet, Lock } from "lucide-react";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { supabase } from "@/lib/supabase";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { erroAmigavel } from "@/lib/erroAmigavel";
import PainelGente from "@/components/inteligencia/PainelGente";
import { QuadroView } from "@/components/produtividade/QuadroView";
import CustoFolhaSetor from "@/components/inteligencia/CustoFolhaSetor";

type Tipo = { tipo: string; titulo: string; base_legal: string; gravidade: string; n: number };
type BiInfra = {
  pode_nominal: boolean; total: number; headcount: number; taxa_por_100: number | null;
  por_tipo: Tipo[]; por_gravidade: { gravidade: string; n: number }[];
  top_setores: { setor: string; n: number }[]; por_dia: { data: string; n: number }[];
};
type Cobertura = { total_ativas: number; total_conferidas: number; pct_geral: number; por_setor: { setor: string; ativas: number; conferidas: number; pct: number }[] };
type Nominal = { cpf: string; nome: string | null; data: string; tipo: string; titulo: string; descricao: string; gravidade: string };

const inp = "border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[13px] bg-white";
const btnSec = "px-2.5 py-1.5 rounded-md border border-[#3D2314]/15 text-[12.5px] hover:bg-[#3D2314]/5";
const brl = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const hojeBR = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const primeiroDoMes = (d: string) => d.slice(0, 8) + "01";
const corGrav = (g: string) => (g === "alta" ? "#B3261E" : g === "media" ? "#C8941A" : "#64748b");

function Campo({ rotulo, ajuda, children }: { rotulo: React.ReactNode; ajuda: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-[12px]"><span className="text-[#3D2314]/70">{rotulo}<AjudaCampo chave={ajuda} /></span>{children}</label>;
}

export function BiRhView() {
  const { sel } = useCompanyIds();
  const companyId = sel && !sel.startsWith("group_") && sel !== "consolidado" ? sel : null;
  const hoje = hojeBR();
  const [di, setDi] = useState(primeiroDoMes(hoje));
  const [df, setDf] = useState(hoje);
  const [setor, setSetor] = useState("");
  const [infra, setInfra] = useState<BiInfra | null>(null);
  const [cobertura, setCobertura] = useState<Cobertura | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tipoAberto, setTipoAberto] = useState<string | null>(null);
  const [nominal, setNominal] = useState<Nominal[] | null>(null);

  const atalho = (quais: "atual" | "anterior" | "tri") => {
    const base = new Date(hoje + "T00:00:00");
    if (quais === "atual") { setDi(primeiroDoMes(hoje)); setDf(hoje); }
    else if (quais === "anterior") { const m = new Date(base.getFullYear(), base.getMonth() - 1, 1); const fim = new Date(base.getFullYear(), base.getMonth(), 0); setDi(m.toISOString().slice(0, 10)); setDf(fim.toISOString().slice(0, 10)); }
    else { const m = new Date(base.getFullYear(), base.getMonth() - 2, 1); setDi(m.toISOString().slice(0, 10)); setDf(hoje); }
  };

  const carregar = useCallback(async () => {
    if (!companyId) return;
    setErro(null); setTipoAberto(null); setNominal(null);
    const [a, b] = await Promise.all([
      supabase.rpc("fn_rh_bi_infracoes", { p_company_id: companyId, p_data_ini: di, p_data_fim: df, p_departamento: setor || null }),
      supabase.rpc("fn_rh_bi_cobertura_cadastro", { p_company_id: companyId }),
    ]);
    if (a.error) { setErro(erroAmigavel(a.error, "Não foi possível carregar as infrações.")); } else setInfra(a.data as BiInfra);
    if (!b.error) setCobertura(b.data as Cobertura);
  }, [companyId, di, df, setor]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- recarrega ao trocar filtro
  useEffect(() => { void carregar(); }, [carregar]);

  const abrirTipo = async (tipo: string) => {
    if (!companyId || !infra?.pode_nominal) return;
    if (tipoAberto === tipo) { setTipoAberto(null); return; }
    setTipoAberto(tipo);
    const { data, error } = await supabase.rpc("fn_ponto_infracoes", { p_company_id: companyId, p_data_ini: di, p_data_fim: df, p_departamento: setor || null, p_cpf: null });
    if (error) { setErro(erroAmigavel(error, "Lista nominal restrita.")); setNominal([]); return; }
    setNominal((data as Nominal[]).filter((r) => r.tipo === tipo));
  };

  const setores = useMemo(() => (cobertura?.por_setor ?? []).map((s) => s.setor).filter((s) => s !== "(sem setor)"), [cobertura]);
  const maxDia = Math.max(1, ...(infra?.por_dia ?? []).map((d) => d.n));

  if (!companyId) return <div className="p-6 text-[13px] text-[#3D2314]/70">Escolha uma empresa no seletor para ver o BI de RH.</div>;

  return (
    <div className="p-4 md:p-6 space-y-5 text-[#3D2314]" data-testid="rh-bi-page">
      <header>
        <h1 className="text-2xl font-medium flex items-center gap-2"><BarChart3 size={22} /> BI de RH</h1>
        <p className="text-sm text-[#3D2314]/60">Horas, infrações de ponto, quadro, custo da folha, turnover e cobertura do cadastro — da operação industrial.</p>
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-[#3D2314]/10 bg-[#FAF7F2] px-3 py-2" data-testid="rh-bi-filtros">
        <Campo rotulo="De" ajuda="industrial.rh_bi.filtro_de"><input type="date" className={inp} value={di} max={df} onChange={(e) => setDi(e.target.value)} data-testid="rh-bi-de" /></Campo>
        <Campo rotulo="Até" ajuda="industrial.rh_bi.filtro_ate"><input type="date" className={inp} value={df} min={di} onChange={(e) => setDf(e.target.value)} data-testid="rh-bi-ate" /></Campo>
        <div className="flex flex-col gap-1 text-[12px]">
          <span className="text-[#3D2314]/70">Atalhos<AjudaCampo chave="industrial.rh_bi.filtro_atalho" /></span>
          <div className="flex gap-1">
            <button className={btnSec} onClick={() => atalho("atual")} data-testid="rh-bi-mes-atual">Mês atual</button>
            <button className={btnSec} onClick={() => atalho("anterior")} data-testid="rh-bi-mes-anterior">Mês anterior</button>
            <button className={btnSec} onClick={() => atalho("tri")} data-testid="rh-bi-3-meses">3 meses</button>
          </div>
        </div>
        <Campo rotulo="Setor" ajuda="industrial.rh_bi.filtro_setor">
          <select className={inp + " min-w-[180px]"} value={setor} onChange={(e) => setSetor(e.target.value)} data-testid="rh-bi-setor">
            <option value="">Todos os setores</option>
            {setores.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Campo>
      </div>

      {erro && <div className="rounded-md bg-[#F7E1E1] text-[#791F1F] px-3 py-2 text-[12.5px]" data-testid="rh-bi-erro">{erro}</div>}

      {/* a) Horas — reusa PainelGente */}
      <section data-testid="rh-bi-horas">
        <h2 className="text-[15px] font-medium flex items-center gap-1.5 mb-2"><Clock size={16} /> Horas, extras e atrasos</h2>
        <PainelGente companyId={companyId} dataIni={di} dataFim={df} setoresPermitidos={null} />
      </section>

      {/* b) Infrações */}
      <section data-testid="rh-bi-infracoes">
        <h2 className="text-[15px] font-medium flex items-center gap-1.5 mb-2"><AlertTriangle size={16} /> Infrações de ponto</h2>
        {!infra ? <div className="text-[12.5px] text-[#3D2314]/60" role="status">Carregando infrações…</div>
          : infra.total === 0 ? <div className="rounded-md border border-[#3D2314]/10 bg-[#FAF7F2] px-3 py-4 text-[12.5px] text-[#3D2314]/60" data-testid="rh-bi-infracoes-vazio">Sem infrações no período e filtro atuais.</div>
          : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <div className="rounded-md border border-[#3D2314]/10 bg-white px-3 py-2"><div className="text-[11px] text-[#3D2314]/60">Total no período</div><div className="text-xl font-semibold tabular-nums" data-testid="rh-bi-infra-total">{infra.total}</div></div>
              <div className="rounded-md border border-[#3D2314]/10 bg-white px-3 py-2"><div className="text-[11px] text-[#3D2314]/60">Taxa por 100 pessoas</div><div className="text-xl font-semibold tabular-nums">{infra.taxa_por_100 == null ? "—" : infra.taxa_por_100.toLocaleString("pt-BR")}</div></div>
              {infra.por_gravidade.map((g) => <div key={g.gravidade} className="rounded-md border border-[#3D2314]/10 bg-white px-3 py-2"><div className="text-[11px] capitalize" style={{ color: corGrav(g.gravidade) }}>{g.gravidade}</div><div className="text-xl font-semibold tabular-nums">{g.n}</div></div>)}
            </div>
            {!infra.pode_nominal && <div className="flex items-center gap-1.5 text-[11.5px] text-[#3D2314]/60"><Lock size={12} /> A lista com os nomes é restrita (PS, dono e RH) — você vê os totais. <AjudaCampo chave="industrial.rh_bi.infracoes_tipo" /></div>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {infra.por_tipo.map((t) => (
                <div key={t.tipo} className="rounded-md border border-[#3D2314]/12 bg-white">
                  <button className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 disabled:cursor-default" disabled={!infra.pode_nominal} data-testid={`rh-bi-tipo-${t.tipo}`} onClick={() => void abrirTipo(t.tipo)}>
                    <span><span className="font-medium">{t.titulo}</span><span className="block text-[11px] text-[#3D2314]/55">{t.base_legal} · <span className="capitalize" style={{ color: corGrav(t.gravidade) }}>{t.gravidade}</span></span></span>
                    <span className="flex items-center gap-2"><b className="tabular-nums">{t.n}</b>{infra.pode_nominal && <span className="text-[11px] text-[#C8941A]">{tipoAberto === t.tipo ? "ocultar" : "ver nomes"}</span>}</span>
                  </button>
                  {tipoAberto === t.tipo && infra.pode_nominal && (
                    <div className="border-t border-[#3D2314]/10 max-h-[260px] overflow-auto" data-testid="rh-bi-nominal">
                      {nominal == null ? <div className="px-3 py-2 text-[12px] text-[#3D2314]/60">Carregando…</div>
                        : nominal.length === 0 ? <div className="px-3 py-2 text-[12px] text-[#3D2314]/60">Nenhum caso deste tipo.</div>
                        : <table className="w-full text-[12px]"><tbody>{nominal.map((r, i) => (
                            <tr key={i} className="border-b border-[#3D2314]/5"><td className="px-3 py-1.5">{r.nome ?? r.cpf}</td><td className="px-2 tabular-nums">{new Date(r.data + "T00:00:00").toLocaleDateString("pt-BR")}</td><td className="px-2 text-[#3D2314]/70">{r.descricao}</td></tr>
                          ))}</tbody></table>}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {infra.top_setores.length > 0 && (
              <div className="rounded-md border border-[#3D2314]/10 bg-white px-3 py-2">
                <div className="text-[11px] text-[#3D2314]/60 mb-1">Top setores</div>
                {infra.top_setores.map((s) => <div key={s.setor} className="flex items-center justify-between text-[12.5px] py-0.5"><span>{s.setor}</span><b className="tabular-nums">{s.n}</b></div>)}
              </div>
            )}
            {infra.por_dia.length > 0 && (
              <div className="rounded-md border border-[#3D2314]/10 bg-white px-3 py-2">
                <div className="text-[11px] text-[#3D2314]/60 mb-1">Por dia</div>
                <div className="flex items-end gap-0.5 h-16">
                  {infra.por_dia.map((d) => <div key={d.data} title={`${new Date(d.data + "T00:00:00").toLocaleDateString("pt-BR")}: ${d.n}`} className="flex-1 bg-[#C8941A]/70 rounded-t" style={{ height: `${Math.max(6, (d.n / maxDia) * 100)}%` }} />)}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* c) Quadro — reusa QuadroView */}
      <section data-testid="rh-bi-quadro">
        <h2 className="text-[15px] font-medium flex items-center gap-1.5 mb-2"><ClipboardList size={16} /> Quadro projetado × real e turnover</h2>
        <QuadroView companyId={companyId} />
      </section>

      {/* d) Custo da folha — reusa CustoFolhaSetor */}
      <section data-testid="rh-bi-custo">
        <h2 className="text-[15px] font-medium flex items-center gap-1.5 mb-2"><Wallet size={16} /> Custo da folha por setor</h2>
        <CustoFolhaSetor companyId={companyId} />
      </section>

      {/* e) Cobertura do cadastro */}
      <section data-testid="rh-bi-cobertura">
        <h2 className="text-[15px] font-medium flex items-center gap-1.5 mb-2"><Users size={16} /> Cobertura do cadastro de custo<AjudaCampo chave="industrial.rh_bi.cobertura" /></h2>
        {!cobertura ? <div className="text-[12.5px] text-[#3D2314]/60" role="status">Carregando…</div> : (
          <div className="rounded-md border border-[#3D2314]/10 bg-white">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#3D2314]/10 text-[12.5px]">
              <span><b className="tabular-nums">{cobertura.total_conferidas}</b> de <b className="tabular-nums">{cobertura.total_ativas}</b> pessoas ativas com ficha conferida ({cobertura.pct_geral}%)</span>
              <Link href="/dashboard/industrial/rh/pessoas" className="text-[12px] underline text-[#C8941A]" data-testid="rh-bi-link-pessoas">Cadastrar custo</Link>
            </div>
            <div className="max-h-[320px] overflow-auto">
              <table className="w-full text-[12.5px]"><tbody>
                {cobertura.por_setor.map((s) => (
                  <tr key={s.setor} className="border-b border-[#3D2314]/5">
                    <td className="px-3 py-1.5">{s.setor}</td>
                    <td className="px-2 text-right tabular-nums w-[120px]">{s.conferidas}/{s.ativas}</td>
                    <td className="px-2 w-[160px]"><div className="h-2 rounded bg-[#3D2314]/8"><div className="h-2 rounded bg-[#C8941A]" style={{ width: `${s.pct}%` }} /></div></td>
                    <td className="px-2 text-right tabular-nums w-[52px]">{s.pct}%</td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
