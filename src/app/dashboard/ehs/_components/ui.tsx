// Compartilhado entre as páginas de compliance.
'use client'

import { authFetch } from '@/lib/authFetch'

export const C = {
  espresso: '#3D2314',
  offwhite: '#FAF7F2',
  gold: '#C8941A',
  beigeLt: '#f5f0e8',
  borderLt: '#ece3d2',
  ink: '#1a1a1a',
  muted: 'rgba(61, 35, 20, 0.55)',
  green: '#2d6a3e',
  greenBg: '#e8f3ec',
  amber: '#8a6a10',
  amberBg: '#fdf4e0',
  red: '#a02020',
  redBg: '#fce8e8',
  gray: '#6b6b6b',
  grayBg: '#efece6',
  // "Não se aplica" — neutro fora do semáforo de performance
  neutral: '#9B9B9B',
  neutralBg: '#f5efe2',
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = (status ?? 'nao_emitido').toString()
  const map: Record<string, { bg: string; fg: string; label: string; dot: string }> = {
    valido: { bg: C.greenBg, fg: C.green, label: 'Válido', dot: '🟢' },
    vencendo: { bg: C.amberBg, fg: C.amber, label: 'Vencendo', dot: '🟡' },
    vencido: { bg: C.redBg, fg: C.red, label: 'Vencido', dot: '🔴' },
    nao_emitido: { bg: C.grayBg, fg: C.gray, label: 'Não emitido', dot: '⚫' },
    nao_se_aplica: { bg: C.neutralBg, fg: C.neutral, label: 'Não se aplica', dot: '⊘' },
    sem_validade: { bg: C.greenBg, fg: C.green, label: 'Sem validade', dot: '🟢' },
  }
  const d = map[s] || { bg: C.grayBg, fg: C.gray, label: s, dot: '⚫' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, backgroundColor: d.bg, color: d.fg }}>
      {d.dot} {d.label}
    </span>
  )
}

export async function baixarDocumento(documentoId: string): Promise<void> {
  try {
    const res = await authFetch(`/api/compliance/documentos/${documentoId}`)
    const j = await res.json()
    if (!j.ok || !j.signed_url) {
      alert(j.error || 'Não foi possível gerar o link de download')
      return
    }
    window.open(j.signed_url, '_blank', 'noopener')
  } catch (e: any) {
    alert(e.message)
  }
}
