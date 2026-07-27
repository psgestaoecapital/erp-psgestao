'use client'

// Plano de Indicadores · Editor (F1). Árvore tipo plano de contas, por empresa, editável e estratificada.
// Duas permissões via RBAC existente (fn_ind_tem_permissao): indicadores_ver (read) e indicadores_editar
// (update). Ninguém vê por padrão — o gestor master concede login a login. A semeadura lê o template
// global (area_indicadores_mestres) via fn_ind_semear_catalogo. Realizado fica para a F3 (aqui só
// catálogo + metas). RD-30: desativar é soft-delete; RD-51: nada é inventado, tudo vem do banco.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const MUT = 'rgba(61,35,20,0.55)'
const VERDE = '#2E8B57'
const VERM = '#A32D2D'

type Indicador = {
  id: string; company_id: string; codigo: string; pai_codigo: string | null; nivel: number
  is_totalizador: boolean; nome: string; sigla: string | null; ambito: string | null
  o_que_mede: string | null; unidade_medida: string | null; direcao_boa: string | null
  fonte_calculo: string | null; regra_agregacao: string | null; meta_padrao: number | null
  sugerido_global: boolean; ordem: number; ativo: boolean; editavel: boolean
}
type Meta = {
  id: string; indicador_id: string; recorte_tipo: string; recorte_ref: string | null
  periodo_ano: number; periodo_mes: number | null; meta_valor: number; ativo: boolean
}

const REGRAS: Record<string, string> = {
  soma: 'Soma', media: 'Média', media_ponderada: 'Média ponderada', taxa_recalculada: 'Taxa recalculada',
}
const DIRECOES: Record<string, string> = { maior: '↑ maior é melhor', menor: '↓ menor é melhor', neutro: '– neutro' }

function corRegra(r: string | null): string {
  if (r === 'soma') return '#2E6B8B'
  if (r === 'media') return '#7A5A9E'
  if (r === 'media_ponderada') return '#B06A1A'
  if (r === 'taxa_recalculada') return VERDE
  return MUT
}

