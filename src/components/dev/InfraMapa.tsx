"use client";
// Mapa da Infra (CEO 14/10): cada nó do desenho esperado (erp_infra_no) com cor de estado, último batimento e tolerância.
// Fonte: fn_infra_mapa() (só equipe PS). Edição de cadência/tolerância: fn_infra_no_configurar (só PS_ADMIN, versiona).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, RefreshCw } from "lucide-react";

type No = { chave: string; nome: string; tipo: string; dono: string | null; ordem: number; cadencia_min: number | null; tolerancia_min: number | null;
  descricao: string | null; ultimo_batimento: string | null; atraso_min: number | null; estado: "verde" | "amarelo" | "vermelho" | "sem_cadencia" };
type Mapa = { versao: number | null; nos: No[]; ligacoes: { de: string; para: string; rotulo: string | null }[] };

type Metas = { prontas_esperando: number; meta_prontas_max: number; prontas_semaforo: "verde" | "amarelo" | "vermelho"; pode_abrir_pr: boolean; tendencia: string;
  publicadas_ultima_hora: number; media_movel_3h: number; meta_publicacoes_hora: number; publicacoes_semaforo: "verde" | "amarelo" | "vermelho"; por_hora: { hora: string; publicadas: number }[] };

type ChamadoCode = { code: string; carteira: string | null; abertos: number; esperando_ps: number; aguardando_cliente: number; mais_antigo_dias: number; parados_48h: number; alerta: boolean };

const ROTA = "/dashboard/dev/infra";
const COR = { verde: "#1baf7a", amarelo: "#C8941A", vermelho: "#C0392B", sem_cadencia: "#7A6A5E" } as const;
const TXT = { verde: "Na cadência", amarelo: "Atrasado", vermelho: "Parado", sem_cadencia: "Sem cadência" } as const;
const ICONE = { verde: CheckCircle2, amarelo: AlertTriangle, vermelho: XCircle, sem_cadencia: MinusCircle } as const;

function quando(iso: string | null) {
  if (!iso) return "sem batimento";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "agora" : m < 90 ? `há ${m} min` : `há ${Math.round(m / 60)} h`;
}

