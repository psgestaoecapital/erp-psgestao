'use client'

// NFE-F2 · E5 · Mercadoria a chegar: o que foi faturado, ainda não chegou, e já pesa no caixa.
// Notas com XML, sem data de recebimento e não concluídas. Transportadora/previsão vêm do <transp> (backfill).

import { useCallback, useEffect, useState } from 'react'
import { Truck, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

type Nota = {
  id: string; numero: string | null; emitente_razao: string | null; valor_total: number | null
  data_emissao: string | null; previsao_entrega: string | null; recebida_em: string | null
  transportadora: string | null; peso_bruto: number | null; volumes_qtd: number | null
}
const brl = (v: number | null) => 'R$ ' + Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const fmtData = (s: string | null) => s ? s.split('T')[0].split('-').reverse().join('/') : '—'

export default function MercadoriaAChegarPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [notas, setNotas] = useState<Nota[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) { setNotas([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('erp_nfe_recebidas')
      .select('id, numero, emitente_razao, valor_total, data_emissao, previsao_entrega, recebida_em, transportadora, peso_bruto, volumes_qtd, concluida_em, status')
      .eq('company_id', empresa).is('recebida_em', null).is('concluida_em', null)
      .not('status', 'in', '(ignorada)').order('data_emissao', { ascending: false }).limit(300)
    setNotas((data ?? []) as Nota[]); setLoading(false)
  }, [empresa])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  async function marcarRecebida(id: string) {
    setBusy(id)
    const hoje = new Date().toISOString().slice(0, 10)
    const { error } = await supabase.from('erp_nfe_recebidas').update({ recebida_em: hoje }).eq('id', id)
    setBusy(null)
    if (!error) await carregar()
  }

  if (!empresa) return <div className="min-h-screen bg-[#FAF7F2] p-6 text-[#3D2314]">Selecione uma empresa específica no topo.</div>
  const total = notas.reduce((s, n) => s + Number(n.valor_total ?? 0), 0)

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8">
        <div className="text-[11px] text-[#3D2314]/60 tracking-[1px] uppercase font-medium mb-1">Compras · Logística</div>
        <h1 className="text-[24px] sm:text-[28px] font-medium text-[#3D2314] leading-tight flex items-center gap-2">
          <Truck size={22} className="text-[#C8941A]" /> Mercadoria a chegar
        </h1>
        <p className="text-[13px] text-[#3D2314]/70 mt-1.5 max-w-2xl">
          O que já foi <strong>faturado</strong> mas ainda <strong>não chegou</strong> — já pesa no caixa. Marque como recebida quando a mercadoria entrar.
        </p>

        <div className="mt-5 bg-white border border-[#3D2314]/10 rounded-xl overflow-hidden">
          {loading ? (
            <div className="px-4 py-12 text-center text-[#3D2314]/55 flex items-center justify-center gap-2 text-[13px]"><Loader2 className="animate-spin" size={15} /> Carregando…</div>
          ) : notas.length === 0 ? (
            <div className="px-6 py-16 text-center text-[13px] text-[#3D2314]/60">Nada a chegar — tudo que foi faturado já foi recebido. 🎉</div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-[#3D2314]/10 text-[12px] text-[#3D2314]/70 flex justify-between">
                <span><strong className="text-[#3D2314]">{notas.length}</strong> nota(s) a chegar</span>
                <span>total faturado a receber: <strong className="text-[#C8941A]">{brl(total)}</strong></span>
              </div>
              <div className="divide-y divide-[#3D2314]/8">
                {notas.map((n) => (
                  <div key={n.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-[#3D2314] truncate">{n.emitente_razao ?? '(sem fornecedor)'} · NF {n.numero ?? '—'}</div>
                      <div className="text-[11px] text-[#3D2314]/55 mt-0.5">
                        emitida {fmtData(n.data_emissao)}
                        {n.transportadora ? ` · 🚚 ${n.transportadora}` : ''}
                        {n.peso_bruto ? ` · ${Number(n.peso_bruto).toLocaleString('pt-BR')} kg` : ''}
                        {n.volumes_qtd ? ` · ${n.volumes_qtd} vol` : ''}
                        {n.previsao_entrega ? ` · previsão ${fmtData(n.previsao_entrega)}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[13px] font-semibold text-[#C8941A] tabular-nums">{brl(n.valor_total)}</span>
                      <button type="button" disabled={busy === n.id} onClick={() => void marcarRecebida(n.id)}
                        className="text-[11px] px-2.5 py-1 rounded-md bg-[#3F7012] text-white font-medium hover:bg-[#2F5510] disabled:opacity-50">
                        {busy === n.id ? '…' : 'Chegou'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
