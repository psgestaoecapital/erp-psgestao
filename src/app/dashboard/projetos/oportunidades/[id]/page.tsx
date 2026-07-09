'use client'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import OportunidadeFormModal, { type OportunidadeRow } from '../OportunidadeFormModal'
import VisitaFormModal, { type VisitaInicial, type OportunidadeOpt } from '@/components/crm/VisitaFormModal'

type Oport = {
  id: string
  company_id: string
  cliente_id: string | null
  titulo: string
  etapa: string
  valor_estimado: number | null
  valor_proposta: number | null
  probabilidade: number | null
  origem: string | null
  obra_endereco: string | null
  obra_cidade: string | null
  obra_bairro: string | null
  responsavel_id: string | null
  responsavel_nome: string | null
  data_prevista_fechamento: string | null
  data_fechamento: string | null
  motivo_perda: string | null
  orcamento_id: string | null
  observacoes: string | null
  created_at: string
  erp_clientes: {
    id: string
    nome_fantasia: string | null
    razao_social: string | null
    cpf_cnpj: string | null
    telefone: string | null
    email: string | null
  } | null
}

type Interacao = {
  id: string
  tipo: string
  descricao: string
  data_interacao: string
  autor_id: string | null
}

type Visita = {
  id: string
  data_visita: string | null
  responsavel_id: string | null
  status: string
  endereco: string | null
  anotacoes: string | null
  fotos: Array<{ path: string; name?: string }> | null
  gps_lat: number | null
  gps_lng: number | null
  gerou_orcamento_id: string | null
  created_at: string
}

type UserOpt = { id: string; email: string | null }

const ETAPAS: { v: string; l: string; bg: string; fg: string }[] = [
  { v: 'prospeccao',       l: 'Prospecção',       bg: '#F0E9DE', fg: '#6b5444' },
  { v: 'visita_agendada',  l: 'Visita agendada',  bg: '#FFF3D6', fg: '#7A5A0F' },
  { v: 'visita_feita',     l: 'Visita feita',     bg: '#E7DED3', fg: '#3D2314' },
  { v: 'orcando',          l: 'Orçando',          bg: '#FCE9C2', fg: '#7A5A0F' },
  { v: 'proposta_enviada', l: 'Proposta enviada', bg: '#FAD18A', fg: '#5A3D08' },
  { v: 'negociacao',       l: 'Negociação',       bg: '#F4B860', fg: '#3D2314' },
  { v: 'ganho',            l: 'Ganho',            bg: '#DCEFD7', fg: '#1F5A1F' },
  { v: 'perdido',          l: 'Perdido',          bg: '#F4D6D6', fg: '#7A1F1F' },
]
const etapaCfg = (v: string) => ETAPAS.find((e) => e.v === v) ?? { v, l: v, bg: '#FAF7F2', fg: '#3D2314' }

const ESPRESSO = '#3D2314'
const OFFWHITE = '#FAF7F2'
const DOURADO  = '#C8941A'
const BORDA    = '#E7DED3'
const TEXTM    = '#6b5444'

const TIPOS_INT = ['ligacao', 'whatsapp', 'email', 'nota', 'visita', 'proposta'] as const

const brl = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

