"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  Link2,
  FileText,
  AlertCircle,
  CheckCircle2,
  Clock,
  type LucideIcon,
} from "lucide-react";

interface PluggyItem {
  id: string;
  pluggy_item_id: string;
  connector_name: string | null;
  connector_type: string | null;
  status: string;
  ultimo_sync_em: string | null;
  ultimo_erro_msg: string | null;
  created_at: string;
}

interface OFXUpload {
  id: string;
  filename: string;
  corretora_detectada: string | null;
  total_transactions: number | null;
  status: string;
  created_at: string;
}

const statusVisualPluggy: Record<
  string,
  { label: string; icon: LucideIcon; color: string }
> = {
  UPDATED: { label: "Atualizado", icon: CheckCircle2, color: "#059669" },
  UPDATING: { label: "Atualizando", icon: Clock, color: "#2563EB" },
  LOGIN_IN_PROGRESS: { label: "Login em progresso", icon: Clock, color: "#2563EB" },
  WAITING_USER_INPUT: { label: "Aguardando MFA", icon: AlertCircle, color: "#D97706" },
  LOGIN_ERROR: { label: "Erro de login", icon: AlertCircle, color: "#DC2626" },
  OUTDATED: { label: "Desatualizado", icon: AlertCircle, color: "#D97706" },
  REVOKED: { label: "Revogado", icon: AlertCircle, color: "#6B7280" },
  DELETED: { label: "Removido", icon: AlertCircle, color: "#6B7280" },
};

