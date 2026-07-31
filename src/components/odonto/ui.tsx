"use client";
// ── Design System Premium · Clínica Odontológica (PS) ─────────────────────────
// Criado 1x, consumido por TODAS as telas odonto (Agenda, Prontuário, Plano,
// Financeiro clínico...). Identidade PS: espresso/off-white/dourado; hairlines
// finas; cantos suaves; sentence case; 2 pesos; 1 destaque por tela; semáforo SÓ
// pra status clínico/financeiro. Mobile-first (regra #ZERO).
import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export const TOK = {
  esp: "#3D2314",            // texto forte / estrutura
  bg: "#FAF7F2",             // fundo off-white
  gold: "#C8941A",           // destaque / ícones / ativo
  goldSoft: "#F3E6C9",       // fundo suave do dourado (ícone da marca)
  line: "#E7DECF",           // hairline (0.5px)
  card: "#FFFFFF",
  mut: "rgba(61,35,20,0.55)",
  mut30: "rgba(61,35,20,0.30)",
  rCard: 16, rCtrl: 8, rBar: 3,
  // semáforo (só status)
  green: "#166534", amber: "#B45309", red: "#A32D2D", gray: "#6B7280",
};

// Status de agendamento: barra (cor forte) + fundo suave (bg) + rótulo.
export const STATUS_ODONTO: Record<string, { label: string; cor: string; bg: string }> = {
  agendado:       { label: "Agendado",       cor: "#1D4ED8", bg: "#EAF0FE" }, // azul
  confirmado:     { label: "Confirmado",     cor: "#166534", bg: "#E7F3EA" }, // verde
  em_atendimento: { label: "Em atendimento", cor: "#B45309", bg: "#FBF0DF" }, // âmbar
  concluido:      { label: "Concluído",      cor: "#6B7280", bg: "#F1F1F0" }, // cinza
  faltou:         { label: "Faltou",         cor: "#A32D2D", bg: "#FBEBEB" }, // vermelho
  cancelado:      { label: "Cancelado",      cor: "#9CA3AF", bg: "#F4F3F1" }, // cinza riscado
};
export const STATUS_FLOW = ["agendado", "confirmado", "em_atendimento", "concluido", "faltou", "cancelado"];
export const st = (s: string) => STATUS_ODONTO[s] || STATUS_ODONTO.agendado;

const hair = `0.5px solid ${TOK.line}`;

// Shell full-width — estica até a borda; padding confortável, mobile-first.
export function ShellOdonto({ children }: { children: React.ReactNode }) {
  return <div style={{ background: TOK.bg, color: TOK.esp, minHeight: "100%", fontFamily: "ui-sans-serif,system-ui,sans-serif", width: "100%" }} className="px-3 sm:px-5 py-4 sm:py-5">{children}</div>;
}

