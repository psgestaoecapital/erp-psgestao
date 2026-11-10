'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { authFetch } from '@/lib/authFetch'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { supabase } from '@/lib/supabase'
import { C, METODO_LABEL, MESES_PT, fmtBRL, fmtPct } from './_components'
import { ComoCalculadoModal } from './_components/ComoCalculadoModal'
import { GraficoBarrasEbitda, GraficoSerie12m } from './_components/Graficos'
import { TabelaDetalhada } from './_components/TabelaDetalhada'
import VincularCategoriasModal from '@/components/dre/VincularCategoriasModal'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA_AJUDA = '/dashboard/dre-divisional'

type ViewMode = 'mes' | 'ytd' | 'serie_12m'

type Linha = {
  ln_id: string
  ln_nome: string
  rob: number
  cmv: number
  desp_variavel: number
  desp_fixa: number
  margem_bruta: number
  margem_contribuicao: number
  ebitda_pre_rateio: number
  rateio_sede_recebido: number
  ebitda_pos_rateio: number
  ebitda_pct_pos_rateio: number
  qtd_lancamentos: number
}

type SerieItem = { ano: number; mes: number; ln_id: string; ln_nome: string; ebitda_pos_rateio: number }

type DreResponse = {
  ok: true
  metadata: {
    empresa: { id: string; razao_social: string }
    periodo: { ano: number; mes: number; view_mode: ViewMode }
    metodo_rateio: string
    tem_lns_suficientes: boolean
    qtd_lns_ativas: number
  }
  linhas: Linha[]
  serie_12m: SerieItem[]
  totais: {
    receita_total: number
    ebitda_pre_total: number
    rateio_total: number
    ebitda_real_total: number
    qtd_lancamentos_total: number
  }
}

const HOJE = new Date()
const ANO_HOJE = HOJE.getFullYear()
const MES_HOJE = HOJE.getMonth() + 1

