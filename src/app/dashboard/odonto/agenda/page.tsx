"use client";
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, X, Plus, Check, Clock, Filter, Calendar, LayoutGrid, Columns, CalendarDays, Sliders } from "lucide-react";
import { supabase } from "@/lib/supabase";

const ESP = "#3D2314", BG = "#FAF7F2", GOLD = "#C8941A", LINE = "#E7DECF", ESP60 = "rgba(61,35,20,0.55)";
const H0 = 8, H1 = 20;                       // 08:00–20:00
const N = (H1 - H0) * 2;                      // slots de 30 min
const pad = (n: number) => String(n).padStart(2, "0");
const idxToTime = (i: number) => `${pad(H0 + Math.floor(i / 2))}:${i % 2 ? "30" : "00"}`;
const timeToIdx = (t: string) => { const [h, m] = t.split(":").map(Number); return (h - H0) * 2 + (m >= 30 ? 1 : 0); };
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const DIAS_LONG = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// Cor por STATUS (borda) — o preenchimento continua sendo a cor do procedimento (tipo).
const STATUS: Record<string, { label: string; cor: string }> = {
  agendado:       { label: "Agendado",       cor: "#8A6A1E" },
  confirmado:     { label: "Confirmado",     cor: "#166534" },
  em_atendimento: { label: "Em atendimento", cor: "#1D4ED8" },
  concluido:      { label: "Concluído",      cor: "#6B7280" },
  faltou:         { label: "Faltou",         cor: "#A32D2D" },
  cancelado:      { label: "Cancelado",      cor: "#9CA3AF" },
};
const STATUS_FLOW = ["agendado", "confirmado", "em_atendimento", "concluido", "faltou", "cancelado"];

type Cad = { id: string; nome: string; cor?: string };
type Prof = { id: string; nome: string; cor: string };
type Proc = { id: string; nome: string; cor: string; duracao_min: number };
type Ag = {
  id: string; cadeira_id: string; data?: string; profissional_id?: string; profissional_nome?: string;
  procedimento_id?: string; procedimento_nome?: string; procedimento_cor?: string;
  paciente_nome: string; hora_inicio: string; hora_fim: string; status: string;
};
type Visao = "cadeira" | "dia" | "semana";

function resolveCompanyId(): string | null {
  if (typeof window === "undefined") return null;
  const sel = localStorage.getItem("ps_empresa_sel");
  if (!sel || sel === "consolidado" || sel.startsWith("group_")) return null;
  return sel;
}
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d: Date) => addDays(d, -d.getDay());   // domingo

