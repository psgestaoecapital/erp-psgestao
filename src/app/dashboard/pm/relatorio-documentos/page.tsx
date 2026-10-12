"use client";
// P&M · Relatório de Documentos (fee e orçamento; a PI entra com o PM-L). Só leitura (RLS por empresa); nada é lançado.
// Colunas configuráveis (máx. 11), lembradas por pessoa neste navegador. Excel (CSV) e PDF (imprimir).

import { useEffect, useMemo, useState } from "react";
import { FileDown, FileSpreadsheet, Settings2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import EmpresaNaoResolvida from "@/components/pm/EmpresaNaoResolvida";
import { COLUNAS, MAX_COLUNAS, colunasValidas, deContrato, dePropostas, filtrarDocs, linhasCsv, totais, type Documento, type FiltroDoc } from "@/lib/pm/relatorioDocumentos";

const CHAVE = "pm-relatorio-documentos-colunas";
const brl = (n: number | null) => (n === null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const campo = "rounded-lg border border-[#E7DED3] bg-white px-2 py-2 text-[13px] text-[#3D2314] min-h-[40px]";

export default function RelatorioDocumentosPage() {
  const { companyIds, loading: carregandoEmpresa } = useCompanyIds();
  const empresa = companyIds[0] ?? null;
  const [docs, setDocs] = useState<Documento[]>([]);
  const [clientes, setClientes] = useState<Record<string, string>>({});
  const [responsaveis, setResponsaveis] = useState<Record<string, string>>({});
  const [filtro, setFiltro] = useState<FiltroDoc>({});
  const [colunas, setColunas] = useState<string[]>(colunasValidas(null));
  const [config, setConfig] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    try { const s = localStorage.getItem(CHAVE); if (s) setColunas(colunasValidas(JSON.parse(s))); } catch { /* sem armazenamento: usa o padrão */ }
  }, []);
  const salvarColunas = (c: string[]) => {
    const v = colunasValidas(c); setColunas(v);
    try { localStorage.setItem(CHAVE, JSON.stringify(v)); } catch { /* ignora */ }
  };

  useEffect(() => {
    if (!empresa) { setCarregando(false); return; }
    let vivo = true;
    setCarregando(true); setErro(null);
    void (async () => {
      const [c, p, cl, eq] = await Promise.all([
        supabase.from("agency_contratos").select("id, tipo, fee_mensal, valor_projeto, status, data_inicio, data_fim, cliente_id, responsavel_id").eq("company_id", empresa).limit(5000),
        supabase.from("agency_propostas").select("id, numero, titulo, cliente_id, valor_total, desconto, valor_final, status, created_at, validade_proposta, responsavel_id").eq("company_id", empresa).is("deleted_at", null).limit(5000),
        supabase.from("agency_clientes").select("id, nome, nome_fantasia").eq("company_id", empresa).limit(2000),
        supabase.from("agency_equipe").select("user_id, nome").eq("company_id", empresa).limit(500),
      ]);
      if (!vivo) return;
      if (c.error || p.error) { setErro((c.error ?? p.error)!.message); setCarregando(false); return; }
      setDocs([...(c.data ?? []).map(deContrato), ...(p.data ?? []).map(dePropostas)]);
      setClientes(Object.fromEntries((cl.data ?? []).map((x: { id: string; nome: string; nome_fantasia: string | null }) => [x.id, x.nome_fantasia || x.nome])));
      setResponsaveis(Object.fromEntries((eq.data ?? []).map((x: { user_id: string; nome: string | null }) => [x.user_id, x.nome ?? ""])));
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [empresa]);

  const vis = useMemo(() => filtrarDocs(docs, filtro), [docs, filtro]);
  const t = useMemo(() => totais(vis), [vis]);
  const cols = colunas.map((k) => COLUNAS.find((c) => c.chave === k)!);
  const celula = (d: Documento, k: string) => {
    if (k === "cliente") return clientes[d.cliente_id ?? ""] ?? "—";
    if (k === "responsavel") return responsaveis[d.responsavel_id ?? ""] ?? "—";
    if (k === "tipo") return d.tipo === "fee" ? "Fee" : "Orçamento";
    const v = d[k as keyof Documento];
    return k === "valor" || k === "desconto" || k === "valor_a_faturar" ? brl(v as number | null) : v === null || v === undefined || v === "" ? "—" : String(v);
  };
  const baixarExcel = () => {
    const blob = new Blob(["﻿" + linhasCsv(vis, colunas, { clientes, responsaveis })], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "relatorio-documentos.csv"; a.click(); URL.revokeObjectURL(a.href);
  };

  if (carregandoEmpresa || !empresa) return <EmpresaNaoResolvida carregando={carregandoEmpresa} temEmpresa={companyIds.length > 0} tela="o Relatório de Documentos" />;
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[20px] font-semibold text-[#3D2314]">Relatório de Documentos</h1>
          <p className="text-[12px] text-[#6b5444]">Fees e orçamentos. Valores do documento comercial; o realizado financeiro fica no Financeiro.</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <button onClick={() => setConfig((v) => !v)} className={campo + " inline-flex items-center gap-1"}><Settings2 size={14} /> Colunas</button>
          <button onClick={baixarExcel} className={campo + " inline-flex items-center gap-1"}><FileSpreadsheet size={14} /> Excel</button>
          <button onClick={() => window.print()} className={campo + " inline-flex items-center gap-1"}><FileDown size={14} /> PDF</button>
        </div>
      </header>

      {config && (
        <div className="rounded-2xl border border-[#3D2314]/10 bg-white p-4 print:hidden">
          <p className="mb-2 flex items-center text-[12px] text-[#6b5444]">Escolha até {MAX_COLUNAS} colunas ({colunas.length} marcadas).<AjudaCampo chave="pm.relatorio_documentos.colunas" /></p>
          <div className="flex flex-wrap gap-3">
            {COLUNAS.map((c) => (
              <label key={c.chave} className="flex items-center gap-1 text-[13px] text-[#3D2314]">
                <input type="checkbox" checked={colunas.includes(c.chave as string)} onChange={(e) => salvarColunas(e.target.checked ? [...colunas, c.chave as string] : colunas.filter((k) => k !== c.chave))} />
                {c.rotulo}<AjudaCampo chave="pm.relatorio_documentos.colunas" />
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 print:hidden">
        <span className="inline-flex items-center"><select className={campo} value={filtro.tipo ?? ""} onChange={(e) => setFiltro({ ...filtro, tipo: (e.target.value || undefined) as FiltroDoc["tipo"] })} aria-label="Tipo">
          <option value="">Fee e orçamento</option><option value="fee">Só fee</option><option value="orcamento">Só orçamento</option>
        </select><AjudaCampo chave="pm.relatorio_documentos.tipo" /></span>
        <span className="inline-flex items-center"><select className={campo} value={filtro.clientes?.[0] ?? ""} onChange={(e) => setFiltro({ ...filtro, clientes: e.target.value ? [e.target.value] : undefined })} aria-label="Cliente">
          <option value="">Todos os clientes</option>
          {Object.entries(clientes).sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </select><AjudaCampo chave="pm.relatorio_documentos.cliente" /></span>
        <span className="inline-flex items-center"><input type="date" className={campo} value={filtro.de ?? ""} onChange={(e) => setFiltro({ ...filtro, de: e.target.value || undefined })} aria-label="De" /><AjudaCampo chave="pm.relatorio_documentos.de" /></span>
        <span className="inline-flex items-center"><input type="date" className={campo} value={filtro.ate ?? ""} onChange={(e) => setFiltro({ ...filtro, ate: e.target.value || undefined })} aria-label="Até" /><AjudaCampo chave="pm.relatorio_documentos.ate" /></span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[13px]">
        {[["Documentos", String(t.quantidade)], ["Valor", brl(t.valor)], ["A faturar", brl(t.aFaturar)]].map(([r, v]) => (
          <div key={r} className="rounded-2xl border border-[#3D2314]/10 bg-white p-3"><div className="text-[11px] uppercase tracking-wider text-[#3D2314]/60">{r}</div><div className="font-semibold text-[#3D2314]">{v}</div></div>
        ))}
      </div>

      {erro ? <p className="text-[13px] text-red-700">Não foi possível carregar: {erro}</p> : carregando ? <p className="text-[13px] text-[#6b5444]">Carregando…</p> : vis.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-[#6b5444]">Nenhum documento no filtro.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#3D2314]/10 bg-white">
          <table className="w-full text-left text-[13px] text-[#3D2314]">
            <thead><tr className="border-b border-[#E7DED3] text-[11px] uppercase tracking-wider text-[#3D2314]/60">{cols.map((c) => <th key={c.chave} className="px-3 py-2">{c.rotulo}</th>)}</tr></thead>
            <tbody>{vis.map((d) => <tr key={d.tipo + d.id} className="border-b border-[#E7DED3]/60">{cols.map((c) => <td key={c.chave} className="px-3 py-2">{celula(d, c.chave as string)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
