"use client";
// Central de Desenvolvimento › "Fluxo ao vivo" (CEO 29/10/2026 06:20 e 06:27): fluxograma vivo de toda a infra.
// Comando → Construção → Revisão → Publicação → Produção → Conferência (PDCA) → volta para a Construção.
// REGRA DO CEO: nenhum Code nem robô é fixo aqui. Tudo vem de fn_infra_fluxo_vivo — Code novo/reativado aparece na
// primeira sessão; Code pausado/desligado some quando a última atividade sai da janela; robô desligado some.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { RefreshCw } from "lucide-react";

type Etapa = "comando" | "construcao" | "revisao" | "publicacao" | "producao" | "conferencia";
type Code = { code: string; etapa: Etapa; trabalhando: boolean; ultima_sessao: string | null; tarefas_abertas: number;
  tarefa_mais_antiga_h: number | null; publicadas_24h: number; prs_abertas: number; fora_do_roteamento: boolean;
  estado: "trabalhando" | "acumulando" | "ok" };
type Robo = { nome: string; etapa: Etapa; rotulo: string; agenda: string; ultima: string | null; ultimo_ok: boolean | null };
type Fluxo = {
  gerado_em: string; janela_min: number; codes: Code[]; robos: Robo[]; ultima_publicacao: string | null;
  esteira: { portao_verde: boolean | null; merges_24h: number; quedas_24h: number; tempo_vermelho_24h_min: number;
    intervalo_mediano_merge_min: number | null; fila_parada: number; fila_esperando: number } | null;
  revisao: { revisadas_paradas: number; esperando: number } | null;
  chamados: { abertos: number; esperando_ps: number; por_code: { code: string; abertos: number }[] } | null;
  caixa: { tarefas_abertas: number; enviadas_24h: number; ultima_ordem: string | null } | null;
  decisoes: { versao: number; resumo: string | null; criado_em: string } | null;
  gargalo: { etapa: Etapa; texto: string } | null;
};
type Nota = { area_slug: string; telas: number; nota_media: number | null; prontas_pct: number | null };

const ROTA = "/dashboard/dev/fluxo";
const C = { esp: "#3D2314", off: "#FAF7F2", gold: "#C8941A", gold2: "#E0B048", bd: "#E7DED3", m: "#6B5D4F", d: "#9C8E80",
  ok: "#1baf7a", warn: "#C8941A", bad: "#C0392B", cinza: "#F0ECE3" };
const ETAPAS: { id: Etapa; titulo: string; seta: string }[] = [
  { id: "comando", titulo: "Comando", seta: "tarefa na caixa acorda o Code" },
  { id: "construcao", titulo: "Construção", seta: "PR pronta, com a seção PROVA" },
  { id: "revisao", titulo: "Revisão", seta: "MERGE AUTORIZADO (patch-id)" },
  { id: "publicacao", titulo: "Publicação", seta: "no ar" },
  { id: "producao", titulo: "Produção", seta: "conferência por foto e por dado" },
  { id: "conferencia", titulo: "Conferência (PDCA)", seta: "" },
];

function quando(iso: string | null | undefined) {
  if (!iso) return "sem registro";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "agora";
  if (m < 90) return `há ${m} min`;
  if (m < 48 * 60) return `há ${Math.round(m / 60)} h`;
  return `há ${Math.round(m / 1440)} d`;
}
const hora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "—";

type Cor = "ok" | "warn" | "bad" | "off";
const borda = (c: Cor) => (c === "ok" ? C.ok : c === "warn" ? C.warn : c === "bad" ? C.bad : C.d);

function Caixa({ titulo, sub, linha, cor, testid }: { titulo: string; sub?: string; linha?: string; cor: Cor; testid?: string }) {
  return (
    <div data-testid={testid} style={{ border: `1px solid ${C.bd}`, borderLeft: `4px solid ${borda(cor)}`, borderRadius: 10, padding: "8px 10px",
      background: cor === "off" ? C.cinza : "#fff", minWidth: 0 }}>
      <b style={{ display: "block", fontSize: 14, overflowWrap: "anywhere" }}>{titulo}</b>
      {sub && <span style={{ fontSize: 12, color: C.m }}>{sub}</span>}
      {linha && <div style={{ fontSize: 13, marginTop: 3 }}>{linha}</div>}
    </div>
  );
}

