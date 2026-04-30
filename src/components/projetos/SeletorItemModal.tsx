// src/components/projetos/SeletorItemModal.tsx
// Modal com 3 abas (Material / Mão de Obra / Equipamento) para inserir item no BOM

"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, X, Package, HardHat, Wrench } from "lucide-react";
import { supabaseBrowser } from "@/lib/authFetch";

export type TipoItem = "insumo" | "mao_obra" | "equipamento";

export interface ItemEscolhido {
  tipo: TipoItem;
  item_id: string;
  nome: string;
  unidade: string | null;
  custo: number | null;
}

interface InsumoRow {
  id: string;
  name: string;
  unit: string | null;
  category: string | null;
  current_cost: number | null;
}

interface MoRow {
  id: string;
  funcao: string;
  custo_hora: number | null;
}

const ABAS: Array<{ tipo: TipoItem; label: string; icon: typeof Package }> = [
  { tipo: "insumo", label: "Material", icon: Package },
  { tipo: "mao_obra", label: "Mão de obra", icon: HardHat },
  { tipo: "equipamento", label: "Equipamento", icon: Wrench },
];

function fmtBRL(v: number | null) {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function SeletorItemModal({
  open,
  companyId,
  onClose,
  onSelect,
}: {
  open: boolean;
  companyId: string;
  onClose: () => void;
  onSelect: (item: ItemEscolhido) => void;
}) {
  const [aba, setAba] = useState<TipoItem>("insumo");
  const [busca, setBusca] = useState("");
  const [insumos, setInsumos] = useState<InsumoRow[]>([]);
  const [mos, setMos] = useState<MoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !companyId) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      setErro(null);
      try {
        const supabase = supabaseBrowser();
        const [insR, moR] = await Promise.all([
          supabase
            .from("m16_insumos")
            .select("id, name, unit, category, current_cost")
            .eq("company_id", companyId)
            .eq("ativo", true)
            .order("name")
            .limit(500),
          supabase
            .from("projetos_mao_obra")
            .select("id, funcao, custo_hora")
            .eq("company_id", companyId)
            .eq("ativo", true)
            .order("funcao")
            .limit(200),
        ]);
        if (cancel) return;
        if (insR.error) throw insR.error;
        if (moR.error) throw moR.error;
        setInsumos((insR.data as InsumoRow[]) || []);
        setMos((moR.data as MoRow[]) || []);
      } catch (e: any) {
        if (!cancel) setErro(e.message);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [open, companyId]);

  const itensFiltrados = useMemo(() => {
    const q = busca.toLowerCase().trim();
    if (aba === "mao_obra") {
      return mos
        .filter((m) => !q || m.funcao.toLowerCase().includes(q))
        .map((m) => ({
          tipo: "mao_obra" as TipoItem,
          item_id: m.id,
          nome: m.funcao,
          unidade: "h",
          custo: m.custo_hora,
        }));
    }
    // insumo ou equipamento (mesmo source m16_insumos, distingue por category)
    const isEquip = aba === "equipamento";
    return insumos
      .filter((i) => {
        const cat = (i.category || "").toUpperCase();
        const isEquipItem = cat === "EQUIP" || cat.includes("EQUIPAMENTO");
        if (isEquip && !isEquipItem) return false;
        if (!isEquip && isEquipItem) return false;
        if (q) {
          const hay = `${i.name} ${i.category || ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .map((i) => ({
        tipo: (isEquip ? "equipamento" : "insumo") as TipoItem,
        item_id: i.id,
        nome: i.name,
        unidade: i.unit,
        custo: i.current_cost,
      }));
  }, [aba, busca, insumos, mos]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#3D2314]/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#3D2314]/8 p-5">
          <div>
            <h2
              className="text-lg font-semibold text-[#3D2314]"
              style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
            >
              Adicionar item ao BOM
            </h2>
            <p className="mt-1 text-xs text-[#3D2314]/60">
              Selecione um material, mão de obra ou equipamento
            </p>
          </div>
          <button onClick={onClose} className="text-[#3D2314]/60 hover:text-[#3D2314]">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#3D2314]/8 bg-[#FAF7F2]">
          {ABAS.map((a) => {
            const Icon = a.icon;
            const ativa = aba === a.tipo;
            return (
              <button
                key={a.tipo}
                onClick={() => {
                  setAba(a.tipo);
                  setBusca("");
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
                  ativa
                    ? "border-[#C8941A] bg-white text-[#3D2314]"
                    : "border-transparent text-[#3D2314]/60 hover:bg-[#3D2314]/5 hover:text-[#3D2314]"
                }`}
              >
                <Icon size={16} />
                {a.label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="border-b border-[#3D2314]/8 p-4">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3D2314]/40" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome…"
              autoFocus
              className="w-full rounded-lg border border-[#3D2314]/12 bg-white py-2 pl-9 pr-3 text-sm focus:border-[#C8941A] focus:outline-none"
            />
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto p-2">
          {erro && (
            <div className="m-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>
          )}
          {loading ? (
            <div className="p-6 text-center text-sm text-[#3D2314]/60">Carregando…</div>
          ) : itensFiltrados.length === 0 ? (
            <div className="p-6 text-center text-sm text-[#3D2314]/60">
              {busca ? "Nenhum item encontrado" : "Catálogo vazio nessa aba"}
            </div>
          ) : (
            <ul className="divide-y divide-[#3D2314]/8">
              {itensFiltrados.map((it) => (
                <li key={it.item_id}>
                  <button
                    onClick={() => onSelect(it)}
                    className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-[#3D2314]/5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-[#3D2314]">{it.nome}</div>
                      <div className="text-xs text-[#3D2314]/60">
                        {it.unidade && <span>Unidade: {it.unidade}</span>}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm text-[#3D2314]">{fmtBRL(it.custo)}</div>
                      {aba === "mao_obra" && <div className="text-xs text-[#3D2314]/50">/ h</div>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#3D2314]/8 p-4 text-center text-xs text-[#3D2314]/50">
          {itensFiltrados.length} item{itensFiltrados.length !== 1 ? "s" : ""} disponíve
          {itensFiltrados.length !== 1 ? "is" : "l"}
        </div>
      </div>
    </div>
  );
}
