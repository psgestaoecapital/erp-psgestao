"use client";
// HB2 Fatia 1 — Itens do orçamento (Hub de Projetos): incluir, editar e excluir sobre erp_orcamentos_itens.
// Toda regra (guarda de empresa, escopo congelado, recálculo do total) vive nas RPCs fn_orcamento_item_*.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";
import AjudaCampo from "@/components/ajuda/AjudaCampo";

const ROTA = "/dashboard/hub/orcamento-itens";
type Orc = { id: string; numero: string; cliente_nome: string | null; status: string };
type Item = { id: string; ordem: number; produto_nome: string; unidade: string; quantidade: number; preco_unitario: number;
  desconto_percentual: number; desconto_valor: number; subtotal: number; tipo_item: string; observacoes: string | null };
type Lista = { ok: boolean; erro?: string; itens: Item[]; subtotal: number; total: number; status: string; congelado: boolean; editavel: boolean };
type Form = { id?: string; produto_nome: string; tipo_item: string; unidade: string; quantidade: string; preco_unitario: string;
  desconto_percentual: string; desconto_valor: string; observacoes: string };
const VAZIO: Form = { produto_nome: "", tipo_item: "servico", unidade: "UN", quantidade: "1", preco_unitario: "0", desconto_percentual: "0", desconto_valor: "0", observacoes: "" };
const brl = (n: number | null | undefined) => (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const lbl = "flex flex-col gap-1 text-[13px] text-[#2A1A10]";
const inp = "rounded-lg border border-[#E8E2D6] bg-white px-3 py-2 text-[15px] text-[#2A1A10]";

export default function OrcamentoItensPage() {
  const { sel } = useCompanyIds();
  const empresa = sel && !sel.startsWith("group_") && sel !== "consolidado" ? sel : null;
  const [orcs, setOrcs] = useState<Orc[]>([]);
  const [orcId, setOrcId] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [orcsCarregados, setOrcsCarregados] = useState(false);

  useEffect(() => {
    if (!empresa) return;
    setOrcsCarregados(false);
    void Promise.resolve(supabase.from("erp_orcamentos").select("id,numero,cliente_nome,status").eq("company_id", empresa)
      .order("created_at", { ascending: false }).limit(100)).then(({ data, error }) => {
      if (error) setMsg({ tipo: "erro", texto: error.message });
      const l = (data as Orc[]) ?? [];
      setOrcs(l);
      setOrcId((atual) => (atual && l.some((o) => o.id === atual) ? atual : l[0]?.id ?? ""));
      setOrcsCarregados(true);
    });
  }, [empresa]);

  const carregar = useCallback(async (id: string) => {
    if (!id) { setLista(null); return; }
    const { data, error } = await supabase.rpc("fn_orcamento_item_listar", { p_orcamento_id: id });
    if (error) { setMsg({ tipo: "erro", texto: error.message }); return; }
    const l = data as Lista;
    if (!l.ok) { setMsg({ tipo: "erro", texto: l.erro ?? "Erro ao listar" }); setLista(null); return; }
    setLista(l);
  }, []);
  useEffect(() => { void carregar(orcId); }, [orcId, carregar]);

  async function salvar() {
    if (!form || !orcId) return;
    const corpo = { produto_nome: form.produto_nome, tipo_item: form.tipo_item, unidade: form.unidade, quantidade: form.quantidade,
      preco_unitario: form.preco_unitario, desconto_percentual: form.desconto_percentual, desconto_valor: form.desconto_valor, observacoes: form.observacoes };
    const { data, error } = form.id
      ? await supabase.rpc("fn_orcamento_item_editar", { p_item_id: form.id, p_item: corpo })
      : await supabase.rpc("fn_orcamento_item_adicionar", { p_orcamento_id: orcId, p_item: corpo });
    const r = data as { ok: boolean; erro?: string } | null;
    if (error || !r?.ok) { setMsg({ tipo: "erro", texto: error?.message ?? r?.erro ?? "Não foi possível salvar" }); return; }
    setMsg({ tipo: "ok", texto: form.id ? "Item atualizado." : "Item incluído." });
    setForm(null); await carregar(orcId);
  }
  async function excluir(it: Item) {
    if (!window.confirm(`Excluir o item "${it.produto_nome}"?`)) return;
    const { data, error } = await supabase.rpc("fn_orcamento_item_excluir", { p_item_id: it.id });
    const r = data as { ok: boolean; erro?: string } | null;
    if (error || !r?.ok) { setMsg({ tipo: "erro", texto: error?.message ?? r?.erro ?? "Não foi possível excluir" }); return; }
    setMsg({ tipo: "ok", texto: "Item excluído." }); await carregar(orcId);
  }
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => (f ? { ...f, [k]: e.target.value } : f));

  return (
    <main className="mx-auto max-w-4xl p-4 md:p-8" data-testid="hub-orcamento-itens">
      <h1 className="text-2xl font-semibold text-[#C8941A]">Itens do orçamento</h1>
      {!empresa && <p className="mt-3 text-[14px] text-[#7A6A5E]" data-testid="orc-sem-empresa">Escolha uma empresa no seletor do topo para ver os itens dos orçamentos.</p>}
      {empresa && orcsCarregados && orcs.length === 0 && <p className="mt-3 text-[14px] text-[#7A6A5E]" data-testid="orc-vazio">Esta empresa ainda não tem orçamentos. Crie um orçamento para lançar os itens.</p>}
      {empresa && !orcsCarregados && <p className="mt-3 text-[14px] text-[#7A6A5E]" role="status">Carregando orçamentos…</p>}
      <label className={`${lbl} mt-4`}>
        <span className="flex items-center gap-1">Orçamento <AjudaCampo chave="hub.orcamento_itens.orcamento" rota={ROTA} /></span>
        <select className={inp} value={orcId} onChange={(e) => { setOrcId(e.target.value); setMsg(null); setForm(null); }} data-testid="orc-select">
          <option value="">Escolha um orçamento…</option>
          {orcs.map((o) => <option key={o.id} value={o.id}>{o.numero} · {o.cliente_nome ?? "sem cliente"} · {o.status}</option>)}
        </select>
      </label>
      {msg && <p role="status" data-testid="orc-msg" className={`mt-3 rounded-lg border px-3 py-2 text-[14px] ${msg.tipo === "ok" ? "border-[#1baf7a] text-[#1baf7a]" : "border-[#c0392b] text-[#c0392b]"}`}>{msg.texto}</p>}
      {lista && (
        <section className="mt-5">
          {lista.congelado && <p className="mb-3 rounded-lg bg-[#FAF7F2] px-3 py-2 text-[14px] text-[#7A6A5E]" data-testid="orc-congelado">Escopo congelado: os itens não podem mais ser alterados. Mudanças entram como mudança de escopo.</p>}
          <div className="flex items-center justify-between">
            <div className="text-[14px] text-[#7A6A5E]">Total do orçamento <AjudaCampo chave="hub.orcamento_itens.total" rota={ROTA} />
              <div className="text-xl font-semibold text-[#2A1A10]" data-testid="orc-total">{brl(lista.total)}</div></div>
            <button type="button" disabled={!lista.editavel} onClick={() => { setMsg(null); setForm({ ...VAZIO }); }} data-testid="item-novo"
              className="rounded-lg bg-[#3D2314] px-4 py-2 text-[15px] text-white disabled:opacity-40">Incluir item <AjudaCampo chave="hub.orcamento_itens.incluir" rota={ROTA} /></button>
          </div>
          <ul className="mt-3 divide-y divide-[#E8E2D6] rounded-xl border border-[#E8E2D6] bg-white">
            {lista.itens.length === 0 && <li className="p-4 text-[14px] text-[#7A6A5E]">Nenhum item ainda. Toque em “Incluir item”.</li>}
            {lista.itens.map((it) => (
              <li key={it.id} className="flex flex-wrap items-center justify-between gap-2 p-3" data-testid="item-linha">
                <div><div className="text-[15px] text-[#2A1A10]">{it.produto_nome}</div>
                  <div className="text-[13px] text-[#7A6A5E]">{it.quantidade} {it.unidade} × {brl(it.preco_unitario)} = {brl(it.subtotal)}</div></div>
                <div className="flex gap-2">
                  <button type="button" disabled={!lista.editavel} data-testid="item-editar" className="rounded-lg border border-[#E8E2D6] px-3 py-1 text-[14px] disabled:opacity-40"
                    onClick={() => setForm({ id: it.id, produto_nome: it.produto_nome, tipo_item: it.tipo_item, unidade: it.unidade, quantidade: String(it.quantidade),
                      preco_unitario: String(it.preco_unitario), desconto_percentual: String(it.desconto_percentual ?? 0), desconto_valor: String(it.desconto_valor ?? 0), observacoes: it.observacoes ?? "" })}>Editar</button>
                  <button type="button" disabled={!lista.editavel} data-testid="item-excluir" className="rounded-lg border border-[#E8E2D6] px-3 py-1 text-[14px] text-[#c0392b] disabled:opacity-40" onClick={() => void excluir(it)}>Excluir</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {form && (
        <section className="mt-5 grid gap-3 rounded-xl border border-[#E8E2D6] bg-white p-4 md:grid-cols-2" data-testid="item-form">
          <label className={`${lbl} md:col-span-2`}><span className="flex items-center gap-1">Descrição <AjudaCampo chave="hub.orcamento_itens.descricao" rota={ROTA} /></span>
            <input className={inp} value={form.produto_nome} onChange={set("produto_nome")} data-testid="f-descricao" /></label>
          <label className={lbl}><span className="flex items-center gap-1">Tipo <AjudaCampo chave="hub.orcamento_itens.tipo" rota={ROTA} /></span>
            <select className={inp} value={form.tipo_item} onChange={set("tipo_item")}><option value="servico">Serviço</option><option value="produto">Material / produto</option></select></label>
          <label className={lbl}><span className="flex items-center gap-1">Unidade <AjudaCampo chave="hub.orcamento_itens.unidade" rota={ROTA} /></span>
            <input className={inp} value={form.unidade} onChange={set("unidade")} /></label>
          <label className={lbl}><span className="flex items-center gap-1">Quantidade <AjudaCampo chave="hub.orcamento_itens.quantidade" rota={ROTA} /></span>
            <input className={inp} inputMode="decimal" value={form.quantidade} onChange={set("quantidade")} data-testid="f-qtd" /></label>
          <label className={lbl}><span className="flex items-center gap-1">Preço unitário <AjudaCampo chave="hub.orcamento_itens.preco" rota={ROTA} /></span>
            <input className={inp} inputMode="decimal" value={form.preco_unitario} onChange={set("preco_unitario")} data-testid="f-preco" /></label>
          <label className={lbl}><span className="flex items-center gap-1">Desconto (%) <AjudaCampo chave="hub.orcamento_itens.desconto_pct" rota={ROTA} /></span>
            <input className={inp} inputMode="decimal" value={form.desconto_percentual} onChange={set("desconto_percentual")} /></label>
          <label className={lbl}><span className="flex items-center gap-1">Desconto (R$) <AjudaCampo chave="hub.orcamento_itens.desconto_valor" rota={ROTA} /></span>
            <input className={inp} inputMode="decimal" value={form.desconto_valor} onChange={set("desconto_valor")} /></label>
          <label className={`${lbl} md:col-span-2`}><span className="flex items-center gap-1">Observações <AjudaCampo chave="hub.orcamento_itens.observacoes" rota={ROTA} /></span>
            <textarea className={inp} rows={2} value={form.observacoes} onChange={set("observacoes")} /></label>
          <div className="flex gap-2 md:col-span-2">
            <button type="button" onClick={() => void salvar()} data-testid="item-salvar" className="rounded-lg bg-[#3D2314] px-4 py-2 text-[15px] text-white">Salvar item <AjudaCampo chave="hub.orcamento_itens.salvar" rota={ROTA} /></button>
            <button type="button" onClick={() => setForm(null)} className="rounded-lg border border-[#E8E2D6] px-4 py-2 text-[15px]">Cancelar</button>
          </div>
        </section>
      )}
    </main>
  );
}
