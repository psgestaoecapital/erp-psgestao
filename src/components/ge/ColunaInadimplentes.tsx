'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface Inad {
  cliente_id: string | null
  nome: string
  iniciais: string
  dias_atraso: number
  valor_total: number
  qtd_lancamentos: number
}
interface Data {
  sem_plano?: boolean
  top?: Inad[]
  qtd_total_clientes_atrasados?: number
}

function fmt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ColunaInadimplentes({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [data, setData] = useState<Data | null>(null)

  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data: result } = await supabase.rpc('fn_ge_top_inadimplentes', { p_company_id: companyId, p_limit: 3 })
      if (!ignore) setData(result as Data)
    })()
    return () => { ignore = true }
  }, [companyId])

  if (!data || data.sem_plano) return null
  const top = data.top ?? []

  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
          Maiores inadimplentes
        </span>
        {(data.qtd_total_clientes_atrasados ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => router.push('/dashboard/contas-receber?filtro=vencido')}
            style={{ background: 'transparent', border: 'none', color: '#C8941A', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
          >
            Ver todos ({data.qtd_total_clientes_atrasados})
          </button>
        )}
      </div>

      {top.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px 0', color: 'rgba(61,35,20,0.5)' }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>✓</div>
          <div style={{ fontSize: 13 }}>Sem clientes em atraso</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {top.map((c, i) => (
            <button
              key={`${c.cliente_id ?? 'sem-id'}-${i}`}
              type="button"
              onClick={() => router.push(c.cliente_id ? `/dashboard/contas-receber?cliente_id=${c.cliente_id}` : '/dashboard/contas-receber?filtro=vencido')}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 6px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit', borderRadius: 6 }}
            >
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#F2E9D8', color: '#3D2314', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                {c.iniciais || '?'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#3D2314', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nome || 'Sem nome'}</div>
                <div style={{ fontSize: 11, color: '#A32D2D' }}>Atrasado {c.dias_atraso} dias · {c.qtd_lancamentos} lanç.</div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#A32D2D', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>R$ {fmt(c.valor_total)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
