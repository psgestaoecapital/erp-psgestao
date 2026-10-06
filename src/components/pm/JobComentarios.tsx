"use client";
// PM-D · comentários do job com @menção (CEO 02/10). Feed em agency_job_comentarios (a RLS da P1 só deixa cada um
// escrever em seu nome); "@Nome" de quem é da equipe vai para `mencoes` e aparece no Meu Dia dessa pessoa.
// As ações do fluxo (ajuste, aguardando, aprovação) também caem neste feed — é o histórico do job.

import { useCallback, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { buscaMencao, extrairMencoes, inserirMencao, partesComMencao, sugerirPessoas, type Pessoa } from "@/lib/pm/meuDia";

type Comentario = { id: string; autor_id: string | null; texto: string; criado_em: string; mencoes: string[] };
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function JobComentarios({ empresa, jobId, userId, equipe }: { empresa: string; jobId: string; userId: string | null; equipe: Pessoa[] }) {
  const [lista, setLista] = useState<Comentario[]>([]);
  const [texto, setTexto] = useState("");
  const [sug, setSug] = useState<{ termo: string; inicio: number } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const caixa = useRef<HTMLTextAreaElement>(null);
  const nome = (id: string | null) => (id ? equipe.find((p) => p.id === id)?.nome ?? "Equipe" : "Sistema");

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("agency_job_comentarios").select("id, autor_id, texto, criado_em, mencoes")
      .eq("job_id", jobId).is("excluido_em", null).order("criado_em", { ascending: false }).limit(30);
    setLista(((data ?? []) as Comentario[]).reverse());
  }, [jobId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega o feed quando o job abre
  useEffect(() => { void carregar(); }, [carregar]);

  function digitar(v: string, cursor: number) { setTexto(v); setSug(buscaMencao(v, cursor)); }
  function escolher(p: Pessoa) {
    if (!sug || !caixa.current) return;
    const novo = inserirMencao(texto, sug.inicio, caixa.current.selectionStart ?? texto.length, p);
    setTexto(novo); setSug(null); caixa.current.focus();
  }
  async function enviar() {
    if (!userId || !texto.trim()) return;
    setOcupado(true); setErro(null);
    const { error } = await supabase.from("agency_job_comentarios").insert({
      company_id: empresa, job_id: jobId, autor_id: userId, texto: texto.trim(), mencoes: extrairMencoes(texto, equipe),
    });
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    setTexto(""); await carregar();
  }

  const sugestoes = sug ? sugerirPessoas(sug.termo, equipe) : [];
  return (
    <section className="mt-3 rounded-xl border border-[#3D2314]/10 bg-white p-3" data-testid="job-comentarios">
      <div className="text-[11px] uppercase tracking-wider text-[#3D2314]/50">Comentários e histórico · {lista.length}</div>
      <ol className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
        {lista.map((c) => (
          <li key={c.id} className={`rounded-lg px-2.5 py-1.5 text-[12.5px] ${c.autor_id === userId ? "bg-[#FAEEDA]/60" : "bg-[#FAF7F2]"}`} data-testid="job-comentario">
            <div className="text-[11px] text-[#3D2314]/55"><b className="text-[#3D2314]/80">{nome(c.autor_id)}</b> · {quando(c.criado_em)}</div>
            <div className="whitespace-pre-wrap">{partesComMencao(c.texto, equipe).map((p, i) => p.mencao
              ? <span key={i} className="rounded bg-[#C8941A]/20 px-0.5 font-medium text-[#6B4A0E]">{p.texto}</span> : <span key={i}>{p.texto}</span>)}</div>
          </li>
        ))}
        {!lista.length && <li className="text-[12.5px] text-[#3D2314]/55">Sem comentários ainda.</li>}
      </ol>
      <label className="relative mt-2 block">
        <span className="mb-1 flex items-center text-[11.5px] font-medium text-[#3D2314]/70">Comentar (use @ para chamar alguém)<AjudaCampo chave="pm.job.comentario.texto" /></span>
        <textarea ref={caixa} className="min-h-[64px] w-full rounded-lg border border-[#3D2314]/15 px-2.5 py-2 text-[13px] focus:border-[#C8941A] focus:outline-none"
          value={texto} onChange={(e) => digitar(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void enviar(); if (e.key === "Escape") setSug(null); }}
          placeholder="Ex.: @Ana Ribeiro o cliente aprovou a paleta, pode seguir" data-testid="job-comentario-texto" />
        {!!sugestoes.length && (
          <ul className="absolute bottom-full left-0 z-10 mb-1 w-64 overflow-hidden rounded-lg border border-[#3D2314]/15 bg-white shadow-lg" data-testid="job-mencao-sugestoes">
            {sugestoes.map((p) => (
              <li key={p.id}><button type="button" className="w-full px-3 py-1.5 text-left text-[13px] hover:bg-[#FAEEDA]" onMouseDown={(e) => { e.preventDefault(); escolher(p); }} data-testid="job-mencao-opcao">@{p.nome}</button></li>
            ))}
          </ul>
        )}
      </label>
      {erro && <div className="mt-1 text-[12px] text-[#791F1F]">{erro}</div>}
      <div className="mt-2 flex justify-end">
        <button className="inline-flex items-center gap-1.5 rounded-lg bg-[#3D2314] px-3 py-2 text-[12.5px] font-medium text-white disabled:opacity-40" disabled={ocupado || !texto.trim() || !userId} onClick={() => void enviar()} data-testid="job-comentario-enviar"><Send size={13} /> Enviar</button>
      </div>
    </section>
  );
}
