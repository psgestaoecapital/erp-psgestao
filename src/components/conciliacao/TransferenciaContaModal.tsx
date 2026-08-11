'use client'

// Conciliar um movimento bancário como TRANSFERÊNCIA entre contas (item 3 Jordana · Onda 1).
// Caso: cheque entra no Caixa; ao depositar, credita na Sicredi (+R$4.270). Não é receita/despesa
// (zero no DRE), só muda o saldo por conta. Chama fn_conciliacao_transferir(mov, contraparte, desc).
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Props {
  open: boolean
  onClose: () => void
  onConciliado: () => void
  companyId: string
  movimentoId: string
  descricao?: string | null
  valor: number
  natureza: 'credito' | 'debito' | null
}

type Conta = { id: string; nome: string; banco: string | null }

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERM = '#A32D2D'
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function TransferenciaContaModal({ open, onClose, onConciliado, companyId, movimentoId, descricao, valor, natureza }: Props) {
  const [contas, setContas] = useState<Conta[]>([])
  const [contraparte, setContraparte] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContraparte(''); setDesc(''); setErro(null)
    supabase.from('erp_banco_contas').select('id, nome, banco').eq('company_id', companyId).eq('ativo', true).order('nome')
      .then(({ data }) => setContas((data as Conta[] | null) ?? []))
  }, [open, companyId])

  if (!open) return null

  const entrou = natureza === 'credito' || valor > 0   // crédito = dinheiro ENTROU na conta do movimento
  const contaSel = contas.find((c) => c.id === contraparte)
  const nomeContra = contaSel ? `${contaSel.nome}${contaSel.banco ? ` · ${contaSel.banco}` : ''}` : '—'
  // direção pro rótulo (origem → destino), do ponto de vista das contas
  const direcao = entrou ? `${contaSel?.nome ?? 'origem'} → conta do movimento` : `conta do movimento → ${contaSel?.nome ?? 'destino'}`

  async function confirmar() {
    if (!contraparte) { setErro('Escolha a conta contraparte.'); return }
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_conciliacao_transferir', {
      p_movimento_id: movimentoId, p_conta_contraparte_id: contraparte, p_descricao: desc.trim() || null,
    })
    setBusy(false)
    if (error) { setErro(error.message); return }
    const j = data as { ok?: boolean; erro?: string } | null
    if (!j?.ok) { setErro(j?.erro ?? 'Não foi possível registrar a transferência.'); return }
    onConciliado()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 460, width: '100%' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>🔄 Transferência entre contas</div>
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, color: ESP, margin: '2px 0 4px' }}>{brl(Math.abs(valor))}</h2>
        <p style={{ fontSize: 12, color: MUT, marginTop: 0, marginBottom: 14 }}>{descricao || '(sem descrição)'}</p>

        <div style={{ background: BG, border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: ESP, marginBottom: 12 }}>
          {entrou
            ? 'Este movimento é um CRÉDITO (dinheiro entrou nesta conta). A contraparte é a conta de ORIGEM (de onde saiu).'
            : 'Este movimento é um DÉBITO (dinheiro saiu desta conta). A contraparte é a conta de DESTINO (para onde foi).'}
          <div style={{ marginTop: 4, color: MUT }}>Não é receita nem despesa — só muda o saldo entre as contas.</div>
        </div>

        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ fontSize: 10, color: MUT, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, display: 'block', marginBottom: 4 }}>Conta contraparte</span>
          <select value={contraparte} onChange={(e) => setContraparte(e.target.value)} style={inp}>
            <option value="">— escolha a conta —</option>
            {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.banco ? ` · ${c.banco}` : ''}</option>)}
          </select>
          {contraparte && <span style={{ fontSize: 11, color: '#2E7D32', display: 'block', marginTop: 4 }}>Transferência: {direcao} ({nomeContra})</span>}
        </label>

        <label style={{ display: 'block', marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: MUT, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, display: 'block', marginBottom: 4 }}>Descrição (opcional)</span>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ex.: depósito de cheque" style={inp} />
        </label>

        {erro && <div style={{ background: '#FCEBEB', color: VERM, padding: '8px 12px', borderRadius: 6, fontSize: 12, marginTop: 8 }}>{erro}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy} style={{ background: 'transparent', color: ESP, border: `0.5px solid ${LINE}`, padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>Cancelar</button>
          <button onClick={confirmar} disabled={busy || !contraparte} style={{ background: (busy || !contraparte) ? 'rgba(200,148,26,0.5)' : GOLD, color: '#3D2314', border: 'none', padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: (busy || !contraparte) ? 'not-allowed' : 'pointer' }}>
            {busy ? 'Registrando…' : 'Conciliar como transferência'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inp: React.CSSProperties = { width: '100%', background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 6, padding: '9px 10px', fontSize: 13, color: ESP, fontFamily: 'inherit', boxSizing: 'border-box' }
