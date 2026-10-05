'use client'

// Central de Melhorias · Fase 1 — fila de atendimento (PS_ADMIN / PS_SUPPORT).
// Fila ÚNICA cruzando todas as empresas (RLS por fn_pode_ver_fila_suporte). Ordena por prioridade e
// idade (sugestão que envelhece é usuário que para de sugerir). A leitura da IA vem SEMPRE rotulada
// como IA, separada da resposta do atendente (RD-51). Recusar exige motivo (a RPC bloqueia).

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { RespostaInline } from '@/components/melhorias/RespostaInline'
import ConversaChamado from '@/components/melhorias/ConversaChamado'
import PedidoOkSocio from '@/components/melhorias/PedidoOkSocio'
import { estadoFila, carregarFila, contarPrecisaDeMim, rascunhoNaoEnviado, RASCUNHO_NAO_ENVIADO, filtrarBusca, carregarEmpresasDemo, semDemos, filtrarVisao, trava, type EstadoFila, type Visao } from '@/lib/sugestoes/filaAtendimento'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC', blue: '#2F5AA8',
}
const inp: React.CSSProperties = { padding: '7px 9px', fontSize: 12, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none' }
const PRIO_ORD: Record<string, number> = { critica: 0, alta: 1, media: 2, baixa: 3 }
const STATUSES = ['nova', 'em_analise', 'aceita', 'em_desenvolvimento', 'aguardando_confirmacao', 'concluida', 'recusada', 'duplicada', 'arquivada']
const brDate = (d: string) => d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
type Marca = { tipo: string; x: number; y: number; texto?: string }
type Item = {
  id: string; numero: number; company_id: string | null; empresa: string | null; user_email: string; user_name: string | null
  titulo: string | null; descricao: string; categoria: string | null; prioridade: string; status: string
  rota: string | null; area: string | null; atendente_id: string | null; pr_numero: number | null; resposta: string | null
  resposta_aprovada: boolean; confirmado_pelo_autor: boolean
  tem_ia: boolean; ia_analise: Record<string, unknown> | null; ia_analisado_em: string | null; n_anexos: number
  created_at: string; dias_aberta: number
  erro_assinatura: string | null; origem_sugestao_id: string | null; ultimo_erro_comparacao: string | null
  resposta_origem: string | null; resposta_redigida_por: string | null; resposta_aprovada_por: string | null
  resposta_aprovada_em: string | null
  redator_nome: string | null; aprovador_nome: string | null
  // Chamados em equipe (T1+T2): carteira e trava de atendimento
  responsavel_id: string | null; responsavel_nome: string | null; atendente_nome: string | null
  em_atendimento_desde: string | null; ultimo_movimento: string | null; interno: boolean; agente: string | null
}
type Pessoa = { user_id: string; nome: string; papel: 'ceo' | 'socio' | 'suporte'; agente: string | null; eu: boolean }
type Hist = { acao: string; de: string | null; para: string | null; por: string; motivo: string | null; confirmacao_extra: boolean; automatico: boolean; em: string }
const ACAO_HIST: Record<string, string> = { assumir: 'assumiu', direcionar: 'direcionou', puxar: 'puxou', liberar: 'liberou', expirar: 'trava venceu', implantacao: 'implantação', carteira: 'carteira mudou' }

// Três estados que importam para o CEO (em vez de misturar tudo em "em desenvolvimento"):
const diasDesde = (iso: string | null) => iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : 0

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
  // ABAS por estado (decisão do CEO): "Aguardando o autor" sai da fila principal — chamado entregue não é
  // chamado aberto. A busca (nº/título) ignora a aba e varre tudo.
  const [aba, setAba] = useState<EstadoFila>('precisa_mim')
  const [fCategoria, setFCategoria] = useState('todas')
  const [busca, setBusca] = useState('')   // suporte digita o número (#14) ou parte do título e acha o chamado
  // Demos (CEO 28/09): chamados do robô de aceitação (empresas DEMO) ficam fora por padrão; só com "mostrar demos".
  const [demos, setDemos] = useState<Set<string>>(new Set())
  const [mostrarDemos, setMostrarDemos] = useState(false)
  const [aberto, setAberto] = useState<string | null>(null)
  const [respostaAberta, setRespostaAberta] = useState<string | null>(null) // #61 · qual chamado está com o textarea de resposta
  const [anexosUrl, setAnexosUrl] = useState<Record<string, { url: string; marcacoes: Marca[] }[]>>({})
  const [ehAdmin, setEhAdmin] = useState(false)   // PS_ADMIN / PS_ADMIN_CVM aprovam resposta
  const [respExpandida, setRespExpandida] = useState<string | null>(null)   // "ver completa" da resposta no card
  // Chamados em equipe: a carteira define para onde o chamado cai; toda a equipe vê "Todos" (SPEC rev. 9).
  const [equipe, setEquipe] = useState<Pessoa[]>([])
  const [visao, setVisao] = useState<Visao>('meus')
  const [fResp, setFResp] = useState('todos')
  const [historico, setHistorico] = useState<Record<string, Hist[]>>({})
  const params = useSearchParams()
  const idDaUrl = params.get('id')   // link do sino (/dashboard/atendimento?id=…)
  const ehCeo = equipe.some((p) => p.eu && p.papel === 'ceo')

  const carregar = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setAutorizado(false); return }
    setUserId(user.id)
    const { data: u } = await supabase.from('users').select('system_role').eq('id', user.id).maybeSingle()
    const role = (u as { system_role?: string } | null)?.system_role || ''
    // PS_ADMIN_CVM é papel de plataforma (trabalha nas 10 empresas) — vê a fila e aprova, como PS_ADMIN.
    const ok = ['PS_ADMIN', 'PS_SUPPORT', 'PS_ADMIN_CVM'].includes(role)
    setEhAdmin(['PS_ADMIN', 'PS_ADMIN_CVM'].includes(role))
    setAutorizado(ok)
    if (!ok) return
    // Fila: os mais recentes ORDENADOS + TODOS os rascunhos (regra do CEO: rascunho nunca some da "Precisa de mim").
    const [{ data, error }, demoIds] = await Promise.all([carregarFila<Item>(supabase), carregarEmpresasDemo(supabase)])
    if (error) { setErro(error.message); return }
    setDemos(demoIds)
    setRows(data)
    const { data: eq } = await supabase.rpc('fn_chamado_equipe_listar')
    const pessoas = (eq as Pessoa[] | null) ?? []
    setEquipe(pessoas)
    // CEO abre em "Todos"; a equipe abre em "Meus chamados"
    if (pessoas.some((p) => p.eu && p.papel === 'ceo')) setVisao((v) => (v === 'meus' ? 'todos' : v))
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  // Link do sino: abre o chamado (mesmo de demo) e mostra ele, em qualquer visão/aba.
  useEffect(() => {
    if (!idDaUrl || !rows.length) return
    const it = rows.find((r) => r.id === idDaUrl)
    if (!it) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- abre o chamado do link uma vez, quando a fila carrega
    setBusca(String(it.numero)); setVisao('todos'); setAberto(it.id)
    if (it.company_id && demos.has(it.company_id)) setMostrarDemos(true)
  }, [idDaUrl, rows, demos])

  // base da tela: sem demos no padrão (o cabeçalho "N p/ aprovar" usa a mesma base — contarPendentesAprovacao).
  const semDemo = useMemo(() => mostrarDemos ? rows : semDemos(rows, demos), [rows, demos, mostrarDemos])
  // visão (Meus / Todos / Sem dono) vem antes das abas de estado; a busca por número varre tudo.
  const base = useMemo(() => busca.trim() ? semDemo : filtrarVisao(semDemo, visao, userId ?? '', demos, fResp), [semDemo, visao, userId, demos, fResp, busca])
  const contVisao = useMemo(() => ({
    meus: filtrarVisao(semDemo, 'meus', userId ?? '', demos).filter((r) => estadoFila(r) !== 'terminal').length,
    todos: semDemo.filter((r) => estadoFila(r) !== 'terminal').length,
    sem_dono: filtrarVisao(semDemo, 'sem_dono', userId ?? '', demos).filter((r) => estadoFila(r) !== 'terminal').length,
  }), [semDemo, userId, demos])
  const nDemos = rows.length - semDemos(rows, demos).length
  const empresas = useMemo(() => Array.from(new Set(base.map((r) => r.empresa).filter(Boolean))) as string[], [base])
  // busca: número EXATO ("14" ou "#14" → só o #14) OU trecho do título/descrição (filtrarBusca).
  const buscaLimpa = busca.trim()
  const visiveis = useMemo(() => filtrarBusca(base, busca)
    .filter((r) => fEmpresa === 'todas' || r.empresa === fEmpresa)
    .filter((r) => fCategoria === 'todas' || r.categoria === fCategoria)
    // aba = estado da fila. Buscando (nº/título) varre TODAS as abas; senão, mostra só a aba atual.
    .filter((r) => buscaLimpa ? true : estadoFila(r) === aba)
    // dentro da aba: prioridade e idade.
    .sort((a, b) => (PRIO_ORD[a.prioridade] ?? 2) - (PRIO_ORD[b.prioridade] ?? 2) || b.dias_aberta - a.dias_aberta),
    [base, busca, fEmpresa, fCategoria, aba, buscaLimpa])

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
    const r = data as { ok?: boolean; erro?: string; mensagem?: string } | null
    if (error || !r?.ok) {
      setErro(r?.erro === 'recusa_exige_motivo' ? 'Recusar exige um motivo — o usuário precisa saber por quê.' : (r?.mensagem || error?.message || r?.erro || 'Falha'))
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
  // #61: o texto agora vem de um textarea inline com rascunho (não mais window.prompt de 1 linha que
  // perdia tudo ao trocar de janela).
  async function salvarResposta(it: Item, texto: string) {
    if (!texto.trim()) return
    const ok = await acao(it.id, 'fn_sugestao_responder', { p_id: it.id, p_texto: texto.trim(), p_user: userId })
    if (ok) { setRespostaAberta(null); setMsg('Resposta salva — aguardando aprovação do CEO para chegar ao autor.') }
  }
  // Aprovar (só PS_ADMIN): libera a resposta ao autor E cria a notificação por pessoa.
  async function aprovar(it: Item) {
    const ok = await acao(it.id, 'fn_sugestao_aprovar_resposta', { p_id: it.id, p_user: userId })
    if (ok) setMsg('Resposta aprovada e enviada — o autor foi avisado.')
  }
  // Reenvia o aviso para os aprovados que o autor ainda não confirmou (os que ficam "no limbo").
  async function reenviar(it: Item) {
    const ok = await acao(it.id, 'fn_sugestao_reenviar_aviso', { p_id: it.id, p_user: userId })
    if (ok) setMsg('Aviso reenviado ao autor (notificação criada; o e-mail dispara quando o Resend estiver configurado).')
  }
  // Contadores dos 3 estados sobre a fila inteira (o que o CEO precisa ver ao abrir a tela).
  const cont = useMemo(() => {
    let precisa = 0, semConf = 0, emCurso = 0, terminal = 0
    for (const r of base) { const e = estadoFila(r); if (e === 'sem_confirmacao') semConf++; else if (e === 'em_curso') emCurso++; else if (e === 'terminal') terminal++ }
    precisa = contarPrecisaDeMim(base)   // a MESMA conta do cabeçalho "N p/ aprovar" (Central de Melhorias), sem demos no padrão
    return { precisa, semConf, emCurso, terminal }
  }, [base])

  // Encerrar sem confirmação (item 4, decisão do CEO): só aprovados há +7 dias sem confirmar.
  async function encerrarSemConfirmacao(it: Item) {
    const motivo = window.prompt(`Encerrar o #${it.numero} SEM confirmação do autor (ele sumiu há ${diasDesde(it.resposta_aprovada_em)} dias). Motivo (fica registrado):`) || ''
    if (!motivo.trim()) return
    const ok = await acao(it.id, 'fn_sugestao_encerrar_sem_confirmacao', { p_id: it.id, p_user: userId, p_motivo: motivo })
    if (ok) setMsg(`#${it.numero} encerrado sem confirmação — registrado que o autor não confirmou.`)
  }

  // ── Trava de atendimento (um atendente por vez). A regra está no banco; aqui só os botões e as perguntas.
  async function rpcTrava(fn: string, p: Record<string, unknown>) {
    const { data, error } = await supabase.rpc(fn, p)
    const r = data as { ok?: boolean; erro?: string; mensagem?: string; precisa_confirmar?: boolean; avisado?: string } | null
    if (error) { setErro(error.message); return null }
    return r
  }
  async function assumir(it: Item) {
    const r = await rpcTrava('fn_chamado_assumir', { p_id: it.id, p_agente: null })
    if (r?.ok) { setMsg(`Você assumiu o #${it.numero}.`); void carregar() } else if (r) setErro(r.mensagem || r.erro || 'Falha')
  }
  async function liberar(it: Item) {
    const motivo = window.prompt(`Liberar o #${it.numero}? Ele volta para a fila do responsável. Motivo (opcional):`)
    if (motivo === null) return
    const r = await rpcTrava('fn_chamado_liberar', { p_id: it.id, p_motivo: motivo })
    if (r?.ok) { setMsg(`#${it.numero} liberado.`); void carregar() } else if (r) setErro(r.mensagem || r.erro || 'Falha')
  }
  async function puxar(it: Item) {
    const motivo = window.prompt(`Puxar o #${it.numero} de ${it.atendente_nome || 'quem está atendendo'}. Motivo (obrigatório — a pessoa recebe o aviso):`) || ''
    if (!motivo.trim()) return
    let r = await rpcTrava('fn_chamado_puxar', { p_id: it.id, p_motivo: motivo, p_confirmar: false })
    if (r?.precisa_confirmar) {
      if (!window.confirm(r.mensagem || 'A pessoa mexeu neste chamado há pouco. Puxar mesmo assim?')) return
      r = await rpcTrava('fn_chamado_puxar', { p_id: it.id, p_motivo: motivo, p_confirmar: true })
    }
    if (r?.ok) { setMsg(`Você puxou o #${it.numero}${r.avisado ? ` — ${r.avisado} foi avisado(a)` : ''}.`); void carregar() } else if (r) setErro(r.mensagem || r.erro || 'Falha')
  }
  async function direcionar(it: Item, para: string) {
    const nome = equipe.find((p) => p.user_id === para)?.nome || 'a pessoa'
    const motivo = window.prompt(`Direcionar o #${it.numero} para ${nome}. Motivo (obrigatório):`) || ''
    if (!motivo.trim()) return
    const r = await rpcTrava('fn_chamado_direcionar', { p_id: it.id, p_para: para, p_motivo: motivo })
    if (r?.ok) { setMsg(`#${it.numero} direcionado para ${nome} — avisado(a) no sino.`); void carregar() } else if (r) setErro(r.mensagem || r.erro || 'Falha')
  }
  async function verHistorico(id: string) {
    const { data } = await supabase.rpc('fn_chamado_historico', { p_id: id })
    setHistorico((h) => ({ ...h, [id]: (data as Hist[] | null) ?? [] }))
  }

  if (autorizado === null) return <div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>
  if (!autorizado) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Esta é a fila do time de atendimento (PS). Você não tem acesso.</div>

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 1120, margin: '0 auto', color: C.esp }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>📥 Atendimento</div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Fila de Melhorias</h1>
      <p style={{ color: C.espM, fontSize: 13, margin: '6px 0 12px' }}>Cada empresa tem um responsável (carteira); toda a equipe vê todos os chamados. Um atendente por vez: assuma antes de mexer. <a href="/dashboard/admin/carteira" style={{ color: C.blue, fontWeight: 700 }}>Carteira →</a></p>

      {/* VISÃO (Chamados em equipe): onde o chamado caiu. A carteira define para onde cai, não quem pode atender. */}
      <div data-testid="fila-visoes" style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {([['meus', '👤 Meus chamados', contVisao.meus], ['todos', '👥 Todos', contVisao.todos], ['sem_dono', '⚠️ Sem dono', contVisao.sem_dono]] as [Visao, string, number][]).map(([k, label, n]) => (
          <button key={k} type="button" data-testid={`visao-${k}`} onClick={() => setVisao(k)}
            style={{ padding: '6px 12px', borderRadius: 999, border: `1px solid ${visao === k ? C.esp : C.border}`, background: visao === k ? C.esp : C.white, color: visao === k ? '#fff' : (k === 'sem_dono' && n ? C.red : C.esp), fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
            {label} <span style={{ opacity: 0.8 }}>{n}</span>
          </button>
        ))}
        {visao === 'todos' && (
          <select data-testid="fila-filtro-responsavel" value={fResp} onChange={(e) => setFResp(e.target.value)} style={inp}>
            <option value="todos">todos os responsáveis</option>
            {equipe.filter((p) => p.papel !== 'suporte').map((p) => <option key={p.user_id} value={p.user_id}>{p.nome}</option>)}
          </select>
        )}
      </div>

      {/* ABAS por estado — "quem trabalha" vê só o que é dela; entregue (aguardando o autor) sai da fila. */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, flexWrap: 'wrap', borderBottom: `1px solid ${C.border}` }}>
        {([
          ['precisa_mim', '⏳ Precisa de mim', cont.precisa],
          ['em_curso', '🔵 Em curso', cont.emCurso],
          ['sem_confirmacao', '📤 Aguardando o autor', cont.semConf],
          ['terminal', '✓ Concluídas', cont.terminal],
        ] as [EstadoFila, string, number][]).map(([k, label, n]) => (
          <button key={k} type="button" onClick={() => setAba(k)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', padding: '9px 15px', border: 'none', background: 'transparent', borderBottom: `2px solid ${aba === k ? C.gold : 'transparent'}`, marginBottom: -1, fontSize: 13, fontWeight: aba === k ? 800 : 600, color: aba === k ? C.esp : C.espM }}>
            {label} <span style={{ fontSize: 12, fontWeight: 800, padding: '1px 8px', borderRadius: 999, background: aba === k ? C.gold : C.cream, color: aba === k ? '#fff' : C.espM }}>{n}</span>
          </button>
        ))}
      </div>

      {msg && <div style={{ background: C.amberBg, color: C.amber, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }} onClick={() => setMsg(null)}>{msg}</div>}
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }} onClick={() => setErro(null)}>{erro}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input data-testid="fila-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="buscar nº (#14) ou título — varre todas as abas" style={{ ...inp, minWidth: 220 }} />
        <select value={fEmpresa} onChange={(e) => setFEmpresa(e.target.value)} style={inp}><option value="todas">todas empresas</option>{empresas.map((e) => <option key={e} value={e}>{e}</option>)}</select>
        <select value={fCategoria} onChange={(e) => setFCategoria(e.target.value)} style={inp}><option value="todas">toda categoria</option>{['bug', 'melhoria', 'duvida', 'erro_dado'].map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <label data-testid="fila-mostrar-demos" style={{ fontSize: 12, color: C.espM, alignSelf: 'center', display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={mostrarDemos} onChange={(e) => setMostrarDemos(e.target.checked)} /> mostrar demos{nDemos && !mostrarDemos ? ` (${nDemos} ocultos)` : ''}
        </label>
        <span style={{ fontSize: 12, color: C.espM, alignSelf: 'center' }}>{buscaLimpa ? `${visiveis.length} encontrado(s)` : `${visiveis.length} nesta aba`}</span>
      </div>

      {visiveis.length === 0 ? <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '30px 16px', textAlign: 'center', color: C.espM }}>Fila vazia.</div> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {visiveis.map((it) => {
            const ia = it.ia_analise as Record<string, string> | null
            const est = estadoFila(it)
            const respPreview = (it.resposta || '').trim()
            return (
            <div key={it.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, background: it.prioridade === 'critica' || it.prioridade === 'alta' ? C.redBg : C.cream, color: it.prioridade === 'critica' || it.prioridade === 'alta' ? C.red : C.espM, fontWeight: 700 }}>{it.prioridade}</span>
                    <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 999, background: C.cream, color: C.espM }}>{it.categoria || '—'}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 800, color: C.gold }}>#{it.numero}</span>
                    <b style={{ fontSize: 14.5 }}>{it.titulo || it.descricao.slice(0, 70)}</b>
                  </div>
                  <div style={{ fontSize: 12, color: C.espM, marginTop: 4 }}>{it.empresa || 'sem empresa'} · {it.user_name || it.user_email} · {brDate(it.created_at)} · <b>{it.dias_aberta}d aberta</b>{it.n_anexos ? ` · 📎 ${it.n_anexos}` : ''}</div>
                  {(() => {
                    const tv = trava(it, userId ?? '', ehCeo)
                    const ativo = est !== 'terminal'
                    return (
                      <div data-testid={`trava-${it.numero}`} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6, fontSize: 12 }}>
                        <span data-testid={`trava-estado-${it.numero}`} style={{ padding: '2px 9px', borderRadius: 999, fontWeight: 700, background: tv.livre ? C.greenBg : tv.meu ? '#EAF0FA' : C.amberBg, color: tv.livre ? C.green : tv.meu ? C.blue : C.amber }}>
                          {tv.livre ? '🟢 Livre' : tv.meu ? `🔒 Com você desde ${brDate(it.em_atendimento_desde || '')}` : `🔒 Em atendimento por ${it.atendente_nome || '—'} desde ${brDate(it.em_atendimento_desde || '')}`}
                        </span>
                        <span style={{ color: C.espM }}>responsável: <b>{it.responsavel_nome || (it.interno ? 'interno PS' : 'sem dono')}</b>{it.interno ? ' · interno' : ''}</span>
                        {ativo && tv.podeAssumir && <button data-testid={`btn-assumir-${it.numero}`} onClick={() => void assumir(it)} style={btnMini(C.esp)}>Assumir</button>}
                        {ativo && tv.podePuxar && <button data-testid={`btn-puxar-${it.numero}`} onClick={() => void puxar(it)} style={btnMini(C.amber)}>Puxar</button>}
                        {ativo && tv.podeLiberar && <button data-testid={`btn-liberar-${it.numero}`} onClick={() => void liberar(it)} style={btnMini(C.espM)}>Liberar</button>}
                        {ativo && tv.podeDirecionar && (
                          <select data-testid={`sel-direcionar-${it.numero}`} value="" onChange={(e) => { if (e.target.value) void direcionar(it, e.target.value) }} style={{ ...inp, padding: '3px 6px', fontSize: 11.5 }}>
                            <option value="">direcionar para…</option>
                            {equipe.filter((p) => p.user_id !== it.atendente_id).map((p) => <option key={p.user_id} value={p.user_id}>{p.nome}</option>)}
                          </select>
                        )}
                      </div>
                    )
                  })()}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {it.origem_sugestao_id && <span title="desmembrado de outro chamado" style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, background: C.cream, color: C.espM, fontWeight: 700 }}>↳ desmembrado</span>}
                  {it.ultimo_erro_comparacao === 'mesmo' && <span title="o erro reapareceu igual na última tentativa" style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, background: C.redBg, color: C.red, fontWeight: 700 }}>erro igual</span>}
                  {it.ultimo_erro_comparacao === 'mudou' && <span title="o erro mudou entre tentativas" style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, background: C.greenBg, color: C.green, fontWeight: 700 }}>erro mudou</span>}
                  {est === 'precisa_mim' && <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 999, background: C.amberBg, color: C.amber, border: '1px solid #F0DDB0', fontWeight: 800 }}>⏳ Precisa de mim</span>}
                  {est === 'sem_confirmacao' && <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 999, background: '#EAF0FA', color: C.blue, border: '1px solid #D2DEF2', fontWeight: 800 }}>📤 Sem confirmação</span>}
                  {est === 'em_curso' && <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 999, background: C.cream, color: C.espM, fontWeight: 800 }}>🔵 Em curso</span>}
                  <span title="status interno" style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: it.status === 'concluida' ? C.greenBg : it.status === 'recusada' ? C.redBg : '#EFEBE4', color: it.status === 'concluida' ? C.green : it.status === 'recusada' ? C.red : C.espL, fontWeight: 600 }}>{it.status.replaceAll('_', ' ')}</span>
                </div>
              </div>

              {/* ⏳ Precisa de mim: a resposta redigida + Aprovar/Editar DIRETO no card (sem abrir). O texto aparece
                  para você ler antes — nunca aprovar às cegas. */}
              {est === 'precisa_mim' && (
                <div style={{ marginTop: 10, background: C.amberBg, border: '1px solid #F0DDB0', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: C.amber, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }}>
                    Resposta redigida {it.resposta_origem === 'assistente' ? '(assistente/IA)' : it.redator_nome ? `(por ${it.redator_nome})` : ''} — esperando você
                  </div>
                  <div style={{ fontSize: 13, color: C.esp, whiteSpace: 'pre-wrap' }}>
                    {(respExpandida === it.id || respPreview.length <= 200) ? respPreview : respPreview.slice(0, 200) + '… '}
                    {respPreview.length > 200 && (
                      <button onClick={() => setRespExpandida(respExpandida === it.id ? null : it.id)} style={{ border: 'none', background: 'none', color: C.blue, cursor: 'pointer', fontSize: 12, padding: 0, fontWeight: 700 }}>
                        {respExpandida === it.id ? ' ver menos' : 'ver completa'}
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    {ehAdmin
                      ? <button onClick={() => void aprovar(it)} style={btn(C.green)}>Aprovar e enviar</button>
                      : <span style={{ fontSize: 11.5, color: C.espM }}>só o CEO aprova o envio ao autor</span>}
                    <button onClick={() => setRespostaAberta((v) => (v === it.id ? null : it.id))} style={btn(C.gold)}>Editar antes de aprovar</button>
                  </div>
                  {respostaAberta === it.id && (
                    <RespostaInline
                      draftKey={`atendimento:resposta:${it.id}`}
                      placeholder="Edite a resposta — fica como rascunho até o CEO aprovar."
                      submitLabel="Salvar resposta"
                      initial={it.resposta || ''}
                      onSubmit={(t) => salvarResposta(it, t)}
                      onCancel={() => setRespostaAberta(null)}
                    />
                  )}
                </div>
              )}
              {/* 📤 Enviado, sem confirmação: há quantos dias, e um botão para reenviar o aviso (cobrar o autor). */}
              {est === 'sem_confirmacao' && (
                <div style={{ marginTop: 10, background: '#EAF0FA', border: '1px solid #D2DEF2', borderRadius: 10, padding: '9px 12px', display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 12.5, color: C.blue, fontWeight: 600 }}>
                    📤 Resposta enviada — aguardando confirmação do autor há <b>{diasDesde(it.resposta_aprovada_em)} dia(s)</b>.
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => void reenviar(it)} style={btn(C.blue)}>Reenviar aviso</button>
                    {/* +7 dias sem confirmar: só o CEO encerra, com motivo. Não automático. */}
                    {ehAdmin && diasDesde(it.resposta_aprovada_em) > 7 && (
                      <button onClick={() => void encerrarSemConfirmacao(it)} style={btn(C.red)} title="Autor sumiu há mais de 7 dias — encerrar registrando que não houve confirmação">Encerrar sem confirmação</button>
                    )}
                  </div>
                </div>
              )}

              <button onClick={() => void abrir(it.id)} style={{ marginTop: 8, border: 'none', background: 'none', color: C.blue, cursor: 'pointer', fontSize: 12, padding: 0 }}>{aberto === it.id ? '▲ fechar' : '▼ ver detalhes, foto e IA'}</button>

              {aberto === it.id && (
                <div style={{ marginTop: 10, borderTop: `1px solid ${C.cream}`, paddingTop: 10 }}>
                  <PedidoOkSocio chamadoId={it.id} />
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

                  {/* Resposta ao autor — SEMPRE visível, nunca escondida quando vazia. O bug do CEO travado:
                      resposta vem como '' (string vazia) no chamado novo → `it.resposta &&` era falsy → a seção
                      inteira (com o botão Aprovar) sumia, sem explicar por quê. Três estados honestos:
                      sem resposta → Responder; rascunho → Aprovar/Editar; aprovada → enviada. Aprovar não
                      depende de status nem de estar assumido — só de haver resposta escrita (a RPC decide o resto). */}
                  {(() => {
                    const temResposta = !!(it.resposta && it.resposta.trim())
                    if (!temResposta) {
                      return (
                        <div style={{ fontSize: 12.5, marginTop: 10, background: C.cream, border: `1px dashed ${C.border}`, padding: '10px 12px', borderRadius: 8 }}>
                          <div style={{ fontSize: 10.5, fontWeight: 700, color: C.espM, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Resposta ao autor</div>
                          <div style={{ color: C.espM }}>Nenhuma resposta escrita ainda. Escreva a resposta — depois o CEO (PS_ADMIN) aprova e ela chega ao autor. <b>Sem resposta escrita não há o que aprovar.</b></div>
                          {respostaAberta === it.id ? (
                            <RespostaInline
                              draftKey={`atendimento:resposta:${it.id}`}
                              placeholder="Resposta ao autor — fica como rascunho até o CEO aprovar."
                              submitLabel="Salvar resposta"
                              onSubmit={(t) => salvarResposta(it, t)}
                              onCancel={() => setRespostaAberta(null)}
                            />
                          ) : (
                            <div style={{ marginTop: 8 }}>
                              <button onClick={() => setRespostaAberta(it.id)} style={btn(C.gold)}>Responder ao autor</button>
                            </div>
                          )}
                        </div>
                      )
                    }
                    return (
                      <div style={{ fontSize: 12.5, marginTop: 10, background: it.resposta_aprovada ? C.greenBg : C.amberBg, border: `1px solid ${it.resposta_aprovada ? '#BFE3C4' : '#F0DDB0'}`, padding: '8px 10px', borderRadius: 8 }}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: it.resposta_aprovada ? C.green : C.amber, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }}>
                          {it.resposta_aprovada ? '✓ Resposta enviada ao autor' : rascunhoNaoEnviado(it) ? RASCUNHO_NAO_ENVIADO : 'Resposta escrita — aguardando aprovação'}
                        </div>
                        <div style={{ color: C.esp }}>{it.resposta}</div>
                        {/* quem REDIGIU × quem APROVOU — o CEO precisa ver o que está aprovando e quem escreveu;
                            o texto chega ao autor como do aprovador, mas o registro guarda os dois (RD-51/RD-58). */}
                        <div style={{ fontSize: 10.5, color: C.espM, marginTop: 6 }}>
                          Rascunho escrito {it.resposta_origem === 'assistente' ? <b>pelo assistente (IA)</b> : it.redator_nome ? <>por <b>{it.redator_nome}</b></> : 'manualmente'}
                          {it.resposta_aprovada && it.aprovador_nome ? <> · aprovado por <b>{it.aprovador_nome}</b></> : ''}
                        </div>
                        {rascunhoNaoEnviado(it) && (
                          <div data-testid="rascunho-nao-enviado" style={{ fontSize: 11.5, color: C.espM, marginTop: 6 }}>
                            Fica aqui no histórico e fora da fila. Se o chamado for reaberto, o rascunho volta para &quot;Precisa de mim&quot;.
                          </div>
                        )}
                        {!it.resposta_aprovada && !rascunhoNaoEnviado(it) && (
                          <>
                            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                              {ehAdmin
                                ? <button onClick={() => void aprovar(it)} style={btn(C.green)}>Aprovar e enviar</button>
                                : <span style={{ fontSize: 11.5, color: C.espM }}>só o CEO (PS_ADMIN) aprova o envio ao autor</span>}
                              <button onClick={() => setRespostaAberta((v) => (v === it.id ? null : it.id))} style={btn(C.gold)}>Editar antes de enviar</button>
                            </div>
                            {respostaAberta === it.id && (
                              <RespostaInline
                                draftKey={`atendimento:resposta:${it.id}`}
                                placeholder="Edite a resposta — fica como rascunho até o CEO aprovar."
                                submitLabel="Salvar resposta"
                                initial={it.resposta || ''}
                                onSubmit={(t) => salvarResposta(it, t)}
                                onCancel={() => setRespostaAberta(null)}
                              />
                            )}
                          </>
                        )}
                      </div>
                    )
                  })()}
                  {it.pr_numero && <div style={{ fontSize: 12, marginTop: 6, color: C.green }}>vinculado ao PR #{it.pr_numero}</div>}

                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <button data-testid={`btn-historico-${it.numero}`} onClick={() => void verHistorico(it.id)} style={btn(C.espM)}>histórico de atendimento</button>
                    <select value="" onChange={(e) => { if (e.target.value) void mudarStatus(it, e.target.value) }} style={{ ...inp, fontWeight: 700 }}>
                      <option value="">mudar status…</option>{STATUSES.filter((s) => s !== it.status).map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
                    </select>
                    {/* "responder" saiu daqui: agora mora na seção "Resposta ao autor" acima, que é sempre
                        visível e mostra o estado (sem resposta / rascunho / aprovada) — um único caminho claro. */}
                  </div>

                  {historico[it.id] && (
                    <div data-testid={`historico-${it.numero}`} style={{ marginTop: 10, background: C.cream, borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: C.espM, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Histórico de atendimento</div>
                      {historico[it.id].length === 0 ? <div style={{ color: C.espM }}>Nenhuma troca de atendente ainda.</div> : historico[it.id].map((h, i) => (
                        <div key={i} style={{ color: C.esp }}>
                          {brDate(h.em)} · <b>{h.por}</b> {ACAO_HIST[h.acao] || h.acao}{h.de ? ` de ${h.de}` : ''}{h.para ? ` → ${h.para}` : ''}{h.motivo ? ` — "${h.motivo}"` : ''}{h.confirmacao_extra ? ' (confirmou: mexido há < 2 h)' : ''}{h.automatico ? ' (automático)' : ''}
                        </div>
                      ))}
                    </div>
                  )}

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
function btnMini(bg: string): React.CSSProperties { return { padding: '3px 10px', border: 'none', borderRadius: 7, background: bg, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 11.5 } }
function btn(bg: string): React.CSSProperties { return { padding: '7px 13px', border: 'none', borderRadius: 8, background: bg, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 12 } }
