// src/app/dashboard/ehs/meio-ambiente/page.tsx
// PS EHS · M23 Meio Ambiente (EHS-10) — Fatia 1: Aspectos e impactos ambientais (ISO 14001).
// Dados só por RPC guardada (fn_ehs_ma_aspecto_*); RLS por empresa. RD-95 "?" em todo campo,
// RD-98 incluir/editar/excluir (excluir pede motivo e é rastreável), RD-96 design próprio PS.
// Code: desenvolvedor_5_g

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA_AJUDA = '/dashboard/ehs/meio-ambiente'

const C = {
  espresso: '#3D2314',
  offwhite: '#FAF7F2',
  gold: '#C8941A',
  beigeLt: '#f5f0e8',
  borderLt: '#ece3d2',
  ink: '#1a1a1a',
  muted: 'rgba(61, 35, 20, 0.55)',
  green: '#16a34a',
  red: '#dc2626',
  redBg: '#fce8e8',
  amber: '#b45309',
  amberBg: '#fef3c7',
}

const CONDICAO_LABEL: Record<string, string> = {
  normal: 'Normal',
  anormal: 'Anormal (partida/parada)',
  emergencia: 'Emergência',
}
const GATILHO_LABEL: Record<string, string> = {
  mudanca: 'Mudança de processo',
  acidente_ambiental: 'Acidente ambiental',
  nova_licenca: 'Nova licença',
  periodica: 'Revisão periódica',
}

type Aspecto = {
  id: string
  atividade: string
  aspecto: string
  impacto: string
  condicao: string
  severidade: number
  frequencia: number
  requisito_legal: boolean
  significancia: number
  significativo: boolean
  controle: string | null
  situacao: string
  setor_id: string | null
  setor_nome: string | null
  revisao_gatilho: string | null
  revisao_motivo: string | null
  proxima_revisao: string | null
}

type Setor = { id: string; nome: string }

