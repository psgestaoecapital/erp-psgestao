"use client";
// PM-T (4c) · job concluído sem horas: pede o apontamento (link para lançar à mão, que vira histórico/edição).
import Link from "next/link";
import { textoSemHoras } from "@/lib/pm/cronometroAuto";

export function AvisoSemHoras({ jobId, onFechar }: { jobId: string; onFechar: () => void }) {
  return (
    <div role="alert" data-testid="aviso-sem-horas" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#C8941A]/40 bg-[#FAEEDA] px-3 py-2 text-[12.5px] text-[#6B4A0E]">
      <span className="flex-1">{textoSemHoras}</span>
      <Link href={`/dashboard/pm/apontamento-horas?job=${jobId}`} data-testid="aviso-sem-horas-lancar" className="rounded-lg bg-[#3D2314] px-3 py-2 text-white">Lançar horas</Link>
      <button type="button" onClick={onFechar} data-testid="aviso-sem-horas-nao" className="rounded-lg border border-[#3D2314]/15 bg-white px-3 py-2">Agora não</button>
    </div>
  );
}
