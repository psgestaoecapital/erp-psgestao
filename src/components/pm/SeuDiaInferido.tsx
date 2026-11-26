"use client";
// P&M · tela 135 "Tempo medido SEM clique" (CEO 25/11, go-live da agência piloto) — slice 3a (leitura).
// Cartão do Meu dia que MOSTRA quanto tempo o sistema estimou em cada job pelo que a pessoa fez
// hoje (comentário, mudança de etapa/status, cronômetro) — sem a pessoa cronometrar. É a visão de
// "Seu dia / fechamento do dia": aqui a pessoa VÊ as horas já montadas. Confirmar/corrigir (gravar a
// hora) é a próxima fatia, sensível (slice 3b).
// Reaproveita a RPC somente-leitura fn_pm_dia_esforco_inferido (slice 2). Degrada em silêncio se a RPC
// ainda não estiver no ar (não quebra a tela). RD-95: o "?" explica o cartão.
import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";

type JobInferido = {
  job_id: string;
  numero: string | null;
  titulo: string | null;
  blocos: number;
  eventos: number;
  minutos: number;
  horas: number;
  origem: string;
  confianca: "alta" | "media" | "baixa";
};
type Resultado = { ok: boolean; total_horas_inferidas: number; teto_aplicado: boolean; jobs: JobInferido[] };

// badge de confiança/origem da hora (base do slice 4: medida pelo sistema / estimada / indício)
const CONF: Record<JobInferido["confianca"], { rotulo: string; bg: string; fg: string }> = {
  alta: { rotulo: "medida", bg: "#E4F0DC", fg: "#2F5A1F" },
  media: { rotulo: "estimada", bg: "#FAEEDA", fg: "#6B4A0E" },
  baixa: { rotulo: "indício", bg: "#EFEAE3", fg: "#3D2314" },
};

const horaBr = (h: number) =>
  h >= 1 ? `${h.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h`
         : `${Math.round(h * 60)} min`;

export function SeuDiaInferido({ empresa, userId }: { empresa: string; userId: string }) {
  const [res, setRes] = useState<Resultado | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error } = await supabase.rpc("fn_pm_dia_esforco_inferido", {
        p_company_id: empresa,
        p_user_id: userId,
        p_data: null,
        p_janela_min: 15,
        p_jornada_horas: 8,
      });
      if (!vivo) return;
      if (error) { setIndisponivel(true); return; }
      setRes((data ?? null) as Resultado | null);
    })();
    return () => { vivo = false; };
  }, [empresa, userId]);

  // RPC ainda não publicada: não mostra nada (não quebra o Meu dia).
  if (indisponivel) return null;

  const jobs = res?.jobs ?? [];
  const total = res?.total_horas_inferidas ?? 0;

  return (
    <section className="rounded-2xl border border-[#3D2314]/10 bg-white p-4 shadow-[0_1px_0_rgba(61,35,20,0.04)]" data-testid="dia-esforco-inferido">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-[#3D2314]/60">
          <Gauge size={14} /> Seu dia — tempo medido sem clique
          <AjudaCampo chave="pm.dia.esforco_inferido" />
        </div>
        {jobs.length > 0 && (
          <span className="shrink-0 rounded-md bg-[#3D2314]/8 px-2 py-0.5 text-[12px] font-semibold" data-testid="dia-esforco-total">
            {horaBr(total)} hoje
          </span>
        )}
      </div>

      {jobs.length === 0 ? (
        <div className="text-[12.5px] text-[#3D2314]/55" data-testid="dia-esforco-vazio">
          Conforme você trabalha nos jobs (comentário, etapa, cronômetro), o sistema estima aqui as horas do seu dia — sem você cronometrar.
        </div>
      ) : (
        <>
          <ul className="divide-y divide-[#3D2314]/6">
            {jobs.map((j) => {
              const c = CONF[j.confianca] ?? CONF.baixa;
              return (
                <li key={j.job_id} className="flex items-center gap-2 py-1.5 text-[13px]" data-testid="dia-esforco-job">
                  {j.numero && <span className="shrink-0 rounded-md bg-[#3D2314]/8 px-1.5 py-0.5 text-[12px] font-semibold">{j.numero}</span>}
                  <span className="min-w-0 flex-1 truncate">{j.titulo ?? "job"}</span>
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide" style={{ backgroundColor: c.bg, color: c.fg }} title={`${j.eventos} ação(ões) em ${j.blocos} bloco(s) · origem ${j.origem}`}>{c.rotulo}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{horaBr(j.horas)}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] text-[#3D2314]/50">
            Estimativa pelo que você fez no sistema{res?.teto_aplicado ? " (ajustada à sua jornada)" : ""}. Você confere e confirma no fechamento do dia.
          </p>
        </>
      )}
    </section>
  );
}
