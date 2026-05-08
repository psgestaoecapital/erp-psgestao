"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Activity, ChevronDown, ChevronUp } from "lucide-react";

interface ItemJoin {
  connector_name: string | null;
}

interface SyncLogRow {
  id: string;
  item_id: string | null;
  origem: string;
  status: string;
  total_accounts: number | null;
  total_investments: number | null;
  total_transactions: number | null;
  total_inseridas: number | null;
  total_atualizadas: number | null;
  duracao_ms: number | null;
  erro_msg: string | null;
  executado_em: string;
  item: ItemJoin | ItemJoin[] | null;
}

interface SyncLog {
  id: string;
  item_id: string | null;
  origem: string;
  status: string;
  total_accounts: number | null;
  total_investments: number | null;
  total_transactions: number | null;
  total_inseridas: number | null;
  total_atualizadas: number | null;
  duracao_ms: number | null;
  erro_msg: string | null;
  executado_em: string;
  connector_name: string | null;
}

const origemLabels: Record<string, string> = {
  cron: "Automático (cron)",
  webhook: "Webhook Pluggy",
  manual_consultor: "Manual",
  cliente_refresh: "Refresh do cliente",
  item_created: "Primeira sync",
};

const statusStyles: Record<string, { color: string; bg: string }> = {
  sucesso: { color: "#047857", bg: "#ECFDF5" },
  parcial: { color: "#B45309", bg: "#FFFBEB" },
  erro: { color: "#B91C1C", bg: "#FEF2F2" },
};

export function SyncHistorySection({ clienteId }: { clienteId: string }) {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from("wealth_pluggy_sync_log")
        .select(
          `id, item_id, origem, status,
           total_accounts, total_investments, total_transactions,
           total_inseridas, total_atualizadas,
           duracao_ms, erro_msg, executado_em,
           item:wealth_pluggy_items ( connector_name )`
        )
        .eq("client_id", clienteId)
        .order("executado_em", { ascending: false })
        .limit(20);

      if (mounted && data) {
        setLogs(
          (data as SyncLogRow[]).map((l) => {
            const itemRel = Array.isArray(l.item) ? l.item[0] : l.item;
            return {
              id: l.id,
              item_id: l.item_id,
              origem: l.origem,
              status: l.status,
              total_accounts: l.total_accounts,
              total_investments: l.total_investments,
              total_transactions: l.total_transactions,
              total_inseridas: l.total_inseridas,
              total_atualizadas: l.total_atualizadas,
              duracao_ms: l.duracao_ms,
              erro_msg: l.erro_msg,
              executado_em: l.executado_em,
              connector_name: itemRel?.connector_name ?? null,
            };
          })
        );
      }
      if (mounted) setLoading(false);
    };
    load();
    return () => {
      mounted = false;
    };
  }, [clienteId]);

  if (loading) {
    return (
      <div
        className="rounded-lg border p-4 animate-pulse"
        style={{
          borderColor: "rgba(61, 35, 20, 0.1)",
          backgroundColor: "#FAF7F2",
        }}
      >
        <div
          className="h-5 rounded w-32"
          style={{ backgroundColor: "rgba(61, 35, 20, 0.05)" }}
        />
      </div>
    );
  }

  if (logs.length === 0) return null;

  const visible = expanded ? logs : logs.slice(0, 3);

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: "rgba(61, 35, 20, 0.1)", backgroundColor: "#FAF7F2" }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-6 py-4 border-b flex items-center justify-between hover:opacity-90"
        style={{ borderColor: "rgba(61, 35, 20, 0.1)" }}
      >
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4" style={{ color: "#C8941A" }} />
          <h2 className="text-lg font-semibold" style={{ color: "#3D2314" }}>
            Histórico de sincronizações
          </h2>
          <span className="text-xs" style={{ color: "rgba(61, 35, 20, 0.6)" }}>
            ({logs.length})
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4" style={{ color: "rgba(61, 35, 20, 0.6)" }} />
        ) : (
          <ChevronDown className="h-4 w-4" style={{ color: "rgba(61, 35, 20, 0.6)" }} />
        )}
      </button>

      <div>
        {visible.map((log, idx) => {
          const sStyle =
            statusStyles[log.status] || { color: "#374151", bg: "#F3F4F6" };
          return (
            <div
              key={log.id}
              className="px-6 py-3"
              style={
                idx > 0
                  ? { borderTop: "1px solid rgba(61, 35, 20, 0.05)" }
                  : undefined
              }
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="font-medium text-sm"
                      style={{ color: "#3D2314" }}
                    >
                      {log.connector_name || "Item removido"}
                    </span>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{ color: sStyle.color, backgroundColor: sStyle.bg }}
                    >
                      {log.status}
                    </span>
                    <span
                      className="text-xs"
                      style={{ color: "rgba(61, 35, 20, 0.6)" }}
                    >
                      {origemLabels[log.origem] || log.origem}
                    </span>
                  </div>
                  <div
                    className="text-xs mt-0.5"
                    style={{ color: "rgba(61, 35, 20, 0.6)" }}
                  >
                    {new Date(log.executado_em).toLocaleString("pt-BR")}
                    {log.duracao_ms && ` · ${(log.duracao_ms / 1000).toFixed(1)}s`}
                    {(log.total_inseridas || 0) > 0 &&
                      ` · ${log.total_inseridas} novas`}
                    {(log.total_atualizadas || 0) > 0 &&
                      ` · ${log.total_atualizadas} atualizadas`}
                  </div>
                  {log.erro_msg && (
                    <div
                      className="text-xs mt-1 truncate"
                      style={{ color: "#DC2626" }}
                      title={log.erro_msg}
                    >
                      {log.erro_msg.substring(0, 120)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {!expanded && logs.length > 3 && (
          <button
            onClick={() => setExpanded(true)}
            className="w-full px-6 py-2 text-xs hover:opacity-80"
            style={{ color: "rgba(61, 35, 20, 0.6)" }}
          >
            Ver mais {logs.length - 3} sincronizações
          </button>
        )}
      </div>
    </div>
  );
}
