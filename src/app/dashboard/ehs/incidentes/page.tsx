// src/app/dashboard/ehs/incidentes/page.tsx
// PS EHS · EHS-7 / M12 — Incidentes e investigação (fatia 1: registro + classificação + testemunhas)
// Registro de incidentes/acidentes/quase-acidentes com classificação (gravidade, tipo, parte do corpo, agente)
// e testemunhas. Backend: ehs_incidente + ehs_incidente_testemunha (RLS por empresa via get_user_company_ids).
// Soft delete (ativo=false). Causa raiz / 5W2H / CAT / custo / alerta vêm nas próximas fatias.

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA_AJUDA = '/dashboard/ehs/incidentes'

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
}

const TIPOS: { v: string; label: string }[] = [
  { v: 'quase_acidente', label: 'Quase-acidente' },
  { v: 'tipico', label: 'Acidente típico' },
  { v: 'trajeto', label: 'Acidente de trajeto' },
  { v: 'doenca_ocupacional', label: 'Doença ocupacional' },
  { v: 'ambiental', label: 'Ambiental' },
  { v: 'material', label: 'Material (sem lesão)' },
]
const GRAVIDADES: { v: string; label: string; cor: string }[] = [
  { v: 'sem_lesao', label: 'Sem lesão', cor: '#6b7280' },
  { v: 'leve', label: 'Leve', cor: '#16a34a' },
  { v: 'moderada', label: 'Moderada', cor: '#C8941A' },
  { v: 'grave', label: 'Grave', cor: '#ea580c' },
  { v: 'fatal', label: 'Fatal', cor: '#dc2626' },
]
const STATUS: { v: string; label: string }[] = [
  { v: 'registrado', label: 'Registrado' },
  { v: 'em_investigacao', label: 'Em investigação' },
  { v: 'concluido', label: 'Concluído' },
]
const rotuloTipo = (v: string) => TIPOS.find((t) => t.v === v)?.label || v
const gravInfo = (v: string) => GRAVIDADES.find((g) => g.v === v) || { v, label: v, cor: C.muted }
const rotuloStatus = (v: string) => STATUS.find((s) => s.v === v)?.label || v

type Testemunha = { id?: string; nome: string; funcao: string | null; relato: string | null }
type Incidente = {
  id: string
  company_id: string
  ocorrido_em: string
  titulo: string
  descricao: string | null
  local_texto: string | null
  setor: string | null
  tipo: string
  gravidade: string
  parte_corpo: string | null
  agente_causador: string | null
  com_lesao: boolean
  com_afastamento: boolean
  dias_afastamento: number
  vitima_nome: string | null
  status: string
  ativo: boolean
}

