'use client'

// #18 v2 etapa 3 (passo 3b-frontend) · Faturamento por MEDIÇÃO.
// Aparece SÓ quando o pedido tem previsão (títulos 'previsto'). Para pedido sem previsão (todo o legado)
// o componente devolve null → a tela fica IDÊNTICA ao que era. Cada NFS-e efetiva as parcelas MARCADAS;
// a efetivação (previsto→aberto) acontece no backend SÓ quando a nota AUTORIZA (fn_nfse_efetivar_se_autorizada).
//
// Regras (CEO):
//  • soma das marcadas ao vivo ao lado do valor da nota; emitir desabilitado com a diferença à mostra;
//  • parcela já reservada por nota 'processando' aparece marcada e DESABILITADA (não some, mostra o motivo);
//  • nota AUTORIZADA_SEM_FINANCEIRO (efetivacao_status='falha') → selo VERMELHO + "tentar efetivar de novo";
//  • nota 'processando' → ÂMBAR, "aguardando a prefeitura" (não é falha).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import NFSeEmitirGovModal from '@/components/fiscal/NFSeEmitirGovModal'

const ESP = '#3D2314', ESPM = 'rgba(61,35,20,0.60)', GOLD = '#C8941A'
const LINE = '#E7DECF', AMBER = '#8A5A00', AMBERBG = '#FBEED2', RED = '#A32D2D', REDBG = '#FCEBEB'
const GREEN = '#2E7D5B', GREENBG = '#E8F4DC', BG = '#FAF7F2'

type Previsto = { id: string; pedido_parcela_id: string | null; valor: number; data_vencimento: string; numero_documento: string | null }
type Nota = { id: string; numero: string | null; status: string; valor_servicos: number | null; parcela_ids: string[] | null; efetivacao_status: string | null; efetivacao_erro: string | null }
type Seed = {
  tem_servico?: boolean; valor_servicos?: number
  tomador?: { documento?: string; tipo?: 'cpf' | 'cnpj' | 'indefinido'; nome?: string; email?: string }
  servicos?: { servico_id?: string; descricao?: string; codigo_servico_municipio?: string; codigo_lc116?: string; aliquota_iss?: number }[]
}

