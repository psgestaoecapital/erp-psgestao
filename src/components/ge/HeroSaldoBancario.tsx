'use client'

const COLORS = {
  espresso: '#3D2314',
  offWhite: '#FAF7F2',
  dourado: '#C8941A',
  douradoSoft: '#FFF8E7',
}

function fmt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface Props {
  total: number | null
  qtdContas: number | null
  loading?: boolean
}

export default function HeroSaldoBancario({ total, qtdContas, loading }: Props) {
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
  return (
    <div style={containerStyle}>
      <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600, marginBottom: 8 }}>
        Saldo bancário
      </div>
      <div style={{ fontSize: 36, fontWeight: 700, color: COLORS.espresso, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
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
