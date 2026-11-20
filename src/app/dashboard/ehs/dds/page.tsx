// src/app/dashboard/ehs/dds/page.tsx
// PS EHS · EHS-7 / M10 — Campo digital: DDS (Diálogo Diário de Segurança)
// O líder registra o DDS do dia (tema, conteúdo, setor, duração) e a presença digital de quem participou.
// Backend: ehs_dds + ehs_dds_presenca (RLS por empresa via get_user_company_ids). Soft delete (ativo=false).

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA_AJUDA = '/dashboard/ehs/dds'

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

type Presenca = { id?: string; participante_nome: string; funcao: string | null }
type Dds = {
  id: string
  company_id: string
  data: string
  tema: string
  conteudo: string | null
  setor: string | null
  responsavel: string | null
  duracao_min: number
  observacoes: string | null
  ativo: boolean
  n_presentes?: number
}

function formatarData(iso: string): string {
  if (!iso) return ''
  const [a, m, d] = iso.split('-')
  return d && m && a ? `${d}/${m}/${a}` : iso
}

export default function DdsPage() {
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

  const [registros, setRegistros] = useState<Dds[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [showNovo, setShowNovo] = useState(false)
  const [editando, setEditando] = useState<Dds | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const ids = companyIdsKey ? companyIdsKey.split(',').filter(Boolean) : []
      if (ids.length === 0) { setRegistros([]); return }
      const { data, error } = await supabase
        .from('ehs_dds')
        .select('id, company_id, data, tema, conteudo, setor, responsavel, duracao_min, observacoes, ativo, ehs_dds_presenca(count)')
        .eq('ativo', true)
        .in('company_id', ids)
        .order('data', { ascending: false })
      if (error) throw error
      const linhas = (data || []).map((d: any) => ({
        ...d,
        n_presentes: Array.isArray(d.ehs_dds_presenca) ? (d.ehs_dds_presenca[0]?.count ?? 0) : 0,
      })) as Dds[]
      setRegistros(linhas)
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar os DDS')
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return registros.filter((d) => (q ? `${d.tema} ${d.setor || ''}`.toLowerCase().includes(q) : true))
  }, [registros, busca])

  async function desativar(d: Dds) {
    const motivo = prompt(`Desativar o DDS "${d.tema}" de ${formatarData(d.data)}? A presença registrada é preservada.\nInforme o motivo (fica registrado):`)
    if (motivo === null) return
    if (!motivo.trim()) { alert('Informe o motivo para desativar.'); return }
    try {
      const { error } = await supabase
        .from('ehs_dds')
        .update({ ativo: false, observacoes: ((d.observacoes ? d.observacoes + ' ' : '') + `[desativado: ${motivo.trim()}]`).slice(0, 2000), atualizado_em: new Date().toISOString() })
        .eq('id', d.id)
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
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, fontWeight: 400, margin: '4px 0 6px' }}>DDS — Diálogo de Segurança</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted, maxWidth: 560 }}>
              Registre o diálogo do dia — tema, conteúdo e duração — e a presença digital de quem participou. Sem papel.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/dashboard/ehs" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>← Voltar</Link>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button onClick={() => setShowNovo(true)} disabled={!companyAlvo}
                style={{ padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: companyAlvo ? 'pointer' : 'not-allowed', opacity: companyAlvo ? 1 : 0.5 }}>
                + Novo DDS
              </button>
              <AjudaCampo chave="ehs.dds.novo" rota={ROTA_AJUDA} />
            </span>
          </div>
        </header>

        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{erro}</div>}

        {multiEmpresa && (
          <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            <label style={labelInline}>
              Empresa-alvo para registrar DDS
              <AjudaCampo chave="ehs.dds.empresa" rota={ROTA_AJUDA} />
            </label>
            <select value={companyAlvo} onChange={(e) => setCompanyAlvo(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', minWidth: 240, marginTop: 6 }}>
              {(companyIds || []).map((id) => (<option key={id} value={id}>{empresaPorId.get(id) || id}</option>))}
            </select>
          </section>
        )}

        <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 16 }}>
          <label style={labelInline}>
            Buscar
            <AjudaCampo chave="ehs.dds.busca" rota={ROTA_AJUDA} />
          </label>
          <input type="text" placeholder="Buscar DDS por tema ou setor…" value={busca} onChange={(e) => setBusca(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: C.offwhite, marginTop: 6 }} />
        </section>

        <section style={{ backgroundColor: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: C.beigeLt }}>
                  <Th><span style={thLabel}>Data<AjudaCampo chave="ehs.dds.col_data" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Tema<AjudaCampo chave="ehs.dds.col_tema" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Setor<AjudaCampo chave="ehs.dds.col_setor" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Presença<AjudaCampo chave="ehs.dds.col_presenca" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Ações<AjudaCampo chave="ehs.dds.col_acoes" rota={ROTA_AJUDA} /></span></Th>
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>)}
                {!loading && filtrados.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 28, textAlign: 'center', color: C.muted }}>
                    Nenhum DDS registrado ainda. Clique em <strong>+ Novo DDS</strong> para registrar o diálogo de hoje.
                  </td></tr>
                )}
                {filtrados.map((d, i) => (
                  <tr key={d.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                    <Td><span style={{ fontWeight: 600, color: C.espresso }}>{formatarData(d.data)}</span></Td>
                    <Td>
                      <span style={{ fontWeight: 600, color: C.espresso }}>{d.tema}</span>
                      <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, backgroundColor: C.gold + '22', color: C.gold }}>{d.duracao_min} min</span>
                      {d.conteudo && <div style={{ fontSize: 12, color: C.muted, marginTop: 2, maxWidth: 420 }}>{d.conteudo.length > 120 ? d.conteudo.slice(0, 120) + '…' : d.conteudo}</div>}
                    </Td>
                    <Td>{d.setor || <span style={{ color: C.muted }}>—</span>}</Td>
                    <Td>{d.n_presentes ?? 0}</Td>
                    <Td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button onClick={() => setEditando(d)} style={btnMini}>Editar</button>
                        {i === 0 && <AjudaCampo chave="ehs.dds.editar" rota={ROTA_AJUDA} />}
                        <button onClick={() => desativar(d)} style={{ ...btnMini, color: C.red, border: `1px solid ${C.red}30` }}>Desativar</button>
                        {i === 0 && <AjudaCampo chave="ehs.dds.desativar" rota={ROTA_AJUDA} />}
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
        <DdsFormModal companyId={companyAlvo} onClose={() => setShowNovo(false)} onSaved={() => { setShowNovo(false); carregar() }} />
      )}
      {editando && (
        <DdsFormModal companyId={editando.company_id} dds={editando} onClose={() => setEditando(null)} onSaved={() => { setEditando(null); carregar() }} />
      )}
    </div>
  )
}

