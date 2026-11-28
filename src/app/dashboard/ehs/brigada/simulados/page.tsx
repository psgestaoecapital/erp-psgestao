// src/app/dashboard/ehs/brigada/simulados/page.tsx
// PS EHS · EHS-9c / M14 — Brigada de incêndio (NR-23) · fatia 2: SIMULADOS / treinos de abandono
// Registro dos simulados (tipo, data, local, cenário), tempo de evacuação, participantes, brigadistas
// presentes, avaliação, pontos de melhoria e próxima data planejada. Backend: ehs_brigada_simulado
// (RLS por empresa via get_user_company_ids). Soft delete rastreável (ativo=false + motivo).
// RD-95: cada controle fica dentro de um <label> que contém o "?" (AjudaCampo), visível ao usuário e detectável pelo gate.

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { parseNumBR } from '@/lib/num'

const ROTA_AJUDA = '/dashboard/ehs/brigada/simulados'

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
  green: '#16a34a',
  amber: '#ea580c',
}

const TIPOS: { v: string; label: string }[] = [
  { v: 'abandono', label: 'Abandono' },
  { v: 'combate_incendio', label: 'Combate a incêndio' },
  { v: 'primeiros_socorros', label: 'Primeiros socorros' },
  { v: 'evacuacao', label: 'Evacuação' },
  { v: 'vazamento', label: 'Vazamento' },
  { v: 'outros', label: 'Outros' },
]
const AVALIACOES: { v: string; label: string }[] = [
  { v: 'otimo', label: 'Ótimo' },
  { v: 'bom', label: 'Bom' },
  { v: 'regular', label: 'Regular' },
  { v: 'ruim', label: 'Ruim' },
]
const rotuloTipo = (v: string) => TIPOS.find((t) => t.v === v)?.label || v
const rotuloAval = (v: string | null) => (v ? AVALIACOES.find((t) => t.v === v)?.label || v : '')

type Simulado = {
  id: string
  company_id: string
  data_simulado: string
  tipo: string
  local: string | null
  cenario: string | null
  duracao_min: number | null
  tempo_evacuacao_min: number | null
  participantes: number | null
  brigadistas_presentes: number | null
  avaliacao: string | null
  pontos_melhoria: string | null
  responsavel: string | null
  proxima_data: string | null
  observacao: string | null
  ativo: boolean
}

function formatarData(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso + (iso.length <= 10 ? 'T00:00:00' : ''))
  if (isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}
function proximaVencida(iso: string | null): boolean {
  if (!iso) return false
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return false
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  return d.getTime() < hoje.getTime()
}
function numBR(n: number | null): string {
  if (n === null || n === undefined) return '—'
  return String(n).replace('.', ',')
}