export default function OportunidadeFichaPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params?.id ?? ''

  const [op, setOp] = useState<Oport | null>(null)
  const [interacoes, setInteracoes] = useState<Interacao[]>([])
  const [visitas, setVisitas] = useState<Visita[]>([])
  const [users, setUsers] = useState<UserOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [novaIntOpen, setNovaIntOpen] = useState(false)
  const [visitaEditando, setVisitaEditando] = useState<VisitaInicial | null | undefined>(undefined)
  const [gerandoOrc, setGerandoOrc] = useState(false)
  const [gerandoOrcDeVisita, setGerandoOrcDeVisita] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const [o, i, v] = await Promise.all([
      supabase
        .from('erp_crm_oportunidade')
        .select('*, erp_clientes(id, nome_fantasia, razao_social, cpf_cnpj, telefone, email)')
        .eq('id', id)
        .maybeSingle(),
      supabase.from('erp_crm_interacao').select('*').eq('oportunidade_id', id).order('data_interacao', { ascending: false }),
      supabase.from('erp_crm_visita').select('*').eq('oportunidade_id', id).order('created_at', { ascending: false }),
    ])
    setOp((o.data ?? null) as unknown as Oport | null)
    setInteracoes((i.data ?? []) as Interacao[])
    setVisitas((v.data ?? []) as unknown as Visita[])
    setLoading(false)
  }, [id])

  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    if (!op?.company_id) return
    supabase
      .from('user_companies')
      .select('users(id, email)')
      .eq('company_id', op.company_id)
      .then(({ data }) => {
        const list = (data ?? []) as unknown as Array<{ users: UserOpt | UserOpt[] | null }>
        const flat: UserOpt[] = []
        for (const r of list) {
          const u = Array.isArray(r.users) ? r.users[0] : r.users
          if (u) flat.push(u)
        }
        setUsers(flat)
      })
  }, [op?.company_id])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  async function moverEtapa(nova: string) {
    if (!op) return
    let motivo: string | null = null
    if (nova === 'perdido') {
      const m = prompt('Motivo da perda (opcional):', '')
      if (m === null) return
      motivo = m || null
    }
    const { data, error } = await supabase.rpc('fn_crm_mover_etapa', {
      p_id: op.id, p_etapa: nova, p_motivo_perda: motivo,
    })
    if (error) { setToast(`Erro: ${error.message}`); return }
    const r = data as { ok?: boolean; erro?: string } | null
    if (r && r.ok === false) { setToast(`Erro: ${r.erro ?? 'falha'}`); return }
    setToast(`Etapa ALTERADA para ${etapaCfg(nova).l}.`)
    reload()
  }

  async function excluir() {
    if (!op) return
    if (!confirm(`EXCLUIR oportunidade "${op.titulo}"?\n\nIsso remove também todas as interações e visitas vinculadas. Não pode ser desfeito.`)) return
    const { error } = await supabase.from('erp_crm_oportunidade').delete().eq('id', op.id)
    if (error) { setToast(`Erro: ${error.message}`); return }
    router.push('/dashboard/projetos/oportunidades')
  }

  async function criarOrcamentoBase(): Promise<{ id: string; numero: string } | null> {
    if (!op) return null
    if (!op.cliente_id) { setToast('Defina o cliente da oportunidade antes.'); return null }
    const cli = op.erp_clientes
    const nomeCli = cli?.nome_fantasia ?? cli?.razao_social ?? ''
    const { data: numero, error: numErr } = await supabase.rpc('next_orcamento_numero', { p_company_id: op.company_id })
    if (numErr) { setToast(`Erro: ${numErr.message}`); return null }
    const hoje = new Date().toISOString().slice(0, 10)
    const valid = new Date(); valid.setDate(valid.getDate() + 15)
    const { data: orc, error: oErr } = await supabase
      .from('erp_orcamentos')
      .insert({
        company_id: op.company_id,
        numero: numero as string,
        versao: 1,
        cliente_id: op.cliente_id,
        cliente_nome: nomeCli,
        cliente_cnpj: cli?.cpf_cnpj ?? null,
        cliente_email: cli?.email ?? null,
        cliente_telefone: cli?.telefone ?? null,
        data_emissao: hoje,
        data_validade: valid.toISOString().slice(0, 10),
        status: 'rascunho',
        subtotal: 0, total: 0,
        observacoes: op.observacoes ?? null,
      })
      .select('id, numero')
      .single()
    if (oErr) { setToast(`Erro: ${oErr.message}`); return null }
    return orc as { id: string; numero: string }
  }

  async function gerarOrcamento() {
    if (!op) return
    setGerandoOrc(true)
    const o = await criarOrcamentoBase()
    if (!o) { setGerandoOrc(false); return }
    await supabase.from('erp_crm_oportunidade').update({ orcamento_id: o.id }).eq('id', op.id)
    setGerandoOrc(false)
    setToast(`Orçamento ${o.numero} CRIADO.`)
    reload()
  }

  async function gerarOrcamentoDaVisita(visitaId: string) {
    if (!op) return
    setGerandoOrcDeVisita(visitaId)
    let orcId = op.orcamento_id
    let numero = ''
    if (!orcId) {
      const o = await criarOrcamentoBase()
      if (!o) { setGerandoOrcDeVisita(null); return }
      orcId = o.id
      numero = o.numero
      await supabase.from('erp_crm_oportunidade').update({ orcamento_id: orcId }).eq('id', op.id)
    }
    await supabase.from('erp_crm_visita').update({ gerou_orcamento_id: orcId }).eq('id', visitaId)
    setGerandoOrcDeVisita(null)
    setToast(numero ? `Orçamento ${numero} CRIADO a partir da visita.` : 'Visita vinculada ao orçamento.')
    reload()
  }

  if (loading) return <p className="p-4 opacity-60">Carregando…</p>
  if (!op) return (
    <div className="p-4 max-w-3xl mx-auto">
      <p className="opacity-70">Oportunidade não encontrada.</p>
      <Link href="/dashboard/projetos/oportunidades" className="text-[#C8941A] underline">Voltar ao funil</Link>
    </div>
  )

  const cfg = etapaCfg(op.etapa)
  const cliNome = op.erp_clientes?.nome_fantasia ?? op.erp_clientes?.razao_social ?? '—'
  // Responsável = texto livre (op.responsavel_nome); fallback ao e-mail do usuário legado.
  const respNome = op.responsavel_nome || users.find((u) => u.id === op.responsavel_id)?.email || null

  return (
    <div className="p-4 max-w-4xl mx-auto" style={{ color: ESPRESSO }}>
      <div className="mb-3">
        <Link href="/dashboard/projetos/oportunidades" className="text-sm" style={{ color: DOURADO }}>← Voltar ao funil</Link>
      </div>

      {/* Cabeçalho */}
      <div className="rounded-xl border p-4 mb-4" style={{ borderColor: BORDA, background: '#fff' }}>
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">{op.titulo}</h1>
            <p className="text-sm" style={{ color: TEXTM }}>
              {cliNome}{op.erp_clientes?.cpf_cnpj ? ` · ${op.erp_clientes.cpf_cnpj}` : ''}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setEditing(true)} style={btnGhost}>Editar</button>
            <button onClick={excluir} style={btnDanger}>EXCLUIR</button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <Kpi titulo="Valor estimado" valor={brl(op.valor_estimado)} destaque />
          {op.valor_proposta != null && <Kpi titulo="Valor proposta" valor={brl(op.valor_proposta)} />}
          <Kpi titulo="Probabilidade" valor={`${op.probabilidade ?? 0}%`} />
          <Kpi titulo="Fechamento previsto" valor={op.data_prevista_fechamento ?? '—'} />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm" style={{ color: TEXTM }}>Etapa:</span>
          <span className="text-xs px-2 py-1 rounded-full font-medium" style={{ background: cfg.bg, color: cfg.fg }}>
            {cfg.l}
          </span>
          <select
            value={op.etapa}
            onChange={(e) => moverEtapa(e.target.value)}
            style={selSt}
          >
            {ETAPAS.map((e) => <option key={e.v} value={e.v}>Mover para: {e.l}</option>)}
          </select>
          {respNome && <span className="text-sm ml-auto" style={{ color: TEXTM }}>resp: {respNome}</span>}
        </div>
        {op.motivo_perda && (
          <p className="text-sm mt-2" style={{ color: '#7A1F1F' }}><strong>Motivo da perda:</strong> {op.motivo_perda}</p>
        )}
      </div>

      {/* Dados da obra */}
      {(op.obra_endereco || op.obra_cidade || op.obra_bairro) && (
        <Sec titulo="Obra">
          <p style={{ color: TEXTM, fontSize: 13 }}>
            {[op.obra_endereco, op.obra_bairro, op.obra_cidade].filter(Boolean).join(' · ')}
          </p>
        </Sec>
      )}

      {/* Orçamento */}
      <Sec titulo="Orçamento">
        {op.orcamento_id ? (
          <Link
            href={`/dashboard/orcamentos?id=${op.orcamento_id}`}
            className="inline-block px-3 py-2 rounded-lg text-sm"
            style={{ background: OFFWHITE, color: ESPRESSO, border: `1px solid ${BORDA}` }}
          >
            Abrir orçamento vinculado →
          </Link>
        ) : (
          <button onClick={gerarOrcamento} disabled={gerandoOrc} style={btnPrimary}>
            {gerandoOrc ? 'Gerando…' : '+ CRIAR orçamento'}
          </button>
        )}
      </Sec>

      {/* Visitas */}
      <Sec
        titulo="Visitas técnicas"
        acao={<button onClick={() => setVisitaEditando(null)} style={btnSec}>+ Agendar / registrar visita</button>}
      >
        {visitas.length === 0 ? (
          <p style={{ color: TEXTM, fontSize: 13 }}>Nenhuma visita registrada.</p>
        ) : (
          <div className="space-y-2">
            {visitas.map((v) => {
              const r = users.find((u) => u.id === v.responsavel_id)
              const statusCfg =
                v.status === 'realizada' ? { bg: '#DCEFD7', fg: '#1F5A1F' }
                  : v.status === 'cancelada' ? { bg: '#F4D6D6', fg: '#7A1F1F' }
                    : { bg: '#FFF3D6', fg: '#7A5A0F' }
              const podeGerarOrc = v.status === 'realizada' && !v.gerou_orcamento_id
              const gerandoEsta = gerandoOrcDeVisita === v.id
              return (
                <div key={v.id} className="rounded-lg border p-3" style={{ borderColor: BORDA, background: '#fff' }}>
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                    <div className="font-medium text-sm">{fmtDate(v.data_visita)}</div>
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: statusCfg.bg, color: statusCfg.fg }}>
                      {v.status}
                    </span>
                  </div>
                  {v.endereco && <div className="text-xs" style={{ color: TEXTM }}>{v.endereco}</div>}
                  {r && <div className="text-xs" style={{ color: TEXTM }}>resp: {r.email}</div>}
                  {v.anotacoes && <p className="text-sm mt-1">{v.anotacoes}</p>}
                  {v.fotos && v.fotos.length > 0 && <FotosVisita fotos={v.fotos} />}
                  <div className="mt-2 flex gap-2 flex-wrap">
                    <button
                      onClick={() => setVisitaEditando({
                        id: v.id,
                        oportunidade_id: op.id,
                        data_visita: v.data_visita,
                        responsavel_id: v.responsavel_id,
                        status: v.status as VisitaInicial['status'],
                        endereco: v.endereco,
                        anotacoes: v.anotacoes,
                        gps_lat: v.gps_lat,
                        gps_lng: v.gps_lng,
                        fotos: v.fotos,
                      })}
                      style={btnSec}
                    >
                      Editar
                    </button>
                    {podeGerarOrc && (
                      <button
                        onClick={() => gerarOrcamentoDaVisita(v.id)}
                        disabled={gerandoEsta}
                        style={btnSec}
                      >
                        {gerandoEsta ? 'Gerando…' : '+ Gerar orçamento desta visita'}
                      </button>
                    )}
                    {v.gerou_orcamento_id && (
                      <Link
                        href={`/dashboard/orcamentos?id=${v.gerou_orcamento_id}`}
                        style={btnSec as React.CSSProperties}
                      >
                        Abrir orçamento desta visita →
                      </Link>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Sec>

      {/* Timeline interações */}
      <Sec
        titulo="Interações"
        acao={<button onClick={() => setNovaIntOpen(true)} style={btnSec}>+ Registrar interação</button>}
      >
        {interacoes.length === 0 ? (
          <p style={{ color: TEXTM, fontSize: 13 }}>Nenhuma interação registrada.</p>
        ) : (
          <ul className="space-y-2">
            {interacoes.map((i) => (
              <li key={i.id} className="rounded-lg border p-3" style={{ borderColor: BORDA, background: '#fff' }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                        style={{ background: OFFWHITE, color: ESPRESSO }}>
                    {i.tipo}
                  </span>
                  <span className="text-xs" style={{ color: TEXTM }}>{fmtDate(i.data_interacao)}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{i.descricao}</p>
              </li>
            ))}
          </ul>
        )}
      </Sec>

      {op.observacoes && (
        <Sec titulo="Observações">
          <p className="text-sm whitespace-pre-wrap" style={{ color: TEXTM }}>{op.observacoes}</p>
        </Sec>
      )}

      {toast && <div style={toastStyle}>{toast}</div>}

      {editing && (
        <OportunidadeFormModal
          companyId={op.company_id}
          initial={op as unknown as OportunidadeRow}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); reload() }}
        />
      )}

      {novaIntOpen && (
        <NovaInteracaoModal
          companyId={op.company_id}
          oportunidadeId={op.id}
          onClose={() => setNovaIntOpen(false)}
          onSaved={() => { setNovaIntOpen(false); reload(); setToast('Interação REGISTRADA.') }}
        />
      )}

      {visitaEditando !== undefined && (
        <VisitaFormModal
          companyId={op.company_id}
          oportunidadeFixa={{
            id: op.id,
            titulo: op.titulo,
            obra_endereco: op.obra_endereco,
            cliente_nome: op.erp_clientes?.nome_fantasia ?? op.erp_clientes?.razao_social ?? null,
          } as OportunidadeOpt}
          initial={visitaEditando ?? undefined}
          onClose={() => setVisitaEditando(undefined)}
          onSaved={() => {
            const eraEdit = !!visitaEditando?.id
            setVisitaEditando(undefined)
            setToast(eraEdit ? 'Visita ALTERADA.' : 'Visita REGISTRADA.')
            reload()
          }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
function FotosVisita({ fotos }: { fotos: Array<{ path: string; name?: string }> }) {
  const [urls, setUrls] = useState<Array<string | null>>([])
  useEffect(() => {
    let alive = true
    void (async () => {
      const resolved: Array<string | null> = []
      for (const f of fotos) {
        const r = await supabase.storage.from('projetos-plantas').createSignedUrl(f.path, 3600)
        resolved.push(r.data?.signedUrl ?? null)
      }
      if (alive) setUrls(resolved)
    })()
    return () => { alive = false }
  }, [fotos])
  return (
    <div className="flex gap-2 mt-2 flex-wrap">
      {fotos.map((f, i) => urls[i] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} src={urls[i]!} alt={f.name ?? `foto ${i + 1}`}
             style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: `1px solid ${BORDA}` }} />
      ) : (
        <div key={i} style={{ width: 80, height: 80, borderRadius: 8, background: '#FAF7F2', border: `1px solid ${BORDA}` }} />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
function Sec({ titulo, acao, children }: { titulo: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <h2 className="text-sm font-semibold" style={{ color: DOURADO }}>{titulo}</h2>
        {acao}
      </div>
      <div className="rounded-xl p-3" style={{ background: OFFWHITE }}>{children}</div>
    </section>
  )
}

function Kpi({ titulo, valor, destaque }: { titulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="rounded-lg p-2" style={{ background: OFFWHITE }}>
      <div className="text-[11px] uppercase opacity-60 leading-tight">{titulo}</div>
      <div className="font-bold leading-tight" style={{ color: destaque ? DOURADO : ESPRESSO, fontSize: 16 }}>{valor}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
function NovaInteracaoModal({
  companyId, oportunidadeId, onClose, onSaved,
}: { companyId: string; oportunidadeId: string; onClose: () => void; onSaved: () => void }) {
  const [tipo, setTipo] = useState<typeof TIPOS_INT[number]>('nota')
  const [descricao, setDescricao] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function salvar() {
    if (!descricao.trim()) { setErr('Descreva a interação.'); return }
    setSaving(true)
    const { error } = await supabase.from('erp_crm_interacao').insert({
      company_id: companyId,
      oportunidade_id: oportunidadeId,
      tipo,
      descricao: descricao.trim(),
    })
    setSaving(false)
    if (error) { setErr(error.message); return }
    onSaved()
  }

  return (
    <div style={overlay}>
      <div style={{ ...card, maxWidth: 520 }}>
        <div style={head}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: ESPRESSO, margin: 0 }}>Nova interação</h2>
          <button onClick={onClose} style={closeBtn} aria-label="Fechar">✕</button>
        </div>
        <label style={lbl}>
          Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof TIPOS_INT[number])} style={inp}>
            {TIPOS_INT.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label style={{ ...lbl, marginTop: 10 }}>
          Descrição *
          <textarea
            rows={4}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="O que aconteceu? (ex.: Cliente pediu para reagendar para sexta…)"
            style={{ ...inp, resize: 'vertical' }}
          />
        </label>
        {err && <p style={{ color: '#b00', fontSize: 13, marginTop: 8 }}>Erro: {err}</p>}
        <div style={actions}>
          <button onClick={onClose} style={btnGhost}>Cancelar</button>
          <button onClick={salvar} disabled={saving || !descricao.trim()} style={btnPrimary}>
            {saving ? 'Salvando…' : 'REGISTRAR'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── styles ──────────────────────────────────────────────────
const overlay: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
  padding: 16, zIndex: 50, overflow: 'auto',
}
const card: CSSProperties = { background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 640 }
const head: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }
const closeBtn: CSSProperties = {
  border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', minWidth: 44, minHeight: 44,
}
const grid: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10,
}
const lbl: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#6b6b6b' }
const inp: CSSProperties = {
  border: `1px solid ${BORDA}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, minHeight: 40,
}
const selSt: CSSProperties = {
  border: `1px solid ${BORDA}`, background: '#fff', borderRadius: 8, padding: '6px 10px',
  fontSize: 12, color: ESPRESSO, colorScheme: 'light' as CSSProperties['colorScheme'],
}
const actions: CSSProperties = {
  display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16,
}
const btnPrimary: CSSProperties = {
  border: 'none', background: DOURADO, color: '#fff', borderRadius: 10,
  padding: '10px 16px', cursor: 'pointer', fontWeight: 600, minHeight: 44,
}
const btnGhost: CSSProperties = {
  border: `1px solid ${BORDA}`, background: '#fff', borderRadius: 10,
  padding: '10px 16px', cursor: 'pointer', minHeight: 44,
}
const btnSec: CSSProperties = {
  border: `1px solid ${BORDA}`, background: '#fff', borderRadius: 8,
  padding: '8px 12px', fontSize: 12, cursor: 'pointer', minHeight: 36,
}
const btnDanger: CSSProperties = {
  border: '1px solid #E5C2C2', background: '#fff', color: '#9A1F1F',
  borderRadius: 10, padding: '10px 16px', fontSize: 12, cursor: 'pointer', minHeight: 44,
}
const toastStyle: CSSProperties = {
  position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
  background: ESPRESSO, color: '#fff', padding: '10px 16px', borderRadius: 10,
  fontSize: 13, zIndex: 60, maxWidth: '90vw',
}
