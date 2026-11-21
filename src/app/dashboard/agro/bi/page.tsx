'use client'

// BI PECUÁRIA · Agro — fatia 1 (CEO 13/11/2026, piloto Estância Umuarama).
// Genérico e multi-tenant: nada hardcoded. Lê só portas guardadas:
//   fn_pec_painel_rebanho (estoque), fn_agro_dashboard.series_rebanho (evolução),
//   fn_pec_bi_vendas (compras × vendas). RD-26: reusa o dado que o Agro já cria.
// RD-95: "?" em cada filtro, indicador e gráfico. RD-96: layout próprio PS. Mobile-first.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { comPrazo } from '@/lib/comPrazo'
import { useEmpresaSelecionada } from '@/lib/agro/usePecuaria'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/agro/bi'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.6)'
const GREEN = '#3B6D11', BLUE = '#2F5AA8'
const PALETA = ['#3B6D11', '#BA7517', '#8B5CF6', '#2F5AA8', '#A32D2D', '#0D9488', '#C8941A', '#6B5D4F']

const brl = (n: number | null | undefined) =>
  'R$ ' + Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const int = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('pt-BR')
const mesLabel = (ym: string) => { const [y, m] = (ym || '').split('-'); return y ? `${m}/${y.slice(2)}` : ym }
const catLabel = (c: string) => ({
  matriz: 'Matrizes', touro: 'Touros', bezerro: 'Bezerros', bezerra: 'Bezerras', garrote: 'Garrotes',
  novilha: 'Novilhas', boi_magro: 'Boi magro', boi_gordo: 'Boi gordo', descarte: 'Descarte', outro: 'Outros',
} as Record<string, string>)[c] ?? c

type Propriedade = { id: string; nome: string }
type Painel = { total_cabecas: number; por_categoria: Array<{ categoria: string; qtd: number }>; lotes_ativos: number; areas: number; propriedades: number }
type SerieReb = { mes: string; liquido: number; acumulado: number }
type ResumoLado = { cabecas: number; valor: number; peso_kg: number; preco_medio_cab: number; preco_kg: number }
type Vendas = { ok: boolean; resumo?: { venda: ResumoLado; compra: ResumoLado }; series?: Array<{ mes: string; venda_cab: number; venda_valor: number; compra_cab: number; compra_valor: number }> }

function anoCorrente() {
  const y = new Date().getFullYear()
  return { de: `${y}-01-01`, ate: `${y}-12-31` }
}

