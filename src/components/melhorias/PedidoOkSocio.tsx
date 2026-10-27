'use client'

// "O Code pede sua aprovação" — aparece na tela do chamado SÓ para o sócio dono do agente (o banco decide:
// fn_agente_ok_socio_pendente devolve null para qualquer outro usuário). Aprovar/Recusar grava o OK do sócio na caixa
// (fn_agente_ok_socio, só auth.uid() = sócio do agente); sem ele o Code não posta a resposta ao cliente.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Pedido = { mensagem_id: string; agente: string; texto: string; pedido_em: string }

export default function PedidoOkSocio({ sugestaoId }: { sugestaoId: string }) {
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const { data } = await supabase.rpc('fn_agente_ok_socio_pendente', { p_sugestao: sugestaoId })
    setPedido((data as Pedido | null) ?? null)
  }, [sugestaoId])
  useEffect(() => { void carregar() }, [carregar])

  const decidir = async (decisao: 'aprovado' | 'recusado') => {
    if (!pedido) return
    setEnviando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_agente_ok_socio', { p_mensagem_id: pedido.mensagem_id, p_decisao: decisao })
    setEnviando(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setErro(r?.erro ?? error?.message ?? 'falhou'); return }
    setPedido(null)
  }

  if (!pedido) return null
  return (
    <div data-testid="pedido-ok-socio" style={{ marginBottom: 10, background: '#FFF8E6', border: '1px solid #C8941A', borderRadius: 10, padding: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#3D2314', marginBottom: 4 }}>O Code pede sua aprovação</div>
      <div style={{ fontSize: 12.5, color: '#3D2314', whiteSpace: 'pre-wrap', marginBottom: 8 }}>{pedido.texto}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button disabled={enviando} onClick={() => void decidir('aprovado')} style={{ background: '#166534', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Aprovar</button>
        <button disabled={enviando} onClick={() => void decidir('recusado')} style={{ background: '#B42318', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Recusar</button>
      </div>
      {erro && <div style={{ fontSize: 11, color: '#B42318', marginTop: 6 }}>{erro}</div>}
    </div>
  )
}
