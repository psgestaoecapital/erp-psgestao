"use client";
// PM-T (1) · botão ▶ do cartão de job: 1 toque inicia (e pausa o job anterior); ■ no job ativo para.
import { useCallback, useEffect, useState } from "react";
import { Play, Square } from "lucide-react";
import { EVENTO_CRONOMETRO, iniciarCronometro, lerCronometroAberto, pararCronometro, type CronometroAberto } from "@/lib/pm/cronometroGlobal";

export function useCronometroAberto(userId: string | null) {
  const [aberto, setAberto] = useState<CronometroAberto | null>(null);
  const recarregar = useCallback(async () => { if (userId) setAberto(await lerCronometroAberto(userId)); }, [userId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza com o cronômetro aberto desta pessoa
  useEffect(() => { void recarregar(); window.addEventListener(EVENTO_CRONOMETRO, recarregar); return () => window.removeEventListener(EVENTO_CRONOMETRO, recarregar); }, [recarregar]);
  return aberto;
}

export function BotaoPlay({ empresa, userId, jobId, rotulo }: { empresa: string; userId: string | null; jobId: string; rotulo?: string }) {
  const aberto = useCronometroAberto(userId);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const ativo = aberto?.job_id === jobId;
  async function alternar() {
    if (!userId || ocupado) return;
    setOcupado(true); setErro(null);
    const r = ativo && aberto ? await pararCronometro(aberto) : await iniciarCronometro(empresa, userId, jobId);
    setOcupado(false);
    if (r.erro) setErro(r.erro);
  }
  if (!userId) return null;
  const txt = ativo ? "parar o cronômetro" : "iniciar o cronômetro neste job";
  return (
    <button type="button" onClick={() => void alternar()} disabled={ocupado} title={erro ?? txt} aria-label={`${txt}${rotulo ? ` ${rotulo}` : ""}`} data-testid={`btn-play-${jobId}`} data-ativo={ativo ? "1" : "0"}
      className={`print:hidden inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[#3D2314] disabled:opacity-50 md:h-7 md:w-7 ${ativo ? "border-[#C8941A] bg-[#C8941A]" : erro ? "border-[#791F1F] bg-[#F7E1E1]" : "border-[#3D2314]/20 bg-white hover:bg-[#C8941A]/20"}`}>
      {ativo ? <Square size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
    </button>
  );
}
