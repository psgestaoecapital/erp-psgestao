'use client'

// Hub · Gestão de Obras · Revisões de escopo (Blueprint §16 H2 · HBF-5.3) — aba REVISÕES.
// LEITURA: lista as revisões de escopo da obra — cabeçalho (origem, motivo, situação, valor anterior
// × novo, variação) e os itens de cada revisão (quantidade e preço anterior × novo), via a RPC já
// publicada e guardada fn_obra_revisao_listar (#3935, leitura por company_id).
// ABERTURA (esta fatia): botão "Nova revisão" + formulário que liga à RPC já existente e guardada
// fn_obra_revisao_criar (cria em 'rascunho'; valida acesso por company_id e o PISO do medido por item).
// DECISÃO (esta fatia): botões Solicitar aprovação / Aprovar / Recusar, que ligam às RPCs já
// existentes e guardadas fn_obra_revisao_solicitar / _aprovar / _recusar (rascunho→solicitada→
// aprovada/recusada). A revisão nasce como rascunho e só muda o valor contratado quando APROVADA.
// RD-95: "?" em todo filtro / indicador / coluna / ação. RD-96/RD-100: linguagem e layout próprios.

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const ROTA = '/dashboard/projetos/obras/[id]/revisoes'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = 'rgba(61,35,20,0.18)', MUT = 'rgba(61,35,20,0.55)', VERM = '#A32D2D', VERDE = '#2E7D32'

// A camada de dados pode chegar à produção depois desta tela; enquanto não chegar, PostgREST
// responde "relation/function does not exist". RD-98: degrada para aviso de "recurso sendo liberado".
function recursoEmLiberacao(e: unknown): boolean {
  const err = (e && typeof e === 'object' ? e : {}) as { code?: unknown; message?: unknown }
  const code = typeof err.code === 'string' ? err.code : ''
  const msg = typeof err.message === 'string' ? err.message.toLowerCase() : ''
  if (['42P01', 'PGRST202', 'PGRST205'].includes(code)) return true
  return /does not exist|not found|schema cache/.test(msg)
}

const brl = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const num = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })
const fmtDataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

const ORIGEM_LABEL: Record<string, string> = {
  interno: 'Interna',
  pedido_cliente: 'Pedido do cliente',
  cliente: 'Do cliente',
  contratante: 'Da contratante',
  da_contratante: 'Da contratante',
}

const STATUS_LABEL: Record<string, { l: string; cor: string }> = {
  rascunho: { l: 'Rascunho', cor: MUT },
  solicitada: { l: 'Solicitada', cor: GOLD },
  aprovada: { l: 'Aprovada', cor: VERDE },
  recusada: { l: 'Recusada', cor: VERM },
  cancelada: { l: 'Cancelada', cor: VERM },
  encerrado_por_supressao: { l: 'Encerrada por supressão', cor: ESP },
}

type Obra = { id: string; nome: string | null; company_id: string }
type RevisaoItem = {
  id: string; obra_item_id: string | null; descricao: string | null; unidade: string | null
  quantidade_anterior: number | null; quantidade_nova: number | null
  preco_unitario_anterior: number | null; preco_unitario_novo: number | null
  quantidade_medida_na_revisao: number | null; motivo: string | null
}
type Revisao = {
  id: string; sequencial: number; origem: string | null; motivo: string | null; status: string
  valor_anterior: number | null; valor_novo: number | null; delta: number | null
  solicitado_em: string | null; aprovado_em: string | null; observacoes: string | null; criado_em: string | null
  itens: RevisaoItem[]
}
// Item do escopo contratado da obra — base do formulário de abertura (nova quantidade / novo preço por item).
type ObraItem = {
  id: string; descricao: string | null; unidade: string | null
  quantidade_contratada: number | null; preco_unitario: number | null; quantidade_medida: number | null
}
// O que o usuário digitou por item no formulário: nova quantidade e/ou novo preço (strings, vazio = não mudou).
type EdicaoItem = { qtd: string; preco: string }

