'use client'

// SPEC PM-1 · Configurações do Sistema (P&M). PR-A entrega a aba ALERTAS (régua do semáforo).
// As demais abas (Funil, Listas, Proposta, Comissão) chegam no PR-C. Motor único: crm_alerta_config
// alimenta o mesmo fn_crm_semaforo do kanban de leads e do Hub (RD-52).

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
const VERDE = '#16A34A', VERM = '#B91C1C'

type Aba = 'alertas' | 'funil' | 'listas' | 'proposta' | 'comissao'
const ABAS: { id: Aba; label: string; pronta: boolean }[] = [
  { id: 'alertas', label: '🚦 Alertas e prazos', pronta: true },
  { id: 'funil', label: '🔀 Funil', pronta: false },
  { id: 'listas', label: '📋 Listas', pronta: false },
  { id: 'proposta', label: '📄 Proposta', pronta: false },
  { id: 'comissao', label: '💰 Comissão', pronta: false },
]

export default function PMConfiguracoesPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [aba, setAba] = useState<Aba>('alertas')

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 18px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>P&amp;M · Configurações</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: ESP, margin: '2px 0 14px' }}>Configurações do Sistema</h1>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {ABAS.map((a) => (
            <button key={a.id} type="button" disabled={!a.pronta} onClick={() => a.pronta && setAba(a.id)}
              title={a.pronta ? undefined : 'Em breve'}
              style={{
                fontSize: 12.5, fontWeight: 600, padding: '7px 12px', borderRadius: 9, cursor: a.pronta ? 'pointer' : 'default',
                border: `1px solid ${aba === a.id ? GOLD : LINE}`,
                background: aba === a.id ? '#FFF8E7' : '#FFF', color: a.pronta ? ESP : MUT, opacity: a.pronta ? 1 : 0.6,
              }}>
              {a.label}{!a.pronta && ' · em breve'}
            </button>
          ))}
        </div>

        {aba === 'alertas' && <AbaAlertas empresa={empresa} />}
      </div>
    </div>
  )
}

// ── Aba Alertas: régua do semáforo do funil de leads (amarelo/vermelho) ──────────
function AbaAlertas({ empresa }: { empresa: string | null }) {
  const [rowId, setRowId] = useState<string | null>(null)
  const [amarelo, setAmarelo] = useState(7)
  const [vermelho, setVermelho] = useState(10)
  const [salvo, setSalvo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const carregar = useCallback(async () => {
    if (!empresa) return
    setMsg('')
    const { data } = await supabase.from('crm_alerta_config')
      .select('id, dias_amarelo, dias_vermelho')
      .eq('company_id', empresa).eq('funil', 'leads').is('etapa', null).maybeSingle()
    if (data) {
      setRowId(data.id as string); setAmarelo(data.dias_amarelo as number); setVermelho(data.dias_vermelho as number); setSalvo(true)
    } else {
      setRowId(null); setAmarelo(7); setVermelho(10); setSalvo(false)
    }
  }, [empresa])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  async function salvar() {
    if (!empresa) return
    if (vermelho < amarelo) { setMsg('Erro: o vermelho deve ser maior ou igual ao amarelo.'); return }
    if (amarelo < 1 || vermelho < 1) { setMsg('Erro: os prazos precisam ser de pelo menos 1 dia.'); return }
    setBusy(true); setMsg('')
    let error
    if (salvo && rowId) {
      ({ error } = await supabase.from('crm_alerta_config')
        .update({ dias_amarelo: amarelo, dias_vermelho: vermelho, atualizado_em: new Date().toISOString() })
        .eq('id', rowId))
    } else {
      ({ error } = await supabase.from('crm_alerta_config')
        .insert({ company_id: empresa, funil: 'leads', etapa: null, dias_amarelo: amarelo, dias_vermelho: vermelho }))
    }
    setBusy(false)
    if (error) { setMsg('Erro: ' + error.message); return }
    setMsg('✅ Régua salva. O kanban de leads já reflete (sem recarregar a página).')
    void carregar()
  }

  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 13, color: ESP, fontWeight: 700, marginBottom: 4 }}>Prazos do funil de leads</div>
      <div style={{ fontSize: 12, color: MUT, marginBottom: 14 }}>
        Quantos dias um lead pode ficar parado numa etapa antes de virar âmbar (atenção) e vermelho (atrasado).
        Vale para todas as etapas.
      </div>

      {!salvo && (
        <div style={{ fontSize: 11.5, color: ESP, background: '#FFF8E7', border: `0.5px solid ${GOLD}`, borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>
          Ainda usando o padrão do sistema (amarelo 3 · vermelho 7). Salve abaixo para aplicar a sua régua.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <label style={{ display: 'block' }}>
          <span style={{ fontSize: 11, color: MUT, fontWeight: 600, display: 'block', marginBottom: 4 }}>Dias para âmbar (atenção)</span>
          <input type="number" min={1} value={amarelo} onChange={(e) => setAmarelo(Math.max(1, Number(e.target.value) || 1))} style={inp} />
        </label>
        <label style={{ display: 'block' }}>
          <span style={{ fontSize: 11, color: MUT, fontWeight: 600, display: 'block', marginBottom: 4 }}>Dias para vermelho (atrasado)</span>
          <input type="number" min={1} value={vermelho} onChange={(e) => setVermelho(Math.max(1, Number(e.target.value) || 1))} style={inp} />
        </label>
      </div>

      {msg && <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, fontSize: 12.5, background: msg.startsWith('Erro') ? '#FBEAEA' : '#EAF5EE', color: msg.startsWith('Erro') ? VERM : VERDE, border: `0.5px solid ${LINE}` }}>{msg}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button onClick={() => void salvar()} disabled={busy || !empresa}
          style={{ fontSize: 13, fontWeight: 700, color: ESP, background: GOLD, border: 'none', borderRadius: 9, padding: '9px 18px', opacity: (busy || !empresa) ? 0.6 : 1, cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? 'Salvando…' : 'Salvar régua'}
        </button>
      </div>
    </div>
  )
}

const inp: React.CSSProperties = { width: '100%', fontSize: 14, padding: '8px 10px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#FFF', color: ESP, boxSizing: 'border-box', fontFamily: 'inherit' }