// Ícone da marca — quadrado arredondado dourado suave.
export function BrandIcon({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center justify-center flex-shrink-0" style={{ width: 40, height: 40, borderRadius: 12, background: TOK.goldSoft, color: TOK.gold }}>{children}</span>;
}

// Cabeçalho em faixas: faixa 1 (marca + título + subtítulo | ações) + faixa 2 opcional.
export function PageHeaderOdonto({ icon, titulo, subtitulo, acoes, faixa2 }: {
  icon: React.ReactNode; titulo: string; subtitulo?: string; acoes?: React.ReactNode; faixa2?: React.ReactNode;
}) {
  return (
    <div style={{ background: TOK.card, border: hair, borderRadius: TOK.rCard, overflow: "hidden", marginBottom: 12 }}>
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <BrandIcon>{icon}</BrandIcon>
          <div className="min-w-0">
            <div style={{ fontSize: 18, fontWeight: 500, color: TOK.esp, lineHeight: 1.15 }} className="truncate">{titulo}</div>
            {subtitulo && <div style={{ fontSize: 12.5, color: TOK.mut }} className="truncate">{subtitulo}</div>}
          </div>
        </div>
        {acoes && <div className="flex items-center gap-2 flex-wrap">{acoes}</div>}
      </div>
      {faixa2 && <div className="flex items-center justify-between gap-2 flex-wrap px-4 py-2.5" style={{ borderTop: hair, background: "rgba(250,247,242,0.6)" }}>{faixa2}</div>}
    </div>
  );
}

export function CardOdonto({ children, style, className }: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  return <div className={className} style={{ background: TOK.card, border: hair, borderRadius: TOK.rCard, padding: 18, ...style }}>{children}</div>;
}

// Bolinha + rótulo de status (legenda).
export function StatusDot({ status }: { status: string }) {
  const s = st(status);
  return <span className="inline-flex items-center gap-1.5" style={{ fontSize: 11.5, color: TOK.mut }}>
    <span style={{ width: 9, height: 9, borderRadius: 3, background: s.bg, borderLeft: `3px solid ${s.cor}` }} />{s.label}</span>;
}

export function MetricStat({ valor, label, cor }: { valor: string; label: string; cor?: string }) {
  return <div>
    <div style={{ fontSize: 24, fontWeight: 500, color: cor || TOK.esp, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{valor}</div>
    <div style={{ fontSize: 12, color: TOK.mut }}>{label}</div>
  </div>;
}

export function ProgressBar({ pct, cor, width = 120 }: { pct: number; cor?: string; width?: number }) {
  return <div style={{ width, height: 6, borderRadius: 999, background: TOK.line, overflow: "hidden" }}>
    <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: "100%", background: cor || TOK.gold, transition: "width .2s" }} />
  </div>;
}

// Estado vazio como convite (verb-first), nunca "nada aqui".
export function EmptyStateOdonto({ titulo, linha, acao }: { titulo: string; linha?: string; acao?: React.ReactNode }) {
  return <div style={{ background: TOK.card, border: `1px dashed ${TOK.line}`, borderRadius: TOK.rCard }} className="px-6 py-12 text-center">
    <div style={{ fontSize: 16, fontWeight: 500, color: TOK.esp }}>{titulo}</div>
    {linha && <div style={{ fontSize: 13.5, color: TOK.mut, marginTop: 4, maxWidth: 420 }} className="mx-auto">{linha}</div>}
    {acao && <div className="mt-4">{acao}</div>}
  </div>;
}

// Pill/controle base (dropdown, toggle) — hairline + radius 8px.
export function PillWrap({ children, active, onClick, title }: { children: React.ReactNode; active?: boolean; onClick?: () => void; title?: string }) {
  return <button onClick={onClick} title={title} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm"
    style={{ background: active ? TOK.gold : TOK.card, color: active ? "#fff" : TOK.esp, border: hair, borderRadius: TOK.rCtrl, fontWeight: active ? 500 : 400 }}>{children}</button>;
}

// Toggle premium (label + switch dourado).
export function Toggle({ t, on, set }: { t: string; on: boolean; set: (v: boolean) => void }) {
  return <button onClick={() => set(!on)} className="inline-flex items-center gap-2" style={{ fontSize: 12.5, color: TOK.esp }}>
    <span>{t}</span>
    <span style={{ width: 36, height: 20, borderRadius: 999, position: "relative", background: on ? TOK.gold : TOK.line, transition: "background .15s" }}>
      <span style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: 999, background: "#fff", transition: "left .15s" }} /></span>
  </button>;
}

// ── Ligação Financeira (Onda 0) · débitos do paciente ────────────────────────
const brl = (n: number) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
// cor por status financeiro (semáforo): pago=verde, vencido=vermelho, aberto=neutro/dourado.
const stFin = (s: string) => s === "pago" || s === "recebido" ? { l: "Pago", cor: TOK.green, bg: "#E7F3EA" }
  : s === "vencido" ? { l: "Vencido", cor: TOK.red, bg: "#FBEBEB" }
  : { l: "Aberto", cor: "#8A6A1E", bg: "#FBF3DE" };

type Titulo = { id: string; descricao: string; valor: number; data_vencimento: string; data_competencia: string; status: string; parcela: string; do_plano: boolean };
type Debitos = { paciente_id: string; cliente_id: string | null; total_recebido: number; total_aberto: number; titulos: Titulo[] };

