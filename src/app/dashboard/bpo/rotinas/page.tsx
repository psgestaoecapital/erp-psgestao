"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { PSGC_COLORS, PSGC_TOGGLE_DIMS } from "@/lib/psgc-tokens";
import PSGCCard from "@/components/psgc/PSGCCard";
import PSGCBadge from "@/components/psgc/PSGCBadge";
import PSGCButton from "@/components/psgc/PSGCButton";

// Paleta local: nomes curtos preservados, valores referenciam PSGC_COLORS.
const C = {
  GO: PSGC_COLORS.dourado,
  GOL: PSGC_COLORS.douradoSoft,
  BG: PSGC_COLORS.offWhite,
  BG2: PSGC_COLORS.offWhite,
  BG3: PSGC_COLORS.offWhiteDark,
  G: PSGC_COLORS.baixa,
  R: PSGC_COLORS.alta,
  Y: PSGC_COLORS.media,
  BL: PSGC_COLORS.azul,
  BD: PSGC_COLORS.offWhiteDarker,
  TX: PSGC_COLORS.espresso,
  TXM: PSGC_COLORS.espressoLight,
  TXD: PSGC_COLORS.espressoLight,
  PU: PSGC_COLORS.espresso, // executor IA institucional
};

const ROTINAS_TIPO = [
  { id: "classificacao", nome: "Auto-classificação de lançamentos", desc: "IA classifica contas a pagar/receber automaticamente por categoria", executor: "ia", freq: "diaria", icon: "🤖", cor: C.PU },
  { id: "conciliacao", nome: "Conciliação bancária", desc: "Cruza extrato bancário com lançamentos do ERP. IA resolve 90%, humano os 10%", executor: "hibrido", freq: "diaria", icon: "🏦", cor: C.BL },
  { id: "sync_dados", nome: "Sincronizar dados do ERP", desc: "Importa novos lançamentos, clientes e fornecedores do ERP do cliente", executor: "ia", freq: "diaria", icon: "🔄", cor: C.G },
  { id: "anomalias", nome: "Detectar anomalias", desc: "IA identifica duplicidades, valores fora do padrão, classificações erradas", executor: "ia", freq: "diaria", icon: "🔍", cor: C.Y },
  { id: "cobranca", nome: "Gestão de cobrança", desc: "Identifica inadimplentes, envia lembretes, gera boletos de cobrança", executor: "hibrido", freq: "semanal", icon: "💳", cor: C.R },
  { id: "contas_pagar", nome: "Contas a pagar da semana", desc: "Lista vencimentos da semana, programa pagamentos, alerta sobre atrasos", executor: "hibrido", freq: "semanal", icon: "📋", cor: C.Y },
  { id: "fluxo_caixa", nome: "Previsão de fluxo de caixa", desc: "IA projeta entradas e saídas dos próximos 30/60/90 dias", executor: "ia", freq: "semanal", icon: "📈", cor: C.G },
  { id: "nfe_emissao", nome: "Emissão de NF-e", desc: "Emite notas fiscais de serviço ou produto via eNotas/Focus NFe", executor: "humano", freq: "sob_demanda", icon: "📄", cor: C.BL },
  { id: "boleto_emissao", nome: "Emissão de boletos", desc: "Gera boletos de cobrança via Asaas/Cora para clientes inadimplentes", executor: "hibrido", freq: "sob_demanda", icon: "🧾", cor: C.GO },
  { id: "dre_mensal", nome: "DRE mensal", desc: "Gera demonstrativo de resultado do exercício com comparativo mês a mês", executor: "ia", freq: "mensal", icon: "📊", cor: C.GOL },
  { id: "relatorio_ia", nome: "Relatório executivo IA", desc: "PS gera relatório com 8 seções: pontos críticos, oportunidades, Carta ao Sócio", executor: "ia", freq: "mensal", icon: "📑", cor: C.PU },
  { id: "fechamento", nome: "Fechamento mensal", desc: "Reconcilia todos os lançamentos, verifica pendências, fecha o período", executor: "humano", freq: "mensal", icon: "🔒", cor: C.R },
  { id: "obrigacoes", nome: "Obrigações fiscais", desc: "Alerta sobre prazos de DARF, DAS, GFIP, SPED e outras obrigações", executor: "ia", freq: "mensal", icon: "📅", cor: C.Y },
  { id: "balanco", nome: "Balanço e indicadores", desc: "Gera balanço patrimonial simplificado e indicadores financeiros chave", executor: "ia", freq: "mensal", icon: "⚖️", cor: C.BL },
];

