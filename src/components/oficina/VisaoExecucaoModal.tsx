'use client'

// RD-41 · Visão de EXECUÇÃO (papel Auxiliar = CLIENT_OPERATOR). Mobile/tablet-first.
// Só o necessário pra executar: diagnóstico (leitura) · peças + marcar trocada ·
// solicitar nova peça · apontar hora · registro fotográfico (foto + descrição).
// 🚫 ZERO R$ aqui (Pilar 2 — a defesa real é no backend; a tela só não pede/mostra valor).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { X, Play, Square, Wrench, Package, Image as ImageIcon, Plus } from 'lucide-react'
import SolicitarPecaModal from './SolicitarPecaModal'
import FotosOS from './FotosOS'   // #135 item 6 · fotos em lote

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.55)'
const OK = '#166534', RED = '#A32D2D', AMBER = '#B45309'

type OSResumo = { numero?: string | number | null; placa?: string | null; marca?: string | null; modelo?: string | null; cliente_nome?: string | null }
type DiagItem = { tipo: string; descricao: string; tempo_estimado_h?: number | string | null; severidade?: string; observacao?: string | null }
type Peca = { id: string; descricao: string | null; quantidade: number | null; status: string; foto_path: string | null }
type Apont = { id: string; status: string; tempo_real_h: number | null; iniciado_em: string | null } | null
type ItemAp = { item_id: string; descricao: string; tempo_estimado_h: number | null; severidade: string; apontamento: Apont }

const SEV_COR: Record<string, string> = { critico: RED, recomendado: AMBER, futuro: ESP60 }
const STATUS_PECA: Record<string, { l: string; c: string }> = {
  solicitado: { l: 'Solicitada', c: AMBER }, aprovado: { l: 'Aprovada', c: OK }, comprado: { l: 'Comprada', c: OK },
  recusado: { l: 'Recusada', c: RED }, trocada: { l: 'Trocada ✓', c: OK },
}

function fmtH(h: number | null | undefined): string {
  if (h == null) return '—'
  const n = Number(h)
  return n < 1 ? `${Math.round(n * 60)}min` : `${n.toFixed(n % 1 === 0 ? 0 : 1)}h`
}

