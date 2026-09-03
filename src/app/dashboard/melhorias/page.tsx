'use client'

// Central de Melhorias · Fase 1 — tela do usuário. Registra a dificuldade com foto MARCADA.
// A foto + marcação vivem no componente compartilhado FotoMarcador (mesma peça do compositor de
// resposta — RD-52: não forka). A IA analisa a foto no envio (edge sugestao-analisar, que JÁ lê
// marcacoes), mas a sugestão vale mesmo se a IA falhar (§3). Foto é OPCIONAL (decisão do CEO).
//
// Chamado é CONVERSA (03/09): cada sugestão abre um histórico de ida e volta (ConversaChamado). O autor
// pode mandar foto nova sem encerrar — o chamado volta pra fila PS. Confirmar (funcionou/não) segue
// como ação SEPARADA, não como única saída.

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import FotoMarcador, { type FotoSel, type Marca } from '@/components/melhorias/FotoMarcador'
import ConversaChamado from '@/components/melhorias/ConversaChamado'
import { uploadFotoSugestao } from '@/lib/sugestaoUpload'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC', blue: '#2F5AA8',
}
const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none' }
const CATS = [['bug', '🐞 Bug'], ['melhoria', '💡 Melhoria'], ['duvida', '❓ Dúvida'], ['erro_dado', '📊 Erro de dado']]
const PRIOS = ['baixa', 'media', 'alta', 'critica']
const STAT_LABEL: Record<string, string> = { nova: 'Nova', em_analise: 'Em análise', aceita: 'Aceita', em_desenvolvimento: 'Em desenvolvimento', concluida: 'Concluída', recusada: 'Recusada', duplicada: 'Duplicada', arquivada: 'Arquivada', implementado: 'Implementado' }
// status terminais: o trabalho acabou. Não faz sentido o selo "não analisada pela IA" nesses — eles
// parecem pendentes de processamento quando estão completos (o que confundia, ex.: a do Rodrigo já
// implementada aparecendo como "não analisada").
const STATUS_TERMINAL = ['concluida', 'concluido', 'resolvida', 'recusada', 'duplicada', 'arquivada', 'implementado']

type Minha = { id: string; titulo: string | null; descricao: string; categoria: string | null; status: string; resposta: string | null; resposta_aprovada: boolean; confirmado_pelo_autor: boolean; tem_ia?: boolean; ia_analise: Record<string, unknown> | null; created_at: string }

