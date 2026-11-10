'use client'
// Comercial › Meu painel v6 (storytelling) — bloco 1: "Como a Frioeste está vendendo".
// Rota NOVA e separada do v5 (/dashboard/comercial/meu-painel), que continua intacto até o v6 ser validado.
// A tela só desenha: o cálculo vive em ../meu-painel/motor-v5 (mesmo motor já provado contra o aceite),
// alimentado pela RPC fn_bi_comercial_base, que trava o escopo no banco (líder vê a empresa; vendedor só o próprio).
// Fonte: fn_com_venda_item / bi_comercial_venda_item_mv (R$ 13.983.740 no aceite). Nunca a MV inflada.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import {
  calcularModelo, estadoPadrao, gruposProduto, resumo,
  type BaseV5, type EstadoV5, type GrupoProduto, type ModeloV5,
} from '../meu-painel/motor-v5'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', bd: '#E7DED3', m: '#6B5D4F', d: '#9C8E80' }
const ROTA = '/dashboard/comercial/meu-painel-v6'

const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const brl0 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const brl2 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const int = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v)
const ton = (kg: number | null | undefined) => kg == null ? '—' : nf({ maximumFractionDigits: 1 }).format(kg / 1000) + ' t'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const diaISO = (base: string, n: number) => {
  const [y, m, d] = base.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000)
  return t.toISOString().slice(0, 10)
}
const dataBR = (isoDia: string) => { const [y, m, d] = isoDia.split('-'); return `${d}/${m}/${y}` }

type VendRow = {
  nome: string; val: number; part: number; cli: number; notas: number; ticket: number | null; rpkg: number | null
  idx: number | null; desc: number; dev: number; devPct: number; prazo: number | null
}