function formatarDataHora(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}
// datetime-local usa YYYY-MM-DDTHH:mm no horário local
function paraInputLocal(iso: string): string {
  const d = iso ? new Date(iso) : new Date()
  if (isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function IncidentesPage() {
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

  const [registros, setRegistros] = useState<Incidente[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [showNovo, setShowNovo] = useState(false)
  const [editando, setEditando] = useState<Incidente | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const ids = companyIdsKey ? companyIdsKey.split(',').filter(Boolean) : []
      if (ids.length === 0) { setRegistros([]); return }
      const { data, error } = await supabase
        .from('ehs_incidente')
        .select('id, company_id, ocorrido_em, titulo, descricao, local_texto, setor, tipo, gravidade, parte_corpo, agente_causador, com_lesao, com_afastamento, dias_afastamento, vitima_nome, status, ativo')
        .eq('ativo', true)
        .in('company_id', ids)
        .order('ocorrido_em', { ascending: false })
      if (error) throw error
      setRegistros((data || []) as Incidente[])
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar os incidentes')
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return registros.filter((i) => {
      if (filtroStatus && i.status !== filtroStatus) return false
      if (!q) return true
      return `${i.titulo} ${i.setor || ''} ${i.agente_causador || ''}`.toLowerCase().includes(q)
    })
  }, [registros, busca, filtroStatus])

  async function desativar(i: Incidente) {
    const motivo = prompt(`Desativar o incidente "${i.titulo}"? As testemunhas registradas são preservadas.\nInforme o motivo (fica registrado):`)
    if (motivo === null) return
    if (!motivo.trim()) { alert('Informe o motivo para desativar.'); return }
    try {
      const novaDesc = ((i.descricao ? i.descricao + ' ' : '') + `[desativado: ${motivo.trim()}]`).slice(0, 4000)
      const { error } = await supabase
        .from('ehs_incidente')
        .update({ ativo: false, descricao: novaDesc, atualizado_em: new Date().toISOString() })
        .eq('id', i.id)
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
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>EHS · Campo</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, fontWeight: 400, margin: '4px 0 6px' }}>Incidentes e investigação</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted, maxWidth: 580 }}>
              Registre incidentes, acidentes e quase-acidentes com classificação (gravidade, tipo, parte do corpo, agente) e testemunhas. A causa raiz e o plano de ação vêm nas próximas etapas.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/dashboard/ehs" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>← Voltar</Link>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button onClick={() => setShowNovo(true)} disabled={!companyAlvo}
                style={{ padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: companyAlvo ? 'pointer' : 'not-allowed', opacity: companyAlvo ? 1 : 0.5 }}>
                + Novo incidente
              </button>
              <AjudaCampo chave="ehs.inc.novo" rota={ROTA_AJUDA} />
            </span>
          </div>
        </header>

        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{erro}</div>}

        {multiEmpresa && (
          <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            <label style={labelInline}>
              Empresa-alvo para registrar incidente
              <AjudaCampo chave="ehs.inc.empresa" rota={ROTA_AJUDA} />
            </label>
            <select value={companyAlvo} onChange={(e) => setCompanyAlvo(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', minWidth: 240, marginTop: 6 }}>
              {(companyIds || []).map((id) => (<option key={id} value={id}>{empresaPorId.get(id) || id}</option>))}
            </select>
          </section>
        )}

        <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '2 1 240px' }}>
            <label style={labelInline}>
              Buscar
              <AjudaCampo chave="ehs.inc.busca" rota={ROTA_AJUDA} />
            </label>
            <input type="text" placeholder="Buscar por título, setor ou agente…" value={busca} onChange={(e) => setBusca(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: C.offwhite, marginTop: 6 }} />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label style={labelInline}>
              Situação
              <AjudaCampo chave="ehs.inc.filtro_status" rota={ROTA_AJUDA} />
            </label>
            <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', marginTop: 6 }}>
              <option value="">Todas</option>
              {STATUS.map((s) => (<option key={s.v} value={s.v}>{s.label}</option>))}
            </select>
          </div>
        </section>

        <section style={{ backgroundColor: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: C.beigeLt }}>
                  <Th><span style={thLabel}>Data/Hora<AjudaCampo chave="ehs.inc.col_data" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Incidente<AjudaCampo chave="ehs.inc.col_titulo" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Classificação<AjudaCampo chave="ehs.inc.col_classificacao" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Setor<AjudaCampo chave="ehs.inc.col_setor" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Situação<AjudaCampo chave="ehs.inc.col_situacao" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Ações<AjudaCampo chave="ehs.inc.col_acoes" rota={ROTA_AJUDA} /></span></Th>
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>)}
                {!loading && filtrados.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 28, textAlign: 'center', color: C.muted }}>
                    Nenhum incidente registrado ainda. Clique em <strong>+ Novo incidente</strong> para registrar uma ocorrência.
                  </td></tr>
                )}
                {filtrados.map((i, idx) => {
                  const g = gravInfo(i.gravidade)
                  return (
                    <tr key={i.id} style={{ borderTop: idx === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                      <Td><span style={{ fontWeight: 600, color: C.espresso }}>{formatarDataHora(i.ocorrido_em)}</span></Td>
                      <Td>
                        <span style={{ fontWeight: 600, color: C.espresso }}>{i.titulo}</span>
                        {i.descricao && <div style={{ fontSize: 12, color: C.muted, marginTop: 2, maxWidth: 420 }}>{i.descricao.length > 120 ? i.descricao.slice(0, 120) + '…' : i.descricao}</div>}
                      </Td>
                      <Td>
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, backgroundColor: g.cor + '22', color: g.cor }}>{g.label}</span>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{rotuloTipo(i.tipo)}{i.agente_causador ? ` · ${i.agente_causador}` : ''}</div>
                      </Td>
                      <Td>{i.setor || <span style={{ color: C.muted }}>—</span>}</Td>
                      <Td><span style={{ fontSize: 12 }}>{rotuloStatus(i.status)}</span></Td>
                      <Td>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button onClick={() => setEditando(i)} style={btnMini}>Editar</button>
                          {idx === 0 && <AjudaCampo chave="ehs.inc.editar" rota={ROTA_AJUDA} />}
                          <button onClick={() => desativar(i)} style={{ ...btnMini, color: C.red, border: `1px solid ${C.red}30` }}>Desativar</button>
                          {idx === 0 && <AjudaCampo chave="ehs.inc.desativar" rota={ROTA_AJUDA} />}
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
        <IncidenteFormModal companyId={companyAlvo} onClose={() => setShowNovo(false)} onSaved={() => { setShowNovo(false); carregar() }} />
      )}
      {editando && (
        <IncidenteFormModal companyId={editando.company_id} incidente={editando} onClose={() => setEditando(null)} onSaved={() => { setEditando(null); carregar() }} />
      )}
    </div>
  )
}

