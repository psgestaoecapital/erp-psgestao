'use client'

// Revenda de Veículos · R4b — Venda e entrega (Tela 10).
// Passo a passo faturada → checklist → termo → entregue. Entrega passa pelo checklist (obrigatórios).
// "cliente deve / banco deve" = EM ABERTO da fonte única (v_veic_venda ← erp_receber, RD-65).
// Venda entregue: "Registrar devolução" (motivo obrigatório) no lugar de "Cancelar". Paleta PS.

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC',
}
const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none' }
const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brDate = (d: string) => d ? String(d).slice(0, 10).split('-').reverse().join('/') : ''
const SIT = ['aberta', 'faturada', 'entregue', 'devolvida', 'cancelada']

type Venda = {
  id: string; veiculo_id: string; chassi: string; modelo: string | null; placa: string | null; cliente_nome: string | null
  data_venda: string; valor_venda: number | null; desconto_embutido_troca: number | null
  valor_entrada: number | null; valor_financiado: number | null; banco_nome: string | null; retorno_banco: number | null
  situacao: string; total_cliente: number; total_banco: number; vendedor_nome: string | null
  nfe_autorizada: boolean; is_demo: boolean
  em_aberto_cliente: number; em_aberto_banco: number; recebido: number
  tem_checklist: boolean; checklist_ok: boolean; tem_termo: boolean; termo_assinado: boolean
  km_entrega: number | null; devolvido_em: string | null; devolucao_motivo: string | null
}
type ChkItem = { id: string; item: string; obrigatorio: boolean; feito: boolean }
type Acerto = {
  previsto: { preco_venda: number | null; custo_real_total: number | null; lucro_projetado: number | null }
  realizado: { recebido: number; em_aberto: number; em_aberto_cliente: number; em_aberto_banco: number; custos_pos_venda: number; lucro_real: number | null }
}

