'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const COLORS = {
  espresso: '#3D2314',
  offWhite: '#FAF7F2',
  dourado: '#C8941A',
  douradoSoft: '#FFF8E7',
  vermelho: '#A32D2D',
}

function fmt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// FASE 2 · fonte ÚNICA de saldo: lê fn_ge_contas_resumo (a MESMA RPC do
// ColunaContas) — antes vinha de fn_psgc_painel_operacional, que dava um número
// fantasma (-15.238,97 / "1 conta") divergente do resto da tela. Agora o Hero e
// as Contas Financeiras batem sempre.
export default function HeroSaldoBancario({ companyId }: { companyId: string }) {
  const [total, setTotal] = useState<number | null>(null)
  const [qtdContas, setQtdContas] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId) return
    let ignore = false
    setLoading(true)
    ;(async () => {
      const { data } = await supabase.rpc('fn_ge_contas_resumo', { p_company_id: companyId })
      if (!ignore) {
        const d = data as { saldo_total?: number; qtd_contas?: number } | null
        setTotal(d?.saldo_total ?? 0)
        setQtdContas(d?.qtd_contas ?? 0)
        setLoading(false)
      }
    })()
    return () => { ignore = true }
  }, [companyId])

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)' }}>Carregando saldo…</div>
      </div>
    )
  }
  if (!qtdContas || qtdContas === 0) {
    return (
      <div style={containerStyle}>
        <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600, marginBottom: 6 }}>
          Saldo bancário
        </div>
        <div style={{ fontSize: 14, color: COLORS.espresso, opacity: 0.7 }}>
          Cadastre uma conta bancária pra ver seu saldo aqui.
        </div>
      </div>
    )
  }
  const negativo = (total ?? 0) < 0
  return (
    <div style={containerStyle}>
      <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600, marginBottom: 8 }}>
        Saldo bancário
      </div>
      <div style={{ fontSize: 36, fontWeight: 700, color: negativo ? COLORS.vermelho : COLORS.espresso, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
        R$ {fmt(total)}
      </div>
      <div style={{ fontSize: 13, color: 'rgba(61,35,20,0.65)', marginTop: 6 }}>
        Total em {qtdContas} {qtdContas === 1 ? 'conta bancária' : 'contas bancárias'}
      </div>
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  background: COLORS.douradoSoft,
  border: `1px solid ${COLORS.dourado}`,
  borderRadius: 14,
  padding: '20px 24px',
  marginBottom: 16,
}
