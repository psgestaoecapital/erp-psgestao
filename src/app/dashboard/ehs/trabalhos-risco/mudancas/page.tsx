// src/app/dashboard/ehs/trabalhos-risco/mudancas/page.tsx
// PS EHS · EHS-7 / M11 — Trabalhos de risco: Gestão de mudanças (MOC) · análise antes da mudança
// Antes de mudar equipamento, processo, layout, material, procedimento ou pessoas-chave, a mudança é
// registrada, tem o risco avaliado e ganha ações de controle a cumprir ANTES de implementar.
// Backend: ehs_mudanca + ehs_mudanca_acao (RLS por empresa via get_user_company_ids). Soft delete
// (ativo=false, RD-98). Padrão visual PS EHS (RD-96), "?" em todo campo (RD-95), sem nome de terceiros (RD-100).

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA_AJUDA = '/dashboard/ehs/trabalhos-risco/mudancas'

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

const TIPOS: { valor: string; rotulo: string }[] = [
  { valor: 'equipamento', rotulo: 'Equipamento' },
  { valor: 'processo', rotulo: 'Processo' },
  { valor: 'layout', rotulo: 'Layout' },
  { valor: 'material', rotulo: 'Material' },
  { valor: 'procedimento', rotulo: 'Procedimento' },
  { valor: 'pessoas', rotulo: 'Pessoas-chave' },
  { valor: 'outra', rotulo: 'Outra' },
]
const rotuloTipo = (v: string) => TIPOS.find((t) => t.valor === v)?.rotulo || v

const RISCOS: { valor: string; rotulo: string; cor: string }[] = [
  { valor: 'baixo', rotulo: 'Baixo', cor: C.green },
  { valor: 'medio', rotulo: 'Médio', cor: C.gold },
  { valor: 'alto', rotulo: 'Alto', cor: '#ea580c' },
  { valor: 'critico', rotulo: 'Crítico', cor: C.red },
]
const rotuloRisco = (v: string) => RISCOS.find((r) => r.valor === v)?.rotulo || v
const corRisco = (v: string) => RISCOS.find((r) => r.valor === v)?.cor || C.muted

const STATUS: { valor: string; rotulo: string; cor: string }[] = [
  { valor: 'rascunho', rotulo: 'Rascunho', cor: C.muted },
  { valor: 'em_analise', rotulo: 'Em análise', cor: '#2563eb' },
  { valor: 'aprovada', rotulo: 'Aprovada', cor: C.green },
  { valor: 'reprovada', rotulo: 'Reprovada', cor: C.red },
  { valor: 'implementada', rotulo: 'Implementada', cor: C.espresso },
  { valor: 'cancelada', rotulo: 'Cancelada', cor: C.red },
]
const rotuloStatus = (v: string) => STATUS.find((s) => s.valor === v)?.rotulo || v
const corStatus = (v: string) => STATUS.find((s) => s.valor === v)?.cor || C.muted

type Acao = { id?: string; descricao: string; responsavel: string; prazo: string; concluido: boolean; ordem: number }
type Mudanca = {
  id: string
  company_id: string
  numero: string | null
  titulo: string
  tipo: string
  descricao: string | null
  motivo: string | null
  area: string | null
  local: string | null
  solicitante: string | null
  data_solicitacao: string | null
  nivel_risco: string
  avaliacao_risco: string | null
  responsavel_analise: string | null
  data_implementacao: string | null
  status: string
  observacoes: string | null
  ativo: boolean
}

