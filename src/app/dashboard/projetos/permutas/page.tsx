'use client'

// Hub · Gestão de Permutas (F1, CEO 12/11). Lista as permutas da(s) empresa(s) selecionada(s): valor atualizado
// (contrato + reajuste do índice) × quitado × saldo, com situação e barra. Multi-CNPJ: o seletor de empresa do topo
// (consolidado/grupo/empresa) define o escopo — fn_permuta_listar já soma o grupo e tira a permuta intragrupo.
// Cadastro pelo modal. Extrato e movimentos na página do item (/[id]). RD-95 "?" em tudo; RD-98 CRUD + rastreável.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const ROTA = '/dashboard/projetos/permutas'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
const GREEN = '#166534', RED = '#B42318', REDBG = '#FCEBEB', AMBER = '#BA7517'

type Permuta = {
  id: string; company_id: string; empresa_nome: string | null; contratante: string; ativo_descr: string
  tipo_contrato: string; obra_id: string | null; obra_nome: string | null
  valor_permuta: number; valor_dinheiro: number; indice_reajuste: string | null; data_base: string | null
  intragrupo: boolean; valor_atualizado: number; quitado: number; saldo: number; pct_quitado: number; status: string
}
type Cartoes = { a_receber: number; quitado: number; saldo: number; abertas: number }

const brl = (n: number) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const SITU: Record<string, { rot: string; cor: string; bg: string }> = {
  a_iniciar: { rot: 'A iniciar', cor: MUT, bg: '#F0ECE3' },
  saldo_devedor: { rot: 'Saldo devedor', cor: AMBER, bg: '#FAEEDA' },
  quitado: { rot: 'Quitado', cor: GREEN, bg: '#ECFDF5' },
  pagou_a_mais: { rot: 'Pagou a mais', cor: RED, bg: REDBG },
}
const TIPO_CONTRATO: Record<string, string> = { '100_dinheiro': '100% dinheiro', '100_permuta': '100% permuta', misto: 'Misto' }

