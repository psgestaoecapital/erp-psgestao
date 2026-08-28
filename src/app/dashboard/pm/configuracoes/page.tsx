'use client'

// SPEC PM-1 · Configurações do Sistema (P&M). Abas: Alertas (semáforo), Funil, Listas, Proposta,
// Comissão. RD-58: nada de "em breve" — cada aba tem conteúdo real. RD-26: reusa os RPCs existentes
// (fn_funil_etapa_*, fn_agency_config_*). Comissão é read-only (não há cadastro de régua — decisão CEO 28/08).

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
const VERDE = '#16A34A', VERM = '#B91C1C'
const brl = (n: number) => `R$ ${Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`

type Aba = 'alertas' | 'funil' | 'listas' | 'proposta' | 'comissao'
const ABAS: { id: Aba; label: string }[] = [
  { id: 'alertas', label: '🚦 Alertas e prazos' },
  { id: 'funil', label: '🔀 Funil' },
  { id: 'listas', label: '📋 Listas' },
  { id: 'proposta', label: '📄 Proposta' },
  { id: 'comissao', label: '💰 Comissões' },
]

export default function PMConfiguracoesPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [aba, setAba] = useState<Aba>('alertas')

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 18px' }}>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>P&amp;M · Configurações</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: ESP, margin: '2px 0 14px' }}>Configurações do Sistema</h1>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {ABAS.map((a) => (
            <button key={a.id} type="button" onClick={() => setAba(a.id)}
              style={{ fontSize: 12.5, fontWeight: 600, padding: '7px 12px', borderRadius: 9, cursor: 'pointer',
                border: `1px solid ${aba === a.id ? GOLD : LINE}`, background: aba === a.id ? '#FFF8E7' : '#FFF', color: ESP }}>
              {a.label}
            </button>
          ))}
        </div>

        {aba === 'alertas' && <AbaAlertas empresa={empresa} />}
        {aba === 'funil' && <AbaFunil empresa={empresa} />}
        {aba === 'listas' && <AbaListas empresa={empresa} />}
        {aba === 'proposta' && <AbaProposta empresa={empresa} />}
        {aba === 'comissao' && <AbaComissao empresa={empresa} />}
      </div>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }}>{children}</div>
}
function Msg({ m }: { m: string }) {
  if (!m) return null
  const err = m.startsWith('Erro')
  return <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, fontSize: 12.5, background: err ? '#FBEAEA' : '#EAF5EE', color: err ? VERM : VERDE, border: `0.5px solid ${LINE}` }}>{m}</div>
}

