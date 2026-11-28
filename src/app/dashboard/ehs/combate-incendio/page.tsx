// src/app/dashboard/ehs/combate-incendio/page.tsx
// PS EHS · EHS-9c / M14 — Extintores e hidrantes (NR-23) · fatia 1: cadastro + QR + alerta de recarga/teste
// Cadastro dos equipamentos de combate a incêndio (extintor, hidrante, mangueira) com tipo, classe do agente,
// localização, capacidade, datas de recarga/teste hidrostático e QR por equipamento. Backend:
// ehs_combate_incendio (RLS por empresa via get_user_company_ids). Soft delete rastreável (ativo=false + motivo).
// A INSPEÇÃO MENSAL no app vem na próxima fatia.
// RD-95: cada controle fica dentro de um <label> que contém o "?" (AjudaCampo), visível ao usuário e detectável pelo gate.

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA_AJUDA = '/dashboard/ehs/combate-incendio'
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

const TIPOS: { v: string; label: string }[] = [
  { v: 'extintor', label: 'Extintor' },
  { v: 'hidrante', label: 'Hidrante' },
  { v: 'mangueira', label: 'Mangueira' },
  { v: 'abrigo_mangueira', label: 'Abrigo de mangueira' },
  { v: 'sprinkler', label: 'Sprinkler' },
  { v: 'outro', label: 'Outro' },
]
const CLASSES_AGENTE = ['Água', 'Pó ABC', 'Pó BC', 'CO₂', 'Espuma mecânica', 'Água pressurizada', 'Classe K', 'Classe D']
const rotuloTipo = (v: string) => TIPOS.find((t) => t.v === v)?.label || v