export function ClienteConexoesSection({
  clienteId,
  onChange,
}: {
  clienteId: string;
  onChange: () => void;
}) {
  const [items, setItems] = useState<PluggyItem[]>([]);
  const [uploads, setUploads] = useState<OFXUpload[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const [itemsR, uploadsR] = await Promise.all([
        supabase
          .from("wealth_pluggy_items")
          .select(
            "id, pluggy_item_id, connector_name, connector_type, status, ultimo_sync_em, ultimo_erro_msg, created_at"
          )
          .eq("client_id", clienteId)
          .order("created_at", { ascending: false }),
        supabase
          .from("wealth_ofx_uploads")
          .select(
            "id, filename, corretora_detectada, total_transactions, status, created_at"
          )
          .eq("client_id", clienteId)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

      if (mounted) {
        setItems(itemsR.data || []);
        setUploads(uploadsR.data || []);
        setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [clienteId]);

  const handleRevogarPluggy = async (itemUuid: string) => {
    if (
      !confirm(
        "Confirma revogar esta conexão? O histórico de dados será preservado por 5 anos (CVM 19), mas a sincronização automática será interrompida."
      )
    ) {
      return;
    }
    try {
      const { error } = await supabase.rpc("sp_pluggy_revoke_item", {
        p_item_id: itemUuid,
        p_motivo: "Revogado pelo consultor via UI",
      });
      if (error) throw error;
      onChange();
    } catch (e) {
      alert(`Erro ao revogar: ${(e as Error).message}`);
    }
  };

  if (loading) {
    return (
      <div
        className="rounded-lg border p-6"
        style={{ borderColor: "rgba(61, 35, 20, 0.1)", backgroundColor: "#FAF7F2" }}
      >
        <div
          className="h-6 rounded w-32 mb-4 animate-pulse"
          style={{ backgroundColor: "rgba(61, 35, 20, 0.05)" }}
        />
        <div
          className="h-20 rounded animate-pulse"
          style={{ backgroundColor: "rgba(61, 35, 20, 0.05)" }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        className="rounded-lg border overflow-hidden"
        style={{ borderColor: "rgba(61, 35, 20, 0.1)", backgroundColor: "#FAF7F2" }}
      >
        <div
          className="px-6 py-4 border-b flex items-center gap-2"
          style={{ borderColor: "rgba(61, 35, 20, 0.1)" }}
        >
          <Link2 className="h-4 w-4" style={{ color: "#C8941A" }} />
          <h2 className="text-lg font-semibold" style={{ color: "#3D2314" }}>
            Conexões Open Finance
          </h2>
        </div>

        {items.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm" style={{ color: "rgba(61, 35, 20, 0.6)" }}>
              Nenhuma conexão Pluggy ativa ainda.
            </p>
            <p className="text-xs mt-1" style={{ color: "rgba(61, 35, 20, 0.4)" }}>
              Use o botão &quot;Conectar conta&quot; no topo da página.
            </p>
          </div>
        ) : (
          <div>
            {items.map((item, idx) => {
              const visual = statusVisualPluggy[item.status] || {
                label: item.status,
                icon: AlertCircle,
                color: "#6B7280",
              };
              const StatusIcon = visual.icon;
              const isAtivo = !["REVOKED", "DELETED"].includes(item.status);
              return (
                <div
                  key={item.id}
                  className="px-6 py-3 flex items-center justify-between gap-4"
                  style={
                    idx > 0
                      ? { borderTop: "1px solid rgba(61, 35, 20, 0.05)" }
                      : undefined
                  }
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium" style={{ color: "#3D2314" }}>
                      {item.connector_name || "Desconhecida"}
                    </div>
                    <div
                      className="flex items-center gap-2 text-xs mt-0.5"
                      style={{ color: "rgba(61, 35, 20, 0.6)" }}
                    >
                      <StatusIcon
                        className="h-3 w-3"
                        style={{ color: visual.color }}
                      />
                      <span style={{ color: visual.color }}>{visual.label}</span>
                      {item.ultimo_sync_em && (
                        <>
                          <span>•</span>
                          <span>
                            sync{" "}
                            {new Date(item.ultimo_sync_em).toLocaleString("pt-BR", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })}
                          </span>
                        </>
                      )}
                    </div>
                    {item.ultimo_erro_msg && (
                      <div
                        className="text-xs mt-1 truncate"
                        style={{ color: "#DC2626" }}
                        title={item.ultimo_erro_msg}
                      >
                        {item.ultimo_erro_msg.substring(0, 100)}
                      </div>
                    )}
                  </div>
                  {isAtivo && (
                    <button
                      onClick={() => handleRevogarPluggy(item.id)}
                      className="text-xs underline hover:opacity-80"
                      style={{ color: "#DC2626" }}
                    >
                      Revogar
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {uploads.length > 0 && (
        <div
          className="rounded-lg border overflow-hidden"
          style={{
            borderColor: "rgba(61, 35, 20, 0.1)",
            backgroundColor: "#FAF7F2",
          }}
        >
          <div
            className="px-6 py-4 border-b flex items-center gap-2"
            style={{ borderColor: "rgba(61, 35, 20, 0.1)" }}
          >
            <FileText className="h-4 w-4" style={{ color: "#C8941A" }} />
            <h2 className="text-lg font-semibold" style={{ color: "#3D2314" }}>
              Uploads OFX recentes
            </h2>
          </div>
          <div>
            {uploads.map((u, idx) => (
              <div
                key={u.id}
                className="px-6 py-3 flex items-center justify-between gap-4"
                style={
                  idx > 0
                    ? { borderTop: "1px solid rgba(61, 35, 20, 0.05)" }
                    : undefined
                }
              >
                <div className="min-w-0 flex-1">
                  <div
                    className="font-medium text-sm truncate"
                    style={{ color: "#3D2314" }}
                  >
                    {u.filename}
                  </div>
                  <div
                    className="text-xs mt-0.5"
                    style={{ color: "rgba(61, 35, 20, 0.6)" }}
                  >
                    {u.corretora_detectada || "Corretora desconhecida"} •{" "}
                    {u.total_transactions ?? 0} transações •{" "}
                    {new Date(u.created_at).toLocaleDateString("pt-BR")}
                  </div>
                </div>
                <span
                  className="text-xs"
                  style={{ color: u.status === "sucesso" ? "#059669" : "#D97706" }}
                >
                  {u.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
