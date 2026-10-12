"use client";
// PM-T (4b) · barra "horas de hoje" no Meu dia: apontado + cronômetro correndo, contra a meta do dia.
import { useCallback, useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { EVENTO_CRONOMETRO } from "@/lib/pm/cronometroGlobal";
import { horasTexto } from "@/lib/pm/meuDia";
import { horasDeHoje, percentualDoDia, META_DIA_HORAS, type LinhaHoras } from "@/lib/pm/horasHoje";

export function BarraHorasHoje({ empresa, userId }: { empresa: string; userId: string }) {
  const [linhas, setLinhas] = useState<LinhaHoras[]>([]);
  const [agora, setAgora] = useState(() => new Date());
  const carregar = useCallback(async () => {
    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const { data } = await supabase.from("agency_timesheet").select("horas, inicio_em, fim_em").eq("company_id", empresa).eq("user_id", userId).eq("data", hoje);
    setLinhas((data ?? []) as LinhaHoras[]);
  }, [empresa, userId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega as horas do dia
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    const aviso = () => { void carregar(); };
    window.addEventListener(EVENTO_CRONOMETRO, aviso);
    const t = setInterval(() => setAgora(new Date()), 30_000);
    return () => { window.removeEventListener(EVENTO_CRONOMETRO, aviso); clearInterval(t); };
  }, [carregar]);
  const h = horasDeHoje(linhas, agora);
  const pct = percentualDoDia(h);
  return (
    <section className="rounded-xl border border-[#3D2314]/10 bg-white p-3" data-testid="horas-hoje">
      <div className="flex items-center justify-between text-[12.5px]">
        <span className="inline-flex items-center gap-1.5 font-semibold"><Clock size={14} className="text-[#C8941A]" /> Horas de hoje</span>
        <span data-testid="horas-hoje-valor">{horasTexto(h)} de {META_DIA_HORAS} h</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#3D2314]/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-[#C8941A]" style={{ width: `${pct}%` }} />
      </div>
    </section>
  );
}
