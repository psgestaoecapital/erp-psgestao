'use client'
// OD-7 · Trajetória do paciente (diferencial PS): jornada do tratamento em ETAPAS (1ª/2ª/3ª...), com
// procedimentos feito/pendente/próximo, progresso geral e edição pela clínica. Reusa erp_odonto_plano_item
// (status/concluido_em) e fn_odonto_item_concluir; etapas em erp_odonto_plano_fase (RPCs deste OD-7).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CardOdonto, EmptyStateOdonto, TOK } from './ui'
import { CheckCircle2, Circle, ArrowRightCircle, ChevronUp, ChevronDown, Trash2, Plus } from 'lucide-react'

type Plano = { id: string; titulo: string | null; status: string; valor_total: number | null }
type Fase = { id: string; nome: string; ordem: number; observacao: string | null; proximos_passos: string | null; status: string }
type Item = { id: string; fase_id: string | null; descricao: string; dente: string | null; valor: number; status: string; concluido_em: string | null; ordem: number }

const brl = (v: number | null | undefined) => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const feito = (s: string) => s === 'concluido'

const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: `0.5px solid ${TOK.line}`, borderRadius: 8, fontSize: 13, color: TOK.esp, background: '#fff', boxSizing: 'border-box' }
const btnGold: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: TOK.gold, color: '#fff', border: 'none', borderRadius: TOK.rCtrl, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const btnLine: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: TOK.esp, border: `0.5px solid ${TOK.line}`, borderRadius: TOK.rCtrl, padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
const iconBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: TOK.mut, padding: 2, display: 'inline-flex' }