export default function DreDivisionalPage() {
  const { companyIds, selInfo, companies } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [ano, setAno] = useState(ANO_HOJE)
  const [mes, setMes] = useState(MES_HOJE)
  const [viewMode, setViewMode] = useState<ViewMode>('mes')
  const [modalAberto, setModalAberto] = useState(false)

  const [data, setData] = useState<DreResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ordemPersonalizada, setOrdemPersonalizada] = useState<Array<{ linha_id: string; ordem: number; visivel?: boolean }>>([])

  const [semVinculo, setSemVinculo] = useState(0)
  useEffect(() => {
    let ignore = false
    setSemVinculo(0)
    if (!empresaUnica) return
    supabase.rpc('fn_psgc_contas_sem_vinculo', { p_company_id: empresaUnica }).then(({ data: r }) => {
      if (!ignore && r && typeof r.qtd === 'number') setSemVinculo(r.qtd)
    })
    return () => { ignore = true }
  }, [empresaUnica])

  const carregar = useCallback(async () => {
    if (!empresaUnica) {
      setData(null)
      return
    }
    setLoading(true)
    setErro(null)
    try {
      const params = new URLSearchParams({
        company_id: empresaUnica,
        ano: String(ano),
        mes: String(mes),
        view_mode: viewMode,
      })
      const res = await authFetch(`/api/dre-divisional?${params.toString()}`)
      const j = await res.json()
      if (!j.ok) throw new Error(j.mensagem_humana || j.error || 'falha')
      setData(j as DreResponse)
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setLoading(false)
    }
  }, [empresaUnica, ano, mes, viewMode])

  useEffect(() => { carregar() }, [carregar])

  useEffect(() => {
    let ignore = false
    if (!empresaUnica) { setOrdemPersonalizada([]); return }
    ;(async () => {
      const { data: ordem } = await supabase.rpc('fn_dre_ordem_personalizada_get', { p_company_id: empresaUnica })
      if (!ignore) setOrdemPersonalizada((ordem ?? []) as Array<{ linha_id: string; ordem: number; visivel?: boolean }>)
    })()
    return () => { ignore = true }
  }, [empresaUnica])

  const linhasOrdenadas = useMemo<Linha[]>(() => {
    if (!data?.linhas) return []
    if (ordemPersonalizada.length === 0) return data.linhas
    const cfgMap = new Map(ordemPersonalizada.map((o) => [o.linha_id, o]))
    const filtradas = data.linhas.filter((l) => cfgMap.get(l.ln_id)?.visivel !== false)
    return filtradas.sort((a, b) => {
      const oa = cfgMap.get(a.ln_id)?.ordem ?? Number.MAX_SAFE_INTEGER
      const ob = cfgMap.get(b.ln_id)?.ordem ?? Number.MAX_SAFE_INTEGER
      return oa - ob
    })
  }, [data, ordemPersonalizada])

  async function handleReorderLinhas(novaOrdem: Linha[]) {
    if (!empresaUnica) return
    const visMap = new Map(ordemPersonalizada.map((o) => [o.linha_id, o.visivel ?? true]))
    const payload = novaOrdem.map((l, idx) => ({ linha_id: l.ln_id, ordem: idx, visivel: visMap.get(l.ln_id) ?? true }))
    setOrdemPersonalizada(payload)
    await supabase.rpc('fn_dre_ordem_personalizada_set', {
      p_company_id: empresaUnica,
      p_ordens: payload,
    })
  }

  async function handleResetOrdem() {
    if (!empresaUnica) return
    await supabase.rpc('fn_dre_ordem_personalizada_reset', { p_company_id: empresaUnica })
    setOrdemPersonalizada([])
  }

  const anos = useMemo(() => {
    const out: number[] = []
    for (let a = ANO_HOJE - 3; a <= ANO_HOJE + 1; a++) out.push(a)
    return out
  }, [])

  // Estado: nenhuma empresa específica selecionada
  if (!empresaUnica) {
    return (
      <Layout
        modalAberto={modalAberto}
        onAbrirModal={() => setModalAberto(true)}
        onFecharModal={() => setModalAberto(false)}
        empresa={null}
      >
        <EstadoSelecioneEmpresa companies={companies} />
      </Layout>
    )
  }

  return (
    <Layout
      modalAberto={modalAberto}
      onAbrirModal={() => setModalAberto(true)}
      onFecharModal={() => setModalAberto(false)}
      empresa={data?.metadata.empresa.razao_social || null}
    >
      {semVinculo > 0 && (
        <div data-testid="dre-aviso-sem-vinculo" role="status" style={{ marginBottom: 12, padding: '14px 16px', borderRadius: 10, background: 'white', border: `1px solid ${C.gold}`, boxShadow: '0 1px 3px rgba(61,35,20,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.espresso }}>Vincule {semVinculo} {semVinculo === 1 ? 'conta' : 'contas'} à DRE para o resultado ficar completo</span>
            <AjudaCampo chave="dre.divisional.aviso.sem_vinculo" rota={ROTA_AJUDA} />
          </div>
          <p style={{ margin: '0 0 10px', fontSize: 12.5, color: C.muted, lineHeight: 1.6 }}>
            Enquanto não vincular, {semVinculo === 1 ? 'essa conta herda' : 'essas contas herdam'} o vínculo da conta pai ou o tipo da conta — o resultado por divisão pode sair incompleto. Resolva em 2 passos:
          </p>
          <ol style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 12.5, color: C.espresso, lineHeight: 1.75 }}>
            <li>Abra o <b>Plano de Contas da DRE</b> e localize as contas marcadas como <b>sem vínculo</b>.</li>
            <li>Em cada uma, escolha o <b>grupo da DRE</b> (receita, custo, despesa, resultado) — a conta passa a somar na divisão certa.</li>
          </ol>
          <Link href="/dashboard/dre-divisional/plano-contas" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.gold, color: C.espresso, border: 'none', padding: '9px 16px', borderRadius: 8, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
            Vincular contas agora →
          </Link>
        </div>
      )}
      {/* Filtros sticky */}
      <section
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          background: C.offwhite,
          paddingBottom: 12,
          marginBottom: 16,
          borderBottom: `1px solid ${C.borderLt}`,
        }}
      >
        <div style={{ background: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={lbl()}>Mês:</span>
            <select value={mes} onChange={(e: any) => setMes(Number(e.target.value))} style={selStyle()}>
              {MESES_PT.map((nome, i) => (
                <option key={i + 1} value={i + 1}>{nome}</option>
              ))}
            </select>
            <AjudaCampo chave="dre.divisional.filtro.mes" rota={ROTA_AJUDA} />
            <select value={ano} onChange={(e: any) => setAno(Number(e.target.value))} style={selStyle()}>
              {anos.map((a) => (<option key={a} value={a}>{a}</option>))}
            </select>
            <AjudaCampo chave="dre.divisional.filtro.ano" rota={ROTA_AJUDA} />
          </div>

          <div style={{ display: 'flex', gap: 4, padding: 4, background: C.beigeLt, borderRadius: 8, alignItems: 'center' }}>
            {(['mes', 'ytd', 'serie_12m'] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                style={toggleStyle(viewMode === v)}
              >
                {v === 'mes' ? 'Mês atual' : v === 'ytd' ? 'YTD ano' : 'Série 12m'}
              </button>
            ))}
            <AjudaCampo chave="dre.divisional.filtro.visao" rota={ROTA_AJUDA} />
          </div>

          <span style={{ flex: 1 }} />

          {data?.metadata && (
            <span
              title={`Método aplicado para distribuir despesas SEDE entre as LNs.`}
              style={{
                padding: '6px 12px', borderRadius: 999,
                background: C.beigeLt, color: C.espresso,
                fontSize: 12, fontWeight: 600, border: `1px solid ${C.borderLt}`,
              }}
            >
              Rateio: {METODO_LABEL[data.metadata.metodo_rateio] || data.metadata.metodo_rateio}
            </span>
          )}
          {data?.metadata && <AjudaCampo chave="dre.divisional.rateio" rota={ROTA_AJUDA} alinhar="fim" />}
        </div>
      </section>

      {erro && (
        <div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
          {erro}
        </div>
      )}

      {loading && !data && (
        <section style={{ background: 'white', borderRadius: 12, padding: 32, textAlign: 'center', color: C.muted }}>
          Carregando…
        </section>
      )}

      {data && !data.metadata.tem_lns_suficientes && (
        <EstadoSemLNs />
      )}

      {data && data.metadata.tem_lns_suficientes && (
        <>
          <CardsTotais totais={data.totais} viewMode={viewMode} />
          <CardsPorLN linhas={linhasOrdenadas} companyId={empresaUnica} onChange={carregar} />
          <GraficoBarrasEbitda linhas={linhasOrdenadas} />
          {viewMode === 'serie_12m' && <GraficoSerie12m serie={data.serie_12m} />}
          <TabelaDetalhada
            linhas={linhasOrdenadas}
            totais={data.totais}
            onReorder={handleReorderLinhas}
            onReset={handleResetOrdem}
            isCustomOrder={ordemPersonalizada.length > 0}
          />
          <NotaTecnica />
        </>
      )}
    </Layout>
  )
}

