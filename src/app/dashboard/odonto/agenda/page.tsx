"use client";
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, X, Plus, Check, Clock, Calendar, LayoutGrid, Columns, CalendarDays, Sliders } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ShellOdonto, PageHeaderOdonto, EmptyStateOdonto, ProgressBar, StatusDot, TOK, STATUS_ODONTO, STATUS_FLOW, st } from "@/components/odonto/ui";
import { ConsumoInsumos } from "@/components/odonto/ConsumoInsumos";

const { esp: ESP, bg: BG, gold: GOLD, line: LINE, mut: MUT } = TOK;
const H0 = 8, H1 = 20, N = (H1 - H0) * 2;      // 08:00–20:00, slots de 30 min
const pad = (n: number) => String(n).padStart(2, "0");
const idxToTime = (i: number) => `${pad(H0 + Math.floor(i / 2))}:${i % 2 ? "30" : "00"}`;
const timeToIdx = (t: string) => { const [h, m] = t.split(":").map(Number); return (h - H0) * 2 + (m >= 30 ? 1 : 0); };
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const DIAS_LONG = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

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
const startOfWeek = (d: Date) => addDays(d, -d.getDay());

export default function AgendaOdontoPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [clinica, setClinica] = useState<string>("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCompanyId(resolveCompanyId());
    const i = setInterval(() => { const a = resolveCompanyId(); setCompanyId(p => p === a ? p : a); }, 800);
    return () => clearInterval(i);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!companyId) { setClinica(""); return; }
    let alive = true;
    void supabase.from("companies").select("nome_fantasia,razao_social").eq("id", companyId).maybeSingle()
      .then(({ data }) => { if (alive) setClinica((data?.nome_fantasia || data?.razao_social || "").trim()); });
    return () => { alive = false; };
  }, [companyId]);

  const [visao, setVisao] = useState<Visao>("cadeira");
  const [ref, setRef] = useState<Date>(() => new Date());
  const [cadeiras, setCadeiras] = useState<Cad[]>([]);
  const [profs, setProfs] = useState<Prof[]>([]);
  const [procs, setProcs] = useState<Proc[]>([]);
  const [appts, setAppts] = useState<Ag[]>([]);
  const [loading, setLoading] = useState(true);
  const [fProf, setFProf] = useState("Todos");
  const [fCad, setFCad] = useState("Todas");
  const [selAg, setSelAg] = useState<Ag | null>(null);
  const [consumoAg, setConsumoAg] = useState<Ag | null>(null);
  const [novo, setNovo] = useState<{ colId: string; idx: number; data: string } | null>(null);
  const [compacta, setCompacta] = useState(false);
  const [ocultarFds, setOcultarFds] = useState(false);
  const [brilhoPassadas, setBrilhoPassadas] = useState(true);
  const [showOpts, setShowOpts] = useState(false);

  const SLOT_H = compacta ? 34 : 48;
  const hojeIso = iso(new Date());
  const umDia = visao !== "semana";

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
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const match = useCallback((a: Ag) =>
    (fProf === "Todos" || a.profissional_nome === fProf) &&
    (fCad === "Todas" || cadeiras.find(c => c.id === a.cadeira_id)?.nome === fCad),
    [fProf, fCad, cadeiras]);

  // dentista dominante por cadeira (deriva do dado, sem tocar backend)
  const dentistaPorCadeira = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const c of cadeiras) {
      const nomes = new Set(appts.filter(a => a.cadeira_id === c.id && a.profissional_nome).map(a => a.profissional_nome!));
      m.set(c.id, nomes.size === 1 ? [...nomes][0] : null);
    }
    return m;
  }, [cadeiras, appts]);

  const colunas = useMemo(() => {
    if (visao === "cadeira") return cadeiras.map(c => ({ id: c.id, label: c.nome, sub: dentistaPorCadeira.get(c.id) || undefined, cor: GOLD }));
    if (visao === "dia") return profs.map(p => ({ id: p.id, label: p.nome, sub: undefined, cor: p.cor }));
    const dd: { id: string; label: string; sub?: string; cor: string }[] = [];
    for (let i = 0; i < 7; i++) { const d = addDays(ini, i); if (ocultarFds && (d.getDay() === 0 || d.getDay() === 6)) continue; dd.push({ id: iso(d), label: `${DIAS[d.getDay()]} ${d.getDate()}`, cor: iso(d) === hojeIso ? GOLD : MUT }); }
    return dd;
  }, [visao, cadeiras, profs, ini, ocultarFds, hojeIso, dentistaPorCadeira]);

  const colOf = (a: Ag) => visao === "cadeira" ? a.cadeira_id : visao === "dia" ? (a.profissional_id || "") : (a.data || "");
  const dataOf = (colId: string) => visao === "semana" ? colId : iso(ref);

  const mudarStatus = async (a: Ag, status: string) => {
    await supabase.rpc("fn_odonto_agendamento_status", { p_id: a.id, p_status: status });
    setSelAg(null); load();
    // Concluiu → confirmar consumo de insumos (baixa do estoque GE). Cancelou → oferecer estorno na ficha.
    if (status === "concluido") setConsumoAg(a);
  };
  const addNovo = async (f: { pac: string; prof: string; cad: string; proc: string; dur: number; obs: string; status: string }) => {
    if (!novo || !companyId) return;
    const start = idxToTime(novo.idx), endIdx = Math.min(N, novo.idx + (f.dur || 2));
    const { data: res, error } = await supabase.rpc("fn_odonto_agendar", {
      p_company_id: companyId, p_cadeira_id: f.cad, p_procedimento_id: f.proc || null,
      p_profissional_id: f.prof || null, p_paciente_nome: f.pac, p_data: novo.data,
      p_hora_inicio: start + ":00", p_hora_fim: idxToTime(endIdx) + ":00", p_paciente_id: null, p_observacao: f.obs || null,
    });
    if (error) { alert(error.message); return; }
    const novoId = (res as { id?: string } | null)?.id;
    if (novoId && f.status && f.status !== "agendado") await supabase.rpc("fn_odonto_agendamento_status", { p_id: novoId, p_status: f.status });
    setNovo(null); load();
  };

  const ocupacao = useMemo(() => {
    if (visao === "semana" || colunas.length === 0) return null;
    let ocup = 0;
    for (const a of appts.filter(match)) { if (a.status === "cancelado") continue; ocup += Math.max(1, timeToIdx(a.hora_fim) - timeToIdx(a.hora_inicio)); }
    return Math.round((ocup / (colunas.length * N)) * 100);
  }, [appts, colunas, visao, match]);

  if (!companyId) return (
    <ShellOdonto><EmptyStateOdonto titulo="Escolha uma clínica" linha="Selecione uma empresa específica no topo do menu para abrir a agenda." /></ShellOdonto>
  );

  const tituloData = visao === "semana"
    ? `${ini.getDate()} ${MES[ini.getMonth()]} – ${fim.getDate()} ${MES[fim.getMonth()]}`
    : `${DIAS_LONG[ref.getDay()]}, ${ref.getDate()} ${MES[ref.getMonth()]}`;
  const step = visao === "semana" ? 7 : 1;

  const acoes = (<>
    <div className="flex" style={{ background: BG, border: `0.5px solid ${LINE}`, borderRadius: TOK.rCtrl, padding: 2 }}>
      <ViewBtn on={visao === "cadeira"} onClick={() => setVisao("cadeira")} icon={<LayoutGrid size={15} />} t="Cadeira" />
      <ViewBtn on={visao === "dia"} onClick={() => setVisao("dia")} icon={<Columns size={15} />} t="Dia" />
      <ViewBtn on={visao === "semana"} onClick={() => setVisao("semana")} icon={<CalendarDays size={15} />} t="Semana" />
    </div>
    <button onClick={() => { const c = fCad !== "Todas" ? cadeiras.find(x => x.nome === fCad)?.id : cadeiras[0]?.id; if (c) setNovo({ colId: c, idx: timeToIdx("09:00"), data: iso(ref) }); }}
      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm" style={{ background: GOLD, color: "#fff", borderRadius: TOK.rCtrl, fontWeight: 500 }}>
      <Plus size={16} /> Novo
    </button>
    <a href="/dashboard/odonto/gestao-agenda" title="Gestão da Agenda — cadeiras e profissionais"
      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm" style={{ background: TOK.card, color: TOK.esp, border: `0.5px solid ${LINE}`, borderRadius: TOK.rCtrl, fontWeight: 500, textDecoration: "none" }}>
      ⚙️ Gestão
    </a>
    <div className="relative">
      <button onClick={() => setShowOpts(v => !v)} className="p-2" style={{ background: TOK.card, border: `0.5px solid ${LINE}`, borderRadius: TOK.rCtrl }} title="Opções de visualização"><Sliders size={16} /></button>
      {showOpts && (
        <div className="absolute right-0 mt-2 w-56 p-2 text-sm z-40" style={{ background: "#fff", border: `0.5px solid ${LINE}`, borderRadius: 12, boxShadow: "0 12px 30px rgba(61,35,20,0.15)" }}>
          <Opt t="Compacta" on={compacta} set={setCompacta} />
          {visao === "semana" && <Opt t="Ocultar fim de semana" on={ocultarFds} set={setOcultarFds} />}
          <Opt t="Reduzir brilho de passadas" on={brilhoPassadas} set={setBrilhoPassadas} />
        </div>
      )}
    </div>
  </>);

  const faixa2 = (<>
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1" style={{ background: "#fff", border: `0.5px solid ${LINE}`, borderRadius: 999, padding: 2 }}>
        <button onClick={() => setRef(d => addDays(d, -step))} className="p-1.5 rounded-full"><ChevronLeft size={17} /></button>
        <span className="px-2 text-sm" style={{ fontWeight: 500, minWidth: 150, textAlign: "center" }}>{tituloData}</span>
        <button onClick={() => setRef(d => addDays(d, step))} className="p-1.5 rounded-full"><ChevronRight size={17} /></button>
      </div>
      <button onClick={() => setRef(new Date())} className="px-3 py-1.5 text-sm" style={{ background: iso(ref) === hojeIso && umDia ? GOLD : "#fff", color: iso(ref) === hojeIso && umDia ? "#fff" : ESP, border: `0.5px solid ${LINE}`, borderRadius: TOK.rCtrl }}>Hoje</button>
      <input type="date" value={iso(ref)} onChange={e => e.target.value && setRef(new Date(e.target.value + "T00:00:00"))}
        className="px-2.5 py-1.5 text-sm outline-none" style={{ background: "#fff", border: `0.5px solid ${LINE}`, borderRadius: TOK.rCtrl, color: ESP, colorScheme: "light" }} />
      <SelPill value={fProf} onChange={setFProf} options={["Todos", ...profs.map(p => p.nome)]} />
      <SelPill value={fCad} onChange={setFCad} options={["Todas", ...cadeiras.map(c => c.nome)]} />
    </div>
    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">{STATUS_FLOW.map(s => <StatusDot key={s} status={s} />)}</div>
  </>);

  return (
    <ShellOdonto>
      <PageHeaderOdonto icon={<Calendar size={20} />} titulo="Agenda" subtitulo={clinica || "Clínica odontológica"} acoes={acoes} faixa2={faixa2} />

      {loading ? <div className="py-20 text-center" style={{ color: MUT }}>Carregando agenda…</div> :
        colunas.length === 0 ? <EmptyStateOdonto titulo={visao === "dia" ? "Cadastre os dentistas" : "Cadastre as cadeiras"} linha="Configure a clínica para começar a agendar os pacientes." /> :
          <div style={{ border: `0.5px solid ${LINE}`, borderRadius: TOK.rCard, background: "#fff", overflow: "auto", width: "100%", maxHeight: 640 }}>
            <div style={{
              display: "grid", gridTemplateColumns: `52px repeat(${colunas.length},minmax(120px,1fr))`,
              gridTemplateRows: `48px repeat(${N},${SLOT_H}px)`, width: "100%", minWidth: 52 + colunas.length * 120, position: "relative",
            }}>
              <div style={{ gridColumn: 1, gridRow: 1, position: "sticky", top: 0, left: 0, zIndex: 30, background: "#fff", borderBottom: `0.5px solid ${LINE}`, borderRight: `0.5px solid ${LINE}` }} />
              {colunas.map((c, ci) => (
                <div key={c.id} style={{ gridColumn: ci + 2, gridRow: 1, position: "sticky", top: 0, zIndex: 20, background: "#fff", borderBottom: `0.5px solid ${LINE}`, borderRight: ci < colunas.length - 1 ? `0.5px solid ${LINE}` : "none" }}
                  className="flex items-center gap-2 px-3">
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: c.cor, flexShrink: 0 }} />
                  <span style={{ fontSize: 13.5, fontWeight: 500, color: ESP }} className="truncate">{c.label}</span>
                  {c.sub && <span style={{ fontSize: 11.5, color: MUT, marginLeft: "auto" }} className="truncate">{c.sub}</span>}
                </div>))}
              {Array.from({ length: N }).map((_, i) => (
                <div key={i} style={{ gridColumn: 1, gridRow: i + 2, position: "sticky", left: 0, zIndex: 10, background: "#fff", borderRight: `0.5px solid ${LINE}`, borderBottom: `0.5px solid ${LINE}` }}
                  className="flex items-start justify-end pr-1.5 pt-1">
                  <span style={{ fontSize: 11, color: i % 2 ? TOK.mut30 : MUT }}>{idxToTime(i)}</span></div>))}
              {colunas.map((c, ci) => Array.from({ length: N }).map((_, ri) => (
                <button key={`${c.id}-${ri}`} onClick={() => setNovo({ colId: c.id, idx: ri, data: dataOf(c.id) })}
                  style={{ gridColumn: ci + 2, gridRow: ri + 2, borderRight: ci < colunas.length - 1 ? `0.5px solid ${LINE}` : "none", borderBottom: `0.5px solid ${LINE}`, background: "transparent" }}
                  className="group flex items-center justify-center">
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1" style={{ fontSize: 11, color: MUT, border: `1px dashed ${LINE}`, borderRadius: 6, padding: "1px 7px" }}><Plus size={11} style={{ color: GOLD }} /> livre</span>
                </button>)))}
              {appts.map(a => {
                const ci = colunas.findIndex(c => c.id === colOf(a)); if (ci < 0) return null;
                const s = timeToIdx(a.hora_inicio), span = Math.max(1, timeToIdx(a.hora_fim) - s);
                if (s < 0 || s >= N) return null;
                const on = match(a), S = st(a.status);
                const passada = (a.data || iso(ref)) < hojeIso;
                const dim = a.status === "concluido" || a.status === "cancelado" || (brilhoPassadas && passada);
                return (<button key={a.id} onClick={() => setSelAg(a)}
                  style={{
                    gridColumn: ci + 2, gridRow: `${s + 2} / span ${span}`, background: S.bg, borderLeft: `3px solid ${S.cor}`,
                    borderRadius: "0 8px 8px 0", opacity: on ? (dim ? 0.62 : 1) : 0.2, zIndex: 15, margin: "2px 3px 2px 0",
                    color: ESP, boxShadow: "0 1px 2px rgba(61,35,20,0.06)",
                  }}
                  className="text-left px-2.5 py-1.5 overflow-hidden flex flex-col hover:brightness-[0.98] transition-all">
                  <span style={{ fontSize: 13, fontWeight: 500, color: ESP, textDecoration: a.status === "cancelado" ? "line-through" : "none" }} className="truncate leading-tight">{a.paciente_nome}</span>
                  <span style={{ fontSize: 11, color: S.cor }} className="truncate mt-0.5 flex items-center gap-1">
                    <Clock size={10} />{a.hora_inicio}{a.procedimento_nome && span > 1 ? ` · ${a.procedimento_nome}` : ""}{a.status === "concluido" && <Check size={11} className="ml-auto" />}</span>
                </button>);
              })}
            </div>
          </div>}

      <div className="flex items-center justify-between flex-wrap gap-2 mt-3">
        <p style={{ fontSize: 12, color: MUT }}>Toque num horário livre para agendar · num agendamento para ver detalhes e mudar o status.
          {" "}<span title="Confirmação por WhatsApp (24h/2h), encaixe pela lista de espera e link de agendamento online chegam na Onda 1.5." style={{ color: TOK.mut30, cursor: "help", borderBottom: `1px dotted ${LINE}` }}>Automações · em breve</span></p>
        {ocupacao != null && (
          <div className="flex items-center gap-2" style={{ fontSize: 12, color: MUT }}>
            <span>Ocupação de cadeira</span>
            <ProgressBar pct={ocupacao} cor={ocupacao >= 75 && ocupacao <= 85 ? TOK.green : ocupacao > 85 ? TOK.red : GOLD} />
            <b style={{ color: ESP }}>{ocupacao}%</b><span style={{ color: TOK.mut30 }}>meta 75–85%</span>
          </div>)}
      </div>

      {selAg && <Overlay onClose={() => setSelAg(null)}>
        <div style={{ height: 4, background: st(selAg.status).cor }} />
        <div className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: st(selAg.status).cor }}>{st(selAg.status).label}</div>
              <h3 style={{ fontSize: 20, fontWeight: 500, marginTop: 2 }}>{selAg.paciente_nome}</h3>
            </div>
            <button onClick={() => setSelAg(null)} style={{ color: MUT }}><X size={20} /></button>
          </div>
          <div className="mt-4 space-y-2" style={{ fontSize: 14 }}>
            <Row l="Horário" v={`${selAg.hora_inicio} – ${selAg.hora_fim}`} />
            <Row l="Cadeira" v={cadeiras.find(c => c.id === selAg.cadeira_id)?.nome || "—"} />
            <Row l="Profissional" v={selAg.profissional_nome || "—"} />
            <Row l="Procedimento" v={selAg.procedimento_nome || "—"} />
          </div>
          <div className="mt-4">
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Mudar status</div>
            <div className="grid grid-cols-3 gap-1.5">
              {STATUS_FLOW.map(s => { const S = STATUS_ODONTO[s]; const on = s === selAg.status; return (
                <button key={s} onClick={() => mudarStatus(selAg, s)} disabled={on}
                  style={{ padding: "8px 4px", borderRadius: 8, fontSize: 12, fontWeight: 500, background: on ? S.cor : S.bg, color: on ? "#fff" : S.cor, border: `0.5px solid ${on ? S.cor : "transparent"}`, cursor: on ? "default" : "pointer" }}>{S.label}</button>); })}
            </div>
          </div>
          {selAg.status === "concluido" && (
            <button onClick={() => { const a = selAg; setSelAg(null); setConsumoAg(a); }} className="mt-3 w-full py-2.5 text-sm inline-flex items-center justify-center gap-2" style={{ background: GOLD, color: "#fff", borderRadius: TOK.rCtrl, fontWeight: 600 }}>
              Confirmar consumo de insumos
            </button>
          )}
        </div>
      </Overlay>}

      {consumoAg && companyId && <ConsumoInsumos agendamentoId={consumoAg.id} procedimentoNome={consumoAg.procedimento_nome} onClose={() => setConsumoAg(null)} onDone={() => load()} />}

      {novo && <Overlay onClose={() => setNovo(null)}>
        <FormNovo data={novo.data} start={idxToTime(novo.idx)} cadeiras={cadeiras} profs={profs} procs={procs}
          cadeiraPre={visao === "cadeira" ? novo.colId : (fCad !== "Todas" ? cadeiras.find(c => c.nome === fCad)?.id : cadeiras[0]?.id) || ""}
          profPre={visao === "dia" ? novo.colId : (profs[0]?.id || "")}
          onCancel={() => setNovo(null)} onAdd={addNovo} />
      </Overlay>}
    </ShellOdonto>
  );
}

