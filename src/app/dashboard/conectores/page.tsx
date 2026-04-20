"use client";
// src/app/dashboard/conectores/page.tsx
// PS Gestão ERP — Painel de Conectores (sync Omie → PS Gestão)

import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";

const BG="var(--ps-bg,#FAF7F2)",BG2="var(--ps-bg2,#FFFFFF)",BG3="var(--ps-bg3,#F0ECE3)";
const TX="var(--ps-text,#3D2314)",TXM="var(--ps-text-m,#6B5D4F)",TXD="var(--ps-text-d,#9C8E80)";
const BD="var(--ps-border,#E0D8CC)",GO="var(--ps-gold,#C8941A)";
const G="#22C55E",R="#EF4444",B="#3B82F6",Y="#F59E0B";

type SyncLog = {
  id: string;
  company_id: string;
  tipo: string;
  total_omie: number;
  inseridos: number;
  atualizados: number;
  erros: number;
  duracao_ms: number;
  detalhes_erros: string;
  executado_em: string;
  status: string;
};

export default function ConectoresPage() {
  const { companies, sel, companyIds } = useCompanyIds();
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [integracoes, setIntegracoes] = useState<any[]>([]);
  const [loading, setLoading] = useState<string>(""); // "fornecedores" | "clientes" | "produtos" | "full" | ""
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<any>(null);

  // Empresa para sync (quando em modo grupo/consolidado, escolhe a primeira)
  const companyIdSync = useMemo(() => {
    if (sel && !sel.startsWith("group_") && sel !== "consolidado") return sel;
    return companyIds[0] || "";
  }, [sel, companyIds]);

  const companyNameSync = useMemo(() => {
    return companies.find(c => c.id === companyIdSync)?.nome_fantasia || "—";
  }, [companies, companyIdSync]);

  useEffect(() => {
    if (companyIdSync) {
      loadLogs();
      loadIntegracoes();
    }
  }, [companyIdSync]);

  const loadLogs = async () => {
    const { data } = await supabase
      .from("omie_sync_log")
      .select("*")
      .eq("company_id", companyIdSync)
      .order("executado_em", { ascending: false })
      .limit(30);
    if (data) setLogs(data);
  };

  const loadIntegracoes = async () => {
    const { data } = await supabase
      .from("api_integrations")
      .select("*")
      .eq("company_id", companyIdSync);
    if (data) setIntegracoes(data);
  };

  const executarSync = async (tipo: "fornecedores" | "clientes" | "produtos" | "full") => {
    if (!companyIdSync) {
      setMsg("❌ Selecione uma empresa para sincronizar");
      return;
    }

    setLoading(tipo);
    setResult(null);
    setMsg("");

    try {
      const endpoint = tipo === "full" ? "full" : tipo;
      const r = await fetch(`/api/sync/omie/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyIdSync }),
      });
      const data = await r.json();

      if (!r.ok || data.error) {
        setMsg(`❌ Erro: ${data.error || r.statusText}`);
        setLoading("");
        return;
      }

      setResult(data);
      setMsg(`✅ Sync ${tipo} concluído — ${data.inseridos || 0} novos, ${data.atualizados || 0} atualizados, ${data.erros || 0} erros`);
      await loadLogs();
    } catch (err: any) {
      setMsg(`❌ Falha: ${err.message}`);
    } finally {
      setLoading("");
    }
  };

  const omieIntegracao = integracoes.find(i => i.provider === "omie");
  const omieAtivo = omieIntegracao?.active === true;

  const fmtDuracao = (ms: number) => {
    if (!ms) return "—";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  };

  const fmtDT = (dt: string) => {
    if (!dt) return "—";
    return new Date(dt).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit"
    });
  };

  const fmtTipo = (tipo: string) => {
    const map: any = {
      fornecedores: "🚚 Fornecedores",
      clientes: "👥 Clientes",
      produtos: "📦 Produtos",
      full: "🔄 Sync Completo",
      contas_pagar: "💸 Contas Pagar",
      contas_receber: "💰 Contas Receber",
    };
    return map[tipo] || tipo;
  };

  const card: React.CSSProperties = {
    background: BG2,
    borderRadius: 12,
    padding: 20,
    border: `1px solid ${BD}`,
  };

  const btnPrimary: React.CSSProperties = {
    padding: "10px 18px",
    borderRadius: 8,
    background: GO,
    color: "#FFF",
    fontSize: 12,
    fontWeight: 600,
    border: "none",
    cursor: "pointer",
  };

  const btnSecondary: React.CSSProperties = {
    ...btnPrimary,
    background: BG3,
    color: TX,
    border: `1px solid ${BD}`,
  };

  return (
    <div style={{ minHeight: "100vh", background: BG, padding: 20 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: TX }}>🔌 Conectores</div>
        <div style={{ fontSize: 11, color: TXD, marginTop: 4 }}>
          Sincronização de dados entre sistemas externos e o PS Gestão
          <span style={{ margin: "0 8px" }}>·</span>
          <span style={{ fontWeight: 600, color: TXM }}>🏢 {companyNameSync}</span>
        </div>
      </div>

      {msg && (
        <div
          style={{
            background: msg.startsWith("✅") ? G + "15" : msg.startsWith("❌") ? R + "15" : Y + "15",
            border: `1px solid ${msg.startsWith("✅") ? G : msg.startsWith("❌") ? R : Y}40`,
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 12,
            color: msg.startsWith("✅") ? G : msg.startsWith("❌") ? R : Y,
            cursor: "pointer",
          }}
          onClick={() => setMsg("")}
        >
          {msg}
        </div>
      )}

      {/* Status do Conector Omie */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 28 }}>🔗</div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: TX }}>Omie ERP</div>
              <div style={{ fontSize: 11, color: TXD }}>
                {omieAtivo ? (
                  <span style={{ color: G, fontWeight: 600 }}>● Conectado</span>
                ) : (
                  <span style={{ color: R, fontWeight: 600 }}>● Desconectado</span>
                )}
                {" "}· Sincronização Omie → PS Gestão
              </div>
            </div>
          </div>
          {!omieAtivo && (
            <a
              href="/dashboard/dados"
              style={{ ...btnSecondary, textDecoration: "none", display: "inline-block" }}
            >
              ⚙️ Configurar
            </a>
          )}
        </div>

        {omieAtivo && (
          <>
            <div style={{ fontSize: 11, color: TXM, marginBottom: 12 }}>
              Clique em um botão abaixo para sincronizar os dados do Omie para o PS Gestão. A operação é <strong>segura</strong> —
              apenas lê dados do Omie, nunca modifica nada lá.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              <button
                onClick={() => executarSync("fornecedores")}
                disabled={loading !== ""}
                style={{ ...btnPrimary, opacity: loading !== "" && loading !== "fornecedores" ? 0.4 : 1 }}
              >
                {loading === "fornecedores" ? "⏳ Sincronizando..." : "🚚 Sync Fornecedores"}
              </button>
              <button
                onClick={() => executarSync("clientes")}
                disabled={loading !== ""}
                style={{ ...btnPrimary, opacity: loading !== "" && loading !== "clientes" ? 0.4 : 1 }}
              >
                {loading === "clientes" ? "⏳ Sincronizando..." : "👥 Sync Clientes"}
              </button>
              <button
                onClick={() => executarSync("produtos")}
                disabled={loading !== ""}
                style={{ ...btnPrimary, opacity: loading !== "" && loading !== "produtos" ? 0.4 : 1 }}
              >
                {loading === "produtos" ? "⏳ Sincronizando..." : "📦 Sync Produtos"}
              </button>
              <button
                onClick={() => executarSync("full")}
                disabled={loading !== ""}
                style={{ ...btnPrimary, background: "#3D2314", opacity: loading !== "" && loading !== "full" ? 0.4 : 1 }}
              >
                {loading === "full" ? "⏳ Sync Total..." : "🔄 Sync Completo"}
              </button>
            </div>

            {loading !== "" && (
              <div style={{ marginTop: 16, padding: 12, background: Y + "15", border: `1px solid ${Y}40`, borderRadius: 8, fontSize: 11, color: Y }}>
                ⚠️ <strong>Não feche esta aba durante a sincronização.</strong> Pode levar de 30 segundos até 10 minutos dependendo do volume de dados.
              </div>
            )}

            {result && (
              <div style={{ marginTop: 16, padding: 14, background: G + "10", border: `1px solid ${G}40`, borderRadius: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: G, marginBottom: 8 }}>✅ Última Sincronização</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, fontSize: 11 }}>
                  <div><strong>Total Omie:</strong> {result.total_omie ?? "—"}</div>
                  <div><strong>✅ Novos:</strong> {result.inseridos ?? 0}</div>
                  <div><strong>↻ Atualizados:</strong> {result.atualizados ?? 0}</div>
                  <div style={{ color: result.erros > 0 ? R : TXM }}><strong>❌ Erros:</strong> {result.erros ?? 0}</div>
                  <div><strong>⏱ Duração:</strong> {fmtDuracao(result.duracao_ms)}</div>
                </div>
                {result.errosDetalhes?.length > 0 && (
                  <details style={{ marginTop: 10, fontSize: 10, color: R }}>
                    <summary style={{ cursor: "pointer" }}>Ver detalhes dos erros ({result.errosDetalhes.length})</summary>
                    <ul style={{ marginTop: 6, paddingLeft: 20 }}>
                      {result.errosDetalhes.map((e: string, i: number) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Histórico de Syncs */}
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, color: TX, marginBottom: 12 }}>
          📜 Histórico de Sincronizações
        </div>

        {logs.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: TXD }}>
            Nenhuma sincronização registrada ainda
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${BD}` }}>
                  <th style={{ padding: "8px 10px", textAlign: "left", color: TXD, fontWeight: 600 }}>Data/Hora</th>
                  <th style={{ padding: "8px 10px", textAlign: "left", color: TXD, fontWeight: 600 }}>Tipo</th>
                  <th style={{ padding: "8px 10px", textAlign: "right", color: TXD, fontWeight: 600 }}>Total Omie</th>
                  <th style={{ padding: "8px 10px", textAlign: "right", color: TXD, fontWeight: 600 }}>Novos</th>
                  <th style={{ padding: "8px 10px", textAlign: "right", color: TXD, fontWeight: 600 }}>Atualizados</th>
                  <th style={{ padding: "8px 10px", textAlign: "right", color: TXD, fontWeight: 600 }}>Erros</th>
                  <th style={{ padding: "8px 10px", textAlign: "right", color: TXD, fontWeight: 600 }}>Duração</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id} style={{ borderBottom: `1px solid ${BD}40` }}>
                    <td style={{ padding: "8px 10px", color: TX }}>{fmtDT(log.executado_em)}</td>
                    <td style={{ padding: "8px 10px", color: TX, fontWeight: 600 }}>{fmtTipo(log.tipo)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: TXM }}>{log.total_omie}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: G, fontWeight: 600 }}>+{log.inseridos}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: B, fontWeight: 600 }}>↻{log.atualizados}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: log.erros > 0 ? R : TXD, fontWeight: log.erros > 0 ? 700 : 400 }}>
                      {log.erros > 0 ? `✗${log.erros}` : "—"}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: TXM }}>{fmtDuracao(log.duracao_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ marginTop: 20, fontSize: 10, color: TXD, textAlign: "center" }}>
        PS Gestão ERP · Conectores v1.0 · Sync Omie → PS (unidirecional, seguro)
      </div>
    </div>
  );
}
