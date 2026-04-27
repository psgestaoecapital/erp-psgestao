"use client";
import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { PSGC_COLORS } from "@/lib/psgc-tokens";
import PSGCButton from "@/components/psgc/PSGCButton";
import PSGCCard from "@/components/psgc/PSGCCard";

// Paleta local: mantida com nomes curtos pra preservar legibilidade,
// referenciando PSGC_COLORS como fonte de verdade.
const C = {
  GO: PSGC_COLORS.dourado,
  GOL: PSGC_COLORS.douradoSoft,
  BG: PSGC_COLORS.offWhite,
  BG2: PSGC_COLORS.offWhite,
  BG3: PSGC_COLORS.offWhiteDark,
  G: PSGC_COLORS.baixa,
  R: PSGC_COLORS.alta,
  Y: PSGC_COLORS.douradoAlerta,
  B: PSGC_COLORS.azul,
  P: PSGC_COLORS.azul,            // ROXO->AZUL (so Omie = informativo)
  BD: PSGC_COLORS.offWhiteDarker,
  TX: PSGC_COLORS.espresso,
  TXM: PSGC_COLORS.espressoLight,
  TXD: PSGC_COLORS.espressoLight,
};

const fmtR = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

export default function ConciliacaoPage() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [selComp, setSelComp] = useState("");
  const [uploading, setUploading] = useState(false);
  const [operadora, setOperadora] = useState("Visa");
  const [resumo, setResumo] = useState<any>(null);
  const [concId, setConcId] = useState<string | null>(null);
  const [itens, setItens] = useState<any[]>([]);
  const [historico, setHistorico] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const [filtro, setFiltro] = useState("todos");
  const [, setLoading] = useState(true);

  useEffect(() => { loadCompanies(); }, []);
  useEffect(() => { if (selComp && typeof window !== "undefined") localStorage.setItem("ps_empresa_sel", selComp); }, [selComp]);
  useEffect(() => { if (selComp) loadHistorico(); }, [selComp]);

  const loadCompanies = async () => {
    const { data: { user: authU } } = await supabase.auth.getUser();
    const { data: uP } = authU ? await supabase.from("users").select("role").eq("id", authU.id).single() : { data: null };
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
      const saved = typeof window !== "undefined" ? localStorage.getItem("ps_empresa_sel") : "";
      const match = saved
        ? (saved === "consolidado" ? data[0]
           : saved.startsWith("group_") ? data.find((c: any) => c.group_id === saved.replace("group_", "")) || data[0]
           : data.find((c: any) => c.id === saved))
        : null;
      setSelComp(match ? match.id : data[0].id);
    }
    setLoading(false);
  };

  const loadHistorico = async () => {
    const { data } = await supabase.from("conciliacao_cartao").select("*").eq("company_id", selComp).order("created_at", { ascending: false }).limit(10);
    setHistorico(data || []);
  };

  const loadItens = async (id: string) => {
    setConcId(id);
    const { data } = await supabase.from("conciliacao_itens").select("*").eq("conciliacao_id", id).order("status,valor");
    setItens(data || []);
  };

  const upload = async (file: File) => {
    setUploading(true); setMsg(""); setResumo(null); setConcId(null); setItens([]);
    const form = new FormData();
    form.append("file", file);
    form.append("company_id", selComp);
    form.append("operadora", operadora);
    try {
      const res = await authFetch("/api/conciliacao", { method: "POST", body: form });
      const d = await res.json();
      if (d.success) {
        setResumo(d.resumo);
        setConcId(d.conciliacao_id);
        loadItens(d.conciliacao_id);
        loadHistorico();
        setMsg(`✅ ${d.resumo.transacoes_fatura} transações processadas!`);
      } else {
        setMsg(`❌ ${d.error}`);
      }
    } catch (e: any) {
      setMsg(`❌ ${e.message}`);
    }
    setUploading(false);
  };

  const updateStatus = async (id: string, status: string) => {
    await supabase.from("conciliacao_itens").update({ status, operador_acao: status }).eq("id", id);
    if (concId) loadItens(concId);
  };

  const aprovarTodos = async () => {
    const conc = itens.filter(i => i.status === "conciliado" || i.status === "sugestao");
    for (const c of conc) await supabase.from("conciliacao_itens").update({ status: "aprovado", operador_acao: "aprovado" }).eq("id", c.id);
    if (concId) loadItens(concId);
    setMsg(`✅ ${conc.length} itens aprovados!`);
    setTimeout(() => setMsg(""), 3000);
  };

  const filtered = filtro === "todos" ? itens : itens.filter(i => i.status === filtro);
  const counts = {
    conciliado: itens.filter(i => i.status === "conciliado").length,
    sugestao: itens.filter(i => i.status === "sugestao").length,
    somente_fatura: itens.filter(i => i.status === "somente_fatura").length,
    somente_omie: itens.filter(i => i.status === "somente_omie").length,
    aprovado: itens.filter(i => i.status === "aprovado").length,
  };
  const stCfg: Record<string, { cor: string; icon: string; label: string }> = {
    conciliado: { cor: C.G, icon: "✅", label: "Conciliado" },
    sugestao: { cor: C.Y, icon: "⚠️", label: "Sugestão IA" },
    somente_fatura: { cor: C.R, icon: "❌", label: "Só Fatura" },
    somente_omie: { cor: C.P, icon: "🔍", label: "Só Omie" },
    aprovado: { cor: C.G, icon: "✅", label: "Aprovado" },
    rejeitado: { cor: C.R, icon: "❌", label: "Rejeitado" },
    pendente: { cor: C.TXM, icon: "⏳", label: "Pendente" },
  };
  const inp: React.CSSProperties = { background: C.BG3, border: `1px solid ${C.BD}`, color: C.TX, borderRadius: 8, padding: "8px 12px", fontSize: 12, outline: "none", fontFamily: "inherit" };

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: "0 auto", background: C.BG, minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.GO }}>💳 Conciliação de Cartão de Crédito</div>
          <div style={{ fontSize: 11, color: C.TXM }}>Upload da fatura (OFX/CSV) → Matching automático com Omie → Aprovação</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <PSGCButton variant="ghost" size="sm" onClick={() => { window.location.href = "/dashboard/bpo"; }}>
            ← BPO
          </PSGCButton>
        </div>
      </div>

      {msg && (
        <div style={{ marginBottom: 12 }}>
          <PSGCCard
            variant={msg.startsWith("✅") ? "success" : "critical"}
            onClick={() => setMsg("")}
            padding="10px 16px"
          >
            <div style={{ fontSize: 12, color: msg.startsWith("✅") ? C.G : C.R, fontWeight: 600 }}>{msg}</div>
          </PSGCCard>
        </div>
      )}

      {/* Upload */}
      <div style={{ background: C.BG2, borderRadius: 14, padding: 16, border: `1px solid ${C.BD}`, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.GO, marginBottom: 12 }}>📤 Upload da Fatura</div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10, color: C.TXM, marginBottom: 3 }}>Empresa</div>
            <select value={selComp} onChange={e => setSelComp(e.target.value)} style={{ ...inp, width: 220 }}>
              {companies.map(c => <option key={c.id} value={c.id}>{c.nome_fantasia || c.razao_social}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.TXM, marginBottom: 3 }}>Operadora</div>
            <select value={operadora} onChange={e => setOperadora(e.target.value)} style={{ ...inp, width: 140 }}>
              {["Visa", "Mastercard", "Elo", "Amex", "Hipercard", "Sicredi", "Stone", "PagSeguro", "Cielo", "Rede", "Getnet", "Outro"].map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.TXM, marginBottom: 3 }}>Arquivo (OFX, CSV, TXT)</div>
            <input
              type="file"
              accept=".ofx,.ofc,.csv,.txt,.tsv"
              onChange={e => { if (e.target.files?.[0]) upload(e.target.files[0]); }}
              disabled={uploading}
              style={{ fontSize: 11, color: C.TX }}
            />
          </div>
          {uploading && <div style={{ fontSize: 12, color: C.GO, fontWeight: 600 }}>⏳ Processando...</div>}
        </div>
        <div style={{ fontSize: 10, color: C.TXD, marginTop: 8 }}>O sistema detecta automaticamente o formato e as colunas. Suporta extratos OFX de qualquer banco e CSV de qualquer operadora.</div>
      </div>

      {/* KPIs */}
      {resumo && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginBottom: 14 }}>
          {[
            { l: "Transações", v: resumo.transacoes_fatura, c: C.TX, i: "💳" },
            { l: "Conciliados", v: resumo.conciliados, c: C.G, i: "✅" },
            { l: "Sugestões IA", v: resumo.sugestoes, c: C.Y, i: "⚠️" },
            { l: "Só Fatura", v: resumo.somente_fatura, c: C.R, i: "❌" },
            { l: "Só Omie", v: resumo.somente_omie, c: C.P, i: "🔍" },
            { l: "Divergência", v: fmtR(resumo.divergencia), c: Math.abs(resumo.divergencia) < 1 ? C.G : C.R, i: "📊" },
          ].map((k, i) => (
            <div key={i} style={{ background: C.BG2, borderRadius: 12, padding: "12px", border: `1px solid ${C.BD}`, textAlign: "center" }}>
              <div style={{ fontSize: 16, marginBottom: 2 }}>{k.i}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: k.c }}>{k.v}</div>
              <div style={{ fontSize: 9, color: C.TXM, marginTop: 2 }}>{k.l}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters + Actions */}
      {itens.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {[
              ["todos", "Todos"],
              ["conciliado", `✅ (${counts.conciliado})`],
              ["sugestao", `⚠️ (${counts.sugestao})`],
              ["somente_fatura", `❌ Fatura (${counts.somente_fatura})`],
              ["somente_omie", `🔍 Omie (${counts.somente_omie})`],
            ].map(([k, l]) => (
              <button
                key={k}
                onClick={() => setFiltro(k)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 8,
                  fontSize: 10,
                  cursor: "pointer",
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
          {(counts.conciliado + counts.sugestao) > 0 && (
            <button
              onClick={aprovarTodos}
              style={{ padding: "6px 14px", borderRadius: 8, background: C.G + "15", border: `1px solid ${C.G}30`, color: C.G, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
            >
              ✅ Aprovar Todos ({counts.conciliado + counts.sugestao})
            </button>
          )}
        </div>
      )}

      {/* Items table */}
      {itens.length > 0 && (
        <div style={{ background: C.BG2, borderRadius: 12, border: `1px solid ${C.BD}`, overflow: "hidden", marginBottom: 14 }}>
          <div style={{ overflowX: "auto", maxHeight: 500, overflowY: "auto" }}>
            <table style={{ width: "100%", fontSize: 11, minWidth: 900 }}>
              <thead style={{ position: "sticky", top: 0, background: C.BG2, zIndex: 1 }}>
                <tr style={{ borderBottom: `1px solid ${C.BD}` }}>
                  <th style={{ padding: "8px 6px", textAlign: "center", color: C.GO, fontSize: 9, fontWeight: 600 }}>STATUS</th>
                  <th style={{ padding: "8px 6px", textAlign: "left", color: C.GO, fontSize: 9, fontWeight: 600 }}>DATA</th>
                  <th style={{ padding: "8px 6px", textAlign: "left", color: C.GO, fontSize: 9, fontWeight: 600 }}>FATURA</th>
                  <th style={{ padding: "8px 6px", textAlign: "right", color: C.GO, fontSize: 9, fontWeight: 600 }}>VALOR FAT.</th>
                  <th style={{ padding: "8px 6px", textAlign: "center", color: C.GO, fontSize: 9, fontWeight: 600 }}>MATCH</th>
                  <th style={{ padding: "8px 6px", textAlign: "left", color: C.GO, fontSize: 9, fontWeight: 600 }}>OMIE</th>
                  <th style={{ padding: "8px 6px", textAlign: "right", color: C.GO, fontSize: 9, fontWeight: 600 }}>VALOR OMIE</th>
                  <th style={{ padding: "8px 6px", textAlign: "center", color: C.GO, fontSize: 9, fontWeight: 600 }}>AÇÃO</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, i) => {
                  const st = stCfg[item.status] || stCfg.pendente;
                  const diff = item.match_valor > 0 ? item.valor - item.match_valor : 0;
                  return (
                    <tr key={item.id} style={{ borderBottom: `0.5px solid ${C.BD}30`, background: i % 2 === 0 ? "rgba(0,0,0,0.02)" : "transparent" }}>
                      <td style={{ padding: "6px", textAlign: "center" }}>
                        <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 6, background: `${st.cor}15`, color: st.cor, fontWeight: 600, border: `1px solid ${st.cor}25`, whiteSpace: "nowrap" }}>
                          {st.icon} {st.label}
                        </span>
                      </td>
                      <td style={{ padding: "6px", color: C.TXM, fontSize: 11, whiteSpace: "nowrap" }}>{item.data_transacao}</td>
                      <td style={{ padding: "6px", color: C.TX, fontSize: 12, fontWeight: 500, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{item.descricao || "—"}</td>
                      <td style={{ padding: "6px", textAlign: "right", fontWeight: 600, color: item.fonte === "fatura" ? C.TX : C.TXD, fontSize: 12 }}>{item.fonte === "fatura" ? fmtR(item.valor) : "—"}</td>
                      <td style={{ padding: "6px", textAlign: "center" }}>
                        {item.match_score > 0 ? (
                          <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: item.match_score >= 70 ? C.G + "15" : C.Y + "15", color: item.match_score >= 70 ? C.G : C.Y, fontWeight: 600 }}>
                            {item.match_score}%
                          </span>
                        ) : "—"}
                      </td>
                      <td style={{ padding: "6px", color: item.match_descricao ? C.G : item.fonte === "omie" ? C.TX : C.TXD, fontSize: 11 }}>
                        {item.match_descricao || (item.fonte === "omie" ? item.descricao : "") || "—"}
                      </td>
                      <td style={{ padding: "6px", textAlign: "right", fontWeight: 600, color: C.TX, fontSize: 12 }}>
                        {item.match_valor > 0 ? fmtR(item.match_valor) : item.fonte === "omie" ? fmtR(item.valor) : "—"}
                        {Math.abs(diff) > 0.01 && <div style={{ fontSize: 8, color: C.R }}>Δ {fmtR(diff)}</div>}
                      </td>
                      <td style={{ padding: "6px", textAlign: "center" }}>
                        {item.status !== "aprovado" && item.status !== "rejeitado" ? (
                          <div style={{ display: "flex", gap: 3, justifyContent: "center" }}>
                            <button onClick={() => updateStatus(item.id, "aprovado")} style={{ padding: "2px 6px", borderRadius: 4, background: C.G + "15", border: `1px solid ${C.G}30`, color: C.G, fontSize: 9, cursor: "pointer" }}>✅</button>
                            <button onClick={() => updateStatus(item.id, "rejeitado")} style={{ padding: "2px 6px", borderRadius: 4, background: C.R + "15", border: `1px solid ${C.R}30`, color: C.R, fontSize: 9, cursor: "pointer" }}>❌</button>
                          </div>
                        ) : (
                          <span style={{ fontSize: 9, color: item.status === "aprovado" ? C.G : C.R }}>
                            {item.status === "aprovado" ? "✅" : "❌"}
                          </span>
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

      {/* History */}
      {historico.length > 0 && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.GO, marginBottom: 8 }}>📋 Histórico</div>
          <div style={{ background: C.BG2, borderRadius: 12, border: `1px solid ${C.BD}`, overflow: "hidden" }}>
            <table style={{ width: "100%", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.BD}` }}>
                  {["DATA", "ARQUIVO", "OPERADORA", "TOTAL", "CONCIL.", "DIVERG.", "DIVERGÊNCIA", ""].map(h => (
                    <th key={h} style={{ padding: "8px", textAlign: h === "TOTAL" || h === "DIVERGÊNCIA" ? "right" : "left", color: C.GO, fontSize: 9 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {historico.map(h => (
                  <tr key={h.id} style={{ borderBottom: `0.5px solid ${C.BD}30` }}>
                    <td style={{ padding: "8px", color: C.TXM }}>{new Date(h.created_at).toLocaleDateString("pt-BR")}</td>
                    <td style={{ padding: "8px", color: C.TX, fontWeight: 500 }}>{h.nome_fatura}</td>
                    <td style={{ padding: "8px", color: C.TXM }}>{h.operadora}</td>
                    <td style={{ padding: "8px", textAlign: "right", color: C.TX, fontWeight: 600 }}>{fmtR(h.total_fatura)}</td>
                    <td style={{ padding: "8px", color: C.G, fontWeight: 600 }}>{h.itens_conciliados}</td>
                    <td style={{ padding: "8px", color: h.itens_divergentes > 0 ? C.Y : C.TXD }}>{h.itens_divergentes + h.itens_somente_fatura}</td>
                    <td style={{ padding: "8px", textAlign: "right", color: Math.abs(h.divergencia) < 1 ? C.G : C.R, fontWeight: 600 }}>{fmtR(h.divergencia)}</td>
                    <td style={{ padding: "8px" }}>
                      <button onClick={() => loadItens(h.id)} style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.GO}30`, background: "transparent", color: C.GO, fontSize: 10, cursor: "pointer" }}>
                        Ver
                      </button>
                    </td>
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