function ViewBtn({ on, onClick, icon, t }: { on: boolean; onClick: () => void; icon: React.ReactNode; t: string }) {
  return <button onClick={onClick} className="flex items-center gap-1.5 px-3 py-1.5 text-sm" style={{ background: on ? GOLD : "transparent", color: on ? "#fff" : ESP, borderRadius: 6, fontWeight: on ? 500 : 400 }}>{icon}<span className="hidden sm:inline">{t}</span></button>;
}
function Opt({ t, on, set }: { t: string; on: boolean; set: (v: boolean) => void }) {
  return <button onClick={() => set(!on)} className="w-full flex items-center justify-between px-2 py-2 rounded-lg hover:bg-black/[0.03]" style={{ color: ESP }}>
    <span>{t}</span><span className="w-9 h-5 rounded-full relative transition-colors" style={{ background: on ? GOLD : LINE }}>
      <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{ left: on ? 18 : 2 }} /></span></button>;
}
function SelPill({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (<span className="inline-flex items-center px-2 py-1" style={{ background: "#fff", border: `0.5px solid ${LINE}`, borderRadius: TOK.rCtrl }}>
    <select value={value} onChange={e => onChange(e.target.value)} className="text-sm bg-white outline-none" style={{ background: "#fff", color: ESP, colorScheme: "light" }}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}</select></span>);
}
function Row({ l, v }: { l: string; v: string }) {
  return (<div className="flex justify-between pb-2" style={{ borderBottom: `0.5px solid ${LINE}` }}>
    <span style={{ color: MUT }}>{l}</span><span style={{ fontWeight: 500 }}>{v}</span></div>);
}
function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (<div onClick={onClose} className="fixed inset-0 flex items-center justify-center p-4" style={{ background: "rgba(61,35,20,0.42)", zIndex: 50 }}>
    <div onClick={e => e.stopPropagation()} className="w-full max-w-sm overflow-hidden" style={{ background: "#fff", borderRadius: TOK.rCard, boxShadow: "0 20px 50px rgba(61,35,20,0.28)" }}>{children}</div></div>);
}
function FormNovo({ data, start, cadeiras, profs, procs, cadeiraPre, profPre, onCancel, onAdd }: {
  data: string; start: string; cadeiras: Cad[]; profs: Prof[]; procs: Proc[]; cadeiraPre: string; profPre: string;
  onCancel: () => void; onAdd: (f: { pac: string; prof: string; cad: string; proc: string; dur: number; obs: string; status: string }) => void;
}) {
  const [pac, setPac] = useState(""), [prof, setProf] = useState(profPre || profs[0]?.id || ""), [cad, setCad] = useState(cadeiraPre || cadeiras[0]?.id || "");
  const [proc, setProc] = useState(procs[0]?.id || ""), [dur, setDur] = useState("2"), [obs, setObs] = useState(""), [status, setStatus] = useState("agendado");
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { const p = procs.find(x => x.id === proc); if (p?.duracao_min) setDur(String(Math.max(1, Math.round(p.duracao_min / 30)))); }, [proc, procs]);
  const [d] = useState(() => new Date(data + "T00:00:00"));
  return (<div className="p-5">
    <div className="flex items-center justify-between mb-1"><h3 style={{ fontSize: 18, fontWeight: 500, color: ESP }}>Novo agendamento</h3>
      <button onClick={onCancel} style={{ color: MUT }}><X size={20} /></button></div>
    <div style={{ fontSize: 12, color: MUT, marginBottom: 14 }}>{DIAS_LONG[d.getDay()]}, {d.getDate()} {MES[d.getMonth()]} · início {start}</div>
    <L t="Paciente" /><input value={pac} onChange={e => setPac(e.target.value)} placeholder="Buscar ou digitar o nome" className="w-full px-3 py-2 text-sm mb-3 outline-none" style={{ border: `0.5px solid ${LINE}`, borderRadius: TOK.rCtrl, color: ESP, background: "#fff", colorScheme: "light" }} />
    <div className="grid grid-cols-2 gap-2">
      <div><L t="Profissional" /><Sl v={prof} set={setProf} opts={profs.map(p => ({ v: p.id, l: p.nome }))} /></div>
      <div><L t="Cadeira" /><Sl v={cad} set={setCad} opts={cadeiras.map(c => ({ v: c.id, l: c.nome }))} /></div>
    </div>
    <L t="Procedimento" /><Sl v={proc} set={setProc} opts={procs.map(p => ({ v: p.id, l: p.nome }))} />
    <div className="grid grid-cols-2 gap-2">
      <div><L t="Duração" /><Sl v={dur} set={setDur} opts={[{ v: "1", l: "30 min" }, { v: "2", l: "1 hora" }, { v: "3", l: "1h30" }, { v: "4", l: "2 horas" }, { v: "6", l: "3 horas" }]} /></div>
      <div><L t="Status inicial" /><Sl v={status} set={setStatus} opts={STATUS_FLOW.filter(s => s !== "cancelado").map(s => ({ v: s, l: STATUS_ODONTO[s].label }))} /></div>
    </div>
    <L t="Observação" /><input value={obs} onChange={e => setObs(e.target.value)} placeholder="opcional" className="w-full px-3 py-2 text-sm mb-4 outline-none" style={{ border: `0.5px solid ${LINE}`, borderRadius: TOK.rCtrl, color: ESP, background: "#fff", colorScheme: "light" }} />
    <button onClick={() => onAdd({ pac: pac.trim() || "Paciente", prof, cad, proc, dur: Number(dur), obs, status })} className="w-full py-2.5 text-sm flex items-center justify-center gap-2" style={{ background: GOLD, color: "#fff", borderRadius: TOK.rCtrl, fontWeight: 500 }}>
      <Plus size={16} /> Adicionar à agenda</button>
  </div>);
}
function Sl({ v, set, opts }: { v: string; set: (x: string) => void; opts: { v: string; l: string }[] }) {
  return <select value={v} onChange={e => set(e.target.value)} className="w-full px-3 py-2 text-sm mb-3 outline-none bg-white" style={{ border: `0.5px solid ${LINE}`, borderRadius: TOK.rCtrl, color: ESP, background: "#fff", colorScheme: "light" }}>{opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</select>;
}
function L({ t }: { t: string }) { return <label className="block mb-1" style={{ fontSize: 12, fontWeight: 500, color: ESP }}>{t}</label>; }
