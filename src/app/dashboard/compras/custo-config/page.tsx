'use client'

// NFE-F1 · E4 · Configuração do custo de estoque por empresa e natureza. Quais tributos/valores compõem
// o custo (depende do regime). KGF (simples/monofásico) = os 8 marcados. Sem config → usa 'default'.

import { useCallback, useEffect, useState } from 'react'
import { SlidersHorizontal, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

type Cfg = {
  id?: string; natureza: string
  icms_e_custo: boolean; st_e_custo: boolean; ipi_e_custo: boolean; pis_e_custo: boolean
  cofins_e_custo: boolean; frete_e_custo: boolean; seguro_e_custo: boolean; outras_e_custo: boolean
}
const NATUREZAS = ['revenda', 'industrializacao', 'uso_consumo', 'imobilizado', 'default']
const CAMPOS: { k: keyof Cfg; l: string }[] = [
  { k: 'icms_e_custo', l: 'ICMS' }, { k: 'st_e_custo', l: 'ST' }, { k: 'ipi_e_custo', l: 'IPI' },
  { k: 'pis_e_custo', l: 'PIS' }, { k: 'cofins_e_custo', l: 'COFINS' }, { k: 'frete_e_custo', l: 'Frete' },
  { k: 'seguro_e_custo', l: 'Seguro' }, { k: 'outras_e_custo', l: 'Outras' },
]
const vazia = (natureza: string): Cfg => ({ natureza, icms_e_custo: false, st_e_custo: true, ipi_e_custo: true, pis_e_custo: false, cofins_e_custo: false, frete_e_custo: true, seguro_e_custo: true, outras_e_custo: true })

export default function CustoConfigPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [rows, setRows] = useState<Cfg[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [novaNat, setNovaNat] = useState('revenda')

  const carregar = useCallback(async () => {
    if (!empresa) { setRows([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('erp_custo_estoque_config').select('*').eq('company_id', empresa).order('natureza')
    setRows((data ?? []) as Cfg[]); setLoading(false)
  }, [empresa])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2500); return () => clearTimeout(t) }, [toast])

  async function salvar(c: Cfg) {
    if (!empresa) return
    const payload = { ...c, company_id: empresa }
    const { error } = await supabase.from('erp_custo_estoque_config').upsert(payload, { onConflict: 'company_id,natureza' })
    if (error) { setToast('Erro ao salvar: ' + error.message); return }
    setToast('Configuração salva.'); void carregar()
  }
  function patch(natureza: string, k: keyof Cfg, v: boolean) {
    setRows((arr) => arr.map((r) => (r.natureza === natureza ? { ...r, [k]: v } : r)))
  }
  async function adicionar() {
    if (rows.some((r) => r.natureza === novaNat)) { setToast('Essa natureza já existe.'); return }
    await salvar(vazia(novaNat))
  }

  if (!empresa) return <div className="min-h-screen bg-[#FAF7F2] p-6 text-[#3D2314]">Selecione uma empresa específica no topo.</div>

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
        <div className="text-[11px] text-[#3D2314]/60 tracking-[1px] uppercase font-medium mb-1">Compras · Custo</div>
        <h1 className="text-[24px] sm:text-[28px] font-medium text-[#3D2314] leading-tight flex items-center gap-2">
          <SlidersHorizontal size={22} className="text-[#C8941A]" /> Configuração de custo
        </h1>
        <p className="text-[13px] text-[#3D2314]/70 mt-1.5 max-w-2xl">
          Quais tributos e valores entram no custo do estoque, por natureza. Depende do regime — no Simples/
          monofásico, ICMS e PIS/COFINS não são creditados, então entram no custo. Sem config, usa <code>default</code>.
        </p>

        <div className="mt-5 bg-white border border-[#3D2314]/10 rounded-xl overflow-hidden">
          {loading ? (
            <div className="px-4 py-12 text-center text-[#3D2314]/55 flex items-center justify-center gap-2 text-[13px]"><Loader2 className="animate-spin" size={15} /> Carregando…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[#3D2314]/55 text-left border-b border-[#3D2314]/8">
                    <th className="px-3 py-2 font-medium">Natureza</th>
                    {CAMPOS.map((c) => <th key={c.k} className="px-2 py-2 font-medium text-center">{c.l}</th>)}
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-[#3D2314]/55">Sem configuração — adicione a primeira abaixo (usa o <code>default</code> até lá).</td></tr>}
                  {rows.map((r) => (
                    <tr key={r.natureza} className="border-b border-[#3D2314]/6">
                      <td className="px-3 py-2 font-medium text-[#3D2314]">{r.natureza}</td>
                      {CAMPOS.map((c) => (
                        <td key={c.k} className="px-2 py-2 text-center">
                          <input type="checkbox" checked={r[c.k] as boolean} onChange={(e) => patch(r.natureza, c.k, e.target.checked)} className="cursor-pointer" />
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right"><button onClick={() => void salvar(r)} className="text-[11px] px-2.5 py-1 rounded-md bg-[#3F7012] text-white font-medium hover:bg-[#2F5510]">Salvar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="px-3 py-3 border-t border-[#3D2314]/8 flex items-center gap-2">
            <select value={novaNat} onChange={(e) => setNovaNat(e.target.value)} className="text-[12px] border border-[#3D2314]/15 rounded-md px-2 py-1 text-[#3D2314]">
              {NATUREZAS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <button onClick={() => void adicionar()} className="text-[12px] px-3 py-1.5 rounded-md bg-[#C8941A] text-white font-medium hover:bg-[#A87810]">+ Adicionar natureza</button>
          </div>
        </div>
        {toast && <div className="mt-3 text-[12px] px-3 py-2 rounded-md bg-[#E8F4DC] text-[#1B3608] border border-[#3F7012]/20 inline-block">{toast}</div>}
      </div>
    </div>
  )
}
