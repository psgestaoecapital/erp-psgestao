"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { WealthKPICard } from "./wealth-kpi-card";
import { WealthClienteCard } from "./wealth-cliente-card";
import { Users, TrendingUp, Wallet, Loader2 } from "lucide-react";

interface ClienteData {
  id: string;
  nome: string;
  tipo: "PF" | "PJ";
  perfil_risco: string;
  status: string;
  patrimonio: number | null;
  num_positions: number;
  num_conexoes_ativas: number;
  ultimo_sync: string | null;
}

export function WealthConsultorView() {
  const [clientes, setClientes] = useState<ClienteData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const { data: clientesData, error: clientesErr } = await supabase
          .from("wealth_clients")
          .select("id, nome, tipo, perfil_risco, status")
          .order("created_at", { ascending: false });

        if (clientesErr) throw clientesErr;
        if (!clientesData) {
          setClientes([]);
          setLoading(false);
          return;
        }

        const enriched: ClienteData[] = await Promise.all(
          clientesData.map(async (c) => {
            const [{ data: positions }, { data: items }] = await Promise.all([
              supabase
                .from("wealth_positions")
                .select("valor_atual")
                .eq("client_id", c.id),
              supabase
                .from("wealth_pluggy_items")
                .select("ultimo_sync_em")
                .eq("client_id", c.id)
                .not("status", "in", "(REVOKED,DELETED)")
                .order("ultimo_sync_em", { ascending: false }),
            ]);

            const patrimonio =
              positions && positions.length > 0
                ? positions.reduce(
                    (sum, p) => sum + Number(p.valor_atual ?? 0),
                    0
                  )
                : null;

            return {
              ...c,
              tipo: c.tipo as "PF" | "PJ",
              patrimonio,
              num_positions: positions?.length ?? 0,
              num_conexoes_ativas: items?.length ?? 0,
              ultimo_sync: items?.[0]?.ultimo_sync_em ?? null,
            };
          })
        );

        setClientes(enriched);
      } catch (e) {
        console.error("loadData error:", e);
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#C8941A" }} />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-lg border p-6"
        style={{ borderColor: "#FECACA", backgroundColor: "#FEF2F2", color: "#991B1B" }}
      >
        Erro ao carregar carteira: {error}
      </div>
    );
  }

  const totalAUM = clientes.reduce((sum, c) => sum + (c.patrimonio ?? 0), 0);
  const totalConexoes = clientes.reduce(
    (sum, c) => sum + c.num_conexoes_ativas,
    0
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <WealthKPICard
          label="AUM Total"
          value={`R$ ${totalAUM.toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`}
          hint="Patrimônio sob aconselhamento"
          icon={Wallet}
        />
        <WealthKPICard
          label="Clientes Ativos"
          value={clientes.length.toString()}
          hint={
            clientes.length === 0
              ? "Nenhum cliente"
              : `${clientes.filter((c) => c.status === "ativo").length} ativos`
          }
          icon={Users}
        />
        <WealthKPICard
          label="Conexões Open Finance"
          value={totalConexoes.toString()}
          hint={`${clientes.filter((c) => c.num_conexoes_ativas > 0).length} clientes conectados`}
          icon={TrendingUp}
        />
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4" style={{ color: "#3D2314" }}>
          Carteira de Clientes
        </h2>
        {clientes.length === 0 ? (
          <div
            className="rounded-lg border-2 border-dashed p-12 text-center"
            style={{
              borderColor: "rgba(61, 35, 20, 0.2)",
              backgroundColor: "#FAF7F2",
            }}
          >
            <Users
              className="h-12 w-12 mx-auto mb-3"
              style={{ color: "rgba(61, 35, 20, 0.3)" }}
            />
            <p style={{ color: "rgba(61, 35, 20, 0.7)" }}>
              Você ainda não tem clientes Wealth cadastrados.
            </p>
            <p className="text-sm mt-1" style={{ color: "rgba(61, 35, 20, 0.5)" }}>
              Cadastros via formulário próprio em breve.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {clientes.map((c) => (
              <WealthClienteCard
                key={c.id}
                id={c.id}
                nome={c.nome}
                tipo={c.tipo}
                perfilRisco={c.perfil_risco}
                status={c.status}
                patrimonio={c.patrimonio}
                numPositions={c.num_positions}
                numConexoesAtivas={c.num_conexoes_ativas}
                ultimoSync={c.ultimo_sync}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
