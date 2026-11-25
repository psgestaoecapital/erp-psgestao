'use client'

// GE › Classificar pendências (GO-LIVE agência piloto, CEO 25/11, item 2).
// Classifica EM LOTE as despesas (erp_pagar) sem conta do plano gerencial — com sugestão pelo histórico
// (fornecedor/descrição) e trilha — e aponta o grupo DRE das contas que ainda não têm, para o DRE enxergar tudo.
// Lê/escreve só pelas portas guardadas por login+empresa: fn_pagar_pendencias_classificar,
// fn_pagar_classificar_em_lote, fn_plano_contas_sem_dre, fn_plano_contas_definir_grupo, fn_plano_contas_buscar.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useEmpresaSelecionada } from '@/lib/empresa/useEmpresaSelecionada'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.6)'; const GREEN = '#4E7D34'; const CARD = '#FFFFFF'

const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })
const dataBR = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—')

const GRUPOS_DRE: { valor: string; rotulo: string }[] = [
  { valor: 'CMV', rotulo: 'Custo (CMV)' },
  { valor: 'DEDUCOES', rotulo: 'Deduções da receita' },
  { valor: 'IMPOSTOS_VENDA', rotulo: 'Impostos sobre venda' },
  { valor: 'DESP_FIXA', rotulo: 'Despesa fixa' },
  { valor: 'DESP_VARIAVEL', rotulo: 'Despesa variável' },
  { valor: 'DEPREC_AMORT', rotulo: 'Depreciação / amortização' },
  { valor: 'IR_CSLL', rotulo: 'IR / CSLL' },
  { valor: 'NAO_OPER', rotulo: 'Não operacional' },
  { valor: 'DESTINACAO', rotulo: 'Destinação do lucro' },
]

type Pendente = {
  id: string; fornecedor_nome: string | null; descricao: string | null; valor: number
  data_vencimento: string | null; status: string | null; categoria_atual: string | null
  sugerido_codigo: string | null; sugerido_descricao: string | null; sugerido_grupo: string | null
  sugestao_origem: string | null; sugestao_confianca: number | null
}
type Conta = { codigo: string; descricao: string; grupo: string | null }
type ContaSemDre = { id: string; codigo: string; descricao: string; tipo: string | null; nivel: number; pai_codigo: string | null }

// Escolha de conta por linha: código + descrição exibida.
type Escolha = { codigo: string; descricao: string } | null

