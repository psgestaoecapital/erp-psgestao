// src/app/dashboard/ehs/trabalhos-risco/permissoes/page.tsx
// PS EHS · EHS-7 / M11 — Trabalhos de risco: Permissão de Trabalho (PT) · fatia 1
// Libera serviços de alto risco (altura, confinado, elétrica, a quente...) com responsável, período e
// medidas de controle conferidas. Backend: ehs_permissao_trabalho + ehs_pt_medida (RLS por empresa via
// get_user_company_ids). Soft delete (ativo=false). Padrão visual PS EHS (RD-96), "?" em todo campo (RD-95).

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA_AJUDA = '/dashboard/ehs/trabalhos-risco/permissoes'

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

const TIPOS: { valor: string; rotulo: string; nr?: string }[] = [
  { valor: 'altura', rotulo: 'Altura', nr: 'NR-35' },
  { valor: 'espaco_confinado', rotulo: 'Espaço confinado', nr: 'NR-33' },
  { valor: 'eletricidade', rotulo: 'Eletricidade', nr: 'NR-10' },
  { valor: 'inflamaveis', rotulo: 'Inflamáveis', nr: 'NR-20' },
  { valor: 'trabalho_quente', rotulo: 'Trabalho a quente' },
  { valor: 'icamento', rotulo: 'Içamento de carga' },
  { valor: 'escavacao', rotulo: 'Escavação' },
  { valor: 'geral', rotulo: 'Geral' },
]
const rotuloTipo = (v: string) => TIPOS.find((t) => t.valor === v)?.rotulo || v
const nrTipo = (v: string) => TIPOS.find((t) => t.valor === v)?.nr

const STATUS: { valor: string; rotulo: string; cor: string }[] = [
  { valor: 'rascunho', rotulo: 'Rascunho', cor: C.muted },
  { valor: 'emitida', rotulo: 'Emitida', cor: C.gold },
  { valor: 'em_andamento', rotulo: 'Em andamento', cor: '#2563eb' },
  { valor: 'encerrada', rotulo: 'Encerrada', cor: C.green },
  { valor: 'cancelada', rotulo: 'Cancelada', cor: C.red },
]
const rotuloStatus = (v: string) => STATUS.find((s) => s.valor === v)?.rotulo || v
const corStatus = (v: string) => STATUS.find((s) => s.valor === v)?.cor || C.muted

type Medida = { id?: string; descricao: string; atendido: boolean; ordem: number }
type PT = {
  id: string
  company_id: string
  numero: string | null
  tipo: string
  titulo: string
  descricao: string | null
  local: string | null
  setor: string | null
  data_inicio: string | null
  data_fim: string | null
  responsavel_emissao: string | null
  executantes: string | null
  status: string
  observacoes: string | null
  ativo: boolean
}

function fmtData(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}

