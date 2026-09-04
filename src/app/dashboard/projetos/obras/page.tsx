'use client'

// O4.1 · Obras — board de andamento. A obra NASCE do orçamento aprovado/convertido (trigger no banco).
// Tudo vem de fn_obras_kpis / fn_obras_listar por company_id (RD-38: nada fixo). 3 estados: erro / vazio
// (ensina) / dados. Linguagem da casa (CONCLUIU obra) · identidade Espresso · mobile-first.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import PSGCMetric from '@/components/psgc/PSGCMetric'
import { fmtR } from '@/lib/psgc-tokens'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', AMBAR = '#B45309', VERM = '#B91C1C'

type Obra = {
  id: string; numero: string; nome: string; cliente_nome: string | null; status: string
  valor_previsto: number; pct_conclusao: number; cidade: string | null; uf: string | null
  responsavel_nome: string | null; data_inicio: string | null; data_prevista_fim: string | null; data_conclusao: string | null
}
type Kpis = { em_andamento: number; concluidas: number; valor_em_andamento: number; valor_concluido: number }

const ST: Record<string, { label: string; cor: string }> = {
  em_andamento: { label: 'Em andamento', cor: GOLD },
  pausada: { label: 'Pausada', cor: AMBAR },
  concluida: { label: 'Concluída', cor: VERDE },
  cancelada: { label: 'Cancelada', cor: VERM },
}
const PROXIMOS: Record<string, { s: string; l: string }[]> = {
  em_andamento: [{ s: 'concluida', l: 'Concluir' }, { s: 'pausada', l: 'Pausar' }, { s: 'cancelada', l: 'Cancelar' }],
  pausada: [{ s: 'em_andamento', l: 'Retomar' }, { s: 'cancelada', l: 'Cancelar' }],
  concluida: [{ s: 'em_andamento', l: 'Reabrir' }],
  cancelada: [{ s: 'em_andamento', l: 'Reabrir' }],
}