export default function MeioAmbientePage() {
  const { companyIds, companies } = useCompanyIds()
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

  const [itens, setItens] = useState<Aspecto[]>([])
  const [setores, setSetores] = useState<Setor[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [soSignificativos, setSoSignificativos] = useState(false)
  const [showNovo, setShowNovo] = useState(false)
  const [editando, setEditando] = useState<Aspecto | null>(null)
  const [excluindo, setExcluindo] = useState<Aspecto | null>(null)

  const carregar = useCallback(async () => {
    if (!companyAlvo) return
    setLoading(true)
    setErro(null)
    try {
      const { data, error } = await supabase.rpc('fn_ehs_ma_aspecto_listar', { p_company_id: companyAlvo })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : (data?.erro || 'Falha ao carregar'))
      setItens((data.itens || []) as Aspecto[])
      // setores para o formulário (globais + da empresa)
      const { data: s } = await supabase
        .from('compliance_setores')
        .select('id, nome, is_global, company_id, ativo')
        .or(`is_global.eq.true,company_id.eq.${companyAlvo}`)
        .order('nome')
      setSetores(((s || []) as any[]).filter((x) => x.ativo !== false).map((x) => ({ id: x.id, nome: x.nome })))
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar aspectos e impactos')
    } finally {
      setLoading(false)
    }
  }, [companyAlvo])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return itens.filter((a) => {
      if (soSignificativos && !a.significativo) return false
      if (q) {
        const hay = `${a.atividade} ${a.aspecto} ${a.impacto} ${a.setor_nome || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [itens, busca, soSignificativos])

  const resumo = useMemo(() => {
    const total = itens.length
    const signif = itens.filter((a) => a.significativo).length
    const semControle = itens.filter((a) => a.significativo && !a.controle).length
    return { total, signif, semControle }
  }, [itens])

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>EHS · Meio ambiente</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>Aspectos e impactos ambientais</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted }}>
              Levantamento ISO 14001: o que cada atividade causa no meio ambiente, sua significância e os controles.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/dashboard/ehs" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
              ← Voltar
            </Link>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button
                onClick={() => setShowNovo(true)}
                disabled={!companyAlvo}
                style={{ padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: companyAlvo ? 'pointer' : 'not-allowed', opacity: companyAlvo ? 1 : 0.5 }}
              >
                + Novo aspecto
              </button>
              <AjudaCampo chave="ehs.meio_ambiente.novo" rota={ROTA_AJUDA} />
            </span>
          </div>
        </header>

        {erro && (
          <div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{erro}</div>
        )}

        {/* Empresa alvo (grupo) */}
        {multiEmpresa && (
          <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            <label style={{ display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              Empresa
              <AjudaCampo chave="ehs.meio_ambiente.atividade" rota={ROTA_AJUDA} />
            </label>
            <select value={companyAlvo} onChange={(e) => setCompanyAlvo(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', minWidth: 240 }}>
              {(companyIds || []).map((id) => (<option key={id} value={id}>{empresaPorId.get(id) || id}</option>))}
            </select>
          </section>
        )}

        {/* Resumo */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
          <KpiCard rotulo="Aspectos" valor={resumo.total} ajuda="ehs.meio_ambiente.significancia" />
          <KpiCard rotulo="Significativos" valor={resumo.signif} cor={C.amber} ajuda="ehs.meio_ambiente.requisito_legal" />
          <KpiCard rotulo="Significativos sem controle" valor={resumo.semControle} cor={resumo.semControle > 0 ? C.red : C.green} ajuda="ehs.meio_ambiente.controle" />
        </section>

        {/* Busca + filtro */}
        <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 16, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>Buscar<AjudaCampo chave="ehs.meio_ambiente.aspecto" rota={ROTA_AJUDA} /></span>
            <input type="text" placeholder="Atividade, aspecto, impacto ou setor…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: C.offwhite, marginTop: 6, textTransform: 'none', letterSpacing: 'normal', fontWeight: 400 }} />
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.espresso, fontWeight: 600, paddingBottom: 10 }}>
            <input type="checkbox" checked={soSignificativos} onChange={(e) => setSoSignificativos(e.target.checked)} />
            Só significativos
            <AjudaCampo chave="ehs.meio_ambiente.significancia" rota={ROTA_AJUDA} />
          </label>
        </section>

        {/* Lista */}
        <section style={{ backgroundColor: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: C.beigeLt }}>
                  <Th><span style={thLabel}>Atividade<AjudaCampo chave="ehs.meio_ambiente.atividade" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Aspecto<AjudaCampo chave="ehs.meio_ambiente.aspecto" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Impacto<AjudaCampo chave="ehs.meio_ambiente.impacto" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Condição<AjudaCampo chave="ehs.meio_ambiente.condicao" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Signif.<AjudaCampo chave="ehs.meio_ambiente.significancia" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Controle<AjudaCampo chave="ehs.meio_ambiente.controle" rota={ROTA_AJUDA} /></span></Th>
                  <Th><span style={thLabel}>Ações<AjudaCampo chave="ehs.meio_ambiente.editar" rota={ROTA_AJUDA} /></span></Th>
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>)}
                {!loading && filtrados.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: C.muted }}>
                    <div style={{ fontSize: 14, marginBottom: 10 }}>Nenhum aspecto ambiental cadastrado ainda.</div>
                    <button onClick={() => setShowNovo(true)} disabled={!companyAlvo} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: companyAlvo ? 'pointer' : 'not-allowed', opacity: companyAlvo ? 1 : 0.5 }}>+ Cadastrar o primeiro</button>
                  </td></tr>
                )}
                {filtrados.map((a, i) => (
                  <tr key={a.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                    <Td>
                      <div style={{ fontWeight: 600, color: C.espresso }}>{a.atividade}</div>
                      {a.setor_nome && <div style={{ fontSize: 11, color: C.muted }}>{a.setor_nome}</div>}
                    </Td>
                    <Td>{a.aspecto}</Td>
                    <Td>{a.impacto}</Td>
                    <Td>{CONDICAO_LABEL[a.condicao] || a.condicao}</Td>
                    <Td>
                      <span style={{ fontWeight: 700, color: a.significativo ? C.amber : C.ink }}>{a.significancia}</span>
                      {a.significativo && (
                        <span style={{ marginLeft: 6, padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700, backgroundColor: C.amberBg, color: C.amber }}>SIGNIFICATIVO</span>
                      )}
                      {a.requisito_legal && (
                        <span style={{ marginLeft: 6, padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700, backgroundColor: C.gold + '22', color: C.gold }}>LEGAL</span>
                      )}
                    </Td>
                    <Td>
                      {a.controle
                        ? <span style={{ color: C.ink }}>{a.controle}</span>
                        : <span style={{ color: a.significativo ? C.red : C.muted, fontWeight: a.significativo ? 600 : 400 }}>{a.significativo ? 'sem controle ⚠' : '—'}</span>}
                    </Td>
                    <Td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button onClick={() => setEditando(a)} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Editar</button>
                        {i === 0 && <AjudaCampo chave="ehs.meio_ambiente.editar" rota={ROTA_AJUDA} />}
                        <button onClick={() => setExcluindo(a)} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.red}30`, backgroundColor: 'white', color: C.red, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Excluir</button>
                        {i === 0 && <AjudaCampo chave="ehs.meio_ambiente.excluir" rota={ROTA_AJUDA} />}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {(showNovo || editando) && companyAlvo && (
        <AspectoFormModal
          companyId={companyAlvo}
          setores={setores}
          aspecto={editando || undefined}
          onClose={() => { setShowNovo(false); setEditando(null) }}
          onSaved={() => { setShowNovo(false); setEditando(null); carregar() }}
        />
      )}

      {excluindo && (
        <ExcluirModal
          aspecto={excluindo}
          onClose={() => setExcluindo(null)}
          onDone={() => { setExcluindo(null); carregar() }}
        />
      )}
    </div>
  )
}

function AspectoFormModal({ companyId, setores, aspecto, onClose, onSaved }: {
  companyId: string
  setores: Setor[]
  aspecto?: Aspecto
  onClose: () => void
  onSaved: () => void
}) {
  const [atividade, setAtividade] = useState(aspecto?.atividade || '')
  const [aspectoTxt, setAspectoTxt] = useState(aspecto?.aspecto || '')
  const [impacto, setImpacto] = useState(aspecto?.impacto || '')
  const [condicao, setCondicao] = useState(aspecto?.condicao || 'normal')
  const [severidade, setSeveridade] = useState<number>(aspecto?.severidade || 3)
  const [frequencia, setFrequencia] = useState<number>(aspecto?.frequencia || 3)
  const [requisitoLegal, setRequisitoLegal] = useState<boolean>(aspecto?.requisito_legal || false)
  const [controle, setControle] = useState(aspecto?.controle || '')
  const [setorId, setSetorId] = useState(aspecto?.setor_id || '')
  const [gatilho, setGatilho] = useState(aspecto?.revisao_gatilho || '')
  const [revisaoMotivo, setRevisaoMotivo] = useState(aspecto?.revisao_motivo || '')
  const [proximaRevisao, setProximaRevisao] = useState(aspecto?.proxima_revisao || '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const significancia = severidade * frequencia * (requisitoLegal ? 2 : 1)
  const significativo = requisitoLegal || severidade * frequencia >= 12

  async function salvar() {
    if (!atividade.trim() || !aspectoTxt.trim() || !impacto.trim()) { setErro('Atividade, aspecto e impacto são obrigatórios.'); return }
    setSalvando(true)
    setErro(null)
    try {
      const { data, error } = await supabase.rpc('fn_ehs_ma_aspecto_salvar', {
        p_dados: {
          id: aspecto?.id || null,
          company_id: companyId,
          atividade: atividade.trim(),
          aspecto: aspectoTxt.trim(),
          impacto: impacto.trim(),
          condicao,
          severidade: String(severidade),
          frequencia: String(frequencia),
          requisito_legal: requisitoLegal,
          controle: controle.trim() || null,
          setor_id: setorId || null,
          revisao_gatilho: gatilho || null,
          revisao_motivo: revisaoMotivo.trim() || null,
          proxima_revisao: proximaRevisao || null,
        },
      })
      if (error) throw error
      if (!data?.ok) throw new Error(traduzErro(data?.erro))
      onSaved()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao salvar')
      setSalvando(false)
    }
  }

  return (
    <ModalShell onClose={onClose} titulo={aspecto?.id ? 'Editar aspecto/impacto' : 'Novo aspecto/impacto'} largura={560}>
      {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '8px 10px', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{erro}</div>}
      <Campo rotulo="Atividade *" ajuda="ehs.meio_ambiente.atividade">
        <input value={atividade} onChange={(e) => setAtividade(e.target.value)} style={inputStyle()} placeholder="Ex: Abate — sangria" autoFocus />
      </Campo>
      <Campo rotulo="Aspecto ambiental *" ajuda="ehs.meio_ambiente.aspecto">
        <input value={aspectoTxt} onChange={(e) => setAspectoTxt(e.target.value)} style={inputStyle()} placeholder="Ex: Geração de efluente orgânico" />
      </Campo>
      <Campo rotulo="Impacto ambiental *" ajuda="ehs.meio_ambiente.impacto">
        <input value={impacto} onChange={(e) => setImpacto(e.target.value)} style={inputStyle()} placeholder="Ex: Carga poluidora em corpo d'água" />
      </Campo>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Campo rotulo="Condição" ajuda="ehs.meio_ambiente.condicao">
          <select value={condicao} onChange={(e) => setCondicao(e.target.value)} style={inputStyle()}>
            {Object.entries(CONDICAO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Setor" ajuda="ehs.meio_ambiente.setor">
          <select value={setorId} onChange={(e) => setSetorId(e.target.value)} style={inputStyle()}>
            <option value="">— sem setor —</option>
            {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </Campo>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Campo rotulo="Severidade (1–5)" ajuda="ehs.meio_ambiente.severidade">
          <select value={severidade} onChange={(e) => setSeveridade(Number(e.target.value))} style={inputStyle()}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Frequência (1–5)" ajuda="ehs.meio_ambiente.frequencia">
          <select value={frequencia} onChange={(e) => setFrequencia(Number(e.target.value))} style={inputStyle()}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Campo>
      </div>
      <Campo rotulo="Tem requisito legal?" ajuda="ehs.meio_ambiente.requisito_legal">
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.ink }}>
          <input type="checkbox" checked={requisitoLegal} onChange={(e) => setRequisitoLegal(e.target.checked)} />
          Sim, há lei / licença / condicionante
        </label>
      </Campo>

      {/* Significância calculada (read-only) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, backgroundColor: C.beigeLt, borderRadius: 8, padding: '10px 14px', margin: '4px 0 12px' }}>
        <span style={{ fontSize: 12, color: C.muted, display: 'inline-flex', alignItems: 'center' }}>Significância<AjudaCampo chave="ehs.meio_ambiente.significancia" rota={ROTA_AJUDA} /></span>
        <strong style={{ fontSize: 20, color: significativo ? C.amber : C.espresso }}>{significancia}</strong>
        {significativo && <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, backgroundColor: C.amberBg, color: C.amber }}>SIGNIFICATIVO</span>}
      </div>

      <Campo rotulo="Controle existente" ajuda="ehs.meio_ambiente.controle">
        <textarea value={controle} onChange={(e) => setControle(e.target.value)} style={{ ...inputStyle(), minHeight: 52 }} placeholder="Ex: Estação de tratamento de efluente (ETE) com monitoramento mensal" />
      </Campo>
      <details style={{ marginBottom: 8 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, color: C.espresso, display: 'inline-flex', alignItems: 'center' }}>
          Revisão por gatilho (opcional)<AjudaCampo chave="ehs.meio_ambiente.revisao" rota={ROTA_AJUDA} />
        </summary>
        <div style={{ paddingTop: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Campo rotulo="Gatilho" ajuda="ehs.meio_ambiente.revisao">
              <select value={gatilho} onChange={(e) => setGatilho(e.target.value)} style={inputStyle()}>
                <option value="">—</option>
                {Object.entries(GATILHO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Campo>
            <Campo rotulo="Próxima revisão" ajuda="ehs.meio_ambiente.revisao">
              <input type="date" value={proximaRevisao || ''} onChange={(e) => setProximaRevisao(e.target.value)} style={inputStyle()} />
            </Campo>
          </div>
          <Campo rotulo="Motivo da revisão" ajuda="ehs.meio_ambiente.revisao">
            <input value={revisaoMotivo} onChange={(e) => setRevisaoMotivo(e.target.value)} style={inputStyle()} placeholder="Ex: nova licença de operação emitida" />
          </Campo>
        </div>
      </details>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <button onClick={onClose} disabled={salvando} style={btnSec}>Cancelar</button>
        <button onClick={salvar} disabled={salvando} style={{ ...btnPri, opacity: salvando ? 0.6 : 1 }}>{salvando ? 'Salvando…' : (aspecto?.id ? 'Salvar' : 'Criar')}</button>
      </div>
    </ModalShell>
  )
}

function ExcluirModal({ aspecto, onClose, onDone }: { aspecto: Aspecto; onClose: () => void; onDone: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [excluindo, setExcluindo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function excluir() {
    if (!motivo.trim()) { setErro('Informe o motivo da exclusão.'); return }
    setExcluindo(true)
    setErro(null)
    try {
      const { data, error } = await supabase.rpc('fn_ehs_ma_aspecto_excluir', { p_id: aspecto.id, p_motivo: motivo.trim() })
      if (error) throw error
      if (!data?.ok) throw new Error(traduzErro(data?.erro))
      onDone()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao excluir')
      setExcluindo(false)
    }
  }

  return (
    <ModalShell onClose={onClose} titulo="Excluir aspecto/impacto" largura={420}>
      {erro && <div style={{ backgroundColor: C.redBg, color: C.red, padding: '8px 10px', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{erro}</div>}
      <p style={{ fontSize: 13, color: C.ink, margin: '0 0 12px' }}>
        Vai excluir <strong>{aspecto.atividade}</strong> — {aspecto.aspecto}. Nada some de verdade: fica registrado quem excluiu e por quê.
      </p>
      <Campo rotulo="Motivo *" ajuda="ehs.meio_ambiente.excluir">
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} style={inputStyle()} placeholder="Ex: processo desativado na planta" autoFocus />
      </Campo>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <button onClick={onClose} disabled={excluindo} style={btnSec}>Cancelar</button>
        <button onClick={excluir} disabled={excluindo || !motivo.trim()} style={{ ...btnPri, backgroundColor: C.red, opacity: excluindo || !motivo.trim() ? 0.6 : 1 }}>{excluindo ? 'Excluindo…' : 'Excluir'}</button>
      </div>
    </ModalShell>
  )
}

function traduzErro(code?: string): string {
  const m: Record<string, string> = {
    sem_acesso: 'Sem acesso a esta empresa.',
    empresa_obrigatoria: 'Empresa obrigatória.',
    atividade_aspecto_impacto_obrigatorios: 'Atividade, aspecto e impacto são obrigatórios.',
    severidade_frequencia_de_1_a_5: 'Severidade e frequência devem ser de 1 a 5.',
    condicao_invalida: 'Condição inválida.',
    setor_de_outra_empresa: 'O setor escolhido não é desta empresa.',
    registro_nao_encontrado: 'Registro não encontrado.',
    motivo_obrigatorio: 'Informe o motivo da exclusão.',
  }
  return (code && m[code]) || 'Não foi possível concluir.'
}

function KpiCard({ rotulo, valor, cor, ajuda }: { rotulo: string; valor: number; cor?: string; ajuda: string }) {
  return (
    <div style={{ backgroundColor: 'white', borderRadius: 12, padding: '14px 16px', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, display: 'inline-flex', alignItems: 'center' }}>
        {rotulo}<AjudaCampo chave={ajuda} rota={ROTA_AJUDA} />
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: cor || C.espresso, fontFamily: 'Fraunces, Georgia, serif' }}>{valor}</div>
    </div>
  )
}

function ModalShell({ onClose, titulo, largura, children }: { onClose: () => void; titulo: string; largura: number; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 22, width: `min(${largura}px, 94vw)`, maxHeight: '92vh', overflowY: 'auto' }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: '0 0 14px' }}>{titulo}</h3>
        {children}
      </div>
    </div>
  )
}

function Campo({ rotulo, ajuda, children }: { rotulo: string; ajuda: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center' }}>{rotulo}<AjudaCampo chave={ajuda} rota={ROTA_AJUDA} /></label>
      {children}
    </div>
  )
}

const thLabel: React.CSSProperties = { display: 'inline-flex', alignItems: 'center' }
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }
const btnSec: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' }
const btnPri: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }

function inputStyle() {
  return { width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 14, background: C.offwhite, color: C.ink, boxSizing: 'border-box' } as any
}

function Th({ children }: { children: any }) {
  return (<th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(61, 35, 20, 0.65)' }}>{children}</th>)
}
function Td({ children }: { children: any }) {
  return (<td style={{ padding: '10px 16px', verticalAlign: 'top' }}>{children}</td>)
}
