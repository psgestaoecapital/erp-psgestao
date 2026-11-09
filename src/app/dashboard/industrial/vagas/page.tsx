'use client'

// Vagas e reposição de quadro — Indústria/RH. Fluxo de abertura, análise e decisão de vaga sobre a camada rh_vaga
// (tabela + RLS por company_id + RPCs com guarda de papel já publicadas na #3691): abrir (reposição do quadro entra
// aprovada; criação acima do quadro aguarda a diretoria), aprovar/recusar (só quem decide, nunca o próprio solicitante)
// e cancelar (solicitante ou diretoria, enquanto em análise). A tela NUNCA grava direto na tabela: toda escrita é por
// fn_rh_vaga_abrir/decidir/cancelar (SECURITY DEFINER, guarda de empresa e de papel no servidor). A permissão de decidir
// vem do próprio banco (fn_rh_vaga_listar devolve `pode_decidir`); o front só mostra/esconde o botão, o servidor é quem
// autoriza. RD-95: "?" em todo campo/filtro/indicador/ação (AjudaCampo, chaves industrial.vaga.* no banco). RD-96: layout
// próprio, premium, responsivo. Nome e fluxo próprios (nada decalcado de concorrente).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Briefcase, CheckCircle2, XCircle, Clock, Search, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const MUT = 'rgba(61,35,20,0.55)'
const VERM = '#B23B3B'
const VERDE = '#5B8C5A'
const ROTA = '/dashboard/industrial/vagas'

const CARD: React.CSSProperties = { background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }
const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: `0.5px solid ${LINE}`, borderRadius: 8, fontSize: 14, color: ESP, background: '#FFF', boxSizing: 'border-box' }
const sel: React.CSSProperties = { ...inp }
const btnPrim: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: ESP, color: BG, border: `0.5px solid ${ESP}`, display: 'inline-flex', alignItems: 'center', gap: 6 }
const btnSec: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: '#FFF', color: ESP, border: `0.5px solid ${LINE}` }
const rotulo: React.CSSProperties = { display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 600, color: ESP, marginBottom: 4 }

type Status = 'solicitada' | 'aprovada' | 'recusada' | 'cancelada'
type Origem = 'reposicao' | 'criacao'
type Vaga = {
  id: string; setor_id: string | null; setor_nome: string | null
  cargo_id: string | null; cargo_nome: string | null; posto_id: string | null
  quantidade: number; custo_estimado: number | null; justificativa: string | null
  origem: Origem; status: Status; solicitante: string | null; solicitado_em: string
  aprovador: string | null; decidido_em: string | null; decisao_motivo: string | null
}
type Setor = { id: string; nome: string }
type Cargo = { id: string; nome: string }
type Posto = { id: string; numero: string | number | null; atividade: string | null; setor_id: string | null }

const STATUS_ROTULO: Record<Status, string> = { solicitada: 'Em análise', aprovada: 'Aprovada', recusada: 'Recusada', cancelada: 'Cancelada' }
const STATUS_COR: Record<Status, string> = { solicitada: GOLD, aprovada: VERDE, recusada: VERM, cancelada: MUT }
const ORIGEM_ROTULO: Record<Origem, string> = { reposicao: 'Reposição do quadro', criacao: 'Criação (acima do quadro)' }