export default function ClassificarPendenciasPage() {
  const { companyId } = useEmpresaSelecionada()
  const empresa = companyId && !companyId.startsWith('group_') && companyId !== 'consolidado' ? companyId : null

  const [aba, setAba] = useState<'despesas' | 'contas'>('despesas')
  const [busca, setBusca] = useState('')
  const [termo, setTermo] = useState('')
  const [pend, setPend] = useState<Pendente[]>([])
  const [semDre, setSemDre] = useState<ContaSemDre[]>([])
  const [escolha, setEscolha] = useState<Record<string, Escolha>>({})
  const [marcado, setMarcado] = useState<Record<string, boolean>>({})
  const [grupoSel, setGrupoSel] = useState<Record<string, string>>({})
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) return
    setCarregando(true); setErro(null); setAviso(null)
    const [p, c] = await Promise.all([
      supabase.rpc('fn_pagar_pendencias_classificar', { p_company_id: empresa, p_termo: termo || null, p_limite: 500 }),
      supabase.rpc('fn_plano_contas_sem_dre', { p_company_id: empresa }),
    ])
    setCarregando(false)
    if (p.error) { setErro(erroAmigavel(p.error, 'Não foi possível carregar as despesas pendentes.')); return }
    const linhas = (p.data as Pendente[]) ?? []
    setPend(linhas)
    setSemDre((c.data as ContaSemDre[]) ?? [])
    // pré-preenche a escolha com a sugestão (quando houver), sem marcar — o usuário confere.
    setEscolha(prev => {
      const next = { ...prev }
      for (const l of linhas) {
        if (!next[l.id] && l.sugerido_codigo) next[l.id] = { codigo: l.sugerido_codigo, descricao: l.sugerido_descricao ?? l.sugerido_codigo }
      }
      return next
    })
  }, [empresa, termo])

  useEffect(() => { void carregar() }, [carregar])

  const totalPend = useMemo(() => pend.reduce((s, l) => s + Number(l.valor || 0), 0), [pend])
  const altaConfianca = useMemo(() => pend.filter(l => l.sugerido_codigo && l.sugestao_origem === 'fornecedor'), [pend])
  const selecionados = useMemo(() => pend.filter(l => marcado[l.id] && escolha[l.id]?.codigo), [pend, marcado, escolha])

  const aplicar = useCallback(async (itens: { id: string; codigo: string }[], rotulo: string) => {
    if (!empresa || itens.length === 0) { setAviso('Selecione ao menos uma despesa com conta definida.'); return }
    setSalvando(true); setErro(null); setAviso(null)
    const { data, error } = await supabase.rpc('fn_pagar_classificar_em_lote', { p_company_id: empresa, p_itens: itens })
    setSalvando(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível classificar as despesas.')); return }
    const r = data as { ok: boolean; aplicados: number; ignorados: number; erros: unknown[] }
    if (!r?.ok) { setErro('Não foi possível classificar as despesas.'); return }
    setMarcado({})
    setAviso(`${rotulo}: ${r.aplicados} classificada(s)${r.ignorados ? ` · ${r.ignorados} já estavam ou foram ignoradas` : ''}.`)
    await carregar()
  }, [empresa, carregar])

  const definirGrupo = useCallback(async (conta: ContaSemDre) => {
    if (!empresa) return
    const grupo = grupoSel[conta.id]
    if (!grupo) { setAviso('Escolha o grupo DRE da conta.'); return }
    setSalvando(true); setErro(null); setAviso(null)
    const { data, error } = await supabase.rpc('fn_plano_contas_definir_grupo', { p_company_id: empresa, p_id: conta.id, p_grupo: grupo })
    setSalvando(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível definir o grupo da conta.')); return }
    const r = data as { ok: boolean; mensagem?: string }
    if (!r?.ok) { setErro(r?.mensagem ?? 'Não foi possível definir o grupo da conta.'); return }
    setAviso(`Conta ${conta.codigo} ligada ao DRE.`)
    await carregar()
  }, [empresa, grupoSel, carregar])

  if (!empresa) {
    return (
      <div style={{ padding: 24, background: BG, minHeight: '100%' }}>
        <h1 style={{ color: ESP, fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>Classificar pendências</h1>
        <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 14, padding: 20, color: ESP60, maxWidth: 560 }}>
          Selecione <strong>uma empresa</strong> (não o consolidado nem um grupo) no topo para classificar as pendências dela.
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 'clamp(16px, 4vw, 28px)', background: BG, minHeight: '100%' }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ color: ESP, fontSize: 'clamp(20px,5vw,24px)', fontWeight: 700, margin: 0 }}>Classificar pendências</h1>
        <p style={{ color: ESP60, margin: '6px 0 0', fontSize: 14, maxWidth: 680 }}>
          Dê uma conta às despesas que ainda não têm — com sugestão pelo histórico — e ligue ao DRE as contas sem grupo.
          Só então o resultado (DRE) enxerga tudo.
        </p>
      </header>

      {/* Abas */}
      <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <AbaBtn ativo={aba === 'despesas'} onClick={() => setAba('despesas')} label="Despesas sem conta" n={pend.length} />
        <AbaBtn ativo={aba === 'contas'} onClick={() => setAba('contas')} label="Contas sem grupo DRE" n={semDre.length} />
      </div>

      {erro && <Faixa cor="#B23A2E" bg="#FBEAE8">{erro}</Faixa>}
      {aviso && <Faixa cor={GREEN} bg="#EAF3E3">{aviso}</Faixa>}

      {aba === 'despesas' && (
        <section>
          {/* Filtro + ações */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 240px', minWidth: 200 }}>
              <span style={lbl}>Buscar <AjudaCampo chave="ge.classificar.busca" /></span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={busca} onChange={e => setBusca(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') setTermo(busca.trim()) }}
                  placeholder="Fornecedor ou descrição…" style={inp} />
                <button onClick={() => setTermo(busca.trim())} style={btnGhost}>Filtrar</button>
              </div>
            </label>
            <div style={{ flex: '1 1 auto' }} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={lbl}><AjudaCampo chave="ge.classificar.aplicar_sugestoes" /></span>
              <button disabled={salvando || altaConfianca.length === 0}
                onClick={() => aplicar(altaConfianca.map(l => ({ id: l.id, codigo: l.sugerido_codigo! })), 'Sugestões aplicadas')}
                style={{ ...btnOuro, opacity: altaConfianca.length === 0 ? 0.5 : 1 }}>
                Aplicar sugestões ({altaConfianca.length})
              </button>
            </div>
          </div>

          {/* Resumo */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
            <Kpi titulo="Despesas pendentes" valor={String(pend.length)} />
            <Kpi titulo="Valor pendente" valor={brl(totalPend)} />
            <Kpi titulo="Selecionadas" valor={String(selecionados.length)} />
          </div>

          {carregando ? (
            <Vazio>Carregando…</Vazio>
          ) : pend.length === 0 ? (
            <Vazio>
              <strong style={{ color: ESP }}>Tudo classificado 🎉</strong><br />
              Nenhuma despesa pendente nesta empresa. Quando entrar uma despesa sem conta, ela aparece aqui.
            </Vazio>
          ) : (
            <>
              {/* Tabela (desktop) */}
              <div style={{ overflowX: 'auto', border: `1px solid ${LINE}`, borderRadius: 14, background: CARD }} className="cp-tabela">
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: ESP60, fontSize: 12 }}>
                      <th style={thCol}><input type="checkbox"
                        checked={pend.length > 0 && pend.every(l => marcado[l.id])}
                        onChange={e => { const v = e.target.checked; const m: Record<string, boolean> = {}; if (v) pend.forEach(l => m[l.id] = true); setMarcado(m) }} /></th>
                      <th style={thCol}>Fornecedor <AjudaCampo chave="ge.classificar.fornecedor" /></th>
                      <th style={thCol}>Descrição <AjudaCampo chave="ge.classificar.descricao" /></th>
                      <th style={{ ...thCol, textAlign: 'right' }}>Valor <AjudaCampo chave="ge.classificar.valor" /></th>
                      <th style={thCol}>Sugestão <AjudaCampo chave="ge.classificar.sugestao" /></th>
                      <th style={thCol}>Conta <AjudaCampo chave="ge.classificar.conta" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pend.map(l => (
                      <tr key={l.id} style={{ borderTop: `1px solid ${LINE}` }}>
                        <td style={tdCol}><input type="checkbox" checked={!!marcado[l.id]}
                          onChange={e => setMarcado(m => ({ ...m, [l.id]: e.target.checked }))} /></td>
                        <td style={tdCol}>
                          <div style={{ fontWeight: 600, color: ESP }}>{l.fornecedor_nome || 'Sem fornecedor'}</div>
                          <div style={{ fontSize: 12, color: ESP60 }}>venc. {dataBR(l.data_vencimento)}</div>
                        </td>
                        <td style={{ ...tdCol, maxWidth: 260 }}>{l.descricao || '—'}</td>
                        <td style={{ ...tdCol, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{brl(Number(l.valor))}</td>
                        <td style={tdCol}><Sugestao l={l} /></td>
                        <td style={{ ...tdCol, minWidth: 220 }}>
                          <ContaPicker empresa={empresa} valor={escolha[l.id]} onPick={c => setEscolha(s => ({ ...s, [l.id]: c }))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Ação em lote */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
                <span style={lbl}><AjudaCampo chave="ge.classificar.aplicar_selecionados" /></span>
                <button disabled={salvando || selecionados.length === 0}
                  onClick={() => aplicar(selecionados.map(l => ({ id: l.id, codigo: escolha[l.id]!.codigo })), 'Despesas classificadas')}
                  style={{ ...btnOuro, opacity: selecionados.length === 0 ? 0.5 : 1 }}>
                  {salvando ? 'Aplicando…' : `Aplicar selecionados (${selecionados.length})`}
                </button>
                <span style={{ color: ESP60, fontSize: 13 }}>Cada classificação fica registrada na trilha de auditoria.</span>
              </div>
            </>
          )}
        </section>
      )}

      {aba === 'contas' && (
        <section>
          {carregando ? (
            <Vazio>Carregando…</Vazio>
          ) : semDre.length === 0 ? (
            <Vazio>
              <strong style={{ color: ESP }}>Todas as contas estão ligadas ao DRE 🎉</strong><br />
              Nenhuma conta do plano está sem grupo. Quando criar uma conta sem grupo, ela aparece aqui para você apontar.
            </Vazio>
          ) : (
            <div style={{ border: `1px solid ${LINE}`, borderRadius: 14, background: CARD, overflow: 'hidden' }}>
              {semDre.map((c, i) => (
                <div key={c.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', borderTop: i ? `1px solid ${LINE}` : 'none', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 220px', minWidth: 180 }}>
                    <div style={{ fontWeight: 600, color: ESP }}>{c.codigo} · {c.descricao}</div>
                    <div style={{ fontSize: 12, color: ESP60 }}>{c.tipo || 'conta'}</div>
                  </div>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={lbl}>Grupo DRE <AjudaCampo chave="ge.classificar.contas_sem_dre" /></span>
                    <select value={grupoSel[c.id] ?? ''} onChange={e => setGrupoSel(g => ({ ...g, [c.id]: e.target.value }))} style={{ ...inp, minWidth: 220 }}>
                      <option value="">Selecione…</option>
                      {GRUPOS_DRE.map(g => <option key={g.valor} value={g.valor}>{g.rotulo}</option>)}
                    </select>
                  </label>
                  <button disabled={salvando || !grupoSel[c.id]} onClick={() => definirGrupo(c)}
                    style={{ ...btnOuro, opacity: !grupoSel[c.id] ? 0.5 : 1 }}>Ligar ao DRE</button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <style>{`@media (max-width: 640px){ .cp-tabela table{ min-width: 620px } }`}</style>
    </div>
  )
}

function Sugestao({ l }: { l: Pendente }) {
  if (!l.sugerido_codigo) return <span style={{ color: ESP60, fontSize: 13 }}>—</span>
  const conf = l.sugestao_confianca != null ? Math.round(Number(l.sugestao_confianca) * 100) : null
  const forte = l.sugestao_origem === 'fornecedor'
  return (
    <div>
      <div style={{ fontSize: 13, color: ESP, fontWeight: 600 }}>{l.sugerido_codigo}</div>
      <div style={{ fontSize: 12, color: ESP60, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.sugerido_descricao}</div>
      {conf != null && (
        <span style={{ display: 'inline-block', marginTop: 2, fontSize: 11, fontWeight: 600, color: forte ? GREEN : GOLD, background: forte ? '#EAF3E3' : '#FBF2DE', padding: '1px 7px', borderRadius: 999 }}>
          {conf}% · {forte ? 'por fornecedor' : 'por descrição'}
        </span>
      )}
    </div>
  )
}

// Busca-conta (autocomplete) usando fn_plano_contas_buscar, escopado à empresa.
function ContaPicker({ empresa, valor, onPick }: { empresa: string; valor: Escolha; onPick: (c: Escolha) => void }) {
  const [q, setQ] = useState('')
  const [abertoCp, setAbertoCp] = useState(false)
  const [opts, setOpts] = useState<Conta[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!abertoCp) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const { data } = await supabase.rpc('fn_plano_contas_buscar', { p_company_id: empresa, p_termo: q || null, p_aplicacao: 'pagar' })
      setOpts(((data as Conta[]) ?? []).slice(0, 30))
    }, 180)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [q, abertoCp, empresa])

  return (
    <div style={{ position: 'relative' }}>
      {valor && !abertoCp ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: ESP, fontWeight: 600 }}>{valor.codigo}</span>
          <span style={{ fontSize: 12, color: ESP60, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{valor.descricao}</span>
          <button onClick={() => { setAbertoCp(true); setQ('') }} style={{ ...btnGhost, padding: '2px 8px', fontSize: 12 }}>trocar</button>
        </div>
      ) : (
        <>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <AjudaCampo chave="ge.classificar.conta" />
            <input autoFocus={abertoCp} value={q} onChange={e => setQ(e.target.value)} onFocus={() => setAbertoCp(true)}
              placeholder="Buscar conta…" style={{ ...inp, minWidth: 180 }} />
          </label>
          {abertoCp && (
            <div style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, background: CARD, border: `1px solid ${LINE}`, borderRadius: 10, marginTop: 4, maxHeight: 240, overflowY: 'auto', boxShadow: '0 8px 24px rgba(61,35,20,0.12)' }}>
              {opts.length === 0 ? (
                <div style={{ padding: 10, color: ESP60, fontSize: 13 }}>Digite para buscar uma conta.</div>
              ) : opts.map(o => (
                <button key={o.codigo} onClick={() => { onPick({ codigo: o.codigo, descricao: o.descricao }); setAbertoCp(false) }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', background: 'none', border: 'none', borderBottom: `1px solid ${LINE}`, cursor: 'pointer' }}>
                  <span style={{ fontWeight: 600, color: ESP, fontSize: 13 }}>{o.codigo}</span>
                  <span style={{ color: ESP60, fontSize: 13 }}> · {o.descricao}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function AbaBtn({ ativo, onClick, label, n }: { ativo: boolean; onClick: () => void; label: string; n: number }) {
  return (
    <button role="tab" aria-selected={ativo} onClick={onClick}
      style={{ padding: '8px 14px', borderRadius: 999, border: `1px solid ${ativo ? GOLD : LINE}`, background: ativo ? '#FBF2DE' : CARD, color: ESP, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
      {label} <span style={{ color: ESP60 }}>({n})</span>
    </button>
  )
}
function Kpi({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 16px', minWidth: 150 }}>
      <div style={{ color: ESP60, fontSize: 12 }}>{titulo}</div>
      <div style={{ color: ESP, fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
    </div>
  )
}
function Vazio({ children }: { children: React.ReactNode }) {
  return <div style={{ background: CARD, border: `1px dashed ${LINE}`, borderRadius: 14, padding: 28, color: ESP60, textAlign: 'center' }}>{children}</div>
}
function Faixa({ children, cor, bg }: { children: React.ReactNode; cor: string; bg: string }) {
  return <div style={{ background: bg, color: cor, border: `1px solid ${cor}33`, borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 14 }}>{children}</div>
}

const lbl: React.CSSProperties = { color: ESP, fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }
const inp: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 10, padding: '8px 10px', fontSize: 14, color: ESP, background: CARD, outline: 'none' }
const btnOuro: React.CSSProperties = { background: GOLD, color: '#fff', border: 'none', borderRadius: 10, padding: '9px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }
const btnGhost: React.CSSProperties = { background: CARD, color: ESP, border: `1px solid ${LINE}`, borderRadius: 10, padding: '8px 12px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }
const thCol: React.CSSProperties = { padding: '10px 12px', fontWeight: 600, whiteSpace: 'nowrap' }
const tdCol: React.CSSProperties = { padding: '10px 12px', color: ESP, fontSize: 14, verticalAlign: 'top' }