const freqLabel = (f: string) =>
  f === "diaria" ? "Diária" : f === "semanal" ? "Semanal" : f === "mensal" ? "Mensal" : "Sob demanda";

const freqCor = (f: string) =>
  f === "diaria" ? C.R : f === "semanal" ? C.Y : f === "mensal" ? C.BL : C.TXD;

const execLabel = (e: string) =>
  e === "ia" ? "🤖 PS (IA)" : e === "humano" ? "👤 Operador" : "🤝 Híbrido";

// Cor por executor (preservada para uso onde inline ainda for necessario)
const execCor = (e: string) =>
  e === "ia" ? PSGC_COLORS.espresso :
  e === "humano" ? PSGC_COLORS.dourado :
  PSGC_COLORS.azul;

const execBadgeVariant = (e: string): "default" | "primary" | "info" =>
  e === "ia" ? "default" : e === "humano" ? "primary" : "info";

export default function RotinasPage() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [rotinas, setRotinas] = useState<any[]>([]);
  const [selectedComp, setSelectedComp] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const s = localStorage.getItem("ps_empresa_sel");
      if (s && !s.startsWith("group_") && s !== "consolidado") return s;
    }
    return null;
  });
  const [, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState("configurar");

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    const { data: comps } = await supabase.from("companies").select("*").order("created_at");
    if (comps) setCompanies(comps);
    const { data: rots } = await supabase.from("bpo_rotinas").select("*");
    if (rots) setRotinas(rots);
    setLoading(false);
  };

  const getCompRotinas = (compId: string) => rotinas.filter(r => r.company_id === compId);
  const isRotinaAtiva = (compId: string, tipo: string) =>
    rotinas.some(r => r.company_id === compId && r.tipo === tipo && r.ativo);

  const toggleRotina = async (compId: string, tipo: string) => {
    const existing = rotinas.find(r => r.company_id === compId && r.tipo === tipo);
    const template = ROTINAS_TIPO.find(t => t.id === tipo);
    if (!template) return;

    if (existing) {
      await supabase.from("bpo_rotinas").update({ ativo: !existing.ativo }).eq("id", existing.id);
      setRotinas(rotinas.map(r => r.id === existing.id ? { ...r, ativo: !r.ativo } : r));
      setMsg(existing.ativo ? "Rotina desativada" : "Rotina ativada!");
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { data } = await supabase.from("bpo_rotinas").insert({
        company_id: compId, tipo, nome: template.nome, descricao: template.desc,
        frequencia: template.freq, executor: template.executor, ativo: true,
        created_by: user?.id,
      }).select().single();
      if (data) setRotinas([...rotinas, data]);
      setMsg("Rotina ativada!");
    }
    setTimeout(() => setMsg(""), 2000);
  };

  const ativarTodas = async (compId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    for (const t of ROTINAS_TIPO) {
      const exists = rotinas.find(r => r.company_id === compId && r.tipo === t.id);
      if (!exists) {
        const { data } = await supabase.from("bpo_rotinas").insert({
          company_id: compId, tipo: t.id, nome: t.nome, descricao: t.desc,
          frequencia: t.freq, executor: t.executor, ativo: true, created_by: user?.id,
        }).select().single();
        if (data) setRotinas(prev => [...prev, data]);
      } else if (!exists.ativo) {
        await supabase.from("bpo_rotinas").update({ ativo: true }).eq("id", exists.id);
        setRotinas(prev => prev.map(r => r.id === exists.id ? { ...r, ativo: true } : r));
      }
    }
    setMsg("Todas as rotinas ativadas!");
    setTimeout(() => setMsg(""), 2000);
  };

  const selectedCompany = companies.find(c => c.id === selectedComp);
  const compRotinas = selectedComp ? getCompRotinas(selectedComp) : [];
  const ativasCount = compRotinas.filter(r => r.ativo).length;
  const iaCount = compRotinas.filter(r => r.ativo && r.executor === "ia").length;
  const hibCount = compRotinas.filter(r => r.ativo && r.executor === "hibrido").length;
  const humCount = compRotinas.filter(r => r.ativo && r.executor === "humano").length;

  // Painel de tarefas do dia (todas as empresas)
  const hoje = new Date();
  const diaSemana = hoje.getDay();
  const diaMes = hoje.getDate();
  const todasRotinasAtivas = rotinas.filter(r => r.ativo);
  const tarefasHoje = todasRotinasAtivas.filter(r => {
    if (r.frequencia === "diaria") return true;
    if (r.frequencia === "semanal" && (diaSemana === 1 || diaSemana === 4)) return true; // seg e qui
    if (r.frequencia === "mensal" && (diaMes === 1 || diaMes === 5 || diaMes === 15)) return true;
    return false;
  });

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: "0 auto", background: C.BG, minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.GO }}>Rotinas BPO — Automação com IA</div>
          <div style={{ fontSize: 11, color: C.TXD }}>Configure as tarefas que o PS executa automaticamente para cada cliente</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <PSGCButton variant="ghost" size="sm" onClick={() => { window.location.href = "/dashboard/bpo"; }}>
            ← BPO
          </PSGCButton>
        </div>
      </div>

      {/* Mensagem flash com variant condicional */}
      {msg && (() => {
        const isError = msg.toLowerCase().includes("erro")
          || msg.toLowerCase().includes("desativada")
          || msg.toLowerCase().includes("falha");
        return (
          <PSGCCard
            variant={isError ? "critical" : "success"}
            onClick={() => setMsg("")}
            style={{ cursor: "pointer", marginBottom: 16 }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: isError ? C.R : C.G }}>{msg}</div>
          </PSGCCard>
        );
      })()}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {[
          { id: "configurar", n: "Configurar Rotinas" },
          { id: "tarefas", n: `Tarefas de Hoje (${tarefasHoje.length})` },
          { id: "resumo", n: "Resumo por Executor" },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 16px", borderRadius: 20, fontSize: 11,
              border: `1px solid ${tab === t.id ? C.GO : C.BD}`,
              background: tab === t.id ? C.GO + "18" : "transparent",
              color: tab === t.id ? C.GOL : C.TXM,
              fontWeight: tab === t.id ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {t.n}
          </button>
        ))}
      </div>

      {/* TAB: CONFIGURAR */}
      {tab === "configurar" && (
        <div style={{ display: "flex", gap: 12 }}>
          {/* Left: Company list */}
          <div style={{ width: 260, flexShrink: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.TX, marginBottom: 8 }}>Selecione o cliente</div>
            {companies.map(c => {
              const cr = getCompRotinas(c.id);
              const ativas = cr.filter(r => r.ativo).length;
              const isSelected = selectedComp === c.id;
              return (
                <div
                  key={c.id}
                  onClick={() => setSelectedComp(c.id)}
                  style={{
                    padding: "10px 12px", marginBottom: 4, borderRadius: 8, cursor: "pointer",
                    border: `1px solid ${isSelected ? C.GO : C.BD}`,
                    background: isSelected ? C.GO + "12" : C.BG2,
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = C.BG3; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = isSelected ? C.GO + "12" : C.BG2; }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: isSelected ? C.GOL : C.TX }}>
                    {c.nome_fantasia || c.razao_social}
                  </div>
                  <div style={{ fontSize: 9, color: C.TXD, marginTop: 2 }}>
                    {ativas > 0
                      ? <span style={{ color: C.G }}>{ativas} rotinas ativas</span>
                      : <span>Nenhuma rotina</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: Routine config */}
          <div style={{ flex: 1 }}>
            {!selectedComp ? (
              <div style={{ textAlign: "center", padding: 60, background: C.BG2, borderRadius: 12, border: `1px solid ${C.BD}` }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>👈</div>
                <div style={{ fontSize: 14, color: C.TXM }}>Selecione um cliente para configurar as rotinas</div>
              </div>
            ) : (
              <div>
                {/* Company header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: C.GOL }}>
                      {selectedCompany?.nome_fantasia || selectedCompany?.razao_social}
                    </div>
                    <div style={{ fontSize: 10, color: C.TXD }}>
                      {ativasCount} rotinas ativas | {iaCount} IA + {hibCount} Híbridas + {humCount} Manuais
                    </div>
                  </div>
                  <button
                    onClick={() => ativarTodas(selectedComp)}
                    style={{
                      padding: "8px 16px", borderRadius: 8,
                      background: `linear-gradient(135deg, ${PSGC_COLORS.dourado}, ${PSGC_COLORS.douradoSoft})`,
                      color: PSGC_COLORS.espresso,
                      fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer",
                    }}
                  >
                    Ativar todas
                  </button>
                </div>

                {/* Routines by frequency */}
                {["diaria", "semanal", "mensal", "sob_demanda"].map(freq => {
                  const tiposFreq = ROTINAS_TIPO.filter(t => t.freq === freq);
                  if (tiposFreq.length === 0) return null;
                  return (
                    <div key={freq} style={{ marginBottom: 16 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 600, color: freqCor(freq),
                        marginBottom: 8, display: "flex", alignItems: "center", gap: 6,
                      }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: freqCor(freq), display: "inline-block" }} />
                        Rotinas {freqLabel(freq)}s
                      </div>
                      {tiposFreq.map(tipo => {
                        const ativa = isRotinaAtiva(selectedComp, tipo.id);
                        return (
                          <div
                            key={tipo.id}
                            style={{
                              background: C.BG2, borderRadius: 10, marginBottom: 6,
                              border: `1px solid ${ativa ? tipo.cor + "40" : C.BD}`,
                              overflow: "hidden",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                                <span style={{ fontSize: 20 }}>{tipo.icon}</span>
                                <div>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: ativa ? C.TX : C.TXD }}>{tipo.nome}</div>
                                  <div style={{ fontSize: 9, color: C.TXD, marginTop: 2 }}>{tipo.desc}</div>
                                </div>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <PSGCBadge variant={execBadgeVariant(tipo.executor)} size="sm">
                                  {execLabel(tipo.executor)}
                                </PSGCBadge>
                                <div
                                  onClick={() => toggleRotina(selectedComp, tipo.id)}
                                  style={{
                                    width: PSGC_TOGGLE_DIMS.width,
                                    height: PSGC_TOGGLE_DIMS.height,
                                    borderRadius: PSGC_TOGGLE_DIMS.borderRadius,
                                    background: ativa ? PSGC_COLORS.baixa : PSGC_COLORS.offWhiteDarker,
                                    position: "relative",
                                    cursor: "pointer",
                                    transition: "background 0.2s",
                                  }}
                                >
                                  <div
                                    style={{
                                      width: PSGC_TOGGLE_DIMS.handleSize,
                                      height: PSGC_TOGGLE_DIMS.handleSize,
                                      borderRadius: "50%",
                                      background: PSGC_COLORS.offWhite,
                                      position: "absolute",
                                      top: 2,
                                      left: ativa ? PSGC_TOGGLE_DIMS.handleOffsetActive : PSGC_TOGGLE_DIMS.handleOffsetInactive,
                                      boxShadow: "0 1px 3px rgba(61, 35, 20, 0.15)",
                                      transition: "left 0.2s",
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: TAREFAS DE HOJE */}
      {tab === "tarefas" && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.TX, marginBottom: 12 }}>
            Tarefas para hoje — {hoje.toLocaleDateString("pt-BR")}
            <span style={{ fontSize: 11, color: C.TXD, marginLeft: 8 }}>
              {tarefasHoje.length} tarefas de {companies.length} clientes
            </span>
          </div>
          {tarefasHoje.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, background: C.BG2, borderRadius: 12, border: `1px solid ${C.BD}` }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
              <div style={{ fontSize: 14, color: C.G }}>Nenhuma tarefa pendente para hoje!</div>
              <div style={{ fontSize: 11, color: C.TXD, marginTop: 4 }}>Configure rotinas na aba "Configurar Rotinas"</div>
            </div>
          ) : (
            <div>
              {companies.map(comp => {
                const compTarefas = tarefasHoje.filter(t => t.company_id === comp.id);
                if (compTarefas.length === 0) return null;
                return (
                  <div key={comp.id} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.GOL, marginBottom: 6 }}>
                      {comp.nome_fantasia || comp.razao_social}
                    </div>
                    {compTarefas.map((t, i) => {
                      const template = ROTINAS_TIPO.find(rt => rt.id === t.tipo);
                      return (
                        <div
                          key={i}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            padding: "8px 12px", background: C.BG2, borderRadius: 8, marginBottom: 3,
                            border: `1px solid ${C.BD}`,
                            borderLeft: `3px solid ${template?.cor || C.TXD}`,
                          }}
                        >
                          <span style={{ fontSize: 16 }}>{template?.icon || "📋"}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: C.TX }}>{t.nome}</div>
                            <div style={{ fontSize: 9, color: C.TXD }}>
                              {freqLabel(t.frequencia)} | {execLabel(t.executor)}
                            </div>
                          </div>
                          <span style={{
                            fontSize: 9, padding: "3px 10px", borderRadius: 6,
                            background: execCor(t.executor) + "20",
                            color: execCor(t.executor),
                            fontWeight: 600,
                          }}>
                            {t.executor === "ia" ? "Auto" : "Pendente"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB: RESUMO */}
      {tab === "resumo" && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.TX, marginBottom: 12 }}>Resumo de automação por executor</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
            {[
              { label: "🤖 PS (IA) — Automático", items: ROTINAS_TIPO.filter(t => t.executor === "ia"), cor: C.PU, desc: "Executadas automaticamente pelo PS sem intervenção humana" },
              { label: "🤝 Híbrido — IA + Humano", items: ROTINAS_TIPO.filter(t => t.executor === "hibrido"), cor: C.BL, desc: "IA faz 80-90%, operador valida e resolve exceções" },
              { label: "👤 Operador — Manual", items: ROTINAS_TIPO.filter(t => t.executor === "humano"), cor: C.GO, desc: "Requer ação humana mas com assistência do PS" },
            ].map((g, gi) => (
              <div key={gi} style={{ background: C.BG2, borderRadius: 12, border: `1px solid ${C.BD}`, overflow: "hidden" }}>
                <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.BD}`, background: g.cor + "10" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: g.cor }}>{g.label}</div>
                  <div style={{ fontSize: 9, color: C.TXD, marginTop: 2 }}>{g.desc}</div>
                </div>
                <div style={{ padding: 10 }}>
                  {g.items.map((item, ii) => (
                    <div
                      key={ii}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "6px 0",
                        borderBottom: ii < g.items.length - 1 ? `1px solid ${C.BD}30` : "none",
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{item.icon}</span>
                      <div>
                        <div style={{ fontSize: 11, color: C.TX }}>{item.nome}</div>
                        <div style={{ fontSize: 8, color: C.TXD }}>{freqLabel(item.freq)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ background: C.BG2, borderRadius: 12, padding: 16, border: `1px solid ${C.BD}` }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.GOL, marginBottom: 8 }}>Impacto da automação</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              {[
                { l: "Total de rotinas", v: "14", c: C.GOL },
                { l: "Automáticas (IA)", v: `${ROTINAS_TIPO.filter(t => t.executor === "ia").length}`, c: C.PU },
                { l: "Tempo manual estimado", v: "16h/cliente", c: C.R },
                { l: "Tempo com PS", v: "15min/cliente", c: C.G },
              ].map((k, i) => (
                <div key={i} style={{ background: C.BG3, borderRadius: 8, padding: 10, textAlign: "center" }}>
                  <div style={{ fontSize: 9, color: C.TXD }}>{k.l}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: k.c, marginTop: 2 }}>{k.v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
