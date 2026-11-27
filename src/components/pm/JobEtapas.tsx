"use client";
// P&M · tela 135 "Tempo medido sem clique" (CEO 25/11, go-live da agência piloto).
// Slice de FRONT: mostra, no job aberto da Pauta, as etapas que o job herdou do modelo
// do serviço (fn_agency_job_etapas_listar instancia sozinho na 1ª leitura) e deixa a
// pessoa mudar a situação de cada etapa. A troca de situação carimba entrada/saída por
// CALENDÁRIO no banco (fn_agency_job_etapa_situacao) — é a base do tempo medido sem clique.
// O modelo de etapas por serviço se configura na tela de Serviços (Catálogo).
// Tudo via RPC com guarda de empresa; cada bloco tem o "?" (RD-95).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, PlayCircle, RotateCcw, Clock, ListChecks } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";

type Etapa = {
  id: string;
  nome: string;
  descricao: string | null;
  ordem: number;
  medir_tempo: boolean;
  situacao: "nao_iniciada" | "em_andamento" | "concluida";
  iniciada_em: string | null;
  concluida_em: string | null;
};
type Resp = { ok?: boolean; etapas?: Etapa[]; erro?: string; mensagem?: string };

const cartao = "rounded-xl border border-[#3D2314]/10 bg-gradient-to-b from-white to-[#FAF7F2] p-3";
const btn =
  "inline-flex items-center gap-1 rounded-lg border border-[#3D2314]/15 bg-white px-2.5 py-1.5 text-[12px] font-medium text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-40";

const SITUACAO: Record<Etapa["situacao"], { rotulo: string; cor: string }> = {
  nao_iniciada: { rotulo: "Não iniciada", cor: "bg-[#3D2314]/8 text-[#3D2314]/70" },
  em_andamento: { rotulo: "Em andamento", cor: "bg-[#C8941A]/15 text-[#8A6A12]" },
  concluida: { rotulo: "Concluída", cor: "bg-[#1F6B3B]/12 text-[#1F6B3B]" },
};

const dataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

// duração de calendário entre entrada e saída (ou até agora, se ainda em andamento)
function duracao(ini: string | null, fim: string | null): string | null {
  if (!ini) return null;
  const ms = (fim ? new Date(fim).getTime() : Date.now()) - new Date(ini).getTime();
  if (ms < 0) return null;
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

export function JobEtapas({ empresa, jobId }: { empresa: string; jobId: string }) {
  const [etapas, setEtapas] = useState<Etapa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("fn_agency_job_etapas_listar", { p_company_id: empresa, p_job_id: jobId });
    const r = data as Resp | null;
    if (error || !r?.ok) {
      setErro(r?.mensagem || error?.message || r?.erro || "Não foi possível carregar as etapas.");
      setEtapas([]);
      return;
    }
    setErro(null);
    setEtapas(r.etapas ?? []);
  }, [empresa, jobId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega as etapas quando o job abre
  useEffect(() => { void carregar(); }, [carregar]);

  async function mudar(etapaId: string, situacao: Etapa["situacao"]) {
    setOcupado(etapaId);
    const { data, error } = await supabase.rpc("fn_agency_job_etapa_situacao", {
      p_company_id: empresa, p_etapa_id: etapaId, p_situacao: situacao,
    });
    setOcupado(null);
    const r = data as { ok?: boolean; mensagem?: string; erro?: string } | null;
    if (error || !r?.ok) { setErro(r?.mensagem || error?.message || r?.erro || "Não foi possível mudar a etapa."); return; }
    setErro(null);
    void carregar();
  }

  if (etapas === null) return null; // carregando: não pisca o bloco

  return (
    <div className={`${cartao} mt-3`} data-testid="job-etapas">
      <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-[#3D2314]">
        <ListChecks size={15} /> Etapas do job
        <AjudaCampo chave="pm.pauta.job_etapas" />
      </div>

      {erro && <p className="mb-2 text-[12px] text-[#791F1F]">{erro}</p>}

      {etapas.length === 0 ? (
        <p className="text-[12.5px] text-[#3D2314]/65">
          Este serviço ainda não tem etapas-modelo. Defina as etapas do serviço no{" "}
          <Link href="/dashboard/pm/servicos" className="font-medium text-[#8A6A12] underline-offset-2 hover:underline">
            Catálogo de Serviços
          </Link>{" "}
          — depois todo job desse serviço nasce com elas e mede o tempo sozinho.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {etapas.map((e) => {
            const st = SITUACAO[e.situacao];
            const dur = e.situacao !== "nao_iniciada" ? duracao(e.iniciada_em, e.concluida_em) : null;
            return (
              <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#3D2314]/8 bg-white px-2.5 py-1.5">
                <span className="text-[12.5px] font-medium text-[#3D2314]">{e.nome}</span>
                <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${st.cor}`}>{st.rotulo}</span>
                {e.medir_tempo && dur && (
                  <span className="inline-flex items-center gap-1 text-[11.5px] text-[#3D2314]/55">
                    <Clock size={12} /> {dur}
                    {e.situacao === "em_andamento" ? " (em curso)" : ""}
                  </span>
                )}
                {e.iniciada_em && (
                  <span className="text-[11px] text-[#3D2314]/45">
                    início {dataHora(e.iniciada_em)}{e.concluida_em ? ` · fim ${dataHora(e.concluida_em)}` : ""}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1">
                  {e.situacao === "nao_iniciada" && (
                    <button className={btn} disabled={ocupado === e.id} onClick={() => void mudar(e.id, "em_andamento")} data-testid={`etapa-iniciar-${e.id}`}>
                      <PlayCircle size={13} /> Iniciar
                    </button>
                  )}
                  {e.situacao === "em_andamento" && (
                    <button className={btn} disabled={ocupado === e.id} onClick={() => void mudar(e.id, "concluida")} data-testid={`etapa-concluir-${e.id}`}>
                      <CheckCircle2 size={13} /> Concluir
                    </button>
                  )}
                  {e.situacao === "concluida" && (
                    <button className={btn} disabled={ocupado === e.id} onClick={() => void mudar(e.id, "em_andamento")} data-testid={`etapa-reabrir-${e.id}`}>
                      <RotateCcw size={13} /> Reabrir
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
