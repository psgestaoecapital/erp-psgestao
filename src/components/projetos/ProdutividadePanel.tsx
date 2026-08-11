"use client";

// Aba "Produtos & Produtividade" das Configurações do módulo Projetos (Hub de Projetos · V2).
// Gestão completa de produtos por linha de negócio: criar / editar inline (nome, linha, produtividade,
// equipe) / excluir (soft-delete · RD-55). MO (R$/m²) read-only (Σ horas × custo/hora do BOM), edita-se
// no Catálogo. RPCs: fn_produtividade_por_linha_obter · fn_servico_criar/atualizar/excluir.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Gauge, Loader2, CheckCircle2, AlertTriangle, Plus, Trash2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/authFetch";

type Linha = { id: string; nome: string };
type Produto = {
  servico_id: string; nome: string; unidade: string | null; categoria: string | null;
  business_line_id: string | null; linha_nome: string | null;
  produtividade_dia: number | null; equipe: string | null; mo_custo_m2: number | null;
};
type RowEdit = { nome?: string; business_line_id?: string; produtividade?: string; equipe?: string };

const brl = (v: number | null) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const inp = "rounded-lg border border-[#3D2314]/12 bg-white px-2 py-1 text-sm text-[#3D2314] focus:border-[#C8941A] focus:outline-none";

