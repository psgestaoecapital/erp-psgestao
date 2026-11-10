'use client'
// Comercial › Meu painel v6 (storytelling) — bloco 1: "Como a Frioeste está vendendo".
// Rota NOVA e separada do v5 (/dashboard/comercial/meu-painel), que continua intacto até o v6 ser validado.
// A tela só desenha: o cálculo vive em ../meu-painel/motor-v5 (mesmo motor já provado contra o aceite),
// alimentado pela RPC fn_bi_comercial_base, que trava o escopo no banco (líder vê a empresa; vendedor só o próprio).
// Fonte: fn_com_venda_item / bi_comercial_venda_item_mv (R$ 13.983.740 no aceite). Nunca a MV inflada.
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
const ton = (kg: number | null | undefined) => kg == null ? '—' : nf({ maximumFractionDigits: 1 }).format(kg / 1000) + ' t'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const diaISO = (base: string, n: number) => {
  const [y, m, d] = base.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000)
  return t.toISOString().slice(0, 10)
}
const dataBR = (isoDia: string) => { const [y, m, d] = isoDia.split('-'); return `${d}/${m}/${y}` }

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
