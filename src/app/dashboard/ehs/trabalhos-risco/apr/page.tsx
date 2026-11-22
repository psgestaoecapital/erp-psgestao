// src/app/dashboard/ehs/trabalhos-risco/apr/page.tsx
// PS EHS · EHS-7 / M11 — Trabalhos de risco: Análise Preliminar de Risco (APR) por tarefa
// Antes do serviço, quebra a tarefa em etapas e, para cada etapa, levanta perigo, risco, medida de controle
// e severidade. Backend: ehs_apr + ehs_apr_etapa (RLS por empresa via get_user_company_ids). Soft delete
// (ativo=false). Padrão visual PS EHS (RD-96), "?" em todo campo (RD-95), excluir rastreável (RD-98).

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA_AJUDA = '/dashboard/ehs/trabalhos-risco/apr'

const C = {
  espresso: '#3D2314',
  offwhite: '#FAF7F2',
  gold: '#C8941A',
  beigeLt: '#f5f0e8',
  borderLt: '#ece3d2',
  ink: '#1a1a1a',
  muted: 'rgba(61, 35, 20, 0.55)',
  red: '#dc2626',
  redBg: '#fce8e8',
  green: '#15803d',
}

const STATUS: { valor: string; rotulo: string; cor: string }[] = [
  { valor: 'rascunho', rotulo: 'Rascunho', cor: C.muted },
  { valor: 'em_analise', rotulo: 'Em análise', cor: '#2563eb' },
  { valor: 'aprovada', rotulo: 'Aprovada', cor: C.green },
  { valor: 'revisar', rotulo: 'Revisar', cor: C.gold },
  { valor: 'encerrada', rotulo: 'Encerrada', cor: C.espresso },
]
const rotuloStatus = (v: string) => STATUS.find((s) => s.valor === v)?.rotulo || v
const corStatus = (v: string) => STATUS.find((s) => s.valor === v)?.cor || C.muted

const SEVERIDADES: { valor: string; rotulo: string; cor: string; peso: number }[] = [
  { valor: 'baixa', rotulo: 'Baixa', cor: C.green, peso: 1 },
  { valor: 'media', rotulo: 'Média', cor: '#2563eb', peso: 2 },
  { valor: 'alta', rotulo: 'Alta', cor: C.gold, peso: 3 },
  { valor: 'critica', rotulo: 'Crítica', cor: C.red, peso: 4 },
]
const rotuloSev = (v: string) => SEVERIDADES.find((s) => s.valor === v)?.rotulo || v
const corSev = (v: string) => SEVERIDADES.find((s) => s.valor === v)?.cor || C.muted
const pesoSev = (v: string) => SEVERIDADES.find((s) => s.valor === v)?.peso || 0

type Etapa = { id?: string; etapa: string; perigo: string; risco: string; medida_controle: string; severidade: string; ordem: number }
type APR = {
  id: string
  company_id: string
  numero: string | null
  tarefa: string
  setor: string | null
  local: string | null
  data_analise: string | null
  responsavel: string | null
  equipe: string | null
  status: string
  observacoes: string | null
  ativo: boolean
  ehs_apr_etapa?: { severidade: string }[]
}

