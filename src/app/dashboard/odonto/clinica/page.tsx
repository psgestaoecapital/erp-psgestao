'use client'
// RD-41 · Odonto O2 — Tela clínica (odontograma + plano com valor + aprovação). PR1 (Partes 1-3).
// Storyboard numa tela só: odontograma FDI (faces) → adicionar tratamento com VALOR → lista +
// aprovar com parcelamento (gera erp_receber real em GE — prova a O0). Voz/IA vêm no PR2.
// 🔒 FRONTEIRA GE: o valor vira erp_receber via aprovar_financeiro; nada financeiro recriado.
// 🛡️ IA assiste, dentista decide (fast-follow). Design System #819 · full-width #847.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ShellOdonto, PageHeaderOdonto, CardOdonto, EmptyStateOdonto, SaldoBadge, TOK } from '@/components/odonto/ui'
import { Odontograma, grupoDentes, FACES, FACE_LABEL, type Face } from '@/components/odonto/Odontograma'

const brl = (v: number | null | undefined) => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// condição do odontograma → cor de face (tinta suave; semáforo reservado a status do plano)
const COND_COR: Record<string, string> = {
  ausente: TOK.gray, carie: '#F3C7C0', fratura: '#F3C7C0',
  restauracao: '#CFE0F0', canal: '#CFE0F0', coroa: '#CFE0F0', implante: '#CFE0F0',
}

function useCompanyId(): string | null {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => {
      if (typeof window === 'undefined') return null
      const v = localStorage.getItem('ps_empresa_sel')
      if (!v || v === 'consolidado' || v.startsWith('group_')) return null
      return v
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setId(read())
    const t = setInterval(() => { const v = read(); setId((p) => (p === v ? p : v)) }, 800)
    return () => clearInterval(t)
  }, [])
  return id
}

type Proc = { id: string; nome: string; cor: string | null; valor: number | null; duracao_min: number | null }
type Paciente = { id: string; nome: string }
type Estado = { dente: string; face: string | null; condicao: string; procedimento_id: string | null; observacao: string | null }
type Item = { id?: string; procedimento_id: string | null; descricao: string; dente: string | null; faces: string | null; valor: number; status?: string; ordem?: number }

