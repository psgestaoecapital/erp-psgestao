'use client'
// Indústria › RH › Gestão de Mão de Obra — PR6: aba PROJETADO × REAL (qtd e custo), posto a posto.
// Lê fn_prod_mao_obra_projetado_real (RLS por company_id, custo gated por fn__rh_pode_custo). Só leitura.
// PROJETADO = pessoas dos turnos do posto + custo "mão de obra/mês" planejado; REAL = pessoas alocadas +
// soma dos salários-base × (1 + encargos%). Agnóstico de ramo. Mesmo padrão visual das outras abas.
// Code: desenvolvedor_4_g
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const ROTA = '/dashboard/industrial/rh/mao-de-obra'
const ESP = '#3D2314', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
const GREEN = '#166534', RED = '#B42318', BG2 = '#F6F1E9'

type Posto = {
  posto_id: string; numero: string; atividade: string; setor: string; cargo: string | null
  plan_pessoas: number; real_pessoas: number; sem_salario: number; encargos_pct: number
  plan_custo: number | null; real_custo: number | null
}
type Totais = { postos: number; plan_pessoas: number; real_pessoas: number; plan_custo: number | null; real_custo: number | null }
type Resp = { ok: boolean; erro?: string; ref: string; pode_custo: boolean; totais: Totais; postos: Posto[] }

const brl = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const n = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
const hojeISO = () => new Date().toISOString().slice(0, 10)