export default function ObrasPage() {
  const { companyIds } = useCompanyIds()
  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [obras, setObras] = useState<Obra[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [aba, setAba] = useState<'principais' | 'outras'>('principais')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [obraAberta, setObraAberta] = useState<Obra | null>(null)
  const [obraFiscal, setObraFiscal] = useState<Obra | null>(null)

  const carregar = useCallback(async () => {
    if (!companyIds?.length) { setLoading(false); return }
    setLoading(true); setErro('')
    const [{ data: k, error: ek }, { data: l, error: el }] = await Promise.all([
      supabase.rpc('fn_obras_kpis', { p_company_ids: companyIds }),
      supabase.rpc('fn_obras_listar', { p_company_ids: companyIds, p_status: null }),
    ])
    setLoading(false)
    if (ek || el) { setErro((ek ?? el)!.message); return }
    setKpis(k as Kpis); setObras((l as Obra[]) ?? [])
  }, [companyIds])

  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  async function mudarStatus(o: Obra, novo: string) {
    setBusy(o.id); setMsg('')
    const { error } = await supabase.rpc('fn_obra_mudar_status', { p_obra_id: o.id, p_novo_status: novo })
    setBusy('')
    if (error) { setMsg('Erro: ' + error.message); return }
    setMsg(novo === 'concluida' ? `CONCLUIU a obra ${o.numero}.` : `Obra ${o.numero} → ${ST[novo]?.label ?? novo}.`)
    void carregar()
  }

  const grupos = useMemo(() => ({
    em_andamento: obras.filter((o) => o.status === 'em_andamento'),
    concluida: obras.filter((o) => o.status === 'concluida'),
    pausada: obras.filter((o) => o.status === 'pausada'),
    cancelada: obras.filter((o) => o.status === 'cancelada'),
  }), [obras])

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 18px' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>Hub · Construção</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: ESP, margin: '2px 0 14px' }}>Obras</h1>

        {msg && <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12.5, marginBottom: 12, background: msg.startsWith('Erro') ? '#FBEAEA' : '#EAF5EE', color: msg.startsWith('Erro') ? VERM : VERDE, border: `0.5px solid ${LINE}` }}>{msg}</div>}

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, marginBottom: 16 }}>
          <PSGCMetric label="Em andamento" valor={kpis?.em_andamento ?? 0} icon="🏗️" cor={GOLD} corBg="#FFF" />
          <PSGCMetric label="Concluídas" valor={kpis?.concluidas ?? 0} icon="✅" cor={VERDE} corBg="#FFF" />
          <PSGCMetric label="Valor em andamento" valor={fmtR(kpis?.valor_em_andamento ?? 0)} icon="💰" cor={ESP} corBg="#FFF" />
          <PSGCMetric label="Valor concluído" valor={fmtR(kpis?.valor_concluido ?? 0)} icon="🏁" cor={VERDE} corBg="#FFF" />
        </div>

        {/* ESTADO: erro */}
        {erro ? (
          <Aviso cor={VERM} titulo="Não deu para carregar as obras" texto={erro} />
        ) : loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div>
        ) : obras.length === 0 ? (
          /* ESTADO: vazio (ensina) */
          <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 34 }}>🏗️</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: ESP, marginTop: 6 }}>Nenhuma obra ainda</div>
            <div style={{ fontSize: 13, color: MUT, maxWidth: 440, margin: '8px auto 0', lineHeight: 1.5 }}>
              Uma obra nasce automaticamente quando um orçamento é <b>aprovado</b>. Aprove um orçamento em Propostas para ver a obra aqui.
            </div>
            <Link href="/dashboard/projetos/propostas" style={{ display: 'inline-block', marginTop: 14, padding: '9px 16px', borderRadius: 8, background: ESP, color: '#FFF', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>Ir para Propostas</Link>
          </div>
        ) : (
          /* ESTADO: dados */
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <Tab ativo={aba === 'principais'} onClick={() => setAba('principais')}>Em andamento · Concluídas</Tab>
              {(grupos.pausada.length + grupos.cancelada.length > 0) && (
                <Tab ativo={aba === 'outras'} onClick={() => setAba('outras')}>Pausadas · Canceladas ({grupos.pausada.length + grupos.cancelada.length})</Tab>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 14, alignItems: 'start' }}>
              {aba === 'principais' ? (
                <>
                  <Coluna titulo="Em andamento" cor={GOLD} obras={grupos.em_andamento} onStatus={mudarStatus} busy={busy} onAbrir={setObraAberta} onFiscal={setObraFiscal} />
                  <Coluna titulo="Concluídas" cor={VERDE} obras={grupos.concluida} onStatus={mudarStatus} busy={busy} onAbrir={setObraAberta} onFiscal={setObraFiscal} />
                </>
              ) : (
                <>
                  <Coluna titulo="Pausadas" cor={AMBAR} obras={grupos.pausada} onStatus={mudarStatus} busy={busy} onAbrir={setObraAberta} onFiscal={setObraFiscal} />
                  <Coluna titulo="Canceladas" cor={VERM} obras={grupos.cancelada} onStatus={mudarStatus} busy={busy} onAbrir={setObraAberta} onFiscal={setObraFiscal} />
                </>
              )}
            </div>
          </>
        )}
      </div>
      {obraAberta && <EscopoModal obra={obraAberta} onClose={() => setObraAberta(null)} onChanged={() => void carregar()} />}
      {obraFiscal && <FiscalObraModal obra={obraFiscal} onClose={() => setObraFiscal(null)} onSaved={() => void carregar()} />}
    </div>
  )
}

function Coluna({ titulo, cor, obras, onStatus, busy, onAbrir, onFiscal }: { titulo: string; cor: string; obras: Obra[]; onStatus: (o: Obra, s: string) => void; busy: string; onAbrir: (o: Obra) => void; onFiscal: (o: Obra) => void }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: cor, fontWeight: 700, marginBottom: 8 }}>{titulo} · {obras.length}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {obras.length === 0 ? <div style={{ fontSize: 12, color: MUT, fontStyle: 'italic' }}>—</div> :
          obras.map((o) => <ObraCard key={o.id} o={o} onStatus={onStatus} busy={busy === o.id} onAbrir={onAbrir} onFiscal={onFiscal} />)}
      </div>
    </div>
  )
}