function fmtData(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export default function GestaoMudancasPage() {
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

  const [lista, setLista] = useState<Mudanca[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [showNovo, setShowNovo] = useState(false)
  const [editando, setEditando] = useState<Mudanca | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const ids = companyIdsKey ? companyIdsKey.split(',').filter(Boolean) : []
      if (ids.length === 0) { setLista([]); return }
      const { data, error } = await supabase
        .from('ehs_mudanca')
        .select('id, company_id, numero, titulo, tipo, descricao, motivo, area, local, solicitante, data_solicitacao, nivel_risco, avaliacao_risco, responsavel_analise, data_implementacao, status, observacoes, ativo')
        .eq('ativo', true)
        .in('company_id', ids)
        .order('data_solicitacao', { ascending: false, nullsFirst: false })
        .order('criado_em', { ascending: false })
      if (error) throw error
      setLista((data || []) as Mudanca[])
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar as mudanças')
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return lista.filter((m) => {
      if (filtroStatus && m.status !== filtroStatus) return false
      if (!q) return true
      return `${m.numero || ''} ${m.titulo} ${m.area || ''}`.toLowerCase().includes(q)
    })
  }, [lista, busca, filtroStatus])

  async function desativar(m: Mudanca) {
    const motivo = prompt(`Desativar a mudança "${m.titulo}"? O histórico é preservado.\nInforme o motivo (fica registrado):`)
    if (motivo === null) return
    if (!motivo.trim()) { alert('Informe o motivo para desativar.'); return }
    try {
      const { error } = await supabase
        .from('ehs_mudanca')
        .update({ ativo: false, observacoes: ((m.observacoes ? m.observacoes + ' ' : '') + `[desativada: ${motivo.trim()}]`).slice(0, 2000), atualizado_em: new Date().toISOString() })
        .eq('id', m.id)
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
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, fontWeight: 400, margin: '4px 0 6px' }}>Gestão de mudanças</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted, maxWidth: 580 }}>
              Analise o risco de uma mudança — equipamento, processo, layout, material, procedimento ou pessoas-chave — e defina as ações de controle <strong>antes</strong> de implementar.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/dashboard/ehs" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>← Voltar</Link>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button onClick={() => setShowNovo(true)} disabled={!companyAlvo}
                style={{ padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: companyAlvo ? 'pointer' : 'not-allowed', opacity: companyAlvo ? 1 : 0.5 }}>
                + Nova mudança
              </button>
              <AjudaCampo chave="ehs.moc.novo" rota={ROTA_AJUDA} />
            </span>
          </div>
        </header>

        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{erro}</div>}

        {multiEmpresa && (
          <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            <label style={fieldBlock}>
              <span style={labelStyle}>Empresa-alvo para registrar mudanças<AjudaCampo chave="ehs.moc.empresa" rota={ROTA_AJUDA} /></span>
              <select value={companyAlvo} onChange={(e) => setCompanyAlvo(e.target.value)}
                style={{ ...inputStyle(), maxWidth: 320, backgroundColor: 'white' }}>
                {(companyIds || []).map((id) => (<option key={id} value={id}>{empresaPorId.get(id) || id}</option>))}
              </select>
            </label>
          </section>
        )}

        <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label style={{ ...fieldBlock, flex: '2 1 260px' }}>
            <span style={labelStyle}>Buscar<AjudaCampo chave="ehs.moc.busca" rota={ROTA_AJUDA} /></span>
            <input type="text" placeholder="Buscar por número, título ou área…" value={busca} onChange={(e) => setBusca(e.target.value)} style={inputStyle()} />
          </label>
          <label style={{ ...fieldBlock, flex: '1 1 180px' }}>
            <span style={labelStyle}>Situação<AjudaCampo chave="ehs.moc.filtro_status" rota={ROTA_AJUDA} /></span>
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
                  <Th><span style={thLabel}>Mudança<AjudaCampo chave="ehs.moc.col_numero" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Tipo<AjudaCampo chave="ehs.moc.col_tipo" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Área<AjudaCampo chave="ehs.moc.col_area" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Risco<AjudaCampo chave="ehs.moc.col_risco" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Situação<AjudaCampo chave="ehs.moc.col_status" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Ações<AjudaCampo chave="ehs.moc.col_acoes" rota={ROTA_AJUDA} /></span></Th>
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>)}
                {!loading && filtrados.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 28, textAlign: 'center', color: C.muted }}>
                    Nenhuma mudança registrada ainda. Clique em <strong>+ Nova mudança</strong> para analisar a primeira antes de implementar.
                  </td></tr>
                )}
                {filtrados.map((m, i) => (
                  <tr key={m.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                    <Td>
                      <span style={{ fontWeight: 600, color: C.espresso }}>{m.titulo}</span>
                      {m.numero && <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, marginTop: 1 }}>{m.numero}</div>}
                    </Td>
                    <Td>{rotuloTipo(m.tipo)}</Td>
                    <Td>{m.area || '—'}</Td>
                    <Td>
                      <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: corRisco(m.nivel_risco), backgroundColor: corRisco(m.nivel_risco) + '1a' }}>{rotuloRisco(m.nivel_risco)}</span>
                    </Td>
                    <Td>
                      <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: corStatus(m.status), backgroundColor: corStatus(m.status) + '1a' }}>{rotuloStatus(m.status)}</span>
                    </Td>
                    <Td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button onClick={() => setEditando(m)} style={btnMini}>Editar</button>
                        {i === 0 && <AjudaCampo chave="ehs.moc.editar" rota={ROTA_AJUDA} />}
                        <button onClick={() => desativar(m)} style={{ ...btnMini, color: C.red, border: `1px solid ${C.red}30` }}>Desativar</button>
                        {i === 0 && <AjudaCampo chave="ehs.moc.desativar" rota={ROTA_AJUDA} />}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {showNovo && companyAlvo && (
        <MudancaFormModal companyId={companyAlvo} onClose={() => setShowNovo(false)} onSaved={() => { setShowNovo(false); carregar() }} />
      )}
      {editando && (
        <MudancaFormModal companyId={editando.company_id} mudanca={editando} onClose={() => setEditando(null)} onSaved={() => { setEditando(null); carregar() }} />
      )}
    </div>
  )
}

