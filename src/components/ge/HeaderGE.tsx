'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface Props {
  companyId: string
  companyName: string
  userName: string
}

const COLORS = {
  espresso: '#3D2314',
  offWhite: '#FAF7F2',
  dourado: '#C8941A',
}

export default function HeaderGE({ companyId, companyName: _companyName, userName }: Props) {
  const router = useRouter()
  const [nba, setNba] = useState<{ titulo?: string; texto?: string; sem_plano?: boolean } | null>(null)

  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data } = await supabase.rpc('fn_ge_next_best_action', { p_company_id: companyId })
      if (!ignore) setNba(data as typeof nba)
    })()
    return () => { ignore = true }
  }, [companyId])

  const hoje = new Date()
  const diaSemana = hoje.toLocaleDateString('pt-BR', { weekday: 'long' })
  const dataExt = hoje.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })
  const hora = hoje.getHours()
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'

  const semPlano = nba?.sem_plano === true

  return (
    <>
      <div style={{ background: COLORS.espresso, padding: '14px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ color: COLORS.dourado, fontSize: 18, fontWeight: 500, fontFamily: 'Fraunces, Georgia, serif' }}>
            PS Gestão
          </div>
          <div style={{ width: 1, height: 28, background: 'rgba(250,247,242,0.2)' }} />
          <div>
            <div style={{ color: COLORS.offWhite, fontSize: 14, fontWeight: 500 }}>
              Gestão Empresarial
            </div>
            <div style={{ color: 'rgba(250,247,242,0.65)', fontSize: 11, marginTop: 2 }}>
              {saudacao}, {userName} · {diaSemana}, {dataExt}
            </div>
          </div>
        </div>
      </div>

      {!semPlano && (
        <div style={{ background: '#FFFFFF', borderBottom: '0.5px solid rgba(61,35,20,0.1)', padding: '12px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 240 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: COLORS.dourado, flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: COLORS.espresso, fontWeight: 500 }}>
              {nba?.titulo ?? 'Tudo em dia'}
            </span>
            <span style={{ fontSize: 13, color: 'rgba(61,35,20,0.6)' }}>·</span>
            <span style={{ fontSize: 13, color: 'rgba(61,35,20,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 600 }}>
              {nba?.texto ?? 'Carregando…'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <BotaoAcao label="Despesa" onClick={() => router.push('/dashboard/contas-pagar/nova')} />
            <BotaoAcao label="Receita" onClick={() => router.push('/dashboard/contas-receber/nova')} />
            <BotaoAcao label="NFSe" onClick={() => router.push('/dashboard/nfse/nova')} destaque />
          </div>
        </div>
      )}
    </>
  )
}

function BotaoAcao({ label, onClick, destaque = false }: { label: string; onClick: () => void; destaque?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: destaque ? COLORS.dourado : 'transparent',
        color: COLORS.espresso,
        border: destaque ? 'none' : '0.5px solid rgba(61,35,20,0.25)',
        padding: '6px 14px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      + {label}
    </button>
  )
}