export default function VendasPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const router = useRouter()
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [rows, setRows] = useState<Venda[]>([])
  const [filtro, setFiltro] = useState('todos')
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // modais
  const [chkVenda, setChkVenda] = useState<Venda | null>(null)
  const [chkItens, setChkItens] = useState<ChkItem[]>([])
  const [chkKm, setChkKm] = useState('')
  const [termoVenda, setTermoVenda] = useState<Venda | null>(null)
  const [termoMd, setTermoMd] = useState('')
  const [assinaNome, setAssinaNome] = useState('')
  const [acertoVenda, setAcertoVenda] = useState<Venda | null>(null)
  const [acerto, setAcerto] = useState<Acerto | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) { setRows([]); return }
    const { data, error } = await supabase.from('v_veic_venda').select('*').eq('company_id', companyId).order('data_venda', { ascending: false })
    if (error) { setErro(error.message); return }
    setRows((data as Venda[]) ?? [])
  }, [companyId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const visiveis = useMemo(() => filtro === 'todos' ? rows : rows.filter((r) => r.situacao === filtro), [rows, filtro])
  async function userId() { const { data: { session } } = await supabase.auth.getSession(); return session?.user?.id ?? null }

  // ── Entrega: abre o checklist ──────────────────────────────────────────────────────────────
  async function abrirChecklist(v: Venda) {
    setErro(null); setBusy(true)
    const { data, error } = await supabase.rpc('fn_veic_venda_checklist_materializar', { p_venda_id: v.id, p_user: await userId() })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string; itens?: ChkItem[] } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha ao abrir checklist'); return }
    setChkVenda(v); setChkItens(r.itens ?? []); setChkKm(v.km_entrega ? String(v.km_entrega) : '')
  }
  async function marcarItem(it: ChkItem, feito: boolean) {
    setChkItens((xs) => xs.map((x) => x.id === it.id ? { ...x, feito } : x))
    const { data } = await supabase.rpc('fn_veic_checklist_marcar', { p_item_id: it.id, p_feito: feito, p_user: await userId(), p_obs: null })
    const r = data as { ok?: boolean } | null
    if (!r?.ok) { setChkItens((xs) => xs.map((x) => x.id === it.id ? { ...x, feito: !feito } : x)) }
  }
  async function concluirEntrega() {
    if (!chkVenda) return
    setErro(null); setBusy(true)
    const km = chkKm.trim() ? Number(chkKm.replace(/\D/g, '')) : null
    const { data, error } = await supabase.rpc('fn_veic_venda_entregar', { p_venda_id: chkVenda.id, p_user: await userId(), p_obs: null, p_forcar: false, p_km_entrega: km })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string; faltando?: string[]; mensagem?: string } | null
    if (error || !r?.ok) {
      if (r?.erro === 'checklist_incompleto') setErro(`Faltam itens obrigatórios: ${(r.faltando ?? []).join(' · ')}`)
      else setErro(error?.message || r?.mensagem || r?.erro || 'Falha ao entregar')
      return
    }
    setMsg('Veículo entregue.'); setChkVenda(null); void carregar()
  }

  // ── Termo ──────────────────────────────────────────────────────────────────────────────────
  async function abrirTermo(v: Venda) {
    setErro(null); setBusy(true)
    const { data, error } = await supabase.rpc('fn_veic_termo_entrega', { p_venda_id: v.id })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string; termo_md?: string } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha ao gerar termo'); return }
    setTermoVenda(v); setTermoMd(r.termo_md ?? ''); setAssinaNome(v.cliente_nome ?? ''); void carregar()
  }
  async function assinarTermo() {
    if (!termoVenda) return
    if (!assinaNome.trim()) { setErro('Informe o nome de quem recebe.'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_veic_termo_assinar', { p_venda_id: termoVenda.id, p_nome: assinaNome.trim(), p_ip: null, p_user: await userId() })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha no aceite'); return }
    setMsg('Aceite registrado.'); setTermoVenda(null); void carregar()
  }

  // ── Acerto de contas ─────────────────────────────────────────────────────────────────────────
  async function abrirAcerto(v: Venda) {
    setErro(null); setBusy(true)
    const { data, error } = await supabase.rpc('fn_veic_venda_acerto', { p_venda_id: v.id })
    setBusy(false)
    const r = data as ({ ok?: boolean; erro?: string } & Acerto) | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha no acerto'); return }
    setAcertoVenda(v); setAcerto({ previsto: r.previsto, realizado: r.realizado })
  }

  // ── Devolução / cancelamento ───────────────────────────────────────────────────────────────
  async function devolver(v: Venda) {
    const motivo = window.prompt('Motivo da devolução (obrigatório):')
    if (motivo == null) return
    if (!motivo.trim()) { setErro('A devolução exige um motivo.'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_veic_venda_devolver', { p_venda_id: v.id, p_motivo: motivo.trim(), p_data: null, p_user: await userId() })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string; titulos_a_estornar?: string[] } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha na devolução'); return }
    const n = (r.titulos_a_estornar ?? []).length
    setMsg(`Devolução registrada. Veículo volta ao pátio. ${n} título(s) marcado(s) a estornar (evento enviado ao financeiro).`)
    void carregar()
  }
  async function cancelar(v: Venda) {
    const motivo = window.prompt('Motivo do cancelamento:') ?? ''
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_veic_venda_cancelar', { p_venda_id: v.id, p_user: await userId(), p_motivo: motivo || null })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string; mensagem?: string; titulos_nao_excluidos?: number } | null
    if (error || !r?.ok) { setErro(error?.message || r?.mensagem || r?.erro || 'Falha'); return }
    setMsg('Venda cancelada.'); void carregar()
  }

  if (!companyId) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa específica no topo.</div>

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 1120, margin: '0 auto', color: C.esp }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>🚗 Comércio · Revenda</div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Vendas e entrega</h1>
      <p style={{ color: C.espM, fontSize: 13, margin: '6px 0 14px' }}>Cada venda tem um passo a passo até a entrega: fatura → checklist → termo → entregue. &quot;Cliente deve&quot; e &quot;banco deve&quot; são o que está <b>em aberto</b> (o que já foi pago não conta). A entrega exige o checklist dos itens obrigatórios.</p>

      {msg && <div style={{ background: C.greenBg, color: C.green, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12, cursor: 'pointer' }} onClick={() => setMsg(null)}>{msg}</div>}
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12, cursor: 'pointer' }} onClick={() => setErro(null)}>{erro}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: C.espM }}>Situação&nbsp;
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={inp}>
            <option value="todos">todas</option>
            {SIT.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 12, color: C.espM }}>{visiveis.length} venda(s)</span>
      </div>

      {visiveis.length === 0 ? (
        <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '30px 16px', textAlign: 'center', color: C.espM }}>Nenhuma venda registrada. Registre a venda pela ficha do veículo.</div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {visiveis.map((v) => {
            const entregue = v.situacao === 'entregue'
            const encerrada = entregue || v.situacao === 'cancelada' || v.situacao === 'devolvida'
            return (
              <div key={v.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{v.modelo || '—'} <span style={{ fontWeight: 400, color: C.espM, fontFamily: 'monospace', fontSize: 12 }}>· {v.placa || v.chassi.slice(-6)}</span></div>
                    <div style={{ fontSize: 13, color: C.espM }}>{v.cliente_nome || '—'} · {brDate(v.data_venda)}{v.vendedor_nome ? ` · vend. ${v.vendedor_nome}` : ''}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.gold }}>{brl(v.valor_venda ?? 0)}</div>
                    <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: entregue ? C.greenBg : v.situacao === 'cancelada' ? C.redBg : v.situacao === 'devolvida' ? C.amberBg : C.cream, color: entregue ? C.green : v.situacao === 'cancelada' ? C.red : v.situacao === 'devolvida' ? C.amber : C.gold, fontWeight: 700 }}>{v.situacao}</span>
                  </div>
                </div>

                {/* passo a passo */}
                <Passos v={v} />

                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: C.espM, marginTop: 8 }}>
                  <span>cliente deve <b style={{ color: v.em_aberto_cliente > 0 ? C.esp : C.green }}>{brl(v.em_aberto_cliente)}</b></span>
                  <span>banco deve <b style={{ color: v.em_aberto_banco > 0 ? C.esp : C.green }}>{brl(v.em_aberto_banco)}</b></span>
                  {v.recebido > 0 ? <span>recebido <b style={{ color: C.green }}>{brl(v.recebido)}</b></span> : null}
                  {v.retorno_banco ? <span>retorno banco {brl(v.retorno_banco)}</span> : null}
                  {v.desconto_embutido_troca ? <span style={{ color: C.amber }} title="valor de troca − valor de avaliação">desconto embutido na troca {brl(v.desconto_embutido_troca)}</span> : null}
                </div>

                {v.situacao === 'devolvida' && v.devolucao_motivo ? (
                  <div style={{ marginTop: 8, fontSize: 12, color: C.amber, background: C.amberBg, borderRadius: 8, padding: '6px 10px' }}>Devolvida{v.devolvido_em ? ` em ${brDate(v.devolvido_em)}` : ''}: {v.devolucao_motivo}</div>
                ) : null}

                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button onClick={() => router.push(`/dashboard/revenda/veiculo/${v.veiculo_id}`)} style={btnGhost}>ver veículo</button>

                  {/* Entregar (via checklist) — R0.2/R0.2b travas de NF mantidas na função */}
                  {!encerrada && (
                    v.nfe_autorizada || (v.is_demo && v.situacao === 'faturada')
                      ? <button disabled={busy} onClick={() => void abrirChecklist(v)} style={btnGold}>Entregar</button>
                      : <span style={{ padding: '6px 12px', borderRadius: 8, background: C.amberBg, color: '#8A4B08', fontSize: 11.5, fontWeight: 600 }}>Emitir nota antes de entregar</span>
                  )}
                  {v.is_demo && !encerrada && (v.nfe_autorizada ? null : <span style={{ padding: '3px 8px', borderRadius: 999, background: C.amberBg, color: '#8A4B08', fontSize: 10.5, fontWeight: 700, alignSelf: 'center' }} title="Empresa de demonstração — sem emissão fiscal real">Demonstração — sem nota fiscal real</span>)}

                  {/* Termo — após entregue (ou já com termo) */}
                  {(entregue || v.tem_termo) && <button disabled={busy} onClick={() => void abrirTermo(v)} style={btnGhost}>{v.tem_termo ? (v.termo_assinado ? 'Ver termo (assinado)' : 'Ver/assinar termo') : 'Gerar termo'}</button>}

                  {/* Acerto de contas — venda concluída */}
                  {entregue && <button disabled={busy} onClick={() => void abrirAcerto(v)} style={btnGhost}>Acerto de contas</button>}

                  {/* Devolução (entregue) no lugar de Cancelar */}
                  {entregue
                    ? <button disabled={busy} onClick={() => void devolver(v)} style={btnDanger}>Registrar devolução</button>
                    : (!encerrada && <button disabled={busy} onClick={() => void cancelar(v)} style={btnDanger}>Cancelar</button>)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Modal checklist ── */}
      {chkVenda && (
        <Modal onClose={() => setChkVenda(null)} titulo={`Entrega — ${chkVenda.modelo || ''} ${chkVenda.placa || ''}`}>
          <p style={{ fontSize: 12.5, color: C.espM, margin: '0 0 10px' }}>Marque os itens conferidos. Os <b>obrigatórios</b> precisam estar marcados para concluir a entrega.</p>
          <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
            {chkItens.map((it) => (
              <label key={it.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 10px', border: `1px solid ${C.border}`, borderRadius: 8, background: it.feito ? C.greenBg : C.white, cursor: 'pointer', fontSize: 13.5 }}>
                <input type="checkbox" checked={it.feito} onChange={(e) => void marcarItem(it, e.target.checked)} style={{ width: 18, height: 18, accentColor: C.gold }} />
                <span style={{ flex: 1 }}>{it.item}</span>
                {it.obrigatorio ? <span style={{ fontSize: 10, color: C.amber, fontWeight: 700 }}>obrigatório</span> : <span style={{ fontSize: 10, color: C.espL }}>opcional</span>}
              </label>
            ))}
          </div>
          <label style={{ display: 'block', fontSize: 12, color: C.espM, marginBottom: 12 }}>KM na entrega
            <input value={chkKm} onChange={(e) => setChkKm(e.target.value)} inputMode="numeric" placeholder="ex.: 71000" style={{ ...inp, display: 'block', width: '100%', marginTop: 4 }} />
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setChkVenda(null)} style={btnGhost}>fechar</button>
            <button disabled={busy} onClick={() => void concluirEntrega()} style={btnGold}>Concluir entrega</button>
          </div>
        </Modal>
      )}

      {/* ── Modal termo ── */}
      {termoVenda && (
        <Modal onClose={() => setTermoVenda(null)} titulo="Termo de entrega">
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, background: C.cream, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, maxHeight: 340, overflow: 'auto', color: C.esp }}>{termoMd}</pre>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
            <label style={{ fontSize: 12, color: C.espM, flex: 1, minWidth: 180 }}>Aceite — nome de quem recebe
              <input value={assinaNome} onChange={(e) => setAssinaNome(e.target.value)} disabled={termoVenda.termo_assinado} style={{ ...inp, display: 'block', width: '100%', marginTop: 4 }} />
            </label>
            <button onClick={() => window.print()} style={btnGhost}>Imprimir / PDF</button>
            {!termoVenda.termo_assinado && <button disabled={busy} onClick={() => void assinarTermo()} style={btnGold}>Registrar aceite</button>}
          </div>
          {termoVenda.termo_assinado && <div style={{ marginTop: 8, fontSize: 12, color: C.green }}>✓ Aceite já registrado.</div>}
        </Modal>
      )}

      {/* ── Modal acerto ── */}
      {acertoVenda && acerto && (
        <Modal onClose={() => { setAcertoVenda(null); setAcerto(null) }} titulo={`Acerto de contas — ${acertoVenda.modelo || ''}`}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ background: C.cream, borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.espM, fontWeight: 700, marginBottom: 6 }}>Previsto</div>
              <Linha k="Preço de venda" v={acerto.previsto.preco_venda} />
              <Linha k="Custo real" v={acerto.previsto.custo_real_total} />
              <Linha k="Lucro projetado" v={acerto.previsto.lucro_projetado} destaque />
            </div>
            <div style={{ background: C.cream, borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.espM, fontWeight: 700, marginBottom: 6 }}>Realizado</div>
              <Linha k="Recebido" v={acerto.realizado.recebido} />
              <Linha k="Em aberto — cliente" v={acerto.realizado.em_aberto_cliente} />
              <Linha k="Em aberto — banco" v={acerto.realizado.em_aberto_banco} />
              <Linha k="Custos após a venda" v={acerto.realizado.custos_pos_venda} />
              <Linha k="Lucro real" v={acerto.realizado.lucro_real} destaque />
            </div>
          </div>
          <p style={{ fontSize: 12, color: C.espM, marginTop: 10 }}>A diferença entre previsto e realizado é o que ainda está em aberto (títulos a receber do cliente e do banco) mais os custos lançados depois da venda.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}><button onClick={() => { setAcertoVenda(null); setAcerto(null) }} style={btnGhost}>fechar</button></div>
        </Modal>
      )}
    </div>
  )
}