export default function BiPecuariaPage() {
  const { companyId } = useEmpresaSelecionada()
  const [props, setProps] = useState<Propriedade[]>([])
  const [propId, setPropId] = useState<string>('')          // '' = todas
  const [periodo, setPeriodo] = useState(anoCorrente())
  const [painel, setPainel] = useState<Painel | null>(null)
  const [serieReb, setSerieReb] = useState<SerieReb[]>([])
  const [vendas, setVendas] = useState<Vendas | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState(false)

  // Lista de propriedades para o filtro (RLS por empresa aplica na leitura do usuário).
  useEffect(() => {
    if (!companyId) { setProps([]); return }
    let alive = true
    ;(async () => {
      try {
        const { data } = await supabase.from('erp_pec_propriedade')
          .select('id, nome').eq('company_id', companyId).eq('ativo', true).order('nome')
        if (alive) setProps((data ?? []) as Propriedade[])
      } catch { if (alive) setProps([]) }
    })()
    return () => { alive = false }
  }, [companyId])

  const carregar = useCallback(async () => {
    if (!companyId) return
    setLoading(true); setErro(false)
    const prop = propId || null
    try {
      const [p, d, v] = await comPrazo(() => Promise.all([
        supabase.rpc('fn_pec_painel_rebanho', { p_company_id: companyId, p_propriedade_id: prop }),
        supabase.rpc('fn_agro_dashboard', { p_company_id: companyId, p_data_inicio: periodo.de, p_data_fim: periodo.ate }),
        supabase.rpc('fn_pec_bi_vendas', { p_company_id: companyId, p_de: periodo.de, p_ate: periodo.ate, p_propriedade_id: prop }),
      ]), { ms: 9000, tentativas: 1, label: 'agro_bi' })
      setPainel((p.data as Painel) ?? null)
      setSerieReb((((d.data as { series_rebanho?: SerieReb[] })?.series_rebanho) ?? []))
      setVendas((v.data as Vendas) ?? null)
    } catch {
      setErro(true)
    } finally {
      setLoading(false)
    }
  }, [companyId, propId, periodo])

  useEffect(() => { void carregar() }, [carregar])

  const catData = useMemo(() => (painel?.por_categoria ?? [])
    .map((c) => ({ nome: catLabel(c.categoria), qtd: Number(c.qtd) }))
    .sort((a, b) => b.qtd - a.qtd), [painel])

  const rv = vendas?.resumo?.venda
  const rc = vendas?.resumo?.compra
  const serieVendas = vendas?.series ?? []
  const temVendas = (rv?.cabecas ?? 0) > 0 || (rc?.cabecas ?? 0) > 0

  if (!companyId) {
    return <Wrap><Info>Selecione uma empresa específica (não consolidado) para abrir o BI da Pecuária.</Info></Wrap>
  }

  return (
    <Wrap>
      <header className="mb-4">
        <div className="text-xs uppercase tracking-widest font-semibold" style={{ color: GOLD }}>🐂 Agro · Pecuária</div>
        <h1 className="text-2xl sm:text-3xl mt-1" style={{ fontFamily: 'ui-serif,Georgia,serif', fontWeight: 600, color: ESP }}>BI da Pecuária</h1>
        <p className="text-[13px] mt-1" style={{ color: ESP60 }}>O rebanho e os negócios do gado para decidir. Ajuste o período e a propriedade.</p>
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 mb-5 p-3 rounded-xl" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
        <label className="block">
          <span className="flex items-center text-[12px] font-semibold mb-1" style={{ color: ESP }}>
            Período <AjudaCampo rota={ROTA} chave="agro_bi.periodo" />
          </span>
          <span className="flex items-center gap-2">
            <input type="date" value={periodo.de} max={periodo.ate}
              onChange={(e) => setPeriodo((p) => ({ ...p, de: e.target.value }))}
              className="text-[13px] px-2 py-1.5 rounded-lg border" style={{ borderColor: LINE, color: ESP }} />
            <span style={{ color: ESP60 }}>até</span>
            <input type="date" value={periodo.ate} min={periodo.de}
              onChange={(e) => setPeriodo((p) => ({ ...p, ate: e.target.value }))}
              className="text-[13px] px-2 py-1.5 rounded-lg border" style={{ borderColor: LINE, color: ESP }} />
          </span>
        </label>
        <label className="block">
          <span className="flex items-center text-[12px] font-semibold mb-1" style={{ color: ESP }}>
            Propriedade <AjudaCampo rota={ROTA} chave="agro_bi.propriedade" />
          </span>
          <select value={propId} onChange={(e) => setPropId(e.target.value)}
            className="text-[13px] px-2 py-1.5 rounded-lg border bg-white" style={{ borderColor: LINE, color: ESP }}>
            <option value="">Todas as propriedades</option>
            {props.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </label>
        {loading && <span className="text-[12px] self-center" style={{ color: ESP60 }}>Atualizando…</span>}
      </div>

      {erro && <Info>Não foi possível carregar os indicadores agora. Tente de novo em instantes.</Info>}

      {/* 1 · Rebanho hoje */}
      <Section titulo="Rebanho hoje" sub="Foto do estoque de animais ativos (não depende do período).">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Kpi rotulo="Cabeças no rebanho" chave="agro_bi.total_cabecas" valor={int(painel?.total_cabecas)} cor={GREEN} />
          <Kpi rotulo="Lotes, áreas e prop." chave="agro_bi.lotes_ativos"
            valor={`${int(painel?.lotes_ativos)} · ${int(painel?.areas)} · ${int(painel?.propriedades)}`} />
        </div>
        <ChartTitulo titulo="Rebanho por categoria" chave="agro_bi.por_categoria" />
        {catData.length === 0
          ? <Vazio texto="Sem animais ativos para esta seleção. Cadastre o rebanho em Rebanho & Cadastro para ver a composição aqui." />
          : <ChartBox>
              <BarChart data={catData} layout="vertical" margin={{ left: 12, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={LINE} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: ESP60 }} />
                <YAxis type="category" dataKey="nome" width={92} tick={{ fontSize: 11, fill: ESP }} />
                <Tooltip formatter={(v) => [int(Number(v)), 'Cabeças']} />
                <Bar dataKey="qtd" name="Cabeças" radius={[0, 4, 4, 0]}>
                  {catData.map((_, i) => <Cell key={i} fill={PALETA[i % PALETA.length]} />)}
                </Bar>
              </BarChart>
            </ChartBox>}
      </Section>

      {/* 2 · Evolução do rebanho */}
      <Section titulo="Evolução do rebanho" sub="Saldo de cabeças mês a mês (empresa toda). Barras = líquido do mês; linha = acumulado.">
        <ChartTitulo titulo="Cabeças ao longo do tempo" chave="agro_bi.evolucao_rebanho" />
        {serieReb.length === 0
          ? <Vazio texto="Sem movimentações de rebanho no período. As entradas e saídas (nascimento, compra, venda) aparecem aqui mês a mês." />
          : <ChartBox>
              <ComposedChart data={serieReb}>
                <CartesianGrid strokeDasharray="3 3" stroke={LINE} />
                <XAxis dataKey="mes" tickFormatter={mesLabel} tick={{ fontSize: 11, fill: ESP60 }} />
                <YAxis tick={{ fontSize: 11, fill: ESP60 }} />
                <Tooltip labelFormatter={(l) => mesLabel(String(l))} formatter={(v, n) => [int(Number(v)), n === 'acumulado' ? 'Acumulado' : 'Líquido do mês']} />
                <Legend />
                <Bar dataKey="liquido" name="Líquido do mês" fill={GOLD} radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="acumulado" name="Cabeças (acum.)" stroke={GREEN} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ChartBox>}
      </Section>

      {/* 3 · Compras × Vendas */}
      <Section titulo="Compras × vendas de gado" sub="Negócios do rebanho no período selecionado.">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Kpi rotulo="Cabeças vendidas" chave="agro_bi.vendas_cabecas" valor={int(rv?.cabecas)} cor={GREEN} />
          <Kpi rotulo="Receita de venda" chave="agro_bi.vendas_valor" valor={brl(rv?.valor)} cor={GREEN} />
          <Kpi rotulo="Preço médio / cabeça" chave="agro_bi.preco_medio_cab" valor={brl(rv?.preco_medio_cab)} />
          <Kpi rotulo="Preço médio / kg" chave="agro_bi.preco_kg" valor={brl(rv?.preco_kg)} />
        </div>
        {(rc?.cabecas ?? 0) > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Kpi rotulo="Cabeças compradas" chave="agro_bi.compras_vendas_mes" valor={int(rc?.cabecas)} cor={BLUE} />
            <Kpi rotulo="Gasto com compra" chave="agro_bi.compras_vendas_mes" valor={brl(rc?.valor)} cor={BLUE} />
          </div>
        )}
        <ChartTitulo titulo="Compras × vendas por mês (cabeças)" chave="agro_bi.compras_vendas_mes" />
        {!temVendas || serieVendas.length === 0
          ? <Vazio texto="Sem compras ou vendas de gado no período. Registre a venda por cabeça em Movimentações para acompanhar o giro aqui." />
          : <ChartBox>
              <BarChart data={serieVendas}>
                <CartesianGrid strokeDasharray="3 3" stroke={LINE} />
                <XAxis dataKey="mes" tickFormatter={mesLabel} tick={{ fontSize: 11, fill: ESP60 }} />
                <YAxis tick={{ fontSize: 11, fill: ESP60 }} />
                <Tooltip labelFormatter={(l) => mesLabel(String(l))} formatter={(v, n) => [int(Number(v)), n === 'venda_cab' ? 'Vendidas' : 'Compradas']} />
                <Legend />
                <Bar dataKey="venda_cab" name="Vendidas" fill={GREEN} radius={[4, 4, 0, 0]} />
                <Bar dataKey="compra_cab" name="Compradas" fill={BLUE} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartBox>}
      </Section>
    </Wrap>
  )
}

