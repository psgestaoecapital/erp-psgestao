"use client";
// Briefing ligado ao job (agency_jobs.briefing_id · CEO 07/10 · Marciana): mostra o briefing ATUAL, formatado, dentro
// do job — o que for desenvolvido no briefing depois de "Virar job" aparece aqui. Leitura pela RLS da empresa.
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { BriefingTexto } from "@/components/pm/BriefingTexto";
import { briefingParaJob } from "@/lib/pm/briefing";

type B = { titulo: string; objetivo: string | null; publico_alvo: string | null; referencias: string | null; descricao: string | null; prazo_desejado: string | null };

export function BriefingLigado({ briefingId }: { briefingId: string }) {
  const [b, setB] = useState<B | null | "erro">(null);
  const [aberto, setAberto] = useState(true);
  useEffect(() => {
    let vivo = true;
    void supabase.from("agency_briefings").select("titulo, objetivo, publico_alvo, referencias, descricao, prazo_desejado").eq("id", briefingId).maybeSingle()
      .then(({ data, error }) => { if (vivo) setB(error || !data ? "erro" : (data as B)); });
    return () => { vivo = false; };
  }, [briefingId]);
  return (
    <div className="mt-3 rounded-xl border border-[#C8941A]/40 bg-[#FFFBF2] px-3 py-2.5" data-testid="job-briefing-ligado">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setAberto(!aberto)} className="text-[12px] font-semibold text-[#3D2314]">
          {aberto ? "▾" : "▸"} Briefing ligado{b && b !== "erro" ? ` · ${b.titulo}` : ""}
        </button>
        <Link href="/dashboard/pm/briefings" className="ml-auto text-[11.5px] text-[#8A6212] underline">abrir nos Briefings</Link>
      </div>
      {aberto && (
        <div className="mt-2">
          {b === null ? <p className="text-[12.5px] text-[#3D2314]/55">Carregando o briefing…</p>
            : b === "erro" ? <p className="text-[12.5px] text-[#8A2A1A]" data-testid="job-briefing-ligado-erro">Não foi possível abrir o briefing ligado a este job (apagado ou sem acesso).</p>
            : <BriefingTexto texto={briefingParaJob(b)} testid="job-briefing-ligado-texto" />}
        </div>
      )}
    </div>
  );
}