export default function SimuladosBrigadaPage() {
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

  const [registros, setRegistros] = useState<Simulado[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroAvaliacao, setFiltroAvaliacao] = useState('')
  const [showNovo, setShowNovo] = useState(false)
  const [editando, setEditando] = useState<Simulado | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const ids = companyIdsKey ? companyIdsKey.split(',').filter(Boolean) : []
      if (ids.length === 0) { setRegistros([]); return }
      const { data, error } = await supabase
        .from('ehs_brigada_simulado')
        .select('id, company_id, data_simulado, tipo, local, cenario, duracao_min, tempo_evacuacao_min, participantes, brigadistas_presentes, avaliacao, pontos_melhoria, responsavel, proxima_data, observacao, ativo')
        .eq('ativo', true)
        .in('company_id', ids)
        .order('data_simulado', { ascending: false })
      if (error) throw error
      setRegistros((data || []) as Simulado[])
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar os simulados')
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return registros.filter((s) => {
      if (filtroTipo && s.tipo !== filtroTipo) return false
      if (filtroAvaliacao && s.avaliacao !== filtroAvaliacao) return false
      if (!q) return true
      return `${s.local || ''} ${s.cenario || ''} ${s.responsavel || ''}`.toLowerCase().includes(q)
    })
  }, [registros, busca, filtroTipo, filtroAvaliacao])

  const resumo = useMemo(() => {
    let comMelhoria = 0, proxVencida = 0
    for (const s of registros) {
      if (s.pontos_melhoria && s.pontos_melhoria.trim()) comMelhoria++
      if (proximaVencida(s.proxima_data)) proxVencida++
    }
    return { total: registros.length, comMelhoria, proxVencida }
  }, [registros])

  async function desativar(s: Simulado) {
    const motivo = prompt(`Desativar o simulado "${rotuloTipo(s.tipo)} · ${formatarData(s.data_simulado)}"?\nInforme o motivo (fica registrado):`)
    if (motivo === null) return
    if (!motivo.trim()) { alert('Informe o motivo para desativar.'); return }
    try {
      const { data: userData } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('ehs_brigada_simulado')
        .update({ ativo: false, excluido_em: new Date().toISOString(), excluido_por: userData?.user?.id ?? null, excluido_motivo: motivo.trim(), atualizado_em: new Date().toISOString() })
        .eq('id', s.id)
      if (error) throw error
      carregar()
    } catch (err: any) {
      alert(err?.message || 'Falha ao desativar')
    }
  }

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 16px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>EHS · Brigada · NR-23 · Simulados</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, fontWeight: 400, margin: '4px 0 6px' }}>Simulados de abandono</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted, maxWidth: 620 }}>
              Registre os simulados e treinos da brigada — tipo, cenário, tempo de evacuação, participantes e avaliação — e planeje o próximo exercício.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/dashboard/ehs/brigada" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>← Brigada</Link>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button onClick={() => setShowNovo(true)} disabled={!companyAlvo}
                style={{ padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: companyAlvo ? 'pointer' : 'not-allowed', opacity: companyAlvo ? 1 : 0.5 }}>
                + Registrar simulado
              </button>
              <AjudaCampo chave="ehs.brigsim.novo" rota={ROTA_AJUDA} />
            </span>
          </div>
        </header>

        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{erro}</div>}

        {!loading && registros.length > 0 && (resumo.comMelhoria > 0 || resumo.proxVencida > 0) && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            {resumo.proxVencida > 0 && <span style={{ ...pill, backgroundColor: C.redBg, color: C.red }}>● {resumo.proxVencida} com próximo simulado vencido</span>}
            {resumo.comMelhoria > 0 && <span style={{ ...pill, backgroundColor: '#fff4e6', color: C.amber }}>● {resumo.comMelhoria} com pontos de melhoria</span>}
          </div>
        )}

        {multiEmpresa && (
          <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            <label style={{ display: 'block' }}>
              <span style={labelInline}>Empresa-alvo para registrar o simulado<AjudaCampo chave="ehs.brigsim.empresa" rota={ROTA_AJUDA} /></span>
              <select value={companyAlvo} onChange={(e) => setCompanyAlvo(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', minWidth: 240, marginTop: 6, display: 'block' }}>
                {(companyIds || []).map((id) => (<option key={id} value={id}>{empresaPorId.get(id) || id}</option>))}
              </select>
            </label>
          </section>
        )}

        <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label style={{ flex: '2 1 220px', display: 'block' }}>
            <span style={labelInline}>Buscar<AjudaCampo chave="ehs.brigsim.busca" rota={ROTA_AJUDA} /></span>
            <input type="text" placeholder="Buscar por local, cenário ou responsável…" value={busca} onChange={(e) => setBusca(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: C.offwhite, marginTop: 6 }} />
          </label>
          <label style={{ flex: '1 1 150px', display: 'block' }}>
            <span style={labelInline}>Tipo<AjudaCampo chave="ehs.brigsim.filtro_tipo" rota={ROTA_AJUDA} /></span>
            <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', marginTop: 6 }}>
              <option value="">Todos</option>
              {TIPOS.map((t) => (<option key={t.v} value={t.v}>{t.label}</option>))}
            </select>
          </label>
          <label style={{ flex: '1 1 150px', display: 'block' }}>
            <span style={labelInline}>Avaliação<AjudaCampo chave="ehs.brigsim.filtro_avaliacao" rota={ROTA_AJUDA} /></span>
            <select value={filtroAvaliacao} onChange={(e) => setFiltroAvaliacao(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', marginTop: 6 }}>
              <option value="">Todas</option>
              {AVALIACOES.map((t) => (<option key={t.v} value={t.v}>{t.label}</option>))}
            </select>
          </label>
        </section>

        <section style={{ backgroundColor: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: C.beigeLt }}>
                  <Th><span style={thLabel}>Simulado<AjudaCampo chave="ehs.brigsim.col_simulado" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Local<AjudaCampo chave="ehs.brigsim.col_local" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Participação<AjudaCampo chave="ehs.brigsim.col_participacao" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Avaliação<AjudaCampo chave="ehs.brigsim.col_avaliacao" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Próximo<AjudaCampo chave="ehs.brigsim.col_proxima" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Ações<AjudaCampo chave="ehs.brigsim.col_acoes" rota={ROTA_AJUDA} /></span></Th>
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>)}
                {!loading && filtrados.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 28, textAlign: 'center', color: C.muted }}>
                    Nenhum simulado registrado ainda. Clique em <strong>+ Registrar simulado</strong> para lançar o primeiro treino de abandono.
                  </td></tr>
                )}
                {filtrados.map((s, idx) => {
                  const venc = proximaVencida(s.proxima_data)
                  const corAval = s.avaliacao === 'ruim' ? C.red : s.avaliacao === 'regular' ? C.amber : s.avaliacao === 'bom' || s.avaliacao === 'otimo' ? C.green : C.muted
                  return (
                    <tr key={s.id} style={{ borderTop: idx === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                      <Td>
                        <span style={{ fontWeight: 600, color: C.espresso }}>{rotuloTipo(s.tipo)}</span>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{formatarData(s.data_simulado)}</div>
                      </Td>
                      <Td>
                        {s.local || <span style={{ color: C.muted }}>—</span>}
                        {s.cenario && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{s.cenario}</div>}
                      </Td>
                      <Td>
                        <div style={{ fontSize: 12 }}>
                          {s.tempo_evacuacao_min != null ? <span>⏱ {numBR(s.tempo_evacuacao_min)} min</span> : <span style={{ color: C.muted }}>sem tempo</span>}
                        </div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                          {s.participantes != null ? `${s.participantes} pessoas` : '—'}{s.brigadistas_presentes != null ? ` · ${s.brigadistas_presentes} brig.` : ''}
                        </div>
                      </Td>
                      <Td>
                        {s.avaliacao
                          ? <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, backgroundColor: corAval + '22', color: corAval }}>{rotuloAval(s.avaliacao)}</span>
                          : <span style={{ color: C.muted }}>—</span>}
                        {s.pontos_melhoria && s.pontos_melhoria.trim() && <div style={{ fontSize: 10, color: C.amber, marginTop: 3, fontWeight: 600 }}>com pontos de melhoria</div>}
                      </Td>
                      <Td>
                        {s.proxima_data
                          ? <span style={{ color: venc ? C.red : C.ink, fontWeight: venc ? 700 : 400 }}>{formatarData(s.proxima_data)}{venc ? ' · vencido' : ''}</span>
                          : <span style={{ color: C.muted }}>—</span>}
                      </Td>
                      <Td>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button onClick={() => setEditando(s)} style={btnMini}>Editar</button>
                          {idx === 0 && <AjudaCampo chave="ehs.brigsim.editar" rota={ROTA_AJUDA} />}
                          <button onClick={() => desativar(s)} style={{ ...btnMini, color: C.red, border: `1px solid ${C.red}30` }}>Desativar</button>
                          {idx === 0 && <AjudaCampo chave="ehs.brigsim.desativar" rota={ROTA_AJUDA} />}
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
        <SimuladoFormModal companyId={companyAlvo} onClose={() => setShowNovo(false)} onSaved={() => { setShowNovo(false); carregar() }} />
      )}
      {editando && (
        <SimuladoFormModal companyId={editando.company_id} simulado={editando} onClose={() => setEditando(null)} onSaved={() => { setEditando(null); carregar() }} />
      )}
    </div>
  )
}