// ── Alertas: régua do semáforo do funil de leads ────────────────────────────────
function AbaAlertas({ empresa }: { empresa: string | null }) {
  const [rowId, setRowId] = useState<string | null>(null)
  const [amarelo, setAmarelo] = useState(7)
  const [vermelho, setVermelho] = useState(10)
  const [salvo, setSalvo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const carregar = useCallback(async () => {
    if (!empresa) return
    setMsg('')
    const { data } = await supabase.from('crm_alerta_config').select('id, dias_amarelo, dias_vermelho')
      .eq('company_id', empresa).eq('funil', 'leads').is('etapa', null).maybeSingle()
    if (data) { setRowId(data.id as string); setAmarelo(data.dias_amarelo as number); setVermelho(data.dias_vermelho as number); setSalvo(true) }
    else { setRowId(null); setAmarelo(7); setVermelho(10); setSalvo(false) }
  }, [empresa])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  async function salvar() {
    if (!empresa) return
    if (vermelho < amarelo) { setMsg('Erro: o vermelho deve ser maior ou igual ao amarelo.'); return }
    if (amarelo < 1 || vermelho < 1) { setMsg('Erro: os prazos precisam ser de pelo menos 1 dia.'); return }
    setBusy(true); setMsg('')
    let error
    if (salvo && rowId) { ({ error } = await supabase.from('crm_alerta_config').update({ dias_amarelo: amarelo, dias_vermelho: vermelho, atualizado_em: new Date().toISOString() }).eq('id', rowId)) }
    else { ({ error } = await supabase.from('crm_alerta_config').insert({ company_id: empresa, funil: 'leads', etapa: null, dias_amarelo: amarelo, dias_vermelho: vermelho })) }
    setBusy(false)
    if (error) { setMsg('Erro: ' + error.message); return }
    setMsg('✅ Régua salva. O kanban de leads já reflete (sem recarregar).')
    void carregar()
  }

  return (
    <Card>
      <div style={{ fontSize: 13, color: ESP, fontWeight: 700, marginBottom: 4 }}>Prazos do funil de leads</div>
      <div style={{ fontSize: 12, color: MUT, marginBottom: 14 }}>Dias que um lead pode ficar parado numa etapa antes de virar âmbar (atenção) e vermelho (atrasado). Vale para todas as etapas.</div>
      {!salvo && <div style={{ fontSize: 11.5, color: ESP, background: '#FFF8E7', border: `0.5px solid ${GOLD}`, borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>Ainda usando o padrão do sistema (amarelo 3 · vermelho 7). Salve para aplicar a sua régua.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <label><span style={lblS}>Dias para âmbar</span><input type="number" min={1} value={amarelo} onChange={(e) => setAmarelo(Math.max(1, Number(e.target.value) || 1))} style={inp} /></label>
        <label><span style={lblS}>Dias para vermelho</span><input type="number" min={1} value={vermelho} onChange={(e) => setVermelho(Math.max(1, Number(e.target.value) || 1))} style={inp} /></label>
      </div>
      <Msg m={msg} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button onClick={() => void salvar()} disabled={busy || !empresa} style={btnPrim(busy || !empresa)}>{busy ? 'Salvando…' : 'Salvar régua'}</button>
      </div>
    </Card>
  )
}

// ── Funil: renomear etapas, cor, ativo. A CHAVE não muda (bug que sumiu com leads). ─────────────
type Etapa = { id: string; chave: string; rotulo: string; ordem: number; cor: string | null; tipo_etapa: string; ativo: boolean }
function AbaFunil({ empresa }: { empresa: string | null }) {
  const [etapas, setEtapas] = useState<Etapa[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const carregar = useCallback(async () => {
    if (!empresa) return
    const { data } = await supabase.rpc('fn_funil_etapas_listar', { p_company_id: empresa, p_tipo_funil: 'leads' })
    setEtapas(((data ?? []) as Etapa[]).slice().sort((a, b) => a.ordem - b.ordem))
  }, [empresa])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  async function salvar(e: Etapa) {
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc('fn_funil_etapa_salvar', { p_campos: { id: e.id, rotulo: e.rotulo, ordem: e.ordem, cor: e.cor, tipo_etapa: e.tipo_etapa, ativo: e.ativo } })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || (j && j.ok === false)) { setMsg('Erro: ' + (error?.message ?? j?.erro ?? 'falhou')); return }
    setMsg('✅ Etapa salva.'); void carregar()
  }
  const patch = (id: string, p: Partial<Etapa>) => setEtapas((arr) => arr.map((x) => (x.id === id ? { ...x, ...p } : x)))

  return (
    <Card>
      <div style={{ fontSize: 13, color: ESP, fontWeight: 700, marginBottom: 4 }}>Etapas do funil de leads</div>
      <div style={{ fontSize: 12, color: MUT, marginBottom: 6 }}>Renomeie e ajuste cor/ordem. <strong>A chave interna não muda</strong> — é o que garante que nenhum lead se perca ao renomear.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {etapas.map((e) => (
          <div key={e.id} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 70px auto auto', gap: 8, alignItems: 'center', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px' }}>
            <span title={`chave: ${e.chave}`} style={{ fontSize: 10, color: MUT, fontFamily: 'monospace', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.chave}</span>
            <input value={e.rotulo} onChange={(ev) => patch(e.id, { rotulo: ev.target.value })} style={inp} />
            <input type="color" value={e.cor ?? '#E7DECF'} onChange={(ev) => patch(e.id, { cor: ev.target.value })} style={{ width: 42, height: 32, border: `1px solid ${LINE}`, borderRadius: 6, background: '#fff', cursor: 'pointer' }} />
            <button type="button" onClick={() => patch(e.id, { ativo: !e.ativo })} title="Ativa/oculta a etapa" style={{ fontSize: 11, fontWeight: 700, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${LINE}`, background: e.ativo ? '#E8F4DC' : '#F3EDE3', color: e.ativo ? '#3F7012' : MUT }}>{e.ativo ? 'ativa' : 'oculta'}</button>
            <button type="button" disabled={busy} onClick={() => void salvar(e)} style={btnPrim(busy)}>Salvar</button>
          </div>
        ))}
        {etapas.length === 0 && <div style={{ fontSize: 12.5, color: MUT }}>Nenhuma etapa configurada.</div>}
      </div>
      <Msg m={msg} />
    </Card>
  )
}

// ── Listas: opções reutilizáveis (area_equipe, periodicidade, unidade) via fn_agency_config_* ────
type Opcao = { id: string; valor: string; rotulo: string; ordem: number; ativo: boolean }
const LISTAS = [
  { id: 'area_equipe', label: 'Áreas / equipe' },
  { id: 'periodicidade', label: 'Periodicidade' },
  { id: 'unidade', label: 'Unidades' },
]
function AbaListas({ empresa }: { empresa: string | null }) {
  const [lista, setLista] = useState('area_equipe')
  const [rows, setRows] = useState<Opcao[]>([])
  const [novoRot, setNovoRot] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const carregar = useCallback(async () => {
    if (!empresa) return
    const { data } = await supabase.rpc('fn_agency_config_listar', { p_company_id: empresa, p_lista: lista })
    setRows(((data ?? []) as Opcao[]).slice().sort((a, b) => a.ordem - b.ordem))
  }, [empresa, lista])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  async function salvar(campos: Record<string, unknown>) {
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc('fn_agency_config_salvar', { p_campos: { lista, ...campos } })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || (j && j.ok === false)) { setMsg('Erro: ' + (error?.message ?? j?.erro ?? 'falhou')); return }
    void carregar()
  }
  async function excluir(id: string) {
    if (!confirm('Remover esta opção?')) return
    setBusy(true); setMsg('')
    const { error } = await supabase.rpc('fn_agency_config_excluir', { p_id: id })
    setBusy(false)
    if (error) { setMsg('Erro: ' + error.message); return }
    void carregar()
  }
  async function adicionar() {
    const r = novoRot.trim()
    if (!r) return
    await salvar({ valor: r.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), rotulo: r, ordem: (rows.at(-1)?.ordem ?? 0) + 10, ativo: true })
    setNovoRot('')
  }

  return (
    <Card>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {LISTAS.map((l) => (
          <button key={l.id} type="button" onClick={() => setLista(l.id)} style={{ fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${lista === l.id ? GOLD : LINE}`, background: lista === l.id ? '#FFF8E7' : '#FFF', color: ESP }}>{l.label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((o) => (
          <div key={o.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'center', border: `1px solid ${LINE}`, borderRadius: 8, padding: '7px 10px' }}>
            <input value={o.rotulo} onChange={(e) => setRows((arr) => arr.map((x) => (x.id === o.id ? { ...x, rotulo: e.target.value } : x)))} onBlur={() => void salvar({ id: o.id, valor: o.valor, rotulo: o.rotulo, ordem: o.ordem, ativo: o.ativo })} style={inp} />
            <button type="button" onClick={() => void salvar({ id: o.id, valor: o.valor, rotulo: o.rotulo, ordem: o.ordem, ativo: !o.ativo })} style={{ fontSize: 11, fontWeight: 700, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${LINE}`, background: o.ativo ? '#E8F4DC' : '#F3EDE3', color: o.ativo ? '#3F7012' : MUT }}>{o.ativo ? 'ativa' : 'oculta'}</button>
            <button type="button" disabled={busy} onClick={() => void excluir(o.id)} title="Remover" style={{ ...btnGhost, color: VERM, borderColor: VERM }}>✕</button>
          </div>
        ))}
        {rows.length === 0 && <div style={{ fontSize: 12.5, color: MUT }}>Nenhuma opção nesta lista ainda.</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input value={novoRot} onChange={(e) => setNovoRot(e.target.value)} placeholder="Nova opção…" style={inp} onKeyDown={(e) => { if (e.key === 'Enter') void adicionar() }} />
        <button type="button" disabled={busy || !novoRot.trim()} onClick={() => void adicionar()} style={btnPrim(busy || !novoRot.trim())}>Adicionar</button>
      </div>
      <Msg m={msg} />
    </Card>
  )
}

// ── Proposta: só settings REAIS (aplicados no editor de propostas) — RD-58 ───────────────────────
function AbaProposta({ empresa }: { empresa: string | null }) {
  const [exigir, setExigir] = useState(false)
  const [condicao, setCondicao] = useState('')
  const [descMax, setDescMax] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const carregar = useCallback(async () => {
    if (!empresa) return
    const { data } = await supabase.from('agency_proposta_config').select('exigir_item_catalogo, condicao_padrao, desconto_max_pct').eq('company_id', empresa).maybeSingle()
    setExigir(!!data?.exigir_item_catalogo)
    setCondicao((data?.condicao_padrao as string | null) ?? '')
    setDescMax(data?.desconto_max_pct != null ? String(data.desconto_max_pct) : '')
  }, [empresa])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  async function salvar() {
    if (!empresa) return
    setBusy(true); setMsg('')
    const { error } = await supabase.from('agency_proposta_config').upsert({
      company_id: empresa, exigir_item_catalogo: exigir, condicao_padrao: condicao.trim() || null,
      desconto_max_pct: descMax.trim() === '' ? null : Number(descMax), atualizado_em: new Date().toISOString(),
    }, { onConflict: 'company_id' })
    setBusy(false)
    if (error) { setMsg('Erro: ' + error.message); return }
    setMsg('✅ Configuração da proposta salva. Vale no editor de propostas.')
  }

  return (
    <Card>
      <div style={{ fontSize: 13, color: ESP, fontWeight: 700, marginBottom: 10 }}>Regras da proposta</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: ESP, marginBottom: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={exigir} onChange={(e) => setExigir(e.target.checked)} />
        Exigir que todo item venha do catálogo (bloqueia itens avulsos)
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <label><span style={lblS}>Condição de pagamento padrão</span><input value={condicao} onChange={(e) => setCondicao(e.target.value)} placeholder="ex.: Mensal" style={inp} /></label>
        <label><span style={lblS}>Desconto máximo (%) — vazio = sem limite</span><input type="number" min={0} max={100} step="0.5" value={descMax} onChange={(e) => setDescMax(e.target.value)} placeholder="sem limite" style={inp} /></label>
      </div>
      <div style={{ fontSize: 11, color: MUT, marginTop: 10 }}>Numeração (prefixo/contador) e validade padrão ficam para um próximo ajuste — dependem de mudança na função de criação da proposta, e não entram aqui como campo que não faz nada.</div>
      <Msg m={msg} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button onClick={() => void salvar()} disabled={busy || !empresa} style={btnPrim(busy || !empresa)}>{busy ? 'Salvando…' : 'Salvar regras'}</button>
      </div>
    </Card>
  )
}

// ── Comissões: read-only (não há cadastro de régua — decisão CEO). Lista o que já foi gerado. ────
type Comissao = { id: string; valor_comissao: number | null; percentual: number | null; base_valor: number | null; status: string | null; competencia: string | null; tipo: string | null }
function AbaComissao({ empresa }: { empresa: string | null }) {
  const [rows, setRows] = useState<Comissao[]>([])
  const [carregou, setCarregou] = useState(false)

  const carregar = useCallback(async () => {
    if (!empresa) return
    const { data } = await supabase.from('agency_comissao').select('id, valor_comissao, percentual, base_valor, status, competencia, tipo').eq('company_id', empresa).order('criado_em', { ascending: false })
    setRows((data ?? []) as Comissao[]); setCarregou(true)
  }, [empresa])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  return (
    <Card>
      <div style={{ fontSize: 13, color: ESP, fontWeight: 700, marginBottom: 4 }}>Comissões geradas</div>
      <div style={{ fontSize: 12, color: MUT, marginBottom: 12 }}>Comissões que já foram lançadas nas propostas aprovadas. O modelo de regra de comissão (sobre valor × margem, por vendedor × serviço) ainda não está definido — quando estiver, vira cadastro aqui.</div>
      {carregou && rows.length === 0 && <div style={{ fontSize: 12.5, color: MUT }}>Nenhuma comissão gerada ainda.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((c) => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px' }}>
            <div style={{ fontSize: 12.5, color: ESP }}>
              <strong>{brl(Number(c.valor_comissao ?? 0))}</strong>
              <span style={{ color: MUT }}> · {c.percentual != null ? `${c.percentual}%` : '—'} de {brl(Number(c.base_valor ?? 0))}{c.tipo ? ` · ${c.tipo}` : ''}</span>
            </div>
            <div style={{ fontSize: 10.5, color: MUT }}>{c.competencia ?? ''} {c.status ? `· ${c.status}` : ''}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

const inp: React.CSSProperties = { width: '100%', fontSize: 13, padding: '8px 10px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#FFF', color: ESP, boxSizing: 'border-box', fontFamily: 'inherit' }
const lblS: React.CSSProperties = { fontSize: 11, color: MUT, fontWeight: 600, display: 'block', marginBottom: 4 }
const btnGhost: React.CSSProperties = { fontSize: 12, fontWeight: 700, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${LINE}`, background: '#FFF', color: ESP }
function btnPrim(disabled: boolean): React.CSSProperties {
  return { fontSize: 12.5, fontWeight: 700, color: ESP, background: GOLD, border: 'none', borderRadius: 8, padding: '7px 14px', opacity: disabled ? 0.6 : 1, cursor: disabled ? 'default' : 'pointer' }
}
