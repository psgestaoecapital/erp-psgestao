'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface Conta {
  id: string
  nome: string
  tipo_conta: string | null
  saldo_atual: number
  conciliacoes_pendentes: number
}
interface Data {
  sem_plano?: boolean
  saldo_total: number
  qtd_contas: number
  contas?: Conta[]
}

function fmt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ColunaContas({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [data, setData] = useState<Data | null>(null)

  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data: result } = await supabase.rpc('fn_ge_contas_resumo', { p_company_id: companyId })
      if (!ignore) setData(result as Data)
    })()
    return () => { ignore = true }
  }, [companyId])

  if (!data || data.sem_plano) return null

  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
          Contas financeiras
        </span>
        <button
          type="button"
          onClick={() => router.push('/dashboard/contas-bancarias/nova')}
          aria-label="Adicionar conta"
          style={{ background: 'none', border: 'none', color: '#C8941A', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
        >
          +
        </button>
      </div>

      <div style={{ fontSize: 26, fontWeight: 600, color: '#3D2314', fontVariantNumeric: 'tabular-nums', marginBottom: 14 }}>
        R$ {fmt(data.saldo_total)}
      </div>

      {data.qtd_contas === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'rgba(61,35,20,0.5)' }}>
          <div style={{ fontSize: 13, marginBottom: 12 }}>Nenhuma conta cadastrada</div>
          <button
            type="button"
            onClick={() => router.push('/dashboard/contas-bancarias/nova')}
            style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            Cadastrar primeira conta
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.contas?.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => router.push(`/dashboard/conciliacao?conta_id=${c.id}`)}
              style={{ padding: '10px 12px', border: '0.5px solid rgba(61,35,20,0.1)', borderRadius: 8, cursor: 'pointer', background: 'white', textAlign: 'left', font: 'inherit' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#3D2314', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nome}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#3D2314', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>R$ {fmt(c.saldo_atual)}</span>
              </div>
              {c.conciliacoes_pendentes > 0 ? (
                <div style={{ fontSize: 11, color: '#C8941A' }}>⚠ {c.conciliacoes_pendentes} conciliações pendentes</div>
              ) : (
                <div style={{ fontSize: 11, color: '#3B6D11' }}>✓ Sem pendências</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
