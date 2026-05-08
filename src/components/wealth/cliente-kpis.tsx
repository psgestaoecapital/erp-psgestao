"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Wallet, TrendingUp, Activity, type LucideIcon } from "lucide-react";

interface KPIs {
  patrimonio: number;
  num_positions: number;
  num_conexoes_ativas: number;
  ultimo_sync: string | null;
}

export function ClienteKPIs({ clienteId }: { clienteId: string }) {
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [posR, itemsR] = await Promise.all([
          supabase
            .from("wealth_positions")
            .select("valor_atual")
            .eq("client_id", clienteId),
          supabase
            .from("wealth_pluggy_items")
            .select("ultimo_sync_em")
            .eq("client_id", clienteId)
            .not("status", "in", "(REVOKED,DELETED)")
            .order("ultimo_sync_em", { ascending: false }),
        ]);

        const positions = posR.data || [];
        const items = itemsR.data || [];

        if (mounted) {
          setKpis({
            patrimonio: positions.reduce(
              (s, p) => s + Number(p.valor_atual ?? 0),
              0
            ),
            num_positions: positions.length,
            num_conexoes_ativas: items.length,
            ultimo_sync: items[0]?.ultimo_sync_em ?? null,
          });
        }
      } catch (e) {
        console.error("ClienteKPIs error:", e);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [clienteId]);

  if (loading || !kpis) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-lg border p-6 h-28 animate-pulse"
            style={{
              borderColor: "rgba(61, 35, 20, 0.1)",
              backgroundColor: "#FAF7F2",
            }}
          />
        ))}
      </div>
    );
  }

  const fmtBRL = (v: number) =>
    `R$ ${v.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const syncHint = kpis.ultimo_sync
    ? `Última sync: ${new Date(kpis.ultimo_sync).toLocaleDateString("pt-BR")}`
    : "Nenhuma sync ainda";

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card
        label="Patrimônio Total"
        value={fmtBRL(kpis.patrimonio)}
        hint="Posições consolidadas"
        icon={Wallet}
      />
      <Card
        label="Posições Ativas"
        value={kpis.num_positions.toString()}
        hint="Ativos em carteira"
        icon={TrendingUp}
      />
      <Card
        label="Conexões Open Finance"
        value={kpis.num_conexoes_ativas.toString()}
        hint={syncHint}
        icon={Activity}
      />
    </div>
  );
}

function Card({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
}) {
  return (
    <div
      className="rounded-lg border p-6"
      style={{ borderColor: "rgba(61, 35, 20, 0.1)", backgroundColor: "#FAF7F2" }}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium" style={{ color: "rgba(61, 35, 20, 0.7)" }}>
            {label}
          </p>
          <p className="text-2xl font-bold" style={{ color: "#3D2314" }}>
            {value}
          </p>
          <p className="text-xs" style={{ color: "rgba(61, 35, 20, 0.5)" }}>
            {hint}
          </p>
        </div>
        <div
          className="rounded-lg p-2"
          style={{ backgroundColor: "rgba(200, 148, 26, 0.1)" }}
        >
          <Icon className="h-5 w-5" style={{ color: "#C8941A" }} />
        </div>
      </div>
    </div>
  );
}
