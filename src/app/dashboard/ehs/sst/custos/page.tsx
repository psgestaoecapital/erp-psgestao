// src/app/dashboard/ehs/sst/custos/page.tsx
// PS EHS · EHS-F (Financeiro acoplado) — Livro de custos de SST
// Registra custos de SST (EPI, treinamento, exame, acidente). Funciona standalone;
// com o adicional financeiro (GE) os custos entram na DRE/fluxo por centro de custo.
// Fronteira F.2 [→GE]: aqui o EHS só registra o evento de custo.
// Code: code-desenvolvedor-3
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { Receipt, Plus, Pencil, Trash2, RefreshCw, X, Wallet } from 'lucide-react'

const ROTA = '/dashboard/ehs/sst/custos'

const C = {
  espresso: '#3D2314', offwhite: '#FAF7F2', gold: '#C8941A', white: '#FFFFFF',
  beigeLt: '#f5f0e8', line: '#ece3d2', ink: '#1a1a1a', muted: 'rgba(61,35,20,0.55)',
  green: '#16a34a', greenBg: '#eaf6ee', amber: '#b45309', amberBg: '#fdf3e3',
}

type Evento = {
  id: string; tipo: string; descricao: string; valor: number; competencia: string
  origem_tipo: string; status: string; setor_id: string | null; setor_nome: string | null
  observacoes: string | null; lancado: boolean
}
type Resposta = { acoplado: boolean; total: number; por_tipo: Record<string, number>; itens: Evento[] }
type Setor = { id: string; nome: string }

const TIPOS: { v: string; label: string }[] = [
  { v: 'epi', label: 'EPI' },
  { v: 'treinamento', label: 'Treinamento' },
  { v: 'exame', label: 'Exame ocupacional' },
  { v: 'acidente', label: 'Acidente' },
  { v: 'sst_geral', label: 'SST geral' },
]
const tipoLabel = (v: string) => TIPOS.find((t) => t.v === v)?.label ?? v
const ORIGENS: { v: string; label: string }[] = [
  { v: 'manual', label: 'Lançamento manual' },
  { v: 'epi_entrega', label: 'Entrega de EPI' },
  { v: 'treinamento', label: 'Treinamento' },
  { v: 'exame_aso', label: 'Exame / ASO' },
  { v: 'incidente', label: 'Incidente' },
  { v: 'outro', label: 'Outro' },
]
const origemLabel = (v: string) => ORIGENS.find((o) => o.v === v)?.label ?? v

const fmtBRL = (n: number) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtComp = (d: string) => {
  if (!d) return '—'
  const [y, m] = d.split('-')
  return `${m}/${y}`
}
// "1.250,00" | "1250,00" | "1250.00" -> 1250.00
const parseBRL = (s: string): number => {
  const t = (s || '').trim().replace(/\s/g, '')
  if (!t) return 0
  const norm = t.replace(/\./g, '').replace(',', '.')
  const n = Number(norm)
  return Number.isFinite(n) ? n : NaN
}

type Form = {
  id: string | null; tipo: string; descricao: string; valor: string; competencia: string
  setor_id: string; origem_tipo: string; observacoes: string
}
const mesAtual = () => new Date().toISOString().slice(0, 7) // YYYY-MM
const formVazio = (): Form => ({
  id: null, tipo: 'epi', descricao: '', valor: '', competencia: mesAtual(),
  setor_id: '', origem_tipo: 'manual', observacoes: '',
})