export default function ProdutividadePanel({ companyId }: { companyId: string }) {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [fCategoria, setFCategoria] = useState<string>("");
  const [fLinha, setFLinha] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [rowEdits, setRowEdits] = useState<Record<string, RowEdit>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // novo produto
  const [novoAberto, setNovoAberto] = useState(false);
  const [novo, setNovo] = useState<{ nome: string; unidade: string; categoria: string; business_line_id: string; produtividade: string; equipe: string }>(
    { nome: "", unidade: "m2", categoria: "", business_line_id: "", produtividade: "", equipe: "" });
  const [criando, setCriando] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.rpc("fn_produtividade_por_linha_obter", { p_company_id: companyId, p_categoria: null });
    setLoading(false);
    if (error) { setErro(error.message); return; }
    const j = data as { ok?: boolean; erro?: string; produtos?: Produto[]; linhas?: Linha[] } | null;
    if (!j?.ok) { setErro(j?.erro ?? "Falha ao carregar produtos"); return; }
    setProdutos(j.produtos ?? []); setLinhas(j.linhas ?? []); setRowEdits({});
  }, [companyId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }, [toast]);

  const categorias = useMemo(
    () => Array.from(new Set(produtos.map((p) => p.categoria).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [produtos]
  );
  const filtrados = useMemo(
    () => produtos.filter((p) => (!fCategoria || p.categoria === fCategoria) && (!fLinha || p.business_line_id === fLinha)),
    [produtos, fCategoria, fLinha]
  );

  const val = (p: Produto, k: keyof RowEdit): string => {
    const e = rowEdits[p.servico_id]?.[k];
    if (e != null) return e;
    if (k === "nome") return p.nome ?? "";
    if (k === "business_line_id") return p.business_line_id ?? "";
    if (k === "produtividade") return p.produtividade_dia != null ? String(p.produtividade_dia) : "";
    return p.equipe ?? "";
  };
  const setEdit = (id: string, k: keyof RowEdit, v: string) => setRowEdits((p) => ({ ...p, [id]: { ...p[id], [k]: v } }));
  const dirty = (id: string) => rowEdits[id] && Object.keys(rowEdits[id]).length > 0;

  async function salvarLinha(p: Produto) {
    const e = rowEdits[p.servico_id]; if (!e) return;
    const campos: Record<string, string> = {};
    if (e.nome != null) campos.nome = e.nome.trim();
    if (e.business_line_id != null) campos.business_line_id = e.business_line_id;
    if (e.produtividade != null) campos.produtividade = e.produtividade.replace(",", ".");
    if (e.equipe != null) campos.equipe = e.equipe;
    setBusyId(p.servico_id); setErro(null);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.rpc("fn_servico_atualizar", { p_servico_id: p.servico_id, p_company_id: companyId, p_campos: campos });
    setBusyId(null);
    if (error) { setErro(error.message); return; }
    if (!(data as { ok?: boolean } | null)?.ok) { setErro("Não foi possível alterar."); return; }
    setToast("Produto ALTERADO"); await carregar();
  }

  async function excluir(p: Produto) {
    if (!confirm(`Excluir o produto "${p.nome}"?\nEle sai da lista, mas continua no histórico (não é apagado de verdade).`)) return;
    setBusyId(p.servico_id); setErro(null);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.rpc("fn_servico_excluir", { p_servico_id: p.servico_id, p_company_id: companyId });
    setBusyId(null);
    if (error) { setErro(error.message); return; }
    if (!(data as { ok?: boolean } | null)?.ok) { setErro("Não foi possível excluir."); return; }
    setToast("Produto EXCLUÍDO"); await carregar();
  }

  async function criar() {
    if (!novo.nome.trim()) { setErro("Informe o nome do produto."); return; }
    setCriando(true); setErro(null);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.rpc("fn_servico_criar", {
      p_company_id: companyId, p_nome: novo.nome.trim(), p_unidade: novo.unidade || "m2",
      p_categoria: novo.categoria || null, p_business_line_id: novo.business_line_id || null,
      p_produtividade: novo.produtividade ? Number(novo.produtividade.replace(",", ".")) : null,
      p_equipe: novo.equipe || null,
    });
    setCriando(false);
    if (error) { setErro(error.message); return; }
    if (!(data as { ok?: boolean } | null)?.ok) { setErro("Não foi possível criar."); return; }
    setToast("Produto CRIADO");
    setNovo({ nome: "", unidade: "m2", categoria: "", business_line_id: "", produtividade: "", equipe: "" });
    setNovoAberto(false); await carregar();
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-[#3D2314]/8 bg-white p-10 text-center shadow-sm">
        <Loader2 className="mx-auto animate-spin text-[#C8941A]" size={24} />
        <p className="mt-3 text-sm text-[#3D2314]/60">Carregando produtos…</p>
      </div>
    );
  }
  if (erro && produtos.length === 0) {
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
          <h2 className="text-base font-medium text-[#3D2314]" style={{ fontFamily: "var(--ps-font-body)" }}>Produtos &amp; Produtividade</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {toast && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 size={12} /> {toast}
            </span>
          )}
          <select value={fLinha} onChange={(e) => setFLinha(e.target.value)} className={inp}>
            <option value="">Todas as linhas</option>
            {linhas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
          <select value={fCategoria} onChange={(e) => setFCategoria(e.target.value)} className={inp}>
            <option value="">Todas as categorias</option>
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={() => setNovoAberto((v) => !v)} className="inline-flex items-center gap-1 rounded-lg bg-[#3D2314] px-3 py-1.5 text-sm font-medium text-[#FAF7F2]">
            <Plus size={14} /> Novo produto
          </button>
        </div>
      </div>

      {erro && produtos.length > 0 && <div className="mb-3 rounded-lg bg-red-50 p-2 text-xs text-red-800">{erro}</div>}

      {novoAberto && (
        <div className="mb-4 grid grid-cols-1 gap-2 rounded-xl border border-[#C8941A]/30 bg-[#FBF4E4] p-3 sm:grid-cols-3 lg:grid-cols-7">
          <input placeholder="Nome *" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} className={`${inp} lg:col-span-2`} />
          <input placeholder="Unidade" value={novo.unidade} onChange={(e) => setNovo({ ...novo, unidade: e.target.value })} className={inp} />
          <input placeholder="Categoria" value={novo.categoria} onChange={(e) => setNovo({ ...novo, categoria: e.target.value })} className={inp} />
          <select value={novo.business_line_id} onChange={(e) => setNovo({ ...novo, business_line_id: e.target.value })} className={inp}>
            <option value="">Linha…</option>
            {linhas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
          <input placeholder="Produt./dia" inputMode="decimal" value={novo.produtividade} onChange={(e) => setNovo({ ...novo, produtividade: e.target.value.replace(/[^\d.,]/g, "") })} className={inp} />
          <div className="flex gap-2">
            <input placeholder="Equipe" value={novo.equipe} onChange={(e) => setNovo({ ...novo, equipe: e.target.value })} className={`${inp} flex-1`} />
            <button onClick={() => void criar()} disabled={criando} className="rounded-lg bg-[#C8941A] px-3 py-1 text-sm font-semibold text-[#3D2314] disabled:opacity-50">{criando ? "…" : "Criar"}</button>
          </div>
        </div>
      )}

      {filtrados.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#3D2314]/20 bg-[#FAF7F2] p-8 text-center text-sm text-[#3D2314]/60">
          {produtos.length === 0 ? "Nenhum produto — cadastre o primeiro." : "Nenhum produto nesta linha/categoria."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#3D2314]/10 text-left text-[11px] uppercase tracking-wider text-[#3D2314]/50">
                <th className="py-2 pr-3">Produto</th>
                <th className="py-2 px-3">Linha de negócio</th>
                <th className="py-2 px-3">Produtividade</th>
                <th className="py-2 px-3">Equipe</th>
                <th className="py-2 px-3 text-right">MO (R$/m²)</th>
                <th className="py-2 pl-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((p) => (
                <tr key={p.servico_id} className="border-b border-[#3D2314]/6 align-top">
                  <td className="py-2 pr-3">
                    <input value={val(p, "nome")} onChange={(e) => setEdit(p.servico_id, "nome", e.target.value)} className={`${inp} w-full min-w-[180px]`} />
                    {p.categoria && <div className="mt-0.5 text-[10px] text-[#3D2314]/45">{p.categoria}</div>}
                  </td>
                  <td className="py-2 px-3">
                    <select value={val(p, "business_line_id")} onChange={(e) => setEdit(p.servico_id, "business_line_id", e.target.value)} className={`${inp} min-w-[140px]`}>
                      <option value="">— sem linha —</option>
                      {linhas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
                    </select>
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-1">
                      <input inputMode="decimal" value={val(p, "produtividade")} onChange={(e) => setEdit(p.servico_id, "produtividade", e.target.value.replace(/[^\d.,]/g, ""))} className={`${inp} w-20 text-right`} />
                      <span className="text-[10px] text-[#3D2314]/45">{p.unidade || "m²"}/dia</span>
                    </div>
                  </td>
                  <td className="py-2 px-3">
                    <input value={val(p, "equipe")} onChange={(e) => setEdit(p.servico_id, "equipe", e.target.value)} className={`${inp} w-32`} />
                  </td>
                  <td className="py-2 px-3 text-right">
                    <div className="font-mono text-[#3D2314]">{brl(p.mo_custo_m2)}</div>
                    <Link href={`/dashboard/projetos/catalogo/${p.servico_id}`} className="text-[11px] font-medium text-[#C8941A] hover:underline">Detalhar MO →</Link>
                  </td>
                  <td className="py-2 pl-3">
                    <div className="flex items-center justify-end gap-2">
                      {dirty(p.servico_id) && (
                        <button onClick={() => void salvarLinha(p)} disabled={busyId === p.servico_id} className="rounded-md bg-[#C8941A] px-2 py-1 text-[11px] font-semibold text-[#3D2314] disabled:opacity-50">
                          {busyId === p.servico_id ? "…" : "Salvar"}
                        </button>
                      )}
                      <button onClick={() => void excluir(p)} disabled={busyId === p.servico_id} title="Excluir (soft-delete)" className="rounded-md border border-red-200 p-1 text-red-600 hover:bg-red-50 disabled:opacity-50">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-[#3D2314]/50">
            MO (R$/m²) = Σ (horas × custo/hora) do BOM de mão de obra. Edite função/horas/valor em <b>Detalhar MO</b> (Catálogo). Excluir é reversível (soft-delete).
          </p>
        </div>
      )}
    </section>
  );
}