function ObraCard({ o, onStatus, busy, onAbrir, onFiscal }: { o: Obra; onStatus: (o: Obra, s: string) => void; busy: boolean; onAbrir: (o: Obra) => void; onFiscal: (o: Obra) => void }) {
  const st = ST[o.status] ?? { label: o.status, cor: MUT }
  const local = [o.cidade, o.uf].filter(Boolean).join('/')
  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderLeft: `4px solid ${st.cor}`, borderRadius: 12, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: st.cor, fontFamily: 'monospace' }}>{o.numero}</span>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: ESP }}>{fmtR(o.valor_previsto)}</span>
      </div>
      <div style={{ fontSize: 13.5, color: ESP, fontWeight: 600, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.nome}</div>
      <div style={{ fontSize: 11.5, color: MUT, marginTop: 1 }}>{o.cliente_nome || 'Cliente não informado'}{local ? ` · ${local}` : ''}</div>

      <div style={{ marginTop: 8 }}>
        <div style={{ background: BG, borderRadius: 6, height: 8, overflow: 'hidden' }}>
          <div style={{ width: `${o.pct_conclusao}%`, height: '100%', background: st.cor, opacity: 0.85 }} />
        </div>
        <div style={{ fontSize: 10.5, color: MUT, marginTop: 2, display: 'flex', justifyContent: 'space-between' }}>
          <span>{o.pct_conclusao}% concluído</span>
          <span>{o.responsavel_nome || 'sem responsável'}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <button onClick={() => onAbrir(o)} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${GOLD}`, background: '#FBF4E4', color: '#A57A15' }}>
          Ver escopo
        </button>
        <Link href={`/dashboard/projetos/obras/${o.id}/linha-do-tempo?area=hub`} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: `1px solid ${LINE}`, background: '#fff', color: ESP, textDecoration: 'none' }}>
          Linha do tempo
        </Link>
        <button onClick={() => onFiscal(o)} title="CNO e endereço para a NFS-e de construção (E0370)" style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${LINE}`, background: '#fff', color: ESP }}>
          🧾 Dados fiscais
        </button>
        {(PROXIMOS[o.status] ?? []).map((p) => (
          <button key={p.s} onClick={() => onStatus(o, p.s)} disabled={busy}
            style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, cursor: busy ? 'default' : 'pointer', border: `1px solid ${LINE}`, background: p.s === 'concluida' ? '#EAF5EE' : '#FFF', color: p.s === 'cancelada' ? VERM : ESP, opacity: busy ? 0.5 : 1 }}>
            {p.l}
          </button>
        ))}
      </div>
    </div>
  )
}

function Tab({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${ativo ? GOLD : LINE}`, background: ativo ? '#FBF4E4' : '#FFF', color: ativo ? '#A57A15' : MUT }}>{children}</button>
}
function Aviso({ cor, titulo, texto }: { cor: string; titulo: string; texto: string }) {
  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderLeft: `4px solid ${cor}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: ESP }}>{titulo}</div>
      <div style={{ fontSize: 12.5, color: MUT, marginTop: 4 }}>{texto}</div>
    </div>
  )
}

// ── F2 · Escopo congelado da obra (fn_obra_escopo + adicionar/excluir item) ──
type EscItem = { id: string; ordem: number; descricao: string; unidade: string; quantidade_contratada: number; quantidade_medida: number; quantidade_a_medir: number; pct_medido: number; preco_unitario: number; valor_contratado: number; valor_medido: number }
type Escopo = { ok: boolean; erro?: string; obra_numero?: string; centro_custo?: { codigo: string | null; nome: string | null } | null; itens: EscItem[]; total_itens: number; valor_contratado: number; valor_medido: number; valor_a_medir: number; pct_fisico: number }