export default function CustosSstPage() {
  const { companyIds, companies, sel } = useCompanyIds()
  const [companyAlvo, setCompanyAlvo] = useState<string>('')
  const multiEmpresa = (companyIds?.length ?? 0) > 1

  useEffect(() => {
    if (companyAlvo) return
    if (sel && sel !== 'consolidado' && !sel.startsWith('group_')) setCompanyAlvo(sel)
    else if (companyIds && companyIds.length > 0) setCompanyAlvo(companyIds[0])
  }, [sel, companyIds, companyAlvo])

  const anoAtual = new Date().getFullYear()
  const [compIni, setCompIni] = useState<string>(`${anoAtual}-01`)
  const [compFim, setCompFim] = useState<string>(mesAtual())
  const [filtroTipo, setFiltroTipo] = useState<string>('todos')

  const [dados, setDados] = useState<Resposta | null>(null)
  const [setores, setSetores] = useState<Setor[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    if (!companyAlvo) return
    setCarregando(true); setErro(null)
    const [r, s] = await Promise.all([
      supabase.rpc('fn_ehs_evento_custo_listar', {
        p_company_id: companyAlvo,
        p_comp_ini: compIni ? `${compIni}-01` : null,
        p_comp_fim: compFim ? `${compFim}-01` : null,
      }),
      supabase.from('compliance_setores').select('id,nome').eq('company_id', companyAlvo).order('nome'),
    ])
    if (r.error) { setErro('Não foi possível carregar os custos agora. Tente de novo.'); setDados(null) }
    else setDados(r.data as Resposta)
    setSetores(s.error ? [] : ((s.data as Setor[]) || []))
    setCarregando(false)
  }, [companyAlvo, compIni, compFim])

  useEffect(() => { void carregar() }, [carregar])

  const itens = dados?.itens ?? []
  const lista = useMemo(
    () => (filtroTipo === 'todos' ? itens : itens.filter((e) => e.tipo === filtroTipo)),
    [itens, filtroTipo],
  )

  async function salvar() {
    if (!form || !companyAlvo) return
    if (!form.descricao.trim()) { setErro('Informe a descrição do custo.'); return }
    const valorNum = parseBRL(form.valor)
    if (!Number.isFinite(valorNum) || valorNum < 0) { setErro('Informe um valor válido (ex.: 1.250,00).'); return }
    if (!form.competencia) { setErro('Informe a competência (mês).'); return }
    setSalvando(true); setErro(null)
    const { error } = await supabase.rpc('fn_ehs_evento_custo_salvar', {
      p_company_id: companyAlvo, p_id: form.id, p_tipo: form.tipo, p_descricao: form.descricao,
      p_valor: valorNum, p_competencia: `${form.competencia}-01`,
      p_setor_id: form.setor_id || null, p_origem_tipo: form.origem_tipo,
      p_observacoes: form.observacoes || null,
    })
    setSalvando(false)
    if (error) { setErro('Não foi possível salvar. Confira os campos e tente de novo.'); return }
    setForm(null); void carregar()
  }

  async function excluir(e: Evento) {
    if (!companyAlvo) return
    if (!confirm(`Excluir o custo "${e.descricao}"? O histórico é preservado (quem e quando excluiu fica registrado).`)) return
    const { error } = await supabase.rpc('fn_ehs_evento_custo_excluir', { p_company_id: companyAlvo, p_id: e.id })
    if (error) { setErro('Não foi possível excluir agora. Tente de novo.'); return }
    void carregar()
  }

  const acoplado = dados?.acoplado ?? false

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '20px 16px 64px', background: C.offwhite, minHeight: '100vh' }}>
      {/* Cabeçalho */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>💰 EHS · SST</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0', display: 'inline-flex', alignItems: 'center', gap: 8, color: C.espresso }}>
            <Receipt size={22} color={C.gold} /> Custos de SST
          </h1>
          <p style={{ color: C.muted, fontSize: 13, marginTop: 6, maxWidth: 660 }}>
            Registre os custos de saúde e segurança do trabalho (EPI, treinamento, exame, acidente) por mês e por setor.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => void carregar()} title="Atualizar" style={btnIcon}><RefreshCw size={16} /></button>
          <button onClick={() => setForm(formVazio())} style={btnPrimary}><Plus size={16} /> Novo custo</button>
        </div>
      </div>

      {/* F.2 · Financeiro acoplado (adicional por assinatura — nunca quebra o EHS quando ausente) */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, borderRadius: 12, padding: '12px 14px',
        background: acoplado ? C.greenBg : C.beigeLt, border: `1px solid ${acoplado ? '#bfe3c9' : C.line}`,
      }}>
        <Wallet size={20} color={acoplado ? C.green : C.gold} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: C.espresso, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {acoplado ? 'Financeiro acoplado' : 'Financeiro não acoplado'}
            <AjudaCampo chave="ehs.sst_custos.adicional" rota={ROTA} />
          </div>
          <div style={{ color: C.muted, fontSize: 12.5, marginTop: 2 }}>
            {acoplado
              ? 'Com o adicional, estes custos entram na DRE e no fluxo de caixa por centro de custo do setor (Gestão Empresarial).'
              : 'Você registra os custos de SST aqui. Com o adicional financeiro, eles passam a entrar na DRE e no fluxo de caixa por centro de custo do setor.'}
          </div>
        </div>
        {!acoplado && (
          <a href="/dashboard/gestao-empresarial" style={{ ...btnPrimary, textDecoration: 'none', whiteSpace: 'nowrap' }}>Conhecer o adicional →</a>
        )}
      </div>

      {/* Seletor de empresa (grupo) */}
      {multiEmpresa && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 14 }}>
          <span style={lbl}>Empresa<AjudaCampo chave="ehs.sst_custos.empresa_alvo" rota={ROTA} /></span>
          <select value={companyAlvo} onChange={(e) => setCompanyAlvo(e.target.value)} style={inp}>
            {companyIds?.map((id) => {
              const c = companies.find((x: any) => x.id === id)
              return <option key={id} value={id}>{c?.nome_fantasia || c?.razao_social || id}</option>
            })}
          </select>
        </label>
      )}

      {/* Filtros: período + totais */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
        <label style={blk}>
          <span style={lbl}>De<AjudaCampo chave="ehs.sst_custos.competencia" rota={ROTA} /></span>
          <input type="month" value={compIni} onChange={(e) => setCompIni(e.target.value)} style={inp} />
        </label>
        <label style={blk}>
          <span style={lbl}>Até<AjudaCampo chave="ehs.sst_custos.competencia" rota={ROTA} /></span>
          <input type="month" value={compFim} onChange={(e) => setCompFim(e.target.value)} style={inp} />
        </label>
        <div style={{ flex: 1 }} />
        <div style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 12, padding: '10px 16px', textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: C.muted, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Total de SST no período<AjudaCampo chave="ehs.sst_custos.total" rota={ROTA} />
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.espresso }}>{fmtBRL(dados?.total ?? 0)}</div>
        </div>
      </div>

      {/* Chips por tipo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', gap: 4, background: C.white, border: `1px solid ${C.line}`, borderRadius: 10, padding: 4, flexWrap: 'wrap' }}>
          <button onClick={() => setFiltroTipo('todos')} style={seg(filtroTipo === 'todos')}>Todos</button>
          {TIPOS.map((t) => (
            <button key={t.v} onClick={() => setFiltroTipo(t.v)} style={seg(filtroTipo === t.v)}>
              {t.label}{dados?.por_tipo?.[t.v] ? ` · ${fmtBRL(dados.por_tipo[t.v])}` : ''}
            </button>
          ))}
        </div>
        <AjudaCampo chave="ehs.sst_custos.tipo" rota={ROTA} />
      </div>

      {erro && <div style={{ background: '#fce8e8', color: '#dc2626', borderRadius: 10, padding: '10px 12px', marginTop: 14, fontSize: 13 }}>{erro}</div>}

      {/* Lista */}
      <div style={{ marginTop: 16 }}>
        {carregando ? (
          <p style={{ color: C.muted, fontSize: 14, padding: 24, textAlign: 'center' }}>Carregando…</p>
        ) : lista.length === 0 ? (
          <div style={{ background: C.white, border: `1px dashed ${C.line}`, borderRadius: 14, padding: '40px 20px', textAlign: 'center' }}>
            <Receipt size={34} color={C.gold} style={{ opacity: 0.6 }} />
            <p style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, color: C.espresso, margin: '12px 0 4px' }}>
              Nenhum custo de SST neste período.
            </p>
            <p style={{ color: C.muted, fontSize: 13, margin: '0 0 16px' }}>
              Lance os custos de EPI, treinamentos, exames e acidentes para acompanhar o investimento em segurança.
            </p>
            <button onClick={() => setForm(formVazio())} style={btnPrimary}><Plus size={16} /> Lançar o primeiro</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {lista.map((e) => (
              <div key={e.id} style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ color: C.espresso, fontSize: 15 }}>{e.descricao}</strong>
                      <span style={chip(C.beigeLt, C.espresso)}>{tipoLabel(e.tipo)}</span>
                      {e.lancado && <span style={chip(C.greenBg, C.green)}>Lançado na GE</span>}
                    </div>
                    <div style={{ color: C.muted, fontSize: 12.5, marginTop: 6, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                      <span>Competência: {fmtComp(e.competencia)}</span>
                      {e.setor_nome && <span>Setor: {e.setor_nome}</span>}
                      <span>Origem: {origemLabel(e.origem_tipo)}</span>
                    </div>
                    {e.observacoes && <div style={{ color: C.muted, fontSize: 12.5, marginTop: 4 }}>{e.observacoes}</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    <strong style={{ color: C.espresso, fontSize: 16 }}>{fmtBRL(e.valor)}</strong>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => setForm({
                        id: e.id, tipo: e.tipo, descricao: e.descricao, valor: String(e.valor).replace('.', ','),
                        competencia: (e.competencia || '').slice(0, 7), setor_id: e.setor_id || '',
                        origem_tipo: e.origem_tipo, observacoes: e.observacoes || '',
                      })} title="Editar" style={{ ...btnIcon, opacity: e.lancado ? 0.4 : 1 }} disabled={e.lancado}><Pencil size={15} /></button>
                      <button onClick={() => void excluir(e)} title="Excluir" style={{ ...btnIcon, color: '#dc2626', opacity: e.lancado ? 0.4 : 1 }} disabled={e.lancado}><Trash2 size={15} /></button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Form (incluir/editar) */}
      {form && (
        <div style={overlay} onClick={() => setForm(null)}>
          <div style={modal} onClick={(ev) => ev.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: C.espresso, margin: 0 }}>{form.id ? 'Editar custo de SST' : 'Novo custo de SST'}</h2>
              <button onClick={() => setForm(null)} style={btnIcon}><X size={16} /></button>
            </div>

            <div style={grid2}>
              <label style={blk}>
                <span style={lbl}>Tipo de custo<AjudaCampo chave="ehs.sst_custos.tipo" rota={ROTA} /></span>
                <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} style={inp}>
                  {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
                </select>
              </label>
              <label style={blk}>
                <span style={lbl}>Competência (mês)<AjudaCampo chave="ehs.sst_custos.competencia" rota={ROTA} /></span>
                <input type="month" value={form.competencia} onChange={(e) => setForm({ ...form, competencia: e.target.value })} style={inp} />
              </label>
              <label style={{ ...blk, gridColumn: '1 / -1' }}>
                <span style={lbl}>Descrição<AjudaCampo chave="ehs.sst_custos.descricao" rota={ROTA} /></span>
                <input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} style={inp} placeholder="Ex.: Compra de protetores auriculares (produção)" />
              </label>
              <label style={blk}>
                <span style={lbl}>Valor (R$)<AjudaCampo chave="ehs.sst_custos.valor" rota={ROTA} /></span>
                <input inputMode="decimal" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} style={inp} placeholder="1.250,00" />
              </label>
              <label style={blk}>
                <span style={lbl}>Setor<AjudaCampo chave="ehs.sst_custos.setor" rota={ROTA} /></span>
                <select value={form.setor_id} onChange={(e) => setForm({ ...form, setor_id: e.target.value })} style={inp}>
                  <option value="">— Sem setor —</option>
                  {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
              </label>
              <label style={blk}>
                <span style={lbl}>Origem do custo<AjudaCampo chave="ehs.sst_custos.origem" rota={ROTA} /></span>
                <select value={form.origem_tipo} onChange={(e) => setForm({ ...form, origem_tipo: e.target.value })} style={inp}>
                  {ORIGENS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
              </label>
            </div>

            <div style={{ marginTop: 10 }}>
              <label style={blk}>
                <span style={lbl}>Observações<AjudaCampo chave="ehs.sst_custos.observacoes" rota={ROTA} /></span>
                <textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} style={{ ...inp, minHeight: 64, resize: 'vertical' }} />
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button onClick={() => setForm(null)} style={btnGhost}>Cancelar</button>
              <button onClick={() => void salvar()} disabled={salvando} style={{ ...btnPrimary, opacity: salvando ? 0.6 : 1 }}>
                {salvando ? 'Salvando…' : form.id ? 'Salvar alterações' : 'Lançar custo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// estilos
const blk: React.CSSProperties = { display: 'block' }
const lbl: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, fontWeight: 600, color: C.espresso, marginBottom: 5 }
const inp: React.CSSProperties = { width: '100%', border: `1px solid ${C.line}`, borderRadius: 8, padding: '9px 10px', fontSize: 14, background: C.white, color: C.ink, boxSizing: 'border-box' }
const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }
const btnPrimary: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: C.espresso, color: C.white, border: 'none', borderRadius: 9, padding: '9px 14px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }
const btnGhost: React.CSSProperties = { background: C.white, color: C.espresso, border: `1px solid ${C.line}`, borderRadius: 9, padding: '9px 14px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }
const btnIcon: React.CSSProperties = { background: C.white, border: `1px solid ${C.line}`, borderRadius: 8, padding: 8, cursor: 'pointer', color: C.espresso, display: 'inline-flex' }
const seg = (on: boolean): React.CSSProperties => ({ background: on ? C.espresso : 'transparent', color: on ? C.white : C.muted, border: 'none', borderRadius: 7, padding: '6px 10px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' })
const chip = (bg: string, fg: string): React.CSSProperties => ({ background: bg, color: fg, borderRadius: 6, padding: '2px 8px', fontSize: 11.5, fontWeight: 600 })
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(30,18,8,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', zIndex: 50, overflowY: 'auto' }
const modal: React.CSSProperties = { background: C.offwhite, borderRadius: 16, padding: 20, width: '100%', maxWidth: 680, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }
