'use client'

import { useRouter } from 'next/navigation'

const ATALHOS: Array<{ icone: string; label: string; rota: string }> = [
  { icone: '📋', label: 'Lançamentos', rota: '/dashboard/lancamentos' },
  { icone: '💰', label: 'A Pagar', rota: '/dashboard/contas-pagar' },
  { icone: '📈', label: 'A Receber', rota: '/dashboard/contas-receber' },
  { icone: '🔄', label: 'Conciliar', rota: '/dashboard/conciliacao' },
  { icone: '📥', label: 'Importar', rota: '/dashboard/importer-universal' },
  { icone: '📊', label: 'Relatórios', rota: '/dashboard/relatorios' },
]

export default function AtalhosRapidos() {
  const router = useRouter()
  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
      {ATALHOS.map((a) => (
        <button
          key={a.label}
          type="button"
          onClick={() => router.push(a.rota)}
          style={{ background: 'transparent', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, padding: '12px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer' }}
        >
          <div style={{ fontSize: 20 }} aria-hidden>{a.icone}</div>
          <span style={{ fontSize: 11, color: '#3D2314', fontWeight: 600 }}>{a.label}</span>
        </button>
      ))}
    </div>
  )
}
