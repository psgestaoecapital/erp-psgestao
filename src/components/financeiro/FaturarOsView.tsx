'use client'
// GE · Fila "Faturar OS" — as OS entregues da oficina que viram contas a receber.
// Fronteira RD-44: a Oficina LISTA; aqui na GE a Jordana FATURA. 3 grupos:
//  • PRONTAS  → faturar (por-OS e em lote com preview + confirmação; RD-53: valida algumas antes do lote)
//  • SEM CLIENTE → precisa vincular cliente antes (a ação vem no próximo PR; aqui só sinaliza)
//  • SEM VALOR → precisa informar o valor no diagnóstico/aprovação (link p/ a OS)
// KGF tem 0 contas bancárias → título sai sem conta (define no recebimento); sem seletor de conta.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { PackageCheck, RefreshCw, CircleDollarSign, UserPlus, FileWarning, ChevronRight, X } from 'lucide-react'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.6)', WHITE = '#FFFFFF', OK = '#166534', WARN = '#B45309', RED = '#A32D2D'
const brl = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))

type Linha = { os_id: string; numero: string | null; cliente_nome: string | null; cliente_id: string | null; placa: string | null; entregue_em: string | null; total: number; dias: number; situacao: 'pronta' | 'sem_cliente' | 'sem_valor' }
type Totais = { qtd: number; soma_total: number; mais_antiga_dias: number; prontas: number; soma_prontas: number; sem_cliente: number; sem_valor: number }
type Pulada = { os_id: string; numero?: string | null; motivo: string }

const MOTIVO_LOTE: Record<string, string> = {
  ja_faturada: 'já tinha título', sem_valor: 'sem valor', sem_cliente: 'sem cliente', fora_da_empresa: 'fora da empresa',
}