export default function InfraMapa() {
  const [mapa, setMapa] = useState<Mapa | null>(null);
  const [metas, setMetas] = useState<Metas | null>(null);
  const [chamados, setChamados] = useState<ChamadoCode[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [edit, setEdit] = useState<No | null>(null);
  const [cad, setCad] = useState(""); const [tol, setTol] = useState(""); const [msg, setMsg] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("fn_infra_mapa");
    if (error) { setErro(error.message); return; }
    setErro(null); setMapa(data as Mapa);
    const m = await supabase.rpc("fn_infra_metas");
    if (!m.error) setMetas(m.data as Metas);
    const c = await supabase.rpc("fn_infra_chamados_por_code");
    if (!c.error) setChamados((c.data as ChamadoCode[]) ?? []);
  }, []);
  useEffect(() => {
    void carregar();
    const t = setInterval(() => void carregar(), 30000);
    const canal = supabase.channel("infra_batimento").on("postgres_changes", { event: "*", schema: "public", table: "erp_infra_batimento" }, () => void carregar()).subscribe();
    return () => { clearInterval(t); void supabase.removeChannel(canal); };
  }, [carregar]);

  async function salvar() {
    if (!edit) return;
    const { error } = await supabase.rpc("fn_infra_no_configurar", { p_no: edit.chave, p_cadencia_min: cad === "" ? null : Number(cad), p_tolerancia_min: tol === "" ? null : Number(tol), p_motivo: "ajuste pela tela Mapa da Infra" });
    setMsg(error ? `Não salvou: ${error.message}` : "Salvo (nova versão do desenho).");
    if (!error) { setEdit(null); void carregar(); }
  }

  const nos = mapa?.nos ?? [];
  const grupos = nos.reduce<Record<string, No[]>>((a, n) => { (a[n.tipo] ??= []).push(n); return a; }, {});
  const cont = (e: string) => nos.filter((n) => n.estado === e).length;

  return (
    <div style={{ background: "#fff", color: "#2A1A10", padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ color: "#C8941A", fontSize: 22, margin: "0 0 4px" }}>Mapa da Infra</h1>
      <p style={{ color: "#7A6A5E", margin: "0 0 12px" }}>Desenho esperado v{mapa?.versao ?? "—"} × batimento real. Atualiza sozinho.
        <AjudaCampo chave="dev.infra.mapa" rota={ROTA} />
        <button onClick={() => void carregar()} aria-label="Atualizar" style={{ marginLeft: 8, border: 0, background: "none", cursor: "pointer" }}><RefreshCw size={16} strokeWidth={1.5} /></button>
      </p>
      {erro && <p role="alert" style={{ color: COR.vermelho }}>Sem acesso ao mapa: {erro}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {(["verde", "amarelo", "vermelho", "sem_cadencia"] as const).map((e) => (
          <span key={e} style={{ border: "1px solid #E8E2D6", borderRadius: 8, padding: "6px 10px", color: COR[e] }}>{TXT[e]}: <b>{cont(e)}</b>
            {e === "verde" && <AjudaCampo chave="dev.infra.estado" rota={ROTA} />}</span>
        ))}
      </div>
      {metas && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 10, marginBottom: 16 }}>
          <div style={{ border: "1px solid #E8E2D6", borderLeft: `4px solid ${COR[metas.prontas_semaforo]}`, borderRadius: 8, padding: 10 }}>
            <b>PRs prontas esperando</b><AjudaCampo chave="dev.infra.meta_prontas" rota={ROTA} />
            <div style={{ fontSize: 26, color: COR[metas.prontas_semaforo] }}>{metas.prontas_esperando} <span style={{ fontSize: 13, color: "#7A6A5E" }}>meta ≤ {metas.meta_prontas_max} · {TXT[metas.prontas_semaforo === "verde" ? "verde" : metas.prontas_semaforo]} · {metas.tendencia}</span></div>
            <div style={{ fontSize: 13 }}>Pode abrir PR nova? <b>{metas.pode_abrir_pr ? "sim" : "não"}</b><AjudaCampo chave="dev.infra.pode_abrir_pr" rota={ROTA} /></div>
          </div>
          <div style={{ border: "1px solid #E8E2D6", borderLeft: `4px solid ${COR[metas.publicacoes_semaforo]}`, borderRadius: 8, padding: 10 }}>
            <b>Publicações por hora</b><AjudaCampo chave="dev.infra.meta_publicacoes" rota={ROTA} />
            <div style={{ fontSize: 26, color: COR[metas.publicacoes_semaforo] }}>{metas.media_movel_3h}/h <span style={{ fontSize: 13, color: "#7A6A5E" }}>média 3 h · meta ≥ {metas.meta_publicacoes_hora} · última hora {metas.publicadas_ultima_hora}</span></div>
            <div role="img" aria-label="Publicações por hora, últimas 24 horas" style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 48, position: "relative" }}>
              {metas.por_hora.map((h) => <span key={h.hora} title={`${new Date(h.hora).getHours()}h: ${h.publicadas}`} style={{ flex: 1, height: `${Math.min(100, (h.publicadas / (metas.meta_publicacoes_hora * 2)) * 100)}%`, minHeight: 2, background: h.publicadas >= metas.meta_publicacoes_hora ? COR.verde : h.publicadas >= 2 ? COR.amarelo : COR.vermelho }} />)}
              <span aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: "50%", borderTop: "1px dashed #7A6A5E" }} />
            </div>
          </div>
        </div>
      )}
      {chamados.length > 0 && (
        <section style={{ marginBottom: 16 }}>
          <h2 style={{ color: "#C8941A", fontSize: 15, margin: "8px 0" }}>Chamados por Code<AjudaCampo chave="dev.infra.chamados_code" rota={ROTA} /></h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 10 }}>
            {chamados.map((c) => { const I = c.alerta ? AlertTriangle : CheckCircle2; const cor = c.alerta ? COR.vermelho : COR.verde; return (
              <div key={c.code} style={{ border: "1px solid #E8E2D6", borderLeft: `4px solid ${cor}`, borderRadius: 8, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><b>{c.code}</b><span style={{ color: cor, display: "flex", gap: 4, fontSize: 13 }}><I size={16} strokeWidth={1.5} />{c.alerta ? `${c.parados_48h} parado(s) > 48 h` : "em dia"}</span></div>
                <div style={{ fontSize: 13, color: "#7A6A5E" }}>Carteira: {c.carteira ?? "central"}</div>
                <div style={{ fontSize: 13 }}>Esperando a PS: <b>{c.esperando_ps}</b> · aguardando cliente: {c.aguardando_cliente} · mais antigo: {c.mais_antigo_dias} d</div>
              </div>); })}
          </div>
        </section>
      )}
      {Object.entries(grupos).map(([tipo, lista], i, arr) => (
        <section key={tipo} style={{ marginBottom: 8 }}>
          <h2 style={{ color: "#C8941A", fontSize: 15, textTransform: "capitalize", margin: "8px 0" }}>{tipo}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 10 }}>
            {lista.map((n) => { const I = ICONE[n.estado]; return (
              <div key={n.chave} style={{ border: `1px solid #E8E2D6`, borderLeft: `4px solid ${COR[n.estado]}`, borderRadius: 8, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                  <b>{n.nome}</b><span style={{ color: COR[n.estado], display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}><I size={16} strokeWidth={1.5} />{TXT[n.estado]}</span>
                </div>
                <div style={{ fontSize: 13, color: "#7A6A5E" }}>Último batimento: {quando(n.ultimo_batimento)}
                  <AjudaCampo chave="dev.infra.batimento" rota={ROTA} /></div>
                <div style={{ fontSize: 13, color: "#7A6A5E" }}>Cadência {n.cadencia_min ?? "—"} min · tolerância {n.tolerancia_min ?? "—"} min · dono {n.dono ?? "—"}</div>
                {n.descricao && <div style={{ fontSize: 12, color: "#7A6A5E", marginTop: 4 }}>{n.descricao}</div>}
                <button onClick={() => { setEdit(n); setCad(String(n.cadencia_min ?? "")); setTol(String(n.tolerancia_min ?? "")); setMsg(null); }}
                  style={{ marginTop: 6, border: "1px solid #E8E2D6", background: "#fff", borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}>Configurar</button>
              </div>); })}
          </div>
          {i < arr.length - 1 && <div aria-hidden style={{ textAlign: "center", color: "#C8941A" }}>↓</div>}
        </section>
      ))}
      {edit && (
        <div role="dialog" aria-label="Configurar nó" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 10, padding: 16, width: "100%", maxWidth: 360 }}>
            <h3 style={{ margin: 0, color: "#C8941A" }}>{edit.nome}</h3>
            <label style={{ display: "block", marginTop: 10 }}>Cadência (min)<AjudaCampo chave="dev.infra.cadencia" rota={ROTA} />
              <input value={cad} onChange={(e) => setCad(e.target.value)} inputMode="numeric" style={{ display: "block", width: "100%", padding: 8, border: "1px solid #E8E2D6", borderRadius: 6 }} /></label>
            <label style={{ display: "block", marginTop: 10 }}>Tolerância (min)<AjudaCampo chave="dev.infra.tolerancia" rota={ROTA} />
              <input value={tol} onChange={(e) => setTol(e.target.value)} inputMode="numeric" style={{ display: "block", width: "100%", padding: 8, border: "1px solid #E8E2D6", borderRadius: 6 }} /></label>
            {msg && <p role="alert" style={{ color: COR.vermelho }}>{msg}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => void salvar()} style={{ background: "#3D2314", color: "#fff", border: 0, borderRadius: 6, padding: "8px 14px", cursor: "pointer" }}>Salvar</button>
              <button onClick={() => setEdit(null)} style={{ border: "1px solid #E8E2D6", background: "#fff", borderRadius: 6, padding: "8px 14px", cursor: "pointer" }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
