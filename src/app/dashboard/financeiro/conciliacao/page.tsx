'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

interface Movimento {
  id: string
  data_transacao: string
  valor: number
  descricao: string | null
  natureza: string | null
  status: string | null
}

function fmt(n: number | undefined | null): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ConciliacaoPage() {
  const router = useRouter()
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [movimentos, setMovimentos] = useState<Movimento[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ignore = false
    if (!empresaUnica) { setLoading(false); return }
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('conciliacao_movimento')
        .select('id, data_transacao, valor, descricao, natureza, status')
        .eq('company_id', empresaUnica)
        .in('status', ['pendente', 'sugerido', 'nao_conciliado'])
        .order('data_transacao', { ascending: false })
        .limit(100)
      if (!ignore) {
        setMovimentos((data ?? []) as Movimento[])
        setLoading(false)
      }
    })()
    return () => { ignore = true }
  }, [empresaUnica])

  if (!empresaUnica) {
    return <div style={{ padding: 40, textAlign: 'center', background: '#FAF7F2', minHeight: '100vh', color: '#3D2314' }}>
      Selecione uma empresa para ver conciliação bancária.
    </div>
  }

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '32px 24px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <button onClick={() => router.push('/dashboard/gestao-empresarial')} style={{ background: 'transparent', border: 'none', color: 'rgba(61,35,20,0.55)', fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 16 }}>
          ← Painel Gestão Empresarial
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: '#3D2314', margin: '0 0 6px' }}>Conciliação Bancária</h1>
            <p style={{ color: 'rgba(61,35,20,0.65)', fontSize: 13, margin: 0 }}>Movimentos bancários pendentes de conciliação</p>
          </div>
          <button
            disabled
            title="Importação OFX disponível no PR 14 V2 (em desenvolvimento)"
            style={{ background: 'rgba(200,148,26,0.4)', color: '#3D2314', border: 'none', padding: '10px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'not-allowed' }}
          >
            Importar OFX (em breve)
          </button>
        </div>

        <div style={{ background: '#FAEEDA', border: '0.5px solid rgba(186,117,23,0.3)', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 12, color: '#854F0B' }}>
          Conciliação automática (match Pix · OFX · adquirente) chega no PR 14 V2.
          Por enquanto: visualização dos movimentos pendentes registrados.
        </div>

        {loading ? (
          <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, padding: 40, textAlign: 'center', color: 'rgba(61,35,20,0.55)' }}>Carregando…</div>
        ) : movimentos.length === 0 ? (
          <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, padding: 60, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: '#3D2314', marginBottom: 6, fontWeight: 600 }}>Nenhum movimento pendente</div>
            <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)' }}>Sem extratos importados ou todos já conciliados.</div>
          </div>
        ) : (
          <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'rgba(61,35,20,0.04)' }}>
                  <th style={cellHeader}>Data</th>
                  <th style={cellHeader}>Descrição</th>
                  <th style={{ ...cellHeader, textAlign: 'right' }}>Valor</th>
                  <th style={cellHeader}>Natureza</th>
                  <th style={cellHeader}>Status</th>
                </tr>
              </thead>
              <tbody>
                {movimentos.map((m) => (
                  <tr key={m.id} style={{ borderTop: '0.5px solid rgba(61,35,20,0.08)' }}>
                    <td style={cell}>{m.data_transacao}</td>
                    <td style={cell}>{m.descricao ?? '—'}</td>
                    <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: m.valor < 0 ? '#A32D2D' : '#3B6D11', fontWeight: 600 }}>
                      R$ {fmt(m.valor)}
                    </td>
                    <td style={cell}>{m.natureza ?? '—'}</td>
                    <td style={cell}>
                      <span style={{ background: '#FAEEDA', color: '#854F0B', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4 }}>
                        {m.status ?? 'pendente'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

const cellHeader: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 16px',
  fontSize: 11,
  color: 'rgba(61,35,20,0.55)',
  textTransform: 'uppercase',
  letterSpacing: 0.8,
  fontWeight: 600,
}

const cell: React.CSSProperties = {
  padding: '12px 16px',
  color: '#3D2314',
}
