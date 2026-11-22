// src/app/dashboard/ehs/sipat/page.tsx
// PS EHS · EHS-9c / M14 — SIPAT (Semana Interna de Prevenção de Acidentes) · fatia 1: edições
// Edições da SIPAT por ano (tema, período, status, responsável, público-alvo e participação).
// Backend: ehs_sipat (RLS por empresa via get_user_company_ids). Soft delete rastreável (ativo=false
// + motivo, RD-98). A PROGRAMAÇÃO diária e a presença por atividade vêm na próxima fatia.
// RD-95: cada controle fica dentro de um <label> que contém o "?" (AjudaCampo), visível ao usuário e detectável pelo gate.

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA_AJUDA = '/dashboard/ehs/sipat'

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
  blue: '#2563eb',
}

const STATUS: { v: string; label: string; cor: string }[] = [
  { v: 'planejada', label: 'Planejada', cor: C.blue },
  { v: 'em_andamento', label: 'Em andamento', cor: C.amber },
  { v: 'realizada', label: 'Realizada', cor: C.green },
  { v: 'cancelada', label: 'Cancelada', cor: C.muted },
]
const rotuloStatus = (v: string) => STATUS.find((s) => s.v === v)?.label || v
const corStatus = (v: string) => STATUS.find((s) => s.v === v)?.cor || C.muted

