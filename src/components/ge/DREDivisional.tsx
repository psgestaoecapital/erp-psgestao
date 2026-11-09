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

  const linhas = data.linhas ?? []
  const semLinha = linhas.find((l) => l.linha_id === 'sem_linha')
  const nomeadas = linhas.filter((l) => l.linha_id !== 'sem_linha')
  const nomeadasRealizado = nomeadas.reduce((s, l) => s + (Number(l.realizado) || 0), 0)
  const semLinhaValor = Number(semLinha?.realizado) || 0
  const totalRealizado = Number(data.total_realizado) || 0
  const totalOrcado = Number(data.total_orcado) || 0
  // Reconciliação: há receita no mês ainda não atribuída a nenhuma linha de negócio.
  // Mostra de onde vem a receita (critério e) e como classificar (critério d).
  const mostrarReconciliacao = semLinhaValor > 0.005
  const tudoSemLinha = mostrarReconciliacao && nomeadasRealizado <= 0.005

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
            {linhas.map((l) => {
              const tone = l.status !== 'sem_orcamento' ? COR[l.status] : null
              const isSemLinha = l.linha_id === 'sem_linha'
              return (
                <tr key={l.linha_id} style={{ borderBottom: '0.5px solid rgba(61,35,20,0.06)', background: isSemLinha ? 'rgba(61,35,20,0.025)' : undefined }}>
                  <td style={{ padding: '10px 0', color: isSemLinha ? 'rgba(61,35,20,0.6)' : '#3D2314' }}>
                    {l.linha_nome}
                    {isSemLinha && (
                      <span style={{ marginLeft: 8, background: '#FAEEDA', color: '#854F0B', fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4, letterSpacing: 0.3, textTransform: 'uppercase', verticalAlign: 'middle' }}>
                        não atribuído
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '10px 0', textAlign: 'right', color: isSemLinha ? 'rgba(61,35,20,0.7)' : '#3D2314', fontVariantNumeric: 'tabular-nums' }}>R$ {fmt(l.realizado)}</td>
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
          <tfoot>
            <tr style={{ borderTop: '1px solid rgba(61,35,20,0.18)' }}>
              <td style={{ padding: '10px 0', color: '#3D2314', fontWeight: 600 }}>Total do mês</td>
              <td style={{ padding: '10px 0', textAlign: 'right', color: '#3D2314', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>R$ {fmt(totalRealizado)}</td>
              <td style={{ padding: '10px 0', textAlign: 'right', color: 'rgba(61,35,20,0.6)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>R$ {fmt(totalOrcado)}</td>
              <td style={{ padding: '10px 0', textAlign: 'right' }}>
                {pctGeral != null ? (
                  <span style={{ color: corPctGeral, fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{pctGeral}%</span>
                ) : (
                  <span style={{ color: 'rgba(61,35,20,0.4)', fontSize: 11 }}>—</span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {mostrarReconciliacao && (
        <div style={{ marginTop: 14, padding: '12px 14px', background: '#FBF6EC', border: '0.5px solid rgba(200,148,26,0.3)', borderRadius: 8, display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220, fontSize: 12.5, color: 'rgba(61,35,20,0.8)', lineHeight: 1.5 }}>
            {tudoSemLinha
              ? <>Toda a receita do mês (<strong>R$ {fmt(semLinhaValor)}</strong>) ainda está <strong>sem linha de negócio</strong>. Por isso Atacado/Serviços/Varejo aparecem zerados. Defina as regras de linha de negócio nos Centros de Custo para ver a divisão.</>
              : <><strong>R$ {fmt(semLinhaValor)}</strong> de receita ainda não está atribuída a uma linha de negócio. Ajuste as regras nos Centros de Custo para reconciliar o total.</>}
          </div>
          <button
            type="button"
            onClick={() => router.push('/dashboard/gestao-empresarial/centros-custo')}
            style={{ background: 'transparent', color: '#C8941A', border: '0.5px solid #C8941A', padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Classificar receita →
          </button>
        </div>
      )}
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