// ───────────── Estados visuais ─────────────

function EstadoSelecioneEmpresa({ companies }: { companies: any[] }) {
  return (
    <section style={cardEstadoStyle()}>
      <SvgChartPie />
      <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, margin: '12px 0 4px', color: C.espresso }}>
        Selecione uma empresa específica
      </h2>
      <p style={{ margin: '0 auto 20px', fontSize: 14, color: C.muted, maxWidth: 480 }}>
        DRE Divisional analisa o resultado de uma empresa por linha de negócio.
        Use o seletor de empresas no topo para escolher uma das {companies.length} empresas disponíveis.
      </p>
    </section>
  )
}

function EstadoSemLNs() {
  return (
    <section style={cardEstadoStyle()}>
      <SvgChartPie />
      <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, margin: '12px 0 4px', color: C.espresso }}>
        Esta empresa ainda não tem linhas de negócio cadastradas
      </h2>
      <p style={{ margin: '0 auto 20px', fontSize: 14, color: C.muted, maxWidth: 480 }}>
        Para ver o DRE Divisional, cadastre pelo menos 2 linhas de negócio operacionais. O motor de rateio NBC TG 16 distribuirá automaticamente as despesas da estrutura SEDE.
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Link href="/dashboard/linhas-negocio/configurar" style={btnPrim()}>
          + Cadastrar linha de negócio
        </Link>
        <Link href="/dashboard/linhas-negocio" style={btnSec()}>
          Saiba mais sobre Linhas de Negócio
        </Link>
      </div>
    </section>
  )
}

// ───────────── Cards de totais ─────────────