export default function PermissoesTrabalhoPage() {
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

  const [lista, setLista] = useState<PT[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [showNovo, setShowNovo] = useState(false)
  const [editando, setEditando] = useState<PT | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const ids = companyIdsKey ? companyIdsKey.split(',').filter(Boolean) : []
      if (ids.length === 0) { setLista([]); return }
      const { data, error } = await supabase
        .from('ehs_permissao_trabalho')
        .select('id, company_id, numero, tipo, titulo, descricao, local, setor, data_inicio, data_fim, responsavel_emissao, executantes, status, observacoes, ativo')
        .eq('ativo', true)
        .in('company_id', ids)
        .order('data_inicio', { ascending: false, nullsFirst: false })
        .order('criado_em', { ascending: false })
      if (error) throw error
      setLista((data || []) as PT[])
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar as permissões de trabalho')
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return lista.filter((p) => {
      if (filtroStatus && p.status !== filtroStatus) return false
      if (!q) return true
      return `${p.numero || ''} ${p.titulo} ${p.local || ''}`.toLowerCase().includes(q)
    })
  }, [lista, busca, filtroStatus])

  async function desativar(p: PT) {
    const motivo = prompt(`Desativar a permissão "${p.titulo}"? O histórico é preservado.\nInforme o motivo (fica registrado):`)
    if (motivo === null) return
    if (!motivo.trim()) { alert('Informe o motivo para desativar.'); return }
    try {
      const { error } = await supabase
        .from('ehs_permissao_trabalho')
        .update({ ativo: false, observacoes: ((p.observacoes ? p.observacoes + ' ' : '') + `[desativada: ${motivo.trim()}]`).slice(0, 2000), atualizado_em: new Date().toISOString() })
        .eq('id', p.id)
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
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, fontWeight: 400, margin: '4px 0 6px' }}>Permissões de trabalho</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted, maxWidth: 580 }}>
              Libere serviços de alto risco — altura, espaço confinado, elétrica, a quente — com responsável, período e medidas de controle conferidas antes de começar.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/dashboard/ehs" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>← Voltar</Link>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button onClick={() => setShowNovo(true)} disabled={!companyAlvo}
                style={{ padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: companyAlvo ? 'pointer' : 'not-allowed', opacity: companyAlvo ? 1 : 0.5 }}>
                + Nova permissão
              </button>
              <AjudaCampo chave="ehs.pt.novo" rota={ROTA_AJUDA} />
            </span>
          </div>
        </header>

        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{erro}</div>}

        {multiEmpresa && (
          <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            <label style={fieldBlock}>
              <span style={labelStyle}>Empresa-alvo para emitir permissões<AjudaCampo chave="ehs.pt.empresa" rota={ROTA_AJUDA} /></span>
              <select value={companyAlvo} onChange={(e) => setCompanyAlvo(e.target.value)}
                style={{ ...inputStyle(), maxWidth: 320, backgroundColor: 'white' }}>
                {(companyIds || []).map((id) => (<option key={id} value={id}>{empresaPorId.get(id) || id}</option>))}
              </select>
            </label>
          </section>
        )}

        <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label style={{ ...fieldBlock, flex: '2 1 260px' }}>
            <span style={labelStyle}>Buscar<AjudaCampo chave="ehs.pt.busca" rota={ROTA_AJUDA} /></span>
            <input type="text" placeholder="Buscar por número, tarefa ou local…" value={busca} onChange={(e) => setBusca(e.target.value)} style={inputStyle()} />
          </label>
          <label style={{ ...fieldBlock, flex: '1 1 180px' }}>
            <span style={labelStyle}>Situação<AjudaCampo chave="ehs.pt.filtro_status" rota={ROTA_AJUDA} /></span>
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
                  <Th><span style={thLabel}>PT / Tarefa<AjudaCampo chave="ehs.pt.col_numero" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Tipo<AjudaCampo chave="ehs.pt.col_tipo" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Local<AjudaCampo chave="ehs.pt.col_local" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Período<AjudaCampo chave="ehs.pt.col_periodo" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Situação<AjudaCampo chave="ehs.pt.col_status" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Ações<AjudaCampo chave="ehs.pt.col_acoes" rota={ROTA_AJUDA} /></span></Th>
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>)}
                {!loading && filtrados.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 28, textAlign: 'center', color: C.muted }}>
                    Nenhuma permissão de trabalho ainda. Clique em <strong>+ Nova permissão</strong> para emitir a primeira.
                  </td></tr>
                )}
                {filtrados.map((p, i) => (
                  <tr key={p.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                    <Td>
                      <span style={{ fontWeight: 600, color: C.espresso }}>{p.titulo}</span>
                      {p.numero && <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, marginTop: 1 }}>{p.numero}</div>}
                    </Td>
                    <Td>
                      {rotuloTipo(p.tipo)}
                      {nrTipo(p.tipo) && <span style={{ marginLeft: 6, padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, backgroundColor: C.gold + '22', color: C.gold }}>{nrTipo(p.tipo)}</span>}
                    </Td>
                    <Td>{p.local || '—'}</Td>
                    <Td style={{ whiteSpace: 'nowrap' }}>{fmtData(p.data_inicio)} → {fmtData(p.data_fim)}</Td>
                    <Td>
                      <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: corStatus(p.status), backgroundColor: corStatus(p.status) + '1a' }}>{rotuloStatus(p.status)}</span>
                    </Td>
                    <Td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button onClick={() => setEditando(p)} style={btnMini}>Editar</button>
                        {i === 0 && <AjudaCampo chave="ehs.pt.editar" rota={ROTA_AJUDA} />}
                        <button onClick={() => desativar(p)} style={{ ...btnMini, color: C.red, border: `1px solid ${C.red}30` }}>Desativar</button>
                        {i === 0 && <AjudaCampo chave="ehs.pt.desativar" rota={ROTA_AJUDA} />}
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
        <PTFormModal companyId={companyAlvo} onClose={() => setShowNovo(false)} onSaved={() => { setShowNovo(false); carregar() }} />
      )}
      {editando && (
        <PTFormModal companyId={editando.company_id} pt={editando} onClose={() => setEditando(null)} onSaved={() => { setEditando(null); carregar() }} />
      )}
    </div>
  )
}