export default function RevisoesObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [obra, setObra] = useState<Obra | null>(null)
  const [revisoes, setRevisoes] = useState<Revisao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [emLiberacao, setEmLiberacao] = useState(false)
  const [filtro, setFiltro] = useState<'todos' | 'abertas' | 'aprovadas' | 'encerradas'>('todos')
  const [expandido, setExpandido] = useState<string | null>(null)

  // Abertura de nova revisão (liga à RPC já existente e guardada fn_obra_revisao_criar — cria em 'rascunho').
  const [novaAberta, setNovaAberta] = useState(false)
  const [obraItens, setObraItens] = useState<ObraItem[]>([])
  const [carregandoItens, setCarregandoItens] = useState(false)
  const [fOrigem, setFOrigem] = useState<'interno' | 'pedido_cliente'>('interno')
  const [fMotivo, setFMotivo] = useState('')
  const [fItens, setFItens] = useState<Record<string, EdicaoItem>>({})
  const [salvandoNova, setSalvandoNova] = useState(false)
  const [erroNova, setErroNova] = useState<string | null>(null)

  // Decisão da revisão (liga às RPCs já existentes e guardadas fn_obra_revisao_solicitar/aprovar/recusar).
  // Só revisão em rascunho pode ser solicitada; só solicitada pode ser aprovada/recusada. A aprovação MOVE
  // o valor contratado — por isso toda ação passa por uma confirmação antes de executar.
  const [acao, setAcao] = useState<{ rev: Revisao; tipo: 'solicitar' | 'aprovar' | 'recusar' } | null>(null)
  const [motivoRecusa, setMotivoRecusa] = useState('')
  const [salvandoAcao, setSalvandoAcao] = useState(false)
  const [erroAcao, setErroAcao] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null); setEmLiberacao(false)
    const { data: o, error: eo } = await supabase
      .from('projetos_obras').select('id, nome, company_id').eq('id', id).maybeSingle()
    if (eo) { setCarregando(false); setErro(erroAmigavel(eo, 'Não foi possível abrir a obra. Tente de novo.')); return }
    if (!o) { setCarregando(false); setObra(null); return }
    setObra(o as Obra)

    const { data, error } = await supabase.rpc('fn_obra_revisao_listar', { p_obra_id: id })
    setCarregando(false)
    if (error) {
      if (recursoEmLiberacao(error)) { setEmLiberacao(true); return }
      setErro(erroAmigavel(error, 'Não foi possível carregar as revisões. Tente de novo.')); return
    }
    const r = (data ?? {}) as { ok?: boolean; erro?: string; revisoes?: Revisao[] }
    if (r.ok === false) { setErro(r.erro ?? 'Não foi possível carregar as revisões.'); return }
    setRevisoes(r.revisoes ?? [])
  }, [id])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const abrirNova = useCallback(async () => {
    setErroNova(null); setFOrigem('interno'); setFMotivo(''); setFItens({})
    setNovaAberta(true); setCarregandoItens(true)
    const { data, error } = await supabase
      .from('projetos_obra_item')
      .select('id, descricao, unidade, quantidade_contratada, preco_unitario, quantidade_medida')
      .eq('obra_id', id).is('excluido_em', null).order('ordem', { ascending: true })
    setCarregandoItens(false)
    if (error) { setObraItens([]); return }
    setObraItens((data ?? []) as ObraItem[])
  }, [id])

  const submeterNova = useCallback(async () => {
    setErroNova(null)
    if (!fMotivo.trim()) { setErroNova('Descreva o motivo da revisão.'); return }
    // Monta só os itens que o usuário mudou (nova quantidade ou novo preço preenchidos).
    const itens: { obra_item_id: string; quantidade_nova?: number; preco_unitario_novo?: number }[] = []
    for (const oi of obraItens) {
      const ed = fItens[oi.id]
      if (!ed) continue
      const qtd = ed.qtd.trim() === '' ? null : Number(ed.qtd.replace(',', '.'))
      const preco = ed.preco.trim() === '' ? null : Number(ed.preco.replace(',', '.'))
      if (qtd === null && preco === null) continue
      if (qtd !== null && (!Number.isFinite(qtd) || qtd < 0)) { setErroNova(`Quantidade inválida em "${oi.descricao ?? 'item'}".`); return }
      if (preco !== null && (!Number.isFinite(preco) || preco < 0)) { setErroNova(`Preço inválido em "${oi.descricao ?? 'item'}".`); return }
      // Piso do medido (o servidor também recusa, mas avisamos antes com linguagem do usuário).
      if (qtd !== null && qtd < (Number(oi.quantidade_medida) || 0)) {
        setErroNova(`Em "${oi.descricao ?? 'item'}", a nova quantidade (${qtd}) não pode ficar abaixo do já medido (${Number(oi.quantidade_medida) || 0}).`); return
      }
      const item: { obra_item_id: string; quantidade_nova?: number; preco_unitario_novo?: number } = { obra_item_id: oi.id }
      if (qtd !== null) item.quantidade_nova = qtd
      if (preco !== null) item.preco_unitario_novo = preco
      itens.push(item)
    }
    setSalvandoNova(true)
    const { data, error } = await supabase.rpc('fn_obra_revisao_criar', {
      p_obra_id: id, p_motivo: fMotivo.trim(), p_origem: fOrigem, p_itens: itens,
    })
    setSalvandoNova(false)
    if (error) {
      if (recursoEmLiberacao(error)) { setErroNova('Recurso de revisões sendo liberado para esta empresa. Tente de novo em instantes.'); return }
      setErroNova(erroAmigavel(error, 'Não foi possível abrir a revisão. Confira os dados e tente de novo.')); return
    }
    const r = (data ?? {}) as { ok?: boolean; erro?: string }
    if (r.ok === false) { setErroNova(r.erro ?? 'Não foi possível abrir a revisão.'); return }
    setNovaAberta(false)
    await carregar()
  }, [id, fMotivo, fOrigem, obraItens, fItens, carregar])

  const abrirAcao = useCallback((rev: Revisao, tipo: 'solicitar' | 'aprovar' | 'recusar') => {
    setErroAcao(null); setMotivoRecusa(''); setAcao({ rev, tipo })
  }, [])

  const confirmarAcao = useCallback(async () => {
    if (!acao) return
    setErroAcao(null); setSalvandoAcao(true)
    const fn = acao.tipo === 'solicitar' ? 'fn_obra_revisao_solicitar'
      : acao.tipo === 'aprovar' ? 'fn_obra_revisao_aprovar'
        : 'fn_obra_revisao_recusar'
    const args: Record<string, unknown> = { p_revisao_id: acao.rev.id }
    if (acao.tipo === 'recusar') args.p_motivo = motivoRecusa.trim() || null
    const { data, error } = await supabase.rpc(fn, args)
    setSalvandoAcao(false)
    if (error) {
      if (recursoEmLiberacao(error)) { setErroAcao('Recurso de decisão de revisões sendo liberado para esta empresa. Tente de novo em instantes.'); return }
      setErroAcao(erroAmigavel(error, 'Não foi possível concluir a ação. Confira e tente de novo.')); return
    }
    const r = (data ?? {}) as { ok?: boolean; erro?: string }
    if (r.ok === false) { setErroAcao(r.erro ?? 'Não foi possível concluir a ação.'); return }
    setAcao(null); setMotivoRecusa('')
    await carregar()
  }, [acao, motivoRecusa, carregar])

  const revisoesFiltradas = useMemo(() => revisoes.filter((r) => {
    if (filtro === 'todos') return true
    if (filtro === 'abertas') return ['rascunho', 'solicitada'].includes(r.status)
    if (filtro === 'aprovadas') return r.status === 'aprovada'
    if (filtro === 'encerradas') return ['recusada', 'cancelada', 'encerrado_por_supressao'].includes(r.status)
    return true
  }), [revisoes, filtro])

  // Resumo: quantas revisões e a variação ACUMULADA do valor contratado (só as aprovadas movem o contrato).
  const resumo = useMemo(() => {
    const aprovadas = revisoes.filter((r) => r.status === 'aprovada')
    const deltaAprovado = aprovadas.reduce((s, r) => s + (Number(r.delta) || 0), 0)
    return { total: revisoes.length, aprovadas: aprovadas.length, deltaAprovado }
  }, [revisoes])

  const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 18 }
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: ESP, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }
  const inp: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, color: ESP, background: BG }
  const btn = (bg: string, fg = '#fff'): React.CSSProperties => ({ background: bg, color: fg, border: 'none', borderRadius: 9, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' })

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '20px 16px 80px' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Cockpit da obra</Link>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: ESP, margin: 0 }}>Revisões de escopo</h1>
          {obra?.nome && <span style={{ fontSize: 14, color: MUT }}>{obra.nome}</span>}
        </div>
        <p style={{ fontSize: 13, color: MUT, marginTop: 4, maxWidth: 680 }}>
          Cada vez que o escopo da obra muda — acréscimo, supressão ou reajuste de preço — a mudança fica registrada aqui como uma revisão, com o valor antes e depois e o que motivou. Só as revisões aprovadas mudam o valor contratado.
        </p>

        {erro && <div style={{ ...card, borderColor: VERM, color: VERM, marginTop: 14, fontSize: 13 }}>{erro}</div>}

        {emLiberacao ? (
          <div style={{ ...card, marginTop: 16, color: MUT, fontSize: 13 }}>Recurso de revisões de escopo sendo liberado para esta empresa. Atualize em instantes.</div>
        ) : carregando ? (
          <div style={{ ...card, marginTop: 16, color: MUT, fontSize: 13 }}>Carregando…</div>
        ) : !obra ? (
          <div style={{ ...card, marginTop: 16, color: MUT, fontSize: 13 }}>Obra não encontrada ou sem acesso.</div>
        ) : (
          <>
            {/* Indicador: resumo das revisões */}
            <div style={{ ...card, marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: MUT }}>Revisões registradas</span>
              <AjudaCampo chave="projetos.revisao.resumo" rota={ROTA} />
              <strong style={{ color: ESP, fontSize: 18 }}>{resumo.total}</strong>
              <span style={{ fontSize: 12, color: MUT }}>({resumo.aprovadas} aprovada{resumo.aprovadas === 1 ? '' : 's'})</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 13, color: MUT }}>Variação aprovada no contrato</span>
              <strong style={{ color: resumo.deltaAprovado > 0 ? VERDE : resumo.deltaAprovado < 0 ? VERM : ESP, fontSize: 16 }}>
                {resumo.deltaAprovado > 0 ? '+' : ''}{brl(resumo.deltaAprovado)}
              </strong>
            </div>

            {/* Ação: abrir nova revisão + filtro por situação */}
            <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => void abrirNova()} style={btn(ESP)} data-testid="rev-nova">+ Nova revisão</button>
              <AjudaCampo chave="projetos.revisao.nova" rota={ROTA} />
              <span style={{ flex: 1 }} />
              <label style={lbl}>
                Mostrar <AjudaCampo chave="projetos.revisao.filtro_status" rota={ROTA} />
                <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} style={{ ...inp, width: 'auto' }} data-testid="rev-filtro">
                  <option value="todos">Todas</option>
                  <option value="abertas">Em aberto</option>
                  <option value="aprovadas">Aprovadas</option>
                  <option value="encerradas">Encerradas</option>
                </select>
              </label>
            </div>

            {/* Lista de revisões */}
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {revisoesFiltradas.length === 0 ? (
                <div style={{ ...card, color: MUT, fontSize: 13 }}>
                  {revisoes.length === 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
                      <span>Nenhuma revisão de escopo registrada nesta obra ainda. Quando o escopo mudar — acréscimo, supressão ou reajuste de preço —, abra uma revisão para registrar o valor antes e depois.</span>
                      <button onClick={() => void abrirNova()} style={btn(ESP)} data-testid="rev-nova-vazio">+ Abrir primeira revisão</button>
                    </div>
                  ) : 'Nenhuma revisão no filtro selecionado.'}
                </div>
              ) : revisoesFiltradas.map((r) => {
                const st = STATUS_LABEL[r.status] ?? { l: r.status, cor: MUT }
                const aberto = expandido === r.id
                const delta = Number(r.delta) || 0
                return (
                  <div key={r.id} style={card} data-testid={`rev-row-${r.id}`}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <strong style={{ color: ESP, fontSize: 15 }}>
                        Revisão nº {r.sequencial} <AjudaCampo chave="projetos.revisao.sequencial" rota={ROTA} />
                      </strong>
                      <span style={{ fontSize: 12, color: MUT }}>
                        {ORIGEM_LABEL[r.origem ?? ''] ?? r.origem ?? '—'} <AjudaCampo chave="projetos.revisao.origem" rota={ROTA} />
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: st.cor, border: `1px solid ${st.cor}`, borderRadius: 999, padding: '2px 10px' }}>
                        {st.l}
                      </span>
                      <AjudaCampo chave="projetos.revisao.status" rota={ROTA} />
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: 12, color: MUT }}>Solicitada em {fmtDataHora(r.solicitado_em ?? r.criado_em)} <AjudaCampo chave="projetos.revisao.solicitada_em" rota={ROTA} /></span>
                    </div>

                    {r.motivo && (
                      <p style={{ fontSize: 13, color: ESP, margin: '8px 0 0' }}>
                        <span style={{ color: MUT }}>Motivo: <AjudaCampo chave="projetos.revisao.motivo" rota={ROTA} /></span> {r.motivo}
                      </p>
                    )}

                    {/* Valores anterior × novo × variação */}
                    <div style={{ display: 'flex', gap: 24, marginTop: 12, flexWrap: 'wrap', fontSize: 13 }}>
                      <div>
                        <div style={{ fontSize: 11, color: MUT }}>Valor anterior <AjudaCampo chave="projetos.revisao.valor_anterior" rota={ROTA} /></div>
                        <strong style={{ color: ESP }}>{brl(r.valor_anterior)}</strong>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: MUT }}>Valor novo <AjudaCampo chave="projetos.revisao.valor_novo" rota={ROTA} /></div>
                        <strong style={{ color: ESP }}>{brl(r.valor_novo)}</strong>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: MUT }}>Variação <AjudaCampo chave="projetos.revisao.delta" rota={ROTA} /></div>
                        <strong style={{ color: delta > 0 ? VERDE : delta < 0 ? VERM : ESP }}>
                          {delta > 0 ? '+' : ''}{brl(delta)}
                        </strong>
                      </div>
                    </div>

                    {r.observacoes && <p style={{ fontSize: 13, color: MUT, margin: '10px 0 0' }}>{r.observacoes}</p>}

                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button onClick={() => setExpandido(aberto ? null : r.id)} style={{ ...btn('transparent', GOLD), padding: '6px 10px', border: `1px solid ${LINE}` }} data-testid={`rev-itens-${r.id}`}>
                        {aberto ? 'Ocultar itens' : `Ver itens (${r.itens.length})`}
                      </button>
                      <AjudaCampo chave="projetos.revisao.itens" rota={ROTA} />

                      {/* Ações de decisão — só aparecem na situação em que são válidas (a RPC também valida). */}
                      {r.status === 'rascunho' && (
                        <>
                          <span style={{ flex: 1 }} />
                          <button onClick={() => abrirAcao(r, 'solicitar')} style={{ ...btn(GOLD), padding: '6px 12px' }} data-testid={`rev-solicitar-${r.id}`}>Solicitar aprovação</button>
                          <AjudaCampo chave="projetos.revisao.acao_solicitar" rota={ROTA} />
                        </>
                      )}
                      {r.status === 'solicitada' && (
                        <>
                          <span style={{ flex: 1 }} />
                          <button onClick={() => abrirAcao(r, 'aprovar')} style={{ ...btn(VERDE), padding: '6px 12px' }} data-testid={`rev-aprovar-${r.id}`}>Aprovar</button>
                          <AjudaCampo chave="projetos.revisao.acao_aprovar" rota={ROTA} />
                          <button onClick={() => abrirAcao(r, 'recusar')} style={{ ...btn('transparent', VERM), padding: '6px 12px', border: `1px solid ${VERM}` }} data-testid={`rev-recusar-${r.id}`}>Recusar</button>
                          <AjudaCampo chave="projetos.revisao.acao_recusar" rota={ROTA} />
                        </>
                      )}
                    </div>

                    {aberto && (
                      <div style={{ marginTop: 12, overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr style={{ color: MUT, textAlign: 'left' }}>
                              <th style={{ padding: '6px 8px' }}>Item</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Qtd. anterior</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Qtd. nova</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Preço ant.</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Preço novo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.itens.length === 0 ? (
                              <tr><td colSpan={5} style={{ padding: '6px 8px', color: MUT }}>Sem itens detalhados nesta revisão.</td></tr>
                            ) : r.itens.map((it, idx) => (
                              <tr key={it.id ?? idx} style={{ borderTop: `1px solid ${LINE}` }}>
                                <td style={{ padding: '6px 8px', color: ESP }}>
                                  {it.descricao || '—'}{it.unidade ? <span style={{ color: MUT }}> ({it.unidade})</span> : null}
                                  {it.motivo ? <div style={{ fontSize: 11, color: MUT }}>{it.motivo}</div> : null}
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', color: MUT }}>{num(it.quantidade_anterior)}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', color: ESP }}>{num(it.quantidade_nova)}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', color: MUT }}>{brl(it.preco_unitario_anterior)}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', color: ESP }}>{brl(it.preco_unitario_novo)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {novaAberta && (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px', overflowY: 'auto', zIndex: 50 }}
            onClick={() => { if (!salvandoNova) setNovaAberta(false) }}
          >
            <div style={{ ...card, maxWidth: 760, width: '100%', marginTop: 20 }} onClick={(e) => e.stopPropagation()} data-testid="rev-nova-modal">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: ESP, margin: 0 }}>Nova revisão de escopo</h2>
                <span style={{ flex: 1 }} />
                <button onClick={() => { if (!salvandoNova) setNovaAberta(false) }} style={{ ...btn('transparent', MUT), border: `1px solid ${LINE}`, padding: '6px 12px' }}>Fechar</button>
              </div>
              <p style={{ fontSize: 12, color: MUT, margin: '6px 0 0' }}>
                A revisão nasce como <strong>Rascunho</strong> e só muda o valor contratado quando for aprovada. A nova quantidade de um item não pode ficar abaixo do que já foi medido.
              </p>

              {erroNova && <div style={{ ...card, borderColor: VERM, color: VERM, marginTop: 12, fontSize: 13, padding: 12 }}>{erroNova}</div>}

              <div style={{ display: 'flex', gap: 16, marginTop: 14, flexWrap: 'wrap' }}>
                <label style={{ ...lbl, flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                  <span>Origem <AjudaCampo chave="projetos.revisao.form_origem" rota={ROTA} /></span>
                  <select value={fOrigem} onChange={(e) => setFOrigem(e.target.value as typeof fOrigem)} style={{ ...inp, width: 220 }} data-testid="rev-nova-origem">
                    <option value="interno">Interna</option>
                    <option value="pedido_cliente">Pedido do cliente</option>
                  </select>
                </label>
              </div>

              <label style={{ ...lbl, flexDirection: 'column', alignItems: 'flex-start', gap: 4, marginTop: 14 }}>
                <span>Motivo <AjudaCampo chave="projetos.revisao.form_motivo" rota={ROTA} /></span>
                <textarea value={fMotivo} onChange={(e) => setFMotivo(e.target.value)} rows={2}
                  placeholder="Ex.: acréscimo de 200 m² de alvenaria por mudança no projeto arquitetônico."
                  style={{ ...inp, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} data-testid="rev-nova-motivo" />
              </label>

              <div style={{ marginTop: 16, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: MUT, textAlign: 'left' }}>
                      <th style={{ padding: '6px 8px' }}>Item <AjudaCampo chave="projetos.revisao.form_item" rota={ROTA} /></th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>Qtd. atual</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>Nova qtd.</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>Preço atual</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>Novo preço</th>
                    </tr>
                  </thead>
                  <tbody>
                    {carregandoItens ? (
                      <tr><td colSpan={5} style={{ padding: '8px', color: MUT }}>Carregando itens do escopo…</td></tr>
                    ) : obraItens.length === 0 ? (
                      <tr><td colSpan={5} style={{ padding: '8px', color: MUT }}>Esta obra ainda não tem itens de escopo. Você pode registrar a revisão só com o motivo.</td></tr>
                    ) : obraItens.map((oi) => {
                      const e = fItens[oi.id] ?? { qtd: '', preco: '' }
                      const set = (patch: Partial<EdicaoItem>) => setFItens((prev) => ({ ...prev, [oi.id]: { ...e, ...patch } }))
                      return (
                        <tr key={oi.id} style={{ borderTop: `1px solid ${LINE}` }}>
                          <td style={{ padding: '6px 8px', color: ESP }}>
                            {oi.descricao || '—'}{oi.unidade ? <span style={{ color: MUT }}> ({oi.unidade})</span> : null}
                            {Number(oi.quantidade_medida) > 0 ? <div style={{ fontSize: 11, color: MUT }}>já medido: {num(oi.quantidade_medida)}</div> : null}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', color: MUT }}>{num(oi.quantidade_contratada)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                            <input value={e.qtd} onChange={(ev) => set({ qtd: ev.target.value })} inputMode="decimal"
                              placeholder={num(oi.quantidade_contratada)} style={{ ...inp, width: 90, textAlign: 'right' }} data-testid={`rev-nova-qtd-${oi.id}`} />
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', color: MUT }}>{brl(oi.preco_unitario)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                            <input value={e.preco} onChange={(ev) => set({ preco: ev.target.value })} inputMode="decimal"
                              placeholder={String(Number(oi.preco_unitario) || 0)} style={{ ...inp, width: 100, textAlign: 'right' }} data-testid={`rev-nova-preco-${oi.id}`} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {obraItens.length > 0 && <p style={{ fontSize: 11, color: MUT, margin: '8px 0 0' }}>Deixe em branco os itens que não mudaram. Só o que você preencher entra na revisão.</p>}
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                <button onClick={() => { if (!salvandoNova) setNovaAberta(false) }} style={{ ...btn('transparent', MUT), border: `1px solid ${LINE}` }}>Cancelar</button>
                <button onClick={() => void submeterNova()} disabled={salvandoNova} style={{ ...btn(GOLD), opacity: salvandoNova ? 0.6 : 1 }} data-testid="rev-nova-salvar">
                  {salvandoNova ? 'Salvando…' : 'Criar revisão (rascunho)'}
                </button>
              </div>
            </div>
          </div>
        )}

        {acao && (() => {
          const titulo = acao.tipo === 'solicitar' ? 'Enviar revisão para aprovação'
            : acao.tipo === 'aprovar' ? 'Aprovar revisão de escopo' : 'Recusar revisão de escopo'
          const deltaA = Number(acao.rev.delta) || 0
          const confirmarCor = acao.tipo === 'recusar' ? VERM : acao.tipo === 'aprovar' ? VERDE : GOLD
          const confirmarLabel = acao.tipo === 'solicitar' ? 'Solicitar aprovação'
            : acao.tipo === 'aprovar' ? 'Aprovar e mover o contrato' : 'Recusar revisão'
          return (
            <div
              style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px', overflowY: 'auto', zIndex: 50 }}
              onClick={() => { if (!salvandoAcao) setAcao(null) }}
            >
              <div style={{ ...card, maxWidth: 520, width: '100%', marginTop: 40 }} onClick={(e) => e.stopPropagation()} data-testid="rev-acao-modal">
                <h2 style={{ fontSize: 18, fontWeight: 800, color: ESP, margin: 0 }}>{titulo}</h2>
                <p style={{ fontSize: 13, color: MUT, margin: '8px 0 0' }}>
                  Revisão nº {acao.rev.sequencial}
                  {acao.rev.motivo ? <> — <span style={{ color: ESP }}>{acao.rev.motivo}</span></> : null}
                </p>

                {acao.tipo === 'solicitar' && (
                  <p style={{ fontSize: 13, color: ESP, margin: '12px 0 0' }}>
                    A revisão passa de <strong>Rascunho</strong> para <strong>Solicitada</strong> e fica pronta para ser aprovada ou recusada. Ainda não altera o valor contratado.
                  </p>
                )}
                {acao.tipo === 'aprovar' && (
                  <div style={{ ...card, background: BG, marginTop: 12, padding: 12, fontSize: 13, color: ESP }}>
                    Ao aprovar, a nova quantidade e/ou o novo preço dos itens passam a valer no contrato da obra.
                    <div style={{ display: 'flex', gap: 20, marginTop: 8, flexWrap: 'wrap' }}>
                      <span style={{ color: MUT }}>Valor anterior: <strong style={{ color: ESP }}>{brl(acao.rev.valor_anterior)}</strong></span>
                      <span style={{ color: MUT }}>Valor novo: <strong style={{ color: ESP }}>{brl(acao.rev.valor_novo)}</strong></span>
                      <span style={{ color: MUT }}>Variação: <strong style={{ color: deltaA > 0 ? VERDE : deltaA < 0 ? VERM : ESP }}>{deltaA > 0 ? '+' : ''}{brl(deltaA)}</strong></span>
                    </div>
                  </div>
                )}
                {acao.tipo === 'recusar' && (
                  <label style={{ ...lbl, flexDirection: 'column', alignItems: 'flex-start', gap: 4, marginTop: 12, width: '100%' }}>
                    <span>Motivo da recusa (opcional) <AjudaCampo chave="projetos.revisao.acao_recusar" rota={ROTA} /></span>
                    <textarea value={motivoRecusa} onChange={(e) => setMotivoRecusa(e.target.value)} rows={2}
                      placeholder="Ex.: acréscimo não aprovado pelo cliente nesta etapa."
                      style={{ ...inp, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} data-testid="rev-recusar-motivo" />
                  </label>
                )}

                {erroAcao && <div style={{ ...card, borderColor: VERM, color: VERM, marginTop: 12, fontSize: 13, padding: 12 }}>{erroAcao}</div>}

                <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                  <button onClick={() => { if (!salvandoAcao) setAcao(null) }} style={{ ...btn('transparent', MUT), border: `1px solid ${LINE}` }}>Cancelar</button>
                  <button onClick={() => void confirmarAcao()} disabled={salvandoAcao} style={{ ...btn(confirmarCor), opacity: salvandoAcao ? 0.6 : 1 }} data-testid="rev-acao-confirmar">
                    {salvandoAcao ? 'Processando…' : confirmarLabel}
                  </button>
                </div>
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