export default function FaturarOsView({ companyId }: { companyId: string }) {
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [totais, setTotais] = useState<Totais | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [faturando, setFaturando] = useState<string | null>(null)   // os_id em faturamento (por-OS)
  const [loteLiberado, setLoteLiberado] = useState(false)           // RD-53: só libera o lote após conferir
  const [preview, setPreview] = useState(false)                     // modal de confirmação do lote
  const [emLote, setEmLote] = useState(false)
  const [relatorio, setRelatorio] = useState<{ faturadas: number; valor: number; puladas: Pulada[] } | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_oficina_a_faturar', { p_company_id: companyId })
    setLoading(false)
    const r = data as { ok?: boolean; erro?: string; linhas?: Linha[]; totais?: Totais } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha ao carregar a fila'); return }
    setLinhas(r.linhas ?? []); setTotais(r.totais ?? null)
  }, [companyId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t) }, [msg])

  const prontas = linhas.filter((l) => l.situacao === 'pronta')
  const semCliente = linhas.filter((l) => l.situacao === 'sem_cliente')
  const semValor = linhas.filter((l) => l.situacao === 'sem_valor')

  // faturar UMA OS (RD-53: é o que a Jordana faz primeiro, p/ conferir o título antes do lote)
  const faturarUma = async (os: Linha) => {
    if (faturando) return
    setFaturando(os.os_id)
    const { data, error } = await supabase.rpc('fn_os_faturar', { p_os_id: os.os_id, p_conta_bancaria_id: null })
    setFaturando(null)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setMsg('❌ ' + (error?.message || r?.erro || 'Falha ao faturar')); return }
    setMsg(`✅ OS ${os.numero ?? ''} faturada — título gerado em A Receber.`)
    void carregar()
  }

  // faturar em LOTE todas as prontas (após preview + confirmação)
  const faturarLote = async () => {
    setPreview(false); setEmLote(true)
    const ids = prontas.map((l) => l.os_id)
    const { data, error } = await supabase.rpc('fn_os_faturar_lote', { p_company_id: companyId, p_os_ids: ids, p_conta_bancaria_id: null })
    setEmLote(false)
    const r = data as { ok?: boolean; erro?: string; faturadas?: number; valor_faturado?: number; puladas?: Pulada[] } | null
    if (error || !r?.ok) { setMsg('❌ ' + (error?.message || r?.erro || 'Falha no lote')); return }
    setRelatorio({ faturadas: r.faturadas ?? 0, valor: Number(r.valor_faturado) || 0, puladas: r.puladas ?? [] })
    void carregar()
  }

  if (loading) return <div style={{ padding: 32, color: ESP60, background: BG, minHeight: '100vh' }}>Carregando a fila…</div>

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 14px 44px', maxWidth: 920, margin: '0 auto', color: ESP }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>💰 Financeiro · Gestão Empresarial</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0', display: 'inline-flex', alignItems: 'center', gap: 8 }}><PackageCheck size={22} color={GOLD} /> Faturar OS</h1>
        </div>
        <button onClick={() => void carregar()} title="Atualizar" style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 8, padding: 9, cursor: 'pointer', color: ESP60 }}><RefreshCw size={16} /></button>
      </div>
      <p style={{ color: ESP60, fontSize: 13, marginTop: 6, marginBottom: 14 }}>
        OS entregues pela oficina que viram título (contas a receber). Título sai sem conta — a conta se define no recebimento.
      </p>

      {erro && <div style={{ background: '#FCEBEB', color: '#791F1F', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{erro}</div>}

      {/* Totais */}
      {totais && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 18 }}>
          <Tot l="Prontas p/ faturar" v={String(totais.prontas)} sub={brl(totais.soma_prontas)} cor={OK} />
          <Tot l="Falta vincular cliente" v={String(totais.sem_cliente)} cor={WARN} />
          <Tot l="Falta informar valor" v={String(totais.sem_valor)} cor={ESP60} />
        </div>
      )}

      {/* PRONTAS */}
      <Grupo icon={<CircleDollarSign size={16} color={OK} />} titulo={`Prontas para faturar (${prontas.length})`} cor={OK}>
        {prontas.length === 0 ? <Vazio texto="Nada pronto para faturar agora." /> : (<>
          {/* RD-53 · a Jordana fatura ALGUMAS pela lista e confere em A Receber ANTES de liberar o lote */}
          {prontas.length > 1 && (
            <div style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 10, padding: 12, marginBottom: 10 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontSize: 12.5, color: ESP }}>
                <input type="checkbox" checked={loteLiberado} onChange={(e) => setLoteLiberado(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16 }} />
                <span>Já faturei ao menos uma OS aqui e <b>confiro o título em “A Receber”</b>. Liberar faturar em lote.</span>
              </label>
              <button onClick={() => setPreview(true)} disabled={!loteLiberado || emLote}
                style={{ marginTop: 10, width: '100%', minHeight: 44, borderRadius: 10, border: 'none', fontWeight: 800, fontSize: 14,
                  background: loteLiberado ? GOLD : '#Eee7d8', color: loteLiberado ? '#3D2314' : ESP60, cursor: loteLiberado ? 'pointer' : 'not-allowed' }}>
                {emLote ? 'Faturando…' : `Faturar todas as ${prontas.length} prontas · ${brl(totais?.soma_prontas)}`}
              </button>
            </div>
          )}
          {prontas.map((l) => (
            <LinhaOS key={l.os_id} l={l}
              acao={<button onClick={() => void faturarUma(l)} disabled={!!faturando}
                style={{ minHeight: 38, padding: '0 16px', borderRadius: 8, border: `1px solid ${OK}`, background: faturando === l.os_id ? '#E7F0E9' : OK, color: faturando === l.os_id ? OK : '#fff', fontWeight: 800, fontSize: 13, cursor: faturando ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
                {faturando === l.os_id ? 'Faturando…' : 'Faturar'}
              </button>} />
          ))}
        </>)}
      </Grupo>

      {/* SEM CLIENTE */}
      {semCliente.length > 0 && (
        <Grupo icon={<UserPlus size={16} color={WARN} />} titulo={`Falta vincular cliente (${semCliente.length})`} cor={WARN}>
          <div style={{ fontSize: 12, color: ESP60, marginBottom: 8 }}>Título sem cliente não concilia nem entra na cobrança. Vincule o cliente antes de faturar (em breve, aqui mesmo).</div>
          {semCliente.map((l) => <LinhaOS key={l.os_id} l={l} acao={<span style={{ fontSize: 12, color: WARN, fontWeight: 700, whiteSpace: 'nowrap' }}>vincular cliente</span>} />)}
        </Grupo>
      )}

      {/* SEM VALOR */}
      {semValor.length > 0 && (
        <Grupo icon={<FileWarning size={16} color={ESP60} />} titulo={`Falta informar valor (${semValor.length})`} cor={ESP60}>
          <div style={{ fontSize: 12, color: ESP60, marginBottom: 8 }}>Sem valor no laudo/aprovação — não dá p/ faturar. Abra a OS e informe o valor.</div>
          {semValor.map((l) => (
            <LinhaOS key={l.os_id} l={l}
              acao={<a href={`/dashboard/os?os=${l.os_id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: ESP, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>Abrir OS <ChevronRight size={13} /></a>} />
          ))}
        </Grupo>
      )}

      {linhas.length === 0 && <div style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 12, padding: '30px 16px', textAlign: 'center', color: ESP60 }}>Nada a faturar — tudo que a oficina entregou já virou título. 🎉</div>}

      {/* Preview + confirmação do lote */}
      {preview && (
        <div onClick={() => setPreview(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: WHITE, borderRadius: 14, padding: 20, maxWidth: 440, width: '100%' }}>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 8 }}>Confirmar faturamento em lote</div>
            <div style={{ fontSize: 14, color: ESP, marginBottom: 6 }}>
              Vou gerar título para <b>{prontas.length} OS</b> · total <b>{brl(totais?.soma_prontas)}</b> · <b>sem conta</b> (define no recebimento).
            </div>
            <div style={{ fontSize: 12.5, color: WARN, background: 'rgba(180,83,9,0.06)', border: `1px solid ${WARN}`, borderRadius: 8, padding: '8px 10px', marginBottom: 14 }}>
              Isto gera contas a receber de verdade e não dá pra desfazer em lote. Confira antes.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPreview(false)} style={{ flex: 1, minHeight: 44, borderRadius: 10, border: `1px solid ${LINE}`, background: WHITE, color: ESP, fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={() => void faturarLote()} style={{ flex: 1, minHeight: 44, borderRadius: 10, border: 'none', background: GOLD, color: '#3D2314', fontWeight: 800, cursor: 'pointer' }}>Confirmar e faturar</button>
            </div>
          </div>
        </div>
      )}

      {/* Relatório do lote (o que passou e o que pulou — nunca "deu erro") */}
      {relatorio && (
        <div onClick={() => setRelatorio(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: WHITE, borderRadius: 14, padding: 20, maxWidth: 480, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: OK }}>✅ {relatorio.faturadas} título(s) gerado(s)</div>
              <button onClick={() => setRelatorio(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: ESP60 }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 14, color: ESP, marginBottom: 12 }}>Total faturado: <b>{brl(relatorio.valor)}</b> — já em “A Receber”.</div>
            {relatorio.puladas.length > 0 && (
              <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: WARN, marginBottom: 6 }}>{relatorio.puladas.length} não faturada(s):</div>
                {relatorio.puladas.map((p, i) => (
                  <div key={i} style={{ fontSize: 12.5, color: ESP60, padding: '4px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderBottom: `1px solid ${LINE}` }}>
                    <span>• OS {p.numero ?? p.os_id.slice(0, 8)} — {MOTIVO_LOTE[p.motivo] ?? p.motivo}</span>
                    <a href={`/dashboard/os?os=${p.os_id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: ESP, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>abrir <ChevronRight size={12} /></a>
                  </div>
                ))}
                <div style={{ fontSize: 11.5, color: ESP60, marginTop: 8 }}>Resolva cada uma (informar valor / vincular cliente) e fature de novo.</div>
              </div>
            )}
          </div>
        </div>
      )}

      {msg && <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESP, color: '#fff', padding: '10px 16px', borderRadius: 999, fontSize: 13, zIndex: 90, maxWidth: '92%', textAlign: 'center' }}>{msg}</div>}
    </div>
  )
}

