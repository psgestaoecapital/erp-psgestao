'use client'

import { useRouter } from 'next/navigation'

function fmt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface Props {
  qtd: number
  valorEstimado: number
}

export default function CardConciliacoesPendentes({ qtd, valorEstimado }: Props) {
  const router = useRouter()
  if (!qtd || qtd <= 0) return null

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push('/dashboard/financeiro/conciliacao')}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push('/dashboard/financeiro/conciliacao') } }}
      style={{
        background: '#FFF8E7',
        border: '1px solid #C8941A',
        borderLeft: '4px solid #C8941A',
        borderRadius: 12,
        padding: '14px 18px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        cursor: 'pointer',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flexShrink: 0, fontSize: 22 }} aria-hidden>⚠️</div>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#3D2314' }}>
          <strong>{qtd}</strong> lançamento{qtd === 1 ? '' : 's'} aguardando conciliação
        </div>
        <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.65)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
          Valor estimado: R$ {fmt(valorEstimado)}
        </div>
      </div>
      <div style={{
        background: '#C8941A',
        color: '#3D2314',
        padding: '6px 14px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}>
        Conciliar agora →
      </div>
    </div>
  )
}