function PTFormModal({ companyId, pt, onClose, onSaved }: { companyId: string; pt?: PT; onClose: () => void; onSaved: () => void }) {
  const [numero, setNumero] = useState(pt?.numero || '')
  const [tipo, setTipo] = useState(pt?.tipo || 'geral')
  const [titulo, setTitulo] = useState(pt?.titulo || '')
  const [descricao, setDescricao] = useState(pt?.descricao || '')
  const [local, setLocal] = useState(pt?.local || '')
  const [setor, setSetor] = useState(pt?.setor || '')
  const [dataInicio, setDataInicio] = useState(toLocalInput(pt?.data_inicio || null))
  const [dataFim, setDataFim] = useState(toLocalInput(pt?.data_fim || null))
  const [responsavel, setResponsavel] = useState(pt?.responsavel_emissao || '')
  const [executantes, setExecutantes] = useState(pt?.executantes || '')
  const [status, setStatus] = useState(pt?.status || 'rascunho')
  const [observacoes, setObservacoes] = useState(pt?.observacoes || '')
  const [medidas, setMedidas] = useState<Medida[]>([])
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    async function carregarMedidas() {
      if (!pt?.id) { setMedidas([{ descricao: '', atendido: false, ordem: 1 }]); return }
      const { data } = await supabase
        .from('ehs_pt_medida')
        .select('id, descricao, atendido, ordem')
        .eq('pt_id', pt.id)
        .eq('ativo', true)
        .order('ordem', { ascending: true })
      if (!vivo) return
      const arr = (data || []) as Medida[]
      setMedidas(arr.length ? arr : [{ descricao: '', atendido: false, ordem: 1 }])
    }
    carregarMedidas()
    return () => { vivo = false }
  }, [pt?.id])

  function setMedida(idx: number, patch: Partial<Medida>) {
    setMedidas((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }
  function addMedida() { setMedidas((prev) => [...prev, { descricao: '', atendido: false, ordem: prev.length + 1 }]) }
  function removeMedida(idx: number) { setMedidas((prev) => prev.filter((_, i) => i !== idx)) }

  async function salvar() {
    if (!titulo.trim()) { setErro('A tarefa (título) é obrigatória'); return }
    if (dataInicio && dataFim && new Date(dataFim) < new Date(dataInicio)) { setErro('O fim da validade não pode ser antes do início'); return }
    const linhas = medidas.map((m) => ({ ...m, descricao: m.descricao.trim() })).filter((m) => m.descricao)
    setSalvando(true)
    setErro(null)
    try {
      const campos = {
        numero: numero.trim() || null,
        tipo,
        titulo: titulo.trim(),
        descricao: descricao.trim() || null,
        local: local.trim() || null,
        setor: setor.trim() || null,
        data_inicio: dataInicio ? new Date(dataInicio).toISOString() : null,
        data_fim: dataFim ? new Date(dataFim).toISOString() : null,
        responsavel_emissao: responsavel.trim() || null,
        executantes: executantes.trim() || null,
        status,
        observacoes: observacoes.trim() || null,
      }
      let ptId = pt?.id
      if (ptId) {
        const { error } = await supabase.from('ehs_permissao_trabalho')
          .update({ ...campos, atualizado_em: new Date().toISOString() }).eq('id', ptId)
        if (error) throw error
        const { error: delErr } = await supabase.from('ehs_pt_medida').delete().eq('pt_id', ptId)
        if (delErr) throw delErr
      } else {
        const { data, error } = await supabase.from('ehs_permissao_trabalho')
          .insert({ company_id: companyId, ...campos }).select('id').single()
        if (error) throw error
        ptId = data!.id
      }
      if (linhas.length > 0) {
        const payload = linhas.map((m, i) => ({ company_id: companyId, pt_id: ptId, ordem: i + 1, descricao: m.descricao, atendido: m.atendido }))
        const { error: insErr } = await supabase.from('ehs_pt_medida').insert(payload)
        if (insErr) throw insErr
      }
      onSaved()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao salvar a permissão')
      setSalvando(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 12 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 22, width: 'min(620px, 96vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: '0 0 12px' }}>{pt?.id ? 'Editar permissão de trabalho' : 'Nova permissão de trabalho'}</h3>
        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '8px 10px', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{erro}</div>}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ ...fieldBlock, flex: '1 1 160px' }}>
            <span style={labelStyle}>Número / identificação<AjudaCampo chave="ehs.pt.numero" rota={ROTA_AJUDA} /></span>
            <input value={numero} onChange={(e) => setNumero(e.target.value)} style={inputStyle()} placeholder="Ex: PT-2026-014 (opcional)" />
          </label>
          <label style={{ ...fieldBlock, flex: '1 1 180px' }}>
            <span style={labelStyle}>Tipo de trabalho<AjudaCampo chave="ehs.pt.tipo" rota={ROTA_AJUDA} /></span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={inputStyle()}>
              {TIPOS.map((t) => (<option key={t.valor} value={t.valor}>{t.rotulo}{t.nr ? ` (${t.nr})` : ''}</option>))}
            </select>
          </label>
        </div>

        <label style={{ ...fieldBlock, marginBottom: 12 }}>
          <span style={labelStyle}>Tarefa *<AjudaCampo chave="ehs.pt.titulo" rota={ROTA_AJUDA} /></span>
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} style={inputStyle()} placeholder="Ex: Solda de estrutura metálica na cobertura" autoFocus />
        </label>
        <label style={{ ...fieldBlock, marginBottom: 12 }}>
          <span style={labelStyle}>Descrição do serviço<AjudaCampo chave="ehs.pt.descricao" rota={ROTA_AJUDA} /></span>
          <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} style={{ ...inputStyle(), minHeight: 50 }} placeholder="O que será feito, como e com quais equipamentos (opcional)" />
        </label>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ ...fieldBlock, flex: '1 1 200px' }}>
            <span style={labelStyle}>Local<AjudaCampo chave="ehs.pt.local" rota={ROTA_AJUDA} /></span>
            <input value={local} onChange={(e) => setLocal(e.target.value)} style={inputStyle()} placeholder="Ex: Cobertura do galpão B" />
          </label>
          <label style={{ ...fieldBlock, flex: '1 1 180px' }}>
            <span style={labelStyle}>Setor<AjudaCampo chave="ehs.pt.setor" rota={ROTA_AJUDA} /></span>
            <input value={setor} onChange={(e) => setSetor(e.target.value)} style={inputStyle()} placeholder="Ex: Manutenção industrial (opcional)" />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ ...fieldBlock, flex: '1 1 180px' }}>
            <span style={labelStyle}>Início da validade<AjudaCampo chave="ehs.pt.data_inicio" rota={ROTA_AJUDA} /></span>
            <input type="datetime-local" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} style={inputStyle()} />
          </label>
          <label style={{ ...fieldBlock, flex: '1 1 180px' }}>
            <span style={labelStyle}>Fim da validade<AjudaCampo chave="ehs.pt.data_fim" rota={ROTA_AJUDA} /></span>
            <input type="datetime-local" value={dataFim} onChange={(e) => setDataFim(e.target.value)} style={inputStyle()} />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ ...fieldBlock, flex: '1 1 220px' }}>
            <span style={labelStyle}>Responsável pela emissão<AjudaCampo chave="ehs.pt.responsavel" rota={ROTA_AJUDA} /></span>
            <input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} style={inputStyle()} placeholder="Ex: Técnico de Segurança" />
          </label>
          <label style={{ ...fieldBlock, flex: '1 1 220px' }}>
            <span style={labelStyle}>Executantes<AjudaCampo chave="ehs.pt.executantes" rota={ROTA_AJUDA} /></span>
            <input value={executantes} onChange={(e) => setExecutantes(e.target.value)} style={inputStyle()} placeholder="Quem vai executar o serviço" />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ ...fieldBlock, flex: '1 1 180px' }}>
            <span style={labelStyle}>Situação<AjudaCampo chave="ehs.pt.status" rota={ROTA_AJUDA} /></span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle()}>
              {STATUS.map((s) => (<option key={s.valor} value={s.valor}>{s.rotulo}</option>))}
            </select>
          </label>
          <label style={{ ...fieldBlock, flex: '2 1 240px' }}>
            <span style={labelStyle}>Observações<AjudaCampo chave="ehs.pt.observacoes" rota={ROTA_AJUDA} /></span>
            <input value={observacoes} onChange={(e) => setObservacoes(e.target.value)} style={inputStyle()} placeholder="Restrições, condições... (opcional)" />
          </label>
        </div>

        <div style={{ borderTop: `1px solid ${C.borderLt}`, paddingTop: 12, marginBottom: 8 }}>
          <span style={{ ...labelStyle, marginBottom: 8 }}>Medidas de controle<AjudaCampo chave="ehs.pt.medidas" rota={ROTA_AJUDA} /></span>
          {medidas.map((m, idx) => (
            <div key={idx} style={{ border: `1px solid ${C.borderLt}`, borderRadius: 8, padding: 10, marginBottom: 8, background: C.offwhite }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginTop: 8 }}>{idx + 1}.</span>
                <div style={{ flex: 1 }}>
                  <label style={fieldBlock}>
                    <span style={labelMini}>Medida<AjudaCampo chave="ehs.pt.medida_descricao" rota={ROTA_AJUDA} /></span>
                    <input value={m.descricao} onChange={(e) => setMedida(idx, { descricao: e.target.value })} style={inputStyle()} placeholder="Ex: Área isolada e sinalizada" />
                  </label>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.espresso, cursor: 'pointer' }}>
                      <input type="checkbox" checked={m.atendido} onChange={(e) => setMedida(idx, { atendido: e.target.checked })} />
                      Atendida
                      <AjudaCampo chave="ehs.pt.medida_atendido" rota={ROTA_AJUDA} />
                    </label>
                    <button type="button" onClick={() => removeMedida(idx)} style={{ ...btnMini, color: C.red, border: `1px solid ${C.red}30`, marginLeft: 'auto' }}>Remover</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
          <button type="button" onClick={addMedida} style={{ ...btnMini, borderStyle: 'dashed' }}>+ Adicionar medida</button>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} disabled={salvando} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || !titulo.trim()} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 12, fontWeight: 600, cursor: !salvando && titulo.trim() ? 'pointer' : 'not-allowed', opacity: !salvando && titulo.trim() ? 1 : 0.6 }}>
            {salvando ? 'Salvando…' : (pt?.id ? 'Salvar' : 'Emitir permissão')}
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