/* ── UI helpers (layout próprio PS, RD-96) ───────────────────────────────────────── */
function Wrap({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen px-4 sm:px-6 py-5" style={{ background: BG }}>
    <div className="max-w-5xl mx-auto">{children}</div>
  </div>
}
function Section({ titulo, sub, children }: { titulo: string; sub?: string; children: React.ReactNode }) {
  return <section className="mb-5 p-4 rounded-2xl" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
    <div className="mb-3">
      <h2 className="text-lg" style={{ fontFamily: 'ui-serif,Georgia,serif', fontWeight: 600, color: ESP }}>{titulo}</h2>
      {sub && <p className="text-[12px] mt-0.5" style={{ color: ESP60 }}>{sub}</p>}
    </div>
    {children}
  </section>
}
function Kpi({ rotulo, chave, valor, cor }: { rotulo: string; chave: string; valor: string; cor?: string }) {
  return <div className="p-3 rounded-xl" style={{ background: BG, border: `1px solid ${LINE}` }}>
    <div className="flex items-center text-[11px] font-semibold" style={{ color: ESP60 }}>
      {rotulo} <AjudaCampo rota={ROTA} chave={chave} />
    </div>
    <div className="text-lg sm:text-xl mt-0.5 font-semibold" style={{ color: cor ?? ESP }}>{valor}</div>
  </div>
}
function ChartTitulo({ titulo, chave }: { titulo: string; chave: string }) {
  return <div className="flex items-center text-[12px] font-semibold mb-1" style={{ color: ESP }}>
    {titulo} <AjudaCampo rota={ROTA} chave={chave} />
  </div>
}
function ChartBox({ children }: { children: React.ReactElement }) {
  return <div style={{ width: '100%', height: 280 }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>
}
function Vazio({ texto }: { texto: string }) {
  return <div className="text-[13px] px-3 py-6 rounded-xl text-center" style={{ background: BG, border: `1px dashed ${LINE}`, color: ESP60 }}>{texto}</div>
}
function Info({ children }: { children: React.ReactNode }) {
  return <div className="text-[13px] px-4 py-3 rounded-xl" style={{ background: '#fff', border: `1px solid ${LINE}`, color: ESP }}>{children}</div>
}
