// src/app/dashboard/ehs/brigada/page.tsx
// PS EHS · EHS-9c / M14 — Brigada de incêndio (NR-23) · fatia 1: composição + validade do treinamento
// Composição da brigada (brigadistas por função, setor e turno) com data/validade do treinamento e
// alerta de reciclagem. Backend: ehs_brigada (RLS por empresa via get_user_company_ids).
// Soft delete rastreável (ativo=false + motivo). Os SIMULADOS vêm na próxima fatia.
// RD-95: cada controle fica dentro de um <label> que contém o "?" (AjudaCampo), visível ao usuário e detectável pelo gate.

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { parseNumBR } from '@/lib/num'

const ROTA_AJUDA = '/dashboard/ehs/brigada'
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
  { v: 'coordenador', label: 'Coordenador' },
  { v: 'chefe', label: 'Chefe' },
  { v: 'lider', label: 'Líder' },
  { v: 'brigadista', label: 'Brigadista' },
]
const TURNOS: { v: string; label: string }[] = [
  { v: 'manha', label: 'Manhã' },
  { v: 'tarde', label: 'Tarde' },
  { v: 'noite', label: 'Noite' },
  { v: 'comercial', label: 'Comercial' },
  { v: 'integral', label: 'Integral' },
]
const rotuloFuncao = (v: string) => FUNCOES.find((t) => t.v === v)?.label || v
const rotuloTurno = (v: string | null) => (v ? TURNOS.find((t) => t.v === v)?.label || v : '')