function fmtData(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function APRPage() {
  const { companyIds, companies } = useCompanyIds()
  const companyIdsKey = useMemo(() => [...(companyIds ?? [])].sort().join(','), [companyIds])
  const multiEmpresa = (companyIds?.length ?? 0) > 1
  const [companyAlvo, setCompanyAlvo] = useState<string>('')

  useEffect(() => {
    if (!companyAlvo && companyIds && companyIds.length > 0) setCompanyAlvo(companyIds[0])
  }, [companyIds, companyAlvo])

  const empresaPorId = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of companies) m.set(c.id, c.nome_fantasia || c.razao_social || 'Empresa')
    return m
  }, [companies])

  const [lista, setLista] = useState<APR[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [showNovo, setShowNovo] = useState(false)
  const [editando, setEditando] = useState<APR | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const ids = companyIdsKey ? companyIdsKey.split(',').filter(Boolean) : []
      if (ids.length === 0) { setLista([]); return }
      const { data, error } = await supabase
        .from('ehs_apr')
        .select('id, company_id, numero, tarefa, setor, local, data_analise, responsavel, equipe, status, observacoes, ativo, ehs_apr_etapa(severidade)')
        .eq('ativo', true)
        .in('company_id', ids)
        .order('data_analise', { ascending: false, nullsFirst: false })
        .order('criado_em', { ascending: false })
      if (error) throw error
      setLista((data || []) as APR[])
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar as análises de risco')
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return lista.filter((a) => {
      if (filtroStatus && a.status !== filtroStatus) return false
      if (!q) return true
      return `${a.numero || ''} ${a.tarefa} ${a.local || ''}`.toLowerCase().includes(q)
    })
  }, [lista, busca, filtroStatus])

  function resumoEtapas(a: APR): { n: number; sev: string | null } {
    const et = a.ehs_apr_etapa || []
    if (et.length === 0) return { n: 0, sev: null }
    let maior = et[0].severidade
    for (const e of et) if (pesoSev(e.severidade) > pesoSev(maior)) maior = e.severidade
    return { n: et.length, sev: maior }
  }

  async function desativar(a: APR) {
    const motivo = prompt(`Desativar a análise "${a.tarefa}"? O histórico é preservado.\nInforme o motivo (fica registrado):`)
    if (motivo === null) return
    if (!motivo.trim()) { alert('Informe o motivo para desativar.'); return }
    try {
      const { error } = await supabase
        .from('ehs_apr')
        .update({ ativo: false, observacoes: ((a.observacoes ? a.observacoes + ' ' : '') + `[desativada: ${motivo.trim()}]`).slice(0, 2000), atualizado_em: new Date().toISOString() })
        .eq('id', a.id)
      if (error) throw error
      carregar()
    } catch (e: any) {
      alert(e?.message || 'Falha ao desativar')
    }
  }

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 16px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>EHS · Trabalhos de risco</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, fontWeight: 400, margin: '4px 0 6px' }}>Análise Preliminar de Risco (APR)</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted, maxWidth: 580 }}>
              Antes do serviço, quebre a tarefa em etapas e levante o perigo, o risco e a medida de controle de cada passo. A APR sustenta a Permissão de Trabalho.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/dashboard/ehs" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>← Voltar</Link>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button onClick={() => setShowNovo(true)} disabled={!companyAlvo}
                style={{ padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: companyAlvo ? 'pointer' : 'not-allowed', opacity: companyAlvo ? 1 : 0.5 }}>
                + Nova APR
              </button>
              <AjudaCampo chave="ehs.apr.novo" rota={ROTA_AJUDA} />
            </span>
          </div>
        </header>

        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{erro}</div>}

        {multiEmpresa && (
          <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            <label style={fieldBlock}>
              <span style={labelStyle}>Empresa-alvo para registrar análises<AjudaCampo chave="ehs.apr.empresa" rota={ROTA_AJUDA} /></span>
              <select value={companyAlvo} onChange={(e) => setCompanyAlvo(e.target.value)}
                style={{ ...inputStyle(), maxWidth: 320, backgroundColor: 'white' }}>
                {(companyIds || []).map((id) => (<option key={id} value={id}>{empresaPorId.get(id) || id}</option>))}
              </select>
            </label>
          </section>
        )}

        <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label style={{ ...fieldBlock, flex: '2 1 260px' }}>
            <span style={labelStyle}>Buscar<AjudaCampo chave="ehs.apr.busca" rota={ROTA_AJUDA} /></span>
            <input type="text" placeholder="Buscar por número, tarefa ou local…" value={busca} onChange={(e) => setBusca(e.target.value)} style={inputStyle()} />
          </label>
          <label style={{ ...fieldBlock, flex: '1 1 180px' }}>
            <span style={labelStyle}>Situação<AjudaCampo chave="ehs.apr.filtro_status" rota={ROTA_AJUDA} /></span>
            <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} style={inputStyle()}>
              <option value="">Todas</option>
              {STATUS.map((s) => (<option key={s.valor} value={s.valor}>{s.rotulo}</option>))}
            </select>
          </label>
        </section>

        <section style={{ backgroundColor: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: C.beigeLt }}>
                  <Th><span style={thLabel}>APR / Tarefa<AjudaCampo chave="ehs.apr.col_tarefa" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Setor / Local<AjudaCampo chave="ehs.apr.col_setor" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Data<AjudaCampo chave="ehs.apr.col_data" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Etapas<AjudaCampo chave="ehs.apr.col_etapas" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Situação<AjudaCampo chave="ehs.apr.col_status" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Ações<AjudaCampo chave="ehs.apr.col_acoes" rota={ROTA_AJUDA} /></span></Th>
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>)}
                {!loading && filtrados.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 28, textAlign: 'center', color: C.muted }}>
                    Nenhuma análise de risco ainda. Clique em <strong>+ Nova APR</strong> para analisar a primeira tarefa.
                  </td></tr>
                )}
                {filtrados.map((a, i) => {
                  const r = resumoEtapas(a)
                  return (
                    <tr key={a.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                      <Td>
                        <span style={{ fontWeight: 600, color: C.espresso }}>{a.tarefa}</span>
                        {a.numero && <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, marginTop: 1 }}>{a.numero}</div>}
                      </Td>
                      <Td>{[a.setor, a.local].filter(Boolean).join(' · ') || '—'}</Td>
                      <Td style={{ whiteSpace: 'nowrap' }}>{fmtData(a.data_analise)}</Td>
                      <Td style={{ whiteSpace: 'nowrap' }}>
                        {r.n > 0 ? (
                          <span>
                            {r.n} {r.n === 1 ? 'etapa' : 'etapas'}
                            {r.sev && <span style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, color: corSev(r.sev), backgroundColor: corSev(r.sev) + '1a' }}>{rotuloSev(r.sev)}</span>}
                          </span>
                        ) : <span style={{ color: C.muted }}>sem etapas</span>}
                      </Td>
                      <Td>
                        <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: corStatus(a.status), backgroundColor: corStatus(a.status) + '1a' }}>{rotuloStatus(a.status)}</span>
                      </Td>
                      <Td>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button onClick={() => setEditando(a)} style={btnMini}>Editar</button>
                          {i === 0 && <AjudaCampo chave="ehs.apr.editar" rota={ROTA_AJUDA} />}
                          <button onClick={() => desativar(a)} style={{ ...btnMini, color: C.red, border: `1px solid ${C.red}30` }}>Desativar</button>
                          {i === 0 && <AjudaCampo chave="ehs.apr.desativar" rota={ROTA_AJUDA} />}
                        </div>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {showNovo && companyAlvo && (
        <APRFormModal companyId={companyAlvo} onClose={() => setShowNovo(false)} onSaved={() => { setShowNovo(false); carregar() }} />
      )}
      {editando && (
        <APRFormModal companyId={editando.company_id} apr={editando} onClose={() => setEditando(null)} onSaved={() => { setEditando(null); carregar() }} />
      )}
    </div>
  )
}

