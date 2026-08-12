'use client'

// F2 · "Registrar em cartão": prévia (fn_cartao_calcular) → confirma (fn_cartao_registrar_recebimento).
// Baixa o cliente + cria o recebível da adquirente (líquido, vence no repasse) + lança a taxa como
// despesa financeira. Líquido/taxa/repasse vêm do cadastro (RD-52), nunca digitados.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.6)', GREEN = '#16A34A', RED = '#B91C1C'
const brl = (n: number) => Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Adquirente = { id: string; nome: string }
type Calc = { ok: boolean; erro?: string; taxa_percentual?: number; valor_taxa?: number; valor_liquido?: number; prazo_repasse_dias?: number; data_repasse?: string }

export default function CartaoRecebimentoModal({ companyId, receber, onClose, onSucesso }: {
  companyId: string
  receber: { id: string; descricao: string; valor: number; cliente?: string | null }
  onClose: () => void
  onSucesso: (msg: string) => void
}) {
  const [adquirentes, setAdquirentes] = useState<Adquirente[]>([])
  const [adq, setAdq] = useState('')
  const [bandeira, setBandeira] = useState('Visa')
  const [modalidade, setModalidade] = useState('debito')
  const [parcelas, setParcelas] = useState('1')
  const [prev, setPrev] = useState<Calc | null>(null)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const { data } = await supabase.rpc('fn_cartao_adquirente_listar', { p_company_id: companyId })
    const list = ((data as { adquirentes?: Adquirente[] } | null)?.adquirentes) ?? []
    setAdquirentes(list)
    setAdq((a) => a || list[0]?.id || '')
  }, [companyId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  // prévia sempre que os parâmetros mudam (e há adquirente)
  const previa = useCallback(async () => {
    if (!adq) { setPrev(null); return }
    const { data, error } = await supabase.rpc('fn_cartao_calcular', {
      p_company_id: companyId, p_adquirente_id: adq, p_bandeira: bandeira, p_modalidade: modalidade,
      p_parcelas: Number(parcelas) || 1, p_valor: receber.valor,
    })
    if (error) { setPrev({ ok: false, erro: error.message }); return }
    setPrev(data as Calc)
  }, [companyId, adq, bandeira, modalidade, parcelas, receber.valor])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void previa() }, [previa])

  async function confirmar() {
    if (!adq) { setErro('Selecione a adquirente.'); return }
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_cartao_registrar_recebimento', {
      p_company_id: companyId, p_receber_id: receber.id, p_adquirente_id: adq,
      p_bandeira: bandeira, p_modalidade: modalidade, p_parcelas: Number(parcelas) || 1,
    })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || r?.ok === false) {
      setErro(r?.erro === 'taxa_nao_cadastrada'
        ? 'Taxa não cadastrada para essa bandeira/modalidade/parcelas. Cadastre em Cartões / Adquirentes.'
        : (error?.message || r?.erro || 'falha ao registrar'))
      return
    }
    onSucesso('Recebimento em cartão REGISTRADO.')
  }

  const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '7px 9px', border: `1px solid ${LINE}`, borderRadius: 6, fontSize: 13, background: '#fff', color: ESP }
  const lbl: React.CSSProperties = { fontSize: 11, color: ESP60, display: 'block', marginBottom: 3 }
  const adqNome = adquirentes.find((a) => a.id === adq)?.nome ?? 'a adquirente'

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1200 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 460, padding: 20, border: `0.5px solid ${LINE}`, maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: ESP }}>💳 Registrar em cartão</div>
        <div style={{ fontSize: 12, color: ESP60, margin: '2px 0 14px' }}>{receber.descricao} · <b>R$ {brl(receber.valor)}</b></div>

        {adquirentes.length === 0 && (
          <div style={{ fontSize: 12.5, color: '#7A5A0F', background: '#FBF4E4', border: `0.5px solid ${GOLD}55`, borderRadius: 8, padding: 10, marginBottom: 12 }}>
            Nenhuma adquirente cadastrada. Cadastre em <b>Cartões / Adquirentes</b> (Financeiro) antes de registrar.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Adquirente</label>
            <select style={inp} value={adq} onChange={(e) => setAdq(e.target.value)}>
              <option value="">—</option>
              {adquirentes.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Bandeira</label><input style={inp} value={bandeira} onChange={(e) => setBandeira(e.target.value)} /></div>
          <div><label style={lbl}>Modalidade</label><select style={inp} value={modalidade} onChange={(e) => setModalidade(e.target.value)}><option value="debito">debito</option><option value="credito">credito</option></select></div>
          <div><label style={lbl}>Parcelas</label><input style={inp} type="number" value={parcelas} onChange={(e) => setParcelas(e.target.value)} /></div>
        </div>

        {/* PRÉVIA */}
        <div style={{ marginTop: 12 }}>
          {prev?.ok ? (
            <div style={{ padding: 12, borderRadius: 8, background: '#EAF5EE', border: `0.5px solid ${GREEN}55`, fontSize: 13, color: ESP, lineHeight: 1.5 }}>
              Cliente quita <b>R$ {brl(receber.valor)}</b>. {adqNome} repassa <b>R$ {brl(prev.valor_liquido ?? 0)}</b> em {prev.data_repasse ? new Date(prev.data_repasse + 'T00:00:00').toLocaleDateString('pt-BR') : '—'} (D+{prev.prazo_repasse_dias}). Taxa <b>R$ {brl(prev.valor_taxa ?? 0)}</b> ({brl(prev.taxa_percentual ?? 0)}%) vira despesa financeira.
            </div>
          ) : prev && prev.ok === false ? (
            <div style={{ padding: 10, borderRadius: 8, background: '#FEECEC', color: RED, fontSize: 12.5 }}>
              {prev.erro === 'taxa_nao_cadastrada' ? 'Taxa não cadastrada para essa bandeira/modalidade/parcelas — cadastre em Cartões / Adquirentes.' : `Erro na prévia: ${prev.erro}`}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: ESP60, background: BG, borderRadius: 8, padding: 10 }}>Escolha a adquirente e os parâmetros para ver a prévia.</div>
          )}
        </div>

        {erro && <div style={{ marginTop: 10, fontSize: 12.5, color: RED }}>❌ {erro}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'transparent', color: ESP60, border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={() => void confirmar()} disabled={busy || !prev?.ok} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: (busy || !prev?.ok) ? 'not-allowed' : 'pointer', opacity: (busy || !prev?.ok) ? 0.5 : 1 }}>{busy ? 'Registrando…' : 'Confirmar'}</button>
        </div>
      </div>
    </div>
  )
}
