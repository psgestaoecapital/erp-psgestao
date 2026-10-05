"use client";
// Social (CEO 03/10) · formulário do post: assunto, publicação, redes (lista da empresa), peça, responsável, situação e o
// briefing estruturado (arte, texto da arte, legenda, hashtags). Mostra antes de gravar o prazo que o job vai ter
// (publicação − antecedência da peça) — a conta que vale é a do banco. Celular: tela cheia; computador: janela central.

import { useMemo, useState } from "react";
import { X, Sparkles, CalendarClock } from "lucide-react";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { STATUS_POST, dataBR, deInputLocal, paraInputLocal, prazoDoPost, redesInvalidas, type StatusPost } from "@/lib/pm/social";

export type Post = {
  id: string; planejamento_id: string; cliente_id: string; assunto: string; publicar_em: string | null; redes: string[];
  servico_id: string | null; arte: string | null; texto_arte: string | null; legenda: string | null; hashtags: string | null;
  responsavel_id: string | null; status: StatusPost; job_id: string | null; ordem: number;
};
export type Opcao = { valor: string; rotulo: string };
export type Peca = { id: string; nome: string; antecedencia_dias: number | null };
export type Usuario = { id: string; nome: string };
export type PostRascunho = Omit<Post, "id" | "planejamento_id" | "cliente_id" | "job_id" | "ordem"> & { id?: string; job_id?: string | null };

const inp = "w-full rounded-xl border border-[#3D2314]/15 bg-white px-3 py-2.5 text-[14px] text-[#3D2314] focus:border-[#C8941A] focus:outline-none";
const rot = "mb-1 flex items-center text-[12px] font-semibold text-[#3D2314]";

export const postVazio = (): PostRascunho => ({ assunto: "", publicar_em: null, redes: [], servico_id: null, arte: "", texto_arte: "", legenda: "", hashtags: "", responsavel_id: null, status: "rascunho" });

