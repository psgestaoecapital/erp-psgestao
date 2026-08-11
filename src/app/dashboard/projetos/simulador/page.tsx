"use client";

// Hub de Projetos · Sprint S4 — Simulador de Obra (a estrela).
// Escolha a montagem → digite a metragem → quantitativo de materiais + orçamento das 5 camadas.
// Reusa fn_simular_montagem (que reusa fn_precificar_montagem + BOM). Tudo por empresa/linha.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, Loader2, AlertTriangle } from "lucide-react";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { supabaseBrowser } from "@/lib/authFetch";

type Linha = { id: string; nome: string };
type Produto = { servico_id: string; nome: string; unidade: string | null; categoria: string | null; business_line_id: string | null };
type QuantItem = { insumo: string; unidade: string | null; qtd_m2: number; qtd_total: number; custo_total: number };
type PrecoM2 = {
  venda_material?: number; venda_mo?: number; subtotal_m2?: number; comissao?: number;
  custo_fixo_m2?: number; custo_fixo_origem?: string; total_m2?: number; margem_rs?: number; margem_pct?: number;
};
type Sim = { ok: boolean; erro?: string; montagem?: string; unidade?: string; area?: number; preco_m2?: PrecoM2; total_obra?: number; quantitativo?: QuantItem[] };

const brl = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const num = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: d }));