export default function MelhoriasPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const searchParams = useSearchParams()
  // rota #5: se o usuário chegou pelo ícone do cabeçalho, a rota anterior vem no ?from — assim ele
  // não precisa explicar onde estava. Fallback: a própria tela de melhorias.
  const rotaOrigem = (searchParams.get('from') || '').trim() || '/dashboard/melhorias'

  const [f, setF] = useState({ categoria: 'bug', titulo: '', descricao: '', prioridade: 'media' })
  const [foto, setFoto] = useState<FotoSel>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [minhas, setMinhas] = useState<Minha[]>([])
  const [verArquivadas, setVerArquivadas] = useState(false)
  const [ehSuporte, setEhSuporte] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [conversaAberta, setConversaAberta] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)
    const { data: u } = await supabase.from('users').select('system_role').eq('id', user.id).maybeSingle()
    setEhSuporte(['PS_ADMIN', 'PS_SUPPORT'].includes((u as { system_role?: string } | null)?.system_role || ''))
    // Arquivadas saem da lista por padrão (viram consulta via filtro), como o CEO pediu.
    let q = supabase.from('sugestoes').select('id,titulo,descricao,categoria,status,resposta,resposta_aprovada,confirmado_pelo_autor,ia_analise,created_at').eq('user_id', user.id)
    q = verArquivadas ? q.eq('status', 'arquivada') : q.neq('status', 'arquivada')
    const { data } = await q.order('created_at', { ascending: false }).limit(50)
    setMinhas(((data as Minha[]) ?? []).map((m) => ({ ...m, tem_ia: !!m.ia_analise, resposta: m.resposta_aprovada ? m.resposta : null })))
  }, [verArquivadas])
  useEffect(() => { void carregar() }, [carregar])

  // O AUTOR confirma se a resposta resolveu. Funcionou → concluida; não → reabre com motivo (RD-38:
  // quem diz que resolveu é quem abriu, não o merge). É AÇÃO SEPARADA da conversa — mandar foto nova
  // não é "não resolveu"; encerrar é uma decisão explícita.
  const confirmar = useCallback(async (id: string, funcionou: boolean) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    let motivo: string | null = null
    if (!funcionou) {
      motivo = window.prompt('O que ainda não resolveu? (obrigatório — a equipe volta a mexer)') || ''
      if (!motivo.trim()) { setErro('Diga o que não resolveu para reabrir.'); return }
    }
    const { data, error } = await supabase.rpc('fn_sugestao_confirmar', { p_id: id, p_user: user.id, p_funcionou: funcionou, p_motivo: motivo })
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha ao confirmar'); return }
    setMsg(funcionou ? 'Que bom! Chamado concluído. 🎉' : 'Reabrimos — a equipe volta a trabalhar nisso.')
    void carregar()
  }, [carregar])

  // COLAR (Ctrl+V) em qualquer lugar do formulário → vira a foto do anexo (mesmo destino do FotoMarcador).
  const onPasteFoto = useCallback((e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData?.items || []).find((it) => it.type.startsWith('image/'))
    if (!item) return
    const blob = item.getAsFile(); if (!blob) return
    e.preventDefault()
    const ext = (blob.type.split('/')[1] || 'png').split('+')[0]
    setFoto({ file: new File([blob], `print-${Date.now()}.${ext}`, { type: blob.type }), marcas: [] })
    setMsg('Print colado. Marque onde está o problema.')
  }, [])

  async function enviar() {
    if (!companyId) { setErro('Selecione uma empresa específica no topo.'); return }
    if (!f.descricao.trim()) { setErro('Descreva a dificuldade.'); return }
    setBusy(true); setErro(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setErro('Sessão expirada.'); setBusy(false); return }

      let anexos: { storage_path: string; marcacoes: Marca[] }[] = []
      if (foto) {
        const path = await uploadFotoSugestao(foto.file, user.id).catch((e) => { setErro('Falha ao enviar a foto: ' + String(e)); return null })
        if (path === null) { setBusy(false); return }
        anexos = [{ storage_path: path, marcacoes: foto.marcas }]
      }

      const { data, error } = await supabase.rpc('fn_sugestao_criar', {
        p_company_id: companyId,
        p_sugestao: { tipo: f.categoria === 'melhoria' ? 'melhoria' : 'bug', titulo: f.titulo.trim() || null, descricao: f.descricao.trim(), prioridade: f.prioridade, categoria: f.categoria, rota: rotaOrigem, area: selInfo.tipo === 'empresa' ? 'gestao_empresarial' : null },
        p_anexos: anexos,
        p_user: user.id,
      })
      const r = data as { ok?: boolean; id?: string; erro?: string } | null
      if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha ao registrar'); setBusy(false); return }

      // dispara a IA sem bloquear (se falhar, a sugestão continua válida)
      void supabase.functions.invoke('sugestao-analisar', { body: { sugestao_id: r.id } }).catch(() => {})

      setF({ categoria: 'bug', titulo: '', descricao: '', prioridade: 'media' }); setFoto(null)
      setMsg('Sugestão registrada. A IA vai analisar em instantes.'); void carregar()
    } finally { setBusy(false) }
  }

  const podeEnviar = useMemo(() => !!companyId && !!f.descricao.trim() && !busy, [companyId, f.descricao, busy])

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 980, margin: '0 auto', color: C.esp }}
      onPaste={onPasteFoto}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>💡 Central de Melhorias</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Registrar uma dificuldade</h1>
        </div>
        {ehSuporte && <a href="/dashboard/atendimento" style={{ fontSize: 13, color: C.white, background: C.esp, padding: '8px 14px', borderRadius: 8, textDecoration: 'none', fontWeight: 700 }}>Ir para a fila de atendimento →</a>}
      </div>
      <p style={{ color: C.espM, fontSize: 13, margin: '6px 0 4px' }}>Cole um print (Ctrl+V), arraste a imagem ou use a câmera — marque onde está o problema e descreva. A foto é opcional. Nada some — vira uma sugestão que a gente trabalha até concluir.</p>
      {rotaOrigem !== '/dashboard/melhorias' && (
        <p style={{ color: C.espL, fontSize: 12, margin: '0 0 12px' }}>Registrando a partir de <b style={{ color: C.espM }}>{rotaOrigem}</b> — a tela vai junto, você não precisa explicar onde estava.</p>
      )}

      {msg && <div style={{ background: C.greenBg, color: C.green, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }} onClick={() => setMsg(null)}>{msg}</div>}
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }} onClick={() => setErro(null)}>{erro}</div>}

      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={{ fontSize: 12, color: C.espM }}>Tipo
            <select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} style={{ ...inp, width: '100%', marginTop: 4 }}>{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label style={{ fontSize: 12, color: C.espM }}>Prioridade
            <select value={f.prioridade} onChange={(e) => setF({ ...f, prioridade: e.target.value })} style={{ ...inp, width: '100%', marginTop: 4 }}>{PRIOS.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          </label>
        </div>
        <input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="título curto (opcional)" style={{ ...inp, width: '100%', marginTop: 10, boxSizing: 'border-box' }} />
        <textarea value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} onPaste={onPasteFoto} placeholder="descreva a dificuldade — o que você tentou fazer e o que aconteceu (pode colar um print com Ctrl+V aqui)" rows={3} style={{ ...inp, width: '100%', marginTop: 10, boxSizing: 'border-box', resize: 'vertical' }} />

        {/* Foto + marcação: componente compartilhado (mesma peça do compositor de resposta) */}
        <div style={{ marginTop: 12 }}>
          <FotoMarcador value={foto} onChange={setFoto} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button disabled={!podeEnviar} onClick={() => void enviar()} style={{ padding: '9px 18px', border: 'none', borderRadius: 8, background: podeEnviar ? C.gold : C.espL, color: C.white, fontWeight: 700, cursor: podeEnviar ? 'pointer' : 'not-allowed' }}>{busy ? 'Enviando…' : 'Enviar sugestão'}</button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, margin: '4px 0 10px' }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{verArquivadas ? 'Sugestões arquivadas' : 'Minhas sugestões'}</h2>
        <button type="button" onClick={() => setVerArquivadas((v) => !v)} style={{ border: 'none', background: 'none', color: C.blue, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          {verArquivadas ? '← voltar às ativas' : 'ver arquivadas'}
        </button>
      </div>
      {minhas.length === 0 ? <div style={{ fontSize: 13, color: C.espL, fontStyle: 'italic' }}>{verArquivadas ? 'Nenhuma sugestão arquivada.' : 'Você ainda não abriu nenhuma.'}</div> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {minhas.map((m) => (
            <div key={m.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 14 }}>{m.titulo || m.descricao.slice(0, 60)}</b>
                <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: m.status === 'concluida' ? C.greenBg : m.status === 'recusada' ? C.redBg : C.cream, color: m.status === 'concluida' ? C.green : m.status === 'recusada' ? C.red : C.espM, fontWeight: 700 }}>{STAT_LABEL[m.status] || m.status}</span>
              </div>
              <div style={{ fontSize: 12.5, color: C.espM, marginTop: 4 }}>{m.descricao}</div>
              {/* A resposta só aparece ao autor DEPOIS de aprovada (§2.1) — em carregar já vem null se não aprovada. */}
              {m.resposta && (
                <div style={{ marginTop: 6, background: C.cream, padding: '8px 10px', borderRadius: 8 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: C.esp, textTransform: 'uppercase', letterSpacing: 0.4 }}>Resposta da equipe PS</div>
                  <div style={{ fontSize: 12.5, color: C.esp, marginTop: 3, whiteSpace: 'pre-wrap' }}>{m.resposta}</div>
                  {m.status !== 'concluida' && !m.confirmado_pelo_autor && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      <button onClick={() => void confirmar(m.id, true)} style={{ background: C.green, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Funcionou ✓</button>
                      <button onClick={() => void confirmar(m.id, false)} style={{ background: '#fff', color: C.red, border: `1px solid ${C.red}`, borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Ainda não resolveu</button>
                    </div>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setConversaAberta((c) => (c === m.id ? null : m.id))} style={{ border: 'none', background: 'none', color: C.blue, cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0 }}>
                  {conversaAberta === m.id ? '▲ fechar conversa' : '💬 conversar / mandar foto nova'}
                </button>
                <span style={{ fontSize: 10.5 }}>
                  {m.tem_ia
                    ? <span style={{ color: C.blue }}>🤖 análise da IA disponível ao atendente</span>
                    : (!STATUS_TERMINAL.includes(m.status) && <span style={{ color: C.espL }}>não analisada pela IA</span>)}
                </span>
              </div>
              {conversaAberta === m.id && userId && (
                <ConversaChamado sugestaoId={m.id} userId={userId} ehSuporte={ehSuporte} onAfterSend={carregar} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
