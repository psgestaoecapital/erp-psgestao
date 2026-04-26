"use client";
import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { PSGC_COLORS } from "@/lib/psgc-tokens";
import PSGCCard from "@/components/psgc/PSGCCard";
import PSGCBadge from "@/components/psgc/PSGCBadge";
import PSGCButton from "@/components/psgc/PSGCButton";

// Paleta local: nomes curtos preservados, valores referenciam PSGC_COLORS.
// Tokens B e P do codigo original removidos (nao eram usados).
const C = {
  GO: PSGC_COLORS.dourado,
  GOL: PSGC_COLORS.douradoSoft,
  BG: PSGC_COLORS.offWhite,
  BG2: PSGC_COLORS.offWhite,
  BG3: PSGC_COLORS.offWhiteDark,
  G: PSGC_COLORS.baixa,
  R: PSGC_COLORS.alta,
  Y: PSGC_COLORS.media,
  BD: PSGC_COLORS.offWhiteDarker,
  TX: PSGC_COLORS.espresso,
  TXM: PSGC_COLORS.espressoLight,
  TXD: PSGC_COLORS.espressoLight,
};

const fmtR = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

// Cor do score anti-fraude por faixa (4 niveis)
const corScore = (score: number) => {
  if (score >= 80) return PSGC_COLORS.baixa;
  if (score >= 60) return PSGC_COLORS.media;
  if (score >= 30) return PSGC_COLORS.laranjaAlerta;
  return PSGC_COLORS.alta;
};

// Cor da confianca IA por faixa (3 niveis)
const corConfianca = (pct: number) => {
  if (pct >= 80) return PSGC_COLORS.baixa;
  if (pct >= 50) return PSGC_COLORS.media;
  return PSGC_COLORS.alta;
};