export default function SimuladorPage() {
  const { sel } = useCompanyIds();
  const companyId = sel && !sel.startsWith("group_") && sel !== "consolidado" ? sel : null;

  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [fLinha, setFLinha] = useState("");
  const [montagemId, setMontagemId] = useState("");
  const [area, setArea] = useState("100");
  const [sim, setSim] = useState<Sim | null>(null);
  const [loadingCat, setLoadingCat] = useState(true);
  const [calculando, setCalculando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // catálogo de montagens (produtos + linhas)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!companyId) { setLoadingCat(false); return; }
    let alive = true;
    (async () => {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.rpc("fn_produtividade_por_linha_obter", { p_company_id: companyId, p_categoria: null });
      if (!alive) return;
      setLoadingCat(false);
      if (error) { setErro(error.message); return; }
      const j = data as { ok?: boolean; produtos?: Produto[]; linhas?: Linha[] } | null;
      if (!j?.ok) { setErro("Falha ao carregar montagens"); return; }
      setProdutos(j.produtos ?? []); setLinhas(j.linhas ?? []);
    })();
    return () => { alive = false; };
  }, [companyId]);

  const montagens = useMemo(
    () => produtos.filter((p) => !fLinha || p.business_line_id === fLinha),
    [produtos, fLinha]
  );
  const montagemSel = useMemo(() => produtos.find((p) => p.servico_id === montagemId) ?? null, [produtos, montagemId]);

  const simular = useCallback(async () => {
    if (!companyId || !montagemId) { setSim(null); return; }
    const areaNum = Number((area || "0").replace(",", ".")) || 0;
    setCalculando(true); setErro(null);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.rpc("fn_simular_montagem", {
      p_servico_id: montagemId, p_company_id: companyId,
      p_business_line_id: montagemSel?.business_line_id ?? null, p_area: areaNum,
    });
    setCalculando(false);
    if (error) { setErro(error.message); setSim(null); return; }
    const j = data as Sim;
    if (!j?.ok) { setErro(j?.erro ?? "Falha ao simular"); setSim(null); return; }
    setSim(j);
  }, [companyId, montagemId, area, montagemSel]);

  // recalcula ao trocar montagem/metragem
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void simular(); }, [simular]);

  if (!companyId) {
    return <main className="mx-auto max-w-3xl px-6 py-20 text-center text-[#3D2314]/60">Selecione uma empresa específica para usar o Simulador.</main>;
  }

  const preco = sim?.preco_m2;

  return (
    <main className="mx-auto max-w-5xl px-6 py-6">
      <header className="mb-6 flex items-start gap-3">
        <div className="rounded-2xl bg-[#3D2314]/8 p-2.5"><Calculator size={20} className="text-[#C8941A]" /></div>
        <div>
          <h1 className="text-2xl font-medium text-[#3D2314]" style={{ fontFamily: "var(--ps-font-body)" }}>Simulador de Obra</h1>
          <p className="mt-0.5 text-sm text-[#3D2314]/60">Escolha a montagem, informe a metragem e veja o quantitativo + orçamento das 5 camadas.</p>
        </div>
      </header>

      {/* Entrada */}
      <section className="mb-6 grid grid-cols-1 gap-3 rounded-2xl border border-[#3D2314]/8 bg-white p-5 shadow-sm sm:grid-cols-4">
        <label className="block sm:col-span-1">
          <span className="mb-1 block text-[11px] uppercase tracking-wider text-[#3D2314]/55">Linha de negócio</span>
          <select value={fLinha} onChange={(e) => { setFLinha(e.target.value); setMontagemId(""); }} className={selCls}>
            <option value="">Todas</option>
            {linhas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[11px] uppercase tracking-wider text-[#3D2314]/55">Montagem</span>
          <select value={montagemId} onChange={(e) => setMontagemId(e.target.value)} className={selCls} disabled={loadingCat}>
            <option value="">{loadingCat ? "Carregando…" : "Escolha a montagem…"}</option>
            {montagens.map((m) => <option key={m.servico_id} value={m.servico_id}>{m.nome}{m.categoria ? ` · ${m.categoria}` : ""}</option>)}
          </select>
        </label>
        <label className="block sm:col-span-1">
          <span className="mb-1 block text-[11px] uppercase tracking-wider text-[#3D2314]/55">Metragem ({montagemSel?.unidade || "m²"})</span>
          <input inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="100" className={`${selCls} text-right font-mono`} />
        </label>
      </section>

      {erro && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mb-0.5 mr-1 inline" size={15} />{erro}</div>}

      {!montagemId ? (
        <div className="rounded-2xl border border-dashed border-[#3D2314]/20 bg-[#FAF7F2] p-12 text-center text-sm text-[#3D2314]/60">
          Escolha uma montagem e informe a metragem.
        </div>
      ) : calculando && !sim ? (
        <div className="rounded-2xl border border-[#3D2314]/8 bg-white p-12 text-center shadow-sm">
          <Loader2 className="mx-auto animate-spin text-[#C8941A]" size={24} />
        </div>
      ) : sim ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
          {/* Quantitativo */}
          <section className="rounded-2xl border border-[#3D2314]/8 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-base font-medium text-[#3D2314]" style={{ fontFamily: "var(--ps-font-body)" }}>
              Quantitativo de materiais <span className="text-sm text-[#3D2314]/50">· {sim.montagem} · {num(sim.area)} {sim.unidade || "m²"}</span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#3D2314]/10 text-left text-[11px] uppercase tracking-wider text-[#3D2314]/50">
                    <th className="py-2 pr-3">Insumo</th>
                    <th className="py-2 px-3 text-right">Qtd/m²</th>
                    <th className="py-2 px-3 text-right">Qtd total</th>
                    <th className="py-2 pl-3 text-right">Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {(sim.quantitativo ?? []).map((q, i) => (
                    <tr key={i} className="border-b border-[#3D2314]/6">
                      <td className="py-2 pr-3 text-[#3D2314]">{q.insumo}</td>
                      <td className="py-2 px-3 text-right font-mono text-[#3D2314]/70">{num(q.qtd_m2, 3)}</td>
                      <td className="py-2 px-3 text-right font-mono font-semibold text-[#3D2314]">{num(q.qtd_total, 2)} <span className="text-[10px] font-normal text-[#3D2314]/45">{q.unidade || ""}</span></td>
                      <td className="py-2 pl-3 text-right font-mono text-[#3D2314]">{brl(q.custo_total)}</td>
                    </tr>
                  ))}
                  {(sim.quantitativo ?? []).length === 0 && (
                    <tr><td colSpan={4} className="py-4 text-center text-sm text-[#3D2314]/50">Sem materiais no BOM desta montagem.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Orçamento (5 camadas) + total */}
          <section className="space-y-4">
            <div className="rounded-2xl border border-[#3D2314]/8 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-base font-medium text-[#3D2314]" style={{ fontFamily: "var(--ps-font-body)" }}>Orçamento por {sim.unidade || "m²"}</h2>
              <dl className="space-y-1.5 text-sm">
                <Row l="Material" v={brl(preco?.venda_material)} />
                <Row l="Mão de obra" v={brl(preco?.venda_mo)} />
                <Row l="Subtotal" v={brl(preco?.subtotal_m2)} strong />
                <Row l="Comissão" v={brl(preco?.comissao)} />
                <Row l={`Custo fixo${preco?.custo_fixo_origem ? ` (${preco.custo_fixo_origem})` : ""}`} v={brl(preco?.custo_fixo_m2)} />
                <div className="my-1 border-t border-[#3D2314]/10" />
                <Row l={`Total / ${sim.unidade || "m²"}`} v={brl(preco?.total_m2)} strong big />
                <Row l="Margem" v={`${brl(preco?.margem_rs)} · ${num(preco?.margem_pct)}%`} />
              </dl>
            </div>
            <div className="rounded-2xl border border-[#C8941A]/40 bg-[#FBF4E4] p-5 text-center shadow-sm">
              <div className="text-[11px] uppercase tracking-wider text-[#3D2314]/55">Total da obra ({num(sim.area)} {sim.unidade || "m²"})</div>
              <div className="mt-1 font-mono text-3xl font-bold text-[#3D2314]">{brl(sim.total_obra)}</div>
            </div>
            <div className="flex gap-2">
              <button disabled title="Em breve (S4.1)" className="flex-1 cursor-not-allowed rounded-lg border border-[#3D2314]/15 bg-white px-3 py-2 text-sm font-medium text-[#3D2314]/40">Gerar orçamento · Em breve</button>
              <button disabled title="Em breve (S4.1)" className="flex-1 cursor-not-allowed rounded-lg border border-[#3D2314]/15 bg-white px-3 py-2 text-sm font-medium text-[#3D2314]/40">+ Adicionar montagem · Em breve</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function Row({ l, v, strong, big }: { l: string; v: string; strong?: boolean; big?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={`${strong ? "font-medium text-[#3D2314]" : "text-[#3D2314]/60"}`}>{l}</dt>
      <dd className={`font-mono ${big ? "text-lg font-bold text-[#3D2314]" : strong ? "font-semibold text-[#3D2314]" : "text-[#3D2314]"}`}>{v}</dd>
    </div>
  );
}

const selCls = "w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm text-[#3D2314] focus:border-[#C8941A] focus:outline-none";