function CardsTotais({ totais, viewMode }: { totais: DreResponse['totais']; viewMode: ViewMode }) {
  const pctReal = totais.receita_total > 0
    ? (totais.ebitda_real_total / totais.receita_total) * 100
    : 0
  const corReal = totais.ebitda_real_total >= 0 ? C.green : C.red

  return (
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 20 }}>
      <Card
        label="Receita Total"
        ajuda="dre.divisional.kpi.receita_total"
        valor={fmtBRL(totais.receita_total)}
        info={`${totais.qtd_lancamentos_total} lançamentos`}
        cor={C.espresso}
      />
      <Card
        label="EBITDA Antes Rateio"
        ajuda="dre.divisional.kpi.ebitda_pre"
        valor={fmtBRL(totais.ebitda_pre_total)}
        info="(Sem absorção SEDE)"
        cor={C.gold}
      />
      <Card
        label="EBITDA Real"
        ajuda="dre.divisional.kpi.ebitda_real"
        valor={fmtBRL(totais.ebitda_real_total)}
        info={`${fmtPct(pctReal)} sobre receita · após rateio NBC TG 16${viewMode === 'ytd' ? ' · YTD' : ''}`}
        cor={corReal}
      />
    </section>
  )
}

function Card({ label, valor, info, cor, ajuda }: { label: string; valor: string; info: string; cor: string; ajuda?: string }) {
  return (
    <div style={{ background: 'white', borderRadius: 12, padding: '16px 18px', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.2, textTransform: 'uppercase', opacity: 0.55, margin: 0, display: 'flex', alignItems: 'center' }}>
        {label}{ajuda && <AjudaCampo chave={ajuda} rota={ROTA_AJUDA} />}
      </p>
      <p style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, margin: '4px 0 0', color: cor }}>
        {valor}
      </p>
      <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 0' }}>{info}</p>
    </div>
  )
}

// ───────────── Cards por LN ─────────────

function CardsPorLN({ linhas, companyId, onChange }: { linhas: Linha[]; companyId: string | null; onChange?: () => void }) {
  return (
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginBottom: 20 }}>
      {linhas.map((l) => (
        <CardLN key={l.ln_id} linha={l} companyId={companyId} onChange={onChange} />
      ))}
    </section>
  )
}

function CardLN({ linha, companyId, onChange }: { linha: Linha; companyId: string | null; onChange?: () => void }) {
  const [vinculando, setVinculando] = useState(false)
  const positivo = linha.ebitda_pos_rateio >= 0
  const corReal = positivo ? C.green : C.red
  const corRealBg = positivo ? C.greenBg : C.redBg
  const pctPre = linha.rob > 0 ? (linha.ebitda_pre_rateio / linha.rob) * 100 : 0

  return (
    <div style={{ background: 'white', borderRadius: 12, padding: 18, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', border: `1px solid ${C.borderLt}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 500, margin: 0, color: C.espresso }}>
          {linha.ln_nome}
        </h3>
        <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: corRealBg, color: corReal }}>
          {positivo ? 'Lucro real' : 'Prejuízo real'}
        </span>
      </div>
      {companyId && (
        <span style={{ display: 'inline-flex', alignItems: 'center', alignSelf: 'flex-start' }}>
          <button
            type="button"
            onClick={() => setVinculando(true)}
            style={{ background: 'transparent', color: C.espresso, border: `0.5px solid ${C.borderLt}`, padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
          >
            + Vincular categorias
          </button>
          <AjudaCampo chave="dre.divisional.acao.vincular" rota={ROTA_AJUDA} />
        </span>
      )}
      {companyId && (
        <VincularCategoriasModal
          open={vinculando}
          onClose={() => setVinculando(false)}
          onSucesso={() => { setVinculando(false); onChange?.() }}
          companyId={companyId}
          ldnId={linha.ln_id}
          ldnNome={linha.ln_nome}
        />
      )}

      <Row label="Receita Bruta" valor={fmtBRL(linha.rob)} ajuda="dre.divisional.ln.receita_bruta" />
      <Row label="EBITDA Antes Rateio" valor={`${fmtBRL(linha.ebitda_pre_rateio)} · ${fmtPct(pctPre)}`} ajuda="dre.divisional.ln.ebitda_pre" />
      <Row label="Rateio SEDE Absorvido" valor={`-${fmtBRL(linha.rateio_sede_recebido)}`} ajuda="dre.divisional.ln.rateio_sede" />

      <div style={{ borderTop: `1px solid ${C.borderLt}`, paddingTop: 8, marginTop: 4 }}>
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.2, textTransform: 'uppercase', opacity: 0.55, margin: 0, display: 'flex', alignItems: 'center' }}>
          EBITDA Real<AjudaCampo chave="dre.divisional.ln.ebitda_real" rota={ROTA_AJUDA} />
        </p>
        <p style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, margin: '2px 0 0', color: corReal }}>
          {fmtBRL(linha.ebitda_pos_rateio)}
          <span style={{ fontSize: 14, marginLeft: 8, color: corReal, opacity: 0.8 }}>
            {fmtPct(linha.ebitda_pct_pos_rateio)}
          </span>
        </p>
        <p style={{ fontSize: 12, color: C.muted, margin: '2px 0 0' }}>
          {linha.qtd_lancamentos} {linha.qtd_lancamentos === 1 ? 'lançamento' : 'lançamentos'}
        </p>
      </div>
    </div>
  )
}