type Brigadista = {
  id: string
  company_id: string
  nome: string
  matricula: string | null
  funcao_brigada: string
  setor: string | null
  turno: string | null
  data_treinamento: string | null
  validade_treinamento: string | null
  carga_horaria_h: number | null
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
function situacaoDe(b: Brigadista): 'vencido' | 'a_vencer' | 'em_dia' | 'sem_data' {
  const dias = diasAte(b.validade_treinamento)
  if (dias === null) return 'sem_data'
  if (dias < 0) return 'vencido'
  if (dias <= ALERTA_DIAS) return 'a_vencer'
  return 'em_dia'
}

export default function BrigadaPage() {
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

  const [registros, setRegistros] = useState<Brigadista[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroFuncao, setFiltroFuncao] = useState('')
  const [filtroSituacao, setFiltroSituacao] = useState('')
  const [showNovo, setShowNovo] = useState(false)
  const [editando, setEditando] = useState<Brigadista | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const ids = companyIdsKey ? companyIdsKey.split(',').filter(Boolean) : []
      if (ids.length === 0) { setRegistros([]); return }
      const { data, error } = await supabase
        .from('ehs_brigada')
        .select('id, company_id, nome, matricula, funcao_brigada, setor, turno, data_treinamento, validade_treinamento, carga_horaria_h, certificado, apto, observacao, ativo')
        .eq('ativo', true)
        .in('company_id', ids)
        .order('validade_treinamento', { ascending: true, nullsFirst: false })
      if (error) throw error
      setRegistros((data || []) as Brigadista[])
    } catch (e: any) {
      console.error('carregar brigada', e)
      setErro('Não foi possível carregar a brigada. Tente novamente em instantes.')
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return registros.filter((b) => {
      if (filtroFuncao && b.funcao_brigada !== filtroFuncao) return false
      if (filtroSituacao && situacaoDe(b) !== filtroSituacao) return false
      if (!q) return true
      return `${b.nome} ${b.matricula || ''} ${b.setor || ''}`.toLowerCase().includes(q)
    })
  }, [registros, busca, filtroFuncao, filtroSituacao])

  const resumo = useMemo(() => {
    let vencidos = 0, aVencer = 0, inaptos = 0
    for (const b of registros) {
      const s = situacaoDe(b); if (s === 'vencido') vencidos++; else if (s === 'a_vencer') aVencer++
      if (!b.apto) inaptos++
    }
    return { total: registros.length, vencidos, aVencer, inaptos }
  }, [registros])

  async function desativar(b: Brigadista) {
    const motivo = prompt(`Desativar o brigadista "${b.nome}"?\nInforme o motivo (fica registrado):`)
    if (motivo === null) return
    if (!motivo.trim()) { alert('Informe o motivo para desativar.'); return }
    try {
      // RD-98 p4 + rastro: a desativação grava quem/quando/motivo e um registro em audit_log_global via RPC
      // guardada por empresa (soft-delete rastreável), nunca um UPDATE solto pelo cliente.
      const { data, error } = await supabase.rpc('fn_ehs_brigada_desativar', { p_id: b.id, p_motivo: motivo.trim() })
      if (error) throw error
      if (data && data.ok === false) { alert(data.erro || 'Não foi possível desativar o brigadista.'); return }
      carregar()
    } catch (err: any) {
      console.error('fn_ehs_brigada_desativar', err)
      alert('Não foi possível desativar o brigadista. Tente novamente.')
    }
  }

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 16px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>EHS · Comissões e programas · NR-23</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, fontWeight: 400, margin: '4px 0 6px' }}>Brigada de incêndio</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted, maxWidth: 600 }}>
              Monte a composição da brigada por função, setor e turno e acompanhe a validade do treinamento, com alerta de reciclagem. Os simulados de abandono vêm na próxima etapa.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/dashboard/ehs" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>← Voltar</Link>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button onClick={() => setShowNovo(true)} disabled={!companyAlvo}
                style={{ padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: companyAlvo ? 'pointer' : 'not-allowed', opacity: companyAlvo ? 1 : 0.5 }}>
                + Novo brigadista
              </button>
              <AjudaCampo chave="ehs.brig.novo" rota={ROTA_AJUDA} />
            </span>
          </div>
        </header>

        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{erro}</div>}

        {!loading && registros.length > 0 && (resumo.vencidos > 0 || resumo.aVencer > 0 || resumo.inaptos > 0) && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            {resumo.vencidos > 0 && <span style={{ ...pill, backgroundColor: C.redBg, color: C.red }}>● {resumo.vencidos} com treinamento vencido</span>}
            {resumo.aVencer > 0 && <span style={{ ...pill, backgroundColor: '#fff4e6', color: C.amber }}>● {resumo.aVencer} a vencer (≤ {ALERTA_DIAS} dias)</span>}
            {resumo.inaptos > 0 && <span style={{ ...pill, backgroundColor: C.beigeLt, color: C.espresso }}>● {resumo.inaptos} não apto(s)</span>}
          </div>
        )}

        {multiEmpresa && (
          <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            <label style={{ display: 'block' }}>
              <span style={labelInline}>Empresa-alvo para cadastrar brigadista<AjudaCampo chave="ehs.brig.empresa" rota={ROTA_AJUDA} /></span>
              <select value={companyAlvo} onChange={(e) => setCompanyAlvo(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', minWidth: 240, marginTop: 6, display: 'block' }}>
                {(companyIds || []).map((id) => (<option key={id} value={id}>{empresaPorId.get(id) || id}</option>))}
              </select>
            </label>
          </section>
        )}

        <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label style={{ flex: '2 1 220px', display: 'block' }}>
            <span style={labelInline}>Buscar<AjudaCampo chave="ehs.brig.busca" rota={ROTA_AJUDA} /></span>
            <input type="text" placeholder="Buscar por nome, matrícula ou setor…" value={busca} onChange={(e) => setBusca(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: C.offwhite, marginTop: 6 }} />
          </label>
          <label style={{ flex: '1 1 150px', display: 'block' }}>
            <span style={labelInline}>Função<AjudaCampo chave="ehs.brig.filtro_funcao" rota={ROTA_AJUDA} /></span>
            <select value={filtroFuncao} onChange={(e) => setFiltroFuncao(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', marginTop: 6 }}>
              <option value="">Todas</option>
              {FUNCOES.map((t) => (<option key={t.v} value={t.v}>{t.label}</option>))}
            </select>
          </label>
          <label style={{ flex: '1 1 150px', display: 'block' }}>
            <span style={labelInline}>Situação<AjudaCampo chave="ehs.brig.filtro_situacao" rota={ROTA_AJUDA} /></span>
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
                  <Th><span style={thLabel}>Brigadista<AjudaCampo chave="ehs.brig.col_brigadista" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Função<AjudaCampo chave="ehs.brig.col_funcao" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Setor<AjudaCampo chave="ehs.brig.col_setor" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Treinamento<AjudaCampo chave="ehs.brig.col_treinamento" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Ações<AjudaCampo chave="ehs.brig.col_acoes" rota={ROTA_AJUDA} /></span></Th>
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>)}
                {!loading && filtrados.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 28, textAlign: 'center', color: C.muted }}>
                    Nenhum brigadista cadastrado ainda. Clique em <strong>+ Novo brigadista</strong> para montar a brigada.
                  </td></tr>
                )}
                {filtrados.map((b, idx) => {
                  const s = situacaoDe(b)
                  const cor = s === 'vencido' ? C.red : s === 'a_vencer' ? C.amber : s === 'em_dia' ? C.green : C.muted
                  const rotuloSit = s === 'vencido' ? 'Vencido' : s === 'a_vencer' ? 'A vencer' : s === 'em_dia' ? 'Em dia' : 'Sem data'
                  return (
                    <tr key={b.id} style={{ borderTop: idx === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                      <Td>
                        <span style={{ fontWeight: 600, color: C.espresso }}>{b.nome}</span>
                        {b.matricula && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Matrícula {b.matricula}</div>}
                        {!b.apto && <div style={{ fontSize: 10, color: C.red, marginTop: 2, fontWeight: 700 }}>NÃO APTO</div>}
                      </Td>
                      <Td>
                        <span style={{ fontWeight: 600 }}>{rotuloFuncao(b.funcao_brigada)}</span>
                      </Td>
                      <Td>
                        {b.setor || <span style={{ color: C.muted }}>—</span>}
                        {b.turno && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{rotuloTurno(b.turno)}</div>}
                      </Td>
                      <Td>
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, backgroundColor: cor + '22', color: cor }}>{rotuloSit}</span>
                        {b.validade_treinamento && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>Vence {formatarData(b.validade_treinamento)}</div>}
                      </Td>
                      <Td>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button onClick={() => setEditando(b)} style={btnMini}>Editar</button>
                          {idx === 0 && <AjudaCampo chave="ehs.brig.editar" rota={ROTA_AJUDA} />}
                          <button onClick={() => desativar(b)} style={{ ...btnMini, color: C.red, border: `1px solid ${C.red}30` }}>Desativar</button>
                          {idx === 0 && <AjudaCampo chave="ehs.brig.desativar" rota={ROTA_AJUDA} />}
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
        <BrigadistaFormModal companyId={companyAlvo} onClose={() => setShowNovo(false)} onSaved={() => { setShowNovo(false); carregar() }} />
      )}
      {editando && (
        <BrigadistaFormModal companyId={editando.company_id} brigadista={editando} onClose={() => setEditando(null)} onSaved={() => { setEditando(null); carregar() }} />
      )}
    </div>
  )
}

