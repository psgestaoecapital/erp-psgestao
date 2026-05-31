'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface Data {
  sem_plano?: boolean
  tipo?: 'cobranca' | 'pagamento' | 'conciliacao' | 'estavel'
  titulo?: string
  texto?: string
  cta_principal?: string
  cta_secundario?: string
  rota_principal?: string
  rota_secundaria?: string
}

export default function BlocoConsultorIA({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [data, setData] = useState<Data | null>(null)

  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data: result } = await supabase.rpc('fn_ge_next_best_action', { p_company_id: companyId })
      if (!ignore) setData(result as Data)
    })()
    return () => { ignore = true }
  }, [companyId])

  if (!data || data.sem_plano) return null

  return (
    <div style={{ background: '#3D2314', borderRadius: 12, padding: '22px 24px', marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div aria-hidden style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(200,148,26,0.18)', color: '#C8941A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 20 }}>
          💡
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 10, color: '#C8941A', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600, marginBottom: 6 }}>
            {data.titulo}
          </div>
          <div style={{ fontSize: 14, color: '#FAF7F2', lineHeight: 1.55, marginBottom: 14 }}>
            {data.texto}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {data.cta_principal && data.rota_principal && (
              <button
                type="button"
                onClick={() => router.push(data.rota_principal!)}
                style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                {data.cta_principal}
              </button>
            )}
            {data.cta_secundario && data.rota_secundaria && (
              <button
                type="button"
                onClick={() => router.push(data.rota_secundaria!)}
                style={{ background: 'transparent', color: '#FAF7F2', border: '0.5px solid rgba(250,247,242,0.3)', padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                {data.cta_secundario}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