function EscopoModal({ obra, onClose, onChanged }: { obra: Obra; onClose: () => void; onChanged: () => void }) {
  const [esc, setEsc] = useState<Escopo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [addAberto, setAddAberto] = useState(false)
  const [form, setForm] = useState({ descricao: '', unidade: 'un', quantidade: '', preco_unit: '' })
  const [busy, setBusy] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_escopo', { p_obra_id: obra.id })
    setCarregando(false)
    if (error) { setErro(error.message); return }
    const j = data as Escopo
    if (!j?.ok) { setErro(j?.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : (j?.erro ?? 'Falha ao carregar o escopo.')); return }
    setEsc(j)
  }, [obra.id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  async function adicionar() {
    if (!form.descricao.trim()) { setErro('Informe a descrição do item.'); return }
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_item_adicionar', {
      p_obra_id: obra.id, p_descricao: form.descricao.trim(), p_unidade: form.unidade.trim() || 'un',
      p_quantidade: Number(form.quantidade.replace(',', '.')) || 0, p_preco_unit: Number(form.preco_unit.replace(',', '.')) || 0,
    })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string; mensagem?: string } | null
    if (error || !j?.ok) { setErro(j?.mensagem ?? error?.message ?? j?.erro ?? 'Falha ao adicionar o item.'); return }
    setForm({ descricao: '', unidade: 'un', quantidade: '', preco_unit: '' }); setAddAberto(false)
    await carregar(); onChanged()
  }

  async function excluir(it: EscItem) {
    if (typeof window !== 'undefined' && !window.confirm(`Remover "${it.descricao}" do escopo?`)) return
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_item_excluir', { p_item_id: it.id, p_motivo: 'removido pela tela de obras' })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string; mensagem?: string } | null
    if (error || !j?.ok) { setErro(j?.mensagem ?? error?.message ?? j?.erro ?? 'Falha ao remover o item.'); return }
    await carregar(); onChanged()
  }

  const inp: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, padding: '7px 9px', fontSize: 12.5, color: ESP, background: '#fff' }
  const ccCod = esc?.centro_custo?.codigo ?? obra.numero
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 12px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: BG, borderRadius: 14, width: '100%', maxWidth: 900 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: ESP, borderRadius: '14px 14px 0 0', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ color: GOLD, fontWeight: 700, fontSize: 15 }}>{obra.numero} · Escopo da obra</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ padding: 16 }}>
          {/* Cabeçalho: contratado · medido (%) · a medir · centro de custo */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 12 }}>
            <MiniKpi label="Contratado" valor={fmtR(esc?.valor_contratado ?? 0)} cor={ESP} />
            <MiniKpi label={`Medido (${esc?.pct_fisico ?? 0}%)`} valor={fmtR(esc?.valor_medido ?? 0)} cor={VERDE} />
            <MiniKpi label="A medir" valor={fmtR(esc?.valor_a_medir ?? 0)} cor={GOLD} />
            <MiniKpi label="Centro de custo" valor={ccCod ?? '—'} cor={ESP} />
          </div>

          {erro && <div style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: '8px 10px', fontSize: 12, marginBottom: 10 }}>{erro}</div>}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: ESP }}>Itens do escopo {esc ? `(${esc.total_itens})` : ''}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setAddAberto((v) => !v)} disabled={busy} style={{ fontSize: 11.5, fontWeight: 700, padding: '6px 12px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${GOLD}`, color: '#A57A15', background: '#FBF4E4' }}>+ Adicionar item</button>
              <button disabled title="Disponível na próxima entrega" style={{ fontSize: 11.5, fontWeight: 700, padding: '6px 12px', borderRadius: 8, cursor: 'not-allowed', border: `1px solid ${LINE}`, color: MUT, background: '#F2ECE2' }}>Nova medição</button>
            </div>
          </div>

          {addAberto && (
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.7fr 0.9fr 1fr auto', gap: 8, alignItems: 'center', marginBottom: 12, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 10 }}>
              <input style={inp} placeholder="Descrição do item *" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
              <input style={inp} placeholder="un" value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })} />
              <input style={{ ...inp, textAlign: 'right' }} inputMode="decimal" placeholder="qtd" value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: e.target.value })} />
              <input style={{ ...inp, textAlign: 'right' }} inputMode="decimal" placeholder="R$/un" value={form.preco_unit} onChange={(e) => setForm({ ...form, preco_unit: e.target.value })} />
              <button onClick={() => void adicionar()} disabled={busy || !form.descricao.trim()} style={{ fontSize: 12, fontWeight: 700, padding: '7px 12px', borderRadius: 8, cursor: 'pointer', border: 'none', color: '#fff', background: GOLD, opacity: (busy || !form.descricao.trim()) ? 0.5 : 1 }}>{busy ? '…' : 'Adicionar'}</button>
            </div>
          )}

          {carregando ? <div style={{ padding: 24, textAlign: 'center', color: MUT, fontSize: 13 }}>Carregando escopo…</div>
            : (esc?.itens.length ?? 0) === 0 ? (
              <div style={{ background: '#fff', border: `1px dashed ${LINE}`, borderRadius: 12, padding: 24, textAlign: 'center' }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: ESP }}>Esta obra não tem itens de escopo</div>
                <div style={{ fontSize: 12.5, color: MUT, marginTop: 6, maxWidth: 460, marginInline: 'auto' }}>Foi criada antes do escopo por item. Adicione os itens manualmente para acompanhar o avanço.</div>
                <button onClick={() => setAddAberto(true)} style={{ marginTop: 12, fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 8, cursor: 'pointer', border: 'none', color: '#fff', background: GOLD }}>+ Adicionar item</button>
              </div>
            ) : (
              <div style={{ overflowX: 'auto', border: `1px solid ${LINE}`, borderRadius: 10, background: '#fff' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead><tr style={{ background: BG, color: MUT, textAlign: 'left' }}>
                    <th style={th}>#</th><th style={th}>Descrição</th><th style={th}>Un</th>
                    <th style={thR}>Contratado</th><th style={thR}>Medido</th><th style={thR}>%</th><th style={thR}>A medir</th><th style={thR}>Valor contratado</th><th style={th}></th>
                  </tr></thead>
                  <tbody>
                    {esc!.itens.map((it) => (
                      <tr key={it.id} style={{ borderTop: `1px solid ${LINE}` }}>
                        <td style={td}>{it.ordem}</td>
                        <td style={{ ...td, color: ESP }}>{it.descricao}</td>
                        <td style={td}>{it.unidade}</td>
                        <td style={tdR}>{it.quantidade_contratada}</td>
                        <td style={tdR}>{it.quantidade_medida}</td>
                        <td style={tdR}>{it.pct_medido}%</td>
                        <td style={tdR}>{it.quantidade_a_medir}</td>
                        <td style={{ ...tdR, fontWeight: 600, color: ESP }}>{fmtR(it.valor_contratado)}</td>
                        <td style={{ ...td, textAlign: 'center' }}>
                          <button onClick={() => void excluir(it)} disabled={busy || it.quantidade_medida > 0}
                            title={it.quantidade_medida > 0 ? 'Item já medido — não pode ser removido' : 'Remover do escopo'}
                            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: `1px solid ${LINE}`, background: '#fff', color: it.quantidade_medida > 0 ? MUT : VERM, cursor: (busy || it.quantidade_medida > 0) ? 'not-allowed' : 'pointer', opacity: it.quantidade_medida > 0 ? 0.5 : 1 }}>excluir</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </div>
    </div>
  )
}
// #18 · Dados fiscais da obra (CNO/endereço) — o que a NFS-e de construção precisa (E0370). A nota
// aponta pra obra; corrigir aqui corrige a próxima nota. CNO OU código municipal basta.
function FiscalObraModal({ obra, onClose, onSaved }: { obra: Obra; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ endereco: '', numero_endereco: '', bairro: '', cidade: '', uf: '', cep: '', codigo_ibge_municipio: '', cno: '', art: '', codigo_obra_municipal: '' })
  const [carregando, setCarregando] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void supabase.rpc('fn_obra_fiscal_obter', { p_obra_id: obra.id }).then(({ data }) => {
      if (!alive) return
      const r = data as Record<string, string | null> | null
      if (r?.ok) setF((p) => ({ ...p,
        endereco: r.endereco ?? '', numero_endereco: r.numero_endereco ?? '', bairro: r.bairro ?? '',
        cidade: r.cidade ?? '', uf: r.uf ?? '', cep: r.cep ?? '', codigo_ibge_municipio: r.codigo_ibge_municipio ?? '',
        cno: r.cno ?? '', art: r.art ?? '', codigo_obra_municipal: r.codigo_obra_municipal ?? '' }))
      setCarregando(false)
    })
    return () => { alive = false }
  }, [obra.id]) // eslint-disable-line react-hooks/set-state-in-effect
  const temId = !!(f.cno.trim() || f.codigo_obra_municipal.trim())
  const endOk = !!(f.endereco.trim() && f.cep.trim() && f.codigo_ibge_municipio.trim())
  async function salvar() {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('fn_obra_salvar_fiscal', {
      p_obra_id: obra.id, p_endereco: f.endereco, p_numero_endereco: f.numero_endereco, p_bairro: f.bairro,
      p_cidade: f.cidade, p_uf: f.uf, p_cep: f.cep, p_codigo_ibge_municipio: f.codigo_ibge_municipio,
      p_cno: f.cno, p_art: f.art, p_codigo_obra_municipal: f.codigo_obra_municipal,
    })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setMsg('Erro: ' + (j?.erro ?? error?.message ?? 'falha ao salvar')); return }
    onSaved(); onClose()
  }
  const inp: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 12.5, color: ESP, background: '#fff', width: '100%', boxSizing: 'border-box' }
  const lbl: React.CSSProperties = { fontSize: 10.5, color: MUT, fontWeight: 600, display: 'block', marginBottom: 3 }
  const campo = (label: string, k: keyof typeof f, ph = '') => (
    <label style={{ display: 'block' }}><span style={lbl}>{label}</span>
      <input style={inp} value={f[k]} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  )
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 12px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: BG, borderRadius: 14, width: '100%', maxWidth: 640 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: ESP, borderRadius: '14px 14px 0 0' }}>
          <div style={{ color: GOLD, fontWeight: 700, fontSize: 15 }}>{obra.numero} · Dados fiscais da obra</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: MUT, marginBottom: 12, lineHeight: 1.5 }}>
            Estes dados vão na <b>NFS-e de construção</b> (exigência E0370 do Fisco). A nota aponta para a obra — corrigir aqui corrige a próxima nota. <b>CNO ou código de obra municipal</b> é obrigatório.
          </div>
          {carregando ? <div style={{ padding: 20, textAlign: 'center', color: MUT }}>Carregando…</div> : (
            <>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: GOLD, fontWeight: 700, marginBottom: 8 }}>Identificação da obra</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, marginBottom: 14 }}>
                {campo('CNO (Cadastro Nacional de Obras)', 'cno', 'ex.: 12.345.67890/12')}
                {campo('Código de obra municipal (se o município usar)', 'codigo_obra_municipal')}
                {campo('ART / RRT (opcional)', 'art')}
              </div>
              {!temId && <div style={{ fontSize: 11.5, color: '#B45309', marginBottom: 12 }}>⚠️ Falta o CNO ou o código municipal — sem um dos dois a nota de construção não sai.</div>}
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: GOLD, fontWeight: 700, marginBottom: 8 }}>Endereço da obra</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 6 }}>
                {campo('Logradouro', 'endereco')}
                {campo('Número', 'numero_endereco')}
                {campo('Bairro', 'bairro')}
                {campo('Cidade', 'cidade')}
                {campo('UF', 'uf', 'PR')}
                {campo('CEP', 'cep')}
                {campo('Código IBGE do município', 'codigo_ibge_municipio', 'ex.: 4127700')}
              </div>
              {!endOk && <div style={{ fontSize: 11.5, color: '#B45309', margin: '8px 0 0' }}>⚠️ Logradouro, CEP e código IBGE são exigidos pelo leiaute da NFS-e nacional.</div>}
              {msg && <div style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: '8px 10px', fontSize: 12, marginTop: 12 }}>{msg}</div>}
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: ESP, fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
                <button onClick={() => void salvar()} disabled={busy} style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: GOLD, color: '#fff', fontWeight: 700, fontSize: 13, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Salvando…' : 'Salvar dados fiscais'}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
function MiniKpi({ label, valor, cor }: { label: string; valor: string; cor: string }) {
  return (
    <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 10, padding: '9px 11px' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: cor }}>{valor}</div>
      <div style={{ fontSize: 10.5, color: MUT, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
    </div>
  )
}
const th: React.CSSProperties = { padding: '7px 9px', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' }
const thR: React.CSSProperties = { ...th, textAlign: 'right' }
const td: React.CSSProperties = { padding: '6px 9px' }
const tdR: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
