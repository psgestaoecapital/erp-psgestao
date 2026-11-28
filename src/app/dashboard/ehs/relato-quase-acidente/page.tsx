// src/app/dashboard/ehs/relato-quase-acidente/page.tsx
// PS EHS · EHS-7 / M10 — Campo digital: RELATO DE QUASE-ACIDENTE (near-miss)
// Qualquer pessoa registra, em poucos toques, um quase-acidente / condição insegura / ato inseguro — anônimo
// opcional — e a SST acompanha o tratamento (aberto → em análise → tratado → encerrado).
// Backend: ehs_relato_quase_acidente (RLS por empresa via get_user_company_ids). Exclusão rastreável (RD-98).
// QR abre o formulário rápido (?rapido=1) no celular, a partir da URL canônica (@/lib/appUrl).

'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import QRCode from 'qrcode'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { APP_URL as APP_BASE } from '@/lib/appUrl'

const ROTA = '/dashboard/ehs/relato-quase-acidente'

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
  amber: '#b45309',
  green: '#15803d',
}

type Tipo = 'quase_acidente' | 'condicao_insegura' | 'ato_inseguro' | 'outro'
type Gravidade = 'baixa' | 'media' | 'alta' | ''
type Origem = 'app' | 'qr' | 'whatsapp'
type Status = 'aberto' | 'em_analise' | 'tratado' | 'encerrado'

type Relato = {
  id: string
  company_id: string
  data_ocorrencia: string
  hora_ocorrencia: string | null
  local: string | null
  setor: string | null
  tipo: Tipo
  gravidade_potencial: Gravidade
  descricao: string
  acao_imediata: string | null
  anonimo: boolean
  relator_nome: string | null
  relator_contato: string | null
  origem: Origem
  status: Status
  observacoes: string | null
  ativo: boolean
}

const TIPO_LABEL: Record<Tipo, string> = {
  quase_acidente: 'Quase-acidente',
  condicao_insegura: 'Condição insegura',
  ato_inseguro: 'Ato inseguro',
  outro: 'Outro',
}
const GRAV_LABEL: Record<string, string> = { baixa: 'Baixa', media: 'Média', alta: 'Alta' }
const STATUS_LABEL: Record<Status, string> = { aberto: 'Aberto', em_analise: 'Em análise', tratado: 'Tratado', encerrado: 'Encerrado' }
const STATUS_COR: Record<Status, string> = { aberto: C.red, em_analise: C.amber, tratado: C.green, encerrado: C.muted }
const ORIGEM_LABEL: Record<Origem, string> = { app: 'App', qr: 'QR', whatsapp: 'WhatsApp' }

function formatarData(iso: string): string {
  if (!iso) return ''
  const [a, m, d] = iso.split('-')
  return d && m && a ? `${d}/${m}/${a}` : iso
}

export default function RelatoQuaseAcidentePage() {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: C.muted }}>Carregando…</div>}>
      <RelatoInner />
    </Suspense>
  )
}