function Tot({ l, v, sub, cor }: { l: string; v: string; sub?: string; cor: string }) {
  return (
    <div style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, color: ESP60, fontWeight: 700 }}>{l}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: cor, lineHeight: 1.2 }}>{v}</div>
      {sub && <div style={{ fontSize: 12, color: ESP60 }}>{sub}</div>}
    </div>
  )
}
function Grupo({ icon, titulo, cor, children }: { icon: React.ReactNode; titulo: string; cor: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: cor, marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}>{icon} {titulo}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  )
}
function LinhaOS({ l, acao }: { l: Linha; acao: React.ReactNode }) {
  const ident = l.placa || l.numero || '—'
  return (
    <div style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: ESP }}>{ident} <span style={{ fontSize: 12, fontWeight: 400, color: ESP60 }}>· {l.numero}</span></div>
        <div style={{ fontSize: 12, color: ESP60, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {(l.cliente_nome || 'sem cliente')}{l.dias != null ? ` · entregue há ${l.dias}d` : ''}
        </div>
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, color: ESP, fontVariantNumeric: 'tabular-nums' }}>{brl(l.total)}</div>
      {acao}
    </div>
  )
}
function Vazio({ texto }: { texto: string }) {
  return <div style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 10, padding: '20px 16px', textAlign: 'center', color: ESP60, fontSize: 13 }}>{texto}</div>
}
