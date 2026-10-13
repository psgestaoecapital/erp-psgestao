'use client'

// Revenda · R8c (Relatórios) — tela prevista no blueprint. Uma fonte só: fn_veic_relatorios_vendas
// devolve, por VENDA no período, o lucro real (via fn_veic_conta_do_carro, RD-65), comissão pela regra
// da empresa, dias até vender, ROI e carrego. A tela só AGREGA (por vendedor, por modelo, curva de
// encalhe, acerto de precificação, sangria por mês). Sem venda no período → "sem dados" (RD-51). Paleta PS.

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC',
}
const brl = (v: number | null | undefined) => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (v: number | null | undefined) => v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const inp: React.CSSProperties = { padding: '7px 9px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 7, background: C.white, color: C.esp, outline: 'none' }

type Item = {
  veiculo_id: string; marca: string | null; modelo: string | null; vendedor: string; data_venda: string; mes: string
  dias_ate_vender: number | null; valor_venda: number | null; anunciado: number | null; custo_real: number | null
  encargos_pct: number | null; lucro_real: number | null; comissao: number | null; roi_pct: number | null; carrego_total: number | null
}

export default function RelatoriosPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const anoIni = `${new Date().getFullYear()}-01-01`
  const hoje = new Date().toISOString().slice(0, 10)
  const [de, setDe] = useState(anoIni)
  const [ate, setAte] = useState(hoje)
  const [itens, setItens] = useState<Item[]>([])
  const [comBase, setComBase] = useState<string>('lucro_real')
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) { setItens([]); return }
    setCarregando(true); setErro(null)
    const { data } = await supabase.rpc('fn_veic_relatorios_vendas', { p_company_id: companyId, p_de: de, p_ate: ate })
    const r = data as { ok?: boolean; erro?: string; itens?: Item[]; comissao_base?: string } | null
    setCarregando(false)
    if (!r?.ok) { setErro(r?.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : 'Falha ao carregar os relatórios.'); setItens([]); return }
    setItens(r.itens ?? []); setComBase(r.comissao_base ?? 'lucro_real')
  }, [companyId, de, ate])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const resumo = useMemo(() => {
    const n = itens.length
    const lucro = itens.reduce((s, i) => s + (i.lucro_real ?? 0), 0)
    const comis = itens.reduce((s, i) => s + (i.comissao ?? 0), 0)
    const receita = itens.reduce((s, i) => s + (i.valor_venda ?? 0), 0)
    return { n, lucro, comis, receita, ticket: n ? receita / n : null }
  }, [itens])

  const porVendedor = useMemo(() => {
    const m = new Map<string, { vendas: number; lucro: number; comissao: number }>()
    itens.forEach((i) => { const k = i.vendedor; const a = m.get(k) ?? { vendas: 0, lucro: 0, comissao: 0 }; a.vendas++; a.lucro += i.lucro_real ?? 0; a.comissao += i.comissao ?? 0; m.set(k, a) })
    return [...m.entries()].map(([vendedor, v]) => ({ vendedor, ...v })).sort((a, b) => b.lucro - a.lucro)
  }, [itens])

  const porModelo = useMemo(() => {
    const m = new Map<string, { vendas: number; lucro: number; roiSoma: number; roiN: number }>()
    itens.forEach((i) => { const k = `${i.marca ?? ''} ${i.modelo ?? ''}`.trim() || '—'; const a = m.get(k) ?? { vendas: 0, lucro: 0, roiSoma: 0, roiN: 0 }; a.vendas++; a.lucro += i.lucro_real ?? 0; if (i.roi_pct != null) { a.roiSoma += i.roi_pct; a.roiN++ } m.set(k, a) })
    return [...m.entries()].map(([modelo, v]) => ({ modelo, vendas: v.vendas, lucro: v.lucro, roi: v.roiN ? v.roiSoma / v.roiN : null })).sort((a, b) => (b.roi ?? -1e9) - (a.roi ?? -1e9))
  }, [itens])

  const encalhe = useMemo(() => {
    const faixas = [{ lbl: '0–30 dias', min: 0, max: 30 }, { lbl: '31–60', min: 31, max: 60 }, { lbl: '61–90', min: 61, max: 90 }, { lbl: '90+', min: 91, max: Infinity }]
    return faixas.map((fx) => {
      const sel = itens.filter((i) => i.dias_ate_vender != null && i.dias_ate_vender >= fx.min && i.dias_ate_vender <= fx.max)
      const media = sel.length ? sel.reduce((s, i) => s + (i.dias_ate_vender ?? 0), 0) / sel.length : null
      return { ...fx, n: sel.length, media }
    })
  }, [itens])

  const sangriaMes = useMemo(() => {
    const m = new Map<string, number>()
    itens.forEach((i) => m.set(i.mes, (m.get(i.mes) ?? 0) + (i.carrego_total ?? 0)))
    return [...m.entries()].map(([mes, sangria]) => ({ mes, sangria })).sort((a, b) => a.mes.localeCompare(b.mes))
  }, [itens])

  const acerto = useMemo(() => {
    const comAmbos = itens.filter((i) => i.anunciado != null && i.valor_venda != null && (i.anunciado ?? 0) > 0)
    if (!comAmbos.length) return null
    const descMedioPct = comAmbos.reduce((s, i) => s + ((i.anunciado! - i.valor_venda!) / i.anunciado!) * 100, 0) / comAmbos.length
    const comDesconto = comAmbos.filter((i) => (i.valor_venda ?? 0) < (i.anunciado ?? 0)).length
    return { n: comAmbos.length, descMedioPct, comDesconto }
  }, [itens])

  if (!companyId) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa específica no topo.</div>

  const Card = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{titulo}</div>{children}
    </div>
  )
  const semDados = <div style={{ fontSize: 12.5, color: C.espL, fontStyle: 'italic' }}>Sem vendas no período.</div>

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 1180, margin: '0 auto', color: C.esp }}>
      <a href="/dashboard/revenda/patio" style={{ fontSize: 12, color: C.gold, textDecoration: 'none' }}>← voltar ao pátio</a>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 2px' }}>Relatórios da revenda</h1>
      <p style={{ color: C.espM, fontSize: 13, margin: '0 0 14px' }}>Lucro real (a conta do carro), comissão pela regra da empresa, encalhe, ROI por modelo e acerto de precificação — no período escolhido.</p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: C.espM }}>De<br /><input type="date" value={de} onChange={(e) => setDe(e.target.value)} style={inp} /></label>
        <label style={{ fontSize: 11, color: C.espM }}>Até<br /><input type="date" value={ate} onChange={(e) => setAte(e.target.value)} style={inp} /></label>
        {carregando && <span style={{ fontSize: 12, color: C.espL }}>carregando…</span>}
      </div>

      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{erro}</div>}

      {/* Resumo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
        {[['Vendas', String(resumo.n)], ['Lucro real', brl(resumo.lucro)], ['Comissão', brl(resumo.comis)], ['Ticket médio', brl(resumo.ticket)]].map(([k, v]) => (
          <div key={k} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, color: C.espM }}>{k}</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>{v}</div>
          </div>
        ))}
      </div>

      <Card titulo="Lucro real por veículo">
        {itens.length === 0 ? semDados : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ textAlign: 'left', color: C.espM, fontSize: 10.5, textTransform: 'uppercase' }}>
                <th style={{ padding: '4px 6px' }}>veículo</th><th style={{ padding: '4px 6px' }}>vendedor</th><th style={{ padding: '4px 6px' }}>venda</th><th style={{ padding: '4px 6px' }}>anunciado</th><th style={{ padding: '4px 6px' }}>custo real</th><th style={{ padding: '4px 6px' }}>lucro real</th><th style={{ padding: '4px 6px' }}>ROI</th><th style={{ padding: '4px 6px' }}>dias</th>
              </tr></thead>
              <tbody>{itens.map((i) => (
                <tr key={i.veiculo_id} style={{ borderTop: `1px solid ${C.cream}` }}>
                  <td style={{ padding: '5px 6px' }}>{[i.marca, i.modelo].filter(Boolean).join(' ') || '—'}</td>
                  <td style={{ padding: '5px 6px', color: C.espM }}>{i.vendedor}</td>
                  <td style={{ padding: '5px 6px' }}>{brl(i.valor_venda)}</td>
                  <td style={{ padding: '5px 6px', color: C.espM }}>{brl(i.anunciado)}</td>
                  <td style={{ padding: '5px 6px', color: C.espM }}>{brl(i.custo_real)}</td>
                  <td style={{ padding: '5px 6px', fontWeight: 700, color: (i.lucro_real ?? 0) >= 0 ? C.green : C.red }}>{brl(i.lucro_real)}</td>
                  <td style={{ padding: '5px 6px' }}>{pct(i.roi_pct)}</td>
                  <td style={{ padding: '5px 6px', color: C.espM }}>{i.dias_ate_vender ?? '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
        <Card titulo="Por vendedor (comissão pela regra da empresa)">
          {porVendedor.length === 0 ? semDados : (
            <div style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 100px 100px', gap: 6, fontSize: 10, textTransform: 'uppercase', color: C.espM }}><span>vendedor</span><span>vendas</span><span>lucro</span><span>comissão</span></div>
              {porVendedor.map((v) => (
                <div key={v.vendedor} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 100px 100px', gap: 6, borderTop: `1px solid ${C.cream}`, padding: '4px 0' }}>
                  <span>{v.vendedor}</span><span>{v.vendas}</span><span style={{ color: v.lucro >= 0 ? C.green : C.red }}>{brl(v.lucro)}</span><span>{brl(v.comissao)}</span>
                </div>
              ))}
              <div style={{ fontSize: 10.5, color: C.espL, marginTop: 4 }}>Comissão sobre {comBase === 'venda' ? 'o valor de venda' : 'o lucro real'} (regra da empresa).</div>
            </div>
          )}
        </Card>

        <Card titulo="ROI por modelo">
          {porModelo.length === 0 ? semDados : (
            <div style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 80px 100px', gap: 6, fontSize: 10, textTransform: 'uppercase', color: C.espM }}><span>modelo</span><span>vendas</span><span>ROI méd</span><span>lucro</span></div>
              {porModelo.map((v) => (
                <div key={v.modelo} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 80px 100px', gap: 6, borderTop: `1px solid ${C.cream}`, padding: '4px 0' }}>
                  <span>{v.modelo}</span><span>{v.vendas}</span><span>{pct(v.roi)}</span><span style={{ color: v.lucro >= 0 ? C.green : C.red }}>{brl(v.lucro)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card titulo="Curva de encalhe (dias até vender)">
          {itens.length === 0 ? semDados : (
            <div style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 110px', gap: 6, fontSize: 10, textTransform: 'uppercase', color: C.espM }}><span>faixa</span><span>veículos</span><span>média dias</span></div>
              {encalhe.map((f) => (
                <div key={f.lbl} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 110px', gap: 6, borderTop: `1px solid ${C.cream}`, padding: '4px 0' }}>
                  <span>{f.lbl}</span><span>{f.n}</span><span style={{ color: C.espM }}>{f.media != null ? Math.round(f.media) : '—'}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card titulo="Sangria por mês (carrego consumido)">
          {sangriaMes.length === 0 ? semDados : (
            <div style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 6, fontSize: 10, textTransform: 'uppercase', color: C.espM }}><span>mês</span><span>sangria</span></div>
              {sangriaMes.map((m) => (
                <div key={m.mes} style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 6, borderTop: `1px solid ${C.cream}`, padding: '4px 0' }}>
                  <span>{m.mes.split('-').reverse().join('/')}</span><span style={{ color: C.amber }}>{brl(m.sangria)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card titulo="Acerto de precificação (anunciado × vendido)">
        {!acerto ? semDados : (
          <div style={{ fontSize: 13, color: C.esp }}>
            Desconto médio sobre o anunciado: <b>{pct(acerto.descMedioPct)}</b> · {acerto.comDesconto} de {acerto.n} venda(s) fecharam abaixo do anunciado.
          </div>
        )}
      </Card>
    </div>
  )
}