type Equipamento = {
  id: string
  company_id: string
  tipo: string
  classe_agente: string | null
  identificacao: string
  localizacao: string | null
  setor: string | null
  capacidade: string | null
  fabricante: string | null
  data_fabricacao: string | null
  data_ultima_recarga: string | null
  validade_recarga: string | null
  proximo_teste_hidrostatico: string | null
  qr_token: string | null
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
// Próxima pendência: a data mais próxima entre recarga e teste hidrostático (ignora vazias)
function proximaPendencia(e: Equipamento): { rotulo: string; iso: string; dias: number } | null {
  const cands: { rotulo: string; iso: string; dias: number }[] = []
  if (e.validade_recarga) { const d = diasAte(e.validade_recarga); if (d !== null) cands.push({ rotulo: 'Recarga', iso: e.validade_recarga, dias: d }) }
  if (e.proximo_teste_hidrostatico) { const d = diasAte(e.proximo_teste_hidrostatico); if (d !== null) cands.push({ rotulo: 'Teste hidrostático', iso: e.proximo_teste_hidrostatico, dias: d }) }
  if (cands.length === 0) return null
  cands.sort((a, b) => a.dias - b.dias)
  return cands[0]
}
function situacaoDe(e: Equipamento): 'vencido' | 'a_vencer' | 'em_dia' | 'sem_data' {
  const p = proximaPendencia(e)
  if (!p) return 'sem_data'
  if (p.dias < 0) return 'vencido'
  if (p.dias <= ALERTA_DIAS) return 'a_vencer'
  return 'em_dia'
}

export default function CombateIncendioPage() {
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

  const [registros, setRegistros] = useState<Equipamento[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroSituacao, setFiltroSituacao] = useState('')
  const [showNovo, setShowNovo] = useState(false)
  const [editando, setEditando] = useState<Equipamento | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const ids = companyIdsKey ? companyIdsKey.split(',').filter(Boolean) : []
      if (ids.length === 0) { setRegistros([]); return }
      const { data, error } = await supabase
        .from('ehs_combate_incendio')
        .select('id, company_id, tipo, classe_agente, identificacao, localizacao, setor, capacidade, fabricante, data_fabricacao, data_ultima_recarga, validade_recarga, proximo_teste_hidrostatico, qr_token, observacao, ativo')
        .eq('ativo', true)
        .in('company_id', ids)
        .order('validade_recarga', { ascending: true, nullsFirst: false })
      if (error) throw error
      setRegistros((data || []) as Equipamento[])
    } catch (e: any) {
      console.error('[ehs/combate-incendio] carregar equipamentos', e)
      setErro('Não foi possível carregar os equipamentos agora. Tente novamente em instantes.')
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return registros.filter((e) => {
      if (filtroTipo && e.tipo !== filtroTipo) return false
      if (filtroSituacao && situacaoDe(e) !== filtroSituacao) return false
      if (!q) return true
      return `${e.identificacao} ${e.localizacao || ''} ${e.setor || ''}`.toLowerCase().includes(q)
    })
  }, [registros, busca, filtroTipo, filtroSituacao])

  const resumo = useMemo(() => {
    let vencidos = 0, aVencer = 0
    for (const e of registros) { const s = situacaoDe(e); if (s === 'vencido') vencidos++; else if (s === 'a_vencer') aVencer++ }
    return { total: registros.length, vencidos, aVencer }
  }, [registros])

  async function desativar(e: Equipamento) {
    const motivo = prompt(`Desativar o equipamento "${e.identificacao}"?\nInforme o motivo (fica registrado):`)
    if (motivo === null) return
    if (!motivo.trim()) { alert('Informe o motivo para desativar.'); return }
    try {
      const { data: userData } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('ehs_combate_incendio')
        .update({ ativo: false, excluido_em: new Date().toISOString(), excluido_por: userData?.user?.id ?? null, excluido_motivo: motivo.trim(), atualizado_em: new Date().toISOString() })
        .eq('id', e.id)
      if (error) throw error
      carregar()
    } catch (err: any) {
      console.error('[ehs/combate-incendio] desativar equipamento', err)
      alert('Não foi possível desativar o equipamento. Tente novamente.')
    }
  }

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 16px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>EHS · Comissões e programas · NR-23</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, fontWeight: 400, margin: '4px 0 6px' }}>Extintores e hidrantes</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted, maxWidth: 580 }}>
              Cadastre os equipamentos de combate a incêndio com QR por equipamento e acompanhe os vencimentos de recarga e de teste hidrostático. A inspeção mensal no app vem na próxima etapa.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/dashboard/ehs" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>← Voltar</Link>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button onClick={() => setShowNovo(true)} disabled={!companyAlvo}
                style={{ padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: companyAlvo ? 'pointer' : 'not-allowed', opacity: companyAlvo ? 1 : 0.5 }}>
                + Novo equipamento
              </button>
              <AjudaCampo chave="ehs.cbi.novo" rota={ROTA_AJUDA} />
            </span>
          </div>
        </header>

        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{erro}</div>}

        {!loading && registros.length > 0 && (resumo.vencidos > 0 || resumo.aVencer > 0) && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            {resumo.vencidos > 0 && <span style={{ ...pill, backgroundColor: C.redBg, color: C.red }}>● {resumo.vencidos} vencido(s)</span>}
            {resumo.aVencer > 0 && <span style={{ ...pill, backgroundColor: '#fff4e6', color: C.amber }}>● {resumo.aVencer} a vencer (≤ {ALERTA_DIAS} dias)</span>}
          </div>
        )}

        {multiEmpresa && (
          <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            <label style={{ display: 'block' }}>
              <span style={labelInline}>Empresa-alvo para cadastrar equipamento<AjudaCampo chave="ehs.cbi.empresa" rota={ROTA_AJUDA} /></span>
              <select value={companyAlvo} onChange={(e) => setCompanyAlvo(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', minWidth: 240, marginTop: 6, display: 'block' }}>
                {(companyIds || []).map((id) => (<option key={id} value={id}>{empresaPorId.get(id) || id}</option>))}
              </select>
            </label>
          </section>
        )}

        <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label style={{ flex: '2 1 220px', display: 'block' }}>
            <span style={labelInline}>Buscar<AjudaCampo chave="ehs.cbi.busca" rota={ROTA_AJUDA} /></span>
            <input type="text" placeholder="Buscar por identificação, local ou setor…" value={busca} onChange={(e) => setBusca(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: C.offwhite, marginTop: 6 }} />
          </label>
          <label style={{ flex: '1 1 150px', display: 'block' }}>
            <span style={labelInline}>Tipo<AjudaCampo chave="ehs.cbi.filtro_tipo" rota={ROTA_AJUDA} /></span>
            <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', marginTop: 6 }}>
              <option value="">Todos</option>
              {TIPOS.map((t) => (<option key={t.v} value={t.v}>{t.label}</option>))}
            </select>
          </label>
          <label style={{ flex: '1 1 150px', display: 'block' }}>
            <span style={labelInline}>Situação<AjudaCampo chave="ehs.cbi.filtro_situacao" rota={ROTA_AJUDA} /></span>
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
                  <Th><span style={thLabel}>Identificação<AjudaCampo chave="ehs.cbi.col_identificacao" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Tipo<AjudaCampo chave="ehs.cbi.col_tipo" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Localização<AjudaCampo chave="ehs.cbi.col_local" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Vencimento<AjudaCampo chave="ehs.cbi.col_vencimento" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Ações<AjudaCampo chave="ehs.cbi.col_acoes" rota={ROTA_AJUDA} /></span></Th>
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>)}
                {!loading && filtrados.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 28, textAlign: 'center', color: C.muted }}>
                    Nenhum equipamento cadastrado ainda. Clique em <strong>+ Novo equipamento</strong> para cadastrar um extintor ou hidrante.
                  </td></tr>
                )}
                {filtrados.map((e, idx) => {
                  const p = proximaPendencia(e)
                  const s = situacaoDe(e)
                  const cor = s === 'vencido' ? C.red : s === 'a_vencer' ? C.amber : s === 'em_dia' ? C.green : C.muted
                  const rotuloSit = s === 'vencido' ? 'Vencido' : s === 'a_vencer' ? 'A vencer' : s === 'em_dia' ? 'Em dia' : 'Sem data'
                  return (
                    <tr key={e.id} style={{ borderTop: idx === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                      <Td>
                        <span style={{ fontWeight: 600, color: C.espresso }}>{e.identificacao}</span>
                        {e.qr_token && <div style={{ fontSize: 11, color: C.muted, marginTop: 2, fontFamily: 'ui-monospace, monospace' }}>QR {e.qr_token}</div>}
                      </Td>
                      <Td>
                        <span style={{ fontWeight: 600 }}>{rotuloTipo(e.tipo)}</span>
                        {e.classe_agente && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{e.classe_agente}{e.capacidade ? ` · ${e.capacidade}` : ''}</div>}
                        {!e.classe_agente && e.capacidade && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{e.capacidade}</div>}
                      </Td>
                      <Td>
                        {e.localizacao || <span style={{ color: C.muted }}>—</span>}
                        {e.setor && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{e.setor}</div>}
                      </Td>
                      <Td>
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, backgroundColor: cor + '22', color: cor }}>{rotuloSit}</span>
                        {p && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{p.rotulo}: {formatarData(p.iso)}</div>}
                      </Td>
                      <Td>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button onClick={() => setEditando(e)} style={btnMini}>Editar</button>
                          {idx === 0 && <AjudaCampo chave="ehs.cbi.editar" rota={ROTA_AJUDA} />}
                          <button onClick={() => desativar(e)} style={{ ...btnMini, color: C.red, border: `1px solid ${C.red}30` }}>Desativar</button>
                          {idx === 0 && <AjudaCampo chave="ehs.cbi.desativar" rota={ROTA_AJUDA} />}
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
        <EquipamentoFormModal companyId={companyAlvo} onClose={() => setShowNovo(false)} onSaved={() => { setShowNovo(false); carregar() }} />
      )}
      {editando && (
        <EquipamentoFormModal companyId={editando.company_id} equipamento={editando} onClose={() => setEditando(null)} onSaved={() => { setEditando(null); carregar() }} />
      )}
    </div>
  )
}