function fmtBRL(n: number): string { return (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtDate(s: string | null): string { if (!s) return '—'; try { return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR') } catch { return '—' } }

export default function MedicaoNFSeCard({ pedidoId, companyId, onMudou }: {
  pedidoId: string; companyId: string; onMudou?: () => void
}) {
  const [previstos, setPrevistos] = useState<Previsto[]>([])
  const [notas, setNotas] = useState<Nota[]>([])
  const [seed, setSeed] = useState<Seed | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [valorNota, setValorNota] = useState<string>('')
  const [modalAberto, setModalAberto] = useState(false)
  const [retryId, setRetryId] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [prevRes, notasRes, seedRes] = await Promise.all([
      supabase.from('erp_receber')
        .select('id, pedido_parcela_id, valor, data_vencimento, numero_documento')
        .eq('pedido_id', pedidoId).eq('status', 'previsto').is('deleted_at', null)
        .order('data_vencimento', { ascending: true }),
      supabase.from('erp_nfse_emitidas')
        .select('id, numero, status, valor_servicos, parcela_ids, efetivacao_status, efetivacao_erro')
        .eq('pedido_id', pedidoId).order('criado_em', { ascending: false }),
      supabase.rpc('fn_pedido_nfse_dados', { p_pedido_id: pedidoId }),
    ])
    setPrevistos((prevRes.data ?? []) as Previsto[])
    setNotas((notasRes.data ?? []) as Nota[])
    setSeed((seedRes.data as Seed | null) ?? null)
    setCarregando(false)
  }, [pedidoId])

  useEffect(() => { void carregar() }, [carregar])

  // parcelas reservadas por nota 'processando' (guard #2) — não podem entrar em 2ª nota
  const reservadas = useMemo(() => {
    const s = new Set<string>()
    for (const n of notas) if (n.status === 'processando') for (const pid of (n.parcela_ids ?? [])) s.add(pid)
    return s
  }, [notas])

  const somaMarcadas = useMemo(
    () => previstos.filter((p) => p.pedido_parcela_id && marcadas.has(p.pedido_parcela_id)).reduce((a, p) => a + Number(p.valor || 0), 0),
    [previstos, marcadas],
  )
  const valorNotaNum = valorNota === '' ? somaMarcadas : Number(valorNota.replace(',', '.'))
  const diferenca = Math.round((somaMarcadas - (Number.isFinite(valorNotaNum) ? valorNotaNum : 0)) * 100) / 100
  const bate = marcadas.size > 0 && Math.abs(diferenca) < 0.005

  // pedido SEM previsão E sem nota de medição = legado → não renderiza NADA (tela idêntica)
  if (!carregando && previstos.length === 0 && !notas.some((n) => (n.parcela_ids?.length ?? 0) > 0)) return null
  if (carregando) return null

  const toggle = (pid: string) => setMarcadas((prev) => {
    const n = new Set(prev)
    if (n.has(pid)) n.delete(pid); else n.add(pid)
    return n
  })

  async function tentarEfetivarDeNovo(nfseId: string) {
    setRetryId(nfseId); setMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('/api/fiscal/nfse/efetivar', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', authorization: session ? `Bearer ${session.access_token}` : '' },
        body: JSON.stringify({ nfseId }),
      })
      const j = await r.json()
      setMsg(j.ok ? '✅ Financeiro gerado — parcelas efetivadas.' : `❌ ${j.mensagem || 'Ainda não foi possível efetivar.'}`)
      await carregar(); onMudou?.()
    } catch (e) { setMsg('❌ ' + (e as Error).message) } finally { setRetryId(null) }
  }

  const svc0 = seed?.servicos?.[0]
  const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }

  return (
    <div style={card}>
      <div style={{ fontSize: 11, color: ESPM, textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.5 }}>
        NFS-e por medição
      </div>

      {msg && <div style={{ fontSize: 12, color: ESP, background: BG, border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px' }}>{msg}</div>}

      {/* Notas já emitidas deste pedido — com o estado da efetivação */}
      {notas.filter((n) => (n.parcela_ids?.length ?? 0) > 0).map((n) => {
        const proc = n.status === 'processando'
        const falha = n.efetivacao_status === 'falha'
        const ok = n.efetivacao_status === 'ok'
        const rej = n.status === 'rejeitada' || n.status === 'cancelada' || n.status === 'erro'
        const cor = falha ? RED : proc ? AMBER : ok ? GREEN : rej ? RED : ESPM
        const fundo = falha ? REDBG : proc ? AMBERBG : ok ? GREENBG : rej ? REDBG : BG
        return (
          <div key={n.id} style={{ border: `1px solid ${cor}33`, background: fundo, borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: cor }}>
              Nota {n.numero ? `nº ${n.numero}` : '(sem número)'} · {fmtBRL(Number(n.valor_servicos || 0))}
            </div>
            {falha && (
              <>
                <div style={{ fontSize: 12, color: RED, fontWeight: 600 }}>⚠️ Nota AUTORIZADA, financeiro NÃO gerado.</div>
                {n.efetivacao_erro && <div style={{ fontSize: 11, color: ESPM }}>{n.efetivacao_erro}</div>}
                <button type="button" onClick={() => void tentarEfetivarDeNovo(n.id)} disabled={retryId === n.id}
                  style={{ alignSelf: 'flex-start', minHeight: 40, padding: '8px 14px', borderRadius: 8, border: 'none', background: RED, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: retryId === n.id ? 'wait' : 'pointer' }}>
                  {retryId === n.id ? 'Efetivando…' : '🔁 Tentar efetivar de novo'}
                </button>
              </>
            )}
            {proc && <div style={{ fontSize: 11.5, color: AMBER }}>⏳ Nota enviada, aguardando a prefeitura — as parcelas serão efetivadas quando autorizar.</div>}
            {ok && <div style={{ fontSize: 11.5, color: GREEN }}>✅ Parcelas efetivadas (viraram contas a receber).</div>}
            {rej && !falha && <div style={{ fontSize: 11.5, color: RED }}>❌ Nota rejeitada — as parcelas seguem previstas; corrija e reemita.</div>}
          </div>
        )
      })}

      {/* Seletor de parcelas para a PRÓXIMA nota */}
      {previstos.length > 0 ? (
        <>
          <div style={{ fontSize: 12, color: ESPM }}>Escolha as parcelas que <b>esta nota</b> cobre:</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {previstos.map((p) => {
              const pid = p.pedido_parcela_id ?? p.id
              const reservada = p.pedido_parcela_id ? reservadas.has(p.pedido_parcela_id) : false
              const checked = reservada || marcadas.has(pid)
              return (
                <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', border: `1px solid ${LINE}`, borderRadius: 8, background: reservada ? BG : '#fff', opacity: reservada ? 0.7 : 1, cursor: reservada ? 'not-allowed' : 'pointer' }}>
                  <input type="checkbox" checked={checked} disabled={reservada} onChange={() => toggle(pid)} />
                  <span style={{ flex: 1, fontSize: 12.5, color: ESP }}>{fmtBRL(Number(p.valor || 0))} <span style={{ color: ESPM }}>· vence {fmtDate(p.data_vencimento)}</span></span>
                  {reservada && <span style={{ fontSize: 10.5, color: AMBER, background: AMBERBG, borderRadius: 4, padding: '2px 6px' }}>em nota processando</span>}
                </label>
              )
            })}
          </div>

          {/* valor da nota + soma das marcadas ao vivo (a Jordana vê os dois ANTES de emitir) */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', paddingTop: 4, borderTop: `1px solid ${LINE}` }}>
            <label style={{ fontSize: 11, color: ESPM }}>
              Valor da nota
              <input inputMode="decimal" value={valorNota} onChange={(e) => setValorNota(e.target.value)}
                placeholder={somaMarcadas.toFixed(2).replace('.', ',')}
                style={{ display: 'block', marginTop: 3, width: 130, padding: '7px 9px', border: `1px solid ${LINE}`, borderRadius: 6, fontSize: 13, color: ESP }} />
            </label>
            <div style={{ fontSize: 12, color: ESP }}>
              <div>marcadas <b>{fmtBRL(somaMarcadas)}</b> · nota <b>{fmtBRL(Number.isFinite(valorNotaNum) ? valorNotaNum : 0)}</b></div>
              <div style={{ color: bate ? GREEN : RED, fontWeight: 700 }}>
                {marcadas.size === 0 ? 'marque ao menos uma parcela' : bate ? '✓ batem' : `diferença ${fmtBRL(Math.abs(diferenca))}`}
              </div>
            </div>
          </div>

          <button type="button" disabled={!bate} onClick={() => { setValorNota(String(somaMarcadas)); setModalAberto(true) }}
            title={bate ? 'Emitir NFS-e das parcelas marcadas' : 'As parcelas marcadas precisam bater com o valor da nota'}
            data-testid="medicao-emitir-nfse"
            style={{ alignSelf: 'flex-start', minHeight: 44, padding: '10px 16px', borderRadius: 8, border: 'none', background: bate ? GOLD : '#E3D9C6', color: bate ? '#fff' : ESPM, fontSize: 13, fontWeight: 700, cursor: bate ? 'pointer' : 'not-allowed' }}>
            📄 Emitir NFS-e desta medição
          </button>
        </>
      ) : (
        <div style={{ fontSize: 12, color: ESPM }}>Todas as parcelas previstas já foram faturadas ou estão em nota.</div>
      )}

      <NFSeEmitirGovModal
        companyId={companyId}
        aberto={modalAberto}
        tomadorDocumento={seed?.tomador?.documento}
        tomadorTipo={seed?.tomador?.tipo}
        tomadorNome={seed?.tomador?.nome}
        tomadorEmail={seed?.tomador?.email}
        descricaoServico={svc0?.descricao}
        codigoServicoMunicipio={svc0?.codigo_servico_municipio}
        codigoLC116={svc0?.codigo_lc116}
        aliquotaIss={svc0?.aliquota_iss}
        valorServicos={Number.isFinite(valorNotaNum) ? valorNotaNum : somaMarcadas}
        servicoId={svc0?.servico_id}
        onFechar={() => setModalAberto(false)}
        onEmitida={async (providerReference?: string) => {
          setModalAberto(false)
          const ids = previstos.filter((p) => p.pedido_parcela_id && marcadas.has(p.pedido_parcela_id)).map((p) => p.pedido_parcela_id as string)
          if (providerReference) {
            await supabase.rpc('fn_pedido_nfse_marcar_emitida', {
              p_pedido_id: pedidoId, p_provider_reference: providerReference, p_parcela_ids: ids,
            })
          }
          setMarcadas(new Set()); setValorNota('')
          await carregar(); onMudou?.()
        }}
      />
    </div>
  )
}