export default function AgendaOdontoPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  useEffect(() => {
    setCompanyId(resolveCompanyId());
    const i = setInterval(() => { const a = resolveCompanyId(); setCompanyId(p => p === a ? p : a); }, 800);
    return () => clearInterval(i);
  }, []);

  const [visao, setVisao] = useState<Visao>("cadeira");
  const [ref, setRef] = useState<Date>(() => new Date());   // data de referência
  const [cadeiras, setCadeiras] = useState<Cad[]>([]);
  const [profs, setProfs] = useState<Prof[]>([]);
  const [procs, setProcs] = useState<Proc[]>([]);
  const [appts, setAppts] = useState<Ag[]>([]);
  const [loading, setLoading] = useState(true);
  const [fProf, setFProf] = useState("Todos");
  const [fCad, setFCad] = useState("Todas");
  const [sel, setSel] = useState<Ag | null>(null);
  const [novo, setNovo] = useState<{ colId: string; idx: number; data: string } | null>(null);
  // opções de visualização (client-side)
  const [compacta, setCompacta] = useState(false);
  const [ocultarFds, setOcultarFds] = useState(false);
  const [brilhoPassadas, setBrilhoPassadas] = useState(true);
  const [showOpts, setShowOpts] = useState(false);

  const SLOT_H = compacta ? 34 : 50;
  const hojeIso = iso(new Date());

  // janela [ini,fim] conforme a visão
  const [ini, fim] = useMemo(() => {
    if (visao === "semana") { const s = startOfWeek(ref); return [s, addDays(s, 6)]; }
    return [ref, ref];
  }, [visao, ref]);

  const load = useCallback(async () => {
    if (!companyId) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.rpc("fn_odonto_agenda_intervalo",
      { p_company_id: companyId, p_data_ini: iso(ini), p_data_fim: iso(fim) });
    if (!error && data) {
      setCadeiras(data.cadeiras || []); setProfs(data.profissionais || []);
      setProcs(data.procedimentos || []); setAppts(data.agendamentos || []);
    }
    setLoading(false);
  }, [companyId, ini, fim]);
  useEffect(() => { load(); }, [load]);

  const match = useCallback((a: Ag) =>
    (fProf === "Todos" || a.profissional_nome === fProf) &&
    (fCad === "Todas" || cadeiras.find(c => c.id === a.cadeira_id)?.nome === fCad),
    [fProf, fCad, cadeiras]);

  // Colunas da grade dependem da visão.
  const colunas = useMemo(() => {
    if (visao === "cadeira") return cadeiras.map(c => ({ id: c.id, label: c.nome, cor: GOLD }));
    if (visao === "dia") return profs.map(p => ({ id: p.id, label: p.nome, cor: p.cor }));
    // semana: 7 dias (ou 5, se ocultar fds)
    const dd: { id: string; label: string; cor: string }[] = [];
    for (let i = 0; i < 7; i++) { const d = addDays(ini, i); if (ocultarFds && (d.getDay() === 0 || d.getDay() === 6)) continue; dd.push({ id: iso(d), label: `${DIAS[d.getDay()]} ${d.getDate()}`, cor: iso(d) === hojeIso ? GOLD : ESP60 }); }
    return dd;
  }, [visao, cadeiras, profs, ini, ocultarFds, hojeIso]);

  const colOf = (a: Ag) => visao === "cadeira" ? a.cadeira_id : visao === "dia" ? (a.profissional_id || "") : (a.data || "");
  const dataOf = (colId: string) => visao === "semana" ? colId : iso(ref);

  const setStatus = async (a: Ag, status: string) => {
    await supabase.rpc("fn_odonto_agendamento_status", { p_id: a.id, p_status: status });
    setSel(null); load();
  };
  const addNovo = async (f: { pac: string; prof: string; cad: string; proc: string; dur: number; obs: string; status: string }) => {
    if (!novo || !companyId) return;
    const start = idxToTime(novo.idx);
    const endIdx = Math.min(N, novo.idx + (f.dur || 2));
    const { data: res, error } = await supabase.rpc("fn_odonto_agendar", {
      p_company_id: companyId, p_cadeira_id: f.cad, p_procedimento_id: f.proc || null,
      p_profissional_id: f.prof || null, p_paciente_nome: f.pac, p_data: novo.data,
      p_hora_inicio: start + ":00", p_hora_fim: idxToTime(endIdx) + ":00",
      p_paciente_id: null, p_observacao: f.obs || null,
    });
    if (error) { alert(error.message); return; }
    const novoId = (res as { id?: string } | null)?.id;
    if (novoId && f.status && f.status !== "agendado") {
      await supabase.rpc("fn_odonto_agendamento_status", { p_id: novoId, p_status: f.status });
    }
    setNovo(null); load();
  };

  // Ocupação do dia (visão cadeira/dia): slots ocupados / (colunas × slots).
  const ocupacao = useMemo(() => {
    if (visao === "semana" || colunas.length === 0) return null;
    let ocup = 0;
    for (const a of appts.filter(match)) {
      if (a.status === "cancelado") continue;
      ocup += Math.max(1, timeToIdx(a.hora_fim) - timeToIdx(a.hora_inicio));
    }
    return Math.round((ocup / (colunas.length * N)) * 100);
  }, [appts, colunas, visao, match]);

  if (!companyId) return (
    <div style={{ background: BG, color: ESP60, minHeight: "100%" }} className="p-6 text-sm">
      Selecione uma empresa específica no topo do menu para abrir a agenda.
    </div>
  );

  const tituloData = visao === "semana"
    ? `${ini.getDate()} ${MES[ini.getMonth()]} – ${fim.getDate()} ${MES[fim.getMonth()]}`
    : `${DIAS_LONG[ref.getDay()]}, ${ref.getDate()} ${MES[ref.getMonth()]}`;
  const step = visao === "semana" ? 7 : 1;

  return (
    <div style={{ background: BG, color: ESP, minHeight: "100%", fontFamily: "ui-sans-serif,system-ui,sans-serif" }} className="p-4 sm:p-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2" style={{ color: GOLD }}><Calendar size={18} />
            <span className="text-xs font-semibold tracking-widest uppercase">Agenda · Odonto</span></div>
          <h1 className="text-2xl sm:text-3xl mt-1" style={{ fontFamily: "ui-serif,Georgia,serif", fontWeight: 600 }}>Agenda</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Toggle de visão */}
          <div className="flex rounded-full p-0.5" style={{ background: "#fff", border: `1px solid ${LINE}` }}>
            <ViewBtn on={visao === "cadeira"} onClick={() => setVisao("cadeira")} icon={<LayoutGrid size={15} />} t="Cadeira" />
            <ViewBtn on={visao === "dia"} onClick={() => setVisao("dia")} icon={<Columns size={15} />} t="Dia" />
            <ViewBtn on={visao === "semana"} onClick={() => setVisao("semana")} icon={<CalendarDays size={15} />} t="Semana" />
          </div>
          {/* Navegação */}
          <div className="flex items-center gap-1 rounded-full px-1 py-1" style={{ background: "#fff", border: `1px solid ${LINE}` }}>
            <button onClick={() => setRef(d => addDays(d, -step))} className="p-2 rounded-full"><ChevronLeft size={18} /></button>
            <button onClick={() => setRef(new Date())} className="px-3 py-1 rounded-full text-sm font-medium"
              style={{ background: iso(ref) === hojeIso && visao !== "semana" ? GOLD : "transparent", color: iso(ref) === hojeIso && visao !== "semana" ? "#fff" : ESP }}>Hoje</button>
            <button onClick={() => setRef(d => addDays(d, step))} className="p-2 rounded-full"><ChevronRight size={18} /></button>
          </div>
          <input type="date" value={iso(ref)} onChange={e => e.target.value && setRef(new Date(e.target.value + "T00:00:00"))}
            className="rounded-full px-3 py-1.5 text-sm outline-none" style={{ background: "#fff", border: `1px solid ${LINE}`, color: ESP, colorScheme: "light" }} />
          <button onClick={() => { const c = fCad !== "Todas" ? cadeiras.find(x => x.nome === fCad)?.id : cadeiras[0]?.id; if (c) setNovo({ colId: c, idx: timeToIdx("09:00"), data: iso(ref) }); }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-semibold" style={{ background: "#166534", color: "#fff" }}>
            <Plus size={16} /> Novo
          </button>
          <div className="relative">
            <button onClick={() => setShowOpts(v => !v)} className="p-2 rounded-full" style={{ background: "#fff", border: `1px solid ${LINE}` }} title="Opções de visualização"><Sliders size={16} /></button>
            {showOpts && (
              <div className="absolute right-0 mt-2 w-56 rounded-xl p-2 text-sm z-40" style={{ background: "#fff", border: `1px solid ${LINE}`, boxShadow: "0 12px 30px rgba(61,35,20,0.18)" }}>
                <Opt t="Compacta" on={compacta} set={setCompacta} />
                {visao === "semana" && <Opt t="Ocultar fim de semana" on={ocultarFds} set={setOcultarFds} />}
                <Opt t="Reduzir brilho de passadas" on={brilhoPassadas} set={setBrilhoPassadas} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Data + filtros + legenda de status */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className="text-sm font-semibold" style={{ color: ESP }}>{tituloData}</span>
        <span className="flex items-center gap-1 text-sm ml-2" style={{ color: ESP60 }}><Filter size={15} /></span>
        <Sel value={fProf} onChange={setFProf} options={["Todos", ...profs.map(p => p.nome)]} />
        <Sel value={fCad} onChange={setFCad} options={["Todas", ...cadeiras.map(c => c.nome)]} />
        <div className="flex-1" />
        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_FLOW.map(s => (<span key={s} className="inline-flex items-center gap-1 text-[11px]" style={{ color: ESP60 }}>
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#fff", border: `2px solid ${STATUS[s].cor}` }} />{STATUS[s].label}</span>))}
        </div>
      </div>

      {loading ? <div className="py-20 text-center" style={{ color: ESP60 }}>Carregando agenda…</div> :
        colunas.length === 0 ? <EmptyState visao={visao} /> :
          <div className="rounded-2xl overflow-auto" style={{ border: `1px solid ${LINE}`, background: "#fff", maxHeight: 620 }}>
            <div style={{
              display: "grid", gridTemplateColumns: `56px repeat(${colunas.length},minmax(140px,1fr))`,
              gridTemplateRows: `40px repeat(${N},${SLOT_H}px)`, minWidth: 56 + colunas.length * 140, position: "relative"
            }}>
              {/* canto */}
              <div style={{ gridColumn: 1, gridRow: 1, position: "sticky", top: 0, left: 0, zIndex: 30, background: "#fff", borderBottom: `1px solid ${LINE}`, borderRight: `1px solid ${LINE}` }} />
              {/* cabeçalho de colunas */}
              {colunas.map((c, ci) => (
                <div key={c.id} style={{ gridColumn: ci + 2, gridRow: 1, position: "sticky", top: 0, zIndex: 20, background: "#fff", borderBottom: `1px solid ${LINE}`, borderRight: ci < colunas.length - 1 ? `1px solid ${LINE}` : "none" }}
                  className="flex items-center justify-center gap-2 text-sm font-semibold px-2 truncate">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.cor }} /><span className="truncate">{c.label}</span></div>))}
              {/* coluna de horas */}
              {Array.from({ length: N }).map((_, i) => (
                <div key={i} style={{ gridColumn: 1, gridRow: i + 2, position: "sticky", left: 0, zIndex: 10, background: "#fff", borderRight: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}` }}
                  className="flex items-start justify-end pr-2 pt-1">
                  <span className="text-[11px]" style={{ color: i % 2 ? "rgba(61,35,20,0.28)" : ESP60 }}>{idxToTime(i)}</span></div>))}
              {/* células vazias (clicáveis → novo) */}
              {colunas.map((c, ci) => Array.from({ length: N }).map((_, ri) => (
                <button key={`${c.id}-${ri}`} onClick={() => setNovo({ colId: c.id, idx: ri, data: dataOf(c.id) })}
                  style={{ gridColumn: ci + 2, gridRow: ri + 2, borderRight: ci < colunas.length - 1 ? `1px solid ${LINE}` : "none", borderBottom: `1px solid ${LINE}`, background: "transparent" }}
                  className="group flex items-center justify-center">
                  <Plus size={14} style={{ color: GOLD }} className="opacity-0 group-hover:opacity-50 transition-opacity" /></button>)))}
              {/* agendamentos */}
              {appts.map(a => {
                const ci = colunas.findIndex(c => c.id === colOf(a)); if (ci < 0) return null;
                const s = timeToIdx(a.hora_inicio), span = Math.max(1, timeToIdx(a.hora_fim) - s);
                if (s < 0 || s >= N) return null;
                const on = match(a);
                const st = STATUS[a.status] || STATUS.agendado;
                const passada = (a.data || iso(ref)) < hojeIso || ((a.data || iso(ref)) === hojeIso && timeToIdx(a.hora_fim) <= timeToIdx(`${pad(new Date().getHours())}:${new Date().getMinutes() >= 30 ? "30" : "00"}`));
                const dim = a.status === "concluido" || a.status === "cancelado" || (brilhoPassadas && passada);
                return (<button key={a.id} onClick={() => setSel(a)}
                  style={{
                    gridColumn: ci + 2, gridRow: `${s + 2} / span ${span}`, background: a.procedimento_cor || GOLD,
                    opacity: on ? (dim ? 0.55 : 1) : 0.16, zIndex: 15, margin: 3, borderRadius: 9, color: BG,
                    borderLeft: `4px solid ${st.cor}`, boxShadow: "0 1px 3px rgba(61,35,20,0.2)",
                  }}
                  className="text-left p-2 overflow-hidden flex flex-col">
                  <span className="flex items-center gap-1 text-[11px] font-medium opacity-90"><Clock size={11} />{a.hora_inicio}{a.status === "concluido" && <Check size={12} className="ml-auto" />}</span>
                  <span className="text-[13px] font-semibold leading-tight mt-0.5 truncate" style={{ textDecoration: a.status === "cancelado" ? "line-through" : "none" }}>{a.paciente_nome}</span>
                  {span > 1 && <span className="text-[11px] opacity-90 truncate">{a.procedimento_nome}</span>}
                  <span className="text-[10px] font-semibold mt-auto px-1.5 py-0.5 rounded self-start" style={{ background: "rgba(255,255,255,0.85)", color: st.cor }}>{st.label}</span>
                </button>);
              })}
            </div>
          </div>}

      {/* Rodapé: ocupação */}
      <div className="flex items-center justify-between flex-wrap gap-2 mt-3">
        <p className="text-xs" style={{ color: ESP60 }}>Toque num horário vazio para agendar · num agendamento para ver detalhes e mudar o status.
          {" "}<span style={{ color: "rgba(61,35,20,0.4)" }}>Arrastar-soltar, WhatsApp, lista de espera e link online chegam na Onda 1.5.</span></p>
        {ocupacao != null && (
          <div className="flex items-center gap-2 text-xs" style={{ color: ESP60 }}>
            <span>Ocupação de cadeira</span>
            <div className="w-28 h-2 rounded-full overflow-hidden" style={{ background: LINE }}>
              <div style={{ width: `${Math.min(100, ocupacao)}%`, height: "100%", background: ocupacao >= 75 && ocupacao <= 85 ? "#166534" : ocupacao > 85 ? "#A32D2D" : GOLD }} /></div>
            <b style={{ color: ESP }}>{ocupacao}%</b><span style={{ color: "rgba(61,35,20,0.4)" }}>(meta 75–85%)</span>
          </div>)}
      </div>

      {/* Detalhe + fluxo de status */}
      {sel && <Overlay onClose={() => setSel(null)}>
        <div className="h-1.5 rounded-t-2xl" style={{ background: (STATUS[sel.status] || STATUS.agendado).cor, margin: "-1px -1px 0" }} />
        <div className="p-5">
          <div className="flex items-start justify-between">
            <div><div className="text-xs font-semibold uppercase tracking-wider" style={{ color: sel.procedimento_cor || GOLD }}>{sel.procedimento_nome || "Sem procedimento"}</div>
              <h3 className="text-xl font-semibold mt-1" style={{ fontFamily: "ui-serif,Georgia,serif" }}>{sel.paciente_nome}</h3></div>
            <button onClick={() => setSel(null)} style={{ color: ESP60 }}><X size={20} /></button>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <Row l="Horário" v={`${sel.hora_inicio} – ${sel.hora_fim}`} />
            <Row l="Cadeira" v={cadeiras.find(c => c.id === sel.cadeira_id)?.nome || "-"} />
            <Row l="Profissional" v={sel.profissional_nome || "-"} />
            <Row l="Status atual" v={(STATUS[sel.status] || STATUS.agendado).label} />
          </div>
          <div className="mt-4">
            <div className="text-xs font-medium mb-1.5" style={{ color: ESP }}>Mudar status</div>
            <div className="grid grid-cols-3 gap-1.5">
              {STATUS_FLOW.map(s => (
                <button key={s} onClick={() => setStatus(sel, s)} disabled={s === sel.status}
                  className="py-2 rounded-lg text-xs font-semibold" style={{
                    background: s === sel.status ? STATUS[s].cor : "#fff", color: s === sel.status ? "#fff" : STATUS[s].cor,
                    border: `1.5px solid ${STATUS[s].cor}`, opacity: s === sel.status ? 1 : 0.9, cursor: s === sel.status ? "default" : "pointer",
                  }}>{STATUS[s].label}</button>))}
            </div>
          </div>
        </div>
      </Overlay>}

      {novo && <Overlay onClose={() => setNovo(null)}>
        <FormNovo
          data={novo.data} start={idxToTime(novo.idx)} cadeiras={cadeiras} profs={profs} procs={procs}
          cadeiraPre={visao === "cadeira" ? novo.colId : (fCad !== "Todas" ? cadeiras.find(c => c.nome === fCad)?.id : cadeiras[0]?.id) || ""}
          profPre={visao === "dia" ? novo.colId : (profs[0]?.id || "")}
          onCancel={() => setNovo(null)} onAdd={addNovo} />
      </Overlay>}
    </div>
  );
}

function ViewBtn({ on, onClick, icon, t }: { on: boolean; onClick: () => void; icon: React.ReactNode; t: string }) {
  return <button onClick={onClick} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium"
    style={{ background: on ? GOLD : "transparent", color: on ? "#fff" : ESP }}>{icon}<span className="hidden sm:inline">{t}</span></button>;
}
function Opt({ t, on, set }: { t: string; on: boolean; set: (v: boolean) => void }) {
  return <button onClick={() => set(!on)} className="w-full flex items-center justify-between px-2 py-2 rounded-lg hover:bg-black/[0.03]" style={{ color: ESP }}>
    <span>{t}</span><span className="w-9 h-5 rounded-full relative transition-colors" style={{ background: on ? GOLD : LINE }}>
      <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{ left: on ? 18 : 2 }} /></span></button>;
}
function Sel({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (<span className="inline-flex items-center gap-1 rounded-full px-2 py-1" style={{ background: "#fff", border: `1px solid ${LINE}` }}>
    <select value={value} onChange={e => onChange(e.target.value)} className="text-sm bg-white outline-none" style={{ background: "#fff", color: ESP, colorScheme: "light" }}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}</select></span>);
}
function Row({ l, v }: { l: string; v: string }) {
  return (<div className="flex justify-between border-b pb-2" style={{ borderColor: LINE }}>
    <span style={{ color: ESP60 }}>{l}</span><span className="font-medium">{v}</span></div>);
}
function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (<div onClick={onClose} className="fixed inset-0 flex items-center justify-center p-4" style={{ background: "rgba(61,35,20,0.45)", zIndex: 50 }}>
    <div onClick={e => e.stopPropagation()} className="w-full max-w-sm rounded-2xl overflow-hidden" style={{ background: "#fff", boxShadow: "0 20px 50px rgba(61,35,20,0.3)" }}>{children}</div></div>);
}
function EmptyState({ visao }: { visao: Visao }) {
  return (<div className="rounded-2xl p-10 text-center" style={{ border: `1px dashed ${LINE}`, background: "#fff", color: ESP60 }}>
    {visao === "dia" ? "Nenhum profissional cadastrado ainda." : "Nenhuma cadeira cadastrada ainda."} Cadastre {visao === "dia" ? "os dentistas" : "as cadeiras"} da clínica para começar a agendar.</div>);
}
function FormNovo({ data, start, cadeiras, profs, procs, cadeiraPre, profPre, onCancel, onAdd }: {
  data: string; start: string; cadeiras: Cad[]; profs: Prof[]; procs: Proc[]; cadeiraPre: string; profPre: string;
  onCancel: () => void; onAdd: (f: { pac: string; prof: string; cad: string; proc: string; dur: number; obs: string; status: string }) => void;
}) {
  const [pac, setPac] = useState(""), [prof, setProf] = useState(profPre || profs[0]?.id || ""), [cad, setCad] = useState(cadeiraPre || cadeiras[0]?.id || "");
  const [proc, setProc] = useState(procs[0]?.id || ""), [dur, setDur] = useState("2"), [obs, setObs] = useState(""), [status, setStatus] = useState("agendado");
  // duração automática do procedimento
  useEffect(() => { const p = procs.find(x => x.id === proc); if (p?.duracao_min) setDur(String(Math.max(1, Math.round(p.duracao_min / 30)))); }, [proc, procs]);
  const [d] = useState(() => new Date(data + "T00:00:00"));
  return (<div className="p-5">
    <div className="flex items-center justify-between mb-1"><h3 className="text-lg font-semibold" style={{ fontFamily: "ui-serif,Georgia,serif", color: ESP }}>Novo agendamento</h3>
      <button onClick={onCancel} style={{ color: ESP60 }}><X size={20} /></button></div>
    <div className="text-xs mb-4" style={{ color: ESP60 }}>{DIAS_LONG[d.getDay()]}, {d.getDate()} {MES[d.getMonth()]} · início {start}</div>
    <L t="Paciente" /><input value={pac} onChange={e => setPac(e.target.value)} placeholder="Buscar ou digitar o nome" className="w-full rounded-xl px-3 py-2 text-sm mb-3 outline-none" style={{ border: `1px solid ${LINE}`, color: ESP, background: "#fff", colorScheme: "light" }} />
    <div className="grid grid-cols-2 gap-2">
      <div><L t="Profissional" /><Sl v={prof} set={setProf} opts={profs.map(p => ({ v: p.id, l: p.nome }))} /></div>
      <div><L t="Cadeira" /><Sl v={cad} set={setCad} opts={cadeiras.map(c => ({ v: c.id, l: c.nome }))} /></div>
    </div>
    <L t="Procedimento" /><Sl v={proc} set={setProc} opts={procs.map(p => ({ v: p.id, l: p.nome }))} />
    <div className="grid grid-cols-2 gap-2">
      <div><L t="Duração" /><Sl v={dur} set={setDur} opts={[{ v: "1", l: "30 min" }, { v: "2", l: "1 hora" }, { v: "3", l: "1h30" }, { v: "4", l: "2 horas" }, { v: "6", l: "3 horas" }]} /></div>
      <div><L t="Status inicial" /><Sl v={status} set={setStatus} opts={STATUS_FLOW.filter(s => s !== "cancelado").map(s => ({ v: s, l: STATUS[s].label }))} /></div>
    </div>
    <L t="Observação" /><input value={obs} onChange={e => setObs(e.target.value)} placeholder="opcional" className="w-full rounded-xl px-3 py-2 text-sm mb-4 outline-none" style={{ border: `1px solid ${LINE}`, color: ESP, background: "#fff", colorScheme: "light" }} />
    <button onClick={() => onAdd({ pac: pac.trim() || "Paciente", prof, cad, proc, dur: Number(dur), obs, status })} className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2" style={{ background: "#166534", color: "#fff" }}>
      <Plus size={16} /> Adicionar à agenda</button>
  </div>);
}
function Sl({ v, set, opts }: { v: string; set: (x: string) => void; opts: { v: string; l: string }[] }) {
  return <select value={v} onChange={e => set(e.target.value)} className="w-full rounded-xl px-3 py-2 text-sm mb-3 outline-none bg-white" style={{ border: `1px solid ${LINE}`, color: ESP, background: "#fff", colorScheme: "light" }}>{opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</select>;
}
function L({ t }: { t: string }) { return <label className="block text-xs font-medium mb-1" style={{ color: ESP }}>{t}</label>; }