type Sipat = {
  id: string
  company_id: string
  ano: number
  tema: string
  data_inicio: string | null
  data_fim: string | null
  status: string
  responsavel: string | null
  publico_alvo: string | null
  local_evento: string | null
  participantes_previstos: number | null
  participantes_realizados: number | null
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
function periodoDe(s: Sipat): string {
  if (!s.data_inicio && !s.data_fim) return '—'
  if (s.data_inicio && s.data_fim) return `${formatarData(s.data_inicio)} a ${formatarData(s.data_fim)}`
  return formatarData(s.data_inicio || s.data_fim)
}
function participacaoDe(s: Sipat): { texto: string; pct: number | null } {
  const prev = s.participantes_previstos
  const real = s.participantes_realizados
  if (prev == null && real == null) return { texto: '—', pct: null }
  if (real != null && prev != null && prev > 0) {
    return { texto: `${real} / ${prev}`, pct: Math.round((real / prev) * 100) }
  }
  if (real != null) return { texto: `${real} realizado(s)`, pct: null }
  return { texto: `${prev} previsto(s)`, pct: null }
}

export default function SipatPage() {
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

  const [registros, setRegistros] = useState<Sipat[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroAno, setFiltroAno] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [showNovo, setShowNovo] = useState(false)
  const [editando, setEditando] = useState<Sipat | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const ids = companyIdsKey ? companyIdsKey.split(',').filter(Boolean) : []
      if (ids.length === 0) { setRegistros([]); return }
      const { data, error } = await supabase
        .from('ehs_sipat')
        .select('id, company_id, ano, tema, data_inicio, data_fim, status, responsavel, publico_alvo, local_evento, participantes_previstos, participantes_realizados, observacao, ativo')
        .eq('ativo', true)
        .in('company_id', ids)
        .order('ano', { ascending: false })
      if (error) throw error
      setRegistros((data || []) as Sipat[])
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar as edições da SIPAT')
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey])

  useEffect(() => { carregar() }, [carregar])

  const anosDisponiveis = useMemo(() => {
    return Array.from(new Set(registros.map((r) => r.ano))).sort((a, b) => b - a)
  }, [registros])

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return registros.filter((s) => {
      if (filtroAno && String(s.ano) !== filtroAno) return false
      if (filtroStatus && s.status !== filtroStatus) return false
      if (!q) return true
      return `${s.tema} ${s.responsavel || ''} ${s.local_evento || ''}`.toLowerCase().includes(q)
    })
  }, [registros, busca, filtroAno, filtroStatus])

  const resumo = useMemo(() => {
    let planejadas = 0, emAndamento = 0, realizadas = 0
    for (const s of registros) {
      if (s.status === 'planejada') planejadas++
      else if (s.status === 'em_andamento') emAndamento++
      else if (s.status === 'realizada') realizadas++
    }
    return { total: registros.length, planejadas, emAndamento, realizadas }
  }, [registros])

  async function desativar(s: Sipat) {
    const motivo = prompt(`Desativar a SIPAT ${s.ano} "${s.tema}"?\nInforme o motivo (fica registrado):`)
    if (motivo === null) return
    if (!motivo.trim()) { alert('Informe o motivo para desativar.'); return }
    try {
      const { data: userData } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('ehs_sipat')
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
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>EHS · Comissões e programas · NR-5</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, fontWeight: 400, margin: '4px 0 6px' }}>SIPAT</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted, maxWidth: 620 }}>
              Registre as edições anuais da Semana Interna de Prevenção de Acidentes do Trabalho — tema, período, responsável e participação. A programação dos dias e a presença vêm na próxima etapa.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/dashboard/ehs" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>← Voltar</Link>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button onClick={() => setShowNovo(true)} disabled={!companyAlvo}
                style={{ padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: companyAlvo ? 'pointer' : 'not-allowed', opacity: companyAlvo ? 1 : 0.5 }}>
                + Nova edição
              </button>
              <AjudaCampo chave="ehs.sipat.novo" rota={ROTA_AJUDA} />
            </span>
          </div>
        </header>

        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{erro}</div>}

        {!loading && registros.length > 0 && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            {resumo.planejadas > 0 && <span style={{ ...pill, backgroundColor: '#e8f0fe', color: C.blue }}>● {resumo.planejadas} planejada(s)</span>}
            {resumo.emAndamento > 0 && <span style={{ ...pill, backgroundColor: '#fff4e6', color: C.amber }}>● {resumo.emAndamento} em andamento</span>}
            {resumo.realizadas > 0 && <span style={{ ...pill, backgroundColor: '#e7f6ec', color: C.green }}>● {resumo.realizadas} realizada(s)</span>}
          </div>
        )}

        {multiEmpresa && (
          <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            <label style={{ display: 'block' }}>
              <span style={labelInline}>Empresa-alvo para cadastrar a edição<AjudaCampo chave="ehs.sipat.empresa" rota={ROTA_AJUDA} /></span>
              <select value={companyAlvo} onChange={(e) => setCompanyAlvo(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', minWidth: 240, marginTop: 6, display: 'block' }}>
                {(companyIds || []).map((id) => (<option key={id} value={id}>{empresaPorId.get(id) || id}</option>))}
              </select>
            </label>
          </section>
        )}

        <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label style={{ flex: '2 1 220px', display: 'block' }}>
            <span style={labelInline}>Buscar<AjudaCampo chave="ehs.sipat.busca" rota={ROTA_AJUDA} /></span>
            <input type="text" placeholder="Buscar por tema, responsável ou local…" value={busca} onChange={(e) => setBusca(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: C.offwhite, marginTop: 6 }} />
          </label>
          <label style={{ flex: '1 1 130px', display: 'block' }}>
            <span style={labelInline}>Ano<AjudaCampo chave="ehs.sipat.filtro_ano" rota={ROTA_AJUDA} /></span>
            <select value={filtroAno} onChange={(e) => setFiltroAno(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', marginTop: 6 }}>
              <option value="">Todos</option>
              {anosDisponiveis.map((a) => (<option key={a} value={String(a)}>{a}</option>))}
            </select>
          </label>
          <label style={{ flex: '1 1 150px', display: 'block' }}>
            <span style={labelInline}>Status<AjudaCampo chave="ehs.sipat.filtro_status" rota={ROTA_AJUDA} /></span>
            <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', marginTop: 6 }}>
              <option value="">Todos</option>
              {STATUS.map((s) => (<option key={s.v} value={s.v}>{s.label}</option>))}
            </select>
          </label>
        </section>

        <section style={{ backgroundColor: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: C.beigeLt }}>
                  <Th><span style={thLabel}>Edição<AjudaCampo chave="ehs.sipat.col_edicao" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Período<AjudaCampo chave="ehs.sipat.col_periodo" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Status<AjudaCampo chave="ehs.sipat.col_status" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Participação<AjudaCampo chave="ehs.sipat.col_participacao" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Ações<AjudaCampo chave="ehs.sipat.col_acoes" rota={ROTA_AJUDA} /></span></Th>
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>)}
                {!loading && filtrados.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 28, textAlign: 'center', color: C.muted }}>
                    Nenhuma edição da SIPAT cadastrada ainda. Clique em <strong>+ Nova edição</strong> para registrar a SIPAT do ano.
                  </td></tr>
                )}
                {filtrados.map((s, idx) => {
                  const cor = corStatus(s.status)
                  const part = participacaoDe(s)
                  return (
                    <tr key={s.id} style={{ borderTop: idx === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                      <Td>
                        <span style={{ fontWeight: 700, color: C.espresso }}>{s.ano}</span>
                        <div style={{ fontSize: 13, color: C.ink, marginTop: 2 }}>{s.tema}</div>
                        {s.responsavel && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Org.: {s.responsavel}</div>}
                        {s.publico_alvo && <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>Público: {s.publico_alvo}</div>}
                      </Td>
                      <Td>
                        {periodoDe(s)}
                        {s.local_evento && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{s.local_evento}</div>}
                      </Td>
                      <Td>
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, backgroundColor: cor + '22', color: cor }}>{rotuloStatus(s.status)}</span>
                      </Td>
                      <Td>
                        <span style={{ fontWeight: 600 }}>{part.texto}</span>
                        {part.pct != null && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{part.pct}% de participação</div>}
                      </Td>
                      <Td>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button onClick={() => setEditando(s)} style={btnMini}>Editar</button>
                          {idx === 0 && <AjudaCampo chave="ehs.sipat.editar" rota={ROTA_AJUDA} />}
                          <button onClick={() => desativar(s)} style={{ ...btnMini, color: C.red, border: `1px solid ${C.red}30` }}>Desativar</button>
                          {idx === 0 && <AjudaCampo chave="ehs.sipat.desativar" rota={ROTA_AJUDA} />}
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
        <SipatFormModal companyId={companyAlvo} onClose={() => setShowNovo(false)} onSaved={() => { setShowNovo(false); carregar() }} />
      )}
      {editando && (
        <SipatFormModal companyId={editando.company_id} sipat={editando} onClose={() => setEditando(null)} onSaved={() => { setEditando(null); carregar() }} />
      )}
    </div>
  )
}

