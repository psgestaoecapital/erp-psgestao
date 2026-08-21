'use client'
// P&M · Catálogo de Serviços — a espinha dorsal que irriga proposta/produção/tempos/comissão.
// CRUD de serviços (recorrente/pontual/pacote) com tempo, preço, área/equipe e entregáveis. RPCs fn_agency_servico_*.
import { useEffect, useState, useCallback, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { PackageOpen, Plus, Pencil, Trash2, X, GripVertical } from 'lucide-react'

const ESPRESSO = '#3D2314', OFFWHITE = '#FAF7F2', DOURADO = '#C8941A', BORDA = '#E7DED3', TEXTM = '#6b5444', RED = '#7A1F1F'
const brl = (n: number | null | undefined) => n == null ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const TIPOS = [{ v: 'recorrente', l: 'Recorrente' }, { v: 'pontual', l: 'Pontual' }, { v: 'pacote', l: 'Pacote' }]
const MODELOS = [{ v: 'fixo', l: 'Valor fixo' }, { v: 'hora', l: 'Por hora' }, { v: 'pacote', l: 'Pacote' }, { v: 'fee_mensal', l: 'Fee mensal' }]
const tipoLabel = (t: string) => TIPOS.find(x => x.v === t)?.l ?? t

type Equipe = { id: string; nome: string }
type PacoteItem = { servico_item_id: string; quantidade: number; nome?: string }
type Servico = {
  id: string; nome: string; descricao: string | null; tipo: string; area: string | null; modelo_preco: string;
  valor_base: number | null; unidade: string | null; periodicidade: string | null; horas_estimadas: number | null;
  prazo_dias_padrao: number | null; entregaveis: string[]; especificacoes: string | null; responsavel_padrao_id: string | null;
  responsavel_nome?: string | null; ativo: boolean; ordem: number; usos: number; pacote_itens: PacoteItem[]
}

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.hint || error.details || error.message)
  return data as T
}

type Opcao = { id: string; valor: string; rotulo: string; ordem: number; ativo: boolean }

