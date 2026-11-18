// src/app/dashboard/ehs/epi/estoque/page.tsx
// Estoque EPI: lista + entrada + edicao minimo de alerta.

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { ModalEntregarEPI } from '../_components/ModalEntregarEPI'

// RD-95: toda ajuda desta subtela aponta para a própria rota.
const ROTA = '/dashboard/ehs/epi/estoque'

const C = {
  espresso: '#3D2314',
  espressoLt: '#5D4534',
  offwhite: '#FAF7F2',
  gold: '#C8941A',
  beigeLt: '#f5f0e8',
  borderLt: '#ece3d2',
  ink: '#1a1a1a',
  muted: 'rgba(61, 35, 20, 0.55)',
  green: '#16a34a',
  yellow: '#eab308',
  red: '#dc2626',
}

interface EstoqueRow {
  id: string
  company_id: string
  catalogo_id: string
  catalogo_nome?: string
  ca_numero?: string
  catalogo_lote?: string | null
  localizacao: string | null
  qtd_disponivel: number
  qtd_reservada: number
  qtd_minima_alerta: number
  ativo: boolean
  created_at: string
}

interface CatalogoOption {
  id: string
  nome: string
  ca_numero: string
  is_global?: boolean
}

interface FuncionarioEntrega {
  id: string
  nome_completo: string
  cpf: string | null
  cargo: string | null
  setor: string | null
}

