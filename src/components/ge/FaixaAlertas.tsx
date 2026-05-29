'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Alerta {
  id: string
  tipo: string | null
  severidade: 'critica' | 'alta' | 'media' | 'baixa' | string | null
  titulo: string
  mensagem: string | null
  link_acao: string | null
  criado_em?: string | null
}

interface Props {
  companyId: string
}

const ESTILOS_SEVERIDADE: Record<string, { bg: string; border: string; icon: string; color: string }> = {
  critica: { bg: '#FEE2E2', border: '#DC2626', icon: '🔴', color: '#7F1D1D' },
  alta: { bg: '#FEF3C7', border: '#F59E0B', icon: '🟡', color: '#854D0E' },
  media: { bg: '#FFFFFF', border: '#9CA3AF', icon: 'ℹ️', color: '#3D2314' },
  baixa: { bg: '#FFFFFF', border: '#D1D5DB', icon: '·', color: '#3D2314' },
}

export default function FaixaAlertas({ companyId }: Props) {
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId) return
    let ignore = false
    setLoading(true)
    ;(async () => {
      await supabase.rpc('fn_alertas_gerar_automaticos', { p_company_id: companyId })
      const { data } = await supabase
        .from('v_alertas_ativos')
        .select('id, tipo, severidade, titulo, mensagem, link_acao, criado_em')
        .eq('company_id', companyId)
      if (!ignore) {
        setAlertas((data ?? []) as Alerta[])
        setLoading(false)
      }
    })()
    return () => { ignore = true }
  }, [companyId])

  if (loading) return null

  if (alertas.length === 0) {
    return (
      <div style={{
        background: '#DCFCE7',
        color: '#166534',
        padding: '10px 28px',
        fontSize: 13,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        ✅ Tudo em dia · sem ações urgentes detectadas
      </div>
    )
  }

  return (
    <div style={{ background: '#FFFFFF', borderBottom: '0.5px solid rgba(61,35,20,0.1)', padding: '10px 20px' }}>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
        {alertas.map((a) => {
          const estilo = ESTILOS_SEVERIDADE[a.severidade ?? 'media'] ?? ESTILOS_SEVERIDADE.media
          const conteudo = (
            <div style={{
              background: estilo.bg,
              border: `1px solid ${estilo.border}`,
              borderRadius: 8,
              padding: '10px 14px',
              minWidth: 280,
              maxWidth: 360,
              flexShrink: 0,
              color: estilo.color,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span aria-hidden>{estilo.icon}</span>
                <span>{a.titulo}</span>
              </div>
              {a.mensagem && (
                <small style={{ display: 'block', fontSize: 11, color: 'rgba(0,0,0,0.65)', lineHeight: 1.4 }}>{a.mensagem}</small>
              )}
            </div>
          )
          if (a.link_acao) {
            return (
              <a key={a.id} href={a.link_acao} style={{ textDecoration: 'none', display: 'block' }}>
                {conteudo}
              </a>
            )
          }
          return <div key={a.id}>{conteudo}</div>
        })}
      </div>
    </div>
  )
}