function RelatoInner() {
  const searchParams = useSearchParams()
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

  const [registros, setRegistros] = useState<Relato[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<'' | Status>('')
  const [showNovo, setShowNovo] = useState(false)
  const [editando, setEditando] = useState<Relato | null>(null)
  const [showQr, setShowQr] = useState(false)

  // QR em modo rápido: ao abrir a tela por ?rapido=1 (vindo do QR), já abre o formulário.
  useEffect(() => {
    if (searchParams?.get('rapido') === '1') setShowNovo(true)
  }, [searchParams])

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const ids = companyIdsKey ? companyIdsKey.split(',').filter(Boolean) : []
      if (ids.length === 0) { setRegistros([]); return }
      const { data, error } = await supabase
        .from('ehs_relato_quase_acidente')
        .select('id, company_id, data_ocorrencia, hora_ocorrencia, local, setor, tipo, gravidade_potencial, descricao, acao_imediata, anonimo, relator_nome, relator_contato, origem, status, observacoes, ativo')
        .eq('ativo', true)
        .in('company_id', ids)
        .order('data_ocorrencia', { ascending: false })
      if (error) throw error
      setRegistros((data || []) as Relato[])
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar os relatos')
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return registros.filter((r) => {
      if (filtroStatus && r.status !== filtroStatus) return false
      if (!q) return true
      return `${r.descricao} ${r.local || ''} ${r.setor || ''}`.toLowerCase().includes(q)
    })
  }, [registros, busca, filtroStatus])

  const abertos = useMemo(() => registros.filter((r) => r.status === 'aberto').length, [registros])

  async function desativar(r: Relato) {
    const motivo = prompt('Desativar este relato? O histórico é preservado.\nInforme o motivo (fica registrado):')
    if (motivo === null) return
    if (!motivo.trim()) { alert('Informe o motivo para desativar.'); return }
    try {
      const { error } = await supabase
        .from('ehs_relato_quase_acidente')
        .update({ ativo: false, excluido_em: new Date().toISOString(), excluido_motivo: motivo.trim(), atualizado_em: new Date().toISOString() })
        .eq('id', r.id)
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
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, fontWeight: 400, margin: '4px 0 6px' }}>Relato de quase-acidente</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted, maxWidth: 580 }}>
              Registre em segundos o que <strong>quase</strong> deu errado — quase-acidente, condição ou ato inseguro — anônimo se quiser. É assim que a segurança age antes do acidente.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/dashboard/ehs" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>← Voltar</Link>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button onClick={() => setShowQr(true)}
                style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                QR do relato rápido
              </button>
              <AjudaCampo chave="ehs.relato.qr" rota={ROTA} />
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button onClick={() => setShowNovo(true)} disabled={!companyAlvo}
                style={{ padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: companyAlvo ? 'pointer' : 'not-allowed', opacity: companyAlvo ? 1 : 0.5 }}>
                + Novo relato
              </button>
              <AjudaCampo chave="ehs.relato.novo" rota={ROTA} />
            </span>
          </div>
        </header>

        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{erro}</div>}

        {abertos > 0 && (
          <div style={{ backgroundColor: '#fff7ed', border: `1px solid ${C.gold}44`, color: C.amber, padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 600 }}>
            {abertos} relato{abertos > 1 ? 's' : ''} em aberto aguardando tratamento.
          </div>
        )}

        {multiEmpresa && (
          <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            <label style={labelInline}>
              Empresa-alvo para registrar relato
              <AjudaCampo chave="ehs.relato.empresa" rota={ROTA} />
            </label>
            <select value={companyAlvo} onChange={(e) => setCompanyAlvo(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', minWidth: 240, marginTop: 6 }}>
              {(companyIds || []).map((id) => (<option key={id} value={id}>{empresaPorId.get(id) || id}</option>))}
            </select>
          </section>
        )}

        <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 240px' }}>
            <label style={labelInline}>Buscar<AjudaCampo chave="ehs.relato.busca" rota={ROTA} /></label>
            <input type="text" placeholder="Buscar por descrição, local ou setor…" value={busca} onChange={(e) => setBusca(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: C.offwhite, marginTop: 6, boxSizing: 'border-box' }} />
          </div>
          <div style={{ flex: '0 1 200px' }}>
            <label style={labelInline}>Situação<AjudaCampo chave="ehs.relato.filtro_status" rota={ROTA} /></label>
            <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as any)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', marginTop: 6, boxSizing: 'border-box' }}>
              <option value="">Todas</option>
              {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (<option key={s} value={s}>{STATUS_LABEL[s]}</option>))}
            </select>
          </div>
        </section>

        <section style={{ backgroundColor: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: C.beigeLt }}>
                  <Th><span style={thLabel}>Data<AjudaCampo chave="ehs.relato.col_data" rota={ROTA} /></span></Th>
                  <Th><span style={thLabel}>Tipo / descrição<AjudaCampo chave="ehs.relato.col_tipo" rota={ROTA} /></span></Th>
                  <Th><span style={thLabel}>Local / setor<AjudaCampo chave="ehs.relato.col_local" rota={ROTA} /></span></Th>
                  <Th><span style={thLabel}>Gravidade<AjudaCampo chave="ehs.relato.col_gravidade" rota={ROTA} /></span></Th>
                  <Th><span style={thLabel}>Situação<AjudaCampo chave="ehs.relato.col_status" rota={ROTA} /></span></Th>
                  <Th><span style={thLabel}>Ações<AjudaCampo chave="ehs.relato.col_acoes" rota={ROTA} /></span></Th>
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>)}
                {!loading && filtrados.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 28, textAlign: 'center', color: C.muted }}>
                    Nenhum relato {filtroStatus ? `com a situação "${STATUS_LABEL[filtroStatus as Status]}"` : 'registrado ainda'}. Clique em <strong>+ Novo relato</strong> para registrar o que quase deu errado.
                  </td></tr>
                )}
                {filtrados.map((r, i) => (
                  <tr key={r.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                    <Td>
                      <span style={{ fontWeight: 600, color: C.espresso }}>{formatarData(r.data_ocorrencia)}</span>
                      {r.hora_ocorrencia && <div style={{ fontSize: 11, color: C.muted }}>{r.hora_ocorrencia.slice(0, 5)}</div>}
                    </Td>
                    <Td>
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, backgroundColor: C.gold + '22', color: C.gold }}>{TIPO_LABEL[r.tipo]}</span>
                      {r.anonimo && <span style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, backgroundColor: C.espresso + '14', color: C.espresso }}>anônimo</span>}
                      <div style={{ fontSize: 13, color: C.ink, marginTop: 3, maxWidth: 440 }}>{r.descricao.length > 140 ? r.descricao.slice(0, 140) + '…' : r.descricao}</div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Origem: {ORIGEM_LABEL[r.origem]}{!r.anonimo && r.relator_nome ? ` · ${r.relator_nome}` : ''}</div>
                    </Td>
                    <Td>
                      {r.local || <span style={{ color: C.muted }}>—</span>}
                      {r.setor && <div style={{ fontSize: 11, color: C.muted }}>{r.setor}</div>}
                    </Td>
                    <Td>{r.gravidade_potencial ? GRAV_LABEL[r.gravidade_potencial] : <span style={{ color: C.muted }}>—</span>}</Td>
                    <Td><span style={{ fontWeight: 700, color: STATUS_COR[r.status] }}>{STATUS_LABEL[r.status]}</span></Td>
                    <Td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button onClick={() => setEditando(r)} style={btnMini}>Abrir</button>
                        {i === 0 && <AjudaCampo chave="ehs.relato.editar" rota={ROTA} />}
                        <button onClick={() => desativar(r)} style={{ ...btnMini, color: C.red, border: `1px solid ${C.red}30` }}>Desativar</button>
                        {i === 0 && <AjudaCampo chave="ehs.relato.desativar" rota={ROTA} />}
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
        <RelatoFormModal companyId={companyAlvo} onClose={() => setShowNovo(false)} onSaved={() => { setShowNovo(false); carregar() }} />
      )}
      {editando && (
        <RelatoFormModal companyId={editando.company_id} relato={editando} onClose={() => setEditando(null)} onSaved={() => { setEditando(null); carregar() }} />
      )}
      {showQr && <QrModal onClose={() => setShowQr(false)} />}
    </div>
  )
}