function APRFormModal({ companyId, apr, onClose, onSaved }: { companyId: string; apr?: APR; onClose: () => void; onSaved: () => void }) {
  const [numero, setNumero] = useState(apr?.numero || '')
  const [tarefa, setTarefa] = useState(apr?.tarefa || '')
  const [setor, setSetor] = useState(apr?.setor || '')
  const [local, setLocal] = useState(apr?.local || '')
  const [dataAnalise, setDataAnalise] = useState(apr?.data_analise || '')
  const [responsavel, setResponsavel] = useState(apr?.responsavel || '')
  const [equipe, setEquipe] = useState(apr?.equipe || '')
  const [status, setStatus] = useState(apr?.status || 'rascunho')
  const [observacoes, setObservacoes] = useState(apr?.observacoes || '')
  const [etapas, setEtapas] = useState<Etapa[]>([])
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    async function carregarEtapas() {
      if (!apr?.id) { setEtapas([{ etapa: '', perigo: '', risco: '', medida_controle: '', severidade: 'media', ordem: 1 }]); return }
      const { data } = await supabase
        .from('ehs_apr_etapa')
        .select('id, etapa, perigo, risco, medida_controle, severidade, ordem')
        .eq('apr_id', apr.id)
        .eq('ativo', true)
        .order('ordem', { ascending: true })
      if (!vivo) return
      const arr = (data || []).map((e: any) => ({
        id: e.id, etapa: e.etapa || '', perigo: e.perigo || '', risco: e.risco || '',
        medida_controle: e.medida_controle || '', severidade: e.severidade || 'media', ordem: e.ordem || 1,
      })) as Etapa[]
      setEtapas(arr.length ? arr : [{ etapa: '', perigo: '', risco: '', medida_controle: '', severidade: 'media', ordem: 1 }])
    }
    carregarEtapas()
    return () => { vivo = false }
  }, [apr?.id])

  function setEtapa(idx: number, patch: Partial<Etapa>) {
    setEtapas((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }
  function addEtapa() { setEtapas((prev) => [...prev, { etapa: '', perigo: '', risco: '', medida_controle: '', severidade: 'media', ordem: prev.length + 1 }]) }
  function removeEtapa(idx: number) { setEtapas((prev) => prev.filter((_, i) => i !== idx)) }

  async function salvar() {
    if (!tarefa.trim()) { setErro('A tarefa analisada é obrigatória'); return }
    const linhas = etapas.map((e) => ({ ...e, etapa: e.etapa.trim() })).filter((e) => e.etapa)
    setSalvando(true)
    setErro(null)
    try {
      const campos = {
        numero: numero.trim() || null,
        tarefa: tarefa.trim(),
        setor: setor.trim() || null,
        local: local.trim() || null,
        data_analise: dataAnalise || null,
        responsavel: responsavel.trim() || null,
        equipe: equipe.trim() || null,
        status,
        observacoes: observacoes.trim() || null,
      }
      let aprId = apr?.id
      if (aprId) {
        const { error } = await supabase.from('ehs_apr')
          .update({ ...campos, atualizado_em: new Date().toISOString() }).eq('id', aprId)
        if (error) throw error
        const { error: delErr } = await supabase.from('ehs_apr_etapa').delete().eq('apr_id', aprId)
        if (delErr) throw delErr
      } else {
        const { data, error } = await supabase.from('ehs_apr')
          .insert({ company_id: companyId, ...campos }).select('id').single()
        if (error) throw error
        aprId = data!.id
      }
      if (linhas.length > 0) {
        const payload = linhas.map((e, i) => ({
          company_id: companyId, apr_id: aprId, ordem: i + 1, etapa: e.etapa,
          perigo: e.perigo.trim() || null, risco: e.risco.trim() || null,
          medida_controle: e.medida_controle.trim() || null, severidade: e.severidade,
        }))
        const { error: insErr } = await supabase.from('ehs_apr_etapa').insert(payload)
        if (insErr) throw insErr
      }
      onSaved()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao salvar a análise')
      setSalvando(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 12 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 22, width: 'min(680px, 96vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: '0 0 12px' }}>{apr?.id ? 'Editar análise de risco' : 'Nova análise preliminar de risco'}</h3>
        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '8px 10px', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{erro}</div>}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ ...fieldBlock, flex: '1 1 160px' }}>
            <span style={labelStyle}>Número / identificação<AjudaCampo chave="ehs.apr.numero" rota={ROTA_AJUDA} /></span>
            <input value={numero} onChange={(e) => setNumero(e.target.value)} style={inputStyle()} placeholder="Ex: APR-2026-031 (opcional)" />
          </label>
          <label style={{ ...fieldBlock, flex: '1 1 160px' }}>
            <span style={labelStyle}>Data da análise<AjudaCampo chave="ehs.apr.data" rota={ROTA_AJUDA} /></span>
            <input type="date" value={dataAnalise} onChange={(e) => setDataAnalise(e.target.value)} style={inputStyle()} />
          </label>
        </div>

        <label style={{ ...fieldBlock, marginBottom: 12 }}>
          <span style={labelStyle}>Tarefa analisada *<AjudaCampo chave="ehs.apr.tarefa" rota={ROTA_AJUDA} /></span>
          <input value={tarefa} onChange={(e) => setTarefa(e.target.value)} style={inputStyle()} placeholder="Ex: Troca de telhas na cobertura do galpão B" autoFocus />
        </label>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ ...fieldBlock, flex: '1 1 200px' }}>
            <span style={labelStyle}>Setor<AjudaCampo chave="ehs.apr.setor" rota={ROTA_AJUDA} /></span>
            <input value={setor} onChange={(e) => setSetor(e.target.value)} style={inputStyle()} placeholder="Ex: Manutenção industrial (opcional)" />
          </label>
          <label style={{ ...fieldBlock, flex: '1 1 200px' }}>
            <span style={labelStyle}>Local<AjudaCampo chave="ehs.apr.local" rota={ROTA_AJUDA} /></span>
            <input value={local} onChange={(e) => setLocal(e.target.value)} style={inputStyle()} placeholder="Ex: Cobertura do galpão B" />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ ...fieldBlock, flex: '1 1 220px' }}>
            <span style={labelStyle}>Responsável pela análise<AjudaCampo chave="ehs.apr.responsavel" rota={ROTA_AJUDA} /></span>
            <input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} style={inputStyle()} placeholder="Ex: Técnico de Segurança" />
          </label>
          <label style={{ ...fieldBlock, flex: '1 1 220px' }}>
            <span style={labelStyle}>Equipe envolvida<AjudaCampo chave="ehs.apr.equipe" rota={ROTA_AJUDA} /></span>
            <input value={equipe} onChange={(e) => setEquipe(e.target.value)} style={inputStyle()} placeholder="Quem participa da tarefa" />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ ...fieldBlock, flex: '1 1 180px' }}>
            <span style={labelStyle}>Situação<AjudaCampo chave="ehs.apr.status" rota={ROTA_AJUDA} /></span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle()}>
              {STATUS.map((s) => (<option key={s.valor} value={s.valor}>{s.rotulo}</option>))}
            </select>
          </label>
          <label style={{ ...fieldBlock, flex: '2 1 240px' }}>
            <span style={labelStyle}>Observações<AjudaCampo chave="ehs.apr.observacoes" rota={ROTA_AJUDA} /></span>
            <input value={observacoes} onChange={(e) => setObservacoes(e.target.value)} style={inputStyle()} placeholder="Restrições, condições... (opcional)" />
          </label>
        </div>

        <div style={{ borderTop: `1px solid ${C.borderLt}`, paddingTop: 12, marginBottom: 8 }}>
          <span style={{ ...labelStyle, marginBottom: 8 }}>Etapas da tarefa<AjudaCampo chave="ehs.apr.etapas" rota={ROTA_AJUDA} /></span>
          {etapas.map((e, idx) => (
            <div key={idx} style={{ border: `1px solid ${C.borderLt}`, borderRadius: 8, padding: 10, marginBottom: 8, background: C.offwhite }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginTop: 8 }}>{idx + 1}.</span>
                <div style={{ flex: 1 }}>
                  <label style={fieldBlock}>
                    <span style={labelMini}>Etapa<AjudaCampo chave="ehs.apr.etapa_descricao" rota={ROTA_AJUDA} /></span>
                    <input value={e.etapa} onChange={(ev) => setEtapa(idx, { etapa: ev.target.value })} style={inputStyle()} placeholder="Ex: Transitar sobre o telhado" />
                  </label>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                    <label style={{ ...fieldBlock, flex: '1 1 200px' }}>
                      <span style={labelMini}>Perigo<AjudaCampo chave="ehs.apr.etapa_perigo" rota={ROTA_AJUDA} /></span>
                      <input value={e.perigo} onChange={(ev) => setEtapa(idx, { perigo: ev.target.value })} style={inputStyle()} placeholder="A fonte do dano" />
                    </label>
                    <label style={{ ...fieldBlock, flex: '1 1 200px' }}>
                      <span style={labelMini}>Risco / consequência<AjudaCampo chave="ehs.apr.etapa_risco" rota={ROTA_AJUDA} /></span>
                      <input value={e.risco} onChange={(ev) => setEtapa(idx, { risco: ev.target.value })} style={inputStyle()} placeholder="O que pode acontecer" />
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8, alignItems: 'flex-end' }}>
                    <label style={{ ...fieldBlock, flex: '2 1 220px' }}>
                      <span style={labelMini}>Medida de controle<AjudaCampo chave="ehs.apr.etapa_medida" rota={ROTA_AJUDA} /></span>
                      <input value={e.medida_controle} onChange={(ev) => setEtapa(idx, { medida_controle: ev.target.value })} style={inputStyle()} placeholder="Como controlar o risco" />
                    </label>
                    <label style={{ ...fieldBlock, flex: '1 1 130px' }}>
                      <span style={labelMini}>Severidade<AjudaCampo chave="ehs.apr.etapa_severidade" rota={ROTA_AJUDA} /></span>
                      <select value={e.severidade} onChange={(ev) => setEtapa(idx, { severidade: ev.target.value })} style={inputStyle()}>
                        {SEVERIDADES.map((s) => (<option key={s.valor} value={s.valor}>{s.rotulo}</option>))}
                      </select>
                    </label>
                    <button type="button" onClick={() => removeEtapa(idx)} style={{ ...btnMini, color: C.red, border: `1px solid ${C.red}30` }}>Remover</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
          <button type="button" onClick={addEtapa} style={{ ...btnMini, borderStyle: 'dashed' }}>+ Adicionar etapa</button>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} disabled={salvando} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || !tarefa.trim()} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 12, fontWeight: 600, cursor: !salvando && tarefa.trim() ? 'pointer' : 'not-allowed', opacity: !salvando && tarefa.trim() ? 1 : 0.6 }}>
            {salvando ? 'Salvando…' : (apr?.id ? 'Salvar' : 'Criar APR')}
          </button>
        </div>
      </div>
    </div>
  )
}

const thLabel: React.CSSProperties = { display: 'inline-flex', alignItems: 'center' }
const fieldBlock: React.CSSProperties = { display: 'block' }
const labelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }
const labelMini: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', fontSize: 10.5, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }
const btnMini: React.CSSProperties = { padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 11, fontWeight: 600, cursor: 'pointer' }

function inputStyle() {
  return { width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 14, background: C.offwhite, color: C.ink, boxSizing: 'border-box' } as React.CSSProperties
}
function Th({ children }: { children: any }) {
  return (<th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(61, 35, 20, 0.65)' }}>{children}</th>)
}
function Td({ children, style }: { children: any; style?: React.CSSProperties }) {
  return (<td style={{ padding: '10px 16px', verticalAlign: 'top', ...style }}>{children}</td>)
}
