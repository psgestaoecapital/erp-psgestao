// src/app/dashboard/ehs/cipa/page.tsx
// PS EHS · EHS-9c / M14 — CIPA (NR-5) · fatia 1: composição + validade do treinamento
// Composição da CIPA (membros por representação empregador/empregado, função, gestão/mandato) com
// data/validade do treinamento de NR-5 e alerta de reciclagem. Backend: ehs_cipa (RLS por empresa
// via get_user_company_ids). Soft delete rastreável (ativo=false + motivo). Eleição online, atas e
// calendário vêm nas próximas fatias.
// RD-95: cada controle fica dentro de um <label> que contém o "?" (AjudaCampo), visível ao usuário e detectável pelo gate.

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA_AJUDA = '/dashboard/ehs/cipa'
const ALERTA_DIAS = 30 // "a vencer" = vence dentro de 30 dias

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

const FUNCOES: { v: string; label: string }[] = [
  { v: 'presidente', label: 'Presidente' },
  { v: 'vice_presidente', label: 'Vice-presidente' },
  { v: 'secretario', label: 'Secretário' },
  { v: 'titular', label: 'Titular' },
  { v: 'suplente', label: 'Suplente' },
]
const REPRESENTACOES: { v: string; label: string }[] = [
  { v: 'empregador', label: 'Empregador' },
  { v: 'empregado', label: 'Empregado' },
]
const rotuloFuncao = (v: string) => FUNCOES.find((t) => t.v === v)?.label || v
const rotuloRepr = (v: string) => REPRESENTACOES.find((t) => t.v === v)?.label || v

type Membro = {
  id: string
  company_id: string
  nome: string
  matricula: string | null
  representacao: string
  funcao_cipa: string
  setor: string | null
  gestao: string | null
  mandato_inicio: string | null
  mandato_fim: string | null
  eleito: boolean
  data_treinamento: string | null
  validade_treinamento: string | null
  certificado: string | null
  apto: boolean
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
function diasAte(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso + (iso.length <= 10 ? 'T00:00:00' : ''))
  if (isNaN(d.getTime())) return null
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - hoje.getTime()) / 86400000)
}
function situacaoDe(m: Membro): 'vencido' | 'a_vencer' | 'em_dia' | 'sem_data' {
  const dias = diasAte(m.validade_treinamento)
  if (dias === null) return 'sem_data'
  if (dias < 0) return 'vencido'
  if (dias <= ALERTA_DIAS) return 'a_vencer'
  return 'em_dia'
}

