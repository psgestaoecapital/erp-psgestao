// src/app/dashboard/ehs/maquinas/page.tsx
// PS EHS · M1 Estrutura e cadastros — Máquinas e Equipamentos
// Inventário NR-12 (máquinas), NR-13 (caldeiras e vasos de pressão) e equipamentos de
// medição com certificado de calibração. CRUD por empresa (RLS), controle de inspeções.
// Code: code-desenvolvedor-3
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { Factory, Plus, Pencil, Trash2, AlertTriangle, RefreshCw, X } from 'lucide-react'

const ROTA = '/dashboard/ehs/maquinas'

const C = {
  espresso: '#3D2314', offwhite: '#FAF7F2', gold: '#C8941A', white: '#FFFFFF',
  beigeLt: '#f5f0e8', line: '#ece3d2', ink: '#1a1a1a', muted: 'rgba(61,35,20,0.55)',
  green: '#16a34a', greenBg: '#eaf6ee', amber: '#b45309', amberBg: '#fdf3e3',
  red: '#dc2626', redBg: '#fce8e8',
}

type Maquina = {
  id: string; tipo: string; nome: string; identificacao: string | null
  fabricante: string | null; modelo: string | null; nr_aplicavel: string | null
  setor_id: string | null; setor_nome: string | null; periodicidade_meses: number | null
  data_ultima_inspecao: string | null; data_proxima_inspecao: string | null; situacao: string
  certificado_calibracao: string | null; data_validade_calibracao: string | null; observacoes: string | null
  inspecao_vencida: boolean; inspecao_a_vencer: boolean; calibracao_vencida: boolean
}

const TIPOS: { v: string; label: string }[] = [
  { v: 'maquina', label: 'Máquinas (NR-12)' },
  { v: 'caldeira', label: 'Caldeiras (NR-13)' },
  { v: 'vaso_pressao', label: 'Vasos de pressão (NR-13)' },
  { v: 'equip_medicao', label: 'Equip. de medição' },
]
const tipoLabel = (v: string) => TIPOS.find((t) => t.v === v)?.label ?? v
const SITUACOES = [
  { v: 'operando', label: 'Operando' }, { v: 'parada', label: 'Parada' },
  { v: 'manutencao', label: 'Em manutenção' }, { v: 'interditada', label: 'Interditada' },
]
const situacaoLabel = (v: string) => SITUACOES.find((s) => s.v === v)?.label ?? v
const fmtData = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—')

type Form = {
  id: string | null; tipo: string; nome: string; identificacao: string; fabricante: string
  modelo: string; nr_aplicavel: string; periodicidade_meses: string; data_ultima_inspecao: string
  data_proxima_inspecao: string; situacao: string; certificado_calibracao: string
  data_validade_calibracao: string; observacoes: string
}
const formVazio = (tipo = 'maquina'): Form => ({
  id: null, tipo, nome: '', identificacao: '', fabricante: '', modelo: '',
  nr_aplicavel: tipo === 'caldeira' || tipo === 'vaso_pressao' ? 'NR-13' : tipo === 'maquina' ? 'NR-12' : '',
  periodicidade_meses: '', data_ultima_inspecao: '', data_proxima_inspecao: '', situacao: 'operando',
  certificado_calibracao: '', data_validade_calibracao: '', observacoes: '',
})

