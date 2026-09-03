'use client'

// Central de Melhorias · Fase 1 — fila de atendimento (PS_ADMIN / PS_SUPPORT).
// Fila ÚNICA cruzando todas as empresas (RLS por fn_pode_ver_fila_suporte). Ordena por prioridade e
// idade (sugestão que envelhece é usuário que para de sugerir). A leitura da IA vem SEMPRE rotulada
// como IA, separada da resposta do atendente (RD-51). Recusar exige motivo (a RPC bloqueia).

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { supabase } from '@/lib/supabase'
import ConversaChamado from '@/components/melhorias/ConversaChamado'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC', blue: '#2F5AA8',
}
const inp: React.CSSProperties = { padding: '7px 9px', fontSize: 12, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none' }
const PRIO_ORD: Record<string, number> = { critica: 0, alta: 1, media: 2, baixa: 3 }
const STATUSES = ['nova', 'em_analise', 'aceita', 'em_desenvolvimento', 'concluida', 'recusada', 'duplicada', 'arquivada']
const brDate = (d: string) => d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
type Marca = { tipo: string; x: number; y: number; texto?: string }
type Item = {
  id: string; company_id: string | null; empresa: string | null; user_email: string; user_name: string | null
  titulo: string | null; descricao: string; categoria: string | null; prioridade: string; status: string
  rota: string | null; area: string | null; atendente_id: string | null; pr_numero: number | null; resposta: string | null
  resposta_aprovada: boolean; confirmado_pelo_autor: boolean
  tem_ia: boolean; ia_analise: Record<string, unknown> | null; ia_analisado_em: string | null; n_anexos: number
  created_at: string; dias_aberta: number
}

export default function AtendimentoPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const [autorizado, setAutorizado] = useState<boolean | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [rows, setRows] = useState<Item[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [fEmpresa, setFEmpresa] = useState('todas')
  const [fStatus, setFStatus] = useState('abertas')
  const [fCategoria, setFCategoria] = useState('todas')
  const [aberto, setAberto] = useState<string | null>(null)
  const [anexosUrl, setAnexosUrl] = useState<Record<string, { url: string; marcacoes: Marca[] }[]>>({})
  const [ehAdmin, setEhAdmin] = useState(false)   // só PS_ADMIN aprova resposta

  const carregar = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setAutorizado(false); return }
    setUserId(user.id)
    const { data: u } = await supabase.from('users').select('system_role').eq('id', user.id).maybeSingle()
    const role = (u as { system_role?: string } | null)?.system_role || ''
    const ok = ['PS_ADMIN', 'PS_SUPPORT'].includes(role)
    setEhAdmin(role === 'PS_ADMIN')
    setAutorizado(ok)
    if (!ok) return
    const { data, error } = await supabase.from('v_sugestao_fila').select('*').limit(300)
    if (error) { setErro(error.message); return }
    setRows((data as Item[]) ?? [])
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const empresas = useMemo(() => Array.from(new Set(rows.map((r) => r.empresa).filter(Boolean))) as string[], [rows])
  const visiveis = useMemo(() => rows
    .filter((r) => fEmpresa === 'todas' || r.empresa === fEmpresa)
    .filter((r) => fCategoria === 'todas' || r.categoria === fCategoria)
    // "abertas" = não-terminais. Inclui os SINÔNIMOS terminais (RD-52: o CHECK aceita concluida×concluido,
    // resolvida×implementado — o filtro precisa conhecer todos, senão um chamado entregue fica "aberto"
    // por 149 dias, como o "Adicionar botão de IA"). A migração unifica o vocabulário; isto é a rede.
    .filter((r) => fStatus === 'todas' ? true : fStatus === 'abertas' ? !['concluida', 'concluido', 'resolvida', 'implementado', 'recusada', 'duplicada', 'arquivada'].includes(r.status) : r.status === fStatus)
    .sort((a, b) => (PRIO_ORD[a.prioridade] ?? 2) - (PRIO_ORD[b.prioridade] ?? 2) || b.dias_aberta - a.dias_aberta), [rows, fEmpresa, fCategoria, fStatus])

  async function abrir(id: string) {
    setAberto(aberto === id ? null : id)
    if (aberto !== id && !anexosUrl[id]) {
      // só os anexos do CHAMADO (mensagem_id NULL) — as fotos de mensagens aparecem na conversa, não aqui
      const { data } = await supabase.from('sugestao_anexo').select('storage_path, marcacoes').eq('sugestao_id', id).is('mensagem_id', null).order('ordem')
      const list: { url: string; marcacoes: Marca[] }[] = []
      for (const a of (data as { storage_path: string; marcacoes: Marca[] }[] ?? [])) {
        const { data: signed } = await supabase.storage.from('sugestoes-anexos').createSignedUrl(a.storage_path, 3600)
        if (signed?.signedUrl) list.push({ url: signed.signedUrl, marcacoes: Array.isArray(a.marcacoes) ? a.marcacoes : [] })
      }
      setAnexosUrl((s) => ({ ...s, [id]: list }))
    }
  }

  async function acao(id: string, fn: string, params: Record<string, unknown>) {
    const { data, error } = await supabase.rpc(fn, params)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) {
      setErro(r?.erro === 'recusa_exige_motivo' ? 'Recusar exige um motivo — o usuário precisa saber por quê.' : (error?.message || r?.erro || 'Falha'))
      return false
    }
    void carregar(); return true
  }
  async function mudarStatus(it: Item, novo: string) {
    let motivo: string | null = null; let pr: number | null = null
    if (novo === 'recusada') { motivo = window.prompt('Motivo da recusa (obrigatório):') || ''; if (!motivo.trim()) { setErro('Recusar exige motivo.'); return } }
    if (novo === 'concluida') { const p = window.prompt('Número do PR que resolveu (opcional):') || ''; pr = p.trim() ? Number(p.trim()) : null }
    const ok = await acao(it.id, 'fn_sugestao_status', { p_id: it.id, p_novo: novo, p_user: userId, p_motivo: motivo, p_pr_numero: pr })
    if (ok) setMsg(novo === 'concluida' && !pr ? '⚠️ Concluída sem PR vinculado.' : 'Status atualizado.')
  }
  // Responder grava RASCUNHO (fn_sugestao_responder): a resposta NÃO chega ao autor até o CEO aprovar.
  async function responder(it: Item) {
    const resp = window.prompt('Resposta ao usuário (fica aguardando aprovação do CEO):', it.resposta || '') || ''
    if (!resp.trim()) return
    const ok = await acao(it.id, 'fn_sugestao_responder', { p_id: it.id, p_texto: resp, p_user: userId })
    if (ok) setMsg('Resposta salva — aguardando aprovação do CEO para chegar ao autor.')
  }
  // Aprovar (só PS_ADMIN): libera a resposta ao autor E cria a notificação por pessoa.
  async function aprovar(it: Item) {
    const ok = await acao(it.id, 'fn_sugestao_aprovar_resposta', { p_id: it.id, p_user: userId })
    if (ok) setMsg('Resposta aprovada e enviada — o autor foi avisado.')
  }

  if (autorizado === null) return <div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>
  if (!autorizado) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Esta é a fila do time de atendimento (PS). Você não tem acesso.</div>

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 1120, margin: '0 auto', color: C.esp }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>📥 Atendimento</div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Fila de Melhorias</h1>
      <p style={{ color: C.espM, fontSize: 13, margin: '6px 0 14px' }}>Todas as empresas numa fila só, por prioridade e idade. A leitura da IA é palpite — a decisão é sua.</p>

      {msg && <div style={{ background: C.amberBg, color: C.amber, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }} onClick={() => setMsg(null)}>{msg}</div>}
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }} onClick={() => setErro(null)}>{erro}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={inp}><option value="abertas">abertas</option><option value="todas">todas</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
        <select value={fEmpresa} onChange={(e) => setFEmpresa(e.target.value)} style={inp}><option value="todas">todas empresas</option>{empresas.map((e) => <option key={e} value={e}>{e}</option>)}</select>
        <select value={fCategoria} onChange={(e) => setFCategoria(e.target.value)} style={inp}><option value="todas">toda categoria</option>{['bug', 'melhoria', 'duvida', 'erro_dado'].map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <span style={{ fontSize: 12, color: C.espM, alignSelf: 'center' }}>{visiveis.length} na fila</span>
      </div>

      {visiveis.length === 0 ? <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '30px 16px', textAlign: 'center', color: C.espM }}>Fila vazia.</div> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {visiveis.map((it) => {
            const ia = it.ia_analise as Record<string, string> | null
            return (
            <div key={it.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, background: it.prioridade === 'critica' || it.prioridade === 'alta' ? C.redBg : C.cream, color: it.prioridade === 'critica' || it.prioridade === 'alta' ? C.red : C.espM, fontWeight: 700 }}>{it.prioridade}</span>
                    <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 999, background: C.cream, color: C.espM }}>{it.categoria || '—'}</span>
                    <b style={{ fontSize: 14.5 }}>{it.titulo || it.descricao.slice(0, 70)}</b>
                  </div>
                  <div style={{ fontSize: 12, color: C.espM, marginTop: 4 }}>{it.empresa || 'sem empresa'} · {it.user_name || it.user_email} · {brDate(it.created_at)} · <b>{it.dias_aberta}d aberta</b>{it.n_anexos ? ` · 📎 ${it.n_anexos}` : ''}</div>
                </div>
                <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: it.status === 'concluida' ? C.greenBg : it.status === 'recusada' ? C.redBg : '#E8EEF9', color: it.status === 'concluida' ? C.green : it.status === 'recusada' ? C.red : C.blue, fontWeight: 700 }}>{it.status.replace('_', ' ')}</span>
              </div>

              <button onClick={() => void abrir(it.id)} style={{ marginTop: 8, border: 'none', background: 'none', color: C.blue, cursor: 'pointer', fontSize: 12, padding: 0 }}>{aberto === it.id ? '▲ fechar' : '▼ ver detalhes, foto e IA'}</button>

              {aberto === it.id && (
                <div style={{ marginTop: 10, borderTop: `1px solid ${C.cream}`, paddingTop: 10 }}>
                  <div style={{ fontSize: 13, color: C.esp, whiteSpace: 'pre-wrap' }}>{it.descricao}</div>
                  {(anexosUrl[it.id] || []).map((a, ai) => (
                    <div key={ai} style={{ position: 'relative', display: 'inline-block', marginTop: 10, maxWidth: '100%' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.url} alt="" style={{ maxWidth: '100%', maxHeight: 460, borderRadius: 8, border: `1px solid ${C.border}`, display: 'block' }} />
                      {a.marcacoes.map((m, mi) => (
                        <div key={mi} title={m.texto} style={{ position: 'absolute', left: `${m.x * 100}%`, top: `${m.y * 100}%`, transform: 'translate(-50%,-50%)', width: 22, height: 22, borderRadius: 999, background: 'rgba(180,35,24,0.85)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff' }}>{mi + 1}</div>
                      ))}
                    </div>
                  ))}

                  {/* IA — SEMPRE rotulada como IA, separada (RD-51) */}
                  <div style={{ marginTop: 10, background: '#F3F6FC', border: `1px solid #D8E2F2`, borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 4 }}>🤖 Leitura da IA (palpite — não é decisão)</div>
                    {it.tem_ia && ia ? (
                      <div style={{ fontSize: 12.5, color: C.esp, lineHeight: 1.5 }}>
                        <div><b>{ia.resumo}</b></div>
                        <div style={{ color: C.espM }}>tela: {ia.tela_identificada || '—'} · rota: {ia.rota_provavel || '—'} · classif.: {ia.classificacao || '—'} · sev.: {ia.severidade || '—'}</div>
                        <div style={{ marginTop: 4 }}>próximo passo: {ia.proximo_passo || '—'}</div>
                      </div>
                    ) : <div style={{ fontSize: 12, color: C.espL, fontStyle: 'italic' }}>não analisada pela IA</div>}
                  </div>

                  {it.resposta && (
                    <div style={{ fontSize: 12.5, marginTop: 10, background: it.resposta_aprovada ? C.greenBg : C.amberBg, border: `1px solid ${it.resposta_aprovada ? '#BFE3C4' : '#F0DDB0'}`, padding: '8px 10px', borderRadius: 8 }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: it.resposta_aprovada ? C.green : C.amber, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }}>
                        {it.resposta_aprovada ? '✓ Resposta enviada ao autor' : 'Resposta escrita — aguardando aprovação'}
                      </div>
                      <div style={{ color: C.esp }}>{it.resposta}</div>
                      {!it.resposta_aprovada && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          {ehAdmin
                            ? <button onClick={() => void aprovar(it)} style={btn(C.green)}>Aprovar e enviar</button>
                            : <span style={{ fontSize: 11.5, color: C.espM }}>só o CEO (PS_ADMIN) aprova o envio ao autor</span>}
                          <button onClick={() => void responder(it)} style={btn(C.gold)}>Editar antes de enviar</button>
                        </div>
                      )}
                    </div>
                  )}
                  {it.pr_numero && <div style={{ fontSize: 12, marginTop: 6, color: C.green }}>vinculado ao PR #{it.pr_numero}</div>}

                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    {!it.atendente_id && <button onClick={() => void acao(it.id, 'fn_sugestao_assumir', { p_id: it.id, p_user: userId }).then((ok) => { if (ok) setMsg('Você assumiu.') })} style={btn(C.esp)}>assumir</button>}
                    <select value="" onChange={(e) => { if (e.target.value) void mudarStatus(it, e.target.value) }} style={{ ...inp, fontWeight: 700 }}>
                      <option value="">mudar status…</option>{STATUSES.filter((s) => s !== it.status).map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                    <button onClick={() => void responder(it)} style={btn(C.gold)}>responder</button>
                  </div>

                  {/* Conversa do chamado: o autor pode mandar foto nova sem encerrar; o PS responde aqui.
                      A resposta "oficial" (responder → aprovar) continua acima; isto é o ida-e-volta. */}
                  {userId && <ConversaChamado sugestaoId={it.id} userId={userId} ehSuporte onAfterSend={carregar} />}
                </div>
              )}
            </div>
          )})}
        </div>
      )}
    </div>
  )
}
function btn(bg: string): React.CSSProperties { return { padding: '7px 13px', border: 'none', borderRadius: 8, background: bg, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 12 } }
