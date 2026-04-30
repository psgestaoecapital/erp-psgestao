// src/components/projetos/BomEditor.tsx
// Editor visual de BOM (Bill of Materials) com cálculo em tempo real
// Insert/update/delete em projetos_servicos_bom + refetch via fn_projetos_servico_completo

"use client";

import { useState } from "react";
import { Plus, Trash2, Package, HardHat, Wrench, Loader2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/authFetch";
import { SeletorItemModal, type ItemEscolhido, type TipoItem } from "./SeletorItemModal";

export interface BomLinha {
  id: string;
  servico_id: string;
  tipo: TipoItem | string;
  insumo_id?: string | null;
  mao_obra_id?: string | null;
  item_nome?: string | null;
  quantidade: number | null;
  unidade: string | null;
  perda_pct: number | null;
  custo_unitario: number | null;
  custo_total: number | null;
  ordem: number | null;
}

interface Props {
  servicoId: string;
  companyId: string;
  bom: BomLinha[];
  onChange: () => void | Promise<void>;
}

function tipoIcone(tipo: string | TipoItem) {
  if (tipo === "mao_obra") return HardHat;
  if (tipo === "equipamento") return Wrench;
  return Package;
}

function tipoLabel(tipo: string | TipoItem) {
  if (tipo === "mao_obra") return "Mão de obra";
  if (tipo === "equipamento") return "Equipamento";
  return "Material";
}

function tipoCorChip(tipo: string | TipoItem) {
  if (tipo === "mao_obra") return "bg-blue-50 text-blue-800";
  if (tipo === "equipamento") return "bg-purple-50 text-purple-800";
  return "bg-emerald-50 text-emerald-800";
}

function fmtBRL(v: number | null) {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseNumero(s: string): number | null {
  if (!s.trim()) return null;
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function BomEditor({ servicoId, companyId, bom, onChange }: Props) {
  const [seletorOpen, setSeletorOpen] = useState(false);
  const [salvandoLinha, setSalvandoLinha] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Edição local de quantidade/perda. Confirmamos no blur.
  const [edits, setEdits] = useState<Record<string, { qtd?: string; perda?: string }>>({});

  function setEdit(linhaId: string, key: "qtd" | "perda", valor: string) {
    setEdits((prev) => ({ ...prev, [linhaId]: { ...prev[linhaId], [key]: valor } }));
  }

  async function commitEdit(linha: BomLinha, key: "qtd" | "perda") {
    const draft = edits[linha.id]?.[key];
    if (draft === undefined) return;
    const novo = parseNumero(draft);
    const atual = key === "qtd" ? linha.quantidade : linha.perda_pct;
    if (novo === null || novo === atual) {
      // Limpa edit local se valor inválido ou igual
      setEdits((prev) => {
        const next = { ...prev };
        if (next[linha.id]) {
          delete next[linha.id][key];
          if (Object.keys(next[linha.id]).length === 0) delete next[linha.id];
        }
        return next;
      });
      return;
    }
    setSalvandoLinha(linha.id);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      const update: Record<string, number> = {};
      if (key === "qtd") update.quantidade = novo;
      else update.perda_pct = novo;
      const { error } = await supabase
        .from("projetos_servicos_bom")
        .update(update)
        .eq("id", linha.id);
      if (error) throw error;
      // Aciona recálculo do cache de custos
      await supabase.rpc("fn_projetos_atualizar_cache_bom", { p_servico_id: servicoId });
      // Limpa edit local
      setEdits((prev) => {
        const next = { ...prev };
        delete next[linha.id];
        return next;
      });
      await onChange();
    } catch (e: any) {
      setErro(e.message || "Falha ao salvar");
    } finally {
      setSalvandoLinha(null);
    }
  }

  async function adicionarItem(item: ItemEscolhido) {
    setSeletorOpen(false);
    setSalvandoLinha("nova");
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      const proximaOrdem = bom.reduce((max, l) => Math.max(max, l.ordem || 0), 0) + 1;
      const payload: any = {
        servico_id: servicoId,
        tipo: item.tipo,
        quantidade: 1.0,
        unidade: item.unidade,
        perda_pct: item.tipo === "insumo" || item.tipo === "equipamento" ? 5 : 0,
        ordem: proximaOrdem,
      };
      if (item.tipo === "mao_obra") payload.mao_obra_id = item.item_id;
      else payload.insumo_id = item.item_id; // insumo ou equipamento partilham m16_insumos
      const { error } = await supabase.from("projetos_servicos_bom").insert(payload);
      if (error) throw error;
      await supabase.rpc("fn_projetos_atualizar_cache_bom", { p_servico_id: servicoId });
      await onChange();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setSalvandoLinha(null);
    }
  }

  async function removerLinha(linha: BomLinha) {
    if (!confirm(`Remover "${linha.item_nome || "este item"}" do BOM?`)) return;
    setSalvandoLinha(linha.id);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      const { error } = await supabase
        .from("projetos_servicos_bom")
        .delete()
        .eq("id", linha.id);
      if (error) throw error;
      await supabase.rpc("fn_projetos_atualizar_cache_bom", { p_servico_id: servicoId });
      await onChange();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setSalvandoLinha(null);
    }
  }

  const sortedBom = [...bom].sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

  return (
    <div>
      {erro && (
        <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[#3D2314]/8 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-[#3D2314]/5 text-xs uppercase tracking-wider text-[#3D2314]/60">
            <tr>
              <th className="px-3 py-2 text-left">Tipo</th>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-right">Qtd</th>
              <th className="px-3 py-2 text-left">Un</th>
              <th className="px-3 py-2 text-right">Perda %</th>
              <th className="px-3 py-2 text-right">Custo unit.</th>
              <th className="px-3 py-2 text-right">Custo total</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#3D2314]/8">
            {sortedBom.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[#3D2314]/50">
                  Nenhum item no BOM ainda. Use o botão abaixo para adicionar.
                </td>
              </tr>
            )}
            {sortedBom.map((linha) => {
              const Icon = tipoIcone(linha.tipo);
              const editQtd = edits[linha.id]?.qtd;
              const editPerda = edits[linha.id]?.perda;
              const salvando = salvandoLinha === linha.id;
              return (
                <tr key={linha.id} className={salvando ? "opacity-50" : ""}>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tipoCorChip(
                        linha.tipo
                      )}`}
                    >
                      <Icon size={11} />
                      {tipoLabel(linha.tipo)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[#3D2314]">
                    {linha.item_nome || "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editQtd !== undefined ? editQtd : (linha.quantidade ?? "").toString()}
                      onChange={(e) => setEdit(linha.id, "qtd", e.target.value)}
                      onBlur={() => commitEdit(linha, "qtd")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      disabled={salvando}
                      className="w-20 rounded border border-[#3D2314]/12 bg-white px-2 py-1 text-right font-mono text-sm focus:border-[#C8941A] focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2 text-[#3D2314]/70">{linha.unidade || "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editPerda !== undefined ? editPerda : (linha.perda_pct ?? "").toString()}
                      onChange={(e) => setEdit(linha.id, "perda", e.target.value)}
                      onBlur={() => commitEdit(linha, "perda")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      disabled={salvando}
                      className="w-16 rounded border border-[#3D2314]/12 bg-white px-2 py-1 text-right font-mono text-sm focus:border-[#C8941A] focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[#3D2314]/70">
                    {fmtBRL(linha.custo_unitario)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-medium text-[#3D2314]">
                    {fmtBRL(linha.custo_total)}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => removerLinha(linha)}
                      disabled={salvando}
                      title="Remover item"
                      className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-30"
                    >
                      {salvando ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          onClick={() => setSeletorOpen(true)}
          disabled={salvandoLinha === "nova"}
          className="inline-flex items-center gap-2 rounded-lg bg-[#3D2314] px-4 py-2 text-sm font-medium text-[#FAF7F2] hover:bg-[#3D2314]/90 disabled:opacity-50"
        >
          {salvandoLinha === "nova" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Plus size={14} />
          )}
          Adicionar item
        </button>
        <p className="text-xs text-[#3D2314]/50">
          {sortedBom.length} ite{sortedBom.length !== 1 ? "ns" : "m"} no BOM
        </p>
      </div>

      <SeletorItemModal
        open={seletorOpen}
        companyId={companyId}
        onClose={() => setSeletorOpen(false)}
        onSelect={adicionarItem}
      />
    </div>
  );
}