export default function MaquinasPage() {
  const { companyIds, companies, sel } = useCompanyIds()
  const [companyAlvo, setCompanyAlvo] = useState<string>('')
  const multiEmpresa = (companyIds?.length ?? 0) > 1

  useEffect(() => {
    if (companyAlvo) return
    if (sel && sel !== 'consolidado' && !sel.startsWith('group_')) setCompanyAlvo(sel)
    else if (companyIds && companyIds.length > 0) setCompanyAlvo(companyIds[0])
  }, [sel, companyIds, companyAlvo])

  const empresaNome = useMemo(() => {
    const c = companies.find((x: any) => x.id === companyAlvo)
    return c?.nome_fantasia || c?.razao_social || 'Empresa'
  }, [companies, companyAlvo])

  const [itens, setItens] = useState<Maquina[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [filtroTipo, setFiltroTipo] = useState<string>('todos')
  const [form, setForm] = useState<Form | null>(null)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    if (!companyAlvo) return
    setCarregando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_ehs_maquina_listar', { p_company_id: companyAlvo })
    if (error) { setErro('Não foi possível carregar os equipamentos agora. Tente de novo.'); setItens([]) }
    else setItens((data as Maquina[]) || [])
    setCarregando(false)
  }, [companyAlvo])

  useEffect(() => { void carregar() }, [carregar])

  const lista = useMemo(
    () => (filtroTipo === 'todos' ? itens : itens.filter((m) => m.tipo === filtroTipo)),
    [itens, filtroTipo],
  )
  const alertas = useMemo(
    () => itens.filter((m) => m.inspecao_vencida || m.calibracao_vencida).length,
    [itens],
  )

  async function salvar() {
    if (!form || !companyAlvo) return
    if (!form.nome.trim()) { setErro('Informe o nome do equipamento.'); return }
    setSalvando(true); setErro(null)
    const { error } = await supabase.rpc('fn_ehs_maquina_salvar', {
      p_company_id: companyAlvo, p_id: form.id, p_tipo: form.tipo, p_nome: form.nome,
      p_identificacao: form.identificacao || null, p_fabricante: form.fabricante || null,
      p_modelo: form.modelo || null, p_nr_aplicavel: form.nr_aplicavel || null,
      p_periodicidade_meses: form.periodicidade_meses ? Number(form.periodicidade_meses) : null,
      p_data_ultima_inspecao: form.data_ultima_inspecao || null,
      p_data_proxima_inspecao: form.data_proxima_inspecao || null,
      p_situacao: form.situacao,
      p_certificado_calibracao: form.certificado_calibracao || null,
      p_data_validade_calibracao: form.data_validade_calibracao || null,
      p_observacoes: form.observacoes || null,
    })
    setSalvando(false)
    if (error) { setErro('Não foi possível salvar. Confira os campos e tente de novo.'); return }
    setForm(null); void carregar()
  }

  async function inativar(m: Maquina) {
    if (!companyAlvo) return
    if (!confirm(`Excluir "${m.nome}" do inventário? O histórico é preservado.`)) return
    const { error } = await supabase.rpc('fn_ehs_maquina_inativar', { p_company_id: companyAlvo, p_id: m.id })
    if (error) { setErro('Não foi possível excluir agora. Tente de novo.'); return }
    void carregar()
  }

  const isMedicao = form?.tipo === 'equip_medicao'

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '20px 16px 64px', background: C.offwhite, minHeight: '100vh' }}>
      {/* Cabeçalho */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>🏭 EHS · M1 Estrutura</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0', display: 'inline-flex', alignItems: 'center', gap: 8, color: C.espresso }}>
            <Factory size={22} color={C.gold} /> Máquinas e Equipamentos
          </h1>
          <p style={{ color: C.muted, fontSize: 13, marginTop: 6, maxWidth: 640 }}>
            Inventário de máquinas (NR-12), caldeiras e vasos de pressão (NR-13) e equipamentos de medição com certificado de calibração. Controle de inspeções e vencimentos.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => void carregar()} title="Atualizar" style={btnIcon}><RefreshCw size={16} /></button>
          <button onClick={() => setForm(formVazio(filtroTipo === 'todos' ? 'maquina' : filtroTipo))} style={btnPrimary}>
            <Plus size={16} /> Novo equipamento
          </button>
        </div>
      </div>

      {/* Seletor de empresa (grupo) */}
      {multiEmpresa && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 14 }}>
          <span style={lbl}>Empresa<AjudaCampo chave="ehs.maquinas.empresa_alvo" rota={ROTA} /></span>
          <select value={companyAlvo} onChange={(e) => setCompanyAlvo(e.target.value)} style={inp}>
            {companyIds?.map((id) => {
              const c = companies.find((x: any) => x.id === id)
              return <option key={id} value={id}>{c?.nome_fantasia || c?.razao_social || id}</option>
            })}
          </select>
        </label>
      )}

      {/* Alerta de vencimentos */}
      {alertas > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.redBg, border: `1px solid ${C.red}33`, color: C.red, borderRadius: 10, padding: '10px 12px', marginTop: 14, fontSize: 13 }}>
          <AlertTriangle size={16} /> {alertas} equipamento(s) com inspeção ou calibração vencida.
        </div>
      )}

      {/* Filtro por tipo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', gap: 4, background: C.white, border: `1px solid ${C.line}`, borderRadius: 10, padding: 4, flexWrap: 'wrap' }}>
          <button onClick={() => setFiltroTipo('todos')} style={seg(filtroTipo === 'todos')}>Todos</button>
          {TIPOS.map((t) => (
            <button key={t.v} onClick={() => setFiltroTipo(t.v)} style={seg(filtroTipo === t.v)}>{t.label}</button>
          ))}
        </div>
        <AjudaCampo chave="ehs.maquinas.filtro_tipo" rota={ROTA} />
      </div>

      {erro && <div style={{ background: C.redBg, color: C.red, borderRadius: 10, padding: '10px 12px', marginTop: 14, fontSize: 13 }}>{erro}</div>}

      {/* Lista */}
      <div style={{ marginTop: 16 }}>
        {carregando ? (
          <p style={{ color: C.muted, fontSize: 14, padding: 24, textAlign: 'center' }}>Carregando…</p>
        ) : lista.length === 0 ? (
          <div style={{ background: C.white, border: `1px dashed ${C.line}`, borderRadius: 14, padding: '40px 20px', textAlign: 'center' }}>
            <Factory size={34} color={C.gold} style={{ opacity: 0.6 }} />
            <p style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, color: C.espresso, margin: '12px 0 4px' }}>
              Nenhum equipamento cadastrado{filtroTipo !== 'todos' ? ' neste grupo' : ''}.
            </p>
            <p style={{ color: C.muted, fontSize: 13, margin: '0 0 16px' }}>
              Cadastre suas máquinas, caldeiras, vasos de pressão e instrumentos de medição para controlar inspeções e calibrações.
            </p>
            <button onClick={() => setForm(formVazio(filtroTipo === 'todos' ? 'maquina' : filtroTipo))} style={btnPrimary}>
              <Plus size={16} /> Cadastrar o primeiro
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {lista.map((m) => (
              <div key={m.id} style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ color: C.espresso, fontSize: 15 }}>{m.nome}</strong>
                      <span style={chip(C.beigeLt, C.espresso)}>{tipoLabel(m.tipo)}</span>
                      {m.nr_aplicavel && <span style={chip(C.beigeLt, C.muted)}>{m.nr_aplicavel}</span>}
                      <span style={chip(m.situacao === 'operando' ? C.greenBg : C.amberBg, m.situacao === 'operando' ? C.green : C.amber)}>{situacaoLabel(m.situacao)}</span>
                    </div>
                    <div style={{ color: C.muted, fontSize: 12.5, marginTop: 6, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                      {m.identificacao && <span>TAG: {m.identificacao}</span>}
                      {m.setor_nome && <span>Setor: {m.setor_nome}</span>}
                      {(m.fabricante || m.modelo) && <span>{[m.fabricante, m.modelo].filter(Boolean).join(' · ')}</span>}
                    </div>
                    <div style={{ fontSize: 12.5, marginTop: 6, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                      {m.tipo !== 'equip_medicao' && (
                        <span style={{ color: m.inspecao_vencida ? C.red : m.inspecao_a_vencer ? C.amber : C.muted }}>
                          Próx. inspeção: {fmtData(m.data_proxima_inspecao)}{m.inspecao_vencida ? ' (vencida)' : m.inspecao_a_vencer ? ' (a vencer)' : ''}
                        </span>
                      )}
                      {m.tipo === 'equip_medicao' && (
                        <span style={{ color: m.calibracao_vencida ? C.red : C.muted }}>
                          Calibração: {m.certificado_calibracao || '—'} · validade {fmtData(m.data_validade_calibracao)}{m.calibracao_vencida ? ' (vencida)' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <button onClick={() => setForm({
                      id: m.id, tipo: m.tipo, nome: m.nome, identificacao: m.identificacao || '',
                      fabricante: m.fabricante || '', modelo: m.modelo || '', nr_aplicavel: m.nr_aplicavel || '',
                      periodicidade_meses: m.periodicidade_meses?.toString() || '',
                      data_ultima_inspecao: m.data_ultima_inspecao || '', data_proxima_inspecao: m.data_proxima_inspecao || '',
                      situacao: m.situacao, certificado_calibracao: m.certificado_calibracao || '',
                      data_validade_calibracao: m.data_validade_calibracao || '', observacoes: m.observacoes || '',
                    })} title="Editar" style={btnIcon}><Pencil size={15} /></button>
                    <button onClick={() => void inativar(m)} title="Excluir" style={{ ...btnIcon, color: C.red }}><Trash2 size={15} /></button>
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
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: C.espresso, margin: 0 }}>{form.id ? 'Editar equipamento' : 'Novo equipamento'}</h2>
              <button onClick={() => setForm(null)} style={btnIcon}><X size={16} /></button>
            </div>

            <div style={grid2}>
              <label style={blk}>
                <span style={lbl}>Tipo<AjudaCampo chave="ehs.maquinas.filtro_tipo" rota={ROTA} /></span>
                <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} style={inp}>
                  {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
                </select>
              </label>
              <label style={blk}>
                <span style={lbl}>Nome do equipamento<AjudaCampo chave="ehs.maquinas.nome" rota={ROTA} /></span>
                <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} style={inp} placeholder="Ex.: Prensa hidráulica 120t" />
              </label>
              <label style={blk}>
                <span style={lbl}>Identificação (TAG / patrimônio)<AjudaCampo chave="ehs.maquinas.identificacao" rota={ROTA} /></span>
                <input value={form.identificacao} onChange={(e) => setForm({ ...form, identificacao: e.target.value })} style={inp} placeholder="TAG-CLD-01" />
              </label>
              <label style={blk}>
                <span style={lbl}>Situação<AjudaCampo chave="ehs.maquinas.situacao" rota={ROTA} /></span>
                <select value={form.situacao} onChange={(e) => setForm({ ...form, situacao: e.target.value })} style={inp}>
                  {SITUACOES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
                </select>
              </label>
              <label style={blk}>
                <span style={lbl}>Fabricante<AjudaCampo chave="ehs.maquinas.fabricante" rota={ROTA} /></span>
                <input value={form.fabricante} onChange={(e) => setForm({ ...form, fabricante: e.target.value })} style={inp} />
              </label>
              <label style={blk}>
                <span style={lbl}>Modelo<AjudaCampo chave="ehs.maquinas.modelo" rota={ROTA} /></span>
                <input value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value })} style={inp} />
              </label>
              <label style={blk}>
                <span style={lbl}>NR aplicável<AjudaCampo chave="ehs.maquinas.nr_aplicavel" rota={ROTA} /></span>
                <input value={form.nr_aplicavel} onChange={(e) => setForm({ ...form, nr_aplicavel: e.target.value })} style={inp} placeholder="NR-12 / NR-13 / NR-15" />
              </label>

              {!isMedicao && (
                <>
                  <label style={blk}>
                    <span style={lbl}>Periodicidade da inspeção (meses)<AjudaCampo chave="ehs.maquinas.periodicidade" rota={ROTA} /></span>
                    <input type="number" min={1} value={form.periodicidade_meses} onChange={(e) => setForm({ ...form, periodicidade_meses: e.target.value })} style={inp} placeholder="12" />
                  </label>
                  <label style={blk}>
                    <span style={lbl}>Última inspeção<AjudaCampo chave="ehs.maquinas.data_ultima_inspecao" rota={ROTA} /></span>
                    <input type="date" value={form.data_ultima_inspecao} onChange={(e) => setForm({ ...form, data_ultima_inspecao: e.target.value })} style={inp} />
                  </label>
                  <label style={blk}>
                    <span style={lbl}>Próxima inspeção<AjudaCampo chave="ehs.maquinas.data_proxima_inspecao" rota={ROTA} /></span>
                    <input type="date" value={form.data_proxima_inspecao} onChange={(e) => setForm({ ...form, data_proxima_inspecao: e.target.value })} style={inp} />
                  </label>
                </>
              )}
              {isMedicao && (
                <>
                  <label style={blk}>
                    <span style={lbl}>Certificado de calibração<AjudaCampo chave="ehs.maquinas.certificado_calibracao" rota={ROTA} /></span>
                    <input value={form.certificado_calibracao} onChange={(e) => setForm({ ...form, certificado_calibracao: e.target.value })} style={inp} placeholder="Cert. 2026/0456" />
                  </label>
                  <label style={blk}>
                    <span style={lbl}>Validade da calibração<AjudaCampo chave="ehs.maquinas.data_validade_calibracao" rota={ROTA} /></span>
                    <input type="date" value={form.data_validade_calibracao} onChange={(e) => setForm({ ...form, data_validade_calibracao: e.target.value })} style={inp} />
                  </label>
                </>
              )}
            </div>

            <div style={{ marginTop: 10 }}>
              <label style={blk}>
                <span style={lbl}>Observações<AjudaCampo chave="ehs.maquinas.observacoes" rota={ROTA} /></span>
                <textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} style={{ ...inp, minHeight: 64, resize: 'vertical' }} />
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button onClick={() => setForm(null)} style={btnGhost}>Cancelar</button>
              <button onClick={() => void salvar()} disabled={salvando} style={{ ...btnPrimary, opacity: salvando ? 0.6 : 1 }}>
                {salvando ? 'Salvando…' : form.id ? 'Salvar alterações' : 'Cadastrar'}
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