export function PostForm({ inicial, redes, pecas, usuarios, busy, erro, onCancelar, onSalvar }: {
  inicial: PostRascunho; redes: Opcao[]; pecas: Peca[]; usuarios: Usuario[]; busy: boolean; erro: string | null;
  onCancelar: () => void; onSalvar: (p: PostRascunho) => void;
}) {
  const [f, setF] = useState<PostRascunho>(inicial);
  const peca = pecas.find((p) => p.id === f.servico_id);
  const prazo = prazoDoPost(f.publicar_em, peca?.antecedencia_dias);
  const ativas = useMemo(() => redes.map((r) => r.valor), [redes]);
  // rede antiga que a empresa ocultou continua no post (aparece marcada, com o valor)
  const opcoesRedes = useMemo(() => [...redes, ...f.redes.filter((r) => !ativas.includes(r)).map((r) => ({ valor: r, rotulo: `${r} (oculta)` }))], [redes, f.redes, ativas]);
  const novasInvalidas = redesInvalidas(f.redes.filter((r) => !inicial.redes.includes(r)), ativas);
  const temJob = !!f.job_id;
  const podeSalvar = f.assunto.trim().length > 0 && !novasInvalidas.length && !busy;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 sm:items-start sm:overflow-y-auto sm:p-6" onClick={onCancelar}>
      <div className="flex w-full flex-col bg-[#FAF7F2] sm:my-6 sm:max-w-2xl sm:rounded-2xl sm:shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="post-form">
        <div className="flex items-center justify-between border-b border-[#3D2314]/10 px-5 py-3.5">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#C8941A]">Post</div>
            <h2 className="text-[18px] font-medium text-[#3D2314]">{f.id ? "Editar post" : "Novo post"}</h2>
          </div>
          <button onClick={onCancelar} aria-label="fechar" className="rounded-full p-1.5 text-[#3D2314]/60 hover:bg-[#3D2314]/6"><X size={18} /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <label className="block"><span className={rot}>Assunto *<AjudaCampo chave="pm.post.assunto" /></span>
            <input className={inp} value={f.assunto} onChange={(e) => setF({ ...f, assunto: e.target.value })} placeholder="Ex.: Lançamento do blend de outono" data-testid="post-assunto" /></label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className={rot}>Publicar em<AjudaCampo chave="pm.post.publicar_em" /></span>
              <input type="datetime-local" className={inp} value={paraInputLocal(f.publicar_em)} onChange={(e) => setF({ ...f, publicar_em: deInputLocal(e.target.value) })} data-testid="post-publicar-em" /></label>
            <label className="block"><span className={rot}>Peça<AjudaCampo chave="pm.post.peca" /></span>
              <select className={inp} value={f.servico_id ?? ""} onChange={(e) => setF({ ...f, servico_id: e.target.value || null })} data-testid="post-peca">
                <option value="">— escolha a peça —</option>
                {pecas.map((p) => <option key={p.id} value={p.id}>{p.nome} · {p.antecedencia_dias ?? 2} dia(s) antes</option>)}
              </select></label>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-[#C8941A]/30 bg-[#FFF8E7] px-3 py-2.5 text-[12.5px] text-[#6B4A0E]" data-testid="post-prazo-previsto">
            <CalendarClock size={16} className="mt-0.5 shrink-0" />
            {prazo
              ? <span>Prazo do job: <b>{dataBR(prazo)}</b> — {peca?.antecedencia_dias ?? 2} dia(s) antes da publicação{temJob ? ". O job já existe: mudar a data move o prazo dele." : ", criado sozinho quando o post for aprovado."}</span>
              : <span>Informe a data de publicação e a peça: ao aprovar, o post vira job com prazo antes da publicação.</span>}
          </div>

          <div>
            <span className={rot}>Redes<AjudaCampo chave="pm.post.redes" /></span>
            <div className="flex flex-wrap gap-2" data-testid="post-redes">
              {opcoesRedes.map((r) => {
                const on = f.redes.includes(r.valor);
                return (
                  <label key={r.valor} data-ajuda="pm.post.redes" className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition ${on ? "border-[#3D2314] bg-[#3D2314] text-[#F5E6C8]" : "border-[#3D2314]/15 bg-white text-[#3D2314]"}`}>
                    <input type="checkbox" className="sr-only" checked={on} onChange={(e) => setF({ ...f, redes: e.target.checked ? [...f.redes, r.valor] : f.redes.filter((x) => x !== r.valor) })} data-testid={`post-rede-${r.valor}`} />
                    {r.rotulo}
                  </label>
                );
              })}
              {!opcoesRedes.length && <span className="text-[12.5px] text-[#3D2314]/55">Nenhuma rede cadastrada — P&amp;M › Configurações › Listas › Redes sociais.</span>}
            </div>
            {novasInvalidas.length > 0 && <div className="mt-1 text-[12px] text-[#791F1F]">Rede fora da lista da empresa: {novasInvalidas.join(", ")}.</div>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className={rot}>Responsável<AjudaCampo chave="pm.post.responsavel" /></span>
              <select className={inp} value={f.responsavel_id ?? ""} onChange={(e) => setF({ ...f, responsavel_id: e.target.value || null })} data-testid="post-responsavel">
                <option value="">— padrão da peça —</option>
                {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select></label>
            <label className="block"><span className={rot}>Situação<AjudaCampo chave="pm.post.status" /></span>
              <select className={inp} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as StatusPost })} data-testid="post-status">
                {STATUS_POST.map((s) => <option key={s.v} value={s.v}>{s.l}{s.v === "aprovado" && !temJob ? " (vira job)" : ""}</option>)}
              </select></label>
          </div>

          <div className="rounded-2xl border border-[#3D2314]/10 bg-white p-4">
            <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#C8941A]"><Sparkles size={13} /> Briefing do post</div>
            <div className="space-y-3">
              <label className="block"><span className={rot}>Arte<AjudaCampo chave="pm.post.arte" /></span>
                <textarea rows={3} className={`${inp} resize-y`} value={f.arte ?? ""} onChange={(e) => setF({ ...f, arte: e.target.value })} placeholder="O que a imagem ou o vídeo mostra" data-testid="post-arte" /></label>
              <label className="block"><span className={rot}>Texto da arte<AjudaCampo chave="pm.post.texto_arte" /></span>
                <textarea rows={2} className={`${inp} resize-y`} value={f.texto_arte ?? ""} onChange={(e) => setF({ ...f, texto_arte: e.target.value })} placeholder="O que vai escrito na peça" data-testid="post-texto-arte" /></label>
              <label className="block"><span className={rot}>Legenda<AjudaCampo chave="pm.post.legenda" /></span>
                <textarea rows={4} className={`${inp} resize-y`} value={f.legenda ?? ""} onChange={(e) => setF({ ...f, legenda: e.target.value })} placeholder="Texto que acompanha o post" data-testid="post-legenda" /></label>
              <label className="block"><span className={rot}>Hashtags<AjudaCampo chave="pm.post.hashtags" /></span>
                <input className={inp} value={f.hashtags ?? ""} onChange={(e) => setF({ ...f, hashtags: e.target.value })} placeholder="#marca #campanha" data-testid="post-hashtags" /></label>
            </div>
          </div>
          {erro && <div className="rounded-xl border border-[#791F1F]/25 bg-[#FBEAEA] px-3 py-2 text-[13px] text-[#791F1F]" data-testid="post-erro">{erro}</div>}
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-[#3D2314]/10 bg-[#FAF7F2] px-5 py-3">
          <button onClick={onCancelar} className="rounded-xl border border-[#3D2314]/15 bg-white px-4 py-2.5 text-[13.5px] text-[#3D2314]">Cancelar</button>
          <button disabled={!podeSalvar} onClick={() => onSalvar({ ...f, assunto: f.assunto.trim() })} className="rounded-xl bg-[#3D2314] px-5 py-2.5 text-[13.5px] font-medium text-white disabled:opacity-40" data-testid="post-salvar">{busy ? "Salvando…" : "Salvar post"}</button>
        </div>
      </div>
    </div>
  );
}
