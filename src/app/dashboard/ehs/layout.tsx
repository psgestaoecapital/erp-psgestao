'use client'

// Guarda de rota EHS (Tarefa 0 · CEO 14/11) — defesa em profundidade sobre o gate do menu
// (fn_modulos_sidebar_por_area). Se a empresa selecionada não contratou o módulo (pausas/documentacao/
// completo) da rota EHS aberta, redireciona pro hub /dashboard/ehs. O isolamento PRIMÁRIO é o gate do
// menu no servidor + a RLS das tabelas; esta guarda só evita acesso por URL direta a uma tela que a
// empresa não contratou. Em consolidado/grupo (sem empresa única) nada é gateado aqui.

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

export default function EhsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || ''
  const { sel } = useCompanyIds()
  const router = useRouter()
  const [estado, setEstado] = useState<'checando' | 'ok' | 'bloqueado'>('ok')

  useEffect(() => {
    let cancelado = false
    const empresa = sel && sel !== 'consolidado' && !sel.startsWith('group_') ? sel : null
    if (!empresa || !pathname.startsWith('/dashboard/ehs')) { setEstado('ok'); return }
    supabase
      .rpc('fn_ehs_rota_permitida', { p_company_id: empresa, p_rota: pathname })
      .then(({ data, error }) => {
        if (cancelado) return
        // falha transitória: não trava a tela — o gate do menu no servidor + a RLS são o primário
        if (error) { setEstado('ok'); return }
        setEstado(data === false ? 'bloqueado' : 'ok')
      })
    return () => { cancelado = true }
  }, [pathname, sel])

  useEffect(() => {
    if (estado !== 'bloqueado') return
    const t = setTimeout(() => router.replace('/dashboard/ehs'), 1200)
    return () => clearTimeout(t)
  }, [estado, router])

  if (estado === 'bloqueado') {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#FAF7F2' }}>
        <div style={{ textAlign: 'center', maxWidth: 440 }}>
          <p style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, color: '#3D2314', margin: '0 0 8px' }}>
            Módulo não contratado
          </p>
          <p style={{ fontSize: 14, color: 'rgba(61,35,20,0.6)', margin: 0 }}>
            Esta tela faz parte de um módulo EHS que esta empresa não contratou. Redirecionando para a área de EHS…
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