export default function CipaPage() {
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

  const [registros, setRegistros] = useState<Membro[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroRepr, setFiltroRepr] = useState('')
  const [filtroSituacao, setFiltroSituacao] = useState('')
  const [showNovo, setShowNovo] = useState(false)
  const [editando, setEditando] = useState<Membro | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const ids = companyIdsKey ? companyIdsKey.split(',').filter(Boolean) : []
      if (ids.length === 0) { setRegistros([]); return }
      const { data, error } = await supabase
        .from('ehs_cipa')
        .select('id, company_id, nome, matricula, representacao, funcao_cipa, setor, gestao, mandato_inicio, mandato_fim, eleito, data_treinamento, validade_treinamento, certificado, apto, observacao, ativo')
        .eq('ativo', true)
        .in('company_id', ids)
        .order('validade_treinamento', { ascending: true, nullsFirst: false })
      if (error) throw error
      setRegistros((data || []) as Membro[])
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar a CIPA')
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return registros.filter((m) => {
      if (filtroRepr && m.representacao !== filtroRepr) return false
      if (filtroSituacao && situacaoDe(m) !== filtroSituacao) return false
      if (!q) return true
      return `${m.nome} ${m.matricula || ''} ${m.setor || ''}`.toLowerCase().includes(q)
    })
  }, [registros, busca, filtroRepr, filtroSituacao])

  const resumo = useMemo(() => {
    let vencidos = 0, aVencer = 0, inaptos = 0, empregador = 0, empregado = 0
    for (const m of registros) {
      const s = situacaoDe(m); if (s === 'vencido') vencidos++; else if (s === 'a_vencer') aVencer++
      if (!m.apto) inaptos++
      if (m.representacao === 'empregador') empregador++; else if (m.representacao === 'empregado') empregado++
    }
    return { total: registros.length, vencidos, aVencer, inaptos, empregador, empregado }
  }, [registros])

  async function desativar(m: Membro) {
    const motivo = prompt(`Desativar o membro "${m.nome}" da CIPA?\nInforme o motivo (fica registrado):`)
    if (motivo === null) return
    if (!motivo.trim()) { alert('Informe o motivo para desativar.'); return }
    try {
      const { data: userData } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('ehs_cipa')
        .update({ ativo: false, excluido_em: new Date().toISOString(), excluido_por: userData?.user?.id ?? null, excluido_motivo: motivo.trim(), atualizado_em: new Date().toISOString() })
        .eq('id', m.id)
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
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, fontWeight: 400, margin: '4px 0 6px' }}>CIPA</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted, maxWidth: 620 }}>
              Monte a composição da CIPA por representação, função e gestão e acompanhe a validade do treinamento de NR-5, com alerta de reciclagem. A eleição online, as atas e o calendário de reuniões vêm nas próximas etapas.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/dashboard/ehs" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>← Voltar</Link>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button onClick={() => setShowNovo(true)} disabled={!companyAlvo}
                style={{ padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: companyAlvo ? 'pointer' : 'not-allowed', opacity: companyAlvo ? 1 : 0.5 }}>
                + Novo membro
              </button>
              <AjudaCampo chave="ehs.cipa.novo" rota={ROTA_AJUDA} />
            </span>
          </div>
        </header>

        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{erro}</div>}

        {!loading && registros.length > 0 && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <span style={{ ...pill, backgroundColor: C.beigeLt, color: C.espresso }}>● {resumo.empregador} do empregador · {resumo.empregado} dos empregados</span>
            {resumo.vencidos > 0 && <span style={{ ...pill, backgroundColor: C.redBg, color: C.red }}>● {resumo.vencidos} com treinamento vencido</span>}
            {resumo.aVencer > 0 && <span style={{ ...pill, backgroundColor: '#fff4e6', color: C.amber }}>● {resumo.aVencer} a vencer (≤ {ALERTA_DIAS} dias)</span>}
            {resumo.inaptos > 0 && <span style={{ ...pill, backgroundColor: C.beigeLt, color: C.espresso }}>● {resumo.inaptos} não apto(s)</span>}
          </div>
        )}

        {multiEmpresa && (
          <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            <label style={{ display: 'block' }}>
              <span style={labelInline}>Empresa-alvo para cadastrar membro<AjudaCampo chave="ehs.cipa.empresa" rota={ROTA_AJUDA} /></span>
              <select value={companyAlvo} onChange={(e) => setCompanyAlvo(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', minWidth: 240, marginTop: 6, display: 'block' }}>
                {(companyIds || []).map((id) => (<option key={id} value={id}>{empresaPorId.get(id) || id}</option>))}
              </select>
            </label>
          </section>
        )}

        <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label style={{ flex: '2 1 220px', display: 'block' }}>
            <span style={labelInline}>Buscar<AjudaCampo chave="ehs.cipa.busca" rota={ROTA_AJUDA} /></span>
            <input type="text" placeholder="Buscar por nome, matrícula ou setor…" value={busca} onChange={(e) => setBusca(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: C.offwhite, marginTop: 6 }} />
          </label>
          <label style={{ flex: '1 1 150px', display: 'block' }}>
            <span style={labelInline}>Representação<AjudaCampo chave="ehs.cipa.filtro_representacao" rota={ROTA_AJUDA} /></span>
            <select value={filtroRepr} onChange={(e) => setFiltroRepr(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', marginTop: 6 }}>
              <option value="">Todas</option>
              {REPRESENTACOES.map((t) => (<option key={t.v} value={t.v}>{t.label}</option>))}
            </select>
          </label>
          <label style={{ flex: '1 1 150px', display: 'block' }}>
            <span style={labelInline}>Situação<AjudaCampo chave="ehs.cipa.filtro_situacao" rota={ROTA_AJUDA} /></span>
            <select value={filtroSituacao} onChange={(e) => setFiltroSituacao(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', marginTop: 6 }}>
              <option value="">Todas</option>
              <option value="vencido">Vencido</option>
              <option value="a_vencer">A vencer (≤ {ALERTA_DIAS} dias)</option>
              <option value="em_dia">Em dia</option>
              <option value="sem_data">Sem data</option>
            </select>
          </label>
        </section>

        <section style={{ backgroundColor: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: C.beigeLt }}>
                  <Th><span style={thLabel}>Membro<AjudaCampo chave="ehs.cipa.col_membro" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Função<AjudaCampo chave="ehs.cipa.col_funcao" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Representação<AjudaCampo chave="ehs.cipa.col_representacao" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Mandato<AjudaCampo chave="ehs.cipa.col_mandato" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Treinamento<AjudaCampo chave="ehs.cipa.col_treinamento" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Ações<AjudaCampo chave="ehs.cipa.col_acoes" rota={ROTA_AJUDA} /></span></Th>
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>)}
                {!loading && filtrados.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 28, textAlign: 'center', color: C.muted }}>
                    Nenhum membro cadastrado ainda. Clique em <strong>+ Novo membro</strong> para montar a CIPA.
                  </td></tr>
                )}
                {filtrados.map((m, idx) => {
                  const s = situacaoDe(m)
                  const cor = s === 'vencido' ? C.red : s === 'a_vencer' ? C.amber : s === 'em_dia' ? C.green : C.muted
                  const rotuloSit = s === 'vencido' ? 'Vencido' : s === 'a_vencer' ? 'A vencer' : s === 'em_dia' ? 'Em dia' : 'Sem data'
                  return (
                    <tr key={m.id} style={{ borderTop: idx === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                      <Td>
                        <span style={{ fontWeight: 600, color: C.espresso }}>{m.nome}</span>
                        {m.matricula && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Matrícula {m.matricula}</div>}
                        {!m.apto && <div style={{ fontSize: 10, color: C.red, marginTop: 2, fontWeight: 700 }}>NÃO APTO</div>}
                      </Td>
                      <Td>
                        <span style={{ fontWeight: 600 }}>{rotuloFuncao(m.funcao_cipa)}</span>
                      </Td>
                      <Td>
                        <span style={{ fontWeight: 600 }}>{rotuloRepr(m.representacao)}</span>
                        {m.eleito && <span style={{ marginLeft: 6, fontSize: 10, color: C.green, fontWeight: 700 }}>ELEITO</span>}
                        {m.setor && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{m.setor}</div>}
                      </Td>
                      <Td>
                        {m.gestao || <span style={{ color: C.muted }}>—</span>}
                        {m.mandato_fim && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>fim {formatarData(m.mandato_fim)}</div>}
                      </Td>
                      <Td>
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, backgroundColor: cor + '22', color: cor }}>{rotuloSit}</span>
                        {m.validade_treinamento && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>Vence {formatarData(m.validade_treinamento)}</div>}
                      </Td>
                      <Td>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button onClick={() => setEditando(m)} style={btnMini}>Editar</button>
                          {idx === 0 && <AjudaCampo chave="ehs.cipa.editar" rota={ROTA_AJUDA} />}
                          <button onClick={() => desativar(m)} style={{ ...btnMini, color: C.red, border: `1px solid ${C.red}30` }}>Desativar</button>
                          {idx === 0 && <AjudaCampo chave="ehs.cipa.desativar" rota={ROTA_AJUDA} />}
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
        <MembroFormModal companyId={companyAlvo} onClose={() => setShowNovo(false)} onSaved={() => { setShowNovo(false); carregar() }} />
      )}
      {editando && (
        <MembroFormModal companyId={editando.company_id} membro={editando} onClose={() => setEditando(null)} onSaved={() => { setEditando(null); carregar() }} />
      )}
    </div>
  )
}

function MembroFormModal({ companyId, membro, onClose, onSaved }: { companyId: string; membro?: Membro; onClose: () => void; onSaved: () => void }) {
  const [nome, setNome] = useState(membro?.nome || '')
  const [matricula, setMatricula] = useState(membro?.matricula || '')
  const [representacao, setRepresentacao] = useState(membro?.representacao || 'empregado')
  const [funcao, setFuncao] = useState(membro?.funcao_cipa || 'titular')
  const [setor, setSetor] = useState(membro?.setor || '')
  const [gestao, setGestao] = useState(membro?.gestao || '')
  const [mandatoInicio, setMandatoInicio] = useState(membro?.mandato_inicio || '')
  const [mandatoFim, setMandatoFim] = useState(membro?.mandato_fim || '')
  const [eleito, setEleito] = useState(membro?.eleito ?? false)
  const [dataTreinamento, setDataTreinamento] = useState(membro?.data_treinamento || '')
  const [validadeTreinamento, setValidadeTreinamento] = useState(membro?.validade_treinamento || '')
  const [certificado, setCertificado] = useState(membro?.certificado || '')
  const [apto, setApto] = useState(membro?.apto ?? true)
  const [observacao, setObservacao] = useState(membro?.observacao || '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    if (!nome.trim()) { setErro('O nome do membro é obrigatório'); return }
    setSalvando(true)
    setErro(null)
    try {
      const comum = {
        nome: nome.trim(),
        matricula: matricula.trim() || null,
        representacao,
        funcao_cipa: funcao,
        setor: setor.trim() || null,
        gestao: gestao.trim() || null,
        mandato_inicio: mandatoInicio || null,
        mandato_fim: mandatoFim || null,
        eleito,
        data_treinamento: dataTreinamento || null,
        validade_treinamento: validadeTreinamento || null,
        certificado: certificado.trim() || null,
        apto,
        observacao: observacao.trim() || null,
      }
      if (membro?.id) {
        const { error } = await supabase.from('ehs_cipa')
          .update({ ...comum, atualizado_em: new Date().toISOString() })
          .eq('id', membro.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('ehs_cipa')
          .insert({ company_id: companyId, ...comum })
        if (error) throw error
      }
      onSaved()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao salvar o membro')
      setSalvando(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 12 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 22, width: 'min(680px, 96vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: '0 0 12px' }}>{membro?.id ? 'Editar membro' : 'Novo membro'}</h3>
        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '8px 10px', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{erro}</div>}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ flex: '2 1 220px', display: 'block' }}>
            <span style={labelStyle}>Nome *<AjudaCampo chave="ehs.cipa.nome" rota={ROTA_AJUDA} /></span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} style={inputStyle()} placeholder="Ex: Ana Ferreira" autoFocus />
          </label>
          <label style={{ flex: '1 1 140px', display: 'block' }}>
            <span style={labelStyle}>Matrícula<AjudaCampo chave="ehs.cipa.matricula" rota={ROTA_AJUDA} /></span>
            <input value={matricula} onChange={(e) => setMatricula(e.target.value)} style={inputStyle()} placeholder="Opcional" />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ flex: '1 1 160px', display: 'block' }}>
            <span style={labelStyle}>Representação *<AjudaCampo chave="ehs.cipa.representacao" rota={ROTA_AJUDA} /></span>
            <select value={representacao} onChange={(e) => setRepresentacao(e.target.value)} style={inputStyle()}>
              {REPRESENTACOES.map((t) => (<option key={t.v} value={t.v}>{t.label}</option>))}
            </select>
          </label>
          <label style={{ flex: '1 1 160px', display: 'block' }}>
            <span style={labelStyle}>Função na CIPA *<AjudaCampo chave="ehs.cipa.funcao" rota={ROTA_AJUDA} /></span>
            <select value={funcao} onChange={(e) => setFuncao(e.target.value)} style={inputStyle()}>
              {FUNCOES.map((t) => (<option key={t.v} value={t.v}>{t.label}</option>))}
            </select>
          </label>
          <label style={{ flex: '1 1 160px', display: 'block' }}>
            <span style={labelStyle}>Setor<AjudaCampo chave="ehs.cipa.setor" rota={ROTA_AJUDA} /></span>
            <input value={setor} onChange={(e) => setSetor(e.target.value)} style={inputStyle()} placeholder="Ex: Expedição" />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ flex: '1 1 140px', display: 'block' }}>
            <span style={labelStyle}>Gestão<AjudaCampo chave="ehs.cipa.gestao" rota={ROTA_AJUDA} /></span>
            <input value={gestao} onChange={(e) => setGestao(e.target.value)} style={inputStyle()} placeholder="Ex: 2026/2027" />
          </label>
          <label style={{ flex: '1 1 150px', display: 'block' }}>
            <span style={labelStyle}>Início do mandato<AjudaCampo chave="ehs.cipa.mandato_inicio" rota={ROTA_AJUDA} /></span>
            <input type="date" value={mandatoInicio} onChange={(e) => setMandatoInicio(e.target.value)} style={inputStyle()} />
          </label>
          <label style={{ flex: '1 1 150px', display: 'block' }}>
            <span style={labelStyle}>Fim do mandato<AjudaCampo chave="ehs.cipa.mandato_fim" rota={ROTA_AJUDA} /></span>
            <input type="date" value={mandatoFim} onChange={(e) => setMandatoFim(e.target.value)} style={inputStyle()} />
          </label>
          <label style={{ flex: '1 1 150px', display: 'flex', alignItems: 'center', gap: 8, paddingTop: 18 }}>
            <input type="checkbox" checked={eleito} onChange={(e) => setEleito(e.target.checked)} style={{ width: 16, height: 16 }} />
            <span style={{ ...labelStyle, marginBottom: 0 }}>Eleito<AjudaCampo chave="ehs.cipa.eleito" rota={ROTA_AJUDA} /></span>
          </label>
        </div>

        <div style={{ borderTop: `1px solid ${C.borderLt}`, paddingTop: 12, marginBottom: 4 }}>
          <p style={{ ...labelStyle, marginBottom: 8 }}>Treinamento de NR-5 (alerta de reciclagem)</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <label style={{ flex: '1 1 160px', display: 'block' }}>
              <span style={labelStyle}>Data do treinamento<AjudaCampo chave="ehs.cipa.data_treinamento" rota={ROTA_AJUDA} /></span>
              <input type="date" value={dataTreinamento} onChange={(e) => setDataTreinamento(e.target.value)} style={inputStyle()} />
            </label>
            <label style={{ flex: '1 1 160px', display: 'block' }}>
              <span style={labelStyle}>Validade do treinamento<AjudaCampo chave="ehs.cipa.validade_treinamento" rota={ROTA_AJUDA} /></span>
              <input type="date" value={validadeTreinamento} onChange={(e) => setValidadeTreinamento(e.target.value)} style={inputStyle()} />
            </label>
            <label style={{ flex: '2 1 200px', display: 'block' }}>
              <span style={labelStyle}>Certificado<AjudaCampo chave="ehs.cipa.certificado" rota={ROTA_AJUDA} /></span>
              <input value={certificado} onChange={(e) => setCertificado(e.target.value)} style={inputStyle()} placeholder="Nº/ref. do certificado (opcional)" />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
            <label style={{ flex: '1 1 160px', display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>
              <input type="checkbox" checked={apto} onChange={(e) => setApto(e.target.checked)} style={{ width: 16, height: 16 }} />
              <span style={{ ...labelStyle, marginBottom: 0 }}>Apto a atuar<AjudaCampo chave="ehs.cipa.apto" rota={ROTA_AJUDA} /></span>
            </label>
          </div>
        </div>

        <label style={{ display: 'block', marginBottom: 8 }}>
          <span style={labelStyle}>Observação<AjudaCampo chave="ehs.cipa.observacao" rota={ROTA_AJUDA} /></span>
          <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} style={{ ...inputStyle(), minHeight: 56 }} placeholder="Estabilidade, função extra, afastamento (opcional)" />
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} disabled={salvando} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || !nome.trim()} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 12, fontWeight: 600, cursor: !salvando && nome.trim() ? 'pointer' : 'not-allowed', opacity: !salvando && nome.trim() ? 1 : 0.6 }}>
            {salvando ? 'Salvando…' : (membro?.id ? 'Salvar' : 'Cadastrar membro')}
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
