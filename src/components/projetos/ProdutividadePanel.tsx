"use client";

// Aba "Produtividade" das Configurações do módulo Projetos (Hub de Projetos · S2.1).
// Grade por linha/categoria: cada produto tem SEU tempo (produtividade m²/dia, editável) e SUA MO/m²
// (Σ horas × custo/hora do BOM tipo='mao_obra' — read-only aqui; edita-se no Catálogo). RPCs:
// fn_produtividade_por_linha_obter / fn_servico_produtividade_salvar.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Gauge, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabaseBrowser } from "@/lib/authFetch";

type Produto = {
  servico_id: string; nome: string; unidade: string | null; categoria: string | null;
  produtividade_dia: number | null; equipe: string | null; mo_custo_m2: number | null;
};

const brl = (v: number | null) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

export default function ProdutividadePanel({ companyId }: { companyId: string }) {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [categoria, setCategoria] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.rpc("fn_produtividade_por_linha_obter", { p_company_id: companyId, p_categoria: null });
    setLoading(false);
    if (error) { setErro(error.message); return; }
    const j = data as { ok?: boolean; erro?: string; produtos?: Produto[] } | null;
    if (!j?.ok) { setErro(j?.erro ?? "Falha ao carregar produtos"); return; }
    setProdutos(j.produtos ?? []);
    setEdits({});
  }, [companyId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }, [toast]);

  const categorias = useMemo(
    () => Array.from(new Set(produtos.map((p) => p.categoria).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [produtos]
  );
  const filtrados = useMemo(
    () => (categoria ? produtos.filter((p) => p.categoria === categoria) : produtos),
    [produtos, categoria]
  );

  async function salvarProdutividade(p: Produto) {
    const raw = edits[p.servico_id];
    if (raw == null) return; // não editado
    const val = parseFloat(raw.replace(",", "."));
    if (!Number.isFinite(val) || val <= 0) { setErro("Produtividade deve ser um número maior que zero."); return; }
    setSavingId(p.servico_id); setErro(null);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.rpc("fn_servico_produtividade_salvar", {
      p_servico_id: p.servico_id, p_company_id: companyId, p_produtividade_dia: val,
    });
    setSavingId(null);
    if (error) { setErro(error.message); return; }
    if (!(data as { ok?: boolean } | null)?.ok) { setErro("Não foi possível salvar."); return; }
    setProdutos((prev) => prev.map((x) => (x.servico_id === p.servico_id ? { ...x, produtividade_dia: val } : x)));
    setEdits((prev) => { const n = { ...prev }; delete n[p.servico_id]; return n; });
    setToast("Produtividade ALTERADA");
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-[#3D2314]/8 bg-white p-10 text-center shadow-sm">
        <Loader2 className="mx-auto animate-spin text-[#C8941A]" size={24} />
        <p className="mt-3 text-sm text-[#3D2314]/60">Carregando produtos…</p>
      </div>
    );
  }
  if (erro) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 shadow-sm">
        <AlertTriangle className="mb-1 inline" size={16} /> {erro}
        <button onClick={() => void carregar()} className="ml-3 rounded border border-red-300 px-2 py-0.5 text-xs">tentar de novo</button>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-[#3D2314]/8 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gauge size={16} className="text-[#C8941A]" />
          <h2 className="text-base font-medium text-[#3D2314]" style={{ fontFamily: "var(--ps-font-body)" }}>
            Produtividade por produto
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {toast && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 size={12} /> {toast}
            </span>
          )}
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className="rounded-lg border border-[#3D2314]/12 bg-white px-3 py-1.5 text-sm text-[#3D2314] focus:border-[#C8941A] focus:outline-none"
          >
            <option value="">Todas as categorias</option>
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {filtrados.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#3D2314]/20 bg-[#FAF7F2] p-8 text-center text-sm text-[#3D2314]/60">
          Nenhum produto nesta linha.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#3D2314]/10 text-left text-[11px] uppercase tracking-wider text-[#3D2314]/50">
                <th className="py-2 pr-3">Produto</th>
                <th className="py-2 px-3">Produtividade (por dia)</th>
                <th className="py-2 px-3">Equipe</th>
                <th className="py-2 px-3 text-right">MO (R$/m²)</th>
                <th className="py-2 pl-3 text-right">MO detalhe</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((p) => {
                const editado = edits[p.servico_id] != null;
                const valor = editado ? edits[p.servico_id] : (p.produtividade_dia != null ? String(p.produtividade_dia) : "");
                return (
                  <tr key={p.servico_id} className="border-b border-[#3D2314]/6">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-[#3D2314]">{p.nome}</div>
                      {p.categoria && <div className="text-[11px] text-[#3D2314]/50">{p.categoria}</div>}
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <input
                          inputMode="decimal"
                          value={valor}
                          onChange={(e) => setEdits((prev) => ({ ...prev, [p.servico_id]: e.target.value.replace(/[^\d.,]/g, "") }))}
                          onKeyDown={(e) => { if (e.key === "Enter") void salvarProdutividade(p); }}
                          className="w-24 rounded-lg border border-[#3D2314]/12 bg-white px-2 py-1 text-right font-mono text-sm text-[#3D2314] focus:border-[#C8941A] focus:outline-none"
                        />
                        <span className="text-[11px] text-[#3D2314]/45">{p.unidade || "m²"}/dia</span>
                        {editado && (
                          <button
                            onClick={() => void salvarProdutividade(p)}
                            disabled={savingId === p.servico_id}
                            className="rounded-md bg-[#C8941A] px-2 py-1 text-[11px] font-semibold text-[#3D2314] disabled:opacity-50"
                          >
                            {savingId === p.servico_id ? "…" : "Salvar"}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-[#3D2314]/70">{p.equipe || "—"}</td>
                    <td className="py-2 px-3 text-right font-mono text-[#3D2314]">{brl(p.mo_custo_m2)}</td>
                    <td className="py-2 pl-3 text-right">
                      <Link href={`/dashboard/projetos/catalogo/${p.servico_id}`} className="text-xs font-medium text-[#C8941A] hover:underline">
                        Detalhar MO →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-[#3D2314]/50">
            MO (R$/m²) = Σ (horas × custo/hora) do BOM de mão de obra do produto. Edite as funções/horas e o valor por função em <b>Detalhar MO</b> (Catálogo).
          </p>
        </div>
      )}
    </section>
  );
}