export default function MeuPainelV6() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null
  const [base, setBase] = useState<BaseV5 | null>(null)
  const [estado, setEstado] = useState<EstadoV5 | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Período: últimos 30 dias (mesmo recorte padrão do v5), até hoje.
  const intervalo = useMemo(() => {
    const hoje = new Date()
    const ini = new Date(hoje); ini.setDate(ini.getDate() - 29)
    return { de: iso(ini), ate: iso(hoje) }
  }, [])

  const carregar = useCallback(async () => {
    if (!empresa) return
    setCarregando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_bi_comercial_base', { p_company_id: empresa, p_de: intervalo.de, p_ate: intervalo.ate })
    setCarregando(false)
    if (error) { setErro(erroAmigavel(error)); setBase(null); return }
    setBase(data as BaseV5)
  }, [empresa, intervalo])
  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => { setEstado(base ? estadoPadrao(base) : null) }, [base])

  const pg = useMemo<GrupoProduto[] | null>(() => base ? gruposProduto(base) : null, [base])
  const modelo = useMemo<ModeloV5 | null>(() => base && estado && pg ? calcularModelo(base, estado, pg) : null, [base, estado, pg])
  const r = useMemo(() => modelo ? resumo(modelo) : null, [modelo])

  // Série diária (faturamento por dia) — mesma base do motor, ordenada por data.
  const serie = useMemo(() => {
    if (!modelo || !base) return [] as { dia: string; rot: string; val: number }[]
    return [...modelo.diaM]
      .map(([d, a]) => { const iso_ = diaISO(base.de, d); return { dia: iso_, rot: dataBR(iso_).slice(0, 5), val: a.val } })
      .sort((a, b) => a.dia.localeCompare(b.dia))
  }, [modelo, base])

  const notas = modelo?.tot.notas.size ?? 0
  const ticketNota = notas ? (modelo?.tot.val ?? 0) / notas : null

  // Bloco 2 — linhas de produto (mesma agregação do motor, por linha, com a análise padrão).
  const linhas = useMemo(() => {
    if (!modelo) return [] as { nome: string; val: number; part: number; rpkg: number | null }[]
    const tot = modelo.tot.val || 1
    return [...modelo.linM]
      .map(([nome, a]) => ({ nome, val: a.val, part: 100 * a.val / tot, rpkg: a.kgP ? a.valP / a.kgP : null }))
      .sort((a, b) => b.val - a.val)
  }, [modelo])

  // Ritmo da semana: faturamento somado por dia da semana (domingo a sábado).
  const ritmoSemana = useMemo(() => {
    const nomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
    const acc = nomes.map((n) => ({ rot: n, val: 0 }))
    serie.forEach((s) => { acc[new Date(s.dia + 'T00:00:00Z').getUTCDay()].val += s.val })
    return acc
  }, [serie])

  // Para onde vai o mês: ritmo médio por dia com venda no período × 30 dias (estimativa, não previsão contábil).
  const mediaDia = serie.length && modelo ? modelo.tot.val / serie.length : null
  const projecaoMes = mediaDia != null ? mediaDia * 30 : null

  const CORES_LINHA = ['#C8941A', '#3D2314', '#6B5D4F', '#9C8E80', '#E0B048', '#2f6f8f', '#3f7d4e']

  // Bloco 3 — aba Vendedores. Mesmas definições do placar v5 (motor-v5): ticket = faturamento ÷ notas;
  // R$/kg = preço da análise sem despojo; índice = faturamento ÷ valor esperado ao preço médio da empresa;
  // desconto = soma (tabela − praticado) ÷ tabela; devolução = devoluções ÷ faturamento.
  const vendedores = useMemo(() => {
    if (!modelo || !base) return [] as VendRow[]
    return [...modelo.venM].map(([vi, a]) => {
      const dev = modelo.devVen.get(vi) || 0
      const pz = modelo.venPz.get(vi)
      return {
        nome: base.ven[vi]?.[1] || base.ven[vi]?.[0] || 'Sem vendedor',
        val: a.val,
        part: 100 * a.val / (modelo.tot.val || 1),
        cli: a.clis.size,
        notas: a.notas.size,
        ticket: a.notas.size ? a.val / a.notas.size : null,
        rpkg: a.kgP ? a.valP / a.kgP : null,
        // Índice na base da análise (valP, só o que entra na conta) contra o esperado (exp), mesma base do R$/kg.
        idx: a.exp > 0 ? 100 * a.valP / a.exp : null,
        desc: a.tab > 0 ? 100 * a.desc / a.tab : 0,
        dev,
        devPct: a.val ? 100 * dev / a.val : 0,
        prazo: pz && pz[1] ? pz[0] / pz[1] : null,
      }
    }).sort((x, y) => y.val - x.val)
  }, [modelo, base])

  // O que cada um vende: faturamento por linha dentro de cada vendedor (100% empilhado no gráfico).
  const mixVendedor = useMemo(() => {
    if (!modelo || !base) return { linhas: [] as string[], rows: [] as Record<string, string | number>[] }
    const porVen = new Map<number, Map<string, number>>()
    const linhasSet = new Set<string>()
    modelo.its.forEach((x) => {
      const linha = base.prod[x[4]]?.[1] || '—'
      linhasSet.add(linha)
      let m = porVen.get(x[2]); if (!m) { m = new Map(); porVen.set(x[2], m) }
      m.set(linha, (m.get(linha) || 0) + x[6])
    })
    const linhas = [...linhasSet].sort()
    const rows = [...porVen].map(([vi, m]) => {
      const row: Record<string, string | number> = { nome: base.ven[vi]?.[1] || base.ven[vi]?.[0] || 'Sem vendedor' }
      linhas.forEach((l) => { row[l] = m.get(l) || 0 })
      return row
    })
    return { linhas, rows }
  }, [modelo, base])

  if (!empresa) {
    return <div style={{ padding: 16, color: C.m }}>Escolha uma empresa para ver o painel.</div>
  }

  return (
    <div style={{ padding: 16, background: C.off, color: C.esp, minHeight: '100vh', maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>Como a Frioeste está vendendo</h1>
      <p style={{ fontSize: 14, color: C.m, margin: '0 0 16px' }}>
        {base ? <>De {dataBR(base.de)} a {dataBR(base.ate)}.</> : null}
        {carregando ? ' Carregando…' : null}
        {erro ? <span style={{ color: '#C0392B' }}> {erro}</span> : null}
      </p>

      {r && modelo && (
        <>
          <p style={{ fontSize: 16, lineHeight: 1.5, margin: '0 0 16px' }}>
            Faturou <b>{brl0(r.totalValor)}</b> em <b>{ton(modelo.tot.kg)}</b>, para <b>{int(r.clientes)} clientes</b>. Sem o despojo, o quilo sai a <b>{brl2(r.precoPorKg)}</b>.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
            <Cartao rot="Faturamento" chave="com.painel.faturado" valor={brl0(r.totalValor)} />
            <Cartao rot="Volume na análise" chave="com.painel.volume" valor={ton(modelo.tot.kgP)} />
            <Cartao rot="Preço médio" chave="com.painel.preco" valor={brl2(r.precoPorKg)} sub="R$/kg sem despojo" />
            <Cartao rot="Ticket por nota" chave="com.painel.ticket" valor={brl0(ticketNota)} sub={`${int(notas)} notas`} />
          </div>

          <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.m, marginBottom: 8 }}>Faturamento por dia</div>
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={C.bd} />
                  <XAxis dataKey="rot" tick={{ fontSize: 11, fill: C.m }} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v: number) => brl0(v)} tick={{ fontSize: 11, fill: C.m }} width={84} />
                  <Tooltip formatter={(v) => brl0(Number(v))} labelFormatter={(_, p) => dataBR(String(p?.[0]?.payload?.dia ?? ''))} />
                  <Bar dataKey="val" fill={C.gold} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginTop: 16 }}>
            <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.m, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>Do que vive a Frioeste<AjudaCampo chave="com.painel.produtos" rota={ROTA} /></div>
              <div style={{ width: '100%', height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={linhas} dataKey="val" nameKey="nome" innerRadius={55} outerRadius={85} paddingAngle={2}>
                      {linhas.map((l, i) => <Cell key={l.nome} fill={CORES_LINHA[i % CORES_LINHA.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => brl0(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', fontSize: 13 }}>
                {linhas.map((l, i) => (
                  <li key={l.nome} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0' }}>
                    <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: CORES_LINHA[i % CORES_LINHA.length], marginRight: 6 }} />{l.nome}</span>
                    <span style={{ color: C.m }}>{brl0(l.val)} · {nf({ maximumFractionDigits: 1 }).format(l.part)}%</span>
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.m, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>Ritmo da semana<AjudaCampo chave="com.painel.meses" rota={ROTA} /></div>
              <div style={{ width: '100%', height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ritmoSemana} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={C.bd} />
                    <XAxis dataKey="rot" tick={{ fontSize: 12, fill: C.m }} />
                    <YAxis tickFormatter={(v: number) => brl0(v)} tick={{ fontSize: 11, fill: C.m }} width={84} />
                    <Tooltip formatter={(v) => brl0(Number(v))} />
                    <Bar dataKey="val" fill={C.esp} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Para onde vai o mês<AjudaCampo chave="com.painel.meses" rota={ROTA} /></div>
              <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6 }}>{brl0(projecaoMes)}</div>
              <div style={{ fontSize: 13, color: C.m, marginTop: 4 }}>
                Estimativa no ritmo do período: {brl0(mediaDia)} por dia com venda × 30 dias.
              </div>
            </div>

            <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Preço médio do kg<AjudaCampo chave="com.painel.rpkg" rota={ROTA} /></div>
              <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6 }}>{brl2(r.precoPorKg)}</div>
              <div style={{ fontSize: 13, color: C.m, marginTop: 4 }}>Sem despojo: carne e miúdo. Fora da conta: inativos e subprodutos bovinos.</div>
            </div>
          </div>

          <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16, marginTop: 12, overflowX: 'auto' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.m, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>As linhas de produto<AjudaCampo chave="com.painel.produtos" rota={ROTA} /></div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ color: C.m, textAlign: 'left' }}>
                  <th style={{ padding: '6px 4px' }}>Linha</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Faturamento</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Part.</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>R$/kg</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.nome} style={{ borderTop: `1px solid ${C.bd}` }}>
                    <td style={{ padding: '6px 4px' }}>{l.nome}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl0(l.val)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{nf({ maximumFractionDigits: 1 }).format(l.part)}%</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl2(l.rpkg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 24, fontSize: 18, fontWeight: 700 }}>Vendedores</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginTop: 8 }}>
            <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.m, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>Quem vende quanto<AjudaCampo chave="com.painel.equipe" rota={ROTA} /></div>
              <div style={{ width: '100%', height: Math.max(180, vendedores.length * 34) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={vendedores} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid horizontal={false} stroke={C.bd} />
                    <XAxis type="number" tickFormatter={(v: number) => brl0(v)} tick={{ fontSize: 11, fill: C.m }} />
                    <YAxis type="category" dataKey="nome" width={130} tick={{ fontSize: 12, fill: C.esp }} />
                    <Tooltip formatter={(v) => brl0(Number(v))} />
                    <Bar dataKey="val" fill={C.gold} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.m, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>Desconto × devolução<AjudaCampo chave="com.painel.desconto" rota={ROTA} /></div>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid stroke={C.bd} />
                    <XAxis type="number" dataKey="desc" name="Desconto" unit="%" tick={{ fontSize: 11, fill: C.m }} />
                    <YAxis type="number" dataKey="devPct" name="Devolução" unit="%" tick={{ fontSize: 11, fill: C.m }} width={48} />
                    <ZAxis range={[80, 80]} />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v, n) => `${nf({ maximumFractionDigits: 2 }).format(Number(v))}${n === 'Desconto' || n === 'Devolução' ? '%' : ''}`} />
                    <Scatter data={vendedores} fill={C.esp} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div style={{ fontSize: 12, color: C.m, marginTop: 4 }}>Cada ponto é um vendedor: à direita, mais desconto; acima, mais devolução.</div>
            </div>

            <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.m, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>O que cada um vende<AjudaCampo chave="com.painel.produtos" rota={ROTA} /></div>
              <div style={{ width: '100%', height: Math.max(180, mixVendedor.rows.length * 34) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={mixVendedor.rows} layout="vertical" stackOffset="expand" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="nome" width={130} tick={{ fontSize: 12, fill: C.esp }} />
                    <Tooltip formatter={(v) => brl0(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {mixVendedor.linhas.map((l, i) => (
                      <Bar key={l} dataKey={l} stackId="mix" fill={CORES_LINHA[i % CORES_LINHA.length]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16, marginTop: 12, overflowX: 'auto' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.m, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>Placar dos vendedores<AjudaCampo chave="com.painel.faturado" rota={ROTA} /></div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 820 }}>
              <thead>
                <tr style={{ color: C.m, textAlign: 'left' }}>
                  <th style={{ padding: '6px 4px' }}>Vendedor</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Faturamento</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Part.</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Clientes</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Ticket</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>R$/kg</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Índice</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Desconto</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Devolução</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Prazo</th>
                </tr>
              </thead>
              <tbody>
                {vendedores.map((v) => (
                  <tr key={v.nome} style={{ borderTop: `1px solid ${C.bd}` }}>
                    <td style={{ padding: '6px 4px' }}>{v.nome}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl0(v.val)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{nf({ maximumFractionDigits: 1 }).format(v.part)}%</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{int(v.cli)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl0(v.ticket)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl2(v.rpkg)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{v.idx == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v.idx)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{nf({ maximumFractionDigits: 2 }).format(v.desc)}%</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl0(v.dev)} · {nf({ maximumFractionDigits: 2 }).format(v.devPct)}%</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{v.prazo == null ? '—' : `${nf({ maximumFractionDigits: 0 }).format(v.prazo)} dias`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div style={{ marginTop: 16, fontSize: 12, color: C.d }}>
        <AjudaCampo chave="com.painel.faturado" rota={ROTA} /> Esta é a versão nova do painel. O painel atual continua disponível.
      </div>
    </div>
  )
}

function Cartao({ rot, chave, valor, sub }: { rot: string; chave: string; valor: string; sub?: string }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>{rot}<AjudaCampo chave={chave} rota={ROTA} /></div>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.esp, marginTop: 4 }}>{valor}</div>
      {sub ? <div style={{ fontSize: 12, color: C.d, marginTop: 2 }}>{sub}</div> : null}
    </div>
  )
}
