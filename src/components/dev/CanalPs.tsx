'use client'
// Canal PS (CEO 07/10 16:20) na aba Codes:
//  • "Esperando OK do CEO": pedidos de núcleo dos sócios (requer_ok_ceo sem OK); os que o sócio marcou com pedir_ok_ceo
//    vêm primeiro. O OK continua só pelo Eng. Chefe (fn_agente_mensagem_ok_ceo) — aqui é só para o CEO ver.
//  • "Conectar a minha Claude": URL do conector MCP do ERP e o passo a passo do conector personalizado.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { quando } from '@/lib/dev/painelCodes'

const ESP = '#3D2314', OFF = '#FAF7F2', DOU = '#C8941A', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F'

type Nucleo = { id: string; para: string; de: string; assunto: string | null; criado_em: string; ok_ceo_pedido_em: string | null }

export function EsperandoOkCeo() {
  const [itens, setItens] = useState<Nucleo[]>([])
  const [agora, setAgora] = useState(() => new Date())
  const carregar = useCallback(async () => {
    const { data } = await supabase.from('erp_agente_mensagem').select('id,para,de,assunto,criado_em,ok_ceo_pedido_em')
      .eq('requer_ok_ceo', true).is('ok_ceo_em', null).not('arquivada', 'is', true).like('de', '%-chat')
      .order('ok_ceo_pedido_em', { ascending: false, nullsFirst: false }).order('criado_em', { ascending: true }).limit(50)
    setItens((data ?? []) as Nucleo[]); setAgora(new Date())
  }, [])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const agendar = (ms = 600) => { if (timer) clearTimeout(timer); timer = setTimeout(() => { void carregar() }, ms) }
    agendar(0)
    const ch = supabase.channel('dev-codes-ok-ceo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'erp_agente_mensagem' }, () => agendar())
      .subscribe()
    return () => { if (timer) clearTimeout(timer); void supabase.removeChannel(ch) }
  }, [carregar])
  if (itens.length === 0) return null
  return (
    <div data-testid="codes-ok-ceo" style={{ background: BRANCO, border: `1px solid ${BD}`, borderLeft: `4px solid ${DOU}`, borderRadius: 12, padding: 12, marginBottom: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Esperando OK do CEO · {itens.length}</div>
      {itens.map((m) => (
        <div key={m.id} data-testid={`ok-ceo-${m.id}`} style={{ fontSize: 13, display: 'flex', gap: 6, flexWrap: 'wrap', padding: '3px 0' }}>
          <span style={{ color: TXM }}>{quando(m.criado_em, agora)}</span>
          <b>{m.para}</b>
          <span>{m.assunto}</span>
          {m.ok_ceo_pedido_em && <span style={{ fontSize: 11, color: DOU, fontWeight: 700 }}>pediu o OK {quando(m.ok_ceo_pedido_em, agora)}</span>}
        </div>
      ))}
      <div style={{ fontSize: 11, color: TXM, marginTop: 6 }}>O OK é registrado pelo Eng. Chefe (fn_agente_mensagem_ok_ceo); com ele, o Code é acionado na hora.</div>
    </div>
  )
}

export function ConectarClaude() {
  const [aberto, setAberto] = useState(false)
  // só aparece depois do clique (aberto), então ler a origem no primeiro render não causa diferença de hidratação
  const [url] = useState(() => (typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : '/api/mcp'))
  const [copiado, setCopiado] = useState(false)
  return (
    <div data-testid="conectar-claude" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 14, padding: 14, marginTop: 16 }}>
      <button onClick={() => setAberto(!aberto)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: ESP, fontWeight: 700, fontSize: 15, fontFamily: 'inherit' }}>
        {aberto ? '▾' : '▸'} Conectar a minha Claude (Canal PS)
      </button>
      {aberto && (
        <div style={{ fontSize: 13, marginTop: 10, display: 'grid', gap: 10 }}>
          <div>Com o conector, a sua Claude lê os chamados da <b>sua carteira</b>, manda tarefas ao <b>seu</b> Code e acompanha as respostas — como você, com o seu login do ERP.</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <code data-testid="conectar-claude-url" style={{ background: OFF, border: `1px solid ${BD}`, borderRadius: 8, padding: '6px 10px', wordBreak: 'break-all' }}>{url}</code>
            <button onClick={() => { void navigator.clipboard?.writeText(url).then(() => setCopiado(true)) }}
              style={{ background: ESP, color: OFF, border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>{copiado ? 'Copiado' : 'Copiar'}</button>
          </div>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
            <li>Na Claude (claude.ai ou app), abra <b>Configurações › Conectores</b>.</li>
            <li>Clique em <b>Adicionar conector personalizado</b>.</li>
            <li>Nome: <b>Canal PS</b>. URL: a de cima. Salve.</li>
            <li>Clique em <b>Conectar</b>: abre a tela do ERP — entre com o <b>seu</b> usuário e clique em <b>Permitir</b>.</li>
            <li>Numa conversa, ative o Canal PS e peça, por exemplo: “liste meus chamados abertos” ou “mande ao meu Code: …”.</li>
          </ol>
          <div style={{ fontSize: 12, color: TXM }}>
            Ferramentas: meus_chamados, ler_chamado, enviar_tarefa_ao_meu_code, respostas_do_meu_code, minhas_prs, pedir_ok_ceo.
            Cada chamada fica registrada; limite de 20 por minuto e 200 por hora por pessoa. Pedido de núcleo espera o OK do CEO.
          </div>
        </div>
      )}
    </div>
  )
}
