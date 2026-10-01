'use client'
// #728 (R.R · CEO aprovou 01/10) · cancelar orçamento ou pedido na tela Vender e Faturar.
// Motivo obrigatório: um motivo da lista da empresa OU um texto (empresa sem lista escreve o motivo).
// As travas são do BANCO (fn_pedido_cancelar / fn_orcamento_cancelar) — nota emitida, parcela já recebida, boleto
// registrado e pedido já faturado voltam como mensagem e aparecem aqui como estão. Nada é apagado (RD-30).
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Motivo = { id: string; nome: string; exige_descricao: boolean }

export default function CancelarVendaModal({ tipo, id, numero, companyId, onClose, onCancelado }: {
  tipo: 'pedido' | 'orcamento'
  id: string
  numero: string | null
  companyId: string
  onClose: () => void
  onCancelado: () => void | Promise<void>
}) {
  const [motivos, setMotivos] = useState<Motivo[]>([])
  const [motivoId, setMotivoId] = useState('')
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    void (async () => {
      const { data } = await supabase.from('erp_motivo_perda').select('id,nome,exige_descricao')
        .eq('company_id', companyId).eq('ativo', true).order('ordem', { ascending: true, nullsFirst: false })
      if (vivo) setMotivos((data as Motivo[] | null) ?? [])
    })()
    return () => { vivo = false }
  }, [companyId])

  const motivoSel = motivos.find((m) => m.id === motivoId) ?? null
  const textoOk = texto.trim().length >= 5
  const podeConfirmar = !enviando && (motivoSel ? (!motivoSel.exige_descricao || texto.trim().length > 0) : textoOk)
  const rotulo = tipo === 'pedido' ? 'pedido' : 'orçamento'

  async function confirmar() {
    setEnviando(true); setErro(null)
    const fn = tipo === 'pedido' ? 'fn_pedido_cancelar' : 'fn_orcamento_cancelar'
    const args = tipo === 'pedido'
      ? { p_pedido_id: id, p_motivo_perda_id: motivoId || null, p_motivo_texto: texto.trim() || null }
      : { p_orcamento_id: id, p_motivo_perda_id: motivoId || null, p_motivo_texto: texto.trim() || null }
    const { data, error } = await supabase.rpc(fn, args)
    setEnviando(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error) { setErro(error.message); return }
    if (!r?.ok) { setErro(r?.erro ?? `Não foi possível cancelar o ${rotulo}.`); return }
    await onCancelado()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} data-testid="cancelar-venda-modal"
        style={{ background: '#FAF7F2', borderRadius: 12, width: 'min(480px, 100%)', padding: 20, display: 'flex', flexDirection: 'column', gap: 12, color: '#3D2314' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Cancelar {rotulo} {numero ?? ''}</h3>
        <p style={{ margin: 0, fontSize: 12, color: '#3D2314B3' }}>
          {tipo === 'pedido'
            ? 'As parcelas em aberto deste pedido também serão canceladas. Nada é apagado: o pedido fica como "cancelado", com o motivo no histórico.'
            : 'O orçamento fica como "cancelado", com o motivo no histórico. Nada é apagado.'}
        </p>
        {motivos.length > 0 && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            Motivo
            <select value={motivoId} onChange={(e) => setMotivoId(e.target.value)} data-testid="cancelar-venda-motivo"
              style={{ border: '1px solid #3D231426', borderRadius: 6, padding: '6px 8px', fontSize: 13, background: '#fff' }}>
              <option value="">— descrever abaixo —</option>
              {motivos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </label>
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          {motivoSel ? (motivoSel.exige_descricao ? 'Descreva o que aconteceu (obrigatório)' : 'Detalhe (opcional)') : 'Motivo do cancelamento (obrigatório)'}
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} data-testid="cancelar-venda-texto"
            placeholder="Ex.: cliente desistiu do serviço"
            style={{ border: '1px solid #3D231426', borderRadius: 6, padding: '6px 8px', fontSize: 13, resize: 'vertical' }} />
        </label>
        {erro && <div data-testid="cancelar-venda-erro" style={{ fontSize: 12, color: '#791F1F', background: '#F7E1E1', borderRadius: 6, padding: '8px 10px' }}>{erro}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={enviando} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #3D231426', background: '#fff', cursor: 'pointer', fontSize: 13 }}>Voltar</button>
          <button onClick={() => void confirmar()} disabled={!podeConfirmar} data-testid="cancelar-venda-confirmar"
            style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: podeConfirmar ? '#791F1F' : '#791F1F66', color: '#fff', cursor: podeConfirmar ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600 }}>
            {enviando ? 'Cancelando…' : `Cancelar ${rotulo}`}
          </button>
        </div>
      </div>
    </div>
  )
}