export default function PermutasPage() {
  const { companyIds, selInfo, loading: carregandoEmpresa } = useCompanyIds()
  const [permutas, setPermutas] = useState<Permuta[]>([])
  const [cartoes, setCartoes] = useState<Cartoes>({ a_receber: 0, quitado: 0, saldo: 0, abertas: 0 })
  const [consolidado, setConsolidado] = useState(false)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [modal, setModal] = useState<null | Partial<Permuta>>(null)

  const carregar = useCallback(async () => {
    if (!companyIds || companyIds.length === 0) { setPermutas([]); setLoading(false); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_permuta_listar', { p_company_ids: companyIds })
    if (error) { setErro(erroAmigavel(error)); setLoading(false); return }
    const r = data as { ok: boolean; permutas: Permuta[]; cartoes: Cartoes; consolidado: boolean }
    if (!r?.ok) { setErro('Não foi possível carregar as permutas.'); setLoading(false); return }
    setPermutas(r.permutas || []); setCartoes(r.cartoes); setConsolidado(!!r.consolidado); setLoading(false)
  }, [companyIds])

  useEffect(() => { void carregar() }, [carregar])

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return permutas
    return permutas.filter(p => `${p.contratante} ${p.ativo_descr} ${p.empresa_nome ?? ''}`.toLowerCase().includes(q))
  }, [permutas, busca])

  async function excluir(p: Permuta) {
    if (!confirm(`Excluir a permuta de "${p.contratante}"? O registro fica arquivado (rastreável), não é apagado.`)) return
    const { data, error } = await supabase.rpc('fn_permuta_excluir', { p_id: p.id })
    if (error || !(data as any)?.ok) { alert(erroAmigavel(error)); return }
    void carregar()
  }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px clamp(14px, 4vw, 40px)', color: ESP }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gap: 14 }}>
        <header>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: GOLD, margin: 0 }}>Hub · Financeiro</p>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, margin: '4px 0 0' }}>Permutas</h1>
            <button onClick={() => setModal({})} data-testid="permuta-nova"
              style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 9, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>+ Nova permuta</button>
          </div>
          <p style={{ fontSize: 12.5, color: MUT, margin: '6px 0 0', lineHeight: 1.5 }}>
            O imóvel permutado por obra, serviço, material ou dinheiro: quanto vale, quanto já foi quitado e quanto falta.
            {consolidado ? ' Mostrando o grupo consolidado (permuta intragrupo não entra nos totais).' : selInfo?.nome ? ` Empresa: ${selInfo.nome}.` : ''}
          </p>
        </header>

        {/* cartões */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <Card rot="A receber em permuta" valor={brl(cartoes.a_receber)} chave="permuta.lista.a_receber" />
          <Card rot="Quitado" valor={brl(cartoes.quitado)} chave="permuta.lista.quitado" cor={GREEN} />
          <Card rot="Saldo" valor={brl(cartoes.saldo)} chave="permuta.lista.saldo" cor={cartoes.saldo < 0 ? RED : ESP} />
          <Card rot="Abertas" valor={String(cartoes.abertas)} chave="permuta.lista.abertas" />
        </div>

        {/* busca */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ flex: '1 1 240px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: MUT }}>
            <AjudaCampo chave="permuta.lista.busca" rota={ROTA} />
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar contratante, imóvel ou empresa…"
              style={{ flex: 1, padding: '8px 11px', fontSize: 13, border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', color: ESP, outline: 'none' }} />
          </label>
          <span style={{ fontSize: 12, color: MUT }}>Empresa (CNPJ) <AjudaCampo chave="permuta.lista.empresa" rota={ROTA} /></span>
        </div>

        {/* estados */}
        {carregandoEmpresa || loading ? (
          <Aviso texto="Carregando…" />
        ) : erro ? (
          <Aviso texto={erro} erro onRetry={carregar} />
        ) : filtradas.length === 0 ? (
          <Aviso texto={busca ? 'Nenhuma permuta encontrada para a busca.' : 'Nenhuma permuta cadastrada ainda nesta empresa.'}
            cta={!busca ? { rot: '+ Cadastrar a primeira permuta', onClick: () => setModal({}) } : undefined} />
        ) : (
          <div style={{ display: 'grid', gap: 9 }}>
            {filtradas.map(p => {
              const s = SITU[p.status] ?? SITU.a_iniciar
              return (
                <div key={p.id} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'start' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{p.contratante}</div>
                      <div style={{ fontSize: 12.5, color: MUT }}>{p.ativo_descr} · {TIPO_CONTRATO[p.tipo_contrato] ?? p.tipo_contrato}{p.obra_nome ? ` · ${p.obra_nome}` : ''}{consolidado && p.empresa_nome ? ` · ${p.empresa_nome}` : ''}</div>
                    </div>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: s.cor, background: s.bg, borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' }}>{s.rot}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, margin: '10px 0 6px' }}>
                    <Mini rot="Valor atualizado" v={brl(p.valor_atualizado)} />
                    <Mini rot="Quitado" v={brl(p.quitado)} cor={GREEN} />
                    <Mini rot="Saldo" v={brl(p.saldo)} cor={p.saldo < -0.005 ? RED : ESP} />
                  </div>
                  <div style={{ height: 7, background: '#F0ECE3', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(Math.max(p.pct_quitado, 0), 100)}%`, height: '100%', background: p.saldo < -0.005 ? RED : GOLD }} />
                  </div>
                  <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 13 }}>
                    <Link href={`${ROTA}/${p.id}`} data-testid={`permuta-abrir-${p.id}`} style={{ color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Abrir extrato →</Link>
                    <button onClick={() => setModal(p)} style={linkBtn}>Editar</button>
                    <button onClick={() => excluir(p)} style={{ ...linkBtn, color: RED }} data-testid={`permuta-excluir-${p.id}`}>Excluir</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {modal && <ModalPermuta inicial={modal} companyIds={companyIds} onClose={() => setModal(null)} onSalvo={() => { setModal(null); void carregar() }} />}
    </div>
  )
}

function Card({ rot, valor, chave, cor = ESP }: { rot: string; valor: string; chave: string; cor?: string }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 11.5, color: MUT }}>{rot} <AjudaCampo chave={chave} rota={ROTA} /></div>
      <div style={{ fontSize: 20, fontWeight: 700, color: cor, marginTop: 3 }}>{valor}</div>
    </div>
  )
}
function Mini({ rot, v, cor = ESP }: { rot: string; v: string; cor?: string }) {
  return <div><div style={{ fontSize: 11, color: MUT }}>{rot}</div><div style={{ fontSize: 14.5, fontWeight: 700, color: cor }}>{v}</div></div>
}
function Aviso({ texto, erro, cta, onRetry }: { texto: string; erro?: boolean; cta?: { rot: string; onClick: () => void }; onRetry?: () => void }) {
  return (
    <div style={{ background: erro ? REDBG : '#fff', border: `1px solid ${erro ? '#F3C7C2' : LINE}`, borderRadius: 12, padding: '28px 18px', textAlign: 'center', color: erro ? RED : MUT }}>
      <div style={{ fontSize: 13.5 }}>{texto}</div>
      {cta && <button onClick={cta.onClick} style={{ marginTop: 12, background: GOLD, color: '#fff', border: 'none', borderRadius: 9, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{cta.rot}</button>}
      {erro && onRetry && <button onClick={onRetry} style={{ marginTop: 12, marginLeft: 8, background: 'transparent', color: RED, border: `1px solid #F3C7C2`, borderRadius: 9, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Tentar de novo</button>}
    </div>
  )
}
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: MUT, fontWeight: 600, cursor: 'pointer', fontSize: 13, padding: 0 }

// ───────────────────────── modal cadastro ─────────────────────────
const lab: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: ESP, marginBottom: 4 }
const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', color: ESP, outline: 'none', boxSizing: 'border-box' }

function ModalPermuta({ inicial, companyIds, onClose, onSalvo }: { inicial: Partial<Permuta>; companyIds: string[]; onClose: () => void; onSalvo: () => void }) {
  const editando = !!inicial.id
  const [f, setF] = useState({
    contratante: inicial.contratante ?? '', ativo_descr: inicial.ativo_descr ?? '',
    tipo_contrato: inicial.tipo_contrato ?? 'misto', pct_permuta: inicial.pct_permuta?.toString() ?? '',
    valor_permuta: inicial.valor_permuta?.toString() ?? '', valor_dinheiro: inicial.valor_dinheiro?.toString() ?? '',
    indice_reajuste: inicial.indice_reajuste ?? '', data_base: inicial.data_base ?? '',
    intragrupo: inicial.intragrupo ?? false, observacao: '',
  })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }))

  async function salvar() {
    if (f.contratante.trim().length < 2 || f.ativo_descr.trim().length < 2) { setErro('Informe o contratante e o imóvel/ativo da permuta.'); return }
    setSalvando(true); setErro(null)
    const company_id = inicial.company_id ?? companyIds[0]
    const { data, error } = await supabase.rpc('fn_permuta_salvar', { p_dados: { ...f, id: inicial.id ?? null, company_id } })
    if (error || !(data as any)?.ok) { setErro(erroAmigavel(error)); setSalvando(false); return }
    onSalvo()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14, zIndex: 50 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: BG, borderRadius: 16, padding: '20px 20px 22px', width: 'min(560px, 100%)', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: 0 }}>{editando ? 'Editar permuta' : 'Nova permuta'}</h2>
          <button onClick={onClose} aria-label="Fechar" style={{ background: 'none', border: 'none', fontSize: 20, color: MUT, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'grid', gap: 11 }}>
          <label style={lab}>Contratante <AjudaCampo chave="permuta.form.contratante" rota={ROTA} />
            <input style={inp} value={f.contratante} onChange={e => set('contratante', e.target.value)} placeholder="Quem entrega o imóvel/terreno" data-testid="permuta-f-contratante" />
          </label>
          <label style={lab}>Imóvel / ativo permutado <AjudaCampo chave="permuta.form.ativo" rota={ROTA} />
            <input style={inp} value={f.ativo_descr} onChange={e => set('ativo_descr', e.target.value)} placeholder="Ex.: Apartamento 1201 — Torre A" />
          </label>
          <label style={lab}>Tipo de contrato <AjudaCampo chave="permuta.form.tipo_contrato" rota={ROTA} />
            <select style={inp} value={f.tipo_contrato} onChange={e => set('tipo_contrato', e.target.value)}>
              <option value="misto">Misto (dinheiro + permuta)</option>
              <option value="100_permuta">100% permuta</option>
              <option value="100_dinheiro">100% dinheiro</option>
            </select>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={lab}>Valor em permuta (R$) <AjudaCampo chave="permuta.form.valor_permuta" rota={ROTA} /><input style={inp} type="number" min="0" step="0.01" value={f.valor_permuta} onChange={e => set('valor_permuta', e.target.value)} /></label>
            <label style={lab}>Valor em dinheiro (R$) <AjudaCampo chave="permuta.form.valor_dinheiro" rota={ROTA} /><input style={inp} type="number" min="0" step="0.01" value={f.valor_dinheiro} onChange={e => set('valor_dinheiro', e.target.value)} /></label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={lab}>Índice de reajuste <AjudaCampo chave="permuta.form.indice_reajuste" rota={ROTA} /><input style={inp} value={f.indice_reajuste} onChange={e => set('indice_reajuste', e.target.value)} placeholder="Ex.: CUB-SC (opcional)" /></label>
            <label style={lab}>Mês-base do valor <AjudaCampo chave="permuta.form.data_base" rota={ROTA} /><input style={inp} type="date" value={f.data_base ?? ''} onChange={e => set('data_base', e.target.value)} /></label>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: ESP, cursor: 'pointer' }}>
            <input type="checkbox" checked={f.intragrupo} onChange={e => set('intragrupo', e.target.checked)} />
            Permuta entre empresas do próprio grupo (não entra no total consolidado) <AjudaCampo chave="permuta.form.intragrupo" rota={ROTA} />
          </label>
          {erro && <div style={{ fontSize: 12.5, color: RED, background: REDBG, borderRadius: 8, padding: '8px 10px' }}>{erro}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button onClick={onClose} style={{ ...linkBtn, padding: '9px 14px' }}>Cancelar</button>
            <button onClick={salvar} disabled={salvando} data-testid="permuta-salvar" style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 9, padding: '9px 18px', fontSize: 13.5, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer', opacity: salvando ? 0.7 : 1 }}>{salvando ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
