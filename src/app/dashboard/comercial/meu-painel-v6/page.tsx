'use client'
// Comercial › Meu painel v6 (storytelling) — aba "Visão geral".
// Rota NOVA e separada do v5 (/dashboard/comercial/meu-painel), que continua intacto até o v6 ser validado.
// A tela só desenha: o cálculo vive em ../meu-painel/motor-v5 (mesmo motor já provado contra o aceite),
// alimentado pela RPC fn_bi_comercial_base, que trava o escopo no banco (líder vê a empresa; vendedor só o próprio).
// Fonte: fn_com_venda_item / bi_comercial_venda_item_mv (R$ 13.983.740 no aceite). Nunca a MV inflada.
//
// Bloco 1 ("Como a Frioeste está vendendo"): faturamento, volume, preço, ticket e faturamento por dia.
// Bloco 2 (este PR): "As linhas de produto" (de onde vem o faturamento) e "Ritmo da semana" (dias que mais vendem).
// As chaves de ajuda "?" são do v6 (comv6.*), com a rota do v6 — a ajuda é carregada por rota (fn_ajuda_campo_listar).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
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
const pct = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'percent', maximumFractionDigits: 1 }).format(v)
const ton = (kg: number | null | undefined) => kg == null ? '—' : nf({ maximumFractionDigits: 1 }).format(kg / 1000) + ' t'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const diaISO = (base: string, n: number) => {
  const [y, m, d] = base.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000)
  return t.toISOString().slice(0, 10)
}
const dataBR = (isoDia: string) => { const [y, m, d] = isoDia.split('-'); return `${d}/${m}/${y}` }
const diaDaSemana = (isoDia: string) => { const [y, m, d] = isoDia.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
// ordem de exibição: segunda a domingo (dia de trabalho primeiro)
const SEMANA: { dow: number; curto: string; nome: string }[] = [
  { dow: 1, curto: 'Seg', nome: 'segunda-feira' }, { dow: 2, curto: 'Ter', nome: 'terça-feira' },
  { dow: 3, curto: 'Qua', nome: 'quarta-feira' }, { dow: 4, curto: 'Qui', nome: 'quinta-feira' },
  { dow: 5, curto: 'Sex', nome: 'sexta-feira' }, { dow: 6, curto: 'Sáb', nome: 'sábado' },
  { dow: 0, curto: 'Dom', nome: 'domingo' },
]

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

  // Bloco 2a — "As linhas de produto": de onde vem o faturamento, por linha, com participação e R$/kg (análise).
  const linhas = useMemo(() => {
    if (!modelo) return [] as { nome: string; val: number; kg: number; part: number; rkg: number | null }[]
    const tot = modelo.tot.val || 1
    return [...modelo.linM.entries()]
      .map(([nome, a]) => ({ nome, val: a.val, kg: a.kg, part: a.val / tot, rkg: a.kgP > 0 ? a.valP / a.kgP : null }))
      .sort((a, b) => b.val - a.val)
  }, [modelo])

  // Bloco 2b — "Ritmo da semana": faturamento somado por dia da semana, mais quantas ocorrências do dia no período.
  const ritmo = useMemo(() => {
    if (!modelo || !base) return [] as { curto: string; nome: string; val: number; ocorr: number }[]
    const porDow = new Map<number, { val: number; dias: Set<string> }>()
    for (const [d, a] of modelo.diaM) {
      const isoDia = diaISO(base.de, d)
      const dow = diaDaSemana(isoDia)
      let acc = porDow.get(dow)
      if (!acc) { acc = { val: 0, dias: new Set() }; porDow.set(dow, acc) }
      acc.val += a.val; acc.dias.add(isoDia)
    }
    return SEMANA.map((s) => ({ curto: s.curto, nome: s.nome, val: porDow.get(s.dow)?.val ?? 0, ocorr: porDow.get(s.dow)?.dias.size ?? 0 }))
      .filter((x) => x.ocorr > 0)
  }, [modelo, base])

  const picoSemana = useMemo(() => ritmo.length ? ritmo.reduce((a, b) => (b.val > a.val ? b : a)) : null, [ritmo])

  const notas = modelo?.tot.notas.size ?? 0
  const ticketNota = notas ? (modelo?.tot.val ?? 0) / notas : null

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
            <Cartao rot="Faturamento" chave="comv6.faturado" valor={brl0(r.totalValor)} />
            <Cartao rot="Volume na análise" chave="comv6.volume" valor={ton(modelo.tot.kgP)} />
            <Cartao rot="Preço médio" chave="comv6.preco" valor={brl2(r.precoPorKg)} sub="R$/kg sem despojo" />
            <Cartao rot="Ticket por nota" chave="comv6.ticket" valor={brl0(ticketNota)} sub={`${int(notas)} notas`} />
          </div>

          <Bloco titulo="Faturamento por dia" chave="comv6.fat_dia">
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
          </Bloco>

          {/* Bloco 2a — As linhas de produto */}
          <Bloco titulo="As linhas de produto" chave="comv6.linhas">
            <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
              {linhas.length ? <>De onde vem o faturamento. A linha <b>{linhas[0].nome.toLowerCase()}</b> responde por <b>{pct(linhas[0].part)}</b> do total.</> : 'Sem venda no período.'}
            </p>
            <div style={{ display: 'grid', gap: 8 }}>
              {linhas.map((l) => (
                <div key={l.nome} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, alignItems: 'center' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.nome}</span>
                      <span style={{ color: C.m, flexShrink: 0 }}>{brl0(l.val)} · {pct(l.part)}</span>
                    </div>
                    <div style={{ height: 8, background: C.bd, borderRadius: 4, marginTop: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.max(2, Math.round(l.part * 100))}%`, background: C.gold }} />
                    </div>
                    <div style={{ fontSize: 11, color: C.d, marginTop: 2 }}>{ton(l.kg)}{l.rkg != null ? <> · {brl2(l.rkg)}/kg</> : <> · despojo/subproduto (fora do preço)</>}</div>
                  </div>
                </div>
              ))}
            </div>
          </Bloco>

          {/* Bloco 2b — Ritmo da semana */}
          <Bloco titulo="Ritmo da semana" chave="comv6.ritmo">
            <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
              {picoSemana ? <>O dia mais forte é <b>{picoSemana.nome}</b>, com <b>{brl0(picoSemana.val)}</b> no período.</> : 'Sem venda no período.'}
            </p>
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ritmo} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={C.bd} />
                  <XAxis dataKey="curto" tick={{ fontSize: 12, fill: C.m }} />
                  <YAxis tickFormatter={(v: number) => brl0(v)} tick={{ fontSize: 11, fill: C.m }} width={84} />
                  <Tooltip formatter={(v) => brl0(Number(v))} labelFormatter={(_, p) => { const d = p?.[0]?.payload; return d ? `${d.nome} · ${d.ocorr}× no período` : '' }} />
                  <Bar dataKey="val" fill={C.esp} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Bloco>
        </>
      )}

      {!carregando && !erro && modelo && !modelo.its.length && (
        <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 24, textAlign: 'center', color: C.m }}>
          Nenhuma venda no período de {base ? dataBR(base.de) : ''} a {base ? dataBR(base.ate) : ''}. Ajuste o período ou confira se a importação do dia já rodou.
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 12, color: C.d }}>
        <AjudaCampo chave="comv6.faturado" rota={ROTA} /> Esta é a versão nova do painel. O painel atual continua disponível.
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

function Bloco({ titulo, chave, children }: { titulo: string; chave: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.m, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>{titulo}<AjudaCampo chave={chave} rota={ROTA} /></div>
      {children}
    </div>
  )
}