export default function ClinicaOdontoPage() {
  const companyId = useCompanyId()
  const [busca, setBusca] = useState('')
  const [resultados, setResultados] = useState<Paciente[]>([])
  const [pac, setPac] = useState<Paciente | null>(null)
  const [procs, setProcs] = useState<Proc[]>([])
  const [estado, setEstado] = useState<Estado[]>([])
  const [planoId, setPlanoId] = useState<string | null>(null)
  const [itens, setItens] = useState<Item[]>([])
  const [deciduos, setDeciduos] = useState(false)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [mostrarFinalizados, setMostrarFinalizados] = useState(true)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [aprovarAberto, setAprovarAberto] = useState(false)
  const [busy, setBusy] = useState(false)

  // form "adicionar tratamento"
  const [fProc, setFProc] = useState<string>('')
  const [fDente, setFDente] = useState('')
  const [fFace, setFFace] = useState<Face | ''>('')
  const [fValor, setFValor] = useState('')

  const flash = (ok: boolean, t: string) => { setMsg({ ok, t }); window.setTimeout(() => setMsg(null), 4000) }

  // busca de paciente (debounce)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!companyId || pac || busca.trim().length < 2) { setResultados([]); return }
    const t = window.setTimeout(async () => {
      const { data } = await supabase.from('erp_odonto_paciente').select('id, nome')
        .eq('company_id', companyId).eq('ativo', true).ilike('nome', `%${busca.trim()}%`).order('nome').limit(8)
      setResultados((data as Paciente[]) ?? [])
    }, 250)
    return () => window.clearTimeout(t)
  }, [busca, companyId, pac])

  const carregarProcs = useCallback(async () => {
    if (!companyId) return
    const { data } = await supabase.from('erp_odonto_procedimento').select('id, nome, cor, valor, duracao_min')
      .eq('company_id', companyId).eq('ativo', true).order('nome')
    setProcs((data as Proc[]) ?? [])
  }, [companyId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregarProcs() }, [carregarProcs])

  const recarregarClinico = useCallback(async (paciente: Paciente) => {
    if (!companyId) return
    const [{ data: est }, { data: planos }] = await Promise.all([
      supabase.rpc('fn_odonto_odontograma_estado', { p_company_id: companyId, p_paciente_id: paciente.id }),
      supabase.rpc('fn_odonto_planos_paciente', { p_company_id: companyId, p_paciente_id: paciente.id }),
    ])
    setEstado((est as Estado[]) ?? [])
    // plano ativo = o mais recente não-aprovado; senão começa vazio (cria no 1º salvar)
    const lista = (planos as { id: string; status: string }[]) ?? []
    const ativo = lista.find((p) => ['rascunho', 'orcamento'].includes(p.status)) ?? lista[0] ?? null
    if (ativo) {
      const { data: pl } = await supabase.rpc('fn_odonto_plano_obter', { p_id: ativo.id })
      const p = pl as { itens?: Item[] } | null
      setPlanoId(ativo.id); setItens((p?.itens ?? []).map((i, ix) => ({ ...i, ordem: i.ordem ?? ix })))
    } else { setPlanoId(null); setItens([]) }
  }, [companyId])

  const escolher = async (p: Paciente) => { setPac(p); setResultados([]); setBusca(p.nome); await recarregarClinico(p) }

  // cor da face no odontograma: plano concluído (verde) > pendente (âmbar) > condição/ausente
  const itemDoDente = useCallback((dente: string) => itens.find((i) => i.dente === dente), [itens])
  const corDaFace = useCallback((dente: string, face: Face): string | null => {
    const it = itens.find((i) => i.dente === dente && (!i.faces || i.faces.split(',').includes(face)))
    if (it) return it.status === 'concluido' ? TOK.green : TOK.amber
    const anyItem = itemDoDente(dente)
    if (anyItem && (!anyItem.faces)) return anyItem.status === 'concluido' ? TOK.green : TOK.amber
    const e = estado.find((x) => x.dente === dente && (x.face === face || x.face == null))
    if (e) return COND_COR[e.condicao] ?? null
    return null
  }, [itens, estado, itemDoDente])

  // clicar face → prefill o "adicionar tratamento"
  const onFace = (dente: string, face: Face) => { setFDente(dente); setFFace(face); flash(true, `Dente ${dente} · ${FACE_LABEL[face]} — preencha o tratamento`) }
  const onNum = (dente: string) => setSelecionados((s) => { const n = new Set(s); if (n.has(dente)) n.delete(dente); else n.add(dente); return n })
  const selGrupo = (g: 'maxila' | 'mandibula' | 'arc_sup' | 'arc_inf' | 'todos') =>
    setSelecionados((s) => { const grp = grupoDentes(g, deciduos); const todos = grp.every((d) => s.has(d)); const n = new Set(s); grp.forEach((d) => todos ? n.delete(d) : n.add(d)); return n })

  const procSel = useMemo(() => procs.find((p) => p.id === fProc) ?? null, [procs, fProc])
  // 💡 sugestão de preço vem do catálogo; se 0 → dentista define (resolve a O0)
  useEffect(() => { if (procSel && !fValor) setFValor(procSel.valor && procSel.valor > 0 ? String(procSel.valor) : '') }, [procSel]) // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect

  const parseVal = (s: string) => { const n = Number(s.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }

  const salvarPlano = async (novos: Item[]) => {
    if (!companyId || !pac) return null
    const payloadItens = novos.map((i, ix) => ({
      procedimento_id: i.procedimento_id, descricao: i.descricao, dente: i.dente, faces: i.faces,
      valor: i.valor, ordem: ix,
    }))
    const { data, error } = await supabase.rpc('fn_odonto_plano_salvar', {
      p_company_id: companyId,
      p_plano: { paciente_id: pac.id, titulo: 'Plano clínico', status: 'orcamento' },
      p_itens: payloadItens, p_plano_id: planoId,
    })
    const r = data as { ok?: boolean; id?: string } | null
    if (error || !r?.ok) { flash(false, error?.message || 'Falha ao salvar plano'); return null }
    setPlanoId(r.id ?? planoId)
    return r.id ?? planoId
  }

  const adicionar = async () => {
    if (!procSel) { flash(false, 'Escolha o procedimento.'); return }
    const valor = parseVal(fValor)
    if (valor <= 0) { flash(false, 'Defina o valor (o preço deste procedimento está 0 — digite e, se quiser, salve como padrão).'); return }
    const dentesAlvo = selecionados.size > 0 ? Array.from(selecionados) : (fDente.trim() ? [fDente.trim()] : [''])
    const faces = fFace || ''
    const novos: Item[] = [...itens]
    for (const d of dentesAlvo) {
      novos.push({ procedimento_id: procSel.id, descricao: procSel.nome, dente: d || null, faces: faces || null, valor, status: 'proposto' })
    }
    setBusy(true)
    const id = await salvarPlano(novos)
    setBusy(false)
    if (!id) return
    setItens(novos)
    setFProc(''); setFDente(''); setFFace(''); setFValor(''); setSelecionados(new Set())
    flash(true, `Adicionado ao plano · ${dentesAlvo.length > 1 ? `${dentesAlvo.length} dentes` : (dentesAlvo[0] || 'sem dente')}`)
  }

  const salvarPrecoPadrao = async () => {
    if (!companyId || !procSel) return
    const valor = parseVal(fValor)
    if (valor <= 0) { flash(false, 'Digite um valor antes de salvar como padrão.'); return }
    const { data } = await supabase.rpc('fn_odonto_procedimento_preco_definir', { p_company_id: companyId, p_procedimento_id: procSel.id, p_valor: valor })
    if ((data as { ok?: boolean })?.ok) { await carregarProcs(); flash(true, `Preço padrão de "${procSel.nome}" salvo: ${brl(valor)}`) }
    else flash(false, 'Não deu pra salvar o preço padrão.')
  }

  const removerItem = async (ix: number) => {
    const novos = itens.filter((_, i) => i !== ix)
    setBusy(true); const id = await salvarPlano(novos); setBusy(false)
    if (id) { setItens(novos); flash(true, 'Item removido.') }
  }

  const concluirItem = async (it: Item) => {
    if (!it.id) { flash(false, 'Salve/aprove o plano antes de concluir.'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_odonto_item_concluir', { p_item_id: it.id, p_baixar: true, p_data: null, p_conta_bancaria_id: null, p_forma: 'PIX' })
    setBusy(false)
    if (error || (data as { ok?: boolean })?.ok === false) { flash(false, error?.message || 'Falha ao concluir'); return }
    if (pac) await recarregarClinico(pac)
    flash(true, `"${it.descricao}" concluído · marcado no odontograma`)
  }

  const total = useMemo(() => itens.reduce((s, i) => s + (i.valor || 0), 0), [itens])
  const totalAprovado = useMemo(() => itens.filter((i) => i.status === 'aprovado' || i.status === 'concluido').reduce((s, i) => s + i.valor, 0), [itens])
  const itensVisiveis = mostrarFinalizados ? itens : itens.filter((i) => i.status !== 'concluido')

  if (!companyId) return <ShellOdonto><EmptyStateOdonto titulo="Escolha uma clínica" linha="Selecione uma empresa específica no topo do menu para abrir a clínica." /></ShellOdonto>

  return (
    <ShellOdonto>
      <PageHeaderOdonto icon={<span>🦷</span>} titulo="Clínica" subtitulo="Odontograma · plano com valor · aprovação"
        acoes={pac ? <SaldoBadge pacienteId={pac.id} /> : undefined} />

      {msg && <div style={{ background: msg.ok ? '#E7F3EA' : '#FBEBEB', color: msg.ok ? TOK.green : TOK.red, padding: '8px 12px', borderRadius: TOK.rCtrl, marginBottom: 10, fontSize: 13, fontWeight: 600 }}>{msg.t}</div>}

      {/* Paciente */}
      <CardOdonto style={{ marginBottom: 12 }}>
        {pac ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: TOK.esp }}>{pac.nome}</div>
            <button type="button" onClick={() => { setPac(null); setBusca(''); setItens([]); setEstado([]); setPlanoId(null) }}
              style={{ fontSize: 12, fontWeight: 600, color: TOK.mut, background: 'none', border: `0.5px solid ${TOK.line}`, borderRadius: TOK.rCtrl, padding: '6px 12px', cursor: 'pointer' }}>Trocar paciente</button>
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar paciente pelo nome…"
              style={{ width: '100%', padding: '10px 12px', border: `0.5px solid ${TOK.line}`, borderRadius: TOK.rCtrl, fontSize: 14, color: TOK.esp, outline: 'none' }} />
            {resultados.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: '#fff', border: `0.5px solid ${TOK.line}`, borderRadius: TOK.rCtrl, marginTop: 4, boxShadow: '0 8px 24px rgba(61,35,20,0.1)' }}>
                {resultados.map((p) => (
                  <button key={p.id} type="button" onClick={() => void escolher(p)} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', borderBottom: `0.5px solid ${TOK.line}`, cursor: 'pointer', fontSize: 14, color: TOK.esp }}>{p.nome}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </CardOdonto>

      {!pac ? (
        <EmptyStateOdonto titulo="Selecione um paciente" linha="Busque pelo nome pra abrir o odontograma e montar o plano de tratamento." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* seleção em massa */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: TOK.mut, textTransform: 'uppercase', letterSpacing: 0.5 }}>Selecionar:</span>
            {([['Maxila', 'maxila'], ['Mandíbula', 'mandibula'], ['Arcada sup.', 'arc_sup'], ['Arcada inf.', 'arc_inf'], ['Arcadas', 'todos']] as const).map(([l, g]) => (
              <button key={g} type="button" onClick={() => selGrupo(g)} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, cursor: 'pointer', border: `0.5px solid ${TOK.line}`, background: '#fff', color: TOK.esp }}>{l}</button>
            ))}
            {selecionados.size > 0 && <span style={{ fontSize: 11, color: TOK.gold, fontWeight: 700 }}>{selecionados.size} selecionado(s) · <button type="button" onClick={() => setSelecionados(new Set())} style={{ background: 'none', border: 'none', color: TOK.red, cursor: 'pointer', fontWeight: 700 }}>limpar</button></span>}
          </div>

          <Odontograma deciduos={deciduos} onToggleDecidua={setDeciduos} cor={corDaFace} selecionados={selecionados} onFace={onFace} onNum={onNum} />

          {/* legenda */}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: TOK.mut }}>
            {[['Pendente', TOK.amber], ['Finalizado', TOK.green], ['Ausente', TOK.gray], ['Cárie/fratura', '#F3C7C0'], ['Restaurado/canal', '#CFE0F0']].map(([l, c]) => (
              <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: c, border: `0.5px solid ${TOK.line}` }} />{l}</span>
            ))}
          </div>

          {/* Adicionar tratamento com valor */}
          <CardOdonto>
            <div style={{ fontSize: 12, fontWeight: 800, color: TOK.esp, marginBottom: 10 }}>Adicionar tratamento</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <label style={lbl}>Procedimento
                <select value={fProc} onChange={(e) => { setFProc(e.target.value); setFValor('') }} style={inp}>
                  <option value="">Escolha…</option>
                  {procs.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.valor && p.valor > 0 ? ` · ${brl(p.valor)}` : ' · sem preço'}</option>)}
                </select>
              </label>
              <label style={lbl}>Dente {selecionados.size > 0 ? `(${selecionados.size} selec.)` : ''}
                <input value={fDente} onChange={(e) => setFDente(e.target.value)} placeholder="ex.: 36 ou região" style={inp} disabled={selecionados.size > 0} />
              </label>
              <label style={lbl}>Face
                <select value={fFace} onChange={(e) => setFFace(e.target.value as Face | '')} style={inp}>
                  <option value="">—</option>
                  {FACES.map((f) => <option key={f} value={f}>{FACE_LABEL[f]}</option>)}
                </select>
              </label>
              <label style={lbl}>Valor (R$) {procSel && (!procSel.valor || procSel.valor <= 0) && <span style={{ color: TOK.gold }}>· definir preço</span>}
                <input value={fValor} onChange={(e) => setFValor(e.target.value.replace(/[^\d.,]/g, ''))} inputMode="decimal" placeholder="0,00" style={{ ...inp, borderColor: procSel && (!procSel.valor || procSel.valor <= 0) ? TOK.gold : TOK.line }} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" onClick={() => void adicionar()} disabled={busy}
                style={{ background: TOK.gold, color: '#fff', border: 'none', borderRadius: TOK.rCtrl, padding: '10px 18px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>+ Adicionar ao plano</button>
              {procSel && (!procSel.valor || procSel.valor <= 0) && parseVal(fValor) > 0 && (
                <button type="button" onClick={() => void salvarPrecoPadrao()} style={{ background: 'none', color: TOK.gold, border: `0.5px solid ${TOK.gold}`, borderRadius: TOK.rCtrl, padding: '9px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>💡 salvar como preço padrão</button>
              )}
            </div>
          </CardOdonto>

          {/* Lista de tratamentos + total + aprovar */}
          <CardOdonto>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: TOK.esp }}>Plano de tratamento</div>
              <label style={{ fontSize: 11, color: TOK.mut, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={mostrarFinalizados} onChange={(e) => setMostrarFinalizados(e.target.checked)} /> Mostrar finalizados
              </label>
            </div>
            {itensVisiveis.length === 0 ? (
              <div style={{ fontSize: 13, color: TOK.mut, padding: '12px 0' }}>{'Nenhum tratamento no plano ainda. Clique num dente ou use "Adicionar tratamento".'}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {itensVisiveis.map((it) => {
                  const ix = itens.indexOf(it)
                  const cor = procs.find((p) => p.id === it.procedimento_id)?.cor ?? TOK.gold
                  const stCor = it.status === 'concluido' ? TOK.green : it.status === 'aprovado' ? TOK.gold : TOK.mut
                  return (
                    <div key={it.id ?? ix} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `0.5px solid ${TOK.line}` }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: cor, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: TOK.esp }}>{it.descricao}</div>
                        <div style={{ fontSize: 11, color: TOK.mut }}>{it.dente ? `Dente ${it.dente}` : 'sem dente'}{it.faces ? ` · ${it.faces}` : ''} · <span style={{ color: stCor, fontWeight: 700 }}>{it.status ?? 'proposto'}</span></div>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: TOK.esp, fontVariantNumeric: 'tabular-nums' }}>{brl(it.valor)}</div>
                      {it.status !== 'concluido' && it.id && (
                        <button type="button" onClick={() => void concluirItem(it)} disabled={busy} title="Concluir (executado)" style={{ fontSize: 11, fontWeight: 700, color: TOK.green, background: '#E7F3EA', border: 'none', borderRadius: TOK.rCtrl, padding: '5px 10px', cursor: 'pointer' }}>✓ concluir</button>
                      )}
                      {it.status !== 'concluido' && it.status !== 'aprovado' && (
                        <button type="button" onClick={() => void removerItem(ix)} disabled={busy} style={{ fontSize: 13, color: TOK.red, background: 'none', border: 'none', cursor: 'pointer' }}>🗑️</button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 13, color: TOK.mut }}>{totalAprovado > 0 && <>Aprovado {brl(totalAprovado)} · </>}Total <strong style={{ color: TOK.esp, fontSize: 16 }}>{brl(total)}</strong></div>
              <button type="button" onClick={() => setAprovarAberto(true)} disabled={!planoId || total <= 0 || busy}
                style={{ background: (!planoId || total <= 0) ? TOK.line : TOK.green, color: '#fff', border: 'none', borderRadius: TOK.rCtrl, padding: '10px 20px', fontSize: 13, fontWeight: 800, cursor: (!planoId || total <= 0) ? 'not-allowed' : 'pointer' }}>Aprovar plano → gerar títulos</button>
            </div>
          </CardOdonto>
        </div>
      )}

      {aprovarAberto && planoId && (
        <AprovarModal planoId={planoId} total={total} onClose={() => setAprovarAberto(false)}
          onAprovado={(r) => { setAprovarAberto(false); flash(true, `Plano aprovado · ${r.titulos} título(s) · ${brl(r.valor)}`); if (pac) void recarregarClinico(pac) }} />
      )}
    </ShellOdonto>
  )
}

const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: TOK.mut, fontWeight: 600 }
const inp: React.CSSProperties = { padding: '9px 10px', border: `0.5px solid ${TOK.line}`, borderRadius: TOK.rCtrl, fontSize: 13, color: TOK.esp, background: '#fff', outline: 'none' }