function corCode(c: Code): Cor {
  if (c.fora_do_roteamento && !c.trabalhando) return "off";
  if (c.estado === "acumulando") return "warn";
  return "ok";
}
function corRobo(r: Robo): Cor {
  if (r.ultimo_ok === false) return "bad";
  if (!r.ultima) return "warn";
  return "ok";
}

export default function FluxoVivo() {
  const [f, setF] = useState<Fluxo | null>(null);
  const [notas, setNotas] = useState<Nota[]>([]);
  const [janela, setJanela] = useState(120);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("fn_infra_fluxo_vivo", { p_janela_min: janela });
    if (error) { setErro(error.message); return; }
    setErro(null); setF(data as Fluxo);
    const q = await supabase.rpc("fn_codes_qualidade_vertical");
    if (!q.error) setNotas(((q.data as Nota[]) ?? []).filter((n) => n.nota_media !== null));
  }, [janela]);

  useEffect(() => {
    void carregar();
    const t = setInterval(() => void carregar(), 30000);
    return () => clearInterval(t);
  }, [carregar]);

  const codes = f?.codes ?? [];
  const robos = f?.robos ?? [];
  const est = f?.esteira;
  const gargalo = f?.gargalo ?? null;

  function estadoEtapa(e: Etapa): { cor: Cor; txt: string } {
    if (gargalo?.etapa === e) return { cor: "bad", txt: "gargalo" };
    if (robos.some((r) => r.etapa === e && r.ultimo_ok === false)) return { cor: "bad", txt: "robô com falha" };
    if (e === "producao") return est?.portao_verde === false ? { cor: "bad", txt: "main vermelha" } : { cor: "ok", txt: "verde" };
    if (codes.some((c) => c.etapa === e && c.estado === "acumulando")) return { cor: "warn", txt: "acumulando" };
    return { cor: "ok", txt: "ok" };
  }

  function nosDaEtapa(e: Etapa) {
    const out: ReactNode[] = [];
    if (e === "comando") {
      out.push(<Caixa key="ceo" titulo="CEO" sub="decide e aprova" cor="ok" />);
      out.push(<Caixa key="eng" titulo="Eng. Chefe" sub="transforma decisão em tarefa"
        linha={`${f?.caixa?.enviadas_24h ?? 0} mensagens em 24 h · última ${hora(f?.caixa?.ultima_ordem)}`} cor="ok" />);
      out.push(<Caixa key="caixa" titulo="Caixa de mensagens" sub="tarefas abertas em todos os Codes"
        linha={`${f?.caixa?.tarefas_abertas ?? 0} abertas`} cor={(f?.caixa?.tarefas_abertas ?? 0) > 100 ? "warn" : "ok"} />);
    }
    if (e === "construcao" && f?.chamados) {
      out.push(<Caixa key="cham" titulo="Chamados" sub={f.chamados.por_code.map((p) => `${p.code} ${p.abertos}`).join(" · ") || "sem chamado aberto"}
        linha={`${f.chamados.abertos} abertos · ${f.chamados.esperando_ps} esperando a PS`} cor={f.chamados.esperando_ps > 20 ? "warn" : "ok"} />);
    }
    if (e === "revisao" && f?.revisao) {
      out.push(<Caixa key="rev" titulo="PRs na via revisada" sub="esperando autorização ou ajuste"
        linha={`${f.revisao.revisadas_paradas} paradas`} cor={gargalo?.etapa === "revisao" ? "bad" : f.revisao.revisadas_paradas > 3 ? "warn" : "ok"} />);
    }
    if (e === "publicacao" && est) {
      out.push(<Caixa key="fila" titulo="Fila de merge" sub="publica o que está pronto"
        linha={`${est.merges_24h} publicadas/24 h · última ${hora(f?.ultima_publicacao)} (${quando(f?.ultima_publicacao)})`}
        cor={f?.ultima_publicacao && Date.now() - new Date(f.ultima_publicacao).getTime() > 3 * 3600000 ? "warn" : "ok"} />);
    }
    if (e === "producao" && est) {
      out.push(<Caixa key="main" titulo="Teste da main" sub="a cada publicação e de hora em hora"
        linha={`${est.portao_verde === false ? "VERMELHO" : "verde"} · ${est.quedas_24h} quedas em 24 h (${est.tempo_vermelho_24h_min} min)`}
        cor={est.portao_verde === false ? "bad" : "ok"} />);
    }
    if (e === "conferencia" && notas.length) {
      out.push(<Caixa key="notas" titulo="Notas das telas" sub="meta ≥ 95 em toda tela"
        linha={notas.map((n) => `${n.area_slug} ${Math.round(Number(n.nota_media))} (${n.prontas_pct ?? 0}% prontas)`).join(" · ")}
        cor={notas.every((n) => Number(n.nota_media) >= 95) ? "ok" : "warn"} />);
    }
    for (const c of codes.filter((x) => x.etapa === e)) {
      const sub = [c.trabalhando ? "trabalhando agora" : `ativo ${quando(c.ultima_sessao)}`, c.fora_do_roteamento ? "fora do roteamento" : null]
        .filter(Boolean).join(" · ");
      out.push(<Caixa key={`c-${c.code}`} testid={`fluxo-code-${c.code}`} titulo={c.code} sub={sub}
        linha={`${c.publicadas_24h} publicadas/24 h · ${c.tarefas_abertas} tarefas · ${c.prs_abertas} PRs abertas`} cor={corCode(c)} />);
    }
    for (const r of robos.filter((x) => x.etapa === e)) {
      out.push(<Caixa key={`r-${r.nome}`} titulo={r.rotulo} sub={`robô · ${r.agenda}`}
        linha={`última ${hora(r.ultima)}${r.ultimo_ok === false ? " · FALHOU" : ""}`} cor={corRobo(r)} />);
    }
    return out;
  }

  return (
    <div data-testid="fluxo-vivo" style={{ color: C.esp, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 22 }}>Como a fábrica está rodando <AjudaCampo chave="dev.fluxo.tela" rota={ROTA} /></h2>
        <span style={{ fontSize: 13, color: C.m, display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <label htmlFor="fluxo-janela">Codes ativos nas últimas</label>
          <select id="fluxo-janela" data-testid="fluxo-janela" value={janela} onChange={(e) => setJanela(Number(e.target.value))}
            style={{ border: `1px solid ${C.bd}`, borderRadius: 6, padding: "3px 6px", background: "#fff", color: C.esp }}>
            <option value={60}>1 h</option><option value={120}>2 h</option><option value={360}>6 h</option><option value={1440}>24 h</option>
          </select>
          <AjudaCampo chave="dev.fluxo.janela" rota={ROTA} />
          · atualizado {hora(f?.gerado_em)} · <b style={{ color: C.gold }}>ao vivo</b>
          <button onClick={() => void carregar()} aria-label="Atualizar" style={{ border: 0, background: "none", cursor: "pointer", color: C.esp }}>
            <RefreshCw size={15} strokeWidth={1.5} />
          </button>
        </span>
      </div>

      {erro && <p role="alert" style={{ color: C.bad }}>Sem acesso ao fluxo: {erro}</p>}

      <div data-testid="fluxo-gargalo" style={{ margin: "12px 0 14px", background: gargalo ? "#FFF6E0" : "#EAF7F1",
        border: `1px solid ${gargalo ? C.gold : C.ok}`, borderLeft: `6px solid ${gargalo ? C.bad : C.ok}`, borderRadius: 12, padding: "10px 14px" }}>
        {gargalo
          ? <><b style={{ color: C.bad }}>Gargalo agora: {ETAPAS.find((x) => x.id === gargalo.etapa)?.titulo}.</b> {gargalo.texto}</>
          : <b style={{ color: "#0f7a52" }}>Sem gargalo: o fluxo está andando.</b>}
        <AjudaCampo chave="dev.fluxo.gargalo" rota={ROTA} />
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, color: C.m, marginBottom: 12 }}>
        {([["ok", "rodando"], ["warn", "acumulando / atrasado"], ["bad", "travando o fluxo"], ["off", "fora do roteamento"]] as [Cor, string][]).map(([c, t]) => (
          <span key={c}><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 99, background: borda(c), marginRight: 5 }} />{t}</span>
        ))}
        <AjudaCampo chave="dev.fluxo.estado" rota={ROTA} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,560px),1fr))", gap: 16, alignItems: "start" }}>
        <div>
          {ETAPAS.map((e, i) => {
            const st = estadoEtapa(e.id);
            const nos = nosDaEtapa(e.id);
            return (
              <div key={e.id}>
                <section data-testid={`fluxo-etapa-${e.id}`} style={{ background: "#fff", border: st.cor === "bad" ? `2px solid ${C.bad}` : `1px solid ${C.bd}`,
                  borderRadius: 14, padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 99, background: C.esp, color: "#fff", display: "grid", placeItems: "center",
                      fontSize: 13, fontWeight: 700, flex: "none" }}>{i + 1}</span>
                    <h3 style={{ margin: 0, fontSize: 16 }}>{e.titulo}</h3>
                    <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, padding: "3px 9px", borderRadius: 99,
                      background: st.cor === "bad" ? "#fbe6e3" : st.cor === "warn" ? "#fdf3dc" : "#e6f7ef",
                      color: st.cor === "bad" ? C.bad : st.cor === "warn" ? "#8a6410" : "#0f7a52" }}>{st.txt}</span>
                  </div>
                  {e.id === "construcao" && <div style={{ fontSize: 12, color: C.m, marginBottom: 6 }}>
                    Codes que deram sinal de vida na janela <AjudaCampo chave="dev.fluxo.codes" rota={ROTA} /> · robôs ligados <AjudaCampo chave="dev.fluxo.robos" rota={ROTA} />
                  </div>}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 8 }}>
                    {nos.length ? nos : <span style={{ fontSize: 13, color: C.d }}>Nenhum Code ou robô ativo nesta etapa agora.</span>}
                  </div>
                  {e.id === "conferencia" && (
                    <div style={{ marginTop: 10, border: `2px dashed ${C.gold}`, borderRadius: 12, padding: "8px 12px", fontSize: 13, background: "#fffdf7" }}>
                      ↺ <b>Volta para a Construção:</b> tela reprovada vira tarefa com plano completo para o dev de menor fila; tela ≥ 95, no menu e com PDCA verde sai da auditoria.
                    </div>
                  )}
                </section>
                {e.seta && (
                  <div style={{ textAlign: "center", color: C.gold, fontSize: 12, fontWeight: 600, margin: "4px 0", lineHeight: 1.2 }}>
                    <div style={{ width: 2, height: 14, background: C.gold, margin: "0 auto 2px" }} />{e.seta}<div>▼</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <aside style={{ display: "grid", gap: 12 }}>
          <section style={{ background: "#fff", border: `1px solid ${C.bd}`, borderRadius: 14, padding: "12px 14px" }}>
            <h3 style={{ margin: "0 0 6px", fontSize: 16 }}>Ritmo das últimas 24 h <AjudaCampo chave="dev.fluxo.ritmo" rota={ROTA} /></h3>
            <div style={{ fontSize: 13, lineHeight: 1.7 }}>
              Publicadas: <b>{est?.merges_24h ?? "—"}</b><br />
              Intervalo mediano entre publicações: <b>{est?.intervalo_mediano_merge_min ?? "—"} min</b><br />
              Main vermelha: <b>{est?.tempo_vermelho_24h_min ?? 0} min</b> em {est?.quedas_24h ?? 0} queda(s)<br />
              Codes ativos agora: <b>{codes.length}</b> · trabalhando: <b>{codes.filter((c) => c.trabalhando).length}</b>
            </div>
          </section>
          <section style={{ background: "#fff", border: `1px solid ${C.bd}`, borderRadius: 14, padding: "12px 14px" }}>
            <h3 style={{ margin: "0 0 6px", fontSize: 16 }}>Decisões vigentes <AjudaCampo chave="dev.fluxo.decisoes" rota={ROTA} /></h3>
            {f?.decisoes
              ? <div style={{ fontSize: 13 }}>Documento Mestre de Infraestrutura <b>V{f.decisoes.versao}</b> ({quando(f.decisoes.criado_em)})<br />
                  <span style={{ color: C.m }}>{f.decisoes.resumo}</span></div>
              : <div style={{ fontSize: 13, color: C.d }}>Sem documento vigente.</div>}
          </section>
        </aside>
      </div>
    </div>
  );
}