function IncidenteFormModal({ companyId, incidente, onClose, onSaved }: { companyId: string; incidente?: Incidente; onClose: () => void; onSaved: () => void }) {
  const [ocorridoEm, setOcorridoEm] = useState(paraInputLocal(incidente?.ocorrido_em || ''))
  const [titulo, setTitulo] = useState(incidente?.titulo || '')
  const [descricao, setDescricao] = useState(incidente?.descricao || '')
  const [localTexto, setLocalTexto] = useState(incidente?.local_texto || '')
  const [setor, setSetor] = useState(incidente?.setor || '')
  const [tipo, setTipo] = useState(incidente?.tipo || 'quase_acidente')
  const [gravidade, setGravidade] = useState(incidente?.gravidade || 'sem_lesao')
  const [parteCorpo, setParteCorpo] = useState(incidente?.parte_corpo || '')
  const [agente, setAgente] = useState(incidente?.agente_causador || '')
  const [comLesao, setComLesao] = useState<boolean>(incidente?.com_lesao ?? false)
  const [comAfastamento, setComAfastamento] = useState<boolean>(incidente?.com_afastamento ?? false)
  const [diasAfastamento, setDiasAfastamento] = useState<number>(incidente?.dias_afastamento || 0)
  const [vitimaNome, setVitimaNome] = useState(incidente?.vitima_nome || '')
  const [status, setStatus] = useState(incidente?.status || 'registrado')
  const [testemunhas, setTestemunhas] = useState<Testemunha[]>([])
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    async function carregarTestemunhas() {
      if (!incidente?.id) { setTestemunhas([]); return }
      const { data } = await supabase
        .from('ehs_incidente_testemunha')
        .select('id, nome, funcao, relato')
        .eq('incidente_id', incidente.id)
        .order('nome', { ascending: true })
      if (!vivo) return
      setTestemunhas((data || []) as Testemunha[])
    }
    carregarTestemunhas()
    return () => { vivo = false }
  }, [incidente?.id])

  function setTest(idx: number, patch: Partial<Testemunha>) {
    setTestemunhas((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)))
  }
  function addTest() { setTestemunhas((prev) => [...prev, { nome: '', funcao: '', relato: '' }]) }
  function removeTest(idx: number) { setTestemunhas((prev) => prev.filter((_, i) => i !== idx)) }

  async function salvar() {
    if (!titulo.trim()) { setErro('O título do incidente é obrigatório'); return }
    if (!ocorridoEm) { setErro('Informe a data e a hora do ocorrido'); return }
    const participantes = testemunhas
      .map((t) => ({ ...t, nome: t.nome.trim(), funcao: (t.funcao || '').trim() || null, relato: (t.relato || '').trim() || null }))
      .filter((t) => t.nome)
    setSalvando(true)
    setErro(null)
    try {
      const comum = {
        ocorrido_em: new Date(ocorridoEm).toISOString(),
        titulo: titulo.trim(),
        descricao: descricao.trim() || null,
        local_texto: localTexto.trim() || null,
        setor: setor.trim() || null,
        tipo,
        gravidade,
        parte_corpo: parteCorpo.trim() || null,
        agente_causador: agente.trim() || null,
        com_lesao: comLesao,
        com_afastamento: comAfastamento,
        dias_afastamento: comAfastamento ? diasAfastamento : 0,
        vitima_nome: vitimaNome.trim() || null,
        status,
      }
      let incId = incidente?.id
      if (incId) {
        const { error } = await supabase.from('ehs_incidente')
          .update({ ...comum, atualizado_em: new Date().toISOString() })
          .eq('id', incId)
        if (error) throw error
        const { error: delErr } = await supabase.from('ehs_incidente_testemunha').delete().eq('incidente_id', incId)
        if (delErr) throw delErr
      } else {
        const { data: nova, error } = await supabase.from('ehs_incidente')
          .insert({ company_id: companyId, ...comum })
          .select('id').single()
        if (error) throw error
        incId = nova!.id
      }
      if (participantes.length > 0) {
        const payload = participantes.map((t) => ({ company_id: companyId, incidente_id: incId, nome: t.nome, funcao: t.funcao, relato: t.relato }))
        const { error: insErr } = await supabase.from('ehs_incidente_testemunha').insert(payload)
        if (insErr) throw insErr
      }
      onSaved()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao salvar o incidente')
      setSalvando(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 12 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 22, width: 'min(640px, 96vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: '0 0 12px' }}>{incidente?.id ? 'Editar incidente' : 'Novo incidente'}</h3>
        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '8px 10px', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{erro}</div>}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: '1 1 220px' }}>
            <label style={labelStyle}>Data e hora *<AjudaCampo chave="ehs.inc.ocorrido_em" rota={ROTA_AJUDA} /></label>
            <input type="datetime-local" value={ocorridoEm} onChange={(e) => setOcorridoEm(e.target.value)} style={inputStyle()} />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label style={labelStyle}>Situação<AjudaCampo chave="ehs.inc.status" rota={ROTA_AJUDA} /></label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle()}>
              {STATUS.map((s) => (<option key={s.v} value={s.v}>{s.label}</option>))}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Título *<AjudaCampo chave="ehs.inc.titulo" rota={ROTA_AJUDA} /></label>
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} style={inputStyle()} placeholder="Ex: Corte na mão ao manusear faca de desossa" autoFocus />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Descrição<AjudaCampo chave="ehs.inc.descricao" rota={ROTA_AJUDA} /></label>
          <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} style={{ ...inputStyle(), minHeight: 64 }} placeholder="Como o incidente aconteceu, o que a pessoa fazia e o que deu errado" />
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: '1 1 220px' }}>
            <label style={labelStyle}>Local<AjudaCampo chave="ehs.inc.local_texto" rota={ROTA_AJUDA} /></label>
            <input value={localTexto} onChange={(e) => setLocalTexto(e.target.value)} style={inputStyle()} placeholder="Ex: Sala de cortes — bancada 3" />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label style={labelStyle}>Setor<AjudaCampo chave="ehs.inc.setor" rota={ROTA_AJUDA} /></label>
            <input value={setor} onChange={(e) => setSetor(e.target.value)} style={inputStyle()} placeholder="Opcional" />
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${C.borderLt}`, paddingTop: 12, marginBottom: 4 }}>
          <p style={{ ...labelStyle, marginBottom: 8 }}>Classificação</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={labelStyle}>Tipo<AjudaCampo chave="ehs.inc.tipo" rota={ROTA_AJUDA} /></label>
              <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={inputStyle()}>
                {TIPOS.map((t) => (<option key={t.v} value={t.v}>{t.label}</option>))}
              </select>
            </div>
            <div style={{ flex: '1 1 160px' }}>
              <label style={labelStyle}>Gravidade<AjudaCampo chave="ehs.inc.gravidade" rota={ROTA_AJUDA} /></label>
              <select value={gravidade} onChange={(e) => setGravidade(e.target.value)} style={inputStyle()}>
                {GRAVIDADES.map((g) => (<option key={g.v} value={g.v}>{g.label}</option>))}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={labelStyle}>Parte do corpo<AjudaCampo chave="ehs.inc.parte_corpo" rota={ROTA_AJUDA} /></label>
              <input value={parteCorpo} onChange={(e) => setParteCorpo(e.target.value)} style={inputStyle()} placeholder="Ex: Mão esquerda (se houve lesão)" />
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={labelStyle}>Agente causador<AjudaCampo chave="ehs.inc.agente_causador" rota={ROTA_AJUDA} /></label>
              <input value={agente} onChange={(e) => setAgente(e.target.value)} style={inputStyle()} placeholder="Ex: Piso molhado, Faca, Empilhadeira" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12, alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.ink }}>
              <input type="checkbox" checked={comLesao} onChange={(e) => setComLesao(e.target.checked)} /> Houve lesão
              <AjudaCampo chave="ehs.inc.com_lesao" rota={ROTA_AJUDA} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.ink }}>
              <input type="checkbox" checked={comAfastamento} onChange={(e) => setComAfastamento(e.target.checked)} /> Houve afastamento
              <AjudaCampo chave="ehs.inc.com_afastamento" rota={ROTA_AJUDA} />
            </label>
            {comAfastamento && (
              <div style={{ flex: '0 1 150px' }}>
                <label style={labelStyle}>Dias de afastamento<AjudaCampo chave="ehs.inc.dias_afastamento" rota={ROTA_AJUDA} /></label>
                <input type="number" min={0} max={3650} value={diasAfastamento} onChange={(e) => setDiasAfastamento(Math.max(0, Math.min(3650, Number(e.target.value) || 0)))} style={inputStyle()} />
              </div>
            )}
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>Vítima<AjudaCampo chave="ehs.inc.vitima_nome" rota={ROTA_AJUDA} /></label>
            <input value={vitimaNome} onChange={(e) => setVitimaNome(e.target.value)} style={inputStyle()} placeholder="Nome da pessoa envolvida (opcional)" />
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${C.borderLt}`, paddingTop: 12, marginBottom: 8 }}>
          <label style={labelStyle}>Testemunhas<AjudaCampo chave="ehs.inc.testemunhas" rota={ROTA_AJUDA} /></label>
          {testemunhas.length === 0 && <p style={{ fontSize: 12, color: C.muted, margin: '0 0 8px' }}>Nenhuma testemunha ainda. Adicione quem presenciou o incidente.</p>}
          {testemunhas.map((t, idx) => (
            <div key={idx} style={{ border: `1px solid ${C.borderLt}`, borderRadius: 8, padding: 10, marginBottom: 8, background: C.offwhite }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginTop: 8 }}>{idx + 1}.</span>
                <div style={{ flex: '1 1 180px' }}>
                  <label style={labelMini}>Nome{idx === 0 && <AjudaCampo chave="ehs.inc.test_nome" rota={ROTA_AJUDA} />}</label>
                  <input value={t.nome} onChange={(e) => setTest(idx, { nome: e.target.value })} style={inputStyle()} placeholder="Nome da testemunha" />
                </div>
                <div style={{ flex: '1 1 140px' }}>
                  <label style={labelMini}>Função{idx === 0 && <AjudaCampo chave="ehs.inc.test_funcao" rota={ROTA_AJUDA} />}</label>
                  <input value={t.funcao || ''} onChange={(e) => setTest(idx, { funcao: e.target.value })} style={inputStyle()} placeholder="Opcional" />
                </div>
                <button type="button" onClick={() => removeTest(idx)} style={{ ...btnMini, color: C.red, border: `1px solid ${C.red}30`, marginTop: 18 }}>Remover</button>
              </div>
              <div style={{ marginTop: 8 }}>
                <label style={labelMini}>Relato{idx === 0 && <AjudaCampo chave="ehs.inc.test_relato" rota={ROTA_AJUDA} />}</label>
                <textarea value={t.relato || ''} onChange={(e) => setTest(idx, { relato: e.target.value })} style={{ ...inputStyle(), minHeight: 40 }} placeholder="O que a testemunha viu (opcional)" />
              </div>
            </div>
          ))}
          <button type="button" onClick={addTest} style={{ ...btnMini, borderStyle: 'dashed' }}>+ Adicionar testemunha</button>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} disabled={salvando} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || !titulo.trim()} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 12, fontWeight: 600, cursor: !salvando && titulo.trim() ? 'pointer' : 'not-allowed', opacity: !salvando && titulo.trim() ? 1 : 0.6 }}>
            {salvando ? 'Salvando…' : (incidente?.id ? 'Salvar' : 'Registrar incidente')}
          </button>
        </div>
      </div>
    </div>
  )
}

const thLabel: React.CSSProperties = { display: 'inline-flex', alignItems: 'center' }
const labelInline: React.CSSProperties = { display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }
const labelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }
const labelMini: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', fontSize: 10.5, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }
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
