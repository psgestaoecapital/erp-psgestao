"use client";
// PM-T (2) · confirmação de início/fim do cronômetro depois de mudar a situação do job.
import { useState } from "react";
import { iniciarCronometro, lerCronometroAberto, pararCronometro } from "@/lib/pm/cronometroGlobal";
import { textoSugestao, type SugestaoCronometro } from "@/lib/pm/cronometroAuto";

export function SugestaoCronometroAviso({ empresa, userId, jobId, sugestao, situacao, onFechar }: {
  empresa: string; userId: string; jobId: string; sugestao: Exclude<SugestaoCronometro, null>; situacao: string; onFechar: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function confirmar() {
    setOcupado(true); setErro(null);
    let r: { erro?: string } = {};
    if (sugestao === 'iniciar') r = await iniciarCronometro(empresa, userId, jobId);
    else { const a = await lerCronometroAberto(userId); if (a) r = await pararCronometro(a); }
    setOcupado(false);
    if (r.erro) setErro(r.erro); else onFechar();
  }
  return (
    <div role="alert" data-testid="cronometro-sugestao" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#C8941A]/40 bg-[#FAEEDA] px-3 py-2 text-[12.5px] text-[#6B4A0E]">
      <span className="flex-1">{erro ?? textoSugestao(sugestao, situacao)}</span>
      <button type="button" disabled={ocupado} onClick={() => void confirmar()} data-testid="cronometro-sugestao-sim" className="rounded-lg bg-[#3D2314] px-3 py-2 text-white disabled:opacity-40">{sugestao === 'iniciar' ? 'Iniciar' : 'Parar'}</button>
      <button type="button" disabled={ocupado} onClick={onFechar} data-testid="cronometro-sugestao-nao" className="rounded-lg border border-[#3D2314]/15 bg-white px-3 py-2 disabled:opacity-40">Agora não</button>
    </div>
  );
}