const brl = (v: number | null) => v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (iso: string | null) => { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}` }
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

type FormVaga = { origem: Origem; setor_id: string; cargo_id: string; posto_id: string; quantidade: string; custo_estimado: string; justificativa: string }
const FORM_VAZIO: FormVaga = { origem: 'reposicao', setor_id: '', cargo_id: '', posto_id: '', quantidade: '1', custo_estimado: '', justificativa: '' }

export default function VagasPage() {
  const { selInfo, sel: selId, companies } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && selId ? selId : null
  const empresaNome = selInfo.nome || companies.find((c) => c.id === companyId)?.nome_fantasia || ''

  const [vagas, setVagas] = useState<Vaga[]>([])
  const [podeDecidir, setPodeDecidir] = useState(false)
  const [setores, setSetores] = useState<Setor[]>([])
  const [cargos, setCargos] = useState<Cargo[]>([])
  const [postos, setPostos] = useState<Posto[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [busca, setBusca] = useState('')
  const [fStatus, setFStatus] = useState('')

  const [formAberto, setFormAberto] = useState(false)
  const [form, setForm] = useState<FormVaga>(FORM_VAZIO)
  const [salvando, setSalvando] = useState(false)

  // decisão / cancelamento com motivo (um modal só)
  const [acao, setAcao] = useState<{ vaga: Vaga; tipo: 'aprovar' | 'recusar' | 'cancelar' } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [decidindo, setDecidindo] = useState(false)

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2800) }

  const carregar = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true); setErro(null)
    const [v, s, c, p] = await Promise.all([
      supabase.rpc('fn_rh_vaga_listar', { p_company_id: companyId, p_status: null }),
      supabase.from('prod_setor').select('id, nome').eq('company_id', companyId).eq('ativo', true).order('nome'),
      supabase.from('prod_cargo').select('id, nome').eq('company_id', companyId).eq('ativo', true).order('nome'),
      supabase.from('prod_posto').select('id, numero, atividade, setor_id').eq('company_id', companyId).eq('ativo', true).order('numero'),
    ])
    if (v.error) { setErro(v.error.message || 'Não foi possível carregar as vagas.'); setVagas([]) }
    else { setVagas((v.data?.itens ?? []) as Vaga[]); setPodeDecidir(!!v.data?.pode_decidir) }
    setSetores((s.data ?? []) as Setor[])
    setCargos((c.data ?? []) as Cargo[])
    setPostos((p.data ?? []) as Posto[])
    setLoading(false)
  }, [companyId])

  useEffect(() => { void carregar() }, [carregar])

  const postosDoSetor = useMemo(() => postos.filter((p) => !form.setor_id || p.setor_id === form.setor_id), [postos, form.setor_id])

  const resumo = useMemo(() => {
    const r = { analise: 0, aprovadas: 0, recusadas: 0 }
    for (const v of vagas) { if (v.status === 'solicitada') r.analise += v.quantidade; else if (v.status === 'aprovada') r.aprovadas += v.quantidade; else if (v.status === 'recusada') r.recusadas += v.quantidade }
    return r
  }, [vagas])

  const filtradas = useMemo(() => {
    const q = norm(busca.trim())
    return vagas.filter((v) => {
      if (fStatus && v.status !== fStatus) return false
      if (q) { const alvo = norm(`${v.setor_nome ?? ''} ${v.cargo_nome ?? ''} ${v.justificativa ?? ''} ${ORIGEM_ROTULO[v.origem]}`); if (!alvo.includes(q)) return false }
      return true
    })
  }, [vagas, busca, fStatus])

  const abrir = async () => {
    if (!companyId) return
    if (!form.setor_id || !form.cargo_id) { flash('Informe setor e cargo.'); return }
    setSalvando(true)
    const payload = {
      origem: form.origem, setor_id: form.setor_id, cargo_id: form.cargo_id,
      posto_id: form.posto_id || null,
      quantidade: Math.max(1, parseInt(form.quantidade || '1', 10) || 1),
      custo_estimado: form.custo_estimado ? Number(form.custo_estimado.replace(',', '.')) : null,
      justificativa: form.justificativa.trim() || null,
    }
    const { data, error } = await supabase.rpc('fn_rh_vaga_abrir', { p_company_id: companyId, p_payload: payload })
    setSalvando(false)
    if (error || !data?.sucesso) { flash(data?.erro || error?.message || 'Não foi possível abrir a vaga.'); return }
    setFormAberto(false); setForm(FORM_VAZIO)
    flash(data.status === 'aprovada' ? 'Vaga de reposição registrada (aprovada).' : 'Vaga enviada para análise da diretoria.')
    void carregar()
  }

  const confirmarAcao = async () => {
    if (!acao) return
    setDecidindo(true)
    let res
    if (acao.tipo === 'cancelar') res = await supabase.rpc('fn_rh_vaga_cancelar', { p_vaga_id: acao.vaga.id, p_motivo: motivo.trim() || null })
    else res = await supabase.rpc('fn_rh_vaga_decidir', { p_vaga_id: acao.vaga.id, p_decisao: acao.tipo === 'aprovar' ? 'aprovada' : 'recusada', p_motivo: motivo.trim() || null })
    setDecidindo(false)
    const data = res.data
    if (res.error || !data?.sucesso) { flash(data?.erro || res.error?.message || 'Não foi possível concluir a ação.'); return }
    setAcao(null); setMotivo('')
    flash(acao.tipo === 'aprovar' ? 'Vaga aprovada.' : acao.tipo === 'recusar' ? 'Vaga recusada.' : 'Vaga cancelada.')
    void carregar()
  }

  if (!companyId) return (
    <div style={{ padding: 'clamp(16px,4vw,28px)', background: BG, minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: ESP, margin: 0 }}>Vagas e reposição de quadro</h1>
      <div style={{ ...CARD, marginTop: 16, color: MUT }}>Selecione uma empresa no topo para abrir e acompanhar as vagas.</div>
    </div>
  )

  return (
    <div style={{ padding: 'clamp(16px,4vw,28px)', background: BG, minHeight: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: ESP, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Briefcase size={20} color={GOLD} /> Vagas e reposição de quadro
          </h1>
          <p style={{ fontSize: 12.5, color: MUT, margin: '4px 0 0' }}>{empresaNome} · reposição entra aprovada; criação acima do quadro aguarda a diretoria.</p>
        </div>
        <button style={btnPrim} onClick={() => { setForm(FORM_VAZIO); setFormAberto((a) => !a) }}>
          <Plus size={15} /> {formAberto ? 'Fechar' : 'Abrir vaga'}
        </button>
      </div>

      {/* indicadores */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, margin: '14px 0' }}>
        <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11.5, color: MUT, display: 'inline-flex', alignItems: 'center' }}><Clock size={13} style={{ marginRight: 4 }} color={GOLD} /> Em análise <AjudaCampo chave="industrial.vaga.resumo" rota={ROTA} /></span>
          <strong style={{ fontSize: 22, color: ESP }}>{resumo.analise}</strong>
        </div>
        <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11.5, color: MUT, display: 'inline-flex', alignItems: 'center' }}><CheckCircle2 size={13} style={{ marginRight: 4 }} color={VERDE} /> Aprovadas</span>
          <strong style={{ fontSize: 22, color: ESP }}>{resumo.aprovadas}</strong>
        </div>
        <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11.5, color: MUT, display: 'inline-flex', alignItems: 'center' }}><XCircle size={13} style={{ marginRight: 4 }} color={VERM} /> Recusadas</span>
          <strong style={{ fontSize: 22, color: ESP }}>{resumo.recusadas}</strong>
        </div>
      </div>

      {/* formulário de abertura */}
      {formAberto && (
        <div style={{ ...CARD, marginBottom: 14 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: ESP, margin: '0 0 12px' }}>Abrir vaga</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
            <label style={{ display: 'block' }}>
              <span style={rotulo}>Origem <AjudaCampo chave="industrial.vaga.origem" rota={ROTA} /></span>
              <select style={sel} value={form.origem} onChange={(e) => setForm({ ...form, origem: e.target.value as Origem })}>
                <option value="reposicao">Reposição do quadro</option>
                <option value="criacao">Criação (acima do quadro)</option>
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <span style={rotulo}>Setor <AjudaCampo chave="industrial.vaga.setor" rota={ROTA} /></span>
              <select style={sel} value={form.setor_id} onChange={(e) => setForm({ ...form, setor_id: e.target.value, posto_id: '' })}>
                <option value="">Selecione…</option>
                {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <span style={rotulo}>Cargo <AjudaCampo chave="industrial.vaga.cargo" rota={ROTA} /></span>
              <select style={sel} value={form.cargo_id} onChange={(e) => setForm({ ...form, cargo_id: e.target.value })}>
                <option value="">Selecione…</option>
                {cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <span style={rotulo}>Posto (opcional) <AjudaCampo chave="industrial.vaga.posto" rota={ROTA} /></span>
              <select style={sel} value={form.posto_id} onChange={(e) => setForm({ ...form, posto_id: e.target.value })}>
                <option value="">Sem posto específico</option>
                {postosDoSetor.map((p) => <option key={p.id} value={p.id}>{`Posto ${p.numero ?? '—'}${p.atividade ? ' · ' + p.atividade : ''}`}</option>)}
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <span style={rotulo}>Quantidade <AjudaCampo chave="industrial.vaga.quantidade" rota={ROTA} /></span>
              <input style={inp} type="number" min={1} value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: e.target.value })} />
            </label>
            <label style={{ display: 'block' }}>
              <span style={rotulo}>Custo mensal estimado (opcional) <AjudaCampo chave="industrial.vaga.custo_estimado" rota={ROTA} /></span>
              <input style={inp} inputMode="decimal" placeholder="R$ por mês" value={form.custo_estimado} onChange={(e) => setForm({ ...form, custo_estimado: e.target.value })} />
            </label>
          </div>
          <label style={{ display: 'block', marginTop: 12 }}>
            <span style={rotulo}>Justificativa <AjudaCampo chave="industrial.vaga.justificativa" rota={ROTA} /></span>
            <textarea style={{ ...inp, minHeight: 72, resize: 'vertical' }} value={form.justificativa} onChange={(e) => setForm({ ...form, justificativa: e.target.value })} placeholder="Por que esta vaga é necessária? (ex.: substituir desligamento, aumento de volume na linha…)" />
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
            <button style={btnSec} onClick={() => setFormAberto(false)}>Cancelar</button>
            <button style={{ ...btnPrim, opacity: salvando ? 0.6 : 1 }} disabled={salvando} onClick={() => void abrir()}>{salvando ? 'Enviando…' : 'Abrir vaga'}</button>
          </div>
        </div>
      )}

      {/* filtros */}
      <div style={{ ...CARD, marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ flex: '1 1 220px' }}>
          <span style={rotulo}>Buscar <AjudaCampo chave="industrial.vaga.busca" rota={ROTA} /></span>
          <span style={{ position: 'relative', display: 'block' }}>
            <Search size={14} style={{ position: 'absolute', left: 9, top: 10, color: MUT, pointerEvents: 'none' }} />
            <input style={{ ...inp, paddingLeft: 28 }} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="setor, cargo ou justificativa" />
          </span>
        </label>
        <label style={{ flex: '0 1 180px' }}>
          <span style={rotulo}>Situação <AjudaCampo chave="industrial.vaga.filtro_status" rota={ROTA} /></span>
          <select style={sel} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">Todas</option>
            <option value="solicitada">Em análise</option>
            <option value="aprovada">Aprovada</option>
            <option value="recusada">Recusada</option>
            <option value="cancelada">Cancelada</option>
          </select>
        </label>
        <span style={{ fontSize: 11.5, color: MUT, paddingBottom: 9 }}>{filtradas.length} de {vagas.length}</span>
      </div>

      {/* lista */}
      {loading ? <div style={{ ...CARD, color: MUT }}>Carregando…</div>
        : erro ? <div style={{ ...CARD, color: VERM }}>{erro}</div>
          : vagas.length === 0 ? (
            <div style={{ ...CARD, textAlign: 'center', padding: '32px 16px' }}>
              <Briefcase size={28} color={GOLD} style={{ opacity: 0.8 }} />
              <p style={{ fontSize: 14, color: ESP, fontWeight: 600, margin: '10px 0 2px' }}>Nenhuma vaga ainda</p>
              <p style={{ fontSize: 12.5, color: MUT, margin: '0 0 14px' }}>Abra a primeira vaga de reposição ou criação de quadro.</p>
              <button style={btnPrim} onClick={() => { setForm(FORM_VAZIO); setFormAberto(true) }}><Plus size={15} /> Abrir vaga</button>
            </div>
          ) : filtradas.length === 0 ? <div style={{ ...CARD, color: MUT }}>Nenhuma vaga para este filtro.</div>
            : (
              <div style={{ display: 'grid', gap: 10 }}>
                {filtradas.map((v) => (
                  <div key={v.id} style={{ ...CARD, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div style={{ minWidth: 220, flex: '1 1 260px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 14.5, color: ESP }}>{v.cargo_nome || '—'}</strong>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: STATUS_COR[v.status], borderRadius: 999, padding: '2px 9px' }}>{STATUS_ROTULO[v.status]}</span>
                        {v.quantidade > 1 && <span style={{ fontSize: 11.5, color: MUT }}>× {v.quantidade}</span>}
                      </div>
                      <div style={{ fontSize: 12.5, color: MUT, marginTop: 3 }}>{v.setor_nome || 'Setor —'} · {ORIGEM_ROTULO[v.origem]}{v.custo_estimado != null ? ` · ${brl(v.custo_estimado)}/mês` : ''}</div>
                      {v.justificativa && <div style={{ fontSize: 12.5, color: ESP, marginTop: 5 }}>{v.justificativa}</div>}
                      <div style={{ fontSize: 11, color: MUT, marginTop: 5 }}>
                        Solicitada em {dataBR(v.solicitado_em)}{v.decidido_em ? ` · decidida em ${dataBR(v.decidido_em)}` : ''}
                        {v.decisao_motivo ? ` · motivo: ${v.decisao_motivo}` : ''}
                      </div>
                    </div>
                    {v.status === 'solicitada' && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <AjudaCampo chave="industrial.vaga.decisao" rota={ROTA} />
                        {podeDecidir && <button style={{ ...btnSec, color: VERDE, borderColor: VERDE }} onClick={() => { setAcao({ vaga: v, tipo: 'aprovar' }); setMotivo('') }}>Aprovar</button>}
                        {podeDecidir && <button style={{ ...btnSec, color: VERM, borderColor: VERM }} onClick={() => { setAcao({ vaga: v, tipo: 'recusar' }); setMotivo('') }}>Recusar</button>}
                        <button style={btnSec} onClick={() => { setAcao({ vaga: v, tipo: 'cancelar' }); setMotivo('') }}>Cancelar</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

      {/* modal de decisão / cancelamento */}
      {acao && (
        <div role="dialog" aria-label="Decisão da vaga" style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setAcao(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...CARD, width: 'min(440px,100%)' }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: ESP, margin: '0 0 4px' }}>
              {acao.tipo === 'aprovar' ? 'Aprovar vaga' : acao.tipo === 'recusar' ? 'Recusar vaga' : 'Cancelar vaga'}
            </h2>
            <p style={{ fontSize: 12.5, color: MUT, margin: '0 0 12px' }}>{acao.vaga.cargo_nome} · {acao.vaga.setor_nome} · {ORIGEM_ROTULO[acao.vaga.origem]}</p>
            <label style={{ display: 'block' }}>
              <span style={rotulo}>Motivo{acao.tipo === 'recusar' ? '' : ' (opcional)'} <AjudaCampo chave="industrial.vaga.motivo" rota={ROTA} /></span>
              <textarea style={{ ...inp, minHeight: 72, resize: 'vertical' }} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={acao.tipo === 'recusar' ? 'Explique por que a vaga foi recusada' : 'Observação (opcional)'} />
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button style={btnSec} onClick={() => setAcao(null)}>Voltar</button>
              <button
                style={{ ...btnPrim, background: acao.tipo === 'recusar' || acao.tipo === 'cancelar' ? VERM : VERDE, borderColor: acao.tipo === 'recusar' || acao.tipo === 'cancelar' ? VERM : VERDE, opacity: decidindo ? 0.6 : 1 }}
                disabled={decidindo || (acao.tipo === 'recusar' && !motivo.trim())}
                onClick={() => void confirmarAcao()}
              >{decidindo ? 'Salvando…' : acao.tipo === 'aprovar' ? 'Aprovar' : acao.tipo === 'recusar' ? 'Recusar' : 'Cancelar vaga'}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESP, color: BG, padding: '10px 18px', borderRadius: 10, fontSize: 13, zIndex: 200, boxShadow: '0 6px 20px rgba(0,0,0,0.2)' }}>{toast}</div>}
    </div>
  )
}
