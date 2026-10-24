'use client'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { MapPin } from 'lucide-react'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { labelUsuario } from '@/lib/usuarioLabel'
import VisitaFormModal, { type VisitaInicial, type OportunidadeOpt } from '@/components/crm/VisitaFormModal'
import { gerarOrcamentoDaVisita } from '@/lib/crm/orcamentoDaVisita'

type Row = {
  id: string
  company_id: string
  oportunidade_id: string
  data_visita: string | null
  responsavel_id: string | null
  responsavel_nome: string | null
  status: 'agendada' | 'realizada' | 'cancelada'
  endereco: string | null
  anotacoes: string | null
  gps_lat: number | null
  gps_lng: number | null
  fotos: Array<{ path: string; name?: string }> | null
  audio_briefing_url: string | null
  gerou_orcamento_id: string | null
  created_at: string
  erp_crm_oportunidade: {
    id: string
    titulo: string
    obra_endereco: string | null
    orcamento_id: string | null
    erp_clientes: { nome_fantasia: string | null; razao_social: string | null } | null
  } | null
}

const ESPRESSO = '#3D2314'
const OFFWHITE = '#FAF7F2'
const DOURADO  = '#C8941A'
const BORDA    = '#E7DED3'
const TEXTM    = '#6b5444'

const STATUS_CFG: Record<string, { l: string; bg: string; fg: string }> = {
  agendada:  { l: 'Agendada',  bg: '#FFF3D6', fg: '#7A5A0F' },
  realizada: { l: 'Realizada', bg: '#DCEFD7', fg: '#1F5A1F' },
  cancelada: { l: 'Cancelada', bg: '#F4D6D6', fg: '#7A1F1F' },
}

const fmtDT = (s: string | null) =>
  s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

// Recortes da lista: os 3 status + os recortes dos indicadores (clicar no indicador filtra a lista).
type Filtro = 'todas' | 'agendada' | 'realizada' | 'cancelada' | 'proximas' | 'atrasadas' | 'mes' | 'sem_orcamento'
const DIA = 86_400_000

// Orçamento da visita: o gerado a partir dela ou, na falta, o da oportunidade (mesma regra da ficha da oportunidade).
const orcamentoDa = (r: Row) => r.gerou_orcamento_id ?? r.erp_crm_oportunidade?.orcamento_id ?? null
const atrasada = (r: Row, agora: number) => r.status === 'agendada' && !!r.data_visita && new Date(r.data_visita).getTime() < agora
const proxima = (r: Row, agora: number) => {
  if (r.status !== 'agendada' || !r.data_visita) return false
  const t = new Date(r.data_visita).getTime()
  return t >= agora && t < agora + 7 * DIA
}
const doMes = (r: Row, agora: number) => {
  if (r.status !== 'realizada' || !r.data_visita) return false
  const d = new Date(r.data_visita), h = new Date(agora)
  return d.getFullYear() === h.getFullYear() && d.getMonth() === h.getMonth()
}
const semOrcamento = (r: Row) => r.status === 'realizada' && !orcamentoDa(r)

// Próximo passo da visita (o que o vendedor faz agora), derivado só do dado da própria visita.
function proximoPasso(r: Row, agora: number): { l: string; fg: string } | null {
  if (r.status === 'cancelada') return null
  if (atrasada(r, agora)) return { l: 'Passou da data: marque como realizada ou reagende', fg: '#7A1F1F' }
  if (r.status === 'agendada') return { l: 'Ir à visita e registrar fotos e anotações', fg: '#7A5A0F' }
  if (semOrcamento(r)) return { l: 'Gerar o orçamento desta visita', fg: '#7A5A0F' }
  return { l: 'Orçamento gerado: acompanhar na oportunidade', fg: '#1F5A1F' }
}