export default function ServicosPage() {
  const { sel, selInfo } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' ? sel : null
  const [servicos, setServicos] = useState<Servico[]>([])
  const [equipe, setEquipe] = useState<Equipe[]>([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<Partial<Servico> | null>(null)
  const [erro, setErro] = useState('')
  // campos de lista configuráveis (área/unidade/periodicidade) — fn_agency_config_listar
  const [opcoes, setOpcoes] = useState<Record<string, Opcao[]>>({})
  const [gerenciar, setGerenciar] = useState<string | null>(null)

  const carregarOpcoes = useCallback(async () => {
    if (!companyId) return
    const listas = ['area_equipe', 'unidade', 'periodicidade']
    const res = await Promise.all(listas.map((l) => supabase.rpc('fn_agency_config_listar', { p_company_id: companyId, p_lista: l })))
    const next: Record<string, Opcao[]> = {}
    listas.forEach((l, i) => { next[l] = ((res[i].data ?? []) as Opcao[]) })
    setOpcoes(next)
  }, [companyId])

  const carregar = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true)
    try {
      const [r, eq] = await Promise.all([
        rpc<{ servicos: Servico[] }>('fn_agency_servico_listar', { p_company_id: companyId, p_incluir_inativos: true }),
        supabase.from('agency_equipe').select('id,nome').eq('company_id', companyId).eq('ativo', true).order('nome'),
      ])
      setServicos(r.servicos || []); setEquipe((eq.data as Equipe[]) || [])
    } catch (e) { setErro((e as Error).message) } finally { setLoading(false) }
  }, [companyId])
  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => { void carregarOpcoes() }, [carregarOpcoes])

  const salvar = async () => {
    if (!edit || !companyId) return
    setErro('')
    try {
      const payload: Record<string, unknown> = {
        id: edit.id ?? null, nome: edit.nome ?? '', descricao: edit.descricao ?? '', tipo: edit.tipo ?? 'pontual',
        area: edit.area ?? '', modelo_preco: edit.modelo_preco ?? 'fixo', valor_base: edit.valor_base ?? null,
        unidade: edit.unidade ?? '', periodicidade: edit.periodicidade ?? '', horas_estimadas: edit.horas_estimadas ?? null,
        prazo_dias_padrao: edit.prazo_dias_padrao ?? null, entregaveis: (edit.entregaveis ?? []).filter(Boolean),
        especificacoes: edit.especificacoes ?? '', responsavel_padrao_id: edit.responsavel_padrao_id ?? null, ativo: edit.ativo ?? true,
      }
      if (edit.tipo === 'pacote') payload.pacote_itens = (edit.pacote_itens ?? []).filter(p => p.servico_item_id)
      await rpc('fn_agency_servico_salvar', { p_company_id: companyId, p_payload: payload })
      setEdit(null); void carregar()
    } catch (e) { setErro((e as Error).message) }
  }
  const excluir = async (s: Servico) => {
    if (!confirm(`Excluir "${s.nome}"?${s.usos > 0 ? ' (em uso — será desativado)' : ''}`)) return
    try { await rpc('fn_agency_servico_excluir', { p_company_id: companyId, p_id: s.id }); void carregar() } catch (e) { alert((e as Error).message) }
  }

  if (!companyId) return <Shell><Vazio t="Selecione uma empresa" l="O catálogo de serviços é por empresa. Escolha uma empresa específica no topo." /></Shell>

  return (
    <Shell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13, color: TEXTM }}>{servicos.length} serviço(s) no catálogo</div>
        <Btn onClick={() => setEdit({ tipo: 'pontual', modelo_preco: 'fixo', ativo: true, entregaveis: [], pacote_itens: [] })}><Plus size={15} /> Novo serviço</Btn>
      </div>
      {loading ? <Load /> : servicos.length === 0 ? (
        <Vazio t="Nenhum serviço cadastrado" l="Cadastre o primeiro serviço (ex.: Social Mensal, Vídeo institucional). O catálogo irriga proposta, produção e comissão — sem redigitar." />
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {servicos.map(s => (
            <div key={s.id} style={{ ...card, opacity: s.ativo ? 1 : 0.55 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: ESPRESSO }}>{s.nome}</span>
                  <span style={pill}>{tipoLabel(s.tipo)}</span>
                  {s.area && <span style={{ fontSize: 11.5, color: TEXTM }}>· {s.area}</span>}
                  {!s.ativo && <span style={{ fontSize: 11, color: RED, fontWeight: 700 }}>INATIVO</span>}
                </div>
                <div style={{ fontSize: 12.5, color: TEXTM, marginTop: 3 }}>
                  {brl(s.valor_base)}{s.unidade ? `/${s.unidade}` : ''}{s.periodicidade ? ` · ${s.periodicidade}` : ''}
                  {s.horas_estimadas ? ` · ${s.horas_estimadas}h` : ''}{s.responsavel_nome ? ` · ${s.responsavel_nome}` : ''}
                  {s.tipo === 'pacote' && s.pacote_itens?.length ? ` · ${s.pacote_itens.length} item(ns)` : ''}
                  {s.usos > 0 ? ` · usado ${s.usos}×` : ''}
                </div>
                {s.entregaveis?.length > 0 && <div style={{ fontSize: 11.5, color: TEXTM, marginTop: 2 }}>Entregáveis: {s.entregaveis.join(' · ')}</div>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <IconBtn title="Editar" onClick={() => setEdit({ ...s })}><Pencil size={15} /></IconBtn>
                <IconBtn title="Excluir" onClick={() => excluir(s)} danger><Trash2 size={15} /></IconBtn>
              </div>
            </div>
          ))}
        </div>
      )}

      {edit && <FormServico edit={edit} setEdit={setEdit} equipe={equipe} servicos={servicos} onSalvar={salvar} erro={erro} opcoes={opcoes} onGerenciar={setGerenciar} />}
      {gerenciar && companyId && (
        <ConfigOpcoesModal companyId={companyId} lista={gerenciar} servicos={servicos}
          onClose={() => setGerenciar(null)} onChange={() => void carregarOpcoes()} />
      )}
    </Shell>
  )
}

