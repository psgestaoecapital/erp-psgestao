'use client'
// Comparativo da OS (rentabilidade) — módulo oficina. Mostra, por OS e em visão geral: Compra, Venda, Diferença,
// Tributos (produtos e serviços), Taxa de cartão (real do repasse ou estimada) e SOBRA LÍQUIDA (valor e %), no
// modelo da planilha da Mecânica Gean. Só leitura (RPCs novas), dado sensível só para dono/Master/gestor.
// RD-95: "?" em todo campo, filtro, coluna e indicador. RD-96: identidade própria. RD-98: tempo manual (incluir/
// editar/excluir) e custo avulso já existentes. RD-100: sem nome de terceiro. Mobile-first.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel, codigoAmigavel } from '@/lib/erroAmigavel'
import { exportarExcel, type Coluna } from '@/lib/export/relatorioLista'

const ROTA = '/dashboard/oficina/comparativo'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF',
  ESP60 = 'rgba(61,35,20,0.6)', ESP40 = 'rgba(61,35,20,0.45)', WHITE = '#FFFFFF',
  OK = '#166534', WARN = '#B45309', RED = '#A32D2D'

const brl = (v: number | null | undefined) =>
  (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })
const pct = (v: number | null | undefined) => (v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`)

type Totais = {
  venda_pecas: number; venda_servicos: number; venda_bruta: number; desconto: number; venda_liq: number
  compra_pecas: number; compra_avulso: number; compra_mo: number; compra_total: number
  diferenca: number; tributos_produtos: number; tributos_servicos: number; tributos: number
  taxa_cartao: number; taxa_origem: string; sobra_liq: number; margem_liq_pct: number | null
}
type Linha = {
  tipo: string; descricao: string; fornecedor: string | null; codigo: string | null; nfe_entrada: string | null
  quantidade: number; compra_unit: number | null; compra: number; venda: number; diferenca: number
  pct_planilha: number | null; margem_venda_pct: number | null; markup_compra_pct: number | null
  origem_custo: string; sem_custo: boolean
}
type DetalheOS = {
  ok: boolean; erro?: string
  cabecalho: { os_id: string; numero: string; cliente_nome: string | null; placa: string | null; modelo: string | null; status: string; data: string | null; forma_pagamento: string | null }
  modo_mao_obra: string; mo_horas: number; mo_origem: string; custo_hora: number | null; custo_hora_origem: string; custo_hora_alerta: string | null
  imposto_produtos_pct: number | null; imposto_servicos_pct: number | null; margem_prevista_peca_pct: number | null; usa_matriz_peca: boolean
  linhas: Linha[]; totais: Totais; alertas: Record<string, string>
}
type LinhaGeral = {
  os_id: string; numero: string; cliente_nome: string | null; placa: string | null; status: string; data_ref: string | null
  venda_liq: number; compra_total: number; diferenca: number; tributos: number; taxa_cartao: number; taxa_origem: string
  sobra_liq: number; margem_liq_pct: number | null; custo_incompleto: boolean; forma_pagamento: string | null
}
type ResumoGeral = { venda_liq: number; compra_total: number; diferenca: number; tributos: number; taxa_cartao: number; sobra_liq: number; margem_liq_pct: number | null; os_incompletas: number }

const ORIGEM_CUSTO: Record<string, string> = { estoque_saida: 'da entrada (estoque)', item: 'do item da OS', produto_medio: 'custo médio', sem_custo: 'sem custo', servico: 'serviço' }
const TAXA_ORIGEM: Record<string, string> = { real: 'real (repasse)', estimada: 'estimada', parcial: 'parcial', sem_cartao: '—' }
const STATUS_OPC = ['entregue', 'faturada', 'aprovada', 'em_execucao', 'aguardando_aprovacao', 'orcamento', 'cancelada']
const FORMA_OPC = ['PIX', 'dinheiro', 'cartao_credito', 'cartao_debito', 'boleto', 'cheque', 'transferencia', 'permuta']

export default function ComparativoOSPage() {
  const { companyIds, sel } = useCompanyIds()
  const companyId = companyIds.length === 1 ? companyIds[0] : null
  const [aba, setAba] = useState<'geral' | 'os' | 'params'>('geral')

  if (!companyId) {
    return (
      <div style={{ background: BG, minHeight: '100vh', padding: '24px 16px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', background: WHITE, border: `1px solid ${LINE}`, borderRadius: 12, padding: 20, color: ESP }}>
          <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Comparativo da OS</h1>
          <p style={{ color: ESP60, fontSize: 13, marginTop: 8 }}>Selecione uma empresa específica no topo para ver a rentabilidade das ordens de serviço.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 14px 48px' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: ESP, margin: 0 }}>Comparativo da OS</h1>
          <span style={{ fontSize: 12, color: ESP60 }}>rentabilidade · custo × venda × sobra líquida</span>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {([['geral', 'Visão geral'], ['os', 'Por OS'], ['params', 'Parâmetros']] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setAba(k)} style={{
              padding: '8px 16px', minHeight: 40, fontSize: 13, fontWeight: 700, borderRadius: 9, border: 'none', cursor: 'pointer',
              background: aba === k ? GOLD : WHITE, color: aba === k ? WHITE : ESP60, boxShadow: aba === k ? 'none' : `inset 0 0 0 1px ${LINE}`,
            }}>{lbl}</button>
          ))}
        </div>
        {aba === 'geral' && <AbaGeral companyId={companyId} empresaLabel={sel ?? ''} onAbrirOS={() => setAba('os')} setOsAlvo={(n) => { window.sessionStorage.setItem('comparativo_os_alvo', n) }} />}
        {aba === 'os' && <AbaPorOS companyId={companyId} />}
        {aba === 'params' && <AbaParametros companyId={companyId} />}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------- VISÃO GERAL
function AbaGeral({ companyId, empresaLabel, onAbrirOS, setOsAlvo }: { companyId: string; empresaLabel: string; onAbrirOS: () => void; setOsAlvo: (n: string) => void }) {
  const [de, setDe] = useState(''); const [ate, setAte] = useState('')
  const [clienteId, setClienteId] = useState(''); const [status, setStatus] = useState(''); const [forma, setForma] = useState(''); const [mecanicoId, setMecanicoId] = useState('')
  const [clientes, setClientes] = useState<{ id: string; nome: string }[]>([])
  const [mecanicos, setMecanicos] = useState<{ id: string; nome: string }[]>([])
  const [linhas, setLinhas] = useState<LinhaGeral[]>([]); const [resumo, setResumo] = useState<ResumoGeral | null>(null)
  const [carregando, setCarregando] = useState(false); const [erro, setErro] = useState('')

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('erp_clientes').select('id, nome_fantasia, razao_social').eq('company_id', companyId).eq('ativo', true).order('nome_fantasia', { nullsFirst: false }).limit(1000)
      setClientes((data ?? []).map((c) => ({ id: c.id as string, nome: (c.nome_fantasia || c.razao_social || '—') as string })))
      const { data: ap } = await supabase.from('erp_os_apontamento').select('mecanico_id, mecanico_nome').eq('company_id', companyId).not('mecanico_id', 'is', null).limit(2000)
      const map = new Map<string, string>()
      for (const r of (ap ?? [])) { const id = r.mecanico_id as string | null; if (id) map.set(id, (r.mecanico_nome as string) || '—') }
      setMecanicos([...map].map(([id, nome]) => ({ id, nome })))
    })()
  }, [companyId])

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('')
    const { data, error } = await supabase.rpc('fn_oficina_comparativo_geral', {
      p_company_id: companyId, p_de: de || null, p_ate: ate || null, p_cliente_id: clienteId || null,
      p_status: status || null, p_forma_pagamento: forma || null, p_mecanico_id: mecanicoId || null, p_limit: 200, p_offset: 0,
    })
    const r = data as { ok?: boolean; erro?: string; linhas?: LinhaGeral[]; resumo?: ResumoGeral } | null
    if (error || !r?.ok) { setErro(erroAmigavel(error, codigoAmigavel(r?.erro, 'Não foi possível carregar. Tente de novo.'))); setCarregando(false); return }
    setLinhas(r.linhas ?? []); setResumo(r.resumo ?? null); setCarregando(false)
  }, [companyId, de, ate, clienteId, status, forma, mecanicoId])

  useEffect(() => { void carregar() }, [carregar])

  const exportar = () => {
    const cols: Coluna<LinhaGeral>[] = [
      { header: 'OS', get: (r) => r.numero }, { header: 'Cliente', get: (r) => r.cliente_nome }, { header: 'Placa', get: (r) => r.placa },
      { header: 'Status', get: (r) => r.status }, { header: 'Data', get: (r) => r.data_ref, tipo: 'data' },
      { header: 'Compra', get: (r) => r.compra_total, tipo: 'moeda', total: true }, { header: 'Venda', get: (r) => r.venda_liq, tipo: 'moeda', total: true },
      { header: 'Diferença', get: (r) => r.diferenca, tipo: 'moeda', total: true }, { header: 'Tributos', get: (r) => r.tributos, tipo: 'moeda', total: true },
      { header: 'Taxa cartão', get: (r) => r.taxa_cartao, tipo: 'moeda', total: true }, { header: 'Sobra líquida', get: (r) => r.sobra_liq, tipo: 'moeda', total: true },
      { header: 'Margem %', get: (r) => r.margem_liq_pct, tipo: 'numero' },
    ]
    exportarExcel({ titulo: 'Comparativo da OS — visão geral', empresa: empresaLabel, filtros: `período ${de || '—'} a ${ate || '—'}`, emitidoEmISO: new Date().toISOString() }, cols, linhas)
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, background: WHITE, border: `1px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <label style={lbl}>Período <AjudaCampo chave="oficina.comparativo.filtro_periodo" rota={ROTA} />
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} style={inp} aria-label="Data inicial" />
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} style={inp} aria-label="Data final" />
          </div>
        </label>
        <label style={lbl}>Cliente <AjudaCampo chave="oficina.comparativo.filtro_cliente" rota={ROTA} />
          <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} style={inp}>
            <option value="">Todos</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
        <label style={lbl}>Status <AjudaCampo chave="oficina.comparativo.filtro_status" rota={ROTA} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={inp}>
            <option value="">Todos</option>{STATUS_OPC.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label style={lbl}>Forma de pagamento <AjudaCampo chave="oficina.comparativo.filtro_forma_pagamento" rota={ROTA} />
          <select value={forma} onChange={(e) => setForma(e.target.value)} style={inp}>
            <option value="">Todas</option>{FORMA_OPC.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label style={lbl}>Mecânico <AjudaCampo chave="oficina.comparativo.filtro_mecanico" rota={ROTA} />
          <select value={mecanicoId} onChange={(e) => setMecanicoId(e.target.value)} style={inp}>
            <option value="">Todos</option>{mecanicos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <button onClick={() => void carregar()} style={{ ...btnGold, flex: 1 }}>Atualizar</button>
          <button onClick={exportar} disabled={!linhas.length} style={btnOutline} title="Exportar em Excel">⬇ Exportar <AjudaCampo chave="oficina.comparativo.exportar" rota={ROTA} /></button>
        </div>
      </div>

      {erro && <div style={avisoErro}>{erro}</div>}
      {resumo && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
          <Card titulo="Venda" valor={brl(resumo.venda_liq)} />
          <Card titulo="Compra" valor={brl(resumo.compra_total)} />
          <Card titulo="Diferença" valor={brl(resumo.diferenca)} />
          <Card titulo={<>Tributos <AjudaCampo chave="oficina.comparativo.ind_tributos" rota={ROTA} /></>} valor={brl(resumo.tributos)} />
          <Card titulo={<>Taxa de cartão <AjudaCampo chave="oficina.comparativo.ind_taxa_cartao" rota={ROTA} /></>} valor={brl(resumo.taxa_cartao)} />
          <Card titulo={<>Sobra líquida <AjudaCampo chave="oficina.comparativo.ind_sobra_liquida" rota={ROTA} /></>} valor={brl(resumo.sobra_liq)} destaque cor={resumo.sobra_liq >= 0 ? OK : RED} rodape={pct(resumo.margem_liq_pct)} />
        </div>
      )}
      {resumo && resumo.os_incompletas > 0 && (
        <div style={{ ...avisoWarn, marginBottom: 12 }}>{resumo.os_incompletas} OS com custo incompleto (peça sem custo conhecido) — a margem delas pode estar inflada.</div>
      )}

      <div style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 720 }}>
            <thead><tr style={{ background: '#F3ECE0', color: ESP, textAlign: 'left' }}>
              <th style={th}>OS</th><th style={th}>Cliente</th><th style={th}>Status</th>
              <th style={thR}>Compra <AjudaCampo chave="oficina.comparativo.col_compra" rota={ROTA} alinhar="fim" /></th>
              <th style={thR}>Venda <AjudaCampo chave="oficina.comparativo.col_venda" rota={ROTA} alinhar="fim" /></th>
              <th style={thR}>Diferença <AjudaCampo chave="oficina.comparativo.col_diferenca" rota={ROTA} alinhar="fim" /></th>
              <th style={thR}>Sobra líq. <AjudaCampo chave="oficina.comparativo.ind_sobra_liquida" rota={ROTA} alinhar="fim" /></th>
              <th style={thR}>Margem</th>
            </tr></thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.os_id} onClick={() => { setOsAlvo(l.numero); onAbrirOS() }} style={{ borderTop: `1px solid ${LINE}`, cursor: 'pointer' }}>
                  <td style={td}>{l.numero}{l.custo_incompleto && <span title="custo incompleto" style={{ color: WARN, marginLeft: 4 }}>⚠</span>}</td>
                  <td style={td}>{l.cliente_nome || '—'}</td><td style={{ ...td, color: ESP60 }}>{l.status}</td>
                  <td style={tdR}>{brl(l.compra_total)}</td><td style={tdR}>{brl(l.venda_liq)}</td><td style={tdR}>{brl(l.diferenca)}</td>
                  <td style={{ ...tdR, fontWeight: 700, color: l.sobra_liq >= 0 ? OK : RED }}>{brl(l.sobra_liq)}</td>
                  <td style={tdR}>{pct(l.margem_liq_pct)}</td>
                </tr>
              ))}
              {!carregando && linhas.length === 0 && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: ESP60, padding: 28 }}>Nenhuma OS no período/filtro. Ajuste os filtros acima.</td></tr>}
              {carregando && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: ESP60, padding: 28 }}>Carregando…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------- POR OS