function SipatFormModal({ companyId, sipat, onClose, onSaved }: { companyId: string; sipat?: Sipat; onClose: () => void; onSaved: () => void }) {
  const anoAtual = new Date().getFullYear()
  const [ano, setAno] = useState(sipat?.ano != null ? String(sipat.ano) : String(anoAtual))
  const [tema, setTema] = useState(sipat?.tema || '')
  const [dataInicio, setDataInicio] = useState(sipat?.data_inicio || '')
  const [dataFim, setDataFim] = useState(sipat?.data_fim || '')
  const [status, setStatus] = useState(sipat?.status || 'planejada')
  const [responsavel, setResponsavel] = useState(sipat?.responsavel || '')
  const [publicoAlvo, setPublicoAlvo] = useState(sipat?.publico_alvo || '')
  const [localEvento, setLocalEvento] = useState(sipat?.local_evento || '')
  const [previstos, setPrevistos] = useState(sipat?.participantes_previstos != null ? String(sipat.participantes_previstos) : '')
  const [realizados, setRealizados] = useState(sipat?.participantes_realizados != null ? String(sipat.participantes_realizados) : '')
  const [observacao, setObservacao] = useState(sipat?.observacao || '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    if (!tema.trim()) { setErro('O tema da edição é obrigatório'); return }
    const anoNum = Number(ano)
    if (!Number.isInteger(anoNum) || anoNum < 2000 || anoNum > 2100) { setErro('Informe um ano válido'); return }
    if (dataInicio && dataFim && dataFim < dataInicio) { setErro('A data de fim não pode ser anterior à de início'); return }
    setSalvando(true)
    setErro(null)
    try {
      const numOuNull = (v: string) => {
        const t = v.trim()
        if (!t) return null
        const n = Number(t)
        return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN
      }
      const prev = numOuNull(previstos)
      const real = numOuNull(realizados)
      if (Number.isNaN(prev) || Number.isNaN(real)) { setErro('Participantes devem ser números inteiros não negativos'); setSalvando(false); return }
      const comum = {
        ano: anoNum,
        tema: tema.trim(),
        data_inicio: dataInicio || null,
        data_fim: dataFim || null,
        status,
        responsavel: responsavel.trim() || null,
        publico_alvo: publicoAlvo.trim() || null,
        local_evento: localEvento.trim() || null,
        participantes_previstos: prev,
        participantes_realizados: real,
        observacao: observacao.trim() || null,
      }
      if (sipat?.id) {
        const { error } = await supabase.from('ehs_sipat')
          .update({ ...comum, atualizado_em: new Date().toISOString() })
          .eq('id', sipat.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('ehs_sipat')
          .insert({ company_id: companyId, ...comum })
        if (error) throw error
      }
      onSaved()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao salvar a edição da SIPAT')
      setSalvando(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 12 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 22, width: 'min(640px, 96vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: '0 0 12px' }}>{sipat?.id ? 'Editar edição da SIPAT' : 'Nova edição da SIPAT'}</h3>
        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '8px 10px', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{erro}</div>}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ flex: '1 1 110px', display: 'block' }}>
            <span style={labelStyle}>Ano *<AjudaCampo chave="ehs.sipat.ano" rota={ROTA_AJUDA} /></span>
            <input type="number" min={2000} max={2100} step={1} value={ano} onChange={(e) => setAno(e.target.value)} style={inputStyle()} placeholder="2026" autoFocus />
          </label>
          <label style={{ flex: '3 1 260px', display: 'block' }}>
            <span style={labelStyle}>Tema *<AjudaCampo chave="ehs.sipat.tema" rota={ROTA_AJUDA} /></span>
            <input value={tema} onChange={(e) => setTema(e.target.value)} style={inputStyle()} placeholder="Ex: Segurança começa em mim" />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ flex: '1 1 150px', display: 'block' }}>
            <span style={labelStyle}>Início<AjudaCampo chave="ehs.sipat.data_inicio" rota={ROTA_AJUDA} /></span>
            <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} style={inputStyle()} />
          </label>
          <label style={{ flex: '1 1 150px', display: 'block' }}>
            <span style={labelStyle}>Fim<AjudaCampo chave="ehs.sipat.data_fim" rota={ROTA_AJUDA} /></span>
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} style={inputStyle()} />
          </label>
          <label style={{ flex: '1 1 150px', display: 'block' }}>
            <span style={labelStyle}>Status<AjudaCampo chave="ehs.sipat.status" rota={ROTA_AJUDA} /></span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle()}>
              {STATUS.map((s) => (<option key={s.v} value={s.v}>{s.label}</option>))}
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ flex: '1 1 200px', display: 'block' }}>
            <span style={labelStyle}>Responsável<AjudaCampo chave="ehs.sipat.responsavel" rota={ROTA_AJUDA} /></span>
            <input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} style={inputStyle()} placeholder="Ex: CIPA 2026" />
          </label>
          <label style={{ flex: '1 1 200px', display: 'block' }}>
            <span style={labelStyle}>Público-alvo<AjudaCampo chave="ehs.sipat.publico_alvo" rota={ROTA_AJUDA} /></span>
            <input value={publicoAlvo} onChange={(e) => setPublicoAlvo(e.target.value)} style={inputStyle()} placeholder="Ex: Todos os setores" />
          </label>
          <label style={{ flex: '1 1 160px', display: 'block' }}>
            <span style={labelStyle}>Local<AjudaCampo chave="ehs.sipat.local" rota={ROTA_AJUDA} /></span>
            <input value={localEvento} onChange={(e) => setLocalEvento(e.target.value)} style={inputStyle()} placeholder="Ex: Auditório" />
          </label>
        </div>

        <div style={{ borderTop: `1px solid ${C.borderLt}`, paddingTop: 12, marginBottom: 4 }}>
          <p style={{ ...labelStyle, marginBottom: 8 }}>Participação (opcional)</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
            <label style={{ flex: '1 1 160px', display: 'block' }}>
              <span style={labelStyle}>Participantes previstos<AjudaCampo chave="ehs.sipat.prev_participantes" rota={ROTA_AJUDA} /></span>
              <input type="number" min={0} step={1} value={previstos} onChange={(e) => setPrevistos(e.target.value)} style={inputStyle()} placeholder="Ex: 120" />
            </label>
            <label style={{ flex: '1 1 160px', display: 'block' }}>
              <span style={labelStyle}>Participantes realizados<AjudaCampo chave="ehs.sipat.real_participantes" rota={ROTA_AJUDA} /></span>
              <input type="number" min={0} step={1} value={realizados} onChange={(e) => setRealizados(e.target.value)} style={inputStyle()} placeholder="Preenche após a semana" />
            </label>
          </div>
        </div>

        <label style={{ display: 'block', marginBottom: 8 }}>
          <span style={labelStyle}>Observação<AjudaCampo chave="ehs.sipat.observacao" rota={ROTA_AJUDA} /></span>
          <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} style={{ ...inputStyle(), minHeight: 56 }} placeholder="Patrocínio, parceiros, mudanças (opcional)" />
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} disabled={salvando} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || !tema.trim()} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 12, fontWeight: 600, cursor: !salvando && tema.trim() ? 'pointer' : 'not-allowed', opacity: !salvando && tema.trim() ? 1 : 0.6 }}>
            {salvando ? 'Salvando…' : (sipat?.id ? 'Salvar' : 'Cadastrar edição')}
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
