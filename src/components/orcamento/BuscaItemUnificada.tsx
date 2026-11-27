"use client";
// Orçamento (CEO 24/11) — busca UNIFICADA de item: um campo só que consulta ao mesmo tempo o
// Catálogo (projetos_servicos, CPU/BDI), os Serviços fiscais (erp_servicos) e os Produtos (erp_produtos).
// Cada resultado traz o selo do tipo; ao escolher, o pai cria a linha do tipo certo reusando
// selecionarServicoEng / selecionarServico / selecionarProduto. Vale para qualquer vertical do Hub.
// RD-95: "?" no campo. RD-96/100: desenho próprio, sem nome de terceiro. Mobile.

import { useEffect, useRef, useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import type { ServicoSelecionado } from "@/components/comum/ServicoAutocomplete";
import type { ServicoEngSelecionado } from "@/components/comum/ServicoEngenhariaAutocomplete";

export type ProdutoBusca = {
  id: string; codigo: string | null; nome: string; unidade: string | null;
  preco_venda: number | null; preco_custo: number | null;
};

export type ResultadoBusca =
  | { tipo: "catalogo"; eng: ServicoEngSelecionado; codigo: string | null; nome: string; preco: number }
  | { tipo: "servico"; servico: ServicoSelecionado; codigo: string | null; nome: string; preco: number }
  | { tipo: "produto"; produto: ProdutoBusca; codigo: string | null; nome: string; preco: number };

const SELO: Record<ResultadoBusca["tipo"], { label: string; cor: string; bg: string }> = {
  catalogo: { label: "Catálogo", cor: "#7C3AED", bg: "#7C3AED15" },
  servico: { label: "Serviço", cor: "#2563EB", bg: "#2563EB15" },
  produto: { label: "Produto", cor: "#059669", bg: "#05966915" },
};

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function BuscaItemUnificada({ companyId, produtos, onPick }: {
  companyId: string | null | undefined;
  produtos: ProdutoBusca[];
  onPick: (r: ResultadoBusca) => void;
}) {
  const [termo, setTermo] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resultados, setResultados] = useState<ResultadoBusca[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = termo.trim();
    let cancelado = false;
    const timer = setTimeout(async () => {
      if (!open || t.length < 1) { if (!cancelado) setResultados([]); return; }
      if (!cancelado) setBusy(true);
      // Produto: filtra o cache já carregado (sem nova query).
      const prodHits: ResultadoBusca[] = produtos
        .filter((p) => (p.nome || "").toLowerCase().includes(t.toLowerCase()) || (p.codigo || "").toLowerCase().includes(t.toLowerCase()))
        .slice(0, 6)
        .map((p) => ({ tipo: "produto", produto: p, codigo: p.codigo, nome: p.nome, preco: Number(p.preco_venda) || 0 }));

      let catHits: ResultadoBusca[] = [];
      let srvHits: ResultadoBusca[] = [];
      if (companyId) {
        const [cat, srv] = await Promise.all([
          supabase.from("projetos_servicos")
            .select("id,codigo,nome,unidade,custo_unitario_total")
            .eq("company_id", companyId).eq("ativo", true)
            .or(`nome.ilike.%${t}%,codigo.ilike.%${t}%`).order("codigo").limit(6),
          supabase.from("erp_servicos")
            .select("id,codigo,descricao_resumida,codigo_lc116,aliquota_iss,iss_retido,valor_unitario")
            .eq("company_id", companyId).eq("ativo", true)
            .or(`descricao_resumida.ilike.%${t}%,codigo.ilike.%${t}%`).order("descricao_resumida").limit(6),
        ]);
        catHits = ((cat.data ?? []) as Array<{ id: string; codigo: string | null; nome: string; unidade: string | null; custo_unitario_total: number | null }>)
          .map((r) => ({ tipo: "catalogo", eng: { id: r.id, codigo: r.codigo, nome: r.nome, unidade: r.unidade, custo_unitario_total: Number(r.custo_unitario_total) || 0 }, codigo: r.codigo, nome: r.nome, preco: Number(r.custo_unitario_total) || 0 }));
        srvHits = ((srv.data ?? []) as Array<{ id: string; codigo: string | null; descricao_resumida: string; codigo_lc116: string | null; aliquota_iss: number | null; iss_retido: boolean | null; valor_unitario: number | null }>)
          .map((r) => ({ tipo: "servico", servico: { id: r.id, codigo: r.codigo, descricao_resumida: r.descricao_resumida, codigo_lc116: r.codigo_lc116, aliquota_iss: r.aliquota_iss, iss_retido: r.iss_retido, valor_unitario: r.valor_unitario }, codigo: r.codigo, nome: r.descricao_resumida, preco: Number(r.valor_unitario) || 0 }));
      }
      if (cancelado) return;
      // Ordem: Catálogo (CPU/BDI) primeiro, depois Serviço fiscal, depois Produto.
      setResultados([...catHits, ...srvHits, ...prodHits]);
      setBusy(false);
    }, 250);
    return () => { cancelado = true; clearTimeout(timer); setBusy(false); };
  }, [termo, open, companyId, produtos]);

  useEffect(() => {
    function fora(e: MouseEvent) { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);

  function escolher(r: ResultadoBusca) {
    onPick(r);
    setTermo("");
    setResultados([]);
    setOpen(false);
  }

  return (
    <div ref={boxRef} style={{ position: "relative" }} data-ajuda="orcamentos.item.busca_unificada">
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "#3D2314", marginBottom: 4 }}>
        <Search size={13} /> Buscar item (catálogo, serviço ou produto)
        <AjudaCampo chave="orcamentos.item.busca_unificada" rota="/dashboard/orcamentos" />
      </label>
      <div style={{ position: "relative" }}>
        <input
          value={termo}
          onChange={(e) => { setTermo(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Digite o nome ou código — busca nas 3 fontes ao mesmo tempo"
          aria-label="Buscar item do orçamento"
          style={{ width: "100%", padding: "8px 30px 8px 10px", fontSize: 12, borderRadius: 8, border: "1px solid var(--ps-border,#E0D8CC)", background: "#fff", color: "#3D2314", boxSizing: "border-box" }}
        />
        {busy && <Loader2 size={14} className="animate-spin" style={{ position: "absolute", right: 9, top: 9, color: "#C8941A" }} />}
      </div>
      {open && termo.trim().length >= 1 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid var(--ps-border,#E0D8CC)", borderRadius: 8, marginTop: 3, zIndex: 30, maxHeight: 280, overflowY: "auto", boxShadow: "0 8px 24px rgba(61,35,20,0.12)" }}>
          {resultados.length === 0 && !busy && (
            <div style={{ padding: "12px 14px", fontSize: 12, color: "#6B5D4F" }}>
              Nada encontrado para “{termo}”. Para um custo avulso, use <b>+ Despesa/Omisso</b>.
            </div>
          )}
          {resultados.map((r, i) => {
            const selo = SELO[r.tipo];
            return (
              <div key={r.tipo + ":" + (r.tipo === "produto" ? r.produto.id : r.tipo === "catalogo" ? r.eng.id : r.servico.id) + ":" + i}
                onClick={() => escolher(r)}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid var(--ps-border,#E0D8CC)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#F0ECE3")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ display: "inline-block", fontSize: 9, fontWeight: 700, color: selo.cor, background: selo.bg, borderRadius: 4, padding: "1px 6px", marginRight: 6 }}>{selo.label}</span>
                  {r.codigo && <span style={{ fontFamily: "monospace", fontSize: 10, color: selo.cor }}>{r.codigo} </span>}
                  <span style={{ fontSize: 12, color: "#3D2314" }}>{r.nome}</span>
                </div>
                <span style={{ fontSize: 11, fontFamily: "monospace", color: "#6B5D4F", whiteSpace: "nowrap" }}>
                  {r.tipo === "catalogo" ? `custo ${brl(r.preco)}` : brl(r.preco)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
