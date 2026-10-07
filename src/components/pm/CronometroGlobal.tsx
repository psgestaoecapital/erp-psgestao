"use client";
// PM-T (1) · cronômetro global fixo no topo de toda tela da P&M: job ativo, tempo correndo e Parar em 1 toque.
// Só aparece com cronômetro ligado. Um ativo por pessoa (a linha aberta do timesheet).
import { useEffect, useState } from "react";
import Link from "next/link";
import { Square, Timer } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useUsuario } from "@/lib/AuthProvider";
import { relogio, horasTexto } from "@/lib/pm/meuDia";
import { pararCronometro } from "@/lib/pm/cronometroGlobal";
import { useCronometroAberto } from "@/components/pm/BotaoPlay";

export function CronometroGlobal() {
  const { userId } = useUsuario();
  const aberto = useCronometroAberto(userId);
  const [nome, setNome] = useState("");
  const [agora, setAgora] = useState(() => Date.now());
  const [msg, setMsg] = useState<string | null>(null);
  const jobId = aberto?.job_id ?? null;
  useEffect(() => {
    if (!aberto) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [aberto]);
  useEffect(() => {
    if (!jobId) return;
    let vivo = true;
    void supabase.from("agency_jobs").select("numero, titulo").eq("id", jobId).maybeSingle().then(({ data }) => {
      const j = data as { numero: string; titulo: string | null } | null;
      if (vivo) setNome(j ? `${j.numero} · ${j.titulo ?? ""}` : "");
    });
    return () => { vivo = false; };
  }, [jobId]);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 5000); return () => clearTimeout(t); }, [msg]);

  if (!aberto && !msg) return null;
  return (
    <div className="sticky top-0 z-30 flex items-center gap-3 bg-[#3D2314] px-3 py-1.5 text-white print:hidden" data-testid="cronometro-global">
      <Timer size={15} className="shrink-0 text-[#C8941A]" />
      {aberto ? (
        <>
          <span className="font-mono text-[15px] tabular-nums" data-testid="cronometro-global-tempo">{relogio((agora - new Date(aberto.inicio_em).getTime()) / 1000)}</span>
          <Link href={jobId ? `/dashboard/pm/pauta?job=${jobId}` : "/dashboard/pm/pauta"} className="min-w-0 flex-1 truncate text-[12.5px] text-white/85 hover:underline" data-testid="cronometro-global-job">{(jobId && nome) || "job"}</Link>
          <button type="button" className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[#C8941A] px-2.5 py-1 text-[12px] font-medium text-[#3D2314]" data-testid="cronometro-global-parar"
            onClick={async () => { const r = await pararCronometro(aberto); setMsg(r.erro ? `Não foi possível parar: ${r.erro}` : `Parado — ${horasTexto(r.horas ?? 0)} apontadas.`); }}><Square size={12} fill="currentColor" /> Parar</button>
        </>
      ) : <span className="text-[12.5px]" data-testid="cronometro-global-msg">{msg}</span>}
    </div>
  );
}