export default function VisaoExecucaoModal({ companyId, osId, osResumo, mecanicoNome, aberto, onFechar }: {
  companyId: string; osId: string; osResumo: OSResumo; mecanicoNome?: string | null
  aberto: boolean; onFechar: () => void
}) {
  const [diag, setDiag] = useState<{ texto: string; itens: DiagItem[] }>({ texto: '', itens: [] })
  const [pecas, setPecas] = useState<Peca[]>([])
  const [apont, setApont] = useState<ItemAp[]>([])
  const [mecanico, setMecanico] = useState(mecanicoNome ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [solicitarAberto, setSolicitarAberto] = useState(false)

  const carregar = useCallback(async () => {
    if (!companyId || !osId) return
    const [d, p, a] = await Promise.all([
      supabase.rpc('fn_oficina_diagnostico_obter', { p_company_id: companyId, p_os_id: osId }),
      supabase.rpc('fn_oficina_peca_solicitacoes_listar', { p_company_id: companyId, p_os_id: osId }),
      supabase.rpc('fn_oficina_apontamento_obter', { p_company_id: companyId, p_os_id: osId }),
    ])
    const dd = d.data as { os?: { diagnostico?: string }; itens?: DiagItem[] } | null
    setDiag({ texto: dd?.os?.diagnostico ?? '', itens: dd?.itens ?? [] })
    setPecas((p.data as Peca[]) ?? [])
    setApont(((a.data as { itens?: ItemAp[] } | null)?.itens) ?? [])
  }, [companyId, osId])

  useEffect(() => { if (aberto) void carregar() }, [aberto, carregar])
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 3500); return () => clearTimeout(t) }, [msg])

  const marcarTrocada = async (pc: Peca) => {
    setBusy(pc.id)
    const { data, error } = await supabase.rpc('fn_oficina_peca_marcar_trocada', { p_company_id: companyId, p_solicitacao_id: pc.id })
    setBusy(null)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setMsg('❌ ' + (error?.message || j?.erro || 'falha')); return }
    setMsg('✅ Peça marcada como trocada.'); void carregar()
  }

  const iniciar = async (it: ItemAp) => {
    setBusy(it.item_id)
    const { data, error } = await supabase.rpc('fn_oficina_apontamento_iniciar', {
      p_company_id: companyId, p_os_id: osId, p_item_id: it.item_id, p_mecanico_nome: mecanico || null,
    })
    setBusy(null)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || j?.ok === false) { setMsg('❌ ' + (error?.message || j?.erro)); return }
    void carregar()
  }
  const concluir = async (it: ItemAp) => {
    if (!it.apontamento) return
    setBusy(it.item_id)
    const { data, error } = await supabase.rpc('fn_oficina_apontamento_concluir', {
      p_company_id: companyId, p_apontamento_id: it.apontamento.id, p_tempo_real_h: null, p_mecanico_nome: mecanico || null, p_observacao: null,
    })
    setBusy(null)
    const j = data as { ok?: boolean; erro?: string; tempo_real_h?: number } | null
    if (error || j?.ok === false) { setMsg('❌ ' + (error?.message || j?.erro)); return }
    setMsg(`✅ ${fmtH(j?.tempo_real_h)} registradas.`); void carregar()
  }

  if (!aberto) return null
  const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', fontSize: 14, borderRadius: 10, border: `1px solid ${LINE}`, background: '#fff', color: ESP, boxSizing: 'border-box' }
  const secTit: React.CSSProperties = { fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: GOLD, display: 'flex', alignItems: 'center', gap: 6, margin: '18px 0 8px' }
  const veic = [osResumo.marca, osResumo.modelo].filter(Boolean).join(' ')

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onFechar() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.45)', zIndex: 120, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: BG, borderRadius: '16px 16px 0 0', padding: 16, width: '100%', maxWidth: 560, maxHeight: '94vh', overflowY: 'auto' }}>
        {/* header (sem R$) */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>🔧 Execução da OS {osResumo.numero ?? ''}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: ESP, marginTop: 2 }}>{osResumo.placa ?? 'Sem placa'}</div>
            <div style={{ fontSize: 13, color: ESP60 }}>{[veic, osResumo.cliente_nome].filter(Boolean).join(' · ') || '—'}</div>
          </div>
          <button onClick={onFechar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: ESP60 }}><X size={22} /></button>
        </div>

        {/* mecânico (assina apontamento/registro) */}
        <input value={mecanico} onChange={(e) => setMecanico(e.target.value)} placeholder="Seu nome (mecânico/auxiliar)" style={{ ...inp, marginTop: 12 }} />

        {/* DIAGNÓSTICO (leitura) */}
        <div style={secTit}><Wrench size={14} /> Diagnóstico (o que fazer)</div>
        {diag.texto && <div style={{ fontSize: 13, color: ESP, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px', whiteSpace: 'pre-wrap' }}>{diag.texto}</div>}
        {diag.itens.length === 0 ? (
          <div style={{ fontSize: 13, color: ESP60, marginTop: 6 }}>Sem itens no laudo ainda.</div>
        ) : (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {diag.itens.map((it, i) => (
              <div key={i} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 12px', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 14, color: ESP }}>{it.tipo === 'peca' ? '🔩 ' : '🛠️ '}{it.descricao}</div>
                  {it.observacao && <div style={{ fontSize: 12, color: ESP60 }}>{it.observacao}</div>}
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: SEV_COR[it.severidade ?? ''] ?? ESP60 }}>{(it.severidade ?? '').toUpperCase()}</span>
                  {it.tempo_estimado_h != null && it.tempo_estimado_h !== '' && <div style={{ fontSize: 11, color: ESP60 }}>{fmtH(Number(it.tempo_estimado_h))}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* PEÇAS a trocar */}
        <div style={secTit}><Package size={14} /> Peças</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {pecas.length === 0 && <div style={{ fontSize: 13, color: ESP60 }}>Nenhuma peça solicitada.</div>}
          {pecas.map((pc) => {
            const st = STATUS_PECA[pc.status] ?? { l: pc.status, c: ESP60 }
            return (
              <div key={pc.id} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 14, color: ESP }}>{pc.descricao ?? '—'}{pc.quantidade ? ` · ${Number(pc.quantidade)}x` : ''}</div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: st.c }}>{st.l}</span>
                </div>
                {pc.status !== 'trocada' && (
                  <button onClick={() => void marcarTrocada(pc)} disabled={busy === pc.id}
                    style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: BG, color: ESP, fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {busy === pc.id ? '…' : '✓ Trocada'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <button onClick={() => setSolicitarAberto(true)}
          style={{ marginTop: 8, width: '100%', padding: '10px', borderRadius: 10, border: `1px dashed ${GOLD}`, background: '#fff', color: ESP, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Plus size={15} /> Solicitar nova peça
        </button>

        {/* APONTAR HORA */}
        <div style={secTit}><Play size={14} /> Apontar hora</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {apont.length === 0 && <div style={{ fontSize: 13, color: ESP60 }}>Sem serviços aprovados pra apontar.</div>}
          {apont.map((it) => {
            const emAndamento = it.apontamento && it.apontamento.status !== 'concluido'
            const concluido = it.apontamento && it.apontamento.status === 'concluido'
            return (
              <div key={it.item_id} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 14, color: ESP }}>{it.descricao}</div>
                  <div style={{ fontSize: 11, color: ESP60 }}>previsto {fmtH(it.tempo_estimado_h)}{concluido ? ` · real ${fmtH(it.apontamento?.tempo_real_h)}` : ''}</div>
                </div>
                {concluido ? (
                  <span style={{ fontSize: 12, fontWeight: 700, color: OK }}>✓ feito</span>
                ) : emAndamento ? (
                  <button onClick={() => void concluir(it)} disabled={busy === it.item_id}
                    style={{ padding: '8px 12px', borderRadius: 8, border: 'none', background: ESP, color: BG, fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Square size={13} /> Concluir
                  </button>
                ) : (
                  <button onClick={() => void iniciar(it)} disabled={busy === it.item_id}
                    style={{ padding: '8px 12px', borderRadius: 8, border: 'none', background: GOLD, color: '#1A1410', fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Play size={13} /> Iniciar
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* REGISTRO FOTOGRÁFICO (foto + descrição) */}
        <div style={secTit}><ImageIcon size={14} /> Registro fotográfico</div>
        {/* #135 item 6 · várias fotos de uma vez, cada uma já ligada à OS; legenda opcional na miniatura */}
        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 12 }}>
          <FotosOS companyId={companyId} osId={osId} etapa="servico" criadoPorNome={mecanico || null} podeExcluir={false}
            chaveEnviar="oficina.patio.fotos_enviar" chaveLegenda="oficina.patio.foto_legenda" rotaAjuda="/dashboard/oficina/patio" testId="execucao-fotos" />
        </div>

        {msg && <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: msg.startsWith('❌') ? '#FCEBEB' : '#EAF3DE', color: msg.startsWith('❌') ? '#791F1F' : OK, fontSize: 13 }}>{msg}</div>}

        <button onClick={onFechar} style={{ marginTop: 14, width: '100%', padding: '12px', borderRadius: 10, border: `1px solid ${LINE}`, background: '#fff', color: ESP, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Fechar</button>
      </div>

      <SolicitarPecaModal companyId={companyId} osId={osId} mecanicoNome={mecanico} aberto={solicitarAberto}
        onFechar={() => setSolicitarAberto(false)} onEnviada={() => { setSolicitarAberto(false); void carregar() }} />
    </div>
  )
}
