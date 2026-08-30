'use client'

// NFE-F5 · Entrega 1 (tela) · Livro de Entradas. Renderiza fn_fiscal_livro_entradas no formato do contador.
// ⚠️ Competência default = MÊS ATUAL (não o trimestre). O total do cabeçalho é o do mês selecionado
// (ago/2026 = R$ 1.761,77); o R$ 5.669,34 só aparece em "Todas (trimestre)". Valores vêm do XML.

import { useCallback, useEffect, useState } from 'react'
import { BookText, Loader2, Download, Printer } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

type Linha = {
  cfop: string; data_emissao: string | null; numero: string | null; serie: string | null; chave: string | null
  emitente: string | null; cnpj: string | null; uf: string | null
  valor_contabil: number; base_icms: number; aliquota_icms: number | null; valor_icms: number
  isentas: number; outras: number; ipi: number; st: number; conferida: boolean
}
type CfopResumo = { cfop: string; notas: number; valor_contabil: number; base_icms: number; valor_icms: number; isentas: number; outras: number; ipi: number; st: number }
type Livro = {
  ok?: boolean; erro?: string; competencia: string
  cabecalho: { total_notas: number; conferidas: number; nao_conferidas: number; aviso: string; nota_estoque: string | null; excluidas: { sem_xml: number; recusada_ou_nao_realizada: number } }
  por_cfop: CfopResumo[]; totais: { valor_contabil: number; base_icms: number; valor_icms: number; isentas: number; ipi: number; st: number }; linhas: Linha[]
}
const brl = (v: number | null | undefined) => 'R$ ' + Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const mesAtual = () => new Date().toISOString().slice(0, 7)

