"use client";
// P&M · Painel do gestor (PM-T 5): cobertura de apontamento da equipe, jobs sem horas e alerta de 80% do estimado.
// Só leitura (RLS por empresa); mostra horas, nunca custo.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { codigoPainel, hojeISO, type JobPainel } from "@/lib/pm/painel";
import { alertasEstimado, cobertura, janelaDias, jobsSemHoras, type HoraDia, type Pessoa } from "@/lib/pm/painelGestor";
import AjudaCampo from "@/components/ajuda/AjudaCampo";

const ROTA = "/dashboard/pm/painel-gestor";

const cartao = "rounded-2xl border border-[#3D2314]/10 bg-white p-4";
const JANELAS = [{ d: 1, l: "Hoje" }, { d: 7, l: "7 dias" }, { d: 30, l: "30 dias" }];

export default function PainelGestorPage() {
  const { companyIds } = useCompanyIds();
  const empresa = companyIds[0] ?? null;
  const [jobs, setJobs] = useState<JobPainel[]>([]);
  const [horas, setHoras] = useState<HoraDia[]>([]);
  const [equipe, setEquipe] = useState<Pessoa[]>([]);
  const [dias, setDias] = useState(7);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [buscaSem, setBuscaSem] = useState("");
  const [respSem, setRespSem] = useState("");

  useEffect(() => {
    if (!empresa) { setCarregando(false); return; }
    let vivo = true;
    setCarregando(true); setErro(null);
    void (async () => {
      const desde = janelaDias(30).de;
      const [j, h, eq] = await Promise.all([
        supabase.from("agency_jobs").select("id, numero, titulo, status, prioridade, cliente_id, campanha_id, responsavel_id, servico_id, tipo, data_inicio, data_prazo, data_entrega, created_at, updated_at, rodada_ajuste, horas_estimadas, horas_realizadas").eq("company_id", empresa).is("excluido_em", null).limit(5000),
        supabase.from("agency_timesheet").select("user_id, data, horas").eq("company_id", empresa).gte("data", desde).limit(50000),
        supabase.rpc("fn_usuarios_da_empresa", { p_company_id: empresa }),
      ]);
      if (!vivo) return;
      if (j.error) { setErro(j.error.message); setCarregando(false); return; }
      setJobs((j.data ?? []) as JobPainel[]);
      setHoras((h.data ?? []) as HoraDia[]);
      setEquipe(((eq.data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((u) => ({ id: u.id, nome: u.full_name || u.email || "Usuário" })));
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [empresa]);

  const hoje = hojeISO();
  const cob = useMemo(() => { const w = janelaDias(dias, hoje); return cobertura(equipe, horas, w.de, w.ate); }, [equipe, horas, dias, hoje]);
  const sem = useMemo(() => jobsSemHoras(jobs, hoje), [jobs, hoje]);
  const alertas = useMemo(() => alertasEstimado(jobs, hoje), [jobs, hoje]);
  const nome = (id: string | null) => equipe.find((p) => p.id === id)?.nome ?? "—";
  const comApontamento = cob.filter((c) => !c.semApontar).length;

  // Filtro da lista "Jobs sem horas" (aud8: lista extensa sem filtro). O contador do título
  // continua mostrando o total real (sem.length); a lista exibida respeita busca + responsável.
  const respsSemHoras = useMemo(() => {
    const ids = Array.from(new Set(sem.map((j) => j.responsavel_id).filter((x): x is string => !!x)));
    return ids.map((id) => ({ id, nome: nome(id) })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [sem, equipe]);
  const semFiltrados = useMemo(() => {
    const q = buscaSem.trim().toLowerCase();
    return sem.filter((j) => {
      if (respSem && j.responsavel_id !== respSem) return false;
      if (!q) return true;
      const alvo = `${codigoPainel(j)} ${j.titulo ?? ""} ${j.numero ?? ""}`.toLowerCase();
      return alvo.includes(q);
    });
  }, [sem, buscaSem, respSem]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <header>
        <h1 className="text-xl font-bold text-[#3D2314]">Painel do gestor · Tempo<AjudaCampo chave="pm.painel_gestor.tela" rota={ROTA} /></h1>
        <p className="text-[12px] text-[#6b5444]">Quem está apontando, jobs sem horas e jobs perto de estourar o estimado.</p>
      </header>
      {erro && <p role="alert" className="rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{erro}</p>}
      {carregando ? <p className="text-[13px] text-[#6b5444]">Carregando…</p> : (
        <>
          <section className={cartao} data-testid="cobertura">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[14px] font-semibold text-[#3D2314]">Cobertura de apontamento · {comApontamento} de {cob.length} pessoas<AjudaCampo chave="pm.painel_gestor.cobertura" rota={ROTA} /></h2>
              <div className="flex items-center gap-1">
                {JANELAS.map((w) => (
                  <button key={w.d} type="button" onClick={() => setDias(w.d)} className={`min-h-[40px] rounded-lg border px-3 text-[12px] ${dias === w.d ? "border-[#3D2314] bg-[#3D2314] text-white" : "border-[#E7DED3] text-[#3D2314]"}`}>{w.l}</button>
                ))}
                <AjudaCampo chave="pm.painel_gestor.filtro_janela" rota={ROTA} />
              </div>
            </div>
            {cob.length === 0 ? <p className="text-[12px] text-[#6b5444]">Sem equipe cadastrada.</p> : (
              <ul className="divide-y divide-[#E7DED3]">
                {cob.map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-2 text-[13px]">
                    <span className="text-[#3D2314]">{c.nome}</span>
                    <span className={c.semApontar ? "font-semibold text-red-700" : "text-[#6b5444]"}>{c.semApontar ? "sem apontamento" : `${c.horas.toLocaleString("pt-BR")} h · ${c.dias} dia(s)`}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={cartao} data-testid="sem-horas">
            <h2 className="mb-2 text-[14px] font-semibold text-[#3D2314]">Jobs em andamento sem horas ({sem.length})<AjudaCampo chave="pm.painel_gestor.sem_horas" rota={ROTA} /></h2>
            {sem.length === 0 ? <p className="text-[12px] text-[#6b5444]">Todos os jobs em andamento têm horas.</p> : (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor="busca-sem-horas">Buscar job sem horas</label>
                  <input
                    id="busca-sem-horas"
                    type="search"
                    value={buscaSem}
                    onChange={(e) => setBuscaSem(e.target.value)}
                    placeholder="Buscar por código ou título…"
                    className="min-h-[40px] flex-1 rounded-lg border border-[#E7DED3] px-3 text-[13px] text-[#3D2314] placeholder:text-[#9a8a78]"
                  />
                  <label className="sr-only" htmlFor="resp-sem-horas">Responsável</label>
                  <select
                    id="resp-sem-horas"
                    value={respSem}
                    onChange={(e) => setRespSem(e.target.value)}
                    className="min-h-[40px] rounded-lg border border-[#E7DED3] px-2 text-[13px] text-[#3D2314]"
                  >
                    <option value="">Todos os responsáveis</option>
                    {respsSemHoras.map((p) => (<option key={p.id} value={p.id}>{p.nome}</option>))}
                  </select>
                  {(buscaSem || respSem) && (
                    <button type="button" onClick={() => { setBuscaSem(""); setRespSem(""); }} className="min-h-[40px] rounded-lg border border-[#E7DED3] px-3 text-[12px] text-[#3D2314]">Limpar</button>
                  )}
                  <AjudaCampo chave="pm.painel_gestor.filtro_sem_horas" rota={ROTA} />
                </div>
                {semFiltrados.length === 0 ? (
                  <p className="text-[12px] text-[#6b5444]">Nenhum job sem horas para esse filtro. <button type="button" onClick={() => { setBuscaSem(""); setRespSem(""); }} className="underline">Limpar filtro</button></p>
                ) : (
                  <ul className="divide-y divide-[#E7DED3]">
                    {semFiltrados.slice(0, 50).map((j) => (
                      <li key={j.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                        <Link href={`/dashboard/pm/painel-jobs?codigo=${encodeURIComponent(j.numero ?? "")}`} className="text-[#3D2314] underline">{codigoPainel(j)} · {j.titulo}</Link>
                        <span className="shrink-0 text-[#6b5444]">{nome(j.responsavel_id)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {semFiltrados.length > 50 && <p className="mt-2 text-[11px] text-[#9a8a78]">Mostrando os primeiros 50 de {semFiltrados.length}. Refine a busca para ver os demais.</p>}
              </>
            )}
          </section>
          <section className={cartao} data-testid="alerta-80">
            <h2 className="mb-2 text-[14px] font-semibold text-[#3D2314]">Alerta de 80% do estimado ({alertas.length})<AjudaCampo chave="pm.painel_gestor.alerta_80" rota={ROTA} /></h2>
            {alertas.length === 0 ? <p className="text-[12px] text-[#6b5444]">Nenhum job chegou a 80% do estimado.</p> : (
              <ul className="divide-y divide-[#E7DED3]">
                {alertas.slice(0, 50).map((a) => (
                  <li key={a.job.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                    <span className="text-[#3D2314]">{codigoPainel(a.job)} · {a.job.titulo}</span>
                    <span className={`shrink-0 font-semibold ${a.estourou ? "text-red-700" : "text-[#C8941A]"}`}>{a.pct}% · {a.job.horas_realizadas}/{a.job.horas_estimadas} h</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
