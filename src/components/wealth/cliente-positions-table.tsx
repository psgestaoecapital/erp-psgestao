"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface AssetJoin {
  ticker: string | null;
  nome: string | null;
  classe: string | null;
}

interface PositionRow {
  id: string;
  asset_id: string;
  quantidade: number | string | null;
  preco_medio: number | string | null;
  valor_atual: number | string | null;
  moeda_compra: string | null;
  instituicao: string | null;
  asset: AssetJoin | AssetJoin[] | null;
}

interface Position {
  id: string;
  asset_id: string;
  ticker: string | null;
  asset_nome: string | null;
  classe: string | null;
  quantidade: number;
  preco_medio: number | null;
  valor_atual: number | null;
  moeda_compra: string | null;
  instituicao: string | null;
}

const classeLabels: Record<string, string> = {
  renda_fixa_pos: "Renda Fixa Pós",
  renda_fixa_pre: "Renda Fixa Pré",
  renda_variavel: "Renda Variável",
  fundos: "Fundos",
  etf: "ETF",
  fii: "FII",
  cripto: "Cripto",
  outros: "Outros",
};

export function ClientePositionsTable({ clienteId }: { clienteId: string }) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data, error } = await supabase
        .from("wealth_positions")
        .select(
          `id, asset_id, quantidade, preco_medio, valor_atual, moeda_compra, instituicao,
           asset:wealth_assets ( ticker, nome, classe )`
        )
        .eq("client_id", clienteId)
        .order("valor_atual", { ascending: false, nullsFirst: false });

      if (error) {
        console.error("positions error:", error);
        if (mounted) setLoading(false);
        return;
      }

      const enriched: Position[] = ((data as PositionRow[]) || []).map((p) => {
        const asset = Array.isArray(p.asset) ? p.asset[0] : p.asset;
        return {
          id: p.id,
          asset_id: p.asset_id,
          ticker: asset?.ticker ?? null,
          asset_nome: asset?.nome ?? null,
          classe: asset?.classe ?? null,
          quantidade: Number(p.quantidade ?? 0),
          preco_medio: p.preco_medio !== null ? Number(p.preco_medio) : null,
          valor_atual: p.valor_atual !== null ? Number(p.valor_atual) : null,
          moeda_compra: p.moeda_compra,
          instituicao: p.instituicao,
        };
      });

      if (mounted) {
        setPositions(enriched);
        setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [clienteId]);

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
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-12 rounded animate-pulse"
              style={{ backgroundColor: "rgba(61, 35, 20, 0.05)" }}
            />
          ))}
        </div>
      </div>
    );
  }

  const total = positions.reduce((s, p) => s + (p.valor_atual ?? 0), 0);

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: "rgba(61, 35, 20, 0.1)", backgroundColor: "#FAF7F2" }}
    >
      <div
        className="px-6 py-4 border-b"
        style={{ borderColor: "rgba(61, 35, 20, 0.1)" }}
      >
        <h2 className="text-lg font-semibold" style={{ color: "#3D2314" }}>
          Posições
        </h2>
        <p className="text-sm mt-0.5" style={{ color: "rgba(61, 35, 20, 0.6)" }}>
          {positions.length} ativos · R${" "}
          {total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
        </p>
      </div>

      {positions.length === 0 ? (
        <div className="p-12 text-center">
          <p className="text-sm" style={{ color: "rgba(61, 35, 20, 0.6)" }}>
            Nenhuma posição registrada ainda.
          </p>
          <p className="text-xs mt-1" style={{ color: "rgba(61, 35, 20, 0.4)" }}>
            Conecte uma conta ou faça upload de OFX para popular.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ backgroundColor: "rgba(61, 35, 20, 0.05)" }}>
              <tr>
                <Th>Ativo</Th>
                <Th>Classe</Th>
                <Th align="right">Quantidade</Th>
                <Th align="right">PM</Th>
                <Th align="right">Valor Atual</Th>
                <Th align="right">%</Th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const pct =
                  total > 0 && p.valor_atual
                    ? ((p.valor_atual / total) * 100).toFixed(1)
                    : "—";
                return (
                  <tr
                    key={p.id}
                    style={{ borderTop: "1px solid rgba(61, 35, 20, 0.05)" }}
                  >
                    <td className="px-6 py-3">
                      <div className="font-medium" style={{ color: "#3D2314" }}>
                        {p.ticker || p.asset_nome || "Sem ticker"}
                      </div>
                      {p.instituicao && (
                        <div
                          className="text-xs"
                          style={{ color: "rgba(61, 35, 20, 0.5)" }}
                        >
                          {p.instituicao}
                        </div>
                      )}
                    </td>
                    <td
                      className="px-6 py-3"
                      style={{ color: "rgba(61, 35, 20, 0.7)" }}
                    >
                      {p.classe ? classeLabels[p.classe] || p.classe : "—"}
                    </td>
                    <td
                      className="px-6 py-3 text-right"
                      style={{ color: "#3D2314" }}
                    >
                      {p.quantidade.toLocaleString("pt-BR", {
                        maximumFractionDigits: 4,
                      })}
                    </td>
                    <td
                      className="px-6 py-3 text-right"
                      style={{ color: "rgba(61, 35, 20, 0.7)" }}
                    >
                      {p.preco_medio !== null
                        ? `R$ ${p.preco_medio.toLocaleString("pt-BR", {
                            minimumFractionDigits: 2,
                          })}`
                        : "—"}
                    </td>
                    <td
                      className="px-6 py-3 text-right font-medium"
                      style={{ color: "#3D2314" }}
                    >
                      {p.valor_atual !== null
                        ? `R$ ${p.valor_atual.toLocaleString("pt-BR", {
                            minimumFractionDigits: 2,
                          })}`
                        : "—"}
                    </td>
                    <td
                      className="px-6 py-3 text-right"
                      style={{ color: "rgba(61, 35, 20, 0.7)" }}
                    >
                      {pct}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-6 py-3 font-medium ${align === "right" ? "text-right" : "text-left"}`}
      style={{ color: "rgba(61, 35, 20, 0.7)" }}
    >
      {children}
    </th>
  );
}