export default function BPOAutoPage() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [grupos, setGrupos] = useState<any[]>([]);
  const [selectedComp, setSelectedComp] = useState("");
  const [fila, setFila] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [rotinas, setRotinas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [classifying, setClassifying] = useState(false);
  const [msg, setMsg] = useState("");
  const [filtro, setFiltro] = useState("pendente");
  const [selectAll, setSelectAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fraudScores, setFraudScores] = useState<Record<string, { score: number; flags: string[] }>>({});

  useEffect(() => { loadCompanies(); }, []);
  useEffect(() => {
    if (selectedComp && typeof window !== "undefined") {
      localStorage.setItem("ps_empresa_sel", selectedComp);
    }
  }, [selectedComp]);
  useEffect(() => { if (selectedComp) loadData(); }, [selectedComp]);

  const loadCompanies = async () => {
    const { data: { user: authU } } = await supabase.auth.getUser();
    const { data: uP } = authU
      ? await supabase.from("users").select("role").eq("id", authU.id).single()
      : { data: null };
    let data: any[] = [];
    if (uP?.role === "adm" || uP?.role === "acesso_total") {
      const r = await supabase.from("companies").select("*").order("nome_fantasia");
      data = r.data || [];
    } else if (authU) {
      const r = await supabase.from("user_companies").select("companies(*)").eq("user_id", authU.id);
      data = (r.data || []).map((u: any) => u.companies).filter(Boolean);
    }
    if (data && data.length > 0) {
      setCompanies(data);
      const { data: grps } = await supabase.from("company_groups").select("*").order("nome");
      setGrupos(grps || []);
      const saved = typeof window !== "undefined" ? localStorage.getItem("ps_empresa_sel") : "";
      const match = saved
        ? (saved === "consolidado" ? data[0]
           : saved.startsWith("group_") ? data.find((c: any) => c.group_id === saved.replace("group_", "")) || data[0]
           : data.find((c: any) => c.id === saved))
        : null;
      setSelectedComp(match ? match.id : data[0].id);
    }
    setLoading(false);
  };

  const getCompIds = (): string[] => {
    if (selectedComp.startsWith("group_")) {
      return companies.filter(c => c.group_id === selectedComp.replace("group_", "")).map(c => c.id);
    }
    return [selectedComp];
  };

  const loadData = async () => {
    setLoading(true);
    const ids = getCompIds();
    let allFila: any[] = [], allLogs: any[] = [], allRotinas: any[] = [];
    for (const cid of ids) {
      const [{ data: f }, { data: l }, { data: r }] = await Promise.all([
        supabase.from("bpo_classificacoes").select("*").eq("company_id", cid).order("created_at", { ascending: false }),
        supabase.from("bpo_sync_log").select("*").eq("company_id", cid).order("created_at", { ascending: false }).limit(10),
        supabase.from("bpo_rotinas").select("*").eq("company_id", cid),
      ]);
      allFila.push(...(f || []));
      allLogs.push(...(l || []));
      allRotinas.push(...(r || []));
    }
    setFila(allFila);
    setLogs(allLogs.sort((a, b) => b.created_at?.localeCompare(a.created_at || "")));
    setRotinas(allRotinas);
    setSelected(new Set());
    setSelectAll(false);

    // Compute fraud scores for each item
    const scores: Record<string, { score: number; flags: string[] }> = {};
    const fornNomes = new Set<string>();
    // Build supplier registry from all imports
    for (const cid of ids) {
      const { data: imps } = await supabase
        .from("omie_imports")
        .select("import_type,import_data")
        .eq("company_id", cid)
        .eq("import_type", "clientes");
      for (const imp of (imps || [])) {
        const cls = imp.import_data?.clientes_cadastro || [];
        if (Array.isArray(cls)) {
          cls.forEach((c: any) => fornNomes.add((c.nome_fantasia || c.razao_social || "").toUpperCase().trim()));
        }
      }
    }
    for (const item of allFila) {
      if (item.tipo_conta !== "pagar") {
        scores[item.id] = { score: 100, flags: [] };
        continue;
      }
      let penalty = 0;
      const flags: string[] = [];
      const nome = (item.nome_cliente_fornecedor || "").toUpperCase().trim();
      const v = Math.abs(item.valor || 0);
      // 1. Fornecedor cadastrado?
      if (nome && !fornNomes.has(nome)) { flags.push("Fornecedor nao cadastrado"); penalty += 20; }
      // 2. Sem categoria
      if (!item.categoria_atual || item.categoria_atual === "SEM CATEGORIA") {
        flags.push("Sem categoria no ERP");
        penalty += 5;
      }
      // 3. Valor redondo
      if (v >= 10000 && v % 1000 === 0) { flags.push("Valor redondo suspeito"); penalty += 10; }
      // 4. Duplicata
      const dupes = allFila.filter(f =>
        f.id !== item.id
        && Math.abs(Math.abs(f.valor || 0) - v) < 0.01
        && f.data_lancamento === item.data_lancamento
      );
      if (dupes.length > 0) { flags.push("Possivel duplicata"); penalty += 15; }
      // 5. Valor alto
      if (v > 50000) { flags.push("Valor acima de R$50K"); penalty += 10; }
      scores[item.id] = { score: Math.max(0, 100 - penalty), flags };
    }
    setFraudScores(scores);
    setLoading(false);
  };

  const runClassification = async () => {
    setClassifying(true);
    setMsg("");
    try {
      const ids = getCompIds();
      let totalClassif = 0, totalPend = 0;
      for (const cid of ids) {
        const res = await authFetch("/api/bpo/classify", {
          method: "POST",
          body: JSON.stringify({ company_id: cid }),
        });
        const d = await res.json();
        if (d.success) {
          totalClassif += (d.classificacoes_geradas || 0);
          totalPend += (d.pendentes_restantes || 0);
        } else {
          setMsg(`Erro em empresa: ${d.error || "desconhecido"}`);
          setClassifying(false);
          return;
        }
      }
      setMsg(`${totalClassif} classificacoes geradas (${ids.length} empresa${ids.length > 1 ? "s" : ""}). ${totalPend > 0 ? `Restam ${totalPend} pendentes.` : ""}`);
      loadData();
    } catch (e: any) {
      setMsg(`Erro: ${e.message}`);
    }
    setClassifying(false);
  };

  const activateRoutine = async () => {
    const ids = getCompIds();
    for (const cid of ids) {
      await supabase.from("bpo_rotinas").upsert(
        { company_id: cid, tipo: "auto_classificacao", ativo: true, frequencia: "diaria" },
        { onConflict: "company_id" }
      );
    }
    setMsg(`Rotina ativada para ${ids.length} empresa${ids.length > 1 ? "s" : ""}!`);
    loadData();
    setTimeout(() => setMsg(""), 3000);
  };

  const aprovar = async (id: string, catFinal?: string) => {
    const item = fila.find(f => f.id === id);
    await supabase.from("bpo_classificacoes").update({
      status: "aprovado",
      categoria_final: catFinal || item?.categoria_sugerida,
      operador_acao: "aprovado",
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    loadData();
  };

  const rejeitar = async (id: string) => {
    await supabase.from("bpo_classificacoes").update({
      status: "rejeitado",
      operador_acao: "rejeitado",
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    loadData();
  };

  const aprovarSelecionados = async () => {
    for (const id of selected) await aprovar(id);
    setMsg(`${selected.size} classificacoes aprovadas.`);
    setTimeout(() => setMsg(""), 3000);
  };

  const aprovarTodos = async () => {
    const pendentes = fila.filter(f => f.status === "pendente");
    for (const p of pendentes) await aprovar(p.id);
    setMsg(`${pendentes.length} classificacoes aprovadas.`);
    loadData();
    setTimeout(() => setMsg(""), 3000);
  };

  const retroalimentar = async () => {
    if (!selectedComp) return;
    setMsg("Aplicando classificacoes ao Dashboard...");
    try {
      const ids = getCompIds();
      let totalAplic = 0, totalNao = 0;
      for (const cid of ids) {
        const r = await authFetch("/api/bpo/retroalimentar", {
          method: "POST",
          body: JSON.stringify({ company_id: cid }),
        });
        const d = await r.json();
        if (!d.error) {
          totalAplic += (d.aplicados || 0);
          totalNao += (d.nao_encontrados || 0);
        }
      }
      setMsg(`${totalAplic} classificacoes aplicadas ao Dashboard (${ids.length} empresa${ids.length > 1 ? "s" : ""}). ${totalNao > 0 ? totalNao + " nao encontrados." : ""}`);
    } catch (e: any) {
      setMsg("Erro: " + e.message);
    }
    setTimeout(() => setMsg(""), 5000);
  };

  const toggleSelect = (id: string) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelected(s);
  };

  const toggleAll = () => {
    if (selectAll) {
      setSelected(new Set());
      setSelectAll(false);
    } else {
      const ids = filtered.map(f => f.id);
      setSelected(new Set(ids));
      setSelectAll(true);
    }
  };

  const filtered = fila.filter(f => filtro === "todos" || f.status === filtro);
  const counts = {
    pendente: fila.filter(f => f.status === "pendente").length,
    aprovado: fila.filter(f => f.status === "aprovado").length,
    rejeitado: fila.filter(f => f.status === "rejeitado").length,
  };
  const rotinaAuto = rotinas.find(r => r.tipo === "auto_classificacao");
  const rotinaAtiva = !!rotinaAuto?.ativo;

  const inp: React.CSSProperties = {
    background: C.BG3,
    border: `1px solid ${C.BD}`,
    color: C.TX,
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 12,
    outline: "none",
    fontFamily: "inherit",
  };

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: "0 auto", background: C.BG, minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.GO }}>🤖 BPO Automação IA</div>
          <div style={{ fontSize: 11, color: C.TXM }}>Auto-classificação de lançamentos por inteligência artificial</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <PSGCButton variant="ghost" size="sm" onClick={() => { window.location.href = "/dashboard/bpo"; }}>
            ← BPO
          </PSGCButton>
          <PSGCButton variant="ghost" size="sm" onClick={() => { window.location.href = "/dashboard"; }}>
            ← Dashboard
          </PSGCButton>
        </div>
      </div>

      {/* Mensagem flash com variant condicional */}
      {msg && (() => {
        const isError = msg.toLowerCase().includes("erro")
          || msg.toLowerCase().includes("falha")
          || msg.toLowerCase().includes("rejeit");
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

      {/* Empresa + Controles */}
      <div style={{
        background: C.BG2, borderRadius: 12, padding: 14, border: `1px solid ${C.BD}`,
        marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center",
      }}>
        <div>
          <div style={{ fontSize: 10, color: C.TXM, marginBottom: 3 }}>Empresa</div>
          <select value={selectedComp} onChange={e => setSelectedComp(e.target.value)} style={{ ...inp, width: 260 }}>
            {grupos.map(g => {
              const emps = companies.filter(c => c.group_id === g.id);
              if (emps.length === 0) return null;
              return (
                <optgroup key={g.id} label={"📁 " + g.nome}>
                  <option value={"group_" + g.id}>📁 {g.nome} ({emps.length} empresas)</option>
                  {emps.map(emp => (
                    <option key={emp.id} value={emp.id}>└ {emp.nome_fantasia || emp.razao_social}</option>
                  ))}
                </optgroup>
              );
            })}
            {companies
              .filter(c => !c.group_id || !grupos.find(g => g.id === c.group_id))
              .map(c => (
                <option key={c.id} value={c.id}>{c.nome_fantasia || c.razao_social}</option>
              ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 6, alignSelf: "flex-end" }}>
          {!rotinaAtiva ? (
            <PSGCButton variant="success" size="sm" icon="⚡" onClick={activateRoutine}>
              Ativar Auto-Classificacao
            </PSGCButton>
          ) : (
            <PSGCBadge variant="success" size="md">✅ Rotina Ativa</PSGCBadge>
          )}
          <button
            onClick={runClassification}
            disabled={classifying}
            style={{
              padding: "8px 18px", borderRadius: 8, border: "none",
              background: classifying ? C.BD : `linear-gradient(135deg, ${PSGC_COLORS.dourado}, ${PSGC_COLORS.douradoSoft})`,
              color: classifying ? C.TXM : PSGC_COLORS.espresso,
              fontSize: 12, fontWeight: 700,
              cursor: classifying ? "wait" : "pointer",
            }}
          >
            {classifying ? "🤖 IA analisando..." : "🤖 Executar Classificação IA"}
          </button>
        </div>
      </div>

      {/* Pipeline status - 6 KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginBottom: 14 }}>
        {[
          { label: "Pendentes", value: counts.pendente, cor: C.Y, icon: "⏳" },
          { label: "Aprovados", value: counts.aprovado, cor: C.G, icon: "✅" },
          { label: "Rejeitados", value: counts.rejeitado, cor: C.R, icon: "❌" },
          { label: "Total na Fila", value: fila.length, cor: C.TX, icon: "📋" },
          { label: "Rotina", value: rotinaAtiva ? "Ativa" : "Inativa", cor: rotinaAtiva ? C.G : C.TXD, icon: "⚡" },
          {
            label: "Última Exec.",
            value: rotinaAuto?.ultima_execucao
              ? new Date(rotinaAuto.ultima_execucao).toLocaleDateString("pt-BR")
              : "Nunca",
            cor: C.TXM,
            icon: "🕐",
          },
        ].map((k, i) => (
          <div key={i} style={{
            background: C.BG2, borderRadius: 12, padding: 12,
            border: `1px solid ${C.BD}`, textAlign: "center",
          }}>
            <div style={{ fontSize: 16, marginBottom: 2 }}>{k.icon}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: k.cor }}>{k.value}</div>
            <div style={{ fontSize: 9, color: C.TXM, marginTop: 2 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filter + Bulk actions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {([
            ["pendente", `Pendentes (${counts.pendente})`],
            ["aprovado", "Aprovados"],
            ["rejeitado", "Rejeitados"],
            ["todos", "Todos"],
          ] as const).map(([k, l]) => (
            <button
              key={k}
              onClick={() => { setFiltro(k); setSelected(new Set()); setSelectAll(false); }}
              style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 11, cursor: "pointer",
                border: filtro === k ? `1px solid ${C.GO}50` : `1px solid ${C.BD}`,
                background: filtro === k ? C.GO + "10" : "transparent",
                color: filtro === k ? C.GOL : C.TXM,
                fontWeight: filtro === k ? 600 : 400,
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {filtro === "pendente" && selected.size > 0 && (
            <PSGCButton variant="success" size="sm" icon="✅" onClick={aprovarSelecionados}>
              Aprovar {selected.size} selecionados
            </PSGCButton>
          )}
          {filtro === "pendente" && counts.pendente > 0 && (
            <PSGCButton variant="success" size="sm" icon="✅" onClick={aprovarTodos}>
              Aprovar Todos ({counts.pendente})
            </PSGCButton>
          )}
          {counts.aprovado > 0 && (
            <PSGCButton variant="primary" size="sm" icon="🔄" onClick={retroalimentar}>
              Aplicar ao Dashboard ({counts.aprovado})
            </PSGCButton>
          )}
        </div>
      </div>

      {/* Classification queue */}
      {loading ? (
        <div style={{ padding: 24, textAlign: "center", color: C.TXM }}>Carregando...</div>
      ) : filtered.length === 0 ? (
        <div style={{
          background: C.BG2, borderRadius: 14, padding: 32,
          border: `1px solid ${C.BD}`, textAlign: "center",
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🤖</div>
          <div style={{ fontSize: 14, color: C.TX }}>
            Nenhuma classificação {filtro === "pendente" ? "pendente" : ""} encontrada
          </div>
          <div style={{ fontSize: 11, color: C.TXM, marginTop: 4 }}>
            Clique em "Executar Classificação IA" para analisar lançamentos sem categoria.
          </div>
        </div>
      ) : (
        <div style={{ background: C.BG2, borderRadius: 12, border: `1px solid ${C.BD}`, overflow: "hidden" }}>
          <div style={{ overflowX: "auto", maxHeight: 500, overflowY: "auto" }}>
            <table style={{ width: "100%", fontSize: 11, minWidth: 900 }}>
              <thead style={{ position: "sticky", top: 0, background: C.BG2, zIndex: 1 }}>
                <tr style={{ borderBottom: `1px solid ${C.BD}` }}>
                  {filtro === "pendente" && (
                    <th style={{ padding: "8px 6px", width: 30 }}>
                      <input type="checkbox" checked={selectAll} onChange={toggleAll} />
                    </th>
                  )}
                  <th style={{ padding: "8px 6px", textAlign: "left", color: C.GO, fontSize: 10, fontWeight: 600 }}>TIPO</th>
                  <th style={{ padding: "8px 6px", textAlign: "left", color: C.GO, fontSize: 10, fontWeight: 600 }}>DATA</th>
                  <th style={{ padding: "8px 6px", textAlign: "left", color: C.GO, fontSize: 10, fontWeight: 600 }}>CLIENTE / FORNECEDOR</th>
                  <th style={{ padding: "8px 6px", textAlign: "right", color: C.GO, fontSize: 10, fontWeight: 600 }}>VALOR</th>
                  <th style={{ padding: "8px 6px", textAlign: "left", color: C.GO, fontSize: 10, fontWeight: 600 }}>CATEGORIA ATUAL</th>
                  <th style={{ padding: "8px 6px", textAlign: "left", color: C.GO, fontSize: 10, fontWeight: 600 }}>SUGESTÃO IA</th>
                  <th style={{ padding: "8px 6px", textAlign: "center", color: C.GO, fontSize: 10, fontWeight: 600 }}>CONFIANÇA</th>
                  <th style={{ padding: "8px 6px", textAlign: "center", color: C.R, fontSize: 10, fontWeight: 600 }}>🛡️ SCORE</th>
                  <th style={{ padding: "8px 6px", textAlign: "center", color: C.GO, fontSize: 10, fontWeight: 600 }}>AÇÃO</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, i) => {
                  const confColor = corConfianca(item.confianca);
                  const fs = fraudScores[item.id] || { score: 100, flags: [] };
                  const sColor = corScore(fs.score);
                  const blocked = fs.score < 30 && item.status === "pendente";
                  return (
                    <tr
                      key={item.id}
                      style={{
                        borderBottom: `0.5px solid ${C.BD}30`,
                        background: blocked
                          ? C.R + "14"
                          : i % 2 === 0
                            ? "rgba(0,0,0,0.02)"
                            : "transparent",
                      }}
                    >
                      {filtro === "pendente" && (
                        <td style={{ padding: 6 }}>
                          <input
                            type="checkbox"
                            checked={selected.has(item.id)}
                            onChange={() => toggleSelect(item.id)}
                          />
                        </td>
                      )}
                      <td style={{ padding: 6 }}>
                        <PSGCBadge
                          variant={item.tipo_conta === "receber" ? "success" : "default"}
                          size="sm"
                        >
                          {item.tipo_conta === "receber" ? "📥 Receber" : "📤 Pagar"}
                        </PSGCBadge>
                      </td>
                      <td style={{ padding: 6, color: C.TXM, fontSize: 11 }}>{item.data_lancamento}</td>
                      <td style={{
                        padding: 6, color: C.TX, fontSize: 12, fontWeight: 500,
                        maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis",
                      }}>
                        {item.nome_cliente_fornecedor}
                      </td>
                      <td style={{ padding: 6, textAlign: "right", fontWeight: 600, color: C.TX, fontSize: 12 }}>
                        {fmtR(item.valor)}
                      </td>
                      <td style={{ padding: 6, color: C.Y, fontSize: 10 }}>{item.categoria_atual}</td>
                      <td style={{ padding: 6 }}>
                        <div style={{ color: C.G, fontSize: 10, fontWeight: 500 }}>{item.categoria_sugerida}</div>
                        {item.justificativa && (
                          <div style={{ fontSize: 8, color: C.TXD, marginTop: 2 }}>{item.justificativa}</div>
                        )}
                      </td>
                      <td style={{ padding: 6, textAlign: "center" }}>
                        <span style={{
                          fontSize: 10, padding: "2px 8px", borderRadius: 6,
                          background: confColor + "15", color: confColor, fontWeight: 600,
                          border: `1px solid ${confColor}25`,
                        }}>
                          {item.confianca}%
                        </span>
                      </td>
                      <td style={{ padding: 6, textAlign: "center" }}>
                        <span
                          title={fs.flags.join(" | ")}
                          style={{
                            fontSize: 10, padding: "2px 8px", borderRadius: 6,
                            background: sColor + "15", color: sColor, fontWeight: 700,
                            border: `1px solid ${sColor}25`,
                            cursor: fs.flags.length > 0 ? "help" : "default",
                          }}
                        >
                          {fs.score}
                        </span>
                        {fs.flags.length > 0 && (
                          <div style={{ fontSize: 7, color: sColor, marginTop: 1 }}>{fs.flags[0]}</div>
                        )}
                      </td>
                      <td style={{ padding: 6, textAlign: "center" }}>
                        {item.status === "pendente" ? (
                          blocked ? (
                            <div style={{ fontSize: 10, color: C.R, fontWeight: 600 }}>
                              Score critico, Revisar antes
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: 3, justifyContent: "center" }}>
                              <button
                                onClick={() => aprovar(item.id)}
                                style={{
                                  padding: "3px 8px", borderRadius: 4,
                                  background: C.G + "15", border: `1px solid ${C.G}30`,
                                  color: C.G, fontSize: 9, cursor: "pointer", fontWeight: 600,
                                }}
                              >
                                ✅
                              </button>
                              <button
                                onClick={() => rejeitar(item.id)}
                                style={{
                                  padding: "3px 8px", borderRadius: 4,
                                  background: C.R + "15", border: `1px solid ${C.R}30`,
                                  color: C.R, fontSize: 9, cursor: "pointer", fontWeight: 600,
                                }}
                              >
                                ❌
                              </button>
                            </div>
                          )
                        ) : (
                          <PSGCBadge
                            variant={item.status === "aprovado" ? "success" : "critical"}
                            size="sm"
                          >
                            {item.status === "aprovado" ? "Aprovado" : "Rejeitado"}
                          </PSGCBadge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sync Log */}
      {logs.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.GOL, marginBottom: 8 }}>📋 Histórico de Execuções</div>
          <div style={{ background: C.BG2, borderRadius: 12, border: `1px solid ${C.BD}`, overflow: "hidden" }}>
            <table style={{ width: "100%", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.BD}` }}>
                  <th style={{ padding: 8, textAlign: "left", color: C.GO, fontSize: 10 }}>DATA/HORA</th>
                  <th style={{ padding: 8, textAlign: "left", color: C.GO, fontSize: 10 }}>TIPO</th>
                  <th style={{ padding: 8, textAlign: "center", color: C.GO, fontSize: 10 }}>PROCESSADOS</th>
                  <th style={{ padding: 8, textAlign: "center", color: C.GO, fontSize: 10 }}>CLASSIFICADOS</th>
                  <th style={{ padding: 8, textAlign: "center", color: C.GO, fontSize: 10 }}>STATUS</th>
                  <th style={{ padding: 8, textAlign: "right", color: C.GO, fontSize: 10 }}>DURAÇÃO</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id} style={{ borderBottom: `0.5px solid ${C.BD}30` }}>
                    <td style={{ padding: 8, color: C.TXM }}>{new Date(l.created_at).toLocaleString("pt-BR")}</td>
                    <td style={{ padding: 8, color: C.TX }}>{l.tipo}</td>
                    <td style={{ padding: 8, textAlign: "center", color: C.TX }}>{l.registros_processados}</td>
                    <td style={{ padding: 8, textAlign: "center", color: C.G, fontWeight: 600 }}>{l.classificacoes_geradas}</td>
                    <td style={{ padding: 8, textAlign: "center" }}>
                      <PSGCBadge
                        variant={l.status === "sucesso" ? "success" : "critical"}
                        size="sm"
                      >
                        {l.status}
                      </PSGCBadge>
                    </td>
                    <td style={{ padding: 8, textAlign: "right", color: C.TXM }}>{(l.duracao_ms / 1000).toFixed(1)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