function EquipamentoFormModal({ companyId, equipamento, onClose, onSaved }: { companyId: string; equipamento?: Equipamento; onClose: () => void; onSaved: () => void }) {
  const [tipo, setTipo] = useState(equipamento?.tipo || 'extintor')
  const [classeAgente, setClasseAgente] = useState(equipamento?.classe_agente || '')
  const [identificacao, setIdentificacao] = useState(equipamento?.identificacao || '')
  const [localizacao, setLocalizacao] = useState(equipamento?.localizacao || '')
  const [setor, setSetor] = useState(equipamento?.setor || '')
  const [capacidade, setCapacidade] = useState(equipamento?.capacidade || '')
  const [fabricante, setFabricante] = useState(equipamento?.fabricante || '')
  const [dataFabricacao, setDataFabricacao] = useState(equipamento?.data_fabricacao || '')
  const [dataUltimaRecarga, setDataUltimaRecarga] = useState(equipamento?.data_ultima_recarga || '')
  const [validadeRecarga, setValidadeRecarga] = useState(equipamento?.validade_recarga || '')
  const [proxTeste, setProxTeste] = useState(equipamento?.proximo_teste_hidrostatico || '')
  const [observacao, setObservacao] = useState(equipamento?.observacao || '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const ehExtintor = tipo === 'extintor'

  async function salvar() {
    if (!identificacao.trim()) { setErro('A identificação do equipamento é obrigatória'); return }
    setSalvando(true)
    setErro(null)
    try {
      const comum = {
        tipo,
        classe_agente: ehExtintor ? (classeAgente.trim() || null) : null,
        identificacao: identificacao.trim(),
        localizacao: localizacao.trim() || null,
        setor: setor.trim() || null,
        capacidade: capacidade.trim() || null,
        fabricante: fabricante.trim() || null,
        data_fabricacao: dataFabricacao || null,
        data_ultima_recarga: dataUltimaRecarga || null,
        validade_recarga: validadeRecarga || null,
        proximo_teste_hidrostatico: proxTeste || null,
        observacao: observacao.trim() || null,
      }
      if (equipamento?.id) {
        const { error } = await supabase.from('ehs_combate_incendio')
          .update({ ...comum, atualizado_em: new Date().toISOString() })
          .eq('id', equipamento.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('ehs_combate_incendio')
          .insert({ company_id: companyId, ...comum })
        if (error) throw error
      }
      onSaved()
    } catch (e: any) {
      console.error('[ehs/combate-incendio] salvar equipamento', e)
      setErro('Não foi possível salvar o equipamento. Confira os dados e tente novamente.')
      setSalvando(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 12 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 22, width: 'min(640px, 96vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: '0 0 12px' }}>{equipamento?.id ? 'Editar equipamento' : 'Novo equipamento'}</h3>
        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '8px 10px', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{erro}</div>}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ flex: '1 1 180px', display: 'block' }}>
            <span style={labelStyle}>Tipo *<AjudaCampo chave="ehs.cbi.tipo" rota={ROTA_AJUDA} /></span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={inputStyle()}>
              {TIPOS.map((t) => (<option key={t.v} value={t.v}>{t.label}</option>))}
            </select>
          </label>
          <label style={{ flex: '1 1 180px', display: 'block' }}>
            <span style={labelStyle}>Classe do agente<AjudaCampo chave="ehs.cbi.classe_agente" rota={ROTA_AJUDA} /></span>
            <input list="cbi-classes" value={classeAgente} onChange={(e) => setClasseAgente(e.target.value)} disabled={!ehExtintor}
              style={{ ...inputStyle(), opacity: ehExtintor ? 1 : 0.5 }} placeholder={ehExtintor ? 'Ex: Pó ABC, CO₂' : 'Só para extintor'} />
            <datalist id="cbi-classes">{CLASSES_AGENTE.map((c) => (<option key={c} value={c} />))}</datalist>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ flex: '1 1 180px', display: 'block' }}>
            <span style={labelStyle}>Identificação *<AjudaCampo chave="ehs.cbi.identificacao" rota={ROTA_AJUDA} /></span>
            <input value={identificacao} onChange={(e) => setIdentificacao(e.target.value)} style={inputStyle()} placeholder="Ex: EXT-012, HID-03" autoFocus />
          </label>
          <label style={{ flex: '1 1 140px', display: 'block' }}>
            <span style={labelStyle}>Capacidade<AjudaCampo chave="ehs.cbi.capacidade" rota={ROTA_AJUDA} /></span>
            <input value={capacidade} onChange={(e) => setCapacidade(e.target.value)} style={inputStyle()} placeholder='Ex: 6 kg, 10 L' />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ flex: '2 1 220px', display: 'block' }}>
            <span style={labelStyle}>Localização<AjudaCampo chave="ehs.cbi.localizacao" rota={ROTA_AJUDA} /></span>
            <input value={localizacao} onChange={(e) => setLocalizacao(e.target.value)} style={inputStyle()} placeholder="Ex: Doca de expedição — pilar B" />
          </label>
          <label style={{ flex: '1 1 140px', display: 'block' }}>
            <span style={labelStyle}>Setor<AjudaCampo chave="ehs.cbi.setor" rota={ROTA_AJUDA} /></span>
            <input value={setor} onChange={(e) => setSetor(e.target.value)} style={inputStyle()} placeholder="Opcional" />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ flex: '1 1 180px', display: 'block' }}>
            <span style={labelStyle}>Fabricante<AjudaCampo chave="ehs.cbi.fabricante" rota={ROTA_AJUDA} /></span>
            <input value={fabricante} onChange={(e) => setFabricante(e.target.value)} style={inputStyle()} placeholder="Opcional" />
          </label>
          <label style={{ flex: '1 1 160px', display: 'block' }}>
            <span style={labelStyle}>Data de fabricação<AjudaCampo chave="ehs.cbi.data_fabricacao" rota={ROTA_AJUDA} /></span>
            <input type="date" value={dataFabricacao} onChange={(e) => setDataFabricacao(e.target.value)} style={inputStyle()} />
          </label>
        </div>

        <div style={{ borderTop: `1px solid ${C.borderLt}`, paddingTop: 12, marginBottom: 4 }}>
          <p style={{ ...labelStyle, marginBottom: 8 }}>Recarga e teste hidrostático (alerta de vencimento)</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <label style={{ flex: '1 1 160px', display: 'block' }}>
              <span style={labelStyle}>Última recarga<AjudaCampo chave="ehs.cbi.data_ultima_recarga" rota={ROTA_AJUDA} /></span>
              <input type="date" value={dataUltimaRecarga} onChange={(e) => setDataUltimaRecarga(e.target.value)} style={inputStyle()} />
            </label>
            <label style={{ flex: '1 1 160px', display: 'block' }}>
              <span style={labelStyle}>Vencimento da recarga<AjudaCampo chave="ehs.cbi.validade_recarga" rota={ROTA_AJUDA} /></span>
              <input type="date" value={validadeRecarga} onChange={(e) => setValidadeRecarga(e.target.value)} style={inputStyle()} />
            </label>
            <label style={{ flex: '1 1 160px', display: 'block' }}>
              <span style={labelStyle}>Próximo teste hidrostático<AjudaCampo chave="ehs.cbi.proximo_teste_hidrostatico" rota={ROTA_AJUDA} /></span>
              <input type="date" value={proxTeste} onChange={(e) => setProxTeste(e.target.value)} style={inputStyle()} />
            </label>
          </div>
        </div>

        {equipamento?.qr_token && (
          <div style={{ marginBottom: 12 }}>
            <span style={{ ...labelStyle }}>QR do equipamento<AjudaCampo chave="ehs.cbi.qr_token" rota={ROTA_AJUDA} /></span>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: C.espresso, background: C.beigeLt, padding: '8px 12px', borderRadius: 8 }}>{equipamento.qr_token}</div>
          </div>
        )}
        {!equipamento?.id && (
          <p style={{ fontSize: 12, color: C.muted, margin: '0 0 12px', display: 'flex', alignItems: 'center' }}>
            O QR do equipamento é gerado automaticamente ao salvar.<AjudaCampo chave="ehs.cbi.qr_token" rota={ROTA_AJUDA} />
          </p>
        )}

        <label style={{ display: 'block', marginBottom: 8 }}>
          <span style={labelStyle}>Observação<AjudaCampo chave="ehs.cbi.observacao" rota={ROTA_AJUDA} /></span>
          <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} style={{ ...inputStyle(), minHeight: 56 }} placeholder="Estado, sinalização, acesso (opcional)" />
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} disabled={salvando} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || !identificacao.trim()} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 12, fontWeight: 600, cursor: !salvando && identificacao.trim() ? 'pointer' : 'not-allowed', opacity: !salvando && identificacao.trim() ? 1 : 0.6 }}>
            {salvando ? 'Salvando…' : (equipamento?.id ? 'Salvar' : 'Cadastrar equipamento')}
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
