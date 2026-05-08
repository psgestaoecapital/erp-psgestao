"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { ChevronLeft, RefreshCw, Plus, FileUp, AlertCircle } from "lucide-react";
import { ClienteKPIs } from "./cliente-kpis";
import { ClientePositionsTable } from "./cliente-positions-table";
import { ClienteConexoesSection } from "./cliente-conexoes-section";
import { TermoConsentModal } from "./termo-consent-modal";
import { PluggyWidgetWrapper } from "./pluggy-widget-wrapper";

interface ClienteDetalheViewProps {
  clienteId: string;
}

interface ClienteData {
  id: string;
  nome: string;
  tipo: "PF" | "PJ";
  perfil_risco: string;
  status: string;
  cpf_cnpj: string;
  email: string | null;
  consultor_responsavel: string | null;
  created_at: string;
}

type FluxoConectar = "idle" | "termo" | "widget";

interface PluggyItemData {
  item: {
    id: string;
    connector: { id: number; name: string; type?: string };
  };
}

export function ClienteDetalheView({ clienteId }: ClienteDetalheViewProps) {
  const [cliente, setCliente] = useState<ClienteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [fluxoConectar, setFluxoConectar] = useState<FluxoConectar>("idle");
  const [consentId, setConsentId] = useState<string | null>(null);
  const [connectToken, setConnectToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);

  const refreshAll = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        setLoading(true);
        const { data, error: err } = await supabase
          .from("wealth_clients")
          .select(
            "id, nome, tipo, perfil_risco, status, cpf_cnpj, email, consultor_responsavel, created_at"
          )
          .eq("id", clienteId)
          .single();

        if (err) throw err;
        if (mounted) setCliente(data as ClienteData);
      } catch (e) {
        if (mounted) setError((e as Error).message);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [clienteId]);

  const handleConectarClick = () => {
    setFluxoConectar("termo");
  };

  const handleTermoAceito = async (newConsentId: string) => {
    setConsentId(newConsentId);
    setTokenLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sessão expirada");

      const resp = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/pluggy-connect-token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            client_id: clienteId,
            consent_id: newConsentId,
          }),
        }
      );

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${resp.status}`);
      }

      const { connect_token } = await resp.json();
      setConnectToken(connect_token);
      setFluxoConectar("widget");
    } catch (e) {
      alert(`Erro ao iniciar conexão: ${(e as Error).message}`);
      setFluxoConectar("idle");
    } finally {
      setTokenLoading(false);
    }
  };

  const handleTermoCancelado = () => {
    setFluxoConectar("idle");
    setConsentId(null);
  };

  const handlePluggySuccess = async (itemData: PluggyItemData) => {
    if (!consentId) {
      alert("Consent ID ausente - reinicie o fluxo.");
      setFluxoConectar("idle");
      return;
    }
    try {
      // sp_pluggy_register_item retorna o UUID do row local (wealth_pluggy_items.id)
      const { data: localItemId, error: rpcErr } = await supabase.rpc(
        "sp_pluggy_register_item",
        {
          p_client_id: clienteId,
          p_consent_id: consentId,
          p_pluggy_item_id: itemData.item.id,
          p_connector_id: itemData.item.connector.id,
          p_connector_name: itemData.item.connector.name,
          p_connector_type: itemData.item.connector.type || null,
        }
      );

      if (rpcErr) throw rpcErr;

      // dispatch_sync usa o UUID local
      if (localItemId) {
        await supabase.rpc("sp_pluggy_dispatch_sync", {
          p_item_id: localItemId,
          p_origem: "item_created",
        });
      }

      setFluxoConectar("idle");
      setConsentId(null);
      setConnectToken(null);
      refreshAll();
    } catch (e) {
      alert(
        `Conta conectada no Pluggy mas falha ao registrar localmente: ${
          (e as Error).message
        }`
      );
    }
  };

  const handlePluggyError = (err: unknown) => {
    console.error("Pluggy widget error:", err);
    setFluxoConectar("idle");
  };

  const handleClosePluggy = () => {
    setFluxoConectar("idle");
    setConsentId(null);
    setConnectToken(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div
          className="animate-spin h-8 w-8 border-4 rounded-full"
          style={{ borderColor: "#C8941A", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  if (error || !cliente) {
    return (
      <div
        className="rounded-lg border p-6"
        style={{ borderColor: "#FECACA", backgroundColor: "#FEF2F2" }}
      >
        <div className="flex items-start gap-3">
          <AlertCircle
            className="h-5 w-5 flex-shrink-0 mt-0.5"
            style={{ color: "#DC2626" }}
          />
          <div>
            <p className="font-medium" style={{ color: "#7F1D1D" }}>
              Cliente não encontrado ou sem permissão
            </p>
            <p className="text-sm mt-1" style={{ color: "#B91C1C" }}>
              {error || "O cliente solicitado não está disponível"}
            </p>
            <Link
              href="/dashboard/wealth"
              className="inline-flex items-center gap-1 mt-3 text-sm underline"
              style={{ color: "#B91C1C" }}
            >
              <ChevronLeft className="h-4 w-4" />
              Voltar para a lista
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/wealth"
        className="inline-flex items-center gap-1 text-sm hover:underline"
        style={{ color: "rgba(61, 35, 20, 0.7)" }}
      >
        <ChevronLeft className="h-4 w-4" />
        Carteira de Clientes
      </Link>

      <div
        className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 pb-4 border-b"
        style={{ borderColor: "rgba(61, 35, 20, 0.1)" }}
      >
        <div>
          <h1
            className="text-2xl md:text-3xl"
            style={{ color: "#3D2314", fontFamily: "serif" }}
          >
            {cliente.nome}
          </h1>
          <div
            className="flex flex-wrap items-center gap-2 mt-2 text-sm"
            style={{ color: "rgba(61, 35, 20, 0.7)" }}
          >
            <span
              className="px-2 py-0.5 rounded border text-xs"
              style={{
                borderColor: "rgba(61, 35, 20, 0.2)",
                backgroundColor: "#FAF7F2",
              }}
            >
              {cliente.tipo}
            </span>
            <span>•</span>
            <span>Perfil: {cliente.perfil_risco}</span>
            {cliente.cpf_cnpj?.startsWith("PENDENTE_") && (
              <>
                <span>•</span>
                <span style={{ color: "#D97706" }}>CPF pendente</span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={refreshAll}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md border hover:opacity-80"
            style={{
              borderColor: "rgba(61, 35, 20, 0.2)",
              color: "#3D2314",
            }}
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
          <button
            onClick={handleConectarClick}
            disabled={tokenLoading}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: "#3D2314", color: "#FAF7F2" }}
          >
            <Plus className="h-4 w-4" />
            Conectar conta
          </button>
          <button
            disabled
            title="ETAPA A3 - em breve"
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md border cursor-not-allowed"
            style={{
              borderColor: "rgba(61, 35, 20, 0.2)",
              color: "rgba(61, 35, 20, 0.4)",
            }}
          >
            <FileUp className="h-4 w-4" />
            Upload OFX
          </button>
        </div>
      </div>

      <ClienteKPIs clienteId={clienteId} key={`kpi-${refreshKey}`} />

      <ClientePositionsTable clienteId={clienteId} key={`pos-${refreshKey}`} />

      <ClienteConexoesSection
        clienteId={clienteId}
        key={`con-${refreshKey}`}
        onChange={refreshAll}
      />

      {fluxoConectar === "termo" && (
        <TermoConsentModal
          clienteId={clienteId}
          onAceitar={handleTermoAceito}
          onCancelar={handleTermoCancelado}
        />
      )}

      {tokenLoading && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 shadow-xl">
            <div
              className="animate-spin h-8 w-8 border-4 rounded-full mx-auto"
              style={{ borderColor: "#C8941A", borderTopColor: "transparent" }}
            />
            <p className="mt-3 text-sm" style={{ color: "#3D2314" }}>
              Preparando conexão segura...
            </p>
          </div>
        </div>
      )}

      {fluxoConectar === "widget" && connectToken && (
        <PluggyWidgetWrapper
          connectToken={connectToken}
          onSuccess={handlePluggySuccess}
          onError={handlePluggyError}
          onClose={handleClosePluggy}
        />
      )}
    </div>
  );
}