// Badge de saldo — reusável (ficha, agenda). Verde se quitado; âmbar/vermelho se deve.
export function SaldoBadge({ pacienteId, compact }: { pacienteId: string; compact?: boolean }) {
  const [d, setD] = useState<{ recebido: number; aberto: number } | null>(null);
  useEffect(() => {
    let alive = true;
    void supabase.rpc("fn_odonto_debitos_paciente", { p_paciente_id: pacienteId, p_incluir_recebidos: true })
      .then(({ data }) => { const r = data as Debitos | null; if (alive && r) setD({ recebido: r.total_recebido, aberto: r.total_aberto }); });
    return () => { alive = false; };
  }, [pacienteId]);
  if (!d) return null;
  const deve = d.aberto > 0;
  return <span className="inline-flex items-center gap-1.5" style={{ fontSize: compact ? 11 : 12, fontWeight: 500, padding: "3px 10px", borderRadius: 999, background: deve ? "#FBEBEB" : "#E7F3EA", color: deve ? TOK.red : TOK.green }}>
    {deve ? `A receber ${brl(d.aberto)}` : d.recebido > 0 ? "Em dia" : "Sem débitos"}</span>;
}

// Aba Débitos premium — a ficha só EXIBE (fronteira: financeiro é da GE).
export function DebitosPaciente({ pacienteId }: { pacienteId: string }) {
  const [d, setD] = useState<Debitos | null>(null);
  const [incRec, setIncRec] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true; setLoading(true);
    void supabase.rpc("fn_odonto_debitos_paciente", { p_paciente_id: pacienteId, p_incluir_recebidos: incRec })
      .then(({ data }) => { if (!alive) return; setD(data as Debitos | null); setLoading(false); });
    return () => { alive = false; };
  }, [pacienteId, incRec]);

  return (
    <CardOdonto>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div style={{ fontSize: 14, fontWeight: 500, color: TOK.esp }}>Débitos e recebimentos</div>
        <Toggle t="Mostrar recebidos" on={incRec} set={setIncRec} />
      </div>
      {!d?.cliente_id ? <div style={{ fontSize: 13, color: TOK.mut }}>Paciente ainda não vinculado ao financeiro. Aprove um plano para gerar os títulos.</div> :
        <>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div style={{ background: "#E7F3EA", borderRadius: 12, padding: "10px 14px" }}><MetricStat valor={brl(d.total_recebido)} label="Recebido" cor={TOK.green} /></div>
            <div style={{ background: d.total_aberto > 0 ? "#FBEBEB" : TOK.bg, borderRadius: 12, padding: "10px 14px" }}><MetricStat valor={brl(d.total_aberto)} label="A receber" cor={d.total_aberto > 0 ? TOK.red : TOK.mut} /></div>
          </div>
          {loading ? <div style={{ fontSize: 13, color: TOK.mut }}>Carregando…</div> :
            (d.titulos || []).length === 0 ? <div style={{ fontSize: 13, color: TOK.mut }}>Nenhum título {incRec ? "" : "em aberto"} para este paciente.</div> :
              <div style={{ border: hair, borderRadius: 12, overflow: "hidden" }}>
                {d.titulos.map((t, i) => { const S = stFin(t.status); return (
                  <div key={t.id} className="flex items-center gap-3 px-3 py-2.5" style={{ borderTop: i ? hair : "none" }}>
                    <div className="min-w-0 flex-1">
                      <div style={{ fontSize: 13, color: TOK.esp }} className="truncate">{t.descricao}</div>
                      <div style={{ fontSize: 11.5, color: TOK.mut }}>venc. {new Date(t.data_vencimento + "T00:00:00").toLocaleDateString("pt-BR")}{t.do_plano ? " · plano" : ""}</div>
                    </div>
                    <span style={{ fontSize: 10.5, fontWeight: 500, padding: "2px 8px", borderRadius: 999, background: S.bg, color: S.cor, flexShrink: 0 }}>{S.l}</span>
                    <div style={{ fontSize: 13.5, fontWeight: 500, color: TOK.esp, fontVariantNumeric: "tabular-nums", minWidth: 82, textAlign: "right" }}>{brl(t.valor)}</div>
                  </div>); })}
              </div>}
          <div style={{ fontSize: 11, color: TOK.mut30, marginTop: 8 }}>O financeiro vive na Gestão Empresarial · a ficha só exibe. NFS-e e régua de cobrança chegam a seguir.</div>
        </>}
    </CardOdonto>
  );
}