const card: React.CSSProperties = { background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }
const inp: React.CSSProperties = { padding: '9px 11px', fontSize: 14, border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', color: ESP }
const th: React.CSSProperties = { textAlign: 'right', fontWeight: 700, color: MUT, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.3, padding: '8px 10px', borderBottom: `1px solid ${LINE}`, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { textAlign: 'right', padding: '9px 10px', borderBottom: `1px solid ${BG2}`, fontSize: 13.5, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

// Diferença real − plano. Em custo/pessoas, "dentro do plano" (real ≤ plano) é bom (verde); acima é alerta (vermelho).
function Delta({ real, plan, money }: { real: number | null; plan: number | null; money?: boolean }) {
  if (real == null || plan == null) return <span style={{ color: MUT }}>—</span>
  const d = real - plan
  const cor = d > 0 ? RED : d < 0 ? GREEN : MUT
  const txt = (d > 0 ? '+' : '') + (money ? brl(d) : n(d))
  return <span style={{ color: cor, fontWeight: 600 }}>{txt}</span>
}

function Kpi({ rot, chave, valor, sub, cor }: { rot: string; chave: string; valor: string; sub?: React.ReactNode; cor?: string }) {
  return (
    <div style={{ ...card, display: 'grid', gap: 2, minWidth: 0 }}>
      <div style={{ fontSize: 11.5, color: MUT, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, display: 'flex', alignItems: 'center', gap: 4 }}>{rot}<AjudaCampo chave={chave} rota={ROTA} /></div>
      <div style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(20px, 2.2vw, 27px)', color: cor ?? ESP, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      {sub && <div style={{ fontSize: 12, color: MUT }}>{sub}</div>}
    </div>
  )
}

export default function ProjetadoRealPanel({ empresa }: { empresa: string | null }) {
  const [ref, setRef] = useState(hojeISO())
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const seq = useRef(0)

  const carregar = useCallback(async () => {
    if (!empresa) { setLoading(false); return }
    const minha = ++seq.current
    setLoading(true); setErro(null)
    const { data: d, error } = await supabase.rpc('fn_prod_mao_obra_projetado_real', { p_company_id: empresa, p_plant_id: null, p_ref: ref })
    if (minha !== seq.current) return
    setLoading(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível carregar a comparação. Tente de novo.')); setData(null); return }
    const r = d as Resp
    if (!r?.ok) { setErro(r?.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : 'Não foi possível carregar a comparação.'); setData(null); return }
    setData(r)
  }, [empresa, ref])
  useEffect(() => { void carregar() }, [carregar])

  const t = data?.totais
  const podeCusto = data?.pode_custo ?? false

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Posição em<AjudaCampo chave="maoobra.pxr.ref" rota={ROTA} /></span>
          <input data-testid="pxr-ref" type="date" value={ref} max={hojeISO()} onChange={(e) => setRef(e.target.value || hojeISO())} style={inp} />
        </label>
        <p style={{ margin: 0, fontSize: 13, color: MUT, maxWidth: '60ch', flex: '1 1 260px' }}>
          Compara, posto a posto, o que o planejamento prevê (pessoas e custo) com o que está alocado de fato na data escolhida.
          {!podeCusto && !loading && data && <> Os valores de custo ficam restritos ao RH e à direção.</>}
        </p>
      </div>

      {erro && <div role="alert" style={{ ...card, borderColor: RED, color: RED }}>{erro}</div>}
      {loading && !data && <div style={{ ...card, color: MUT }}>Carregando a comparação…</div>}

      {data && !erro && (data.postos.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', display: 'grid', gap: 10, padding: '28px 16px' }} data-testid="pxr-vazio">
          <div style={{ fontSize: 15, fontWeight: 600 }}>Nenhum posto ativo nesta empresa</div>
          <div style={{ fontSize: 13, color: MUT, maxWidth: '52ch', margin: '0 auto' }}>Cadastre os postos de trabalho para comparar o quadro planejado com o alocado. Cada posto vira uma linha aqui.</div>
          <div><Link href={ROTA} style={{ color: GOLD, fontWeight: 700, fontSize: 13 }}>Ir para a aba Postos →</Link></div>
        </div>
      ) : (
        <>
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 12 }} aria-label="Resumo projetado × real">
            <Kpi rot="Postos" chave="maoobra.setor.postos" valor={String(t?.postos ?? 0)} sub="ativos na data" />
            <Kpi rot="Pessoas" chave="maoobra.pxr.real_pessoas" valor={`${n(t?.real_pessoas)} / ${n(t?.plan_pessoas)}`} sub={<>alocadas / planejadas</>} />
            <Kpi rot="Custo planejado/mês" chave="maoobra.pxr.plan_custo" valor={podeCusto ? brl(t?.plan_custo) : '🔒'} sub="mão de obra" />
            <Kpi rot="Custo real/mês" chave="maoobra.pxr.real_custo" valor={podeCusto ? brl(t?.real_custo) : '🔒'}
              sub={<Delta real={t?.real_custo ?? null} plan={t?.plan_custo ?? null} money />}
              cor={podeCusto && t?.real_custo != null && t?.plan_custo != null && t.real_custo > t.plan_custo ? RED : undefined} />
          </section>

          <div style={{ ...card, padding: 0, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>Setor</th>
                  <th style={{ ...th, textAlign: 'left' }}>Posto</th>
                  <th style={{ ...th, textAlign: 'left' }}>Cargo</th>
                  <th style={th}>Plan.<AjudaCampo chave="maoobra.pxr.plan_pessoas" rota={ROTA} /></th>
                  <th style={th}>Real<AjudaCampo chave="maoobra.pxr.real_pessoas" rota={ROTA} /></th>
                  <th style={th}>Δ pessoas<AjudaCampo chave="maoobra.pxr.variacao" rota={ROTA} /></th>
                  <th style={th}>Plan. R$/mês<AjudaCampo chave="maoobra.pxr.plan_custo" rota={ROTA} /></th>
                  <th style={th}>Real R$/mês<AjudaCampo chave="maoobra.pxr.real_custo" rota={ROTA} /></th>
                  <th style={th}>Δ custo<AjudaCampo chave="maoobra.pxr.variacao" rota={ROTA} /></th>
                </tr>
              </thead>
              <tbody>
                {data.postos.map((p) => (
                  <tr key={p.posto_id} data-testid="pxr-linha">
                    <td style={{ ...td, textAlign: 'left', color: MUT }}>{p.setor}</td>
                    <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', minWidth: 150 }}>
                      <b>{p.numero}</b> · {p.atividade}
                    </td>
                    <td style={{ ...td, textAlign: 'left', color: MUT }}>{p.cargo ?? '—'}</td>
                    <td style={td}>{n(p.plan_pessoas)}</td>
                    <td style={td}>{n(p.real_pessoas)}</td>
                    <td style={td}><Delta real={p.real_pessoas} plan={p.plan_pessoas} /></td>
                    <td style={td}>{podeCusto ? brl(p.plan_custo) : '🔒'}</td>
                    <td style={td}>
                      {!podeCusto ? '🔒' : p.real_custo != null ? brl(p.real_custo)
                        : <span style={{ color: MUT, fontSize: 12 }} title="As pessoas alocadas ainda não têm salário-base cadastrado." data-testid="pxr-sem-salario">sem salário</span>}
                    </td>
                    <td style={td}>{podeCusto ? <Delta real={p.real_custo} plan={p.plan_custo} money /> : '🔒'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ margin: '0 2px', fontSize: 12, color: MUT }}>
            Postos sem pessoas planejadas aparecem com 0 (cadastre os turnos na aba Postos). Custo real só aparece quando as pessoas alocadas têm salário-base (aba Salário).
          </p>
        </>
      ))}
    </div>
  )
}
