'use client'

// NFE-F4 · §7 · Precificação em massa (margem REAL). Cria a tabela de preço pela 1ª vez.
// Relatório: custo × preço hoje × margem hoje × preço sugerido (margem alvo, depois de imposto+comissão+
// custo fixo). 🛑 Nada é gravado sem clique (RD-55). Exportar p/ planilha, revisar fora e reimportar.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Tags, Loader2, Download } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

type Row = {
  produto_id: string; codigo: string; nome: string; custo: number
  preco_hoje: number | null; margem_hoje_pct: number | null; preco_sugerido: number | null
}
const brl = (v: number | null) => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const pct = (v: number | null) => v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

export default function PrecificacaoPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [margem, setMargem] = useState('25')
  const [filtro, setFiltro] = useState<'todos' | 'sem_preco' | 'margem_negativa'>('todos')
  const [aplicado, setAplicado] = useState<Record<string, number>>({})

  const carregar = useCallback(async () => {
    if (!empresa) { setRows([]); setLoading(false); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_produto_preco_sugerir_lote', { p_company_id: empresa, p_margem_alvo: Number(margem) || 25, p_filtro: filtro })
    setLoading(false)
    if (error) { setErro(error.message); return }
    const r = data as { ok?: boolean; produtos?: Row[]; erro?: string } | null
    if (!r?.ok) { setErro(r?.erro ?? 'Erro ao gerar sugestão'); setRows([]); return }
    setRows(r.produtos ?? [])
  }, [empresa, margem, filtro])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t) }, [toast])

  async function aplicar(r: Row) {
    if (!r.preco_sugerido) return
    const { data } = await supabase.rpc('fn_produto_preco_aplicar', { p_produto_id: r.produto_id, p_novo_preco: r.preco_sugerido, p_regra_id: null, p_motivo: `Precificação em massa · margem alvo ${margem}%` })
    const rr = data as { ok?: boolean } | null
    if (!rr?.ok) { setToast('Não consegui aplicar o preço.'); return }
    setAplicado((a) => ({ ...a, [r.produto_id]: r.preco_sugerido! }))
    setToast(`Preço de ${r.nome} atualizado para ${brl(r.preco_sugerido)} — registrado no histórico.`)
  }

  function exportarCsv() {
    const head = ['codigo', 'nome', 'custo', 'preco_hoje', 'margem_hoje_pct', 'preco_sugerido', 'margem_alvo_pct']
    const linhas = rows.map((r) => [r.codigo, `"${(r.nome ?? '').replace(/"/g, '""')}"`, r.custo, r.preco_hoje ?? '', r.margem_hoje_pct ?? '', r.preco_sugerido ?? '', margem].join(';'))
    const csv = '﻿' + [head.join(';'), ...linhas].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `precificacao_margem_${margem}pct.csv`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  }

  if (!empresa) return <div className="min-h-screen bg-[#FAF7F2] p-6 text-[#3D2314]">Selecione uma empresa específica no topo.</div>

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8">
        <div className="text-[11px] text-[#3D2314]/60 tracking-[1px] uppercase font-medium mb-1">Compras · Preço</div>
        <h1 className="text-[24px] sm:text-[28px] font-medium text-[#3D2314] leading-tight flex items-center gap-2">
          <Tags size={22} className="text-[#C8941A]" /> Precificação por margem real
        </h1>
        <p className="text-[13px] text-[#3D2314]/70 mt-1.5 max-w-3xl">
          Preço que deixa a <strong>margem líquida</strong> pedida — depois de imposto, comissão e custo fixo (não é markup).
          <strong> Nada é gravado</strong> sem você mandar. Exporte, revise fora e reimporte, ou aplique produto a produto.
        </p>

        <div className="mt-4 flex items-end gap-2 flex-wrap bg-white border border-[#3D2314]/10 rounded-xl p-3">
          <label className="text-[12px] text-[#3D2314]/70">Margem líquida alvo
            <div className="flex items-center gap-1 mt-0.5">
              <input type="number" value={margem} onChange={(e) => setMargem(e.target.value)} className="w-20 border border-[#3D2314]/15 rounded-md px-2 py-1 text-[13px] text-[#3D2314]" />%
            </div>
          </label>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} className="text-[12px] border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[#3D2314]">
            <option value="todos">Todos com custo</option>
            <option value="sem_preco">Sem preço de venda</option>
            <option value="margem_negativa">Vendendo abaixo do custo</option>
          </select>
          <button type="button" onClick={() => void carregar()} className="text-[12px] px-3 py-1.5 rounded-md bg-[#C8941A] text-white font-medium hover:bg-[#A87810]">Recalcular</button>
          <button type="button" onClick={exportarCsv} disabled={rows.length === 0} className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md border border-[#3D2314]/15 text-[#3D2314]/70 hover:bg-[#3D2314]/5 disabled:opacity-40 ml-auto"><Download size={13} /> Exportar planilha</button>
        </div>

        {toast && <div className="mt-3 text-[12px] px-3 py-2 rounded-md bg-[#E8F4DC] text-[#1B3608] border border-[#3F7012]/20">{toast}</div>}

        <div className="mt-4 bg-white border border-[#3D2314]/10 rounded-xl overflow-hidden">
          {loading ? (
            <div className="px-4 py-12 text-center text-[#3D2314]/55 flex items-center justify-center gap-2 text-[13px]"><Loader2 className="animate-spin" size={15} /> Calculando…</div>
          ) : erro ? (
            <div className="px-4 py-6 text-[12px] text-[#A32D2D]">Não consegui calcular: {erro}</div>
          ) : rows.length === 0 ? (
            <div className="px-6 py-16 text-center text-[13px] text-[#3D2314]/60">Nenhum produto com custo neste filtro. Os sem custo se resolvem processando as notas (mutirão).</div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-[#3D2314]/10 text-[12px] text-[#3D2314]/70"><strong className="text-[#3D2314]">{rows.length}</strong> produto(s) · margem alvo {margem}%</div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-[#3D2314]/55 text-left border-b border-[#3D2314]/8">
                      <th className="px-3 py-2 font-medium">Produto</th>
                      <th className="px-3 py-2 font-medium text-right">Custo</th>
                      <th className="px-3 py-2 font-medium text-right">Preço hoje</th>
                      <th className="px-3 py-2 font-medium text-right">Margem hoje</th>
                      <th className="px-3 py-2 font-medium text-right">Sugerido</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.produto_id} className="border-b border-[#3D2314]/6">
                        <td className="px-3 py-2"><div className="text-[#3D2314] font-medium truncate max-w-[260px]">{r.nome}</div><div className="text-[10px] text-[#3D2314]/50">cód {r.codigo}</div></td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#3D2314]">{brl(r.custo)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#3D2314]/70">{brl(r.preco_hoje)}</td>
                        <td className={'px-3 py-2 text-right tabular-nums font-medium ' + ((r.margem_hoje_pct ?? 0) < 0 ? 'text-[#A32D2D]' : 'text-[#3D2314]/70')}>{pct(r.margem_hoje_pct)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#3F7012]">{brl(aplicado[r.produto_id] ?? r.preco_sugerido)}</td>
                        <td className="px-3 py-2 text-right">
                          {aplicado[r.produto_id] ? <span className="text-[11px] text-[#3F7012] font-medium">✓ aplicado</span>
                            : <button type="button" onClick={() => void aplicar(r)} disabled={!r.preco_sugerido} className="text-[11px] px-2.5 py-1 rounded-md bg-[#3F7012] text-white font-medium hover:bg-[#2F5510] disabled:opacity-40">Aplicar</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="mt-3 text-[11px] text-[#3D2314]/55">
          Regras por escopo (produto / grupo / fornecedor / empresa) e sugestão automática no recebimento serão ligadas na sequência — o motor de margem já está pronto. <Link href="/dashboard/compras/custo-config" className="text-[#BA7517] hover:underline">Configurar imposto/comissão da venda</Link>.
        </div>
      </div>
    </div>
  )
}
