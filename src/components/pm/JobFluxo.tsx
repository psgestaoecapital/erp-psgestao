"use client";
// PM-C · fluxo do job dentro da Pauta (CEO 02/10): rodada de ajuste com letra ("Pedir ajuste" com motivo),
// "Aguardando" com motivo e tempo parado, aprovação do cliente com prazo e vencimento. Toda gravação passa pelas
// funções do banco (fn_pm_job_*), que conferem a empresa e deixam a linha no feed do job. Cada campo tem o "?".

import { useCallback, useEffect, useState } from "react";
import { RefreshCcw, PauseCircle, PlayCircle, Send, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { codigoJob, letraRodada, prazoAprovacao, tempoParado, QUEM_AGUARDA } from "@/lib/pm/pauta";

type Opcao = { valor: string; rotulo: string };
type Rodada = { rodada: number; motivo: string | null; pedido_por: string; criado_em: string };
type Aprovacao = { id: string; rodada: number; enviado_em: string; prazo_em: string; decisao: string | null; decidido_em: string | null };
type Estado = { status: string; rodada_ajuste: number; numero: string; aguardando_de: string | null; aguardando_motivo: string | null; aguardando_desde: string | null };
type Resp = { ok?: boolean; mensagem?: string; erro?: string; codigo?: string; prazo_em?: string; dias_parado?: number };

const inp = "w-full rounded-lg border border-[#3D2314]/15 bg-white px-2.5 py-2 text-[13px] text-[#3D2314] focus:border-[#C8941A] focus:outline-none";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-[#3D2314]/15 bg-white px-3 py-2 text-[12.5px] font-medium text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-40";
const btnPri = "inline-flex items-center gap-1.5 rounded-lg bg-[#3D2314] px-3 py-2 text-[12.5px] font-medium text-white hover:bg-[#3D2314]/90 disabled:opacity-40";
const cartao = "rounded-xl border border-[#3D2314]/10 bg-gradient-to-b from-white to-[#FAF7F2] p-3";
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function JobFluxo({ jobId, motivos, situacoes, onMudou }: {
  jobId: string; motivos: Opcao[]; situacoes: Opcao[]; onMudou: (codigo: string) => void;
}) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [rodadas, setRodadas] = useState<Rodada[]>([]);
  const [aprov, setAprov] = useState<Aprovacao | null>(null);
  const [ultimaDecidida, setUltimaDecidida] = useState<Aprovacao | null>(null);
  const [form, setForm] = useState<"" | "ajuste" | "aguardar" | "aprovacao" | "reprovar">("");
  const [motivo, setMotivo] = useState(""); const [pedidoPor, setPedidoPor] = useState("cliente");
  const [de, setDe] = useState("cliente"); const [motivoEspera, setMotivoEspera] = useState("");
  const [prazo, setPrazo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    const [j, r, a] = await Promise.all([
      supabase.from("agency_jobs").select("status, rodada_ajuste, numero, aguardando_de, aguardando_motivo, aguardando_desde").eq("id", jobId).maybeSingle(),
      supabase.from("agency_job_rodadas").select("rodada, motivo, pedido_por, criado_em").eq("job_id", jobId).order("rodada"),
      supabase.from("agency_aprovacoes").select("id, rodada, enviado_em, prazo_em, decisao, decidido_em").eq("job_id", jobId).order("enviado_em", { ascending: false }).limit(5),
    ]);
    const est = j.data as Estado | null;
    setEstado(est);
    // só as rodadas que valem hoje (a demo re-arma o cenário e pode deixar rodada antiga guardada)
    setRodadas(((r.data ?? []) as Rodada[]).filter((x) => !est || x.rodada <= est.rodada_ajuste));
    const aps = (a.data ?? []) as Aprovacao[];
    setAprov(aps.find((x) => !x.decisao) ?? null);
    setUltimaDecidida(aps.find((x) => !!x.decisao) ?? null);
  }, [jobId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega o fluxo do job quando o painel abre
  useEffect(() => { void carregar(); }, [carregar]);

  async function chamar(fn: string, args: Record<string, unknown>, sucesso: (r: Resp) => string) {
    setOcupado(true); setMsg(null);
    const { data, error } = await supabase.rpc(fn, args);
    setOcupado(false);
    const r = data as Resp | null;
    if (error || !r?.ok) { setMsg({ ok: false, texto: r?.mensagem || error?.message || r?.erro || "Não foi possível." }); return; }
    setForm(""); setMotivo(""); setPrazo("");
    setMsg({ ok: true, texto: sucesso(r) });
    await carregar();
    onMudou(r.codigo ?? "");
  }

  const motivoSel = motivoEspera || motivos[0]?.valor || "";
  if (!estado) return <div className="text-[12px] text-[#3D2314]/50">carregando o fluxo do job…</div>;
  const nomeMotivo = (v: string | null) => motivos.find((m) => m.valor === v)?.rotulo ?? v ?? "";
  const nomeSit = (v: string) => situacoes.find((s) => s.valor === v)?.rotulo ?? v;
  const p = aprov ? prazoAprovacao(aprov.prazo_em) : null;
  const corPrazo = p?.nivel === "vencida" ? "border-[#791F1F]/30 bg-[#F7E1E1] text-[#791F1F]" : p?.nivel === "hoje" ? "border-[#C8941A]/40 bg-[#FAEEDA] text-[#6B4A0E]" : "border-[#3D2314]/10 bg-white text-[#3D2314]";

  return (
    <div className="mt-4 space-y-3" data-testid="job-fluxo">
      {msg && <div className={`rounded-lg px-3 py-2 text-[12.5px] ${msg.ok ? "bg-[#E5F2E1] text-[#2F5A1F]" : "bg-[#F7E1E1] text-[#791F1F]"}`} data-testid="job-fluxo-msg">{msg.texto}</div>}

      {/* situação + aguardando (com motivo e tempo parado) */}
      <section className={cartao} data-testid="job-situacao">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#3D2314]/50">Situação</div>
            <div className="text-[15px] font-medium">{nomeSit(estado.status)} <span className="ml-1 rounded-md bg-[#3D2314] px-1.5 py-0.5 text-[11.5px] text-white" data-testid="job-codigo">{codigoJob(estado.numero, estado.rodada_ajuste)}</span></div>
          </div>
          {estado.status === "aguardando"
            ? <button className={btnPri} disabled={ocupado} onClick={() => void chamar("fn_pm_job_retomar", { p_job_id: jobId }, (r) => `Job retomado (ficou parado ${r.dias_parado ? `${r.dias_parado} dia(s)` : "menos de 1 dia"}).`)} data-testid="job-retomar"><PlayCircle size={14} /> Retomar</button>
            : <button className={btn} disabled={ocupado} onClick={() => setForm(form === "aguardar" ? "" : "aguardar")} data-testid="job-aguardar"><PauseCircle size={14} /> Aguardando…</button>}
        </div>
        {estado.status === "aguardando" && (
          <div className="mt-2 flex items-start gap-2 rounded-lg bg-[#FAEEDA] px-2.5 py-2 text-[12.5px]" data-testid="job-aguardando-info">
            <Clock size={14} className="mt-0.5 shrink-0 text-[#C8941A]" />
            <span>Aguardando <b>{QUEM_AGUARDA[estado.aguardando_de ?? ""] ?? estado.aguardando_de}</b> · {nomeMotivo(estado.aguardando_motivo)}
              <span className="block text-[11.5px] text-[#3D2314]/60">parado {tempoParado(estado.aguardando_desde)}{estado.aguardando_desde ? ` (desde ${dataHora(estado.aguardando_desde)})` : ""}</span></span>
          </div>
        )}
        {form === "aguardar" && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="job-form-aguardar">
            <label><span className="mb-1 flex items-center text-[11.5px] font-medium text-[#3D2314]/70">Aguardando quem<AjudaCampo chave="pm.job.aguardando.de" /></span>
              <select className={inp} value={de} onChange={(e) => setDe(e.target.value)} data-testid="job-aguardar-de">
                {Object.entries(QUEM_AGUARDA).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
              </select></label>
            <label><span className="mb-1 flex items-center text-[11.5px] font-medium text-[#3D2314]/70">Motivo da espera<AjudaCampo chave="pm.job.aguardando.motivo" /></span>
              <select className={inp} value={motivoSel} onChange={(e) => setMotivoEspera(e.target.value)} data-testid="job-aguardar-motivo">
                {motivos.map((m) => <option key={m.valor} value={m.valor}>{m.rotulo}</option>)}
              </select></label>
            <div className="flex gap-2 sm:col-span-2">
              <button className={btnPri} disabled={ocupado || !motivoSel} onClick={() => void chamar("fn_pm_job_aguardar", { p_job_id: jobId, p_de: de, p_motivo: motivoSel }, () => "Job marcado como aguardando — o relógio de tempo parado começou.")} data-testid="job-aguardar-salvar">Marcar aguardando</button>
              <button className={btn} onClick={() => setForm("")}>Cancelar</button>
            </div>
          </div>
        )}
      </section>

      {/* aprovação do cliente com prazo e vencimento */}
      <section className={cartao} data-testid="job-aprovacao">
        <div className="text-[11px] uppercase tracking-wider text-[#3D2314]/50">Aprovação do cliente</div>
        {aprov && p ? (
          <>
            <div className={`mt-1 flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[12.5px] ${corPrazo}`} data-testid="job-aprovacao-prazo" data-nivel={p.nivel}>
              {p.nivel === "vencida" ? <AlertTriangle size={14} className="mt-0.5 shrink-0" /> : <Clock size={14} className="mt-0.5 shrink-0" />}
              <span><b>{p.nivel === "vencida" ? "Prazo vencido" : p.nivel === "hoje" ? "Vence hoje" : "Aguardando o cliente"}</b> · {p.texto}
                <span className="block text-[11.5px] opacity-75">enviada em {dataHora(aprov.enviado_em)} · rodada {letraRodada(aprov.rodada) || "original"}</span></span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button className={btnPri} disabled={ocupado} onClick={() => void chamar("fn_pm_job_decidir_aprovacao", { p_job_id: jobId, p_decisao: "aprovado" }, () => "Aprovado pelo cliente — job concluído.")} data-testid="job-aprovar"><CheckCircle2 size={14} /> Cliente aprovou</button>
              <button className={btn} disabled={ocupado} onClick={() => setForm(form === "reprovar" ? "" : "reprovar")} data-testid="job-reprovar"><RefreshCcw size={14} /> Cliente pediu ajuste</button>
              <AjudaCampo chave="pm.job.aprovacao.decisao" />
            </div>
          </>
        ) : (
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-[#3D2314]/70">
            <span>{ultimaDecidida ? `Última: ${ultimaDecidida.decisao === "aprovado" ? "aprovada" : "pediu ajuste"} em ${dataHora(ultimaDecidida.decidido_em ?? ultimaDecidida.enviado_em)}` : "Ainda não enviado ao cliente."}</span>
            <button className={btn} disabled={ocupado} onClick={() => setForm(form === "aprovacao" ? "" : "aprovacao")} data-testid="job-enviar-aprovacao"><Send size={14} /> Enviar para aprovação</button>
          </div>
        )}
        {form === "aprovacao" && (
          <div className="mt-3 space-y-2" data-testid="job-form-aprovacao">
            <label className="block"><span className="mb-1 flex items-center text-[11.5px] font-medium text-[#3D2314]/70">Prazo da aprovação<AjudaCampo chave="pm.job.aprovacao.prazo" /></span>
              <input type="datetime-local" className={inp} value={prazo} onChange={(e) => setPrazo(e.target.value)} data-testid="job-aprovacao-prazo-input" />
              <span className="mt-0.5 block text-[11px] text-[#3D2314]/50">Em branco: prazo do cliente (padrão 2 dias úteis, às 18h).</span></label>
            <div className="flex gap-2">
              <button className={btnPri} disabled={ocupado} onClick={() => void chamar("fn_pm_job_enviar_aprovacao", { p_job_id: jobId, p_prazo_em: prazo ? new Date(prazo).toISOString() : null }, (r) => `Enviado para aprovação — ${r.prazo_em ? prazoAprovacao(r.prazo_em).texto : ""}.`)} data-testid="job-aprovacao-enviar">Enviar</button>
              <button className={btn} onClick={() => setForm("")}>Cancelar</button>
            </div>
          </div>
        )}
      </section>

      {/* rodadas de ajuste (código com letra) */}
      <section className={cartao} data-testid="job-rodadas">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] uppercase tracking-wider text-[#3D2314]/50">Rodadas de ajuste · {rodadas.length}</div>
          <button className={btn} disabled={ocupado} onClick={() => setForm(form === "ajuste" ? "" : "ajuste")} data-testid="job-pedir-ajuste"><RefreshCcw size={14} /> Pedir ajuste</button>
        </div>
        {!rodadas.length && <div className="mt-1 text-[12.5px] text-[#3D2314]/60">Nenhum ajuste até agora — o job está na versão original.</div>}
        <ol className="mt-2 space-y-1.5">
          {rodadas.map((r) => (
            <li key={r.rodada} className="flex gap-2 text-[12.5px]" data-testid={`job-rodada-${letraRodada(r.rodada)}`}>
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#C8941A] text-[11.5px] font-semibold text-white">{letraRodada(r.rodada)}</span>
              <span>{r.motivo ?? "—"}<span className="block text-[11px] text-[#3D2314]/55">{r.pedido_por === "cliente" ? "pedido pelo cliente" : "ajuste interno"} · {dataHora(r.criado_em)}</span></span>
            </li>
          ))}
        </ol>
        {(form === "ajuste" || form === "reprovar") && (
          <div className="mt-3 space-y-2" data-testid="job-form-ajuste">
            <label className="block"><span className="mb-1 flex items-center text-[11.5px] font-medium text-[#3D2314]/70">O que ajustar<AjudaCampo chave="pm.job.ajuste.motivo" /></span>
              <textarea className={`${inp} min-h-[72px]`} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: trocar a foto da capa por uma mais clara" data-testid="job-ajuste-motivo" /></label>
            {form === "ajuste" && (
              <label className="block"><span className="mb-1 flex items-center text-[11.5px] font-medium text-[#3D2314]/70">Quem pediu<AjudaCampo chave="pm.job.ajuste.quem" /></span>
                <select className={inp} value={pedidoPor} onChange={(e) => setPedidoPor(e.target.value)} data-testid="job-ajuste-quem">
                  <option value="cliente">Cliente</option><option value="interno">Interno (equipe)</option>
                </select></label>
            )}
            <div className="flex gap-2">
              <button className={btnPri} disabled={ocupado || motivo.trim().length < 3} data-testid="job-ajuste-salvar"
                onClick={() => void (form === "reprovar"
                  ? chamar("fn_pm_job_decidir_aprovacao", { p_job_id: jobId, p_decisao: "ajustar", p_motivo: motivo }, (r) => `Ajuste aberto — o job agora é ${r.codigo}.`)
                  : chamar("fn_pm_job_pedir_ajuste", { p_job_id: jobId, p_motivo: motivo, p_pedido_por: pedidoPor }, (r) => `Ajuste aberto — o job agora é ${r.codigo}.`))}>
                Abrir rodada {letraRodada(estado.rodada_ajuste + 1)}
              </button>
              <button className={btn} onClick={() => setForm("")}>Cancelar</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
