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
import { RespostaInline } from '@/components/melhorias/RespostaInline'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { type Marca } from '@/components/melhorias/FotoMarcador'
import FotosChamado, { type FotoItem } from '@/components/melhorias/FotosChamado'
import ConversaChamado from '@/components/melhorias/ConversaChamado'
import { uploadFotoSugestao } from '@/lib/sugestaoUpload'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC', blue: '#2F5AA8',
}
const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none' }
const CATS = [['bug', '🐞 Bug'], ['melhoria', '💡 Melhoria'], ['duvida', '❓ Dúvida'], ['erro_dado', '📊 Erro de dado']]
const PRIOS = ['baixa', 'media', 'alta', 'critica']
// data ABSOLUTA (dd/mm hh:mm) ao lado do número — "há N horas" não serve pra achar um chamado.
const quando = (iso: string | null) => { try { return iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '' } catch { return '' } }
const STAT_LABEL: Record<string, string> = { nova: 'Nova', em_analise: 'Em análise', aceita: 'Aceita', em_desenvolvimento: 'Em desenvolvimento', concluida: 'Concluída', recusada: 'Recusada', duplicada: 'Duplicada', arquivada: 'Arquivada', implementado: 'Implementado' }
// status terminais: o trabalho acabou. Não faz sentido o selo "não analisada pela IA" nesses — eles
// parecem pendentes de processamento quando estão completos (o que confundia, ex.: a do Rodrigo já
// implementada aparecendo como "não analisada").
const STATUS_TERMINAL = ['concluida', 'concluido', 'resolvida', 'recusada', 'duplicada', 'arquivada', 'implementado']
// #63 · abas da Central pela ótica do AUTOR (a Jordana): separar o que ESPERA a equipe do que
// PRECISA DELA (resposta chegou, falta ela dizer se resolveu) do que já ACABOU. Antes era lista plana.
type BucketMelhoria = 'precisa_voce' | 'aguardando' | 'concluidas'
const bucketMelhoria = (m: { status: string; resposta: string | null; confirmado_pelo_autor: boolean }): BucketMelhoria => {
  if (STATUS_TERMINAL.includes(m.status)) return 'concluidas'
  if (m.resposta && m.resposta.trim() && !m.confirmado_pelo_autor) return 'precisa_voce' // resposta aprovada chegou, falta confirmar
  return 'aguardando'
}