export default function IndicadoresEditorPage() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null

  const [podeVer, setPodeVer] = useState<boolean | null>(null)
  const [podeEditar, setPodeEditar] = useState(false)
  const [itens, setItens] = useState<Indicador[]>([])
  const [metas, setMetas] = useState<Meta[]>([])
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<string>('')
  const [abertos, setAbertos] = useState<Record<string, boolean>>({})
  const [editId, setEditId] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<Partial<Indicador>>({})
  const [metaFor, setMetaFor] = useState<string | null>(null)
  const [novoMeta, setNovoMeta] = useState<{ ano: string; mes: string; valor: string }>({ ano: String(new Date().getFullYear()), mes: '', valor: '' })
  const [novoSob, setNovoSob] = useState<string | null>(null)
  const [novo, setNovo] = useState<{ sigla: string; nome: string; unidade: string; regra: string; direcao: string }>({ sigla: '', nome: '', unidade: '', regra: 'soma', direcao: 'maior' })

  const carregar = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true); setMsg('')
    const [ver, edit] = await Promise.all([
      supabase.rpc('fn_ind_tem_permissao', { p_company_id: companyId, p_action: 'read' }),
      supabase.rpc('fn_ind_tem_permissao', { p_company_id: companyId, p_action: 'update' }),
    ])
    const pVer = !!ver.data; const pEdit = !!edit.data
    setPodeVer(pVer); setPodeEditar(pEdit)
    if (!pVer) { setLoading(false); return }
    const [cat, met] = await Promise.all([
      supabase.from('ind_indicador_catalogo').select('*').eq('company_id', companyId)
        .order('ambito', { ascending: true }).order('nivel', { ascending: true }).order('ordem', { ascending: true }),
      supabase.from('ind_indicador_meta').select('*').eq('company_id', companyId).eq('ativo', true),
    ])
    setItens((cat.data as Indicador[]) ?? [])
    setMetas((met.data as Meta[]) ?? [])
    setLoading(false)
  }, [companyId])

  useEffect(() => { void carregar() }, [carregar])

  // Árvore de 3 níveis: BLOCO (n1) → ÁREA (n2) → INDICADOR (n3, folha).
  const blocos = useMemo(() => itens.filter((i) => i.nivel === 1), [itens])
  const areasPor = useMemo(() => {
    const m: Record<string, Indicador[]> = {}
    for (const i of itens) if (i.nivel === 2 && i.pai_codigo) (m[i.pai_codigo] ??= []).push(i)
    return m
  }, [itens])
  const folhasPor = useMemo(() => {
    const m: Record<string, Indicador[]> = {}
    for (const i of itens) if (i.nivel === 3 && i.pai_codigo) (m[i.pai_codigo] ??= []).push(i)
    return m
  }, [itens])
  const metasPor = useMemo(() => {
    const m: Record<string, Meta[]> = {}
    for (const mt of metas) (m[mt.indicador_id] ??= []).push(mt)
    return m
  }, [metas])

  async function semear() {
    if (!companyId) return
    setSalvando(true); setMsg('')
    const { data, error } = await supabase.rpc('fn_ind_semear_catalogo', { p_company_id: companyId })
    setSalvando(false)
    if (error) { setMsg('Erro ao semear: ' + error.message); return }
    setMsg(`Semeadura concluída — ${data ?? 0} indicadores adicionados.`)
    void carregar()
  }

  function iniciarEdicao(i: Indicador) {
    setEditId(i.id)
    setRascunho({ nome: i.nome, unidade_medida: i.unidade_medida, regra_agregacao: i.regra_agregacao, direcao_boa: i.direcao_boa, o_que_mede: i.o_que_mede })
  }
  async function salvarEdicao(id: string) {
    setSalvando(true); setMsg('')
    const { error } = await supabase.from('ind_indicador_catalogo')
      .update({ ...rascunho, atualizado_em: new Date().toISOString() }).eq('id', id)
    setSalvando(false)
    if (error) { setMsg('Erro ao salvar: ' + error.message); return }
    setEditId(null); void carregar()
  }
  async function toggleAtivo(i: Indicador) {
    setSalvando(true); setMsg('')
    const { error } = await supabase.from('ind_indicador_catalogo')
      .update({ ativo: !i.ativo, atualizado_em: new Date().toISOString() }).eq('id', i.id)
    setSalvando(false)
    if (error) { setMsg('Erro: ' + error.message); return }
    void carregar()
  }
  async function adicionar(area: Indicador) {
    if (!companyId) return
    const sig = novo.sigla.trim().toUpperCase()
    if (!sig || !novo.nome.trim()) { setMsg('Informe sigla e nome.'); return }
    setSalvando(true); setMsg('')
    const codigo = `${area.codigo}.${sig}`
    const ordem = (folhasPor[area.codigo]?.length ?? 0) + 1
    const { error } = await supabase.from('ind_indicador_catalogo').insert({
      company_id: companyId, codigo, pai_codigo: area.codigo, nivel: 2, is_totalizador: false,
      nome: novo.nome.trim(), sigla: sig, ambito: area.ambito, unidade_medida: novo.unidade.trim() || null,
      regra_agregacao: novo.regra, direcao_boa: novo.direcao, sugerido_global: false, ordem, editavel: true,
    })
    setSalvando(false)
    if (error) { setMsg(error.message.includes('uq_ind_cat') ? `Já existe um indicador com código ${codigo}.` : 'Erro: ' + error.message); return }
    setNovoSob(null); setNovo({ sigla: '', nome: '', unidade: '', regra: 'soma', direcao: 'maior' })
    void carregar()
  }
  async function salvarMeta(ind: Indicador) {
    if (!companyId) return
    const ano = parseInt(novoMeta.ano, 10); const valor = parseFloat(novoMeta.valor.replace(',', '.'))
    if (!ano || Number.isNaN(valor)) { setMsg('Informe ano e valor da meta.'); return }
    const mes = novoMeta.mes ? parseInt(novoMeta.mes, 10) : null
    if (mes !== null && (mes < 1 || mes > 12)) { setMsg('Mês deve ser entre 1 e 12.'); return }
    setSalvando(true); setMsg('')
    // Índice único é parcial/expressão (COALESCE … WHERE ativo) — upsert por coluna não alcança.
    // Resolve manualmente: procura a meta ativa da mesma chave e atualiza; senão insere.
    let q = supabase.from('ind_indicador_meta').select('id').eq('company_id', companyId)
      .eq('indicador_id', ind.id).eq('recorte_tipo', 'empresa').is('recorte_ref', null)
      .eq('periodo_ano', ano).eq('ativo', true)
    q = mes === null ? q.is('periodo_mes', null) : q.eq('periodo_mes', mes)
    const { data: existente } = await q.maybeSingle()
    const { error } = existente
      ? await supabase.from('ind_indicador_meta').update({ meta_valor: valor, atualizado_em: new Date().toISOString() }).eq('id', (existente as { id: string }).id)
      : await supabase.from('ind_indicador_meta').insert({
          company_id: companyId, indicador_id: ind.id, recorte_tipo: 'empresa', recorte_ref: null,
          periodo_ano: ano, periodo_mes: mes, meta_valor: valor, ativo: true,
        })
    setSalvando(false)
    if (error) { setMsg('Erro ao gravar meta: ' + error.message); return }
    setNovoMeta({ ano: String(ano), mes: '', valor: '' })
    void carregar()
  }

  if (!companyId) {
    return <div style={{ background: BG, minHeight: '100vh', padding: 32, color: MUT, fontSize: 14 }}>Selecione uma empresa específica no topo para gerir o Plano de Indicadores.</div>
  }
  if (loading || podeVer === null) {
    return <div style={{ background: BG, minHeight: '100vh', padding: 40, textAlign: 'center', color: MUT, fontSize: 13 }}>Carregando…</div>
  }
  if (!podeVer) {
    return (
      <div style={{ background: BG, minHeight: '100vh', padding: 32 }}>
        <div style={{ maxWidth: 560, margin: '40px auto', background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 30 }}>🔒</div>
          <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 400, color: ESP, margin: '8px 0 4px' }}>Sem acesso ao Plano de Indicadores</h2>
          <p style={{ fontSize: 13, color: MUT }}>Você não tem a permissão <b>Ver indicadores</b> nesta empresa. Peça ao gestor master para conceder o acesso na tela de Acessos.</p>
        </div>
      </div>
    )
  }

  const vazio = itens.length === 0

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '28px 20px' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <header style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>🎯 Plano de Indicadores</div>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: ESP, margin: '2px 0 0' }}>{selInfo.nome}</h1>
          <p style={{ fontSize: 13, color: MUT, margin: '4px 0 0' }}>
            Catálogo editável tipo plano de contas. {podeEditar ? 'Você pode editar o catálogo e definir metas.' : 'Você tem acesso somente de leitura.'}
          </p>
        </header>

        {msg && <div style={{ margin: '0 0 14px', padding: '8px 12px', borderRadius: 8, fontSize: 12.5, background: msg.startsWith('Erro') ? '#FBEAEA' : '#EAF5EE', color: msg.startsWith('Erro') ? VERM : VERDE, border: `0.5px solid ${LINE}` }}>{msg}</div>}

        {vazio ? (
          <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 26 }}>🌱</div>
            <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 400, color: ESP, margin: '8px 0 4px' }}>Catálogo ainda vazio</h3>
            <p style={{ fontSize: 13, color: MUT, marginBottom: 14 }}>Semeie a partir do modelo global de indicadores. Tudo fica editável depois — nada nasce travado.</p>
            {podeEditar
              ? <button onClick={semear} disabled={salvando} style={btnPrimary}>{salvando ? 'Semeando…' : 'Semear catálogo do modelo'}</button>
              : <p style={{ fontSize: 12, color: MUT }}>Peça ao gestor master (permissão <b>Editar indicadores</b>) para semear.</p>}
          </div>
        ) : (
          <>
            {podeEditar && (
              <div style={{ marginBottom: 14 }}>
                <button onClick={semear} disabled={salvando} style={btnGhost}>↻ Restaurar sugestões do modelo</button>
                <span style={{ fontSize: 11, color: MUT, marginLeft: 10 }}>Readiciona indicadores do modelo que faltarem. Não sobrescreve suas edições.</span>
              </div>
            )}

            {blocos.map((bloco) => {
              const areasB = areasPor[bloco.codigo] ?? []
              const nLeaves = areasB.reduce((acc, a) => acc + (folhasPor[a.codigo]?.filter((f) => f.ativo).length ?? 0), 0)
              const blocoAberto = abertos[bloco.codigo] ?? true
              return (
                <div key={bloco.id} style={{ marginBottom: 12, background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
                  <div onClick={() => setAbertos((s) => ({ ...s, [bloco.codigo]: !blocoAberto }))}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', cursor: 'pointer', background: '#FBF7EF', borderBottom: blocoAberto ? `0.5px solid ${LINE}` : 'none' }}>
                    <span style={{ fontSize: 12, color: MUT, transform: blocoAberto ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
                    <span style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 17, color: ESP }}>{bloco.nome}</span>
                    <span style={{ fontSize: 11, color: MUT, background: BG, borderRadius: 20, padding: '2px 8px' }}>{nLeaves} indicadores</span>
                  </div>

                  {blocoAberto && (
                   <div>
                    {areasB.map((area) => {
                     const folhas = folhasPor[area.codigo] ?? []
                     const aberto = abertos[area.codigo] ?? true
                     return (
                      <div key={area.id} style={{ borderTop: `0.5px solid ${LINE}` }}>
                        <div onClick={() => setAbertos((s) => ({ ...s, [area.codigo]: !aberto }))}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px 10px 28px', cursor: 'pointer' }}>
                          <span style={{ fontSize: 11, color: MUT, transform: aberto ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
                          <span style={{ fontSize: 14, fontWeight: 600, color: ESP }}>{area.nome}</span>
                          <span style={{ fontSize: 10.5, color: MUT, background: BG, borderRadius: 20, padding: '1px 7px' }}>{folhas.filter((f) => f.ativo).length}</span>
                        </div>

                      {aberto && (
                    <div>
                      {folhas.map((f) => {
                        const emEdicao = editId === f.id
                        const fMetas = (metasPor[f.id] ?? []).sort((a, b) => (b.periodo_ano - a.periodo_ano) || ((b.periodo_mes ?? 0) - (a.periodo_mes ?? 0)))
                        return (
                          <div key={f.id} style={{ padding: '10px 16px 10px 34px', borderTop: `0.5px solid ${BG}`, opacity: f.ativo ? 1 : 0.5 }}>
                            {!emEdicao ? (
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: MUT }}>{f.sigla}</span>
                                    <span style={{ fontSize: 14, fontWeight: 600, color: ESP, textDecoration: f.ativo ? 'none' : 'line-through' }}>{f.nome}</span>
                                    {f.unidade_medida && <span style={{ fontSize: 11, color: MUT }}>· {f.unidade_medida}</span>}
                                    <span style={{ fontSize: 10, fontWeight: 700, color: corRegra(f.regra_agregacao), background: BG, borderRadius: 6, padding: '1px 6px' }}>{REGRAS[f.regra_agregacao ?? ''] ?? '—'}</span>
                                    {f.direcao_boa && <span style={{ fontSize: 10, color: MUT }}>{DIRECOES[f.direcao_boa]}</span>}
                                    {!f.sugerido_global && <span style={{ fontSize: 10, color: GOLD, fontWeight: 700 }}>próprio</span>}
                                    {f.fonte_calculo && <span title="tem fonte de realizado (F3)" style={{ fontSize: 10, color: VERDE }}>● fonte</span>}
                                  </div>
                                  {f.o_que_mede && <div style={{ fontSize: 12, color: MUT, marginTop: 2 }}>{f.o_que_mede}</div>}
                                  {fMetas.length > 0 && (
                                    <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                      {fMetas.map((m) => (
                                        <span key={m.id} style={{ fontSize: 11, color: ESP, background: '#FBF4E4', border: `0.5px solid ${LINE}`, borderRadius: 6, padding: '1px 6px' }}>
                                          meta {m.periodo_ano}{m.periodo_mes ? '/' + String(m.periodo_mes).padStart(2, '0') : ''}: <b>{m.meta_valor}</b>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                {podeEditar && (
                                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                    <button onClick={() => setMetaFor(metaFor === f.id ? null : f.id)} style={btnMini}>Metas</button>
                                    <button onClick={() => iniciarEdicao(f)} style={btnMini}>Editar</button>
                                    <button onClick={() => toggleAtivo(f)} style={{ ...btnMini, color: f.ativo ? VERM : VERDE }}>{f.ativo ? 'Desativar' : 'Reativar'}</button>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div style={{ display: 'grid', gap: 8 }}>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  <input value={rascunho.nome ?? ''} onChange={(e) => setRascunho((r) => ({ ...r, nome: e.target.value }))} placeholder="Nome" style={{ ...inp, flex: 2, minWidth: 200 }} />
                                  <input value={rascunho.unidade_medida ?? ''} onChange={(e) => setRascunho((r) => ({ ...r, unidade_medida: e.target.value }))} placeholder="Unidade" style={{ ...inp, width: 110 }} />
                                  <select value={rascunho.regra_agregacao ?? ''} onChange={(e) => setRascunho((r) => ({ ...r, regra_agregacao: e.target.value }))} style={inp}>
                                    {Object.entries(REGRAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                  </select>
                                  <select value={rascunho.direcao_boa ?? ''} onChange={(e) => setRascunho((r) => ({ ...r, direcao_boa: e.target.value }))} style={inp}>
                                    <option value="">— direção —</option>
                                    {Object.entries(DIRECOES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                  </select>
                                </div>
                                <input value={rascunho.o_que_mede ?? ''} onChange={(e) => setRascunho((r) => ({ ...r, o_que_mede: e.target.value }))} placeholder="O que mede" style={inp} />
                                <div style={{ display: 'flex', gap: 8 }}>
                                  <button onClick={() => salvarEdicao(f.id)} disabled={salvando} style={btnPrimary}>Salvar</button>
                                  <button onClick={() => setEditId(null)} style={btnGhost}>Cancelar</button>
                                </div>
                              </div>
                            )}

                            {metaFor === f.id && podeEditar && (
                              <div style={{ marginTop: 8, padding: 10, background: BG, borderRadius: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 12, color: MUT }}>Definir meta:</span>
                                <input value={novoMeta.ano} onChange={(e) => setNovoMeta((m) => ({ ...m, ano: e.target.value }))} placeholder="Ano" style={{ ...inp, width: 70 }} />
                                <input value={novoMeta.mes} onChange={(e) => setNovoMeta((m) => ({ ...m, mes: e.target.value }))} placeholder="Mês (opc)" style={{ ...inp, width: 90 }} />
                                <input value={novoMeta.valor} onChange={(e) => setNovoMeta((m) => ({ ...m, valor: e.target.value }))} placeholder="Valor" style={{ ...inp, width: 100 }} />
                                <button onClick={() => salvarMeta(f)} disabled={salvando} style={btnPrimary}>Gravar meta</button>
                              </div>
                            )}
                          </div>
                        )
                      })}

                      {podeEditar && (
                        <div style={{ padding: '8px 16px 12px 34px', borderTop: `0.5px solid ${BG}` }}>
                          {novoSob === area.codigo ? (
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                              <input value={novo.sigla} onChange={(e) => setNovo((n) => ({ ...n, sigla: e.target.value }))} placeholder="Sigla" style={{ ...inp, width: 80 }} />
                              <input value={novo.nome} onChange={(e) => setNovo((n) => ({ ...n, nome: e.target.value }))} placeholder="Nome do indicador" style={{ ...inp, flex: 1, minWidth: 180 }} />
                              <input value={novo.unidade} onChange={(e) => setNovo((n) => ({ ...n, unidade: e.target.value }))} placeholder="Unidade" style={{ ...inp, width: 100 }} />
                              <select value={novo.regra} onChange={(e) => setNovo((n) => ({ ...n, regra: e.target.value }))} style={inp}>
                                {Object.entries(REGRAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                              </select>
                              <button onClick={() => adicionar(area)} disabled={salvando} style={btnPrimary}>Adicionar</button>
                              <button onClick={() => setNovoSob(null)} style={btnGhost}>Cancelar</button>
                            </div>
                          ) : (
                            <button onClick={() => { setNovoSob(area.codigo); setNovo({ sigla: '', nome: '', unidade: '', regra: 'soma', direcao: 'maior' }) }} style={btnGhost}>+ Novo indicador em {area.nome}</button>
                          )}
                        </div>
                      )}
                    </div>
                      )}
                      </div>
                     )
                    })}
                   </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

const inp: React.CSSProperties = { fontSize: 13, padding: '6px 8px', border: `0.5px solid ${LINE}`, borderRadius: 6, background: '#FFF', color: ESP }
const btnPrimary: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: '#FFF', background: ESP, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer' }
const btnGhost: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: ESP, background: 'transparent', border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '7px 12px', cursor: 'pointer' }
const btnMini: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: ESP, background: BG, border: `0.5px solid ${LINE}`, borderRadius: 6, padding: '4px 9px', cursor: 'pointer' }
