'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface Linha {
  linha_id: string
  linha_nome: string
  realizado: number
  orcado: number
  pct_atingido: number | null
  status: 'verde' | 'amarelo' | 'vermelho' | 'sem_orcamento'
}
interface Data {
  sem_plano?: boolean
  empty_state?: boolean
  mensagem?: string
  mes?: number
  ano?: number
  linhas?: Linha[]
  total_realizado?: number
  total_orcado?: number
  pct_geral?: number | null
}

const NOMES_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

const COR = {
  verde: { fg: '#3B6D11', bg: '#EAF3DE' },
  amarelo: { fg: '#854F0B', bg: '#FAEEDA' },
  vermelho: { fg: '#A32D2D', bg: '#FCEBEB' },
}

function fmt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function DREDivisional({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [data, setData] = useState<Data | null>(null)

  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data: result } = await supabase.rpc('fn_ge_dre_divisional', { p_company_id: companyId })
      if (!ignore) setData(result as Data)
    })()
    return () => { ignore = true }
  }, [companyId])

  if (!data || data.sem_plano) return null

  if (data.empty_state) {
    return (
      <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: 24, marginBottom: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: 'rgba(61,35,20,0.6)', marginBottom: 12 }}>
          {data.mensagem ?? 'DRE Divisional opcional — sem linhas de negócio cadastradas.'}
        </div>
        <button
          type="button"
          onClick={() => router.push('/dashboard/dre-divisional/configurar')}
          style={{ background: 'transparent', color: '#C8941A', border: '0.5px solid #C8941A', padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          Configurar linhas de negócio →
        </button>
      </div>
    )
  }

  const pctGeral = data.pct_geral
  const corPctGeral = pctGeral != null
    ? (pctGeral >= 90 ? '#3B6D11' : pctGeral >= 70 ? '#BA7517' : '#A32D2D')
    : 'rgba(61,35,20,0.4)'

  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: '18px 20px', marginBottom: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
          DRE Divisional · {data.mes ? NOMES_MES[data.mes - 1] : ''}/{data.ano}
        </span>
        {pctGeral != null && (
          <span style={{ fontSize: 12, color: corPctGeral, fontWeight: 600 }}>
            Performance geral {pctGeral}%
          </span>
        )}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '0.5px solid rgba(61,35,20,0.1)' }}>
              <Th>Linha de Negócio</Th>
              <Th align="right">Realizado</Th>
              <Th align="right">Orçado</Th>
              <Th align="right">Atingido</Th>
            </tr>
          </thead>
          <tbody>
            {(data.linhas ?? []).map((l) => {
              const tone = l.status !== 'sem_orcamento' ? COR[l.status] : null
              return (
                <tr key={l.linha_id} style={{ borderBottom: '0.5px solid rgba(61,35,20,0.06)' }}>
                  <td style={{ padding: '10px 0', color: '#3D2314' }}>{l.linha_nome}</td>
                  <td style={{ padding: '10px 0', textAlign: 'right', color: '#3D2314', fontVariantNumeric: 'tabular-nums' }}>R$ {fmt(l.realizado)}</td>
                  <td style={{ padding: '10px 0', textAlign: 'right', color: 'rgba(61,35,20,0.6)', fontVariantNumeric: 'tabular-nums' }}>R$ {fmt(l.orcado)}</td>
                  <td style={{ padding: '10px 0', textAlign: 'right' }}>
                    {tone && l.pct_atingido != null ? (
                      <span style={{ background: tone.bg, color: tone.fg, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {l.pct_atingido}%
                      </span>
                    ) : (
                      <span style={{ color: 'rgba(61,35,20,0.4)', fontSize: 11 }}>sem orçamento</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{ textAlign: align ?? 'left', padding: '8px 0', color: 'rgba(61,35,20,0.55)', fontWeight: 500, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 }}>
      {children}
    </th>
  )
}
