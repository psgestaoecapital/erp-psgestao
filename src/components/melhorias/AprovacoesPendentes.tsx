'use client'

// "Aprovações pendentes" — todos os pedidos de OK que os Codes fizeram ao sócio logado (ligados ou não a um chamado).
// O banco decide quem vê: fn_agente_ok_socio_lista devolve [] para qualquer outro usuário.
// #6697/eea07e63 (CEO 12/11): para quem É aprovador, quando não há nada pendente, mostrar "Nada esperando você ✓"
// em vez de sumir — assim o sócio sabe que o bloco existe e está vazio. Quem NÃO é aprovador segue sem ver o bloco.
// Distinção via guarda existente fn__eh_aprovador_pr() (boolean, EXECUTE p/ authenticated) — sem RPC nova.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

type Item = { mensagem_id: string; agente: string; texto: string; pedido_em: string; sugestao_id: string | null; chamado_numero: number | null }

export default function AprovacoesPendentes() {
  const [itens, setItens] = useState<Item[]>([])
  const [ehAprovador, setEhAprovador] = useState<boolean | null>(null)
  const [enviando, setEnviando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const [listaRes, aprovRes] = await Promise.all([
      supabase.rpc('fn_agente_ok_socio_lista'),
      supabase.rpc('fn__eh_aprovador_pr'),
    ])
    setItens(Array.isArray(listaRes.data) ? (listaRes.data as Item[]) : [])
    // Em qualquer falha, trata como NÃO aprovador (bloco oculto) — nunca mostra vazio a quem não deveria ver.
    setEhAprovador(aprovRes.data === true)
  }, [])
  useEffect(() => { void carregar() }, [carregar])

  const decidir = async (id: string, decisao: 'aprovado' | 'recusado') => {
    setEnviando(id); setErro(null)
    const { data, error } = await supabase.rpc('fn_agente_ok_socio', { p_mensagem_id: id, p_decisao: decisao })
    setEnviando(null)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setErro(r?.erro ?? error?.message ?? 'falhou'); return }
    await carregar()
  }

  // Enquanto carrega (null) ou se não é aprovador: bloco oculto — comportamento de sempre p/ não-aprovadores.
  if (ehAprovador !== true) return null

  // É aprovador, mas nada pendente: tranquiliza em vez de sumir (antes o bloco desaparecia e parecia faltar algo).
  if (itens.length === 0) {
    return (
      <section data-testid="aprovacoes-pendentes-vazio" style={{ margin: '16px 0', background: '#F3F7F2', border: '1px solid #CFE3CC', borderRadius: 12, padding: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden style={{ color: '#166534', fontSize: 16, fontWeight: 700 }}>✓</span>
        <span style={{ fontSize: 14, color: '#245c2b', fontWeight: 600 }}>Nada esperando você</span>
        <span style={{ fontSize: 12.5, color: '#4a6b4e' }}>Nenhuma aprovação pendente no momento.</span>
      </section>
    )
  }

  return (
    <section data-testid="aprovacoes-pendentes" style={{ margin: '16px 0', background: '#FFF8E6', border: '1px solid #C8941A', borderRadius: 12, padding: 14 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 8px', color: '#3D2314' }}>
        Aprovações pendentes <span data-testid="aprovacoes-contador" style={{ background: '#C8941A', color: '#fff', borderRadius: 10, padding: '1px 8px', fontSize: 12 }}>{itens.length}</span>
      </h2>
      <div style={{ display: 'grid', gap: 10 }}>
        {itens.map((it) => (
          <div key={it.mensagem_id} style={{ background: '#fff', border: '1px solid #E8D9B0', borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#8A6A12', marginBottom: 4 }}>
              {it.chamado_numero ? `Chamado #${it.chamado_numero}` : 'Sem chamado ligado'} · pedido de {it.agente}
            </div>
            <div style={{ fontSize: 13, color: '#3D2314', whiteSpace: 'pre-wrap', marginBottom: 8 }}>{it.texto}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button disabled={enviando === it.mensagem_id} onClick={() => void decidir(it.mensagem_id, 'aprovado')} style={{ background: '#166534', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Aprovar</button>
              <AjudaCampo chave="aprovacoes.aprovar" rota="/dashboard/melhorias" />
              <button disabled={enviando === it.mensagem_id} onClick={() => void decidir(it.mensagem_id, 'recusado')} style={{ background: '#B42318', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Recusar</button>
              <AjudaCampo chave="aprovacoes.recusar" rota="/dashboard/melhorias" />
            </div>
          </div>
        ))}
      </div>
      {erro && <div style={{ fontSize: 12, color: '#B42318', marginTop: 6 }}>{erro}</div>}
    </section>
  )
}