function AbaPorOS({ companyId }: { companyId: string }) {
  const [busca, setBusca] = useState(''); const [modo, setModo] = useState<'auto' | 'patio' | 'manual' | 'branco'>('auto')
  const [det, setDet] = useState<DetalheOS | null>(null); const [carregando, setCarregando] = useState(false); const [erro, setErro] = useState('')
  const [horasManual, setHorasManual] = useState(''); const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async (numero: string, modoUsar: typeof modo) => {
    const n = numero.trim(); if (!n) return
    setCarregando(true); setErro(''); setDet(null)
    // acha o id da OS pelo número (escopo da empresa)
    const { data: os } = await supabase.from('erp_os').select('id, numero').eq('company_id', companyId).ilike('numero', `%${n.replace(/[%_]/g, '')}%`).eq('excluida', false).limit(1)
    const osId = (os as { id: string }[] | null)?.[0]?.id
    if (!osId) { setErro('OS não encontrada nesta empresa.'); setCarregando(false); return }
    const { data, error } = await supabase.rpc('fn_oficina_comparativo_os', { p_company_id: companyId, p_os_id: osId, p_modo_mao_obra: modoUsar })
    const r = data as DetalheOS | null
    if (error || !r?.ok) { setErro(erroAmigavel(error, codigoAmigavel(r?.erro, 'Não foi possível abrir a OS.'))); setCarregando(false); return }
    setDet(r); setCarregando(false)
  }, [companyId])

  useEffect(() => {
    const alvo = typeof window !== 'undefined' ? window.sessionStorage.getItem('comparativo_os_alvo') : null
    if (alvo) { window.sessionStorage.removeItem('comparativo_os_alvo'); setBusca(alvo); void carregar(alvo, 'auto') }
  }, [carregar])

  const salvarHoras = async () => {
    if (!det) return
    setSalvando(true)
    const { data, error } = await supabase.rpc('fn_os_mao_obra_manual_salvar', { p_company_id: companyId, p_os_id: det.cabecalho.os_id, p_horas: Number(horasManual.replace(',', '.')) || 0, p_observacao: null })
    const r = data as { ok?: boolean; erro?: string } | null
    setSalvando(false)
    if (error || !r?.ok) { setErro(erroAmigavel(error, codigoAmigavel(r?.erro, 'Não foi possível salvar as horas.'))); return }
    setModo('manual'); void carregar(det.cabecalho.numero, 'manual')
  }
  const excluirHoras = async () => {
    if (!det) return
    await supabase.rpc('fn_os_mao_obra_manual_excluir', { p_company_id: companyId, p_os_id: det.cabecalho.os_id })
    setHorasManual(''); void carregar(det.cabecalho.numero, modo)
  }

  const t = det?.totais
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', background: WHITE, border: `1px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <label style={{ ...lbl, flex: '1 1 220px' }}>Buscar OS <AjudaCampo chave="oficina.comparativo.busca_os" rota={ROTA} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void carregar(busca, modo) }} placeholder="Número da OS (ex.: 0401)" style={inp} />
        </label>
        <button onClick={() => void carregar(busca, modo)} style={btnGold}>Abrir</button>
      </div>

      {erro && <div style={avisoErro}>{erro}</div>}
      {carregando && <div style={{ color: ESP60, padding: 12 }}>Carregando…</div>}

      {det && t && (
        <>
          <div style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: ESP }}>{det.cabecalho.numero} · {det.cabecalho.cliente_nome || '—'}</div>
                <div style={{ fontSize: 12, color: ESP60 }}>{[det.cabecalho.placa, det.cabecalho.modelo, det.cabecalho.status, det.cabecalho.forma_pagamento].filter(Boolean).join(' · ')}</div>
              </div>
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <span style={lbl}>Mão de obra <AjudaCampo chave="oficina.comparativo.modo_mao_obra" rota={ROTA} /></span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {(['auto', 'patio', 'manual', 'branco'] as const).map((m) => (
                    <button key={m} onClick={() => { setModo(m); void carregar(det.cabecalho.numero, m) }} style={seg(modo === m)}>
                      {m === 'auto' ? 'Automático' : m === 'patio' ? 'Pátio' : m === 'manual' ? 'Manual' : 'Em branco'}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: ESP60, marginTop: 3 }}>{det.mo_horas} h · origem {det.mo_origem}{det.custo_hora != null ? ` · custo-hora ${brl(det.custo_hora)}` : ''}</div>
              </div>
              <label style={{ ...lbl, width: 150 }}>Horas (manual) <AjudaCampo chave="oficina.comparativo.mo_horas_manual" rota={ROTA} />
                <div style={{ display: 'flex', gap: 4 }}>
                  <input value={horasManual} onChange={(e) => setHorasManual(e.target.value)} placeholder="ex.: 1,5" inputMode="decimal" style={inp} />
                  <button onClick={() => void salvarHoras()} disabled={salvando} style={btnGold} title="Salvar horas manuais">✓</button>
                  <button onClick={() => void excluirHoras()} style={btnOutline} title="Remover horas manuais">🗑</button>
                </div>
              </label>
            </div>
            {Object.values(det.alertas || {}).map((a, i) => <div key={i} style={{ ...avisoWarn, marginTop: 8 }}>{a}</div>)}
          </div>

          <div style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 820 }}>
                <thead><tr style={{ background: '#F3ECE0', color: ESP, textAlign: 'left' }}>
                  <th style={th}>Produto/Serviço</th><th style={th}>Fornecedor</th><th style={th}>NF-e entrada</th><th style={thR}>Qtd</th>
                  <th style={thR}>Compra <AjudaCampo chave="oficina.comparativo.col_compra" rota={ROTA} alinhar="fim" /></th>
                  <th style={thR}>Venda <AjudaCampo chave="oficina.comparativo.col_venda" rota={ROTA} alinhar="fim" /></th>
                  <th style={thR}>Diferença <AjudaCampo chave="oficina.comparativo.col_diferenca" rota={ROTA} alinhar="fim" /></th>
                  <th style={thR}>% planilha <AjudaCampo chave="oficina.comparativo.col_pct_planilha" rota={ROTA} alinhar="fim" /></th>
                  <th style={thR}>Margem/Markup <AjudaCampo chave="oficina.comparativo.col_pct_previsto" rota={ROTA} alinhar="fim" /></th>
                </tr></thead>
                <tbody>
                  {det.linhas.map((l, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}>
                      <td style={td}>{l.descricao}<div style={{ fontSize: 10, color: ESP40 }}>{ORIGEM_CUSTO[l.origem_custo] || l.origem_custo}{l.sem_custo && <span style={{ color: WARN }}> · sem custo</span>}</div></td>
                      <td style={{ ...td, color: ESP60 }}>{l.fornecedor || '—'}</td><td style={{ ...td, color: ESP60 }}>{l.nfe_entrada || '—'}</td>
                      <td style={tdR}>{l.quantidade}</td><td style={tdR}>{l.compra != null ? brl(l.compra) : '—'}</td><td style={tdR}>{brl(l.venda)}</td>
                      <td style={tdR}>{brl(l.diferenca)}</td><td style={tdR}>{pct(l.pct_planilha)}</td>
                      <td style={tdR}>{l.margem_venda_pct != null ? `${pct(l.margem_venda_pct)} / ${pct(l.markup_compra_pct)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10 }}>
            <Card titulo="Compra" valor={brl(t.compra_total)} rodape={`peças ${brl(t.compra_pecas)} · terceiros ${brl(t.compra_avulso)} · MO ${brl(t.compra_mo)}`} />
            <Card titulo="Venda" valor={brl(t.venda_liq)} rodape={t.desconto > 0 ? `desconto ${brl(t.desconto)}` : undefined} />
            <Card titulo="Diferença" valor={brl(t.diferenca)} />
            <Card titulo={<>Tributos <AjudaCampo chave="oficina.comparativo.ind_tributos" rota={ROTA} /></>} valor={brl(t.tributos)} rodape={`produtos ${brl(t.tributos_produtos)} · serviços ${brl(t.tributos_servicos)}`} />
            <Card titulo={<>Taxa de cartão <AjudaCampo chave="oficina.comparativo.ind_taxa_cartao" rota={ROTA} /></>} valor={brl(t.taxa_cartao)} rodape={TAXA_ORIGEM[t.taxa_origem] || t.taxa_origem} />
            <Card titulo={<>Sobra líquida <AjudaCampo chave="oficina.comparativo.ind_sobra_liquida" rota={ROTA} /></>} valor={brl(t.sobra_liq)} destaque cor={t.sobra_liq >= 0 ? OK : RED} rodape={pct(t.margem_liq_pct)} />
          </div>
        </>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------- PARÂMETROS
function AbaParametros({ companyId }: { companyId: string }) {
  const [impProd, setImpProd] = useState(''); const [impServ, setImpServ] = useState(''); const [reserva, setReserva] = useState(''); const [custoHora, setCustoHora] = useState('')
  const [info, setInfo] = useState<{ custo_hora_efetivo: number | null; custo_hora_origem: string } | null>(null)
  const [carregando, setCarregando] = useState(true); const [erro, setErro] = useState(''); const [msg, setMsg] = useState(''); const [podeEditar, setPodeEditar] = useState(true)

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('')
    const { data, error } = await supabase.rpc('fn_oficina_comparativo_params_get', { p_company_id: companyId })
    const r = data as { ok?: boolean; erro?: string; imposto_produtos_pct?: number | null; imposto_servicos_pct?: number | null; reserva_taxa_cartao_pct?: number | null; custo_hora_manual?: number | null; custo_hora_efetivo?: number | null; custo_hora_origem?: string } | null
    if (error || !r?.ok) { setErro(erroAmigavel(error, codigoAmigavel(r?.erro, 'Sem acesso aos parâmetros.'))); setPodeEditar(false); setCarregando(false); return }
    setImpProd(r.imposto_produtos_pct?.toString() ?? ''); setImpServ(r.imposto_servicos_pct?.toString() ?? '')
    setReserva(r.reserva_taxa_cartao_pct?.toString() ?? ''); setCustoHora(r.custo_hora_manual?.toString() ?? '')
    setInfo({ custo_hora_efetivo: r.custo_hora_efetivo ?? null, custo_hora_origem: r.custo_hora_origem ?? '' })
    setCarregando(false)
  }, [companyId])
  useEffect(() => { void carregar() }, [carregar])

  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
  const salvar = async () => {
    setMsg(''); setErro('')
    const { data, error } = await supabase.rpc('fn_oficina_comparativo_params_salvar', {
      p_company_id: companyId, p_imposto_produtos_pct: num(impProd), p_imposto_servicos_pct: num(impServ),
      p_reserva_taxa_cartao_pct: num(reserva), p_custo_hora_manual: num(custoHora),
    })
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setErro(erroAmigavel(error, codigoAmigavel(r?.erro, 'Não foi possível salvar.'))); return }
    setMsg('Parâmetros salvos.'); void carregar()
  }

  if (carregando) return <div style={{ color: ESP60, padding: 12 }}>Carregando…</div>
  return (
    <div style={{ maxWidth: 520 }}>
      {erro && <div style={avisoErro}>{erro}</div>}
      {podeEditar && (
        <div style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, display: 'grid', gap: 12 }}>
          <label style={lbl}>Imposto de produtos (%) <AjudaCampo chave="oficina.comparativo.param_imposto_produtos" rota={ROTA} />
            <input value={impProd} onChange={(e) => setImpProd(e.target.value)} inputMode="decimal" placeholder="ex.: 10" style={inp} />
          </label>
          <label style={lbl}>Imposto de serviços (%) <AjudaCampo chave="oficina.comparativo.param_imposto_servicos" rota={ROTA} />
            <input value={impServ} onChange={(e) => setImpServ(e.target.value)} inputMode="decimal" placeholder="ex.: 5" style={inp} />
          </label>
          <label style={lbl}>Reserva de taxa de cartão (%) <AjudaCampo chave="oficina.comparativo.param_reserva_taxa" rota={ROTA} />
            <input value={reserva} onChange={(e) => setReserva(e.target.value)} inputMode="decimal" placeholder="ex.: 2,5" style={inp} />
          </label>
          <label style={lbl}>Custo-hora (manual) <AjudaCampo chave="oficina.comparativo.param_custo_hora" rota={ROTA} />
            <input value={custoHora} onChange={(e) => setCustoHora(e.target.value)} inputMode="decimal" placeholder="deixe vazio para usar o calculado" style={inp} />
          </label>
          {info && <div style={{ fontSize: 11, color: ESP60 }}>Custo-hora em uso: <b>{info.custo_hora_efetivo != null ? brl(info.custo_hora_efetivo) : 'não definido'}</b> ({info.custo_hora_origem || '—'}).</div>}
          {msg && <div style={{ color: OK, fontSize: 12 }}>{msg}</div>}
          <button onClick={() => void salvar()} style={btnGold}>Salvar parâmetros</button>
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------- UI helpers
function Card({ titulo, valor, rodape, destaque, cor }: { titulo: React.ReactNode; valor: string; rodape?: React.ReactNode; destaque?: boolean; cor?: string }) {
  return (
    <div style={{ background: WHITE, border: `1px solid ${destaque ? GOLD : LINE}`, borderRadius: 12, padding: 12 }}>
      <div style={{ fontSize: 11, color: ESP60, display: 'flex', alignItems: 'center', gap: 4 }}>{titulo}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: cor || ESP, marginTop: 2 }}>{valor}</div>
      {rodape != null && <div style={{ fontSize: 10.5, color: ESP40, marginTop: 2 }}>{rodape}</div>}
    </div>
  )
}

const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', fontSize: 13, borderRadius: 8, border: `1px solid ${LINE}`, background: WHITE, color: ESP, boxSizing: 'border-box' }
const lbl: React.CSSProperties = { fontSize: 11, color: ESP60, display: 'block', marginBottom: 3 }
const btnGold: React.CSSProperties = { padding: '9px 14px', minHeight: 40, fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', cursor: 'pointer', background: GOLD, color: WHITE }
const btnOutline: React.CSSProperties = { padding: '9px 12px', minHeight: 40, fontSize: 12.5, fontWeight: 700, borderRadius: 8, border: `1px solid ${LINE}`, cursor: 'pointer', background: WHITE, color: ESP }
const seg = (ativo: boolean): React.CSSProperties => ({ padding: '7px 12px', minHeight: 36, fontSize: 12, fontWeight: 700, borderRadius: 8, border: 'none', cursor: 'pointer', background: ativo ? GOLD : '#F3ECE0', color: ativo ? WHITE : ESP60 })
const th: React.CSSProperties = { padding: '9px 10px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }
const thR: React.CSSProperties = { ...th, textAlign: 'right' }
const td: React.CSSProperties = { padding: '8px 10px', color: ESP, verticalAlign: 'top' }
const tdR: React.CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap' }
const avisoErro: React.CSSProperties = { background: '#FBEAEA', color: RED, border: `1px solid #E7C9C9`, borderRadius: 8, padding: '10px 12px', fontSize: 12.5, marginBottom: 12 }
const avisoWarn: React.CSSProperties = { background: '#FBF1E0', color: WARN, border: `1px solid #EBD9B8`, borderRadius: 8, padding: '8px 11px', fontSize: 12 }
