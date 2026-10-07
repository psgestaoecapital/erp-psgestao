"use client";
// PM-T (4d) · resumo de fim do dia no Meu dia: sugere apontar horas nos jobs em que a pessoa agiu hoje e não apontou.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Moon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { horaDoResumo, sugestoesDoDia } from "@/lib/pm/resumoFimDia";

export function ResumoFimDia({ empresa, userId }: { empresa: string; userId: string }) {
  const [jobs, setJobs] = useState<{ id: string; codigo: string; titulo: string }[]>([]);
  useEffect(() => {
    if (!horaDoResumo()) return;
    let vivo = true;
    (async () => {
      const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
      const desde = new Date(Date.now() - 24 * 3_600_000).toISOString();
      const [c, t] = await Promise.all([
        supabase.from("agency_job_comentarios").select("job_id, criado_em").eq("company_id", empresa).eq("autor_id", userId).is("excluido_em", null).gte("criado_em", desde),
        supabase.from("agency_timesheet").select("job_id").eq("company_id", empresa).eq("user_id", userId).eq("data", hoje),
      ]);
      const doDia = ((c.data ?? []) as { job_id: string; criado_em: string }[]).filter((x) => new Date(x.criado_em).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) === hoje);
      const ids = sugestoesDoDia(doDia, (t.data ?? []) as { job_id: string | null }[]);
      if (!ids.length) { if (vivo) setJobs([]); return; }
      const { data } = await supabase.from("agency_jobs").select("id, codigo, titulo").eq("company_id", empresa).in("id", ids);
      if (vivo) setJobs((data ?? []) as { id: string; codigo: string; titulo: string }[]);
    })();
    return () => { vivo = false; };
  }, [empresa, userId]);
  if (!jobs.length) return null;
  return (
    <section className="rounded-xl border border-[#C8941A]/40 bg-[#FBF3E0] p-3 text-[12.5px]" data-testid="resumo-fim-dia">
      <div className="inline-flex items-center gap-1.5 font-semibold"><Moon size={14} className="text-[#C8941A]" /> Fim do dia: você mexeu nestes jobs e não apontou horas</div>
      <ul className="mt-1.5 space-y-1">
        {jobs.map((j) => (
          <li key={j.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate"><b>{j.codigo}</b> {j.titulo}</span>
            <Link href={`/dashboard/pm/apontamento-horas?job=${j.id}`} className="shrink-0 rounded-md border border-[#3D2314]/15 bg-white px-2 py-1">apontar</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