export default function VisitasPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState<Filtro>('todas')
  const [busca, setBusca] = useState('')
  // "agora" fixo por carga da lista: indicadores e recortes usam o mesmo instante
  const [agora, setAgora] = useState(0)
  const [responsaveis, setResponsaveis] = useState<Array<{ id: string; email: string | null; full_name?: string | null }>>([])
  const [editing, setEditing] = useState<VisitaInicial | null | undefined>(undefined)
  const [toast, setToast] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [gerandoOrc, setGerandoOrc] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!empresaUnica) { setRows([]); setLoading(false); return }
    setLoading(true)
    setErro(null)
    const { data, error } = await supabase
      .from('erp_crm_visita')
      .select('id, company_id, oportunidade_id, data_visita, responsavel_id, responsavel_nome, status, endereco, anotacoes, gps_lat, gps_lng, fotos, audio_briefing_url, gerou_orcamento_id, created_at, erp_crm_oportunidade(id, titulo, obra_endereco, orcamento_id, erp_clientes(nome_fantasia, razao_social))')
      .eq('company_id', empresaUnica)
      .order('data_visita', { ascending: false, nullsFirst: false })
    if (error) setErro('Não foi possível carregar as visitas agora. Atualize a página; se persistir, avise o suporte.')
    setAgora(Date.now())
    setRows((data ?? []) as unknown as Row[])
    setLoading(false)
  }, [empresaUnica])

  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    if (!empresaUnica) return
    // Usuários via RPC SECURITY DEFINER (users tem RLS: join direto vem vazio p/ não-admin).
    supabase
      .rpc('fn_usuarios_da_empresa', { p_company_id: empresaUnica })
      .then(({ data }) => {
        setResponsaveis((data ?? []) as { id: string; email: string | null; full_name?: string | null }[])
      })
  }, [empresaUnica])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])


  const nomeResp = useCallback((r: Row) => {
    const u = r.responsavel_id ? responsaveis.find((x) => x.id === r.responsavel_id) : null
    if (u) return labelUsuario(u, responsaveis)
    return r.responsavel_nome?.trim() || null
  }, [responsaveis])

  const kpis = useMemo(() => ({
    proximas: rows.filter((r) => proxima(r, agora)).length,
    atrasadas: rows.filter((r) => atrasada(r, agora)).length,
    mes: rows.filter((r) => doMes(r, agora)).length,
    sem_orcamento: rows.filter(semOrcamento).length,
  }), [rows, agora])

  const filtradas = useMemo(() => {
    const porRecorte = rows.filter((r) => {
      switch (filtroStatus) {
        case 'todas': return true
        case 'proximas': return proxima(r, agora)
        case 'atrasadas': return atrasada(r, agora)
        case 'mes': return doMes(r, agora)
        case 'sem_orcamento': return semOrcamento(r)
        default: return r.status === filtroStatus
      }
    })
    const termo = busca.trim().toLocaleLowerCase('pt-BR')
    if (!termo) return porRecorte
    return porRecorte.filter((r) => {
      const op = r.erp_crm_oportunidade
      return [op?.titulo, op?.erp_clientes?.nome_fantasia, op?.erp_clientes?.razao_social, r.endereco, nomeResp(r)]
        .some((t) => (t ?? '').toLocaleLowerCase('pt-BR').includes(termo))
    })
  }, [rows, filtroStatus, busca, agora, nomeResp])

  // Visita → Orçamento sem sair da lista (mesma regra da ficha da oportunidade). Confirma antes de criar.
  async function gerarOrcamento(r: Row) {
    if (!confirm('Isto vai CRIAR um orçamento vinculado à oportunidade desta visita. Continuar?')) return
    setGerandoOrc(r.id)
    const res = await gerarOrcamentoDaVisita(r.id, r.oportunidade_id)
    setGerandoOrc(null)
    if (!res.ok) { setToast(res.erro); return }
    setToast(res.criado ? `Orçamento ${res.numero ?? ''} CRIADO a partir da visita.` : 'Visita VINCULADA ao orçamento da oportunidade.')
    reload()
  }

  function abrirEdicao(r: Row) {
    setEditing({
      id: r.id,
      oportunidade_id: r.oportunidade_id,
      data_visita: r.data_visita,
      responsavel_id: r.responsavel_id,
      responsavel_nome: r.responsavel_nome,
      status: r.status,
      endereco: r.endereco,
      anotacoes: r.anotacoes,
      gps_lat: r.gps_lat,
      gps_lng: r.gps_lng,
      fotos: r.fotos,
    })
  }

  if (!empresaUnica) {
    return (
      <div className="p-4 max-w-3xl mx-auto" style={{ color: ESPRESSO }}>
        <header className="mb-4">
          <h1 className="text-xl font-bold"><MapPin className="inline-block align-[-3px] mr-1.5" size={20} aria-hidden /> Visitas técnicas</h1>
        </header>
        <div className="rounded-xl p-6 text-center" style={{ background: OFFWHITE }}>
          <p className="font-medium">Selecione uma empresa específica</p>
          <p className="text-sm opacity-70">Use o trocador da TopNav para escolher uma empresa.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-5xl mx-auto" style={{ color: ESPRESSO }}>
      <header className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold"><MapPin className="inline-block align-[-3px] mr-1.5" size={20} aria-hidden /> Visitas técnicas</h1>
          <p className="text-sm opacity-70">Vendedor em campo: agenda, registra e fotografa.</p>
        </div>
        <span className="inline-flex items-center gap-1">
          <button onClick={() => setEditing(null)} style={btnNovo} data-testid="visitas-nova">+ Nova visita</button>
          <AjudaCampo chave="projetos.visitas.nova" />
        </span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4" data-testid="visitas-indicadores">
        {([
          ['proximas', 'Próximos 7 dias', kpis.proximas, 'projetos.visitas.ind_proximas'],
          ['atrasadas', 'Passaram da data', kpis.atrasadas, 'projetos.visitas.ind_atrasadas'],
          ['mes', 'Realizadas no mês', kpis.mes, 'projetos.visitas.ind_realizadas_mes'],
          ['sem_orcamento', 'Realizadas sem orçamento', kpis.sem_orcamento, 'projetos.visitas.ind_sem_orcamento'],
        ] as const).map(([k, l, n, chave]) => (
          <div key={k} className="rounded-xl border p-3" style={{ borderColor: filtroStatus === k ? DOURADO : BORDA, background: '#fff' }}>
            <div className="flex items-center justify-between gap-1 text-xs" style={{ color: TEXTM }}>
              <span>{l}</span>
              <AjudaCampo chave={chave} />
            </div>
            <button
              onClick={() => setFiltroStatus(filtroStatus === k ? 'todas' : k)}
              className="text-2xl font-bold mt-1 text-left w-full"
              style={{ color: k === 'atrasadas' && n > 0 ? '#7A1F1F' : ESPRESSO, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
              aria-label={`${l}: ${n}. Mostrar na lista`}
              data-testid={`visitas-kpi-${k}`}
            >
              {n}
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <label className="flex items-center gap-1 text-xs grow" style={{ minWidth: 220 }}>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente, oportunidade, endereço ou responsável"
            aria-label="Buscar visitas"
            className="w-full"
            style={inputBusca}
            data-testid="visitas-busca"
          />
          <AjudaCampo chave="projetos.visitas.busca" />
        </label>
        <div role="tablist" aria-label="Status" style={chipsWrap}>
          {(['todas','agendada','realizada','cancelada'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFiltroStatus(s)}
              style={{ ...chipBtn, ...(filtroStatus === s ? chipBtnActive : {}) }}
            >
              {s === 'todas' ? 'Todas' : STATUS_CFG[s].l}
            </button>
          ))}
        </div>
        <AjudaCampo chave="projetos.visitas.filtro_status" />
        {!['todas', 'agendada', 'realizada', 'cancelada'].includes(filtroStatus) && (
          <button onClick={() => setFiltroStatus('todas')} style={btnSec}>Limpar recorte ✕</button>
        )}
        <span className="text-xs opacity-60 ml-auto">{filtradas.length} visita(s)</span>
      </div>

      {loading && <p className="opacity-60">Carregando…</p>}

      {erro && <p role="alert" className="rounded-xl p-4 mb-3 text-sm" style={{ background: OFFWHITE }}>{erro}</p>}

      {!loading && !erro && filtradas.length === 0 && (
        <div className="rounded-xl p-6 text-center" style={{ background: OFFWHITE }}>
          {rows.length === 0 ? (
            <>
              <p className="font-medium">Nenhuma visita ainda.</p>
              <p className="text-sm opacity-70">Clique em &ldquo;+ Nova visita&rdquo; para registrar.</p>
            </>
          ) : (
            <p className="font-medium">Nenhuma visita neste recorte. Mude o filtro ou limpe a busca.</p>
          )}
        </div>
      )}

      <div className="space-y-2">
        {filtradas.map((r) => {
          const cfg = STATUS_CFG[r.status] ?? { l: r.status, bg: OFFWHITE, fg: ESPRESSO }
          const resp = nomeResp(r)
          const passo = proximoPasso(r, agora)
          const orcId = orcamentoDa(r)
          const op = r.erp_crm_oportunidade
          const cliNome = op?.erp_clientes?.nome_fantasia ?? op?.erp_clientes?.razao_social ?? null
          const nFotos = (r.fotos ?? []).length
          return (
            <div
              key={r.id}
              className="rounded-xl border p-4"
              style={{ borderColor: BORDA, background: '#fff' }}
              data-testid="visita-card"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="font-semibold" style={{ color: ESPRESSO }}>{fmtDT(r.data_visita)}</div>
                  {op && (
                    <div className="text-sm" style={{ color: TEXTM }}>
                      <Link href={`/dashboard/projetos/oportunidades/${op.id}`} style={{ color: DOURADO, textDecoration: 'underline' }}>
                        {op.titulo}
                      </Link>
                      {cliNome && <span> · {cliNome}</span>}
                    </div>
                  )}
                  {r.endereco && <div className="text-xs" style={{ color: TEXTM }}>{r.endereco}</div>}
                </div>
                <span className="text-[11px] px-2 py-1 rounded-full font-medium" style={{ background: cfg.bg, color: cfg.fg }}>
                  {cfg.l}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: TEXTM }}>
                <span data-testid="visita-responsavel">Responsável: {resp ?? 'sem responsável'}</span>
                {nFotos > 0 && <span>{nFotos} foto(s)</span>}
                {r.audio_briefing_url && <span>áudio do briefing</span>}
                {r.gps_lat != null && r.gps_lng != null && (
                  <a
                    href={`https://www.google.com/maps?q=${Number(r.gps_lat)},${Number(r.gps_lng)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: DOURADO, textDecoration: 'underline' }}
                  >
                    <MapPin className="inline-block align-[-2px] mr-0.5" size={12} aria-hidden />
                    ver no mapa ({Number(r.gps_lat).toFixed(4)}, {Number(r.gps_lng).toFixed(4)})
                  </a>
                )}
              </div>
              {r.anotacoes && <p className="mt-2 text-sm line-clamp-2" style={{ color: ESPRESSO }}>{r.anotacoes}</p>}
              {passo && (
                <div className="mt-2 flex items-center gap-1 text-xs font-medium" style={{ color: passo.fg }} data-testid="visita-proximo-passo">
                  <span>Próximo passo: {passo.l}</span>
                  <AjudaCampo chave="projetos.visitas.proximo_passo" />
                </div>
              )}
              <div className="mt-3 flex gap-2 flex-wrap items-center">
                <button onClick={() => abrirEdicao(r)} style={btnSec}>Editar</button>
                {semOrcamento(r) && (
                  <button
                    onClick={() => gerarOrcamento(r)}
                    disabled={gerandoOrc === r.id}
                    style={btnPrim}
                    data-testid="visita-gerar-orcamento"
                  >
                    {gerandoOrc === r.id ? 'Gerando…' : '+ Gerar orçamento desta visita'}
                  </button>
                )}
                {op && (
                  <Link href={`/dashboard/projetos/oportunidades/${op.id}`} style={btnSec as React.CSSProperties}>
                    Abrir oportunidade →
                  </Link>
                )}
                {orcId && (
                  <Link href={`/dashboard/orcamentos?id=${orcId}`} style={btnSec as React.CSSProperties}>
                    Abrir orçamento →
                  </Link>
                )}
                <AjudaCampo chave="projetos.visitas.acoes" />
              </div>
            </div>
          )
        })}
      </div>

      {editing !== undefined && (
        <VisitaFormModal
          companyId={empresaUnica}
          oportunidadeFixa={editing?.oportunidade_id
            ? rowParaOportunidadeOpt(rows.find((r) => r.id === editing?.id))
            : null}
          initial={editing ?? undefined}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            const eraEdit = !!editing?.id
            setEditing(undefined)
            setToast(eraEdit ? 'Visita ALTERADA.' : 'Visita REGISTRADA.')
            reload()
          }}
        />
      )}

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}

function rowParaOportunidadeOpt(r: Row | undefined): OportunidadeOpt | null {
  const op = r?.erp_crm_oportunidade
  if (!op) return null
  return {
    id: op.id,
    titulo: op.titulo,
    obra_endereco: op.obra_endereco,
    cliente_nome: op.erp_clientes?.nome_fantasia ?? op.erp_clientes?.razao_social ?? null,
  }
}

const btnNovo: CSSProperties = {
  background: DOURADO, color: '#fff', border: 'none', borderRadius: 10,
  padding: '10px 16px', fontWeight: 600, cursor: 'pointer', minHeight: 44,
}
const btnSec: CSSProperties = {
  border: `1px solid ${BORDA}`, background: '#fff', color: ESPRESSO,
  borderRadius: 8, padding: '8px 12px', fontSize: 12, cursor: 'pointer',
  minHeight: 36, textDecoration: 'none', display: 'inline-block',
}
const btnPrim: CSSProperties = {
  border: `1px solid ${DOURADO}`, background: DOURADO, color: '#fff',
  borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', minHeight: 36,
}
const chipsWrap: CSSProperties = {
  display: 'inline-flex', border: `1px solid ${BORDA}`, borderRadius: 999,
  background: '#fff', padding: 2,
}
const chipBtn: CSSProperties = {
  border: 'none', background: 'transparent', color: TEXTM,
  borderRadius: 999, padding: '6px 14px', fontSize: 12, cursor: 'pointer',
  minHeight: 32, fontWeight: 600,
}
const inputBusca: CSSProperties = {
  border: `1px solid ${BORDA}`, borderRadius: 10, padding: '8px 12px', fontSize: 13,
  minHeight: 40, background: '#fff', color: ESPRESSO,
}
const chipBtnActive: CSSProperties = { background: DOURADO, color: '#fff' }
const toastStyle: CSSProperties = {
  position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
  background: ESPRESSO, color: '#fff', padding: '10px 16px', borderRadius: 10,
  fontSize: 13, zIndex: 60, maxWidth: '90vw',
}