type Minha = { id: string; numero: number; titulo: string | null; descricao: string; categoria: string | null; status: string; resposta: string | null; resposta_aprovada: boolean; confirmado_pelo_autor: boolean; tem_ia?: boolean; ia_analise: Record<string, unknown> | null; created_at: string; company_id: string | null; empresa: string | null }

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
  // deep link do e-mail de aviso: /dashboard/melhorias?n=<numero> abre direto no chamado (rola + destaca)
  const focoNumero = (searchParams.get('n') || '').trim()

  const [f, setF] = useState({ categoria: 'bug', titulo: '', descricao: '', prioridade: 'media' })
  const [fotos, setFotos] = useState<FotoItem[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [minhas, setMinhas] = useState<Minha[]>([])
  const [verArquivadas, setVerArquivadas] = useState(false)
  const [ehSuporte, setEhSuporte] = useState(false)
  const [pendentesFila, setPendentesFila] = useState(0)   // rascunhos esperando aprovação (papel de plataforma)
  const [userId, setUserId] = useState<string | null>(null)
  const [conversaAberta, setConversaAberta] = useState<string | null>(null)
  const [motivoAberto, setMotivoAberto] = useState<string | null>(null) // #61 · qual chamado está com o textarea de "não resolveu"
  const [abaMelhoria, setAbaMelhoria] = useState<BucketMelhoria>('precisa_voce') // #63 · aba de status da Central
  const [foco, setFoco] = useState<string | null>(null)   // nº destacado ao chegar pelo link do e-mail

  const carregar = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)
    const { data: u } = await supabase.from('users').select('system_role').eq('id', user.id).maybeSingle()
    // PS_ADMIN_CVM é papel de plataforma (trabalha nas 10 empresas) — enxerga a fila de atendimento como PS_ADMIN.
    const sup = ['PS_ADMIN', 'PS_SUPPORT', 'PS_ADMIN_CVM'].includes((u as { system_role?: string } | null)?.system_role || '')
    setEhSuporte(sup)
    if (sup) {
      // quantos rascunhos estão esperando aprovação (para o atalho mostrar o número sem precisar abrir a fila)
      const { count } = await supabase.from('sugestoes').select('id', { count: 'exact', head: true })
        .not('resposta', 'is', null).eq('resposta_aprovada', false).not('status', 'in', '(arquivada,concluida)')
      setPendentesFila(count ?? 0)
    }
    // "Minhas sugestões" é por AUTOR (user_id), sem filtro de empresa — a RLS já permite ver as próprias
    // (user_id = auth.uid()), então papel de plataforma vê tudo que abriu nas 10 empresas. Mostramos de
    // QUAL empresa é cada uma (embed companies) — inclusive as antigas sem empresa (viram "Sem empresa").
    // Arquivadas saem da lista por padrão (viram consulta via filtro), como o CEO pediu.
    let q = supabase.from('sugestoes').select('id,numero,titulo,descricao,categoria,status,resposta,resposta_aprovada,confirmado_pelo_autor,ia_analise,created_at,company_id,companies(nome_fantasia,razao_social)').eq('user_id', user.id)
    q = verArquivadas ? q.eq('status', 'arquivada') : q.neq('status', 'arquivada')
    const { data } = await q.order('created_at', { ascending: false }).limit(50)
    type Row = Minha & { companies?: { nome_fantasia: string | null; razao_social: string | null } | { nome_fantasia: string | null; razao_social: string | null }[] | null }
    setMinhas(((data as Row[]) ?? []).map(({ companies, ...m }) => {
      const co = Array.isArray(companies) ? companies[0] : companies
      return { ...m, empresa: co?.nome_fantasia || co?.razao_social || null, tem_ia: !!m.ia_analise, resposta: m.resposta_aprovada ? m.resposta : null }
    }))
  }, [verArquivadas])
  useEffect(() => { void carregar() }, [carregar])

  // chegou pelo link do e-mail (?n=): rola até o chamado e o destaca por alguns segundos.
  useEffect(() => {
    if (!focoNumero || !minhas.length) return
    const el = document.getElementById('chamado-' + focoNumero)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFoco(focoNumero)
    const t = setTimeout(() => setFoco(null), 4000)
    return () => clearTimeout(t)
  }, [focoNumero, minhas])

  // O AUTOR confirma se a resposta resolveu. Funcionou → concluida; não → reabre com motivo (RD-38:
  // quem diz que resolveu é quem abriu, não o merge). É AÇÃO SEPARADA da conversa — mandar foto nova
  // não é "não resolveu"; encerrar é uma decisão explícita.
  // #61: "não resolveu" abre um textarea inline com rascunho (não mais window.prompt de 1 linha que
  // some ao trocar de janela). funcionou=true segue direto; funcionou=false exige o motivo do textarea.
  const confirmar = useCallback(async (id: string, funcionou: boolean, motivo?: string) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    if (!funcionou && !(motivo ?? '').trim()) { setErro('Diga o que não resolveu para reabrir.'); return }
    const { data, error } = await supabase.rpc('fn_sugestao_confirmar', { p_id: id, p_user: user.id, p_funcionou: funcionou, p_motivo: funcionou ? null : (motivo ?? '').trim() })
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha ao confirmar'); return }
    setMotivoAberto(null)
    setMsg(funcionou ? 'Que bom! Chamado concluído. 🎉' : 'Reabrimos — a equipe volta a trabalhar nisso.')
    void carregar()
  }, [carregar])

  async function enviar() {
    if (!companyId) { setErro('Selecione uma empresa específica no topo.'); return }
    if (!f.descricao.trim()) { setErro('Descreva a dificuldade.'); return }
    setBusy(true); setErro(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setErro('Sessão expirada.'); setBusy(false); return }

      // ordem da lista = ordem em sugestao_anexo.ordem (o servidor itera o array em sequência).
      const anexos: { storage_path: string; marcacoes: Marca[] }[] = []
      for (const ft of fotos) {
        const path = await uploadFotoSugestao(ft.file, user.id).catch((e) => { setErro('Falha ao enviar a foto: ' + String(e)); return null })
        if (path === null) { setBusy(false); return }
        anexos.push({ storage_path: path, marcacoes: ft.marcas })
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

      setF({ categoria: 'bug', titulo: '', descricao: '', prioridade: 'media' }); setFotos([])
      setMsg('Sugestão registrada. A IA vai analisar em instantes.'); void carregar()
    } finally { setBusy(false) }
  }

  const podeEnviar = useMemo(() => !!companyId && !!f.descricao.trim() && !busy, [companyId, f.descricao, busy])

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 980, margin: '0 auto', color: C.esp }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>💡 Central de Melhorias</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Registrar uma dificuldade</h1>
        </div>
        {ehSuporte && (
          <a href="/dashboard/atendimento" style={{ fontSize: 13, color: C.white, background: C.esp, padding: '8px 14px', borderRadius: 8, textDecoration: 'none', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            Ir para a fila de atendimento →
            {pendentesFila > 0 && <span title="rascunhos esperando você aprovar" style={{ background: C.gold, color: C.esp, borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 800 }}>{pendentesFila} p/ aprovar</span>}
          </a>
        )}
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
        <textarea value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="descreva a dificuldade — o que você tentou fazer e o que aconteceu" rows={3} style={{ ...inp, width: '100%', marginTop: 10, boxSizing: 'border-box', resize: 'vertical' }} />

        {/* Fotos + marcação: lista (até 10). Colar/arrastar/escolher ACRESCENTA, na ordem. */}
        <div style={{ marginTop: 12 }}>
          <FotosChamado value={fotos} onChange={setFotos} />
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
      {/* #63 · abas por status (só nas ativas) — a Jordana vê o que PRECISA dela separado do que espera a equipe */}
      {!verArquivadas && minhas.length > 0 && (() => {
        const cont = { precisa_voce: 0, aguardando: 0, concluidas: 0 }
        for (const m of minhas) cont[bucketMelhoria(m)]++
        return (
          <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap', borderBottom: `1px solid ${C.border}` }}>
            {([
              ['precisa_voce', '⭐ Precisa de você', cont.precisa_voce],
              ['aguardando', '🔵 Com a equipe', cont.aguardando],
              ['concluidas', '✓ Concluídas', cont.concluidas],
            ] as [BucketMelhoria, string, number][]).map(([k, label, n]) => (
              <button key={k} type="button" onClick={() => setAbaMelhoria(k)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '8px 13px', border: 'none', background: 'transparent', borderBottom: `2px solid ${abaMelhoria === k ? C.gold : 'transparent'}`, marginBottom: -1, fontSize: 12.5, fontWeight: abaMelhoria === k ? 800 : 600, color: abaMelhoria === k ? C.esp : C.espM }}>
                {label} <span style={{ fontSize: 11.5, fontWeight: 800, padding: '1px 7px', borderRadius: 999, background: abaMelhoria === k ? C.gold : C.cream, color: abaMelhoria === k ? '#fff' : C.espM }}>{n}</span>
              </button>
            ))}
          </div>
        )
      })()}
      {(() => {
        const lista = verArquivadas ? minhas : minhas.filter((m) => bucketMelhoria(m) === abaMelhoria)
        if (minhas.length === 0) return <div style={{ fontSize: 13, color: C.espL, fontStyle: 'italic' }}>{verArquivadas ? 'Nenhuma sugestão arquivada.' : 'Você ainda não abriu nenhuma.'}</div>
        if (lista.length === 0) return <div style={{ fontSize: 13, color: C.espL, fontStyle: 'italic' }}>Nada nesta aba.</div>
        return (
        <div style={{ display: 'grid', gap: 8 }}>
          {lista.map((m) => (
            <div key={m.id} id={`chamado-${m.numero}`} style={{ background: C.white, border: `1px solid ${foco === String(m.numero) ? C.gold : C.border}`, borderRadius: 10, padding: 12, boxShadow: foco === String(m.numero) ? `0 0 0 2px ${C.gold}` : 'none', transition: 'box-shadow .3s, border-color .3s' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 14 }}><span style={{ color: C.gold, fontWeight: 800 }}>#{m.numero}</span> <span style={{ fontWeight: 600, fontSize: 11.5, color: C.espM }}>· {quando(m.created_at)}</span> {m.titulo || m.descricao.slice(0, 60)}</b>
                <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: m.status === 'concluida' ? C.greenBg : m.status === 'recusada' ? C.redBg : C.cream, color: m.status === 'concluida' ? C.green : m.status === 'recusada' ? C.red : C.espM, fontWeight: 700 }}>{STAT_LABEL[m.status] || m.status}</span>
              </div>
              {/* de qual empresa é o chamado (útil pra papel de plataforma, que abre nas 10 empresas) */}
              <div style={{ fontSize: 10.5, color: m.empresa ? C.espL : C.amber, marginTop: 2 }}>🏢 {m.empresa || 'Sem empresa (chamado antigo)'}</div>
              <div style={{ fontSize: 12.5, color: C.espM, marginTop: 4 }}>{m.descricao}</div>
              {/* A resposta só aparece ao autor DEPOIS de aprovada (§2.1) — em carregar já vem null se não aprovada. */}
              {m.resposta && (
                <div style={{ marginTop: 6, background: C.cream, padding: '8px 10px', borderRadius: 8 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: C.esp, textTransform: 'uppercase', letterSpacing: 0.4 }}>Resposta da equipe PS</div>
                  <div style={{ fontSize: 12.5, color: C.esp, marginTop: 3, whiteSpace: 'pre-wrap' }}>{m.resposta}</div>
                  {m.status !== 'concluida' && !m.confirmado_pelo_autor && (
                    <>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                        <button onClick={() => void confirmar(m.id, true)} style={{ background: C.green, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Funcionou ✓</button>
                        <button onClick={() => setMotivoAberto((v) => (v === m.id ? null : m.id))} style={{ background: '#fff', color: C.red, border: `1px solid ${C.red}`, borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Ainda não resolveu</button>
                      </div>
                      {motivoAberto === m.id && (
                        <RespostaInline
                          draftKey={`melhoria:naoresolveu:${m.id}`}
                          placeholder="O que ainda não resolveu? A equipe volta a mexer — quanto mais detalhe, melhor."
                          submitLabel="Reabrir chamado"
                          onSubmit={(t) => confirmar(m.id, false, t)}
                          onCancel={() => setMotivoAberto(null)}
                        />
                      )}
                    </>
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
        )
      })()}
    </div>
  )
}