function DdsFormModal({ companyId, dds, onClose, onSaved }: { companyId: string; dds?: Dds; onClose: () => void; onSaved: () => void }) {
  const hoje = new Date().toISOString().slice(0, 10)
  const [data, setData] = useState(dds?.data || hoje)
  const [tema, setTema] = useState(dds?.tema || '')
  const [conteudo, setConteudo] = useState(dds?.conteudo || '')
  const [setor, setSetor] = useState(dds?.setor || '')
  const [responsavel, setResponsavel] = useState(dds?.responsavel || '')
  const [duracao, setDuracao] = useState<number>(dds?.duracao_min || 10)
  const [observacoes, setObservacoes] = useState(dds?.observacoes || '')
  const [presencas, setPresencas] = useState<Presenca[]>([])
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    async function carregarPresencas() {
      if (!dds?.id) { setPresencas([]); return }
      const { data } = await supabase
        .from('ehs_dds_presenca')
        .select('id, participante_nome, funcao')
        .eq('dds_id', dds.id)
        .order('participante_nome', { ascending: true })
      if (!vivo) return
      setPresencas((data || []) as Presenca[])
    }
    carregarPresencas()
    return () => { vivo = false }
  }, [dds?.id])

  function setPres(idx: number, patch: Partial<Presenca>) {
    setPresencas((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)))
  }
  function addPres() { setPresencas((prev) => [...prev, { participante_nome: '', funcao: '' }]) }
  function removePres(idx: number) { setPresencas((prev) => prev.filter((_, i) => i !== idx)) }

  async function salvar() {
    if (!tema.trim()) { setErro('O tema do DDS é obrigatório'); return }
    if (!data) { setErro('Informe a data do DDS'); return }
    const participantes = presencas.map((p) => ({ ...p, participante_nome: p.participante_nome.trim(), funcao: (p.funcao || '').trim() || null })).filter((p) => p.participante_nome)
    setSalvando(true)
    setErro(null)
    try {
      let ddsId = dds?.id
      if (ddsId) {
        const { error } = await supabase.from('ehs_dds')
          .update({ data, tema: tema.trim(), conteudo: conteudo.trim() || null, setor: setor.trim() || null, responsavel: responsavel.trim() || null, duracao_min: duracao, observacoes: observacoes.trim() || null, atualizado_em: new Date().toISOString() })
          .eq('id', ddsId)
        if (error) throw error
        const { error: delErr } = await supabase.from('ehs_dds_presenca').delete().eq('dds_id', ddsId)
        if (delErr) throw delErr
      } else {
        const { data: nova, error } = await supabase.from('ehs_dds')
          .insert({ company_id: companyId, data, tema: tema.trim(), conteudo: conteudo.trim() || null, setor: setor.trim() || null, responsavel: responsavel.trim() || null, duracao_min: duracao, observacoes: observacoes.trim() || null })
          .select('id').single()
        if (error) throw error
        ddsId = nova!.id
      }
      if (participantes.length > 0) {
        const payload = participantes.map((p) => ({ company_id: companyId, dds_id: ddsId, participante_nome: p.participante_nome, funcao: p.funcao, presente: true }))
        const { error: insErr } = await supabase.from('ehs_dds_presenca').insert(payload)
        if (insErr) throw insErr
      }
      onSaved()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao salvar o DDS')
      setSalvando(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 12 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 22, width: 'min(560px, 96vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: '0 0 12px' }}>{dds?.id ? 'Editar DDS' : 'Novo DDS'}</h3>
        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '8px 10px', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{erro}</div>}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: '1 1 150px' }}>
            <label style={labelStyle}>Data *<AjudaCampo chave="ehs.dds.data" rota={ROTA_AJUDA} /></label>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={inputStyle()} />
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <label style={labelStyle}>Duração (min)<AjudaCampo chave="ehs.dds.duracao_min" rota={ROTA_AJUDA} /></label>
            <input type="number" min={1} max={480} value={duracao} onChange={(e) => setDuracao(Math.max(1, Math.min(480, Number(e.target.value) || 1)))} style={inputStyle()} />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Tema *<AjudaCampo chave="ehs.dds.tema" rota={ROTA_AJUDA} /></label>
          <input value={tema} onChange={(e) => setTema(e.target.value)} style={inputStyle()} placeholder="Ex: Uso correto do protetor auricular" autoFocus />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Conteúdo<AjudaCampo chave="ehs.dds.conteudo" rota={ROTA_AJUDA} /></label>
          <textarea value={conteudo} onChange={(e) => setConteudo(e.target.value)} style={{ ...inputStyle(), minHeight: 60 }} placeholder="Principais pontos abordados no diálogo" />
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: '1 1 180px' }}>
            <label style={labelStyle}>Setor<AjudaCampo chave="ehs.dds.setor" rota={ROTA_AJUDA} /></label>
            <input value={setor} onChange={(e) => setSetor(e.target.value)} style={inputStyle()} placeholder="Ex: Abate (opcional)" />
          </div>
          <div style={{ flex: '1 1 180px' }}>
            <label style={labelStyle}>Responsável<AjudaCampo chave="ehs.dds.responsavel" rota={ROTA_AJUDA} /></label>
            <input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} style={inputStyle()} placeholder="Quem conduziu (opcional)" />
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Observações<AjudaCampo chave="ehs.dds.observacoes" rota={ROTA_AJUDA} /></label>
          <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} style={{ ...inputStyle(), minHeight: 44 }} placeholder="Dúvidas ou encaminhamentos (opcional)" />
        </div>

        <div style={{ borderTop: `1px solid ${C.borderLt}`, paddingTop: 12, marginBottom: 8 }}>
          <label style={labelStyle}>Presença<AjudaCampo chave="ehs.dds.presenca" rota={ROTA_AJUDA} /></label>
          {presencas.length === 0 && <p style={{ fontSize: 12, color: C.muted, margin: '0 0 8px' }}>Nenhum participante ainda. Adicione quem participou do diálogo.</p>}
          {presencas.map((p, idx) => (
            <div key={idx} style={{ border: `1px solid ${C.borderLt}`, borderRadius: 8, padding: 10, marginBottom: 8, background: C.offwhite }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginTop: 8 }}>{idx + 1}.</span>
                <div style={{ flex: '1 1 200px' }}>
                  <label style={labelMini}>Nome{idx === 0 && <AjudaCampo chave="ehs.dds.pres_nome" rota={ROTA_AJUDA} />}</label>
                  <input value={p.participante_nome} onChange={(e) => setPres(idx, { participante_nome: e.target.value })} style={inputStyle()} placeholder="Nome do participante" />
                </div>
                <div style={{ flex: '1 1 150px' }}>
                  <label style={labelMini}>Função{idx === 0 && <AjudaCampo chave="ehs.dds.pres_funcao" rota={ROTA_AJUDA} />}</label>
                  <input value={p.funcao || ''} onChange={(e) => setPres(idx, { funcao: e.target.value })} style={inputStyle()} placeholder="Opcional" />
                </div>
                <button type="button" onClick={() => removePres(idx)} style={{ ...btnMini, color: C.red, border: `1px solid ${C.red}30`, marginTop: 18 }}>Remover</button>
              </div>
            </div>
          ))}
          <button type="button" onClick={addPres} style={{ ...btnMini, borderStyle: 'dashed' }}>+ Adicionar participante</button>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} disabled={salvando} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || !tema.trim()} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 12, fontWeight: 600, cursor: !salvando && tema.trim() ? 'pointer' : 'not-allowed', opacity: !salvando && tema.trim() ? 1 : 0.6 }}>
            {salvando ? 'Salvando…' : (dds?.id ? 'Salvar' : 'Registrar DDS')}
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
