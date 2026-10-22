"use client";
// P&M · Painel do gestor (PM-T 5): cobertura de apontamento da equipe, jobs sem horas e alerta de 80% do estimado.
// Só leitura (RLS por empresa); mostra horas, nunca custo.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { codigoPainel, hojeISO, type JobPainel } from "@/lib/pm/painel";
import { alertasEstimado, cobertura, janelaDias, jobsSemHoras, type HoraDia, type Pessoa } from "@/lib/pm/painelGestor";

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

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <header>
        <h1 className="text-xl font-bold text-[#3D2314]">Painel do gestor · Tempo</h1>
        <p className="text-[12px] text-[#6b5444]">Quem está apontando, jobs sem horas e jobs perto de estourar o estimado.</p>
      </header>
      {erro && <p role="alert" className="rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{erro}</p>}
      {carregando ? <p className="text-[13px] text-[#6b5444]">Carregando…</p> : (
        <>
          <section className={cartao} data-testid="cobertura">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[14px] font-semibold text-[#3D2314]">Cobertura de apontamento · {comApontamento} de {cob.length} pessoas</h2>
              <div className="flex gap-1">
                {JANELAS.map((w) => (
                  <button key={w.d} type="button" onClick={() => setDias(w.d)} className={`min-h-[40px] rounded-lg border px-3 text-[12px] ${dias === w.d ? "border-[#3D2314] bg-[#3D2314] text-white" : "border-[#E7DED3] text-[#3D2314]"}`}>{w.l}</button>
                ))}
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
            <h2 className="mb-2 text-[14px] font-semibold text-[#3D2314]">Jobs em andamento sem horas ({sem.length})</h2>
            {sem.length === 0 ? <p className="text-[12px] text-[#6b5444]">Todos os jobs em andamento têm horas.</p> : (
              <ul className="divide-y divide-[#E7DED3]">
                {sem.slice(0, 50).map((j) => (
                  <li key={j.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                    <Link href={`/dashboard/pm/painel-jobs?codigo=${encodeURIComponent(j.numero ?? "")}`} className="text-[#3D2314] underline">{codigoPainel(j)} · {j.titulo}</Link>
                    <span className="shrink-0 text-[#6b5444]">{nome(j.responsavel_id)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={cartao} data-testid="alerta-80">
            <h2 className="mb-2 text-[14px] font-semibold text-[#3D2314]">Alerta de 80% do estimado ({alertas.length})</h2>
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
