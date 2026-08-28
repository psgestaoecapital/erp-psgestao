'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// FIN-R1 · lista de contas com a ORIGEM do saldo (lido × calculado × —). Fonte única:
// fn_saldos_empresa. saldo_atual saiu da tela; conta bancária sem leitura mostra "—", nunca R$ 0,00.
interface Conta {
  id: string
  nome: string
  tipo_conta: string | null
  categoria: 'banco' | 'caixa' | 'cartao'
  saldo: number | null
  saldo_origem: 'lido' | 'sem_dado' | 'manual'
  saldo_extrato_em: string | null
  saldo_extrato_origem: string | null
  conciliacoes_pendentes: number
}
interface Data {
  sem_plano?: boolean
  sem_acesso?: boolean
  contas?: Conta[]
}

const CINZA = 'rgba(61,35,20,0.45)'

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function badge(c: Conta): { txt: string; cor: string } {
  if (c.categoria !== 'banco') return { txt: '✎ manual', cor: CINZA }
  if (c.saldo_origem === 'lido') {
    const q = c.saldo_extrato_origem === 'api_sicoob' ? 'Sicoob'
      : c.saldo_extrato_origem === 'ofx' ? 'OFX'
      : c.saldo_extrato_origem === 'api_pluggy' ? 'Pluggy' : 'extrato'
    return { txt: `✅ lido do ${q}`, cor: '#3B6D11' }
  }
  return { txt: '— sem leitura de extrato', cor: CINZA }
}
const CAT_LABEL: Record<string, string> = { banco: '🏦 Bancárias', caixa: '💵 Caixa', cartao: '💳 Cartões' }

export default function ColunaContas({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [data, setData] = useState<Data | null>(null)

  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data: result } = await supabase.rpc('fn_saldos_empresa', { p_company_ids: [companyId] })
      if (!ignore) setData(result as Data)
    })()
    return () => { ignore = true }
  }, [companyId])

  if (!data || data.sem_plano || data.sem_acesso) return null

  const contas = data.contas ?? []
  const ordem: Array<'banco' | 'caixa' | 'cartao'> = ['banco', 'caixa', 'cartao']

  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
          Contas financeiras
        </span>
        <button
          type="button"
          onClick={() => router.push('/dashboard/cadastros/contas-bancarias')}
          aria-label="Adicionar conta"
          style={{ background: 'none', border: 'none', color: '#C8941A', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
        >
          +
        </button>
      </div>

      {contas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'rgba(61,35,20,0.5)' }}>
          <div style={{ fontSize: 13, marginBottom: 12 }}>Nenhuma conta cadastrada</div>
          <button
            type="button"
            onClick={() => router.push('/dashboard/cadastros/contas-bancarias')}
            style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            Cadastrar primeira conta
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {ordem.map((cat) => {
            const grupo = contas.filter((c) => c.categoria === cat)
            if (grupo.length === 0) return null
            return (
              <div key={cat}>
                <div style={{ fontSize: 10.5, color: CINZA, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, marginBottom: 6 }}>
                  {CAT_LABEL[cat]}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {grupo.map((c) => {
                    const b = badge(c)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => router.push(`/dashboard/conciliacao?conta_id=${c.id}`)}
                        style={{ padding: '10px 12px', border: '0.5px solid rgba(61,35,20,0.1)', borderRadius: 8, cursor: 'pointer', background: 'white', textAlign: 'left', font: 'inherit' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#3D2314', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nome}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: c.saldo === null ? CINZA : '#3D2314', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmt(c.saldo)}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontSize: 10.5, color: b.cor }}>{b.txt}</span>
                          {c.conciliacoes_pendentes > 0 ? (
                            <span style={{ fontSize: 11, color: '#C8941A' }}>⚠ {c.conciliacoes_pendentes} pend.</span>
                          ) : null}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
