'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// FIN-R1 · SALDO BANCÁRIO LIDO, NÃO CALCULADO (veredito da sonda #1156).
// Fonte única: fn_saldos_empresa — classifica banco × caixa × cartão × controle e
// devolve o saldo LIDO do extrato quando existe. saldo_atual saiu da tela.
const COLORS = {
  espresso: '#3D2314',
  offWhite: '#FAF7F2',
  dourado: '#C8941A',
  douradoSoft: '#FFF8E7',
  verde: '#3B6D11',
  verdeSoft: '#EEF6E6',
  ambar: '#A87810',
  ambarSoft: '#FFF8EC',
  vermelho: '#A32D2D',
  cinza: 'rgba(61,35,20,0.45)',
  linha: 'rgba(61,35,20,0.12)',
}

type Bloco = { total: number; contas?: number; contas_sem_leitura?: number; lido_em?: string | null; origem?: string | null }
type Diferenca = { valor: number; movimentos_pendentes: number; ultima_conciliacao: string | null }
type Saldos = {
  sem_plano?: boolean
  sem_acesso?: boolean
  bancario: Bloco
  gerencial: { total: number }
  caixa: { total: number; contas: number }
  cartao: { total: number; contas: number }
  tem_extrato: boolean
  diferenca: Diferenca | null
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function horaCurta(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function maisDe24h(iso: string | null | undefined): boolean {
  if (!iso) return false
  return Date.now() - new Date(iso).getTime() > 24 * 3600 * 1000
}
function nomeOrigem(o: string | null | undefined): string {
  if (o === 'api_sicoob') return 'Sicoob'
  if (o === 'api_pluggy') return 'Pluggy'
  if (o === 'ofx') return 'OFX'
  if (o === 'manual') return 'lançamento manual'
  return o || 'extrato'
}

export default function HeroSaldoBancario({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [d, setD] = useState<Saldos | null>(null)
  const [loading, setLoading] = useState(true)
  const [showComp, setShowComp] = useState(false)

  useEffect(() => {
    if (!companyId) return
    let ignore = false
    setLoading(true)
    ;(async () => {
      const { data } = await supabase.rpc('fn_saldos_empresa', { p_company_ids: [companyId] })
      if (!ignore) {
        setD(data as Saldos)
        setLoading(false)
      }
    })()
    return () => { ignore = true }
  }, [companyId])

  if (loading) {
    return (
      <div style={cardTopo}>
        <div style={{ fontSize: 12, color: COLORS.cinza }}>Carregando saldo…</div>
      </div>
    )
  }
  if (!d || d.sem_plano || d.sem_acesso) return null

  const banc = d.bancario || { total: 0 }
  const temLeitura = (banc.contas ?? 0) > 0
  const temContaBanco = temLeitura || (banc.contas_sem_leitura ?? 0) > 0
  const principal = temLeitura ? banc.total : (temContaBanco ? d.gerencial.total : null)
  const origem: 'lido' | 'calculado' | 'sem_dado' = temLeitura ? 'lido' : (temContaBanco ? 'calculado' : 'sem_dado')
  const semNada = !temContaBanco && d.caixa.contas === 0 && d.cartao.contas === 0

  if (semNada) {
    return (
      <div style={cardTopo}>
        <div style={rotulo}>Saldo bancário</div>
        <div style={{ fontSize: 14, color: COLORS.espresso, opacity: 0.7 }}>
          Cadastre uma conta bancária pra ver seu saldo aqui.
        </div>
      </div>
    )
  }

  const negativo = (principal ?? 0) < 0
  const badge = origem === 'lido'
    ? { txt: `✅ lido do ${nomeOrigem(banc.origem)}${banc.lido_em ? ' às ' + horaCurta(banc.lido_em) : ''}`, cor: COLORS.verde, bg: COLORS.verdeSoft }
    : origem === 'calculado'
      ? { txt: '📐 calculado (saldo inicial + títulos liquidados)', cor: COLORS.ambar, bg: COLORS.ambarSoft }
      : { txt: '— sem leitura de extrato', cor: COLORS.cinza, bg: 'transparent' }

  return (
    <div style={{ marginBottom: 16 }}>
      {/* dois cards: bancário (lido) × gerencial (calculado) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {/* Bancário */}
        <div style={cardTopo}>
          <div style={rotulo}>🏦 Saldo bancário</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: negativo ? COLORS.vermelho : COLORS.espresso, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
            {fmt(principal)}
          </div>
          <div style={{ display: 'inline-block', marginTop: 8, fontSize: 11.5, fontWeight: 600, color: badge.cor, background: badge.bg, padding: badge.bg === 'transparent' ? 0 : '2px 8px', borderRadius: 6 }}>
            {badge.txt}
          </div>
          {origem === 'lido' && maisDe24h(banc.lido_em) && (
            <div style={{ fontSize: 11, color: COLORS.ambar, marginTop: 6 }}>⚠️ leitura de ontem — importe o extrato para atualizar</div>
          )}
          {(banc.contas_sem_leitura ?? 0) > 0 && (
            <div style={{ fontSize: 11, color: COLORS.cinza, marginTop: 6 }}>
              ⚠️ {banc.contas_sem_leitura} {banc.contas_sem_leitura === 1 ? 'conta sem leitura' : 'contas sem leitura'} de extrato
            </div>
          )}
        </div>

        {/* Gerencial */}
        <div style={{ ...cardTopo, background: '#FFFFFF' }}>
          <div style={rotulo}>📊 Saldo gerencial</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: (d.gerencial.total < 0) ? COLORS.vermelho : COLORS.espresso, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
            {fmt(d.gerencial.total)}
          </div>
          <div style={{ fontSize: 11.5, color: COLORS.cinza, marginTop: 8 }}>saldo inicial + títulos liquidados</div>
          <button type="button" onClick={() => setShowComp(true)}
            style={{ marginTop: 8, fontSize: 11.5, fontWeight: 600, color: COLORS.espresso, background: 'transparent', border: `1px solid ${COLORS.linha}`, borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}>
            🔍 Como é composto?
          </button>
        </div>
      </div>
      {showComp && <SaldoComposicaoModal companyId={companyId} onClose={() => setShowComp(false)} />}

      {/* Faixa de diferença — só quando há extrato importado (guarda anti-ruído) */}
      {d.tem_extrato && d.diferenca && temLeitura && (
        <button
          type="button"
          onClick={() => router.push('/dashboard/financeiro/conciliacao/inbox')}
          style={{ width: '100%', textAlign: 'left', marginTop: 12, padding: '12px 16px', background: COLORS.ambarSoft, border: `1px solid #F0DCB0`, borderRadius: 12, cursor: 'pointer', font: 'inherit' }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.ambar }}>
            ⚠️ Diferença banco × sistema: {fmt(d.diferenca.valor)}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.7)', marginTop: 3 }}>
            {d.diferenca.movimentos_pendentes} movimento{d.diferenca.movimentos_pendentes === 1 ? '' : 's'} a conciliar
            {d.diferenca.ultima_conciliacao ? ` · última conciliação ${new Date(d.diferenca.ultima_conciliacao + 'T00:00:00').toLocaleDateString('pt-BR')}` : ''}
            {'  ·  Conciliar agora →'}
          </div>
        </button>
      )}

      {/* Caixa e Cartão — cards separados, NUNCA somados no bancário */}
      {(d.caixa.contas > 0 || d.cartao.contas > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 12 }}>
          {d.caixa.contas > 0 && (
            <div style={cardMini}>
              <div style={rotuloMini}>💵 Caixa (espécie)</div>
              <div style={valorMini}>{fmt(d.caixa.total)}</div>
              <div style={legendaMini}>{d.caixa.contas} {d.caixa.contas === 1 ? 'conta' : 'contas'}</div>
            </div>
          )}
          {d.cartao.contas > 0 && (
            <div style={cardMini}>
              <div style={rotuloMini}>💳 Cartão (fatura)</div>
              <div style={valorMini}>{fmt(d.cartao.total)}</div>
              <div style={legendaMini}>{d.cartao.contas} {d.cartao.contas === 1 ? 'cartão' : 'cartões'} · não soma no banco</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Composição do saldo (chamados #23 Julia / #25 Jordana) — explica de onde vem o número:
// por conta, saldo inicial (na SUA data) + recebido − pago = saldo. E mostra a DATA que o cálculo
// USA hoje — se divergir da data da conta, a própria tela mostra o bug (fix per-conta vem depois).
type CompConta = { nome: string; saldo_inicial: number; data_saldo_inicial: string | null; data_diverge_do_calculo: boolean; tem_assinatura?: boolean; janela_subtraida?: number; recebido: number; pago: number; saldo: number }
type Composicao = { ok?: boolean; data_efetiva_calculo_atual: string | null; contas: CompConta[]; sem_conta: { recebido: number; pago: number }; total_saldo_inicial: number; total_recebido: number; total_pago: number; saldo_composto: number; total_janela_subtraida?: number; saldo_gerencial_atual: number }
const dBR = (s: string | null) => s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—'

function SaldoComposicaoModal({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const [c, setC] = useState<Composicao | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data } = await supabase.rpc('fn_saldo_composicao', { p_company_ids: [companyId] })
      if (!ignore) { setC(data as Composicao); setLoading(false) }
    })()
    return () => { ignore = true }
  }, [companyId])
  const algumaDiverge = !!c?.contas?.some((x) => x.data_diverge_do_calculo && x.saldo_inicial > 0)
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 20, width: 'min(620px,100%)', maxHeight: '90vh', overflowY: 'auto', color: COLORS.espresso }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 2 }}>Como o saldo é composto</div>
        <div style={{ fontSize: 12.5, color: COLORS.cinza, marginBottom: 14 }}>Por conta: saldo inicial (na data dele) + recebido − pago = saldo. É assim que o número do topo é calculado.</div>
        {loading ? <div style={{ fontSize: 13, color: COLORS.cinza }}>Carregando…</div>
          : !c?.ok ? <div style={{ fontSize: 13, color: COLORS.cinza }}>Sem dados de saldo para esta empresa.</div>
          : (
            <>
              {algumaDiverge && (
                <div style={{ background: COLORS.ambarSoft, border: `1px solid #F0DCB0`, borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 12.5, color: COLORS.ambar, lineHeight: 1.5 }}>
                  ⚠️ O cálculo de hoje usa a data <b>{dBR(c.data_efetiva_calculo_atual)}</b> para <b>todas</b> as contas (a mais antiga). As contas marcadas 🔶 têm data própria diferente — os recebimentos entre uma data e outra entram em duplicidade. É o que faz o saldo não bater.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {c.contas.map((a) => (
                  <div key={a.nome} style={{ border: `1px solid ${COLORS.linha}`, borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {a.nome}
                      {a.data_diverge_do_calculo && a.saldo_inicial > 0 && <span title="data própria diferente da usada no cálculo" style={{ fontSize: 11 }}>🔶</span>}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'rgba(61,35,20,0.85)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(a.saldo_inicial)} <span style={{ color: COLORS.cinza }}>em {dBR(a.data_saldo_inicial)}</span>
                      {' · '}<span style={{ color: COLORS.verde }}>+ {fmt(a.recebido)} recebido</span>
                      {' · '}<span style={{ color: COLORS.vermelho }}>− {fmt(a.pago)} pago</span>
                      {' = '}<b>{fmt(a.saldo)}</b>
                    </div>
                    {!!a.janela_subtraida && Math.abs(a.janela_subtraida) > 0.005 && (
                      <div style={{ fontSize: 11.5, color: COLORS.ambar, marginTop: 4, background: COLORS.ambarSoft, borderRadius: 6, padding: '4px 8px' }}>
                        🔻 janela dupla removida do saldo: <b>{fmt(a.janela_subtraida)}</b> — recebimentos/pagamentos entre {dBR(c.data_efetiva_calculo_atual)} e {dBR(a.data_saldo_inicial)} que já estão dentro do saldo inicial desta conta.
                      </div>
                    )}
                  </div>
                ))}
                {(c.sem_conta.recebido > 0 || c.sem_conta.pago > 0) && (
                  <div style={{ border: `1px dashed ${COLORS.linha}`, borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: COLORS.cinza }}>
                    <b>Sem conta atribuída</b> · + {fmt(c.sem_conta.recebido)} recebido · − {fmt(c.sem_conta.pago)} pago
                    <div style={{ fontSize: 11, marginTop: 2 }}>Títulos liquidados sem conta bancária definida — não dá pra atribuir a uma conta.</div>
                  </div>
                )}
              </div>
              <div style={{ borderTop: `1px solid ${COLORS.linha}`, marginTop: 12, paddingTop: 10, fontSize: 13 }}>
                {!!c.total_janela_subtraida && Math.abs(c.total_janela_subtraida) > 0.005 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: COLORS.ambar, marginBottom: 4 }}><span>🔻 janela dupla removida (não conta 2×)</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(c.total_janela_subtraida)}</b></div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Soma das contas (cada uma na sua data)</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(c.saldo_composto)}</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: COLORS.cinza, marginTop: 4 }}><span>Saldo gerencial que o sistema mostra hoje</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(c.saldo_gerencial_atual)}</span></div>
              </div>
            </>
          )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', border: 'none', borderRadius: 8, background: COLORS.espresso, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Fechar</button>
        </div>
      </div>
    </div>
  )
}

const cardTopo: React.CSSProperties = {
  background: COLORS.douradoSoft,
  border: `1px solid ${COLORS.dourado}`,
  borderRadius: 14,
  padding: '18px 22px',
}
const cardMini: React.CSSProperties = {
  background: '#FFFFFF',
  border: `0.5px solid ${COLORS.linha}`,
  borderRadius: 12,
  padding: '14px 16px',
}
const rotulo: React.CSSProperties = {
  fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600, marginBottom: 8,
}
const rotuloMini: React.CSSProperties = { ...rotulo, marginBottom: 6 }
const valorMini: React.CSSProperties = {
  fontSize: 20, fontWeight: 700, color: COLORS.espresso, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
}
const legendaMini: React.CSSProperties = { fontSize: 11, color: COLORS.cinza, marginTop: 4 }