export default function LivroEntradasPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [competencia, setCompetencia] = useState<string>(mesAtual())
  const [todas, setTodas] = useState(false)
  const [dados, setDados] = useState<Livro | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) { setDados(null); setLoading(false); return }
    setLoading(true); setErro(null)
    const p_comp = todas ? null : competencia
    const { data, error } = await supabase.rpc('fn_fiscal_livro_entradas', { p_company_id: empresa, p_competencia: p_comp })
    setLoading(false)
    if (error) { setErro(error.message); return }
    const r = data as Livro | null
    if (!r?.ok) { setErro(r?.erro ?? 'Erro ao carregar'); return }
    setDados(r)
  }, [empresa, competencia, todas])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t) }, [toast])

  const periodoLabel = todas ? 'Todas as competências (trimestre)' : `Competência ${competencia.split('-')[1]}/${competencia.split('-')[0]}`

  function montarCsv(): string {
    const head = ['cfop', 'data_emissao', 'numero', 'serie', 'chave', 'emitente', 'cnpj', 'uf', 'valor_contabil', 'base_icms', 'aliquota_icms', 'valor_icms', 'isentas', 'outras', 'ipi', 'st', 'conferida']
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const linhas = (dados?.linhas ?? []).map((l) => [l.cfop, l.data_emissao ?? '', l.numero ?? '', l.serie ?? '', l.chave ?? '', q(l.emitente), l.cnpj ?? '', l.uf ?? '', l.valor_contabil, l.base_icms, l.aliquota_icms ?? '', l.valor_icms, l.isentas, l.outras, l.ipi, l.st, l.conferida ? 'sim' : 'nao'].join(';'))
    return '﻿' + [head.join(';'), ...linhas].join('\n')
  }

  async function exportarCsv() {
    if (!empresa || !dados) return
    const csv = montarCsv()
    // registra a exportação com hash MD5 no servidor (rastreabilidade)
    const { data } = await supabase.rpc('fn_fiscal_exportacao_registrar', {
      p_company_id: empresa, p_tipo: 'livro_entradas', p_periodo: todas ? 'todas' : competencia,
      p_linhas: dados.linhas.length, p_conteudo: csv, p_sistema_destino: 'csv',
    })
    const r = data as { ok?: boolean; hash_md5?: string } | null
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `livro_entradas_${todas ? 'trimestre' : competencia}.csv`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    setToast(r?.ok ? `CSV exportado e registrado (hash ${r.hash_md5?.slice(0, 8)}…).` : 'CSV exportado (falha ao registrar).')
  }

  if (!empresa) return <div className="min-h-screen bg-[#FAF7F2] p-6 text-[#3D2314]">Selecione uma empresa específica no topo.</div>

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8">
        <div className="text-[11px] text-[#3D2314]/60 tracking-[1px] uppercase font-medium mb-1">Commerce · Compras</div>
        <h1 className="text-[24px] sm:text-[28px] font-medium text-[#3D2314] leading-tight flex items-center gap-2">
          <BookText size={22} className="text-[#C8941A]" /> Livro de Entradas
        </h1>
        <p className="text-[13px] text-[#3D2314]/70 mt-1.5 max-w-3xl">
          As notas de compra do período, por CFOP, com base e ICMS — no formato que a contabilidade lê.
          <strong> Valores extraídos do XML.</strong>
        </p>

        <div className="mt-4 flex items-end gap-2 flex-wrap bg-white border border-[#3D2314]/10 rounded-xl p-3 print:hidden">
          <label className="text-[12px] text-[#3D2314]/70">Competência
            <div className="mt-0.5">
              <input type="month" value={competencia} disabled={todas} onChange={(e) => setCompetencia(e.target.value)}
                className="border border-[#3D2314]/15 rounded-md px-2 py-1 text-[13px] text-[#3D2314] disabled:opacity-40" />
            </div>
          </label>
          <label className="text-[12px] text-[#3D2314]/70 inline-flex items-center gap-1.5 pb-1.5">
            <input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} /> Todas (trimestre)
          </label>
          <button type="button" onClick={exportarCsv} disabled={!dados || dados.linhas.length === 0}
            className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md bg-[#C8941A] text-white font-medium hover:bg-[#A87810] disabled:opacity-40 ml-auto"><Download size={13} /> Exportar CSV</button>
          <button type="button" onClick={() => window.print()} disabled={!dados}
            className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md border border-[#3D2314]/15 text-[#3D2314]/70 hover:bg-[#3D2314]/5 disabled:opacity-40"><Printer size={13} /> PDF</button>
        </div>

        {toast && <div className="mt-3 text-[12px] px-3 py-2 rounded-md bg-[#E8F4DC] text-[#1B3608] border border-[#3F7012]/20 print:hidden">{toast}</div>}

        {loading ? (
          <div className="mt-6 px-4 py-16 text-center text-[#3D2314]/55 flex items-center justify-center gap-2 text-[13px]"><Loader2 className="animate-spin" size={15} /> Carregando…</div>
        ) : erro ? (
          <div className="mt-6 px-4 py-6 text-[12px] text-[#A32D2D] bg-white border border-[#3D2314]/10 rounded-xl">Não consegui carregar: {erro}</div>
        ) : dados ? (
          <>
            <div className="mt-4 bg-white border border-[#3D2314]/10 rounded-xl p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-[14px] font-medium text-[#3D2314]">{periodoLabel}</div>
                <div className="text-[13px] text-[#3D2314]/70">ICMS <strong className="text-[#3D2314]">{brl(dados.totais.valor_icms)}</strong> · contábil {brl(dados.totais.valor_contabil)}</div>
              </div>
              <div className="text-[12px] text-[#3D2314]/60 mt-1">{dados.cabecalho.aviso}</div>
              {dados.cabecalho.nota_estoque && <div className="text-[11px] text-[#3D2314]/55 mt-1">{dados.cabecalho.nota_estoque}</div>}
              {(dados.cabecalho.excluidas.sem_xml > 0 || dados.cabecalho.excluidas.recusada_ou_nao_realizada > 0) && (
                <div className="text-[11px] text-[#A3651D] mt-1">Fora do livro: {dados.cabecalho.excluidas.sem_xml} sem XML · {dados.cabecalho.excluidas.recusada_ou_nao_realizada} recusada/não realizada.</div>
              )}
            </div>

            <div className="mt-4 bg-white border border-[#3D2314]/10 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#3D2314]/10 text-[12px] text-[#3D2314]/70">Resumo por <strong className="text-[#3D2314]">CFOP</strong></div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-[#3D2314]/55 text-left border-b border-[#3D2314]/8">
                      <th className="px-3 py-2 font-medium">CFOP</th><th className="px-3 py-2 font-medium text-right">Notas</th>
                      <th className="px-3 py-2 font-medium text-right">Contábil</th><th className="px-3 py-2 font-medium text-right">Base ICMS</th>
                      <th className="px-3 py-2 font-medium text-right">ICMS</th><th className="px-3 py-2 font-medium text-right">Isentas</th>
                      <th className="px-3 py-2 font-medium text-right">Outras</th><th className="px-3 py-2 font-medium text-right">IPI</th><th className="px-3 py-2 font-medium text-right">ST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.por_cfop.length === 0 ? (
                      <tr><td colSpan={9} className="px-3 py-8 text-center text-[#3D2314]/55">Nenhuma nota neste período.</td></tr>
                    ) : dados.por_cfop.map((c) => (
                      <tr key={c.cfop} className="border-b border-[#3D2314]/6">
                        <td className="px-3 py-2 font-medium text-[#3D2314]">{c.cfop}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{c.notas}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{brl(c.valor_contabil)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{brl(c.base_icms)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-[#3D2314]">{brl(c.valor_icms)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#3D2314]/60">{brl(c.isentas)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#3D2314]/60">{brl(c.outras)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#3D2314]/60">{brl(c.ipi)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#3D2314]/60">{brl(c.st)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {dados.por_cfop.length > 0 && (
                    <tfoot>
                      <tr className="border-t border-[#3D2314]/15 font-medium text-[#3D2314]">
                        <td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right tabular-nums">{dados.cabecalho.total_notas}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{brl(dados.totais.valor_contabil)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{brl(dados.totais.base_icms)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{brl(dados.totais.valor_icms)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{brl(dados.totais.isentas)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">—</td>
                        <td className="px-3 py-2 text-right tabular-nums">{brl(dados.totais.ipi)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{brl(dados.totais.st)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
