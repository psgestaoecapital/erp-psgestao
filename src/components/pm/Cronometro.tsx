"use client";
// PM-D · cronômetro que sobrevive ao recarregar e ao trocar de aparelho: a linha do agency_timesheet com fim_em vazio
// É o cronômetro (o banco só deixa 1 aberto por pessoa). Parar grava as horas; trocar de job para o anterior antes.
// Usado no Meu Dia (escolhe o job) e no job aberto da Pauta (job fixo).

import { useCallback, useEffect, useState } from "react";
import { Play, Square, Timer } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { horasDoCronometro, horasTexto, relogio } from "@/lib/pm/meuDia";
import { EVENTO_CRONOMETRO, avisarCronometro } from "@/lib/pm/cronometroGlobal";

type Aberto = { id: string; job_id: string | null; inicio_em: string };
export type JobCurto = { id: string; codigo: string; titulo: string | null };

export function Cronometro({ empresa, userId, jobs, jobFixo, onMudou }: {
  empresa: string; userId: string; jobs?: JobCurto[]; jobFixo?: JobCurto; onMudou?: () => void;
}) {
  const [aberto, setAberto] = useState<Aberto | null>(null);
  const [nomeJob, setNomeJob] = useState<string>("");
  const [jobSel, setJobSel] = useState("");
  const [agora, setAgora] = useState(() => Date.now());
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("agency_timesheet").select("id, job_id, inicio_em").eq("user_id", userId).is("fim_em", null).maybeSingle();
    const a = (data as Aberto | null) ?? null;
    setAberto(a);
    if (a?.job_id) {
      const { data: j } = await supabase.from("agency_jobs").select("numero, titulo, rodada_ajuste").eq("id", a.job_id).maybeSingle();
      const jj = j as { numero: string; titulo: string | null; rodada_ajuste: number } | null;
      setNomeJob(jj ? `${jj.numero}${jj.rodada_ajuste > 0 ? String.fromCharCode(64 + Math.min(jj.rodada_ajuste, 26)) : ""} · ${jj.titulo ?? ""}` : "");
    } else setNomeJob("");
  }, [userId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- busca o cronômetro aberto desta pessoa
  useEffect(() => { void carregar(); window.addEventListener(EVENTO_CRONOMETRO, carregar); return () => window.removeEventListener(EVENTO_CRONOMETRO, carregar); }, [carregar]);
  useEffect(() => {
    if (!aberto) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [aberto]);

  async function parar(silencioso = false) {
    if (!aberto) return true;
    setOcupado(true);
    const fim = new Date();
    const horas = horasDoCronometro(aberto.inicio_em, fim);
    const { error } = await supabase.from("agency_timesheet").update({ fim_em: fim.toISOString(), horas }).eq("id", aberto.id);
    setOcupado(false);
    if (error) { setMsg(`Não foi possível parar: ${error.message}`); return false; }
    if (!silencioso) setMsg(`Parado — ${horasTexto(horas)} apontadas.`);
    setAberto(null);
    avisarCronometro();
    onMudou?.();
    return true;
  }
  async function iniciar() {
    const job = jobFixo?.id ?? jobSel;
    if (!job) { setMsg("Escolha o job."); return; }
    if (aberto && !(await parar(true))) return;
    setOcupado(true);
    const { data: eq } = await supabase.from("agency_equipe").select("custo_hora").eq("company_id", empresa).eq("user_id", userId).maybeSingle();
    const ini = new Date();
    const { error } = await supabase.from("agency_timesheet").insert({
      company_id: empresa, job_id: job, user_id: userId, data: ini.toISOString().slice(0, 10), horas: 0,
      inicio_em: ini.toISOString(), custo_hora: (eq as { custo_hora: number | null } | null)?.custo_hora ?? null, descricao: "cronômetro",
    });
    setOcupado(false);
    if (error) { setMsg(`Não foi possível iniciar: ${error.message}`); return; }
    setMsg(null); setAgora(Date.now());
    await carregar();
    avisarCronometro();
    onMudou?.();
  }

  const segundos = aberto ? (agora - new Date(aberto.inicio_em).getTime()) / 1000 : 0;
  const nesteJob = !!aberto && !!jobFixo && aberto.job_id === jobFixo.id;
  return (
    <div className="rounded-xl border border-[#3D2314]/10 bg-gradient-to-br from-[#3D2314] to-[#5A3620] p-3 text-white" data-testid="cronometro">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-white/60"><Timer size={12} /> Cronômetro</div>
          <div className="font-mono text-[26px] leading-tight tabular-nums" data-testid="cronometro-tempo">{relogio(segundos)}</div>
          <div className="truncate text-[12px] text-white/70" data-testid="cronometro-job">{aberto ? (nomeJob || "job") : "parado"}</div>
        </div>
        {aberto && (!jobFixo || nesteJob)
          ? <button className="inline-flex items-center gap-1.5 rounded-lg bg-[#C8941A] px-3 py-2 text-[13px] font-medium text-[#3D2314] disabled:opacity-50" disabled={ocupado} onClick={() => void parar()} data-testid="cronometro-parar"><Square size={14} /> Parar</button>
          : <button className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-[13px] font-medium text-[#3D2314] disabled:opacity-50" disabled={ocupado || (!jobFixo && !jobSel)} onClick={() => void iniciar()} data-testid="cronometro-iniciar"><Play size={14} /> {aberto ? "Trocar para este job" : "Iniciar"}</button>}
      </div>
      {!jobFixo && !aberto && (
        <label className="mt-2 block text-[11.5px] text-white/80">
          <span className="mb-1 flex items-center">Job<AjudaCampo chave="pm.dia.cronometro.job" /></span>
          <select className="w-full rounded-lg border-0 bg-white/95 px-2.5 py-2 text-[13px] text-[#3D2314]" value={jobSel} onChange={(e) => setJobSel(e.target.value)} data-testid="cronometro-job-select">
            <option value="">escolha o job…</option>
            {(jobs ?? []).map((j) => <option key={j.id} value={j.id}>{j.codigo} · {j.titulo}</option>)}
          </select>
        </label>
      )}
      {msg && <div className="mt-2 rounded-md bg-white/10 px-2 py-1 text-[12px]" data-testid="cronometro-msg">{msg}</div>}
    </div>
  );
}