function Row({ label, valor, ajuda }: { label: string; valor: string; ajuda?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.ink }}>
      <span style={{ color: C.muted, display: 'inline-flex', alignItems: 'center' }}>{label}{ajuda && <AjudaCampo chave={ajuda} rota={ROTA_AJUDA} />}</span>
      <span style={{ fontWeight: 600, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{valor}</span>
    </div>
  )
}

function NotaTecnica() {
  return (
    <p style={{ fontSize: 11, color: C.muted, marginTop: 24, lineHeight: 1.6 }}>
      DRE Divisional calculado segundo NBC TG 16. Despesas da estrutura SEDE rateadas
      proporcionalmente à receita bruta de cada LN. Linhas com receita zero não absorvem
      rateio. Recálculo automático todo dia 04:15 UTC.
    </p>
  )
}

// ───────────── Layout wrapper ─────────────

function Layout({
  empresa, modalAberto, onAbrirModal, onFecharModal, children,
}: {
  empresa: string | null
  modalAberto: boolean
  onAbrirModal: () => void
  onFecharModal: () => void
  children: any
}) {
  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>
              Análises &gt; DRE Divisional
            </p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>
              DRE Divisional
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted }}>
              Resultado por linha de negócio com rateio NBC TG 16{empresa ? ` · ${empresa}` : ''}.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <Link
                href="/dashboard/dre-divisional/plano-contas"
                style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
              >
                🗂 Plano de contas
              </Link>
              <AjudaCampo chave="dre.divisional.acao.plano_contas" rota={ROTA_AJUDA} />
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <Link
                href="/dashboard/dre-divisional/configurar"
                style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
              >
                ⚙ Configurar ordem
              </Link>
              <AjudaCampo chave="dre.divisional.acao.configurar_ordem" rota={ROTA_AJUDA} />
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button
                onClick={onAbrirModal}
                style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                ℹ️ Como é calculado
              </button>
              <AjudaCampo chave="dre.divisional.acao.como_calculado" rota={ROTA_AJUDA} alinhar="fim" />
            </span>
          </div>
        </header>

        {children}
      </div>

      {modalAberto && <ComoCalculadoModal onClose={onFecharModal} />}
    </div>
  )
}

// ───────────── Helpers ─────────────

function lbl() {
  return { fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: C.muted } as any
}
function selStyle() {
  return { padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', minWidth: 100, fontFamily: 'inherit', color: C.ink } as any
}
function toggleStyle(active: boolean) {
  return {
    padding: '6px 12px', borderRadius: 6,
    border: 'none', cursor: 'pointer',
    background: active ? 'white' : 'transparent',
    color: active ? C.espresso : C.muted,
    fontSize: 12, fontWeight: 600,
    boxShadow: active ? '0 1px 3px rgba(61, 35, 20, 0.06)' : 'none',
  } as any
}
function btnPrim() {
  return { padding: '12px 20px', borderRadius: 8, border: 'none', backgroundColor: C.gold, color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer', textDecoration: 'none' } as any
}
function btnSec() {
  return { padding: '12px 20px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, cursor: 'pointer', textDecoration: 'none' } as any
}
function cardEstadoStyle() {
  return {
    background: 'white',
    borderRadius: 12,
    padding: '40px 32px',
    boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)',
    textAlign: 'center' as const,
    border: `1px solid ${C.borderLt}`,
  }
}

function SvgChartPie() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={C.gold} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto', display: 'block' }}>
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </svg>
  )
}