function FormServico({ edit, setEdit, equipe, servicos, onSalvar, erro, opcoes, onGerenciar }: {
  edit: Partial<Servico>; setEdit: (s: Partial<Servico> | null) => void; equipe: Equipe[]; servicos: Servico[]; onSalvar: () => void; erro: string
  opcoes: Record<string, Opcao[]>; onGerenciar: (lista: string) => void
}) {
  const [novoEntreg, setNovoEntreg] = useState('')
  const entregaveis = edit.entregaveis ?? []
  const pacoteItens = edit.pacote_itens ?? []
  const addEntreg = () => { if (!novoEntreg.trim()) return; setEdit({ ...edit, entregaveis: [...entregaveis, novoEntreg.trim()] }); setNovoEntreg('') }
  const rmEntreg = (i: number) => setEdit({ ...edit, entregaveis: entregaveis.filter((_, x) => x !== i) })
  const addPacoteItem = () => setEdit({ ...edit, pacote_itens: [...pacoteItens, { servico_item_id: '', quantidade: 1 }] })
  const setPacoteItem = (i: number, patch: Partial<PacoteItem>) => setEdit({ ...edit, pacote_itens: pacoteItens.map((p, x) => x === i ? { ...p, ...patch } : p) })
  const rmPacoteItem = (i: number) => setEdit({ ...edit, pacote_itens: pacoteItens.filter((_, x) => x !== i) })

  return (
    <Modal titulo={edit.id ? 'Editar serviço' : 'Novo serviço'} onClose={() => setEdit(null)}>
      <Campo label="Nome *"><input style={inp} value={edit.nome ?? ''} onChange={e => setEdit({ ...edit, nome: e.target.value })} placeholder="Ex.: Social Mensal" /></Campo>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Campo label="Tipo"><select style={inp} value={edit.tipo ?? 'pontual'} onChange={e => setEdit({ ...edit, tipo: e.target.value })}>{TIPOS.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}</select></Campo>
        <Campo label="Área / equipe"><SelectConfig lista="area_equipe" opcoes={opcoes} value={edit.area ?? ''} onChange={v => setEdit({ ...edit, area: v || null })} onGerenciar={onGerenciar} /></Campo>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Campo label="Modelo de preço"><select style={inp} value={edit.modelo_preco ?? 'fixo'} onChange={e => setEdit({ ...edit, modelo_preco: e.target.value })}>{MODELOS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}</select></Campo>
        <Campo label="Valor base (R$)"><input type="number" style={inp} value={edit.valor_base ?? ''} onChange={e => setEdit({ ...edit, valor_base: e.target.value === '' ? null : Number(e.target.value) })} /></Campo>
        <Campo label="Unidade"><SelectConfig lista="unidade" opcoes={opcoes} value={edit.unidade ?? ''} onChange={v => setEdit({ ...edit, unidade: v || null })} onGerenciar={onGerenciar} /></Campo>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {edit.tipo === 'recorrente' && <Campo label="Periodicidade"><SelectConfig lista="periodicidade" opcoes={opcoes} value={edit.periodicidade ?? ''} onChange={v => setEdit({ ...edit, periodicidade: v || null })} onGerenciar={onGerenciar} /></Campo>}
        <Campo label="Horas estimadas"><input type="number" style={inp} value={edit.horas_estimadas ?? ''} onChange={e => setEdit({ ...edit, horas_estimadas: e.target.value === '' ? null : Number(e.target.value) })} /></Campo>
        <Campo label="Prazo padrão (dias)"><input type="number" style={inp} value={edit.prazo_dias_padrao ?? ''} onChange={e => setEdit({ ...edit, prazo_dias_padrao: e.target.value === '' ? null : Number(e.target.value) })} /></Campo>
      </div>
      <Campo label="Responsável / equipe padrão">
        <select style={inp} value={edit.responsavel_padrao_id ?? ''} onChange={e => setEdit({ ...edit, responsavel_padrao_id: e.target.value || null })}>
          <option value="">—</option>{equipe.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
        </select>
      </Campo>

      <Campo label="Entregáveis">
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input style={{ ...inp, flex: 1 }} value={novoEntreg} onChange={e => setNovoEntreg(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEntreg() } }} placeholder="Ex.: 12 posts feed/mês" />
          <button onClick={addEntreg} style={{ ...btnSec }}>Adicionar</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {entregaveis.map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: ESPRESSO }}>
              <GripVertical size={13} style={{ color: TEXTM }} /> <span style={{ flex: 1 }}>{e}</span>
              <button onClick={() => rmEntreg(i)} style={{ border: 'none', background: 'transparent', color: RED, cursor: 'pointer' }}><X size={14} /></button>
            </div>
          ))}
        </div>
      </Campo>

      <Campo label="Especificações (formato, dimensões, requisitos)"><textarea style={{ ...inp, minHeight: 54 }} value={edit.especificacoes ?? ''} onChange={e => setEdit({ ...edit, especificacoes: e.target.value })} /></Campo>

      {edit.tipo === 'pacote' && (
        <Campo label="Itens do pacote">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pacoteItens.map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select style={{ ...inp, flex: 1 }} value={p.servico_item_id} onChange={e => setPacoteItem(i, { servico_item_id: e.target.value })}>
                  <option value="">Selecione um serviço…</option>
                  {servicos.filter(s => s.id !== edit.id && s.tipo !== 'pacote').map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
                <input type="number" min={1} style={{ ...inp, width: 70 }} value={p.quantidade} onChange={e => setPacoteItem(i, { quantidade: Number(e.target.value) || 1 })} />
                <button onClick={() => rmPacoteItem(i)} style={{ border: 'none', background: 'transparent', color: RED, cursor: 'pointer' }}><X size={15} /></button>
              </div>
            ))}
            <button onClick={addPacoteItem} style={{ ...btnSec, alignSelf: 'flex-start' }}>+ Adicionar item</button>
          </div>
        </Campo>
      )}

      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, color: ESPRESSO, cursor: 'pointer', marginTop: 4 }}>
        <input type="checkbox" checked={edit.ativo ?? true} onChange={e => setEdit({ ...edit, ativo: e.target.checked })} /> Ativo (aparece na proposta)
      </label>
      {erro && <div style={{ background: '#F4D6D6', color: RED, borderRadius: 8, padding: '8px 10px', fontSize: 12.5, marginTop: 10 }}>{erro}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button onClick={() => setEdit(null)} style={btnSec}>Cancelar</button>
        <Btn onClick={onSalvar}>Salvar</Btn>
      </div>
    </Modal>
  )
}