function QrModal({ onClose }: { onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null)
  const link = `${APP_BASE}${ROTA}?rapido=1`
  useEffect(() => {
    QRCode.toDataURL(link, { margin: 1, scale: 8, color: { dark: C.espresso, light: '#FFFFFF' } }).then(setQr).catch(() => setQr(null))
  }, [link])
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 12 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 22, width: 'min(380px, 96vw)', textAlign: 'center' }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: '0 0 8px' }}>QR do relato rápido</h3>
        <p style={{ fontSize: 13, color: C.muted, margin: '0 0 14px' }}>Cole o QR no chão de fábrica. Qualquer pessoa aponta a câmera e registra o relato em segundos.</p>
        {qr
          ? <img src={qr} alt={`QR que abre ${link}`} width={220} height={220} style={{ width: 220, height: 220 }} />
          : <div style={{ width: 220, height: 220, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, border: `1px dashed ${C.borderLt}`, borderRadius: 8 }}>Gerando QR…</div>}
        <div style={{ marginTop: 12, fontSize: 11, color: C.muted, wordBreak: 'break-all' }}>{link}</div>
        <button onClick={onClose} style={{ marginTop: 16, padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Fechar</button>
      </div>
    </div>
  )
}

function RelatoFormModal({ companyId, relato, onClose, onSaved }: { companyId: string; relato?: Relato; onClose: () => void; onSaved: () => void }) {
  const hoje = new Date().toISOString().slice(0, 10)
  const edicao = !!relato?.id
  const [data, setData] = useState(relato?.data_ocorrencia || hoje)
  const [hora, setHora] = useState(relato?.hora_ocorrencia ? relato.hora_ocorrencia.slice(0, 5) : '')
  const [local, setLocal] = useState(relato?.local || '')
  const [setor, setSetor] = useState(relato?.setor || '')
  const [tipo, setTipo] = useState<Tipo>(relato?.tipo || 'quase_acidente')
  const [gravidade, setGravidade] = useState<Gravidade>(relato?.gravidade_potencial || '')
  const [descricao, setDescricao] = useState(relato?.descricao || '')
  const [acaoImediata, setAcaoImediata] = useState(relato?.acao_imediata || '')
  const [anonimo, setAnonimo] = useState<boolean>(relato?.anonimo || false)
  const [relatorNome, setRelatorNome] = useState(relato?.relator_nome || '')
  const [relatorContato, setRelatorContato] = useState(relato?.relator_contato || '')
  const [status, setStatus] = useState<Status>(relato?.status || 'aberto')
  const [observacoes, setObservacoes] = useState(relato?.observacoes || '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    if (!descricao.trim()) { setErro('Descreva o que aconteceu'); return }
    if (!data) { setErro('Informe a data da ocorrência'); return }
    setSalvando(true)
    setErro(null)
    const payload: any = {
      data_ocorrencia: data,
      hora_ocorrencia: hora || null,
      local: local.trim() || null,
      setor: setor.trim() || null,
      tipo,
      gravidade_potencial: gravidade || null,
      descricao: descricao.trim(),
      acao_imediata: acaoImediata.trim() || null,
      anonimo,
      relator_nome: anonimo ? null : (relatorNome.trim() || null),
      relator_contato: anonimo ? null : (relatorContato.trim() || null),
      status,
      observacoes: observacoes.trim() || null,
      atualizado_em: new Date().toISOString(),
    }
    try {
      if (edicao) {
        const { error } = await supabase.from('ehs_relato_quase_acidente').update(payload).eq('id', relato!.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('ehs_relato_quase_acidente').insert({ ...payload, company_id: companyId })
        if (error) throw error
      }
      onSaved()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao salvar o relato')
      setSalvando(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 12 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 22, width: 'min(580px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: '0 0 12px' }}>{edicao ? 'Relato / tratamento' : 'Novo relato de quase-acidente'}</h3>
        {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '8px 10px', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{erro}</div>}

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>O que aconteceu *<AjudaCampo chave="ehs.relato.descricao" rota={ROTA} /></label>
          <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} style={{ ...inputStyle(), minHeight: 70 }} placeholder="Conte o que quase deu errado — onde, como e o risco." autoFocus />
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: '1 1 150px' }}>
            <label style={labelStyle}>Data da ocorrência *<AjudaCampo chave="ehs.relato.data_ocorrencia" rota={ROTA} /></label>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={inputStyle()} />
          </div>
          <div style={{ flex: '0 1 120px' }}>
            <label style={labelStyle}>Hora<AjudaCampo chave="ehs.relato.hora_ocorrencia" rota={ROTA} /></label>
            <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} style={inputStyle()} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: '1 1 180px' }}>
            <label style={labelStyle}>Tipo<AjudaCampo chave="ehs.relato.tipo" rota={ROTA} /></label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)} style={inputStyle()}>
              {(Object.keys(TIPO_LABEL) as Tipo[]).map((t) => (<option key={t} value={t}>{TIPO_LABEL[t]}</option>))}
            </select>
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <label style={labelStyle}>Gravidade potencial<AjudaCampo chave="ehs.relato.gravidade_potencial" rota={ROTA} /></label>
            <select value={gravidade} onChange={(e) => setGravidade(e.target.value as Gravidade)} style={inputStyle()}>
              <option value="">— não avaliada —</option>
              <option value="baixa">Baixa</option>
              <option value="media">Média</option>
              <option value="alta">Alta</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: '1 1 220px' }}>
            <label style={labelStyle}>Local<AjudaCampo chave="ehs.relato.local" rota={ROTA} /></label>
            <input value={local} onChange={(e) => setLocal(e.target.value)} style={inputStyle()} placeholder="Onde aconteceu (ponto, máquina, corredor)" />
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <label style={labelStyle}>Setor<AjudaCampo chave="ehs.relato.setor" rota={ROTA} /></label>
            <input value={setor} onChange={(e) => setSetor(e.target.value)} style={inputStyle()} placeholder="Opcional" />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Ação imediata tomada<AjudaCampo chave="ehs.relato.acao_imediata" rota={ROTA} /></label>
          <textarea value={acaoImediata} onChange={(e) => setAcaoImediata(e.target.value)} style={{ ...inputStyle(), minHeight: 44 }} placeholder="O que já foi feito na hora (opcional)" />
        </div>

        <div style={{ borderTop: `1px solid ${C.borderLt}`, paddingTop: 12, marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: C.espresso, cursor: 'pointer' }}>
            <input type="checkbox" checked={anonimo} onChange={(e) => setAnonimo(e.target.checked)} />
            Relato anônimo (não guardar quem relatou)
            <AjudaCampo chave="ehs.relato.anonimo" rota={ROTA} />
          </label>
          {!anonimo && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
              <div style={{ flex: '1 1 200px' }}>
                <label style={labelStyle}>Quem relatou<AjudaCampo chave="ehs.relato.relator_nome" rota={ROTA} /></label>
                <input value={relatorNome} onChange={(e) => setRelatorNome(e.target.value)} style={inputStyle()} placeholder="Nome (opcional)" />
              </div>
              <div style={{ flex: '1 1 180px' }}>
                <label style={labelStyle}>Contato<AjudaCampo chave="ehs.relato.relator_contato" rota={ROTA} /></label>
                <input value={relatorContato} onChange={(e) => setRelatorContato(e.target.value)} style={inputStyle()} placeholder="Ramal / telefone (opcional)" />
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: '1 1 180px' }}>
            <label style={labelStyle}>Situação<AjudaCampo chave="ehs.relato.status" rota={ROTA} /></label>
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)} style={inputStyle()}>
              {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (<option key={s} value={s}>{STATUS_LABEL[s]}</option>))}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Observações da SST<AjudaCampo chave="ehs.relato.observacoes" rota={ROTA} /></label>
          <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} style={{ ...inputStyle(), minHeight: 44 }} placeholder="Análise e tratamento (opcional)" />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={salvando} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || !descricao.trim()} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 12, fontWeight: 600, cursor: !salvando && descricao.trim() ? 'pointer' : 'not-allowed', opacity: !salvando && descricao.trim() ? 1 : 0.6 }}>
            {salvando ? 'Salvando…' : (edicao ? 'Salvar' : 'Registrar relato')}
          </button>
        </div>
      </div>
    </div>
  )
}

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