export default function EstoqueEpiPage() {
  const { companyIds, companies } = useCompanyIds()
  const companyIdsKey = useMemo(() => [...(companyIds ?? [])].sort().join(','), [companyIds])
  const [companyAlvo, setCompanyAlvo] = useState<string>('')
  useEffect(() => {
    if (!companyAlvo && companyIds && companyIds.length > 0) setCompanyAlvo(companyIds[0])
  }, [companyIds, companyAlvo])
  const empresaPorId = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of companies) m.set(c.id, c.nome_fantasia || c.razao_social || 'Empresa')
    return m
  }, [companies])
  const multiEmpresa = (companyIds?.length ?? 0) > 1

  const [estoque, setEstoque] = useState<EstoqueRow[]>([])
  const [catalogo, setCatalogo] = useState<CatalogoOption[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [mostrarInativos, setMostrarInativos] = useState(false)
  const [acaoId, setAcaoId] = useState<string | null>(null)
  const [showEntrada, setShowEntrada] = useState(false)
  const [editandoMinimo, setEditandoMinimo] = useState<EstoqueRow | null>(null)
  // RD-98 p2 — baixa rastreavel do item de estoque (perda/dano/descarte/acerto) via fn_epi_estoque_baixar.
  const [baixando, setBaixando] = useState<EstoqueRow | null>(null)
  // #3865 — Requisição/baixa de EPI: entrega ao funcionário dá baixa no estoque (fn_epi_registrar_entrega).
  const [funcionarios, setFuncionarios] = useState<FuncionarioEntrega[]>([])
  const [funcEntregaId, setFuncEntregaId] = useState('')
  const [showEntrega, setShowEntrega] = useState(false)
  const funcEntregaSel = useMemo(() => funcionarios.find((f) => f.id === funcEntregaId) || null, [funcionarios, funcEntregaId])

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const ids = companyIdsKey ? companyIdsKey.split(',').filter(Boolean) : []
      if (ids.length === 0) { setEstoque([]); setCatalogo([]); setLoading(false); return }
      // Buscar EPIs disponiveis: globais (PS) + proprios da(s) empresa(s) selecionada(s).
      // Duas queries separadas para evitar quirks do operador .or() do PostgREST.
      const [estR, ownR, globalR] = await Promise.all([
        supabase
          .from('epi_estoque')
          .select('id, company_id, catalogo_id, localizacao, qtd_disponivel, qtd_reservada, qtd_minima_alerta, ativo, created_at, epi_catalogo(nome, ca_numero, lote)')
          .in('company_id', ids)
          .eq('ativo', true) // itens inativados por baixa total (fn_epi_estoque_baixar) saem da lista
          .order('created_at', { ascending: false }),
        supabase
          .from('epi_catalogo')
          .select('id, nome, ca_numero, is_global')
          .eq('is_global', false)
          .in('company_id', ids)
          .eq('ativo', true)
          .order('nome'),
        supabase
          .from('epi_catalogo')
          .select('id, nome, ca_numero, is_global')
          .eq('is_global', true)
          .eq('ativo', true)
          .order('nome'),
      ])
      if (estR.error) throw estR.error
      if (ownR.error) throw ownR.error
      if (globalR.error) throw globalR.error
      setEstoque(((estR.data || []) as any[]).map((r) => ({
        ...r,
        ativo: r.ativo ?? true,
        catalogo_nome: (r.epi_catalogo as any)?.nome,
        ca_numero: (r.epi_catalogo as any)?.ca_numero,
        catalogo_lote: (r.epi_catalogo as any)?.lote,
      })) as EstoqueRow[])
      // Proprios da empresa primeiro (mais relevantes), globais depois.
      setCatalogo([...(ownR.data || []), ...(globalR.data || [])] as CatalogoOption[])
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar estoque')
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey])

  useEffect(() => { carregar() }, [carregar])

  // Funcionários ativos da empresa-alvo, para a entrega/baixa de EPI (#3865).
  useEffect(() => {
    let cancelado = false
    setFuncEntregaId('')
    if (!companyAlvo) { setFuncionarios([]); return }
    ;(async () => {
      const { data, error } = await supabase
        .from('v_epi_funcionarios_consolidado')
        .select('funcionario_id, nome_completo, cpf, cargo, setor')
        .eq('company_id', companyAlvo)
        .order('nome_completo')
      if (cancelado) return
      if (error || !data) { setFuncionarios([]); return }
      setFuncionarios((data as any[]).map((r) => ({
        id: r.funcionario_id,
        nome_completo: r.nome_completo,
        cpf: r.cpf ?? null,
        cargo: r.cargo ?? null,
        setor: r.setor ?? null,
      })))
    })()
    return () => { cancelado = true }
  }, [companyAlvo])

  const estoqueFiltrado = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return estoque.filter((e) => {
      if (!mostrarInativos && !e.ativo) return false
      if (!q) return true
      return `${e.catalogo_nome || ''} ${e.ca_numero || ''} ${e.localizacao || ''}`.toLowerCase().includes(q)
    })
  }, [estoque, busca, mostrarInativos])

  // RD-98 p2: inativação/reativação rastreável do item de estoque (soft-delete via coluna `ativo`),
  // no mesmo padrão de gravação direta da tela (RLS epi_estoque escopa por company_id). O saldo e o
  // histórico ficam guardados; nada é apagado.
  async function alternarAtivo(row: EstoqueRow) {
    setAcaoId(row.id)
    setErro(null)
    try {
      const { error } = await supabase.from('epi_estoque').update({ ativo: !row.ativo }).eq('id', row.id)
      if (error) throw error
      await carregar()
    } catch {
      setErro(row.ativo ? 'Não foi possível inativar o item. Tente de novo.' : 'Não foi possível reativar o item. Tente de novo.')
    } finally {
      setAcaoId(null)
    }
  }

  function statusEstoque(row: EstoqueRow): { cor: string; label: string } {
    const min = row.qtd_minima_alerta || 0
    if (row.qtd_disponivel <= min * 0.5) return { cor: C.red, label: 'crítico' }
    if (row.qtd_disponivel <= min) return { cor: C.yellow, label: 'alerta' }
    return { cor: C.green, label: 'normal' }
  }

  return (
    <div style={{ background: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>EPI</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>Estoque</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted }}>Saldo por localização + alertas mínimos</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href="/dashboard/ehs/epi" style={btnSec}>← EPI</Link>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <button onClick={() => setShowEntrada(true)} disabled={!companyAlvo} style={{ ...btnPrim, opacity: companyAlvo ? 1 : 0.5, cursor: companyAlvo ? 'pointer' : 'not-allowed' }}>+ Entrada de Estoque</button>
              <AjudaCampo chave="compliance.epi.estoque.nav_entrada" rota={ROTA} />
            </span>
          </div>
        </header>

        {erro && <div style={{ background: '#fce8e8', color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{erro}</div>}

        {multiEmpresa && (
          <section style={{ background: '#FFFFFF', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(61,35,20,0.06)' }}>
            <label style={{ display: 'block' }}>
              <span style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}>Empresa-alvo (para entradas) <AjudaCampo chave="compliance.epi.estoque.empresa_alvo" rota={ROTA} /></span>
              <select value={companyAlvo} onChange={(e) => setCompanyAlvo(e.target.value)} style={{ ...inputStyle, minWidth: 240 }}>
                {(companyIds || []).map((id) => <option key={id} value={id}>{empresaPorId.get(id) || id}</option>)}
              </select>
            </label>
          </section>
        )}

        <section style={{ background: '#FFFFFF', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61,35,20,0.06)', marginBottom: 16 }}>
          <label style={{ display: 'block' }}>
            <span style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}>Buscar no estoque <AjudaCampo chave="compliance.epi.estoque.busca" rota={ROTA} /></span>
            <input type="text" placeholder="Buscar por EPI / CA / localização…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 13, color: C.espressoLt, cursor: 'pointer' }}>
            <input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} />
            Mostrar inativos
            <AjudaCampo chave="compliance.epi.estoque.mostrar_inativos" rota={ROTA} />
          </label>
        </section>

        <section style={{ background: '#FFFFFF', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61,35,20,0.06)', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ flex: '1 1 280px' }}>
              <span style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}>Entregar EPI a um funcionário (dar baixa) <AjudaCampo chave="compliance.epi.estoque.entrega_funcionario" rota={ROTA} /></span>
              <select
                value={funcEntregaId}
                onChange={(e) => setFuncEntregaId(e.target.value)}
                disabled={!companyAlvo || funcionarios.length === 0}
                style={{ ...inputStyle, width: '100%', opacity: (!companyAlvo || funcionarios.length === 0) ? 0.6 : 1 }}
              >
                <option value="">{funcionarios.length === 0 ? 'Nenhum funcionário ativo nesta empresa' : 'Selecione o funcionário…'}</option>
                {funcionarios.map((f) => (
                  <option key={f.id} value={f.id}>{f.nome_completo}{f.cpf ? ` · ${f.cpf}` : ''}{f.setor ? ` — ${f.setor}` : ''}</option>
                ))}
              </select>
            </label>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <button
                onClick={() => setShowEntrega(true)}
                disabled={!funcEntregaId}
                style={{ ...btnPrim, opacity: funcEntregaId ? 1 : 0.5, cursor: funcEntregaId ? 'pointer' : 'not-allowed' }}
              >Entregar EPI</button>
              <AjudaCampo chave="compliance.epi.estoque.nav_entrega_func" rota={ROTA} />
            </span>
          </div>
          <p style={{ fontSize: 11, color: C.muted, margin: '8px 0 0', lineHeight: 1.5 }}>
            A entrega dá baixa automática no estoque (sai do disponível), registra o movimento com data, operador e motivo, e coleta a assinatura do funcionário (NR-6). O EPI e a quantidade são escolhidos na próxima etapa.
          </p>
        </section>

        <section style={{ background: '#FFFFFF', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61,35,20,0.06)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.beigeLt }}>
                  <Th>EPI <AjudaCampo chave="compliance.epi.estoque.col_epi" rota={ROTA} /></Th>
                  <Th>CA <AjudaCampo chave="compliance.epi.estoque.col_ca" rota={ROTA} /></Th>
                  <Th>Localização <AjudaCampo chave="compliance.epi.estoque.col_localizacao" rota={ROTA} /></Th>
                  {multiEmpresa && <Th>Empresa <AjudaCampo chave="compliance.epi.estoque.col_empresa" rota={ROTA} /></Th>}
                  <Th align="right">Disp. <AjudaCampo chave="compliance.epi.estoque.col_disponivel" rota={ROTA} /></Th>
                  <Th align="right">Reservada <AjudaCampo chave="compliance.epi.estoque.col_reservada" rota={ROTA} /></Th>
                  <Th align="right">Mín. <AjudaCampo chave="compliance.epi.estoque.col_minima" rota={ROTA} /></Th>
                  <Th align="center">Status <AjudaCampo chave="compliance.epi.estoque.col_status" rota={ROTA} /></Th>
                  <Th align="right">Ações <AjudaCampo chave="compliance.epi.estoque.col_acoes" rota={ROTA} /></Th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>}
                {!loading && estoqueFiltrado.length === 0 && <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Nenhum estoque cadastrado</td></tr>}
                {estoqueFiltrado.map((e, i) => {
                  const st = statusEstoque(e)
                  return (
                    <tr key={e.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.borderLt}`, opacity: e.ativo ? 1 : 0.6 }}>
                      <Td><strong>{e.catalogo_nome || '—'}</strong>{!e.ativo && <span style={{ marginLeft: 6, display: 'inline-block', padding: '1px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: 'rgba(61,35,20,0.08)', color: C.muted }}>inativo</span>}{e.catalogo_lote ? <div style={{ fontSize: 11, color: C.muted }}>Lote: {e.catalogo_lote}</div> : null}</Td>
                      <Td mono>{e.ca_numero || '—'}</Td>
                      <Td>{e.localizacao || '—'}</Td>
                      {multiEmpresa && <Td>{empresaPorId.get(e.company_id) || '—'}</Td>}
                      <Td align="right" style={{ fontWeight: 700, fontSize: 14 }}>{e.qtd_disponivel}</Td>
                      <Td align="right">{e.qtd_reservada}</Td>
                      <Td align="right">{e.qtd_minima_alerta}</Td>
                      <Td align="center">
                        <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: st.cor + '22', color: st.cor }}>{st.label}</span>
                      </Td>
                      <Td align="right">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                          <button onClick={() => setEditandoMinimo(e)} style={{ ...btnSec, padding: '4px 10px', fontSize: 11 }}>Editar mínimo</button>
                          <button
                            onClick={() => setBaixando(e)}
                            disabled={e.qtd_disponivel <= 0}
                            style={{ ...btnSec, padding: '4px 10px', fontSize: 11, color: C.red, borderColor: C.red + '55', opacity: e.qtd_disponivel <= 0 ? 0.4 : 1, cursor: e.qtd_disponivel <= 0 ? 'not-allowed' : 'pointer' }}
                          >Baixar</button>
                          <AjudaCampo chave="compliance.epi.estoque.acao_baixar" rota={ROTA} />
                          <button
                            onClick={() => void alternarAtivo(e)}
                            disabled={acaoId === e.id}
                            style={{ ...btnSec, padding: '4px 10px', fontSize: 11, color: e.ativo ? C.red : C.green, borderColor: e.ativo ? '#f0d4d4' : '#d0e8d6', cursor: acaoId === e.id ? 'default' : 'pointer' }}
                          >{acaoId === e.id ? '…' : (e.ativo ? 'Inativar' : 'Reativar')}</button>
                          <AjudaCampo chave="compliance.epi.estoque.inativar" rota={ROTA} />
                        </span>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {showEntrada && companyAlvo && (
        <ModalEntradaEstoque companyId={companyAlvo} catalogo={catalogo} onClose={() => setShowEntrada(false)} onSaved={() => { setShowEntrada(false); carregar() }} />
      )}
      {editandoMinimo && (
        <ModalEditarMinimo row={editandoMinimo} onClose={() => setEditandoMinimo(null)} onSaved={() => { setEditandoMinimo(null); carregar() }} />
      )}
      {baixando && (
        <ModalBaixarEstoque row={baixando} onClose={() => setBaixando(null)} onSaved={() => { setBaixando(null); carregar() }} />
      )}
      {showEntrega && companyAlvo && funcEntregaSel && (
        <ModalEntregarEPI
          isOpen={true}
          companyId={companyAlvo}
          funcionario={funcEntregaSel}
          onClose={() => setShowEntrega(false)}
          onSuccess={() => { setShowEntrega(false); setFuncEntregaId(''); carregar() }}
        />
      )}
    </div>
  )
}

function ModalEntradaEstoque({
  companyId, catalogo, onClose, onSaved,
}: {
  companyId: string
  catalogo: CatalogoOption[]
  onClose: () => void
  onSaved: () => void
}) {
  const [catalogoId, setCatalogoId] = useState('')
  const [quantidade, setQuantidade] = useState(1)
  const [localizacao, setLocalizacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    if (!catalogoId) { setErro('Selecione um EPI'); return }
    if (quantidade <= 0) { setErro('Quantidade deve ser > 0'); return }
    if (!localizacao.trim()) { setErro('Localização obrigatória'); return }
    setSalvando(true)
    setErro(null)
    try {
      // Tenta UPDATE de linha existente (UNIQUE company_id+catalogo_id+localizacao)
      const { data: existente } = await supabase
        .from('epi_estoque')
        .select('id, qtd_disponivel')
        .eq('company_id', companyId)
        .eq('catalogo_id', catalogoId)
        .eq('localizacao', localizacao.trim())
        .maybeSingle()

      if (existente) {
        const novaQtd = (Number(existente.qtd_disponivel) || 0) + quantidade
        const { error } = await supabase
          .from('epi_estoque')
          .update({ qtd_disponivel: novaQtd })
          .eq('id', existente.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('epi_estoque')
          .insert({
            company_id: companyId,
            catalogo_id: catalogoId,
            localizacao: localizacao.trim(),
            qtd_disponivel: quantidade,
            qtd_reservada: 0,
            qtd_minima_alerta: 5,
          })
        if (error) throw error
      }
      onSaved()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao salvar')
      setSalvando(false)
    }
  }

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.2, color: C.gold, margin: 0, textTransform: 'uppercase' }}>EPI · Estoque</p>
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, margin: '4px 0 16px' }}>Entrada de Estoque</h2>
        {erro && <div style={{ background: '#fce8e8', color: C.red, padding: '10px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{erro}</div>}

        <Field label="EPI *">
          <select value={catalogoId} onChange={(e) => setCatalogoId(e.target.value)} style={inputStyle}>
            <option value="">Selecione…</option>
            {catalogo.filter((c) => !c.is_global).length > 0 && (
              <optgroup label="🏢 Da empresa">
                {catalogo.filter((c) => !c.is_global).map((c) => (
                  <option key={c.id} value={c.id}>{c.nome} (CA {c.ca_numero})</option>
                ))}
              </optgroup>
            )}
            {catalogo.filter((c) => c.is_global).length > 0 && (
              <optgroup label="🌐 Catálogo Global PS">
                {catalogo.filter((c) => c.is_global).map((c) => (
                  <option key={c.id} value={c.id}>{c.nome} (CA {c.ca_numero})</option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
          <Field label="Quantidade *"><input type="number" min={1} value={quantidade} onChange={(e) => setQuantidade(parseInt(e.target.value) || 1)} style={inputStyle} /></Field>
          <Field label="Localização *"><input value={localizacao} onChange={(e) => setLocalizacao(e.target.value)} placeholder="Ex: Almoxarifado Sede" style={inputStyle} /></Field>
        </div>
        <p style={{ fontSize: 11, color: C.muted, margin: '8px 0 0', lineHeight: 1.5 }}>
          O lote do EPI é registrado por movimento (na entrega ao funcionário), seguindo NR-6. Para o estoque controlamos saldo agregado por EPI + localização.
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} disabled={salvando} style={btnSec}>Cancelar</button>
          <button onClick={salvar} disabled={salvando} style={btnPrim}>{salvando ? 'Salvando…' : 'Adicionar ao estoque'}</button>
        </div>
      </div>
    </div>
  )
}

function ModalEditarMinimo({ row, onClose, onSaved }: { row: EstoqueRow; onClose: () => void; onSaved: () => void }) {
  const [valor, setValor] = useState(row.qtd_minima_alerta)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    setSalvando(true)
    setErro(null)
    try {
      const { error } = await supabase.from('epi_estoque').update({ qtd_minima_alerta: valor }).eq('id', row.id)
      if (error) throw error
      onSaved()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao salvar')
      setSalvando(false)
    }
  }

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalStyle, width: 'min(380px, 92vw)' }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, margin: '0 0 12px' }}>Editar mínimo de alerta</h3>
        <p style={{ fontSize: 12, color: C.muted, margin: '0 0 12px' }}>{row.catalogo_nome} · {row.localizacao}</p>
        {erro && <div style={{ background: '#fce8e8', color: C.red, padding: '8px 10px', borderRadius: 8, marginBottom: 10, fontSize: 12 }}>{erro}</div>}
        <Field label="Quantidade mínima de alerta">
          <input type="number" min={0} value={valor} onChange={(e) => setValor(parseInt(e.target.value) || 0)} style={inputStyle} autoFocus />
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onClose} disabled={salvando} style={btnSec}>Cancelar</button>
          <button onClick={salvar} disabled={salvando} style={btnPrim}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  )
}

// RD-98 p2 — baixa rastreavel: perda/dano/descarte/acerto. Chama fn_epi_estoque_baixar (SECURITY DEFINER,
// guarda por empresa, grava em audit_log_global quem/quando/por que; zera -> inativa a linha).
function ModalBaixarEstoque({ row, onClose, onSaved }: { row: EstoqueRow; onClose: () => void; onSaved: () => void }) {
  const [quantidade, setQuantidade] = useState(1)
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    if (quantidade < 1 || quantidade > row.qtd_disponivel) { setErro(`Quantidade deve ser entre 1 e ${row.qtd_disponivel}`); return }
    if (!motivo.trim()) { setErro('Informe o motivo da baixa'); return }
    setSalvando(true)
    setErro(null)
    try {
      const { data, error } = await supabase.rpc('fn_epi_estoque_baixar', {
        p_estoque_id: row.id, p_quantidade: quantidade, p_motivo: motivo.trim(),
      })
      if (error) throw error
      const r = data as { ok?: boolean; erro?: string } | null
      if (!r?.ok) throw new Error(r?.erro || 'Falha ao dar baixa')
      onSaved()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao dar baixa')
      setSalvando(false)
    }
  }

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalStyle, width: 'min(420px, 92vw)' }}>
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.2, color: C.gold, margin: 0, textTransform: 'uppercase' }}>EPI · Estoque</p>
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: '4px 0 6px' }}>Baixar do estoque</h2>
        <p style={{ fontSize: 12, color: C.muted, margin: '0 0 14px' }}>{row.catalogo_nome || '—'}{row.localizacao ? ` · ${row.localizacao}` : ''} · disponível {row.qtd_disponivel}</p>
        {erro && <div style={{ background: '#fce8e8', color: C.red, padding: '10px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{erro}</div>}

        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}>Quantidade a baixar <AjudaCampo chave="compliance.epi.estoque.baixa_quantidade" rota={ROTA} /></span>
          <input type="number" min={1} max={row.qtd_disponivel} value={quantidade}
            onChange={(e) => setQuantidade(parseInt(e.target.value) || 1)} style={inputStyle} autoFocus />
        </label>
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}>Motivo da baixa <AjudaCampo chave="compliance.epi.estoque.baixa_motivo" rota={ROTA} /></span>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex: descarte por validade, dano, acerto de inventário" style={inputStyle} />
        </label>
        <p style={{ fontSize: 11, color: C.muted, margin: '2px 0 0', lineHeight: 1.5 }}>
          A baixa fica registrada com quem fez, quando e o motivo. Se o item zerar (0 disponível e 0 reservado), ele é inativado e sai da lista.
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} disabled={salvando} style={btnSec}>Cancelar</button>
          <button onClick={salvar} disabled={salvando} style={{ ...btnPrim, background: C.red }}>{salvando ? 'Baixando…' : 'Confirmar baixa'}</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: any }) {
  return <div style={{ marginBottom: 10 }}><label style={labelStyle}>{label}</label>{children}</div>
}

function Th({ children, align }: { children: any; align?: 'left' | 'center' | 'right' }) {
  return <th style={{ padding: '10px 16px', textAlign: align || 'left', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(61, 35, 20, 0.65)' }}>{children}</th>
}

function Td({ children, mono, align, style }: { children: any; mono?: boolean; align?: 'left' | 'center' | 'right'; style?: React.CSSProperties }) {
  return <td style={{ padding: '10px 16px', verticalAlign: 'top', textAlign: align || 'left', fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined, ...(style || {}) }}>{children}</td>
}

const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.55)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }
const modalStyle: React.CSSProperties = { background: '#FFFFFF', borderRadius: 12, width: 'min(520px, 92vw)', maxHeight: '92vh', overflowY: 'auto', padding: 24 }
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }
const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', background: '#FAF7F2', border: '1px solid #ece3d2', borderRadius: 8, fontSize: 13, color: '#1a1a1a', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }
const btnSec: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, border: '1px solid #ece3d2', background: '#FFFFFF', color: '#3D2314', fontSize: 13, fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }
const btnPrim: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, border: 'none', background: '#3D2314', color: '#FFFFFF', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