export function TrajetoriaFicha({ companyId, pacienteId }: { companyId: string; pacienteId: string }) {
  const [planos, setPlanos] = useState<Plano[]>([])
  const [planoId, setPlanoId] = useState('')
  const [fases, setFases] = useState<Fase[]>([])
  const [itens, setItens] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [nova, setNova] = useState('')
  const [edit, setEdit] = useState<{ id: string; nome: string; observacao: string; proximos: string } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(null), 3000) }

  const carregarPlanos = useCallback(async () => {
    const { data } = await supabase.rpc('fn_odonto_planos_paciente', { p_company_id: companyId, p_paciente_id: pacienteId })
    const ps = (data as Plano[] | null) ?? []
    setPlanos(ps)
    setPlanoId((prev) => prev || ps[0]?.id || '')
    if (!ps.length) setLoading(false)
  }, [companyId, pacienteId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregarPlanos() }, [carregarPlanos])

  const carregarFases = useCallback(async () => {
    if (!planoId) return
    const { data } = await supabase.rpc('fn_odonto_fase_plano', { p_company_id: companyId, p_plano_id: planoId })
    const r = data as { fases?: Fase[]; itens?: Item[] } | null
    setFases((r?.fases ?? []).slice().sort((a, b) => a.ordem - b.ordem)); setItens(r?.itens ?? []); setLoading(false)
  }, [companyId, planoId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregarFases() }, [carregarFases])

  const itensDaFase = useCallback((fid: string | null) => itens.filter((i) => (i.fase_id ?? null) === fid && i.status !== 'cancelado'), [itens])
  const statusFase = (fid: string): { l: string; cor: string; bg: string } => {
    const its = itensDaFase(fid)
    if (its.length && its.every((i) => feito(i.status))) return { l: 'Concluída', cor: TOK.green, bg: '#E7F3EA' }
    if (its.some((i) => feito(i.status))) return { l: 'Em andamento', cor: TOK.amber, bg: '#FBF0DF' }
    return { l: 'Pendente', cor: TOK.gray, bg: '#F1F1F0' }
  }
  const validos = useMemo(() => itens.filter((i) => i.status !== 'cancelado'), [itens])
  const concluidos = validos.filter((i) => feito(i.status)).length
  const pct = validos.length ? Math.round((concluidos / validos.length) * 100) : 0
  const proximoId = useMemo(() => {
    const ordered = [...fases].flatMap((f) => itensDaFase(f.id)).concat(itensDaFase(null))
    return ordered.find((i) => !feito(i.status))?.id ?? null
  }, [fases, itensDaFase])

  const novaEtapa = async () => {
    if (!nova.trim() || !planoId) return
    const { data, error } = await supabase.rpc('fn_odonto_fase_salvar', { p_company_id: companyId, p_fase: { plano_id: planoId, nome: nova.trim() } })
    if (error || (data as { ok?: boolean })?.ok === false) { flash('Falha ao criar etapa.'); return }
    setNova(''); void carregarFases()
  }
  const salvarEdit = async () => {
    if (!edit) return
    const { data, error } = await supabase.rpc('fn_odonto_fase_salvar', { p_company_id: companyId, p_fase: { plano_id: planoId, nome: edit.nome, observacao: edit.observacao, proximos_passos: edit.proximos }, p_fase_id: edit.id })
    if (error || (data as { ok?: boolean })?.ok === false) { flash('Falha ao salvar etapa.'); return }
    setEdit(null); void carregarFases()
  }
  const excluir = async (f: Fase) => {
    if (!confirm(`Excluir a etapa "${f.nome}"? Os procedimentos voltam a ficar sem etapa (não são apagados).`)) return
    await supabase.rpc('fn_odonto_fase_excluir', { p_company_id: companyId, p_fase_id: f.id }); void carregarFases()
  }
  const reordenar = async (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= fases.length) return
    const a = fases[i], b = fases[j]
    await Promise.all([
      supabase.rpc('fn_odonto_fase_salvar', { p_company_id: companyId, p_fase: { plano_id: planoId, nome: a.nome, ordem: b.ordem }, p_fase_id: a.id }),
      supabase.rpc('fn_odonto_fase_salvar', { p_company_id: companyId, p_fase: { plano_id: planoId, nome: b.nome, ordem: a.ordem }, p_fase_id: b.id }),
    ])
    void carregarFases()
  }
  const moverItem = async (itemId: string, faseId: string | null) => {
    await supabase.rpc('fn_odonto_item_mover_fase', { p_company_id: companyId, p_item_id: itemId, p_fase_id: faseId }); void carregarFases()
  }
  const concluir = async (item: Item) => {
    const { data, error } = await supabase.rpc('fn_odonto_item_concluir', { p_item_id: item.id, p_baixar: false, p_data: null, p_conta_bancaria_id: null, p_forma: 'PIX' })
    if (error || (data as { ok?: boolean })?.ok === false) { flash('Falha ao concluir.'); return }
    flash('Procedimento concluído.'); void carregarFases()
  }

  if (loading) return <div style={{ color: TOK.mut, fontSize: 13 }}>Carregando trajetória…</div>
  if (!planos.length) return <EmptyStateOdonto titulo="Sem plano ainda" linha="Monte o plano de tratamento na aba Tratamentos — a trajetória organiza os procedimentos em etapas." />

  const semEtapa = itensDaFase(null)

  const ItemRow = ({ i }: { i: Item }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: `0.5px solid ${TOK.line}` }}>
      {feito(i.status) ? <CheckCircle2 size={16} style={{ color: TOK.green, flexShrink: 0 }} />
        : i.id === proximoId ? <ArrowRightCircle size={16} style={{ color: TOK.gold, flexShrink: 0 }} />
        : <Circle size={16} style={{ color: TOK.gray, flexShrink: 0 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: TOK.esp, textDecoration: feito(i.status) ? 'line-through' : 'none' }}>{i.descricao}{i.dente ? ` · dente ${i.dente}` : ''}</div>
        <div style={{ fontSize: 11, color: TOK.mut }}>{brl(i.valor)}{feito(i.status) && i.concluido_em ? ` · feito ${new Date(i.concluido_em).toLocaleDateString('pt-BR')}` : i.id === proximoId ? ' · próximo' : ' · pendente'}</div>
      </div>
      <select value={i.fase_id ?? ''} onChange={(e) => void moverItem(i.id, e.target.value || null)} style={{ ...inp, width: 'auto', padding: '4px 6px', fontSize: 11 }} title="Mover para etapa">
        <option value="">— sem etapa —</option>
        {fases.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
      </select>
      {!feito(i.status) && <button onClick={() => void concluir(i)} style={{ ...btnLine, padding: '4px 8px', color: TOK.green }}>✓ concluir</button>}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* seletor de plano + progresso */}
      <CardOdonto style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          {planos.length > 1
            ? <select value={planoId} onChange={(e) => { setPlanoId(e.target.value); setLoading(true) }} style={{ ...inp, width: 'auto' }}>{planos.map((p) => <option key={p.id} value={p.id}>{p.titulo || 'Plano'} · {p.status}</option>)}</select>
            : <div style={{ fontSize: 14, fontWeight: 700, color: TOK.esp }}>{planos[0]?.titulo || 'Plano de tratamento'}</div>}
          <div style={{ fontSize: 12.5, color: TOK.mut }}>{concluidos}/{validos.length} concluídos · <strong style={{ color: TOK.esp }}>{pct}%</strong></div>
        </div>
        <div style={{ height: 8, borderRadius: 999, background: TOK.line, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? TOK.green : TOK.gold, transition: 'width .3s' }} />
        </div>
      </CardOdonto>

      {msg && <div style={{ fontSize: 12.5, color: TOK.green, fontWeight: 600 }}>{msg}</div>}

      {/* timeline de etapas */}
      {fases.map((f, idx) => {
        const S = statusFase(f.id); const emEdicao = edit?.id === f.id
        return (
          <CardOdonto key={f.id} style={{ padding: 14, borderLeft: `3px solid ${S.cor}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ width: 26, height: 26, borderRadius: 999, background: TOK.goldSoft, color: TOK.gold, fontSize: 12, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{idx + 1}</span>
                {emEdicao
                  ? <input value={edit.nome} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} style={{ ...inp, width: 200 }} />
                  : <span style={{ fontSize: 14, fontWeight: 700, color: TOK.esp }}>{f.nome}</span>}
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: S.bg, color: S.cor }}>{S.l}</span>
              </div>
              <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                <button onClick={() => void reordenar(idx, -1)} disabled={idx === 0} style={{ ...iconBtn, opacity: idx === 0 ? 0.3 : 1 }} title="Subir"><ChevronUp size={16} /></button>
                <button onClick={() => void reordenar(idx, 1)} disabled={idx === fases.length - 1} style={{ ...iconBtn, opacity: idx === fases.length - 1 ? 0.3 : 1 }} title="Descer"><ChevronDown size={16} /></button>
                {emEdicao
                  ? <><button onClick={() => void salvarEdit()} style={btnGold}>Salvar</button><button onClick={() => setEdit(null)} style={btnLine}>Cancelar</button></>
                  : <button onClick={() => setEdit({ id: f.id, nome: f.nome, observacao: f.observacao ?? '', proximos: f.proximos_passos ?? '' })} style={btnLine}>Editar</button>}
                <button onClick={() => void excluir(f)} style={{ ...iconBtn, color: TOK.red }} title="Excluir etapa"><Trash2 size={15} /></button>
              </div>
            </div>

            <div style={{ marginTop: 8 }}>
              {itensDaFase(f.id).length === 0 ? <div style={{ fontSize: 12.5, color: TOK.mut, padding: '6px 0' }}>Sem procedimentos nesta etapa. Mova um da lista abaixo.</div>
                : itensDaFase(f.id).map((i) => <ItemRow key={i.id} i={i} />)}
            </div>

            {emEdicao ? (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <textarea value={edit.observacao} onChange={(e) => setEdit({ ...edit, observacao: e.target.value })} placeholder="Observação da etapa" rows={2} style={{ ...inp, resize: 'vertical' }} />
                <textarea value={edit.proximos} onChange={(e) => setEdit({ ...edit, proximos: e.target.value })} placeholder="Próximos passos" rows={2} style={{ ...inp, resize: 'vertical' }} />
              </div>
            ) : (f.observacao || f.proximos_passos) && (
              <div style={{ marginTop: 8, fontSize: 12, color: TOK.mut }}>
                {f.observacao && <div><strong>Obs.:</strong> {f.observacao}</div>}
                {f.proximos_passos && <div><strong>Próximos passos:</strong> {f.proximos_passos}</div>}
              </div>
            )}
          </CardOdonto>
        )
      })}

      {/* procedimentos sem etapa */}
      {semEtapa.length > 0 && (
        <CardOdonto style={{ padding: 14, borderLeft: `3px solid ${TOK.line}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: TOK.esp, marginBottom: 4 }}>Sem etapa</div>
          <div style={{ fontSize: 11.5, color: TOK.mut, marginBottom: 4 }}>Mova para uma etapa acima usando o seletor de cada item.</div>
          {semEtapa.map((i) => <ItemRow key={i.id} i={i} />)}
        </CardOdonto>
      )}

      {/* nova etapa */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={nova} onChange={(e) => setNova(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void novaEtapa() }} placeholder='Nova etapa (ex.: "1ª Etapa: Limpeza + Restaurações")' style={inp} />
        <button onClick={() => void novaEtapa()} disabled={!nova.trim()} style={{ ...btnGold, opacity: nova.trim() ? 1 : 0.6 }}><Plus size={15} /> Etapa</button>
      </div>
    </div>
  )
}