function MudancaFormModal({ companyId, mudanca, onClose, onSaved }: { companyId: string; mudanca?: Mudanca; onClose: () => void; onSaved: () => void }) {
  const [numero, setNumero] = useState(mudanca?.numero || '')
  const [titulo, setTitulo] = useState(mudanca?.titulo || '')
  const [tipo, setTipo] = useState(mudanca?.tipo || 'processo')
  const [descricao, setDescricao] = useState(mudanca?.descricao || '')
  const [motivo, setMotivo] = useState(mudanca?.motivo || '')
  const [area, setArea] = useState(mudanca?.area || '')
  const [local, setLocal] = useState(mudanca?.local || '')
  const [solicitante, setSolicitante] = useState(mudanca?.solicitante || '')
  const [dataSolicitacao, setDataSolicitacao] = useState(mudanca?.data_solicitacao || '')
  const [nivelRisco, setNivelRisco] = useState(mudanca?.nivel_risco || 'medio')
  const [avaliacaoRisco, setAvaliacaoRisco] = useState(mudanca?.avaliacao_risco || '')
  const [responsavel, setResponsavel] = useState(mudanca?.responsavel_analise || '')
  const [dataImplementacao, setDataImplementacao] = useState(mudanca?.data_implementacao || '')
  const [status, setStatus] = useState(mudanca?.status || 'rascunho')
  const [observacoes, setObservacoes] = useState(mudanca?.observacoes || '')
  const [acoes, setAcoes] = useState<Acao[]>([])
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    async function carregarAcoes() {
      if (!mudanca?.id) { setAcoes([{ descricao: '', responsavel: '', prazo: '', concluido: false, ordem: 1 }]); return }
      const { data } = await supabase
        .from('ehs_mudanca_acao')
        .select('id, descricao, responsavel, prazo, concluido, ordem')
        .eq('mudanca_id', mudanca.id)
        .eq('ativo', true)
        .order('ordem', { ascending: true })
      if (!vivo) return
      const arr = ((data || []) as any[]).map((a) => ({ id: a.id, descricao: a.descricao || '', responsavel: a.responsavel || '', prazo: a.prazo || '', concluido: !!a.concluido, ordem: a.ordem })) as Acao[]
      setAcoes(arr.length ? arr : [{ descricao: '', responsavel: '', prazo: '', concluido: false, ordem: 1 }])
    }
    carregarAcoes()
    return () => { vivo = false }
  }, [mudanca?.id])

  function setAcao(idx: number, patch: Partial<Acao>) {
    setAcoes((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }
  function addAcao() { setAcoes((prev) => [...prev, { descricao: '', responsavel: '', prazo: '', concluido: false, ordem: prev.length + 1 }]) }
  function removeAcao(idx: number) { setAcoes((prev) => prev.filter((_, i) => i !== idx)) }

  async function salvar() {
    if (!titulo.trim()) { setErro('O título da mudança é obrigatório'); return }
    const linhas = acoes.map((a) => ({ ...a, descricao: a.descricao.trim() })).filter((a) => a.descricao)
    setSalvando(true)
    setErro(null)
    try {
      const campos = {
        numero: numero.trim() || null,
        titulo: titulo.trim(),
        tipo,
        descricao: descricao.trim() || null,
        motivo: motivo.trim() || null,
        area: area.trim() || null,
        local: local.trim() || null,
        solicitante: solicitante.trim() || null,
        data_solicitacao: dataSolicitacao || null,
        nivel_risco: nivelRisco,
        avaliacao_risco: avaliacaoRisco.trim() || null,
        responsavel_analise: responsavel.trim() || null,
        data_implementacao: dataImplementacao || null,
        status,
        observacoes: observacoes.trim() || null,
      }
      let mudId = mudanca?.id
      if (mudId) {
        const { error } = await supabase.from('ehs_mudanca')
          .update({ ...campos, atualizado_em: new Date().toISOString() }).eq('id', mudId)
        if (error) throw error
        const { error: delErr } = await supabase.from('ehs_mudanca_acao').delete().eq('mudanca_id', mudId)
        if (delErr) throw delErr
      } else {
        const { data, error } = await supabase.from('ehs_mudanca')
          .insert({ company_id: companyId, ...campos }).select('id').single()
        if (error) throw error
        mudId = data!.id
      }
      if (linhas.length > 0) {
        const payload = linhas.map((a, i) => ({ company_id: companyId, mudanca_id: mudId, ordem: i + 1, descricao: a.descricao, responsavel: a.responsavel.trim() || null, prazo: a.prazo || null, concluido: a.concluido }))
        const { error: insErr } = await supabase.from('ehs_mudanca_acao').insert(payload)
        if (insErr) throw insErr
      }
      onSaved()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao salvar a mudança')
      setSalvando(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 12 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 22, width: 'min(640px, 96vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: '0 0 12px' }}>{mudanca?.id ? 'Editar mudança' : 'Nova mudança'}</h3>
        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '8px 10px', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{erro}</div>}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ ...fieldBlock, flex: '1 1 160px' }}>
            <span style={labelStyle}>Número / identificação<AjudaCampo chave="ehs.moc.numero" rota={ROTA_AJUDA} /></span>
            <input value={numero} onChange={(e) => setNumero(e.target.value)} style={inputStyle()} placeholder="Ex: MOC-2026-007 (opcional)" />
          </label>
          <label style={{ ...fieldBlock, flex: '1 1 180px' }}>
            <span style={labelStyle}>Tipo de mudança<AjudaCampo chave="ehs.moc.tipo" rota={ROTA_AJUDA} /></span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={inputStyle()}>
              {TIPOS.map((t) => (<option key={t.valor} value={t.valor}>{t.rotulo}</option>))}
            </select>
          </label>
        </div>

        <label style={{ ...fieldBlock, marginBottom: 12 }}>
          <span style={labelStyle}>Título da mudança *<AjudaCampo chave="ehs.moc.titulo" rota={ROTA_AJUDA} /></span>
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} style={inputStyle()} placeholder="Ex: Troca do solvente da cabine de pintura" autoFocus />
        </label>
        <label style={{ ...fieldBlock, marginBottom: 12 }}>
          <span style={labelStyle}>O que muda (descrição)<AjudaCampo chave="ehs.moc.descricao" rota={ROTA_AJUDA} /></span>
          <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} style={{ ...inputStyle(), minHeight: 50 }} placeholder="De como está hoje para como vai ficar (opcional)" />
        </label>
        <label style={{ ...fieldBlock, marginBottom: 12 }}>
          <span style={labelStyle}>Motivo<AjudaCampo chave="ehs.moc.motivo" rota={ROTA_AJUDA} /></span>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} style={inputStyle()} placeholder="Por que a mudança é necessária (opcional)" />
        </label>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ ...fieldBlock, flex: '1 1 180px' }}>
            <span style={labelStyle}>Área / setor<AjudaCampo chave="ehs.moc.area" rota={ROTA_AJUDA} /></span>
            <input value={area} onChange={(e) => setArea(e.target.value)} style={inputStyle()} placeholder="Ex: Pintura (opcional)" />
          </label>
          <label style={{ ...fieldBlock, flex: '1 1 180px' }}>
            <span style={labelStyle}>Local<AjudaCampo chave="ehs.moc.local" rota={ROTA_AJUDA} /></span>
            <input value={local} onChange={(e) => setLocal(e.target.value)} style={inputStyle()} placeholder="Ex: Cabine 2, galpão A (opcional)" />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ ...fieldBlock, flex: '1 1 200px' }}>
            <span style={labelStyle}>Solicitante<AjudaCampo chave="ehs.moc.solicitante" rota={ROTA_AJUDA} /></span>
            <input value={solicitante} onChange={(e) => setSolicitante(e.target.value)} style={inputStyle()} placeholder="Quem pediu a mudança" />
          </label>
          <label style={{ ...fieldBlock, flex: '1 1 150px' }}>
            <span style={labelStyle}>Data da solicitação<AjudaCampo chave="ehs.moc.data_solicitacao" rota={ROTA_AJUDA} /></span>
            <input type="date" value={dataSolicitacao} onChange={(e) => setDataSolicitacao(e.target.value)} style={inputStyle()} />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ ...fieldBlock, flex: '1 1 160px' }}>
            <span style={labelStyle}>Nível de risco<AjudaCampo chave="ehs.moc.nivel_risco" rota={ROTA_AJUDA} /></span>
            <select value={nivelRisco} onChange={(e) => setNivelRisco(e.target.value)} style={inputStyle()}>
              {RISCOS.map((r) => (<option key={r.valor} value={r.valor}>{r.rotulo}</option>))}
            </select>
          </label>
          <label style={{ ...fieldBlock, flex: '1 1 200px' }}>
            <span style={labelStyle}>Responsável pela análise<AjudaCampo chave="ehs.moc.responsavel_analise" rota={ROTA_AJUDA} /></span>
            <input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} style={inputStyle()} placeholder="Ex: Engenheiro de Segurança" />
          </label>
        </div>

        <label style={{ ...fieldBlock, marginBottom: 12 }}>
          <span style={labelStyle}>Avaliação de risco<AjudaCampo chave="ehs.moc.avaliacao_risco" rota={ROTA_AJUDA} /></span>
          <textarea value={avaliacaoRisco} onChange={(e) => setAvaliacaoRisco(e.target.value)} style={{ ...inputStyle(), minHeight: 60 }} placeholder="Riscos novos que a mudança introduz e o que precisa ser controlado" />
        </label>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ ...fieldBlock, flex: '1 1 150px' }}>
            <span style={labelStyle}>Data de implementação<AjudaCampo chave="ehs.moc.data_implementacao" rota={ROTA_AJUDA} /></span>
            <input type="date" value={dataImplementacao} onChange={(e) => setDataImplementacao(e.target.value)} style={inputStyle()} />
          </label>
          <label style={{ ...fieldBlock, flex: '1 1 160px' }}>
            <span style={labelStyle}>Situação<AjudaCampo chave="ehs.moc.status" rota={ROTA_AJUDA} /></span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle()}>
              {STATUS.map((s) => (<option key={s.valor} value={s.valor}>{s.rotulo}</option>))}
            </select>
          </label>
          <label style={{ ...fieldBlock, flex: '2 1 220px' }}>
            <span style={labelStyle}>Observações<AjudaCampo chave="ehs.moc.observacoes" rota={ROTA_AJUDA} /></span>
            <input value={observacoes} onChange={(e) => setObservacoes(e.target.value)} style={inputStyle()} placeholder="Decisões, restrições... (opcional)" />
          </label>
        </div>

        <div style={{ borderTop: `1px solid ${C.borderLt}`, paddingTop: 12, marginBottom: 8 }}>
          <span style={{ ...labelStyle, marginBottom: 8 }}>Ações de controle (antes de implementar)<AjudaCampo chave="ehs.moc.acoes" rota={ROTA_AJUDA} /></span>
          {acoes.map((a, idx) => (
            <div key={idx} style={{ border: `1px solid ${C.borderLt}`, borderRadius: 8, padding: 10, marginBottom: 8, background: C.offwhite }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginTop: 8 }}>{idx + 1}.</span>
                <div style={{ flex: 1 }}>
                  <label style={fieldBlock}>
                    <span style={labelMini}>Ação<AjudaCampo chave="ehs.moc.acao_descricao" rota={ROTA_AJUDA} /></span>
                    <input value={a.descricao} onChange={(e) => setAcao(idx, { descricao: e.target.value })} style={inputStyle()} placeholder="Ex: Revisar a ficha de segurança do novo produto" />
                  </label>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                    <label style={{ ...fieldBlock, flex: '1 1 160px' }}>
                      <span style={labelMini}>Responsável<AjudaCampo chave="ehs.moc.acao_responsavel" rota={ROTA_AJUDA} /></span>
                      <input value={a.responsavel} onChange={(e) => setAcao(idx, { responsavel: e.target.value })} style={inputStyle()} placeholder="Opcional" />
                    </label>
                    <label style={{ ...fieldBlock, flex: '1 1 130px' }}>
                      <span style={labelMini}>Prazo<AjudaCampo chave="ehs.moc.acao_prazo" rota={ROTA_AJUDA} /></span>
                      <input type="date" value={a.prazo} onChange={(e) => setAcao(idx, { prazo: e.target.value })} style={inputStyle()} />
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.espresso, cursor: 'pointer' }}>
                      <input type="checkbox" checked={a.concluido} onChange={(e) => setAcao(idx, { concluido: e.target.checked })} />
                      Concluída
                      <AjudaCampo chave="ehs.moc.acao_concluido" rota={ROTA_AJUDA} />
                    </label>
                    <button type="button" onClick={() => removeAcao(idx)} style={{ ...btnMini, color: C.red, border: `1px solid ${C.red}30`, marginLeft: 'auto' }}>Remover</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
          <button type="button" onClick={addAcao} style={{ ...btnMini, borderStyle: 'dashed' }}>+ Adicionar ação</button>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} disabled={salvando} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || !titulo.trim()} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 12, fontWeight: 600, cursor: !salvando && titulo.trim() ? 'pointer' : 'not-allowed', opacity: !salvando && titulo.trim() ? 1 : 0.6 }}>
            {salvando ? 'Salvando…' : (mudanca?.id ? 'Salvar' : 'Registrar mudança')}
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