function AprovarModal({ planoId, total, onClose, onAprovado }: {
  planoId: string; total: number; onClose: () => void; onAprovado: (r: { titulos: number; valor: number }) => void
}) {
  const [parcelas, setParcelas] = useState('1')
  const [entrada, setEntrada] = useState('')
  const [venc, setVenc] = useState('')
  const [forma, setForma] = useState('boleto')
  // 1º vencimento default = hoje + 7 dias (em effect: Date.now() é impuro em render)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVenc(new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10))
  }, [])
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const parse = (s: string) => { const n = Number(s.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }

  const aprovar = async () => {
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_odonto_plano_aprovar_financeiro', {
      p_id: planoId, p_aprovado_por: 'Paciente', p_itens_ids: null,
      p_parcelas: Math.max(1, parseInt(parcelas || '1', 10)), p_entrada: parse(entrada),
      p_primeira_venc: venc || null, p_forma: forma,
    })
    setBusy(false)
    const r = data as { ok?: boolean; titulos?: number; valor?: number; aviso?: string } | null
    if (error || !r?.ok) { setErro(error?.message || 'Falha ao aprovar'); return }
    if ((r.titulos ?? 0) === 0) { setErro(r.aviso === 'plano sem valor' ? 'Plano sem valor — defina preços antes de aprovar.' : 'Nenhum título gerado.'); return }
    onAprovado({ titulos: r.titulos ?? 0, valor: r.valor ?? 0 })
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: TOK.rCard, padding: 20, width: '100%', maxWidth: 420, border: `0.5px solid ${TOK.line}` }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: TOK.esp, marginBottom: 4 }}>Aprovar plano</div>
        <div style={{ fontSize: 13, color: TOK.mut, marginBottom: 14 }}>Total {brl(total)} → gera títulos reais em Contas a Receber (GE).</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={lbl}>Parcelas<input value={parcelas} onChange={(e) => setParcelas(e.target.value.replace(/\D/g, ''))} inputMode="numeric" style={inp} /></label>
          <label style={lbl}>Entrada (R$)<input value={entrada} onChange={(e) => setEntrada(e.target.value.replace(/[^\d.,]/g, ''))} inputMode="decimal" placeholder="0,00" style={inp} /></label>
          <label style={lbl}>1º vencimento<input type="date" value={venc} onChange={(e) => setVenc(e.target.value)} style={inp} /></label>
          <label style={lbl}>Forma
            <select value={forma} onChange={(e) => setForma(e.target.value)} style={inp}>
              {['boleto', 'pix', 'cartao', 'dinheiro'].map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
        </div>
        {erro && <div style={{ background: '#FBEBEB', color: TOK.red, padding: '8px 10px', borderRadius: TOK.rCtrl, fontSize: 12, fontWeight: 600, marginTop: 10 }}>{erro}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" onClick={onClose} style={{ background: 'none', border: `0.5px solid ${TOK.line}`, borderRadius: TOK.rCtrl, padding: '9px 14px', fontSize: 13, fontWeight: 600, color: TOK.mut, cursor: 'pointer' }}>Cancelar</button>
          <button type="button" onClick={() => void aprovar()} disabled={busy} style={{ background: TOK.green, color: '#fff', border: 'none', borderRadius: TOK.rCtrl, padding: '9px 18px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>{busy ? 'Aprovando…' : 'Aprovar e gerar'}</button>
        </div>
      </div>
    </div>
  )
}