function BrigadistaFormModal({ companyId, brigadista, onClose, onSaved }: { companyId: string; brigadista?: Brigadista; onClose: () => void; onSaved: () => void }) {
  const [nome, setNome] = useState(brigadista?.nome || '')
  const [matricula, setMatricula] = useState(brigadista?.matricula || '')
  const [funcao, setFuncao] = useState(brigadista?.funcao_brigada || 'brigadista')
  const [setor, setSetor] = useState(brigadista?.setor || '')
  const [turno, setTurno] = useState(brigadista?.turno || '')
  const [dataTreinamento, setDataTreinamento] = useState(brigadista?.data_treinamento || '')
  const [validadeTreinamento, setValidadeTreinamento] = useState(brigadista?.validade_treinamento || '')
  const [cargaHoraria, setCargaHoraria] = useState(brigadista?.carga_horaria_h != null ? String(brigadista.carga_horaria_h) : '')
  const [certificado, setCertificado] = useState(brigadista?.certificado || '')
  const [apto, setApto] = useState(brigadista?.apto ?? true)
  const [observacao, setObservacao] = useState(brigadista?.observacao || '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    if (!nome.trim()) { setErro('O nome do brigadista é obrigatório'); return }
    setSalvando(true)
    setErro(null)
    try {
      const carga = cargaHoraria.trim() ? parseNumBR(cargaHoraria) : null
      if (carga !== null && (isNaN(carga) || carga < 0)) { setErro('Carga horária inválida'); setSalvando(false); return }
      const comum = {
        nome: nome.trim(),
        matricula: matricula.trim() || null,
        funcao_brigada: funcao,
        setor: setor.trim() || null,
        turno: turno || null,
        data_treinamento: dataTreinamento || null,
        validade_treinamento: validadeTreinamento || null,
        carga_horaria_h: carga,
        certificado: certificado.trim() || null,
        apto,
        observacao: observacao.trim() || null,
      }
      // RD-98 p3 + rastro: criar/atualizar passa por RPC guardada por empresa com registro em audit_log_global,
      // nunca por insert/update solto pelo cliente.
      const { data, error } = await supabase.rpc('fn_ehs_brigada_salvar', {
        p_id: brigadista?.id ?? null,
        p_company_id: companyId,
        p_dados: comum,
      })
      if (error) throw error
      if (data && data.ok === false) { setErro(data.erro || 'Não foi possível salvar o brigadista.'); setSalvando(false); return }
      onSaved()
    } catch (e: any) {
      console.error('fn_ehs_brigada_salvar', e)
      setErro('Não foi possível salvar o brigadista. Confira os dados e tente novamente.')
      setSalvando(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 12 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 22, width: 'min(640px, 96vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: '0 0 12px' }}>{brigadista?.id ? 'Editar brigadista' : 'Novo brigadista'}</h3>
        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '8px 10px', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{erro}</div>}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ flex: '2 1 220px', display: 'block' }}>
            <span style={labelStyle}>Nome *<AjudaCampo chave="ehs.brig.nome" rota={ROTA_AJUDA} /></span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} style={inputStyle()} placeholder="Ex: Ana Ferreira" autoFocus />
          </label>
          <label style={{ flex: '1 1 140px', display: 'block' }}>
            <span style={labelStyle}>Matrícula<AjudaCampo chave="ehs.brig.matricula" rota={ROTA_AJUDA} /></span>
            <input value={matricula} onChange={(e) => setMatricula(e.target.value)} style={inputStyle()} placeholder="Opcional" />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ flex: '1 1 160px', display: 'block' }}>
            <span style={labelStyle}>Função na brigada *<AjudaCampo chave="ehs.brig.funcao" rota={ROTA_AJUDA} /></span>
            <select value={funcao} onChange={(e) => setFuncao(e.target.value)} style={inputStyle()}>
              {FUNCOES.map((t) => (<option key={t.v} value={t.v}>{t.label}</option>))}
            </select>
          </label>
          <label style={{ flex: '1 1 160px', display: 'block' }}>
            <span style={labelStyle}>Turno<AjudaCampo chave="ehs.brig.turno" rota={ROTA_AJUDA} /></span>
            <select value={turno} onChange={(e) => setTurno(e.target.value)} style={inputStyle()}>
              <option value="">—</option>
              {TURNOS.map((t) => (<option key={t.v} value={t.v}>{t.label}</option>))}
            </select>
          </label>
          <label style={{ flex: '1 1 160px', display: 'block' }}>
            <span style={labelStyle}>Setor<AjudaCampo chave="ehs.brig.setor" rota={ROTA_AJUDA} /></span>
            <input value={setor} onChange={(e) => setSetor(e.target.value)} style={inputStyle()} placeholder="Ex: Expedição" />
          </label>
        </div>

        <div style={{ borderTop: `1px solid ${C.borderLt}`, paddingTop: 12, marginBottom: 4 }}>
          <p style={{ ...labelStyle, marginBottom: 8 }}>Treinamento de brigada (alerta de reciclagem)</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <label style={{ flex: '1 1 160px', display: 'block' }}>
              <span style={labelStyle}>Data do treinamento<AjudaCampo chave="ehs.brig.data_treinamento" rota={ROTA_AJUDA} /></span>
              <input type="date" value={dataTreinamento} onChange={(e) => setDataTreinamento(e.target.value)} style={inputStyle()} />
            </label>
            <label style={{ flex: '1 1 160px', display: 'block' }}>
              <span style={labelStyle}>Validade do treinamento<AjudaCampo chave="ehs.brig.validade_treinamento" rota={ROTA_AJUDA} /></span>
              <input type="date" value={validadeTreinamento} onChange={(e) => setValidadeTreinamento(e.target.value)} style={inputStyle()} />
            </label>
            <label style={{ flex: '1 1 120px', display: 'block' }}>
              <span style={labelStyle}>Carga horária (h)<AjudaCampo chave="ehs.brig.carga_horaria" rota={ROTA_AJUDA} /></span>
              <input type="number" min={0} step={0.5} value={cargaHoraria} onChange={(e) => setCargaHoraria(e.target.value)} style={inputStyle()} placeholder="Ex: 20" />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
            <label style={{ flex: '1 1 200px', display: 'block' }}>
              <span style={labelStyle}>Certificado<AjudaCampo chave="ehs.brig.certificado" rota={ROTA_AJUDA} /></span>
              <input value={certificado} onChange={(e) => setCertificado(e.target.value)} style={inputStyle()} placeholder="Nº/ref. do certificado (opcional)" />
            </label>
            <label style={{ flex: '1 1 160px', display: 'flex', alignItems: 'center', gap: 8, paddingTop: 18 }}>
              <input type="checkbox" checked={apto} onChange={(e) => setApto(e.target.checked)} style={{ width: 16, height: 16 }} />
              <span style={{ ...labelStyle, marginBottom: 0 }}>Apto a atuar<AjudaCampo chave="ehs.brig.apto" rota={ROTA_AJUDA} /></span>
            </label>
          </div>
        </div>

        <label style={{ display: 'block', marginBottom: 8 }}>
          <span style={labelStyle}>Observação<AjudaCampo chave="ehs.brig.observacao" rota={ROTA_AJUDA} /></span>
          <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} style={{ ...inputStyle(), minHeight: 56 }} placeholder="Restrição, função extra, EPI (opcional)" />
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} disabled={salvando} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || !nome.trim()} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 12, fontWeight: 600, cursor: !salvando && nome.trim() ? 'pointer' : 'not-allowed', opacity: !salvando && nome.trim() ? 1 : 0.6 }}>
            {salvando ? 'Salvando…' : (brigadista?.id ? 'Salvar' : 'Cadastrar brigadista')}
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
