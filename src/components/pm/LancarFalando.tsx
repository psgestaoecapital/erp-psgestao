"use client";
// PM-T (6) · lançar horas falando: dita a frase → sugestão (horas, job, descrição) → a pessoa confere e grava.
import { useMemo, useState } from "react";
import { Mic } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BotaoDitar } from "@/components/melhorias/BotaoDitar";
import { avisarCronometro } from "@/lib/pm/cronometroGlobal";
import { sugerirLancamento, type JobBusca } from "@/lib/pm/lancarFalando";

export function LancarFalando({ empresa, userId, jobs, onMudou }: { empresa: string; userId: string; jobs: JobBusca[]; onMudou?: () => void }) {
  const [texto, setTexto] = useState("");
  const [horas, setHoras] = useState("");
  const [jobId, setJobId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sug = useMemo(() => sugerirLancamento(texto, jobs), [texto, jobs]);
  const horasVal = horas !== "" ? Number(horas.replace(",", ".")) : sug.horas;
  const jobVal = jobId || sug.jobId || "";
  async function gravar() {
    if (!horasVal || horasVal <= 0 || horasVal > 24) { setMsg("Confira as horas."); return; }
    if (!jobVal) { setMsg("Escolha o job."); return; }
    setBusy(true);
    const fim = new Date(); const ini = new Date(fim.getTime() - horasVal * 3_600_000);
    const { error } = await supabase.from("agency_timesheet").insert({
      company_id: empresa, job_id: jobVal, user_id: userId,
      data: fim.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }),
      horas: horasVal, descricao: sug.descricao || null, inicio_em: ini.toISOString(), fim_em: fim.toISOString(),
    });
    setBusy(false);
    if (error) { setMsg(`Erro: ${error.message}`); return; }
    setMsg(`Lançado · ${horasVal} h`); setTexto(""); setHoras(""); setJobId(""); avisarCronometro(); onMudou?.();
  }
  return (
    <section className="rounded-xl border border-[#3D2314]/10 bg-white p-3" data-testid="lancar-falando">
      <div className="flex items-center justify-between text-[12.5px]">
        <span className="inline-flex items-center gap-1.5 font-semibold"><Mic size={14} className="text-[#C8941A]" /> Lançar falando</span>
        <BotaoDitar onTexto={(f) => setTexto((t) => (t ? `${t} ${f}` : f))} disabled={busy} />
      </div>
      <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} placeholder='Ex.: "duas horas e meia no job 0123, revisão do layout"'
        className="mt-2 w-full rounded-lg border border-[#3D2314]/15 p-2 text-[13px]" />
      {texto.trim() && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px]">
          <input value={horas !== "" ? horas : sug.horas != null ? String(sug.horas) : ""} onChange={(e) => setHoras(e.target.value)} inputMode="decimal" aria-label="Horas"
            className="w-20 rounded-lg border border-[#3D2314]/15 p-1.5" /> h
          <select value={jobVal} onChange={(e) => setJobId(e.target.value)} aria-label="Job" className="min-w-0 flex-1 rounded-lg border border-[#3D2314]/15 p-1.5">
            <option value="">Escolha o job…</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.codigo} {j.titulo ?? ""}</option>)}
          </select>
          <button type="button" onClick={() => void gravar()} disabled={busy} className="rounded-lg bg-[#3D2314] px-3 py-1.5 font-semibold text-white">Lançar</button>
        </div>
      )}
      {msg && <div className="mt-2 text-[12px] text-[#3D2314]/70" onClick={() => setMsg(null)}>{msg}</div>}
    </section>
  );
}