function Passos({ v }: { v: Venda }) {
  const entregue = v.situacao === 'entregue'
  const passos: { nome: string; feito: boolean; atual: boolean }[] = [
    { nome: 'Faturada', feito: ['faturada', 'entregue', 'devolvida'].includes(v.situacao) || v.nfe_autorizada, atual: v.situacao === 'aberta' },
    { nome: 'Checklist', feito: v.tem_checklist && v.checklist_ok && (entregue || v.tem_checklist), atual: !entregue && (!v.tem_checklist || !v.checklist_ok) },
    { nome: 'Termo', feito: v.tem_termo, atual: entregue && !v.tem_termo },
    { nome: 'Entregue', feito: entregue, atual: false },
  ]
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
      {passos.map((p, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
          background: p.feito ? C.greenBg : p.atual ? C.amberBg : C.cream,
          color: p.feito ? C.green : p.atual ? C.amber : C.espL }}>
          <span>{p.feito ? '✓' : p.atual ? '•' : '○'}</span>{p.nome}
        </span>
      ))}
    </div>
  )
}

function Linha({ k, v, destaque }: { k: string; v: number | null; destaque?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0', borderTop: destaque ? `1px solid ${C.border}` : 'none', marginTop: destaque ? 4 : 0, fontWeight: destaque ? 700 : 400 }}>
      <span style={{ color: C.espM }}>{k}</span>
      <span style={{ color: v == null ? C.espL : (destaque && (v ?? 0) < 0 ? C.red : C.esp) }}>{v == null ? 'não configurado' : brl(v)}</span>
    </div>
  )
}

function Modal({ titulo, children, onClose }: { titulo: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50, padding: '0' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.white, width: '100%', maxWidth: 560, borderRadius: '16px 16px 0 0', padding: 18, maxHeight: '88vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{titulo}</div>
          <button onClick={onClose} style={{ ...btnGhost, padding: '4px 10px' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

const btnGold: React.CSSProperties = { padding: '8px 14px', border: 'none', borderRadius: 8, background: C.gold, color: C.white, fontWeight: 700, cursor: 'pointer', fontSize: 12.5 }
const btnGhost: React.CSSProperties = { padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.gold, cursor: 'pointer', fontSize: 12.5 }
const btnDanger: React.CSSProperties = { padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.red, cursor: 'pointer', fontSize: 12.5 }
