'use client'
// CEO 05/10: o Code de um sócio pede aprovação antes de responder um chamado do escopo dele.
// A RPC só devolve pedidos para o sócio dono do agente (auth.uid = socio_user_id); para os demais vem vazio e o bloco some.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Pedido = { mensagem_id: string; agente: string; pedido: string }

export default function PedidoOkSocio({ chamadoId }: { chamadoId: string }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const carregar = useCallback(async () => {
    const { data } = await supabase.rpc('fn_agente_ok_socio_pendentes', { p_chamado: chamadoId })
    setPedidos((data as Pedido[] | null) ?? [])
  }, [chamadoId])
  useEffect(() => { void carregar() }, [carregar])

  async function decidir(id: string, decisao: 'aprovado' | 'recusado') {
    setEnviando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_agente_ok_socio', { p_mensagem_id: id, p_decisao: decisao })
    setEnviando(false)
    if (error || !(data as { ok?: boolean } | null)?.ok) { setErro('Não foi possível registrar a sua decisão. Tente de novo.'); return }
    await carregar()
  }

  if (pedidos.length === 0) return null
  return (
    <div data-testid="pedido-ok-socio" style={{ marginTop: 10, padding: 12, borderRadius: 8, background: '#FFF7E0', border: '1px solid #E8D28A' }}>
      {pedidos.map((p) => (
        <div key={p.mensagem_id} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>O Code pede sua aprovação:</div>
          <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', margin: '4px 0 8px' }}>{p.pedido}</div>
          <button disabled={enviando} onClick={() => void decidir(p.mensagem_id, 'aprovado')}
            style={{ marginRight: 8, padding: '6px 14px', borderRadius: 6, border: 'none', background: '#2E7D32', color: '#fff', cursor: 'pointer' }}>Aprovar</button>
          <button disabled={enviando} onClick={() => void decidir(p.mensagem_id, 'recusado')}
            style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#B3261E', color: '#fff', cursor: 'pointer' }}>Recusar</button>
        </div>
      ))}
      {erro && <div style={{ fontSize: 12, color: '#B3261E' }}>{erro}</div>}
    </div>
  )
}