function SimuladoFormModal({ companyId, simulado, onClose, onSaved }: { companyId: string; simulado?: Simulado; onClose: () => void; onSaved: () => void }) {
  const [dataSimulado, setDataSimulado] = useState(simulado?.data_simulado || new Date().toISOString().slice(0, 10))
  const [tipo, setTipo] = useState(simulado?.tipo || 'abandono')
  const [local, setLocal] = useState(simulado?.local || '')
  const [cenario, setCenario] = useState(simulado?.cenario || '')
  const [duracao, setDuracao] = useState(simulado?.duracao_min != null ? String(simulado.duracao_min) : '')
  const [tempoEvac, setTempoEvac] = useState(simulado?.tempo_evacuacao_min != null ? String(simulado.tempo_evacuacao_min) : '')
  const [participantes, setParticipantes] = useState(simulado?.participantes != null ? String(simulado.participantes) : '')
  const [brigadistas, setBrigadistas] = useState(simulado?.brigadistas_presentes != null ? String(simulado.brigadistas_presentes) : '')
  const [avaliacao, setAvaliacao] = useState(simulado?.avaliacao || '')
  const [responsavel, setResponsavel] = useState(simulado?.responsavel || '')
  const [proximaData, setProximaData] = useState(simulado?.proxima_data || '')
  const [pontosMelhoria, setPontosMelhoria] = useState(simulado?.pontos_melhoria || '')
  const [observacao, setObservacao] = useState(simulado?.observacao || '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    if (!dataSimulado) { setErro('A data do simulado é obrigatória'); return }
    setSalvando(true)
    setErro(null)
    try {
      const nDur = duracao.trim() ? parseNumBR(duracao) : null
      const nEvac = tempoEvac.trim() ? parseNumBR(tempoEvac) : null
      const nPart = participantes.trim() ? parseInt(participantes, 10) : null
      const nBrig = brigadistas.trim() ? parseInt(brigadistas, 10) : null
      for (const [v, nome] of [[nDur, 'Duração'], [nEvac, 'Tempo de evacuação']] as const) {
        if (v !== null && (isNaN(v as number) || (v as number) < 0)) { setErro(`${nome} inválida`); setSalvando(false); return }
      }
      for (const [v, nome] of [[nPart, 'Participantes'], [nBrig, 'Brigadistas presentes']] as const) {
        if (v !== null && (isNaN(v as number) || (v as number) < 0)) { setErro(`${nome} inválido`); setSalvando(false); return }
      }
      const comum = {
        data_simulado: dataSimulado,
        tipo,
        local: local.trim() || null,
        cenario: cenario.trim() || null,
        duracao_min: nDur,
        tempo_evacuacao_min: nEvac,
        participantes: nPart,
        brigadistas_presentes: nBrig,
        avaliacao: avaliacao || null,
        responsavel: responsavel.trim() || null,
        proxima_data: proximaData || null,
        pontos_melhoria: pontosMelhoria.trim() || null,
        observacao: observacao.trim() || null,
      }
      if (simulado?.id) {
        const { error } = await supabase.from('ehs_brigada_simulado')
          .update({ ...comum, atualizado_em: new Date().toISOString() })
          .eq('id', simulado.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('ehs_brigada_simulado')
          .insert({ company_id: companyId, ...comum })
        if (error) throw error
      }
      onSaved()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao salvar o simulado')
      setSalvando(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 12 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 22, width: 'min(660px, 96vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: '0 0 12px' }}>{simulado?.id ? 'Editar simulado' : 'Registrar simulado'}</h3>
        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '8px 10px', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{erro}</div>}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ flex: '1 1 160px', display: 'block' }}>
            <span style={labelStyle}>Tipo de simulado *<AjudaCampo chave="ehs.brigsim.tipo" rota={ROTA_AJUDA} /></span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={inputStyle()}>
              {TIPOS.map((t) => (<option key={t.v} value={t.v}>{t.label}</option>))}
            </select>
          </label>
          <label style={{ flex: '1 1 140px', display: 'block' }}>
            <span style={labelStyle}>Data do simulado *<AjudaCampo chave="ehs.brigsim.data" rota={ROTA_AJUDA} /></span>
            <input type="date" value={dataSimulado} onChange={(e) => setDataSimulado(e.target.value)} style={inputStyle()} />
          </label>
          <label style={{ flex: '1 1 180px', display: 'block' }}>
            <span style={labelStyle}>Local<AjudaCampo chave="ehs.brigsim.local" rota={ROTA_AJUDA} /></span>
            <input value={local} onChange={(e) => setLocal(e.target.value)} style={inputStyle()} placeholder="Ex: Expedição / Toda a planta" />
          </label>
        </div>

        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={labelStyle}>Cenário<AjudaCampo chave="ehs.brigsim.cenario" rota={ROTA_AJUDA} /></span>
          <textarea value={cenario} onChange={(e) => setCenario(e.target.value)} style={{ ...inputStyle(), minHeight: 48 }} placeholder="O que foi encenado no exercício" />
        </label>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ flex: '1 1 130px', display: 'block' }}>
            <span style={labelStyle}>Duração (min)<AjudaCampo chave="ehs.brigsim.duracao" rota={ROTA_AJUDA} /></span>
            <input type="number" min={0} step={0.5} value={duracao} onChange={(e) => setDuracao(e.target.value)} style={inputStyle()} placeholder="Ex: 35" />
          </label>
          <label style={{ flex: '1 1 150px', display: 'block' }}>
            <span style={labelStyle}>Tempo de evacuação (min)<AjudaCampo chave="ehs.brigsim.tempo_evacuacao" rota={ROTA_AJUDA} /></span>
            <input type="number" min={0} step={0.5} value={tempoEvac} onChange={(e) => setTempoEvac(e.target.value)} style={inputStyle()} placeholder="Ex: 4,5" />
          </label>
          <label style={{ flex: '1 1 120px', display: 'block' }}>
            <span style={labelStyle}>Participantes<AjudaCampo chave="ehs.brigsim.participantes" rota={ROTA_AJUDA} /></span>
            <input type="number" min={0} step={1} value={participantes} onChange={(e) => setParticipantes(e.target.value)} style={inputStyle()} placeholder="Ex: 120" />
          </label>
          <label style={{ flex: '1 1 120px', display: 'block' }}>
            <span style={labelStyle}>Brigadistas presentes<AjudaCampo chave="ehs.brigsim.brigadistas" rota={ROTA_AJUDA} /></span>
            <input type="number" min={0} step={1} value={brigadistas} onChange={(e) => setBrigadistas(e.target.value)} style={inputStyle()} placeholder="Ex: 6" />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ flex: '1 1 140px', display: 'block' }}>
            <span style={labelStyle}>Avaliação<AjudaCampo chave="ehs.brigsim.avaliacao" rota={ROTA_AJUDA} /></span>
            <select value={avaliacao} onChange={(e) => setAvaliacao(e.target.value)} style={inputStyle()}>
              <option value="">—</option>
              {AVALIACOES.map((t) => (<option key={t.v} value={t.v}>{t.label}</option>))}
            </select>
          </label>
          <label style={{ flex: '2 1 200px', display: 'block' }}>
            <span style={labelStyle}>Responsável<AjudaCampo chave="ehs.brigsim.responsavel" rota={ROTA_AJUDA} /></span>
            <input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} style={inputStyle()} placeholder="Quem coordenou (opcional)" />
          </label>
          <label style={{ flex: '1 1 150px', display: 'block' }}>
            <span style={labelStyle}>Próximo simulado<AjudaCampo chave="ehs.brigsim.proxima_data" rota={ROTA_AJUDA} /></span>
            <input type="date" value={proximaData} onChange={(e) => setProximaData(e.target.value)} style={inputStyle()} />
          </label>
        </div>

        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={labelStyle}>Pontos de melhoria<AjudaCampo chave="ehs.brigsim.pontos_melhoria" rota={ROTA_AJUDA} /></span>
          <textarea value={pontosMelhoria} onChange={(e) => setPontosMelhoria(e.target.value)} style={{ ...inputStyle(), minHeight: 48 }} placeholder="O que precisa melhorar a partir do exercício" />
        </label>

        <label style={{ display: 'block', marginBottom: 8 }}>
          <span style={labelStyle}>Observação<AjudaCampo chave="ehs.brigsim.observacao" rota={ROTA_AJUDA} /></span>
          <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} style={{ ...inputStyle(), minHeight: 44 }} placeholder="Observação geral (opcional)" />
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} disabled={salvando} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || !dataSimulado} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 12, fontWeight: 600, cursor: !salvando && dataSimulado ? 'pointer' : 'not-allowed', opacity: !salvando && dataSimulado ? 1 : 0.6 }}>
            {salvando ? 'Salvando…' : (simulado?.id ? 'Salvar' : 'Registrar simulado')}
          </button>
        </div>
      </div>
    </div>
  )
}

const pill: React.CSSProperties = { display: 'inline-block', padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }
const thLabel: React.CSSProperties = { display: 'inline-flex', alignItems: 'center' }
const labelInline: React.CSSProperties = { display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }
const labelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }
const btnMini: React.CSSProperties = { padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 11, fontWeight: 600, cursor: 'pointer' }

function inputStyle() {
  return { width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 14, background: C.offwhite, color: C.ink, boxSizing: 'border-box' } as React.CSSProperties
}
function Th({ children }: { children: any }) {
  return (<th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(61, 35, 20, 0.65)' }}>{children}</th>)
}
function Td({ children }: { children: any }) {
  return (<td style={{ padding: '10px 16px', verticalAlign: 'top' }}>{children}</td>)
}