// select de uma lista configurável + botão ⚙️ pra gerenciar as opções
function SelectConfig({ lista, opcoes, value, onChange, onGerenciar }: {
  lista: string; opcoes: Record<string, Opcao[]>; value: string; onChange: (v: string) => void; onGerenciar: (lista: string) => void
}) {
  const lst = opcoes[lista] ?? []
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <select style={{ ...inp, flex: 1 }} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">—</option>
        {value && !lst.some(o => o.valor === value) && <option value={value}>{value}</option>}
        {lst.map(o => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
      <button type="button" onClick={() => onGerenciar(lista)} title="Gerenciar opções" style={{ ...btnSec, padding: '0 10px' }}>⚙️</button>
    </div>
  )
}

const LISTA_ROTULO: Record<string, string> = { area_equipe: 'Área / equipe', unidade: 'Unidade', periodicidade: 'Periodicidade' }
const CAMPO_DE_LISTA: Record<string, keyof Servico> = { area_equipe: 'area', unidade: 'unidade', periodicidade: 'periodicidade' }
// mini-CRUD das opções de uma lista (add / renomear / ativar / excluir), reusável por lista
function ConfigOpcoesModal({ companyId, lista, servicos, onClose, onChange }: {
  companyId: string; lista: string; servicos: Servico[]; onClose: () => void; onChange: () => void
}) {
  const [rows, setRows] = useState<Opcao[]>([])
  const [novo, setNovo] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const recarregar = useCallback(async () => {
    const { data } = await supabase.from('agency_config_opcao').select('id, valor, rotulo, ordem, ativo').eq('company_id', companyId).eq('lista', lista).order('ordem')
    setRows((data ?? []) as Opcao[])
  }, [companyId, lista])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void recarregar() }, [recarregar])
  const usoDe = (valor: string) => { const campo = CAMPO_DE_LISTA[lista]; return campo ? servicos.filter(s => s[campo] === valor).length : 0 }
  async function salvar(o: Opcao) {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('fn_agency_config_salvar', { p_campos: { id: o.id, rotulo: o.rotulo, ordem: o.ordem, ativo: o.ativo } })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setMsg(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    await recarregar(); onChange()
  }
  async function adicionar() {
    if (!novo.trim()) { setMsg('Informe o nome da opção.'); return }
    setBusy(true); setMsg(null)
    const maxOrdem = rows.reduce((m, r) => Math.max(m, r.ordem), 0)
    const { data, error } = await supabase.rpc('fn_agency_config_salvar', { p_campos: { company_id: companyId, lista, rotulo: novo.trim(), ordem: maxOrdem + 10 } })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setMsg(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setNovo(''); await recarregar(); onChange()
  }
  async function excluir(o: Opcao) {
    const n = usoDe(o.valor)
    if (n > 0) { setMsg(`${n} serviço(s) usam "${o.rotulo}". Desative em vez de excluir.`); return }
    if (!confirm(`Excluir "${o.rotulo}"?`)) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_agency_config_excluir', { p_id: o.id })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string; qtd?: number } | null
    if (error || !j?.ok) { setMsg(j?.erro === 'opcao_em_uso' ? `${j.qtd} serviço(s) usam esta opção. Desative.` : `Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    await recarregar(); onChange()
  }
  function patch(id: string, p: Partial<Opcao>) { setRows(arr => arr.map(r => r.id === id ? { ...r, ...p } : r)) }
  return (
    <Modal titulo={`Opções · ${LISTA_ROTULO[lista] ?? lista}`} onClose={onClose}>
      {msg && <div style={{ background: '#FCEBEB', color: RED, padding: '7px 10px', borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{msg}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {rows.map(o => {
          const n = usoDe(o.valor)
          return (
            <div key={o.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, alignItems: 'center' }}>
              <input value={o.rotulo} onChange={e => patch(o.id, { rotulo: e.target.value })} onBlur={() => void salvar(o)} style={inp} />
              <span style={{ fontSize: 11, color: TEXTM, minWidth: 54, textAlign: 'right' }}>{n} uso{n === 1 ? '' : 's'}</span>
              <button disabled={busy} onClick={() => void salvar({ ...o, ativo: !o.ativo })} style={{ ...btnSec, color: o.ativo ? '#166534' : TEXTM }}>{o.ativo ? 'Ativa' : 'Inativa'}</button>
              <button disabled={busy} onClick={() => void excluir(o)} title={n > 0 ? `${n} em uso` : 'Excluir'} style={{ ...btnSec, borderColor: RED, color: RED, opacity: n > 0 ? 0.5 : 1 }}>✕</button>
            </div>
          )
        })}
        {rows.length === 0 && <div style={{ fontSize: 12.5, color: TEXTM }}>Sem opções — adicione a primeira.</div>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={novo} onChange={e => setNovo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void adicionar() }} placeholder="Nova opção (ex.: carrossel)" style={{ ...inp, flex: 1 }} />
        <button disabled={busy} onClick={() => void adicionar()} style={{ ...btnSec, background: DOURADO, color: '#fff', borderColor: DOURADO }}>+ Add</button>
      </div>
    </Modal>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px clamp(14px,4vw,36px)' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{ width: 42, height: 42, borderRadius: 12, background: '#F3E6C9', color: DOURADO, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><PackageOpen size={22} /></span>
          <div>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 23, fontWeight: 400, color: ESPRESSO, margin: 0 }}>Catálogo de Serviços</h1>
            <div style={{ fontSize: 12, color: TEXTM }}>Recorrentes · pontuais · pacotes — irriga proposta, produção e comissão</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
function Vazio({ t, l }: { t: string; l: string }) { return <div style={{ background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 14, padding: '34px 20px', textAlign: 'center' }}><div style={{ fontSize: 15, fontWeight: 600, color: ESPRESSO }}>{t}</div><div style={{ fontSize: 13, color: TEXTM, marginTop: 5, maxWidth: 460, marginInline: 'auto' }}>{l}</div></div> }
function Load() { return <div style={{ color: TEXTM, padding: 30, textAlign: 'center', fontSize: 13 }}>Carregando…</div> }
function Campo({ label, children }: { label: string; children: React.ReactNode }) { return <div style={{ marginBottom: 10, flex: 1, minWidth: 130 }}><label style={{ display: 'block', fontSize: 12, color: TEXTM, marginBottom: 4 }}>{label}</label>{children}</div> }
function Btn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) { return <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: DOURADO, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{children}</button> }
function IconBtn({ children, onClick, title, danger }: { children: React.ReactNode; onClick?: () => void; title?: string; danger?: boolean }) { return <button title={title} onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, border: `1px solid ${BORDA}`, background: '#fff', color: danger ? RED : ESPRESSO, borderRadius: 8, cursor: 'pointer' }}>{children}</button> }
function Modal({ titulo, children, onClose }: { titulo: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', zIndex: 50, overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 20, width: '100%', maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: ESPRESSO }}>{titulo}</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: TEXTM }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
const card: CSSProperties = { display: 'flex', gap: 12, alignItems: 'center', background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px' }
const pill: CSSProperties = { fontSize: 11, fontWeight: 800, color: DOURADO, background: '#F3E6C9', borderRadius: 6, padding: '2px 7px' }
const inp: CSSProperties = { width: '100%', border: `1px solid ${BORDA}`, borderRadius: 8, padding: '8px 10px', fontSize: 13.5, color: '#1a1a1a', background: '#fff', boxSizing: 'border-box' }
const btnSec: CSSProperties = { border: `1px solid ${BORDA}`, background: '#fff', color: ESPRESSO, borderRadius: 8, padding: '8px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }
