'use client'

// GE · Comissões recorrentes de vendas (genérico, qualquer empresa/vertical).
// O vendedor ligado a um contrato recebe uma % (ou valor fixo) TODA VEZ que o cliente paga: a baixa do recebível dispara,
// no banco (gatilho trg_zz_comissao_recorrente), uma conta a pagar PENDENTE para o vendedor — nunca paga sozinha.
// Fronteira [→GE]: esta tela só USA erp_contratos / erp_receber / erp_pagar / erp_fornecedores. Regras, livro e esteira
// ficam em erp_comissao_recorrente_* e toda escrita passa por RPC com guarda de empresa.
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { CampoMoeda } from '@/components/comum/CampoMoeda'
import { moedaParaNumero, numeroParaMoeda } from '@/lib/moeda-mascara'
import { AlertTriangle, PauseCircle, ReceiptText, Search, Undo2, type LucideIcon } from 'lucide-react'

const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DED3'
const MUTED = 'rgba(61,35,20,0.6)'; const GREEN = '#2F6B3A'; const AMBER = '#8A6410'; const RED = '#9A1F1F'

type Aba = 'painel' | 'contratos' | 'geradas' | 'vendedores'
type Kpis = {
  mrr_com_comissao: number; contratos_com_comissao: number; comissao_prevista_mes: number; comissao_gerada_mes: number
  comissao_paga_mes: number; comissao_a_pagar: number; comissao_vencida: number; vendedores_ativos: number
  erros_7d: number; pendencias_estorno: number
}
type PorVertical = { vertical: string; contratos: number; mrr: number; prevista: number; gerada_mes: number }
type PorVendedor = { fornecedor_id: string; vendedor: string; contratos: number; prevista: number; projecao: number; gerada_mes: number; paga_mes: number; acumulado: number; a_pagar: number }
type Alerta = { contrato_id: string; contrato: string; cliente: string | null; vendedor: string; status: string; desde: string | null }
type Painel = { ok: boolean; mes: string; kpis: Kpis; por_vertical: PorVertical[]; por_vendedor: PorVendedor[]; alertas_corte: Alerta[] }
type Contrato = {
  id: string; numero: string; nome: string; cliente_nome: string | null; tipo: string | null; valor_mensal: number | null
  valor_atual: number | null; status: string | null; data_inicio: string | null; data_fim: string | null
  data_suspensao: string | null; data_encerramento: string | null
}
type Regra = {
  id: string; contrato_id: string; fornecedor_id: string; tipo_comissao: 'percentual' | 'fixo'; percentual: number | null
  valor_fixo: number | null; vertical: string | null; dias_vencimento: number; vigencia_inicio: string; vigencia_fim: string | null
  ativo: boolean; observacao: string | null
}
type Fornecedor = {
  id: string; nome_fantasia: string; razao_social: string | null; tipo_pessoa: string | null; cpf_cnpj: string | null
  cnpj_cpf: string | null; telefone: string | null; celular: string | null; whatsapp: string | null; email: string | null
  banco: string | null; agencia: string | null; conta: string | null; pix: string | null; categoria: string | null
}
type Lancamento = {
  id: string; regra_id: string; contrato_id: string; fornecedor_id: string; recebivel_id: string; competencia: string | null
  valor_base: number; percentual_aplicado: number | null; valor_fixo_aplicado: number | null; valor_comissao: number
  status: 'gerada' | 'estornada'; origem: string; estornado_em: string | null; estornado_motivo: string | null; pendencia: string | null
  pagar_id: string | null; pagar_documento: string | null; pagar_status: string | null; pagar_vencimento: string | null
  pagar_valor_pago: number; vendedor: string | null; contrato: string | null; cliente: string | null
  recebivel_documento: string | null; recebivel_descricao: string | null
}
type Evento = { id: string; tipo: string; mensagem: string; created_at: string; pagar_id: string | null }

const brl = (n: number | null | undefined) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—')
const hojeISO = () => new Date().toISOString().slice(0, 10)
const nomeForn = (f: Fornecedor | undefined) => (f ? f.nome_fantasia || f.razao_social || 'Vendedor' : '—')
const prontoPagar = (f: Fornecedor) => Boolean((f.pix ?? '').trim() || ((f.banco ?? '').trim() && (f.conta ?? '').trim()))
const valorMensal = (c: Contrato) => Number(c.valor_atual ?? c.valor_mensal ?? 0)
const comissaoMensal = (r: Regra, c: Contrato | undefined) =>
  r.tipo_comissao === 'percentual' ? ((Number(r.percentual) || 0) / 100) * (c ? valorMensal(c) : 0) : Number(r.valor_fixo) || 0
const rotuloRegra = (r: Regra) =>
  r.tipo_comissao === 'percentual' ? `${String(r.percentual ?? 0).replace('.', ',')}%` : `${brl(r.valor_fixo)} fixo`

// RD-98 (e): nunca mostrar erro cru do banco — loga o técnico e devolve frase acionável
function erroAmigavel(err: unknown, acao: string): string {
  try { console.error(`[comissoes-recorrentes] falha ao ${acao}:`, err) } catch { /* sem console */ }
  return `Não foi possível ${acao} agora. Tente de novo em instantes; se continuar, fale com o suporte.`
}

export default function ComissoesRecorrentesPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [aba, setAba] = useState<Aba>('painel')
  const [painel, setPainel] = useState<Painel | null>(null)
  const [contratos, setContratos] = useState<Contrato[]>([])
  const [regras, setRegras] = useState<Regra[]>([])
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [lancs, setLancs] = useState<Lancamento[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [editRegra, setEditRegra] = useState<Partial<Regra> | null>(null)
  const [excluir, setExcluir] = useState<Regra | null>(null)
  const [editVend, setEditVend] = useState<Partial<Fornecedor> | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    const [p, c, r, f, l] = await Promise.all([
      supabase.rpc('fn_comissao_recorrente_painel', { p_company_id: empresa }),
      supabase.from('erp_contratos')
        .select('id, numero, nome, cliente_nome, tipo, valor_mensal, valor_atual, status, data_inicio, data_fim, data_suspensao, data_encerramento')
        .eq('company_id', empresa).eq('natureza', 'receita').is('excluido_em', null).neq('status', 'excluido')
        .order('cliente_nome', { ascending: true }).limit(2000),
      supabase.from('erp_comissao_recorrente_regra')
        .select('id, contrato_id, fornecedor_id, tipo_comissao, percentual, valor_fixo, vertical, dias_vencimento, vigencia_inicio, vigencia_fim, ativo, observacao')
        .eq('company_id', empresa).is('deleted_at', null),
      supabase.from('erp_fornecedores')
        .select('id, nome_fantasia, razao_social, tipo_pessoa, cpf_cnpj, cnpj_cpf, telefone, celular, whatsapp, email, banco, agencia, conta, pix, categoria')
        .eq('company_id', empresa).is('excluido_em', null).order('nome_fantasia', { ascending: true }).limit(3000),
      supabase.rpc('fn_comissao_recorrente_lancamentos', { p_company_id: empresa, p_de: null, p_ate: null }),
    ])
    if (p.error || c.error || r.error || f.error || l.error) setToast(erroAmigavel(p.error ?? c.error ?? r.error ?? f.error ?? l.error, 'carregar as comissões'))
    setPainel((p.data ?? null) as Painel | null)
    setContratos((c.data ?? []) as Contrato[])
    setRegras((r.data ?? []) as Regra[])
    setFornecedores((f.data ?? []) as Fornecedor[])
    setLancs((l.data ?? []) as Lancamento[])
    setLoading(false)
  }, [empresa])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega os dados quando a empresa muda
  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t) }, [toast])

  const contratoPorId = useMemo(() => Object.fromEntries(contratos.map((c) => [c.id, c])) as Record<string, Contrato>, [contratos])
  const fornPorId = useMemo(() => Object.fromEntries(fornecedores.map((f) => [f.id, f])) as Record<string, Fornecedor>, [fornecedores])

  if (!empresa) {
    return (
      <div className="p-4 max-w-3xl mx-auto" style={{ color: ESP }}>
        <h1 className="text-xl font-bold mb-3">Comissões recorrentes</h1>
        <div className="rounded-xl p-6 text-center" style={{ background: BG }}>
          <p className="font-medium">Selecione uma empresa específica</p>
          <p className="text-sm" style={{ color: MUTED }}>As comissões são de cada empresa: escolha uma no seletor do topo.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-6xl mx-auto relative" style={{ color: ESP }} data-testid="comrec-page">
      <header className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Comissões recorrentes</h1>
          <p className="text-sm" style={{ color: MUTED }}>
            Cada vez que o cliente paga, o vendedor ganha a comissão e a conta a pagar dele nasce sozinha, pendente. Pagar o vendedor continua sendo decisão sua.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button style={btnSec} onClick={() => setEditVend({ tipo_pessoa: 'PF' })} data-testid="comrec-novo-vendedor">+ Vendedor</button>
          <button style={btnPri} onClick={() => setEditRegra({ tipo_comissao: 'percentual', dias_vencimento: 7, vigencia_inicio: hojeISO(), ativo: true })} data-testid="comrec-nova-regra">+ Comissão em contrato</button>
        </div>
      </header>

      <nav style={tabBar} className="flex items-center" data-testid="comrec-abas">
        {([['painel', 'Painel'], ['contratos', 'Contratos & comissões'], ['geradas', 'Comissões geradas'], ['vendedores', 'Vendedores']] as [Aba, string][]).map(([k, l]) => (
          <button key={k} style={tab(aba === k)} onClick={() => setAba(k)} data-testid={`comrec-aba-${k}`}>{l}</button>
        ))}
        <AjudaCampo chave="comrec.abas" />
      </nav>

      {loading && <p style={{ color: MUTED }}>Carregando…</p>}

      {!loading && aba === 'painel' && (
        <PainelAba painel={painel} regras={regras} contratoPorId={contratoPorId} onIrContratos={() => setAba('contratos')} />
      )}
      {!loading && aba === 'contratos' && (
        <ContratosAba contratos={contratos} regras={regras} fornPorId={fornPorId}
          onNova={(contratoId) => setEditRegra({ contrato_id: contratoId, tipo_comissao: 'percentual', dias_vencimento: 7, vigencia_inicio: hojeISO(), ativo: true })}
          onEditar={(r) => setEditRegra(r)} onExcluir={(r) => setExcluir(r)}
          onToast={setToast} onRecarregar={carregar} />
      )}
      {!loading && aba === 'geradas' && <GeradasAba lancs={lancs} fornecedores={fornecedores} contratos={contratos} />}
      {!loading && aba === 'vendedores' && (
        <VendedoresAba fornecedores={fornecedores} regras={regras} painel={painel} onEditar={(f) => setEditVend(f)} />
      )}

      {editRegra && (
        <RegraModal empresa={empresa} inicial={editRegra} contratos={contratos} fornecedores={fornecedores}
          onFechar={() => setEditRegra(null)}
          onNovoVendedor={() => setEditVend({ tipo_pessoa: 'PF' })}
          onSalvo={(m) => { setEditRegra(null); setToast(m); carregar() }} />
      )}
      {excluir && (
        <ExcluirModal regra={excluir} vendedor={nomeForn(fornPorId[excluir.fornecedor_id])}
          onFechar={() => setExcluir(null)} onFeito={(m) => { setExcluir(null); setToast(m); carregar() }} />
      )}
      {editVend && (
        <VendedorModal empresa={empresa} inicial={editVend} onFechar={() => setEditVend(null)}
          onSalvo={(m) => { setEditVend(null); setToast(m); carregar() }} />
      )}

      {toast && (
        <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-xl px-4 py-3 text-sm shadow-lg max-w-[92vw]"
             style={{ background: ESP, color: '#fff', zIndex: 60 }}>{toast}</div>
      )}
    </div>
  )
}

// ───────────────────────────── Painel ─────────────────────────────
function PainelAba({ painel, regras, contratoPorId, onIrContratos }: {
  painel: Painel | null; regras: Regra[]; contratoPorId: Record<string, Contrato>; onIrContratos: () => void
}) {
  const k = painel?.kpis
  const [simQtd, setSimQtd] = useState('5')
  const [simValor, setSimValor] = useState('1500')
  const [simPct, setSimPct] = useState('10')
  const num = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0
  const simMes = num(simQtd) * num(simValor) * (num(simPct) / 100)
  const atualMes = regras.filter((r) => r.ativo && contratoPorId[r.contrato_id]?.status === 'ativo')
    .reduce((s, r) => s + comissaoMensal(r, contratoPorId[r.contrato_id]), 0)

  if (!k) return <Vazio titulo="Painel indisponível" texto="Não foi possível montar o painel agora." />
  const semaforo = k.comissao_vencida > 0 || k.erros_7d > 0 ? 'vermelho' : k.comissao_a_pagar > 0 ? 'amarelo' : 'verde'
  const corSem = { verde: GREEN, amarelo: AMBER, vermelho: RED }[semaforo]
  const textoSem = semaforo === 'vermelho'
    ? `${k.comissao_vencida > 0 ? `${brl(k.comissao_vencida)} de comissão vencida sem pagar` : ''}${k.comissao_vencida > 0 && k.erros_7d > 0 ? ' · ' : ''}${k.erros_7d > 0 ? `${k.erros_7d} falha(s) de geração nos últimos 7 dias (veja a esteira do contrato)` : ''}`
    : semaforo === 'amarelo' ? `${brl(k.comissao_a_pagar)} gerados esperando o pagamento aos vendedores` : 'Tudo em dia: o pago acompanha o gerado.'
  const semRegra = regras.length === 0

  return (
    <div className="space-y-5" data-testid="comrec-painel">
      {semRegra && (
        <Vazio titulo="Nenhuma comissão cadastrada ainda"
          texto="Ligue um vendedor a um contrato e, a partir do próximo pagamento do cliente, a conta a pagar dele nasce sozinha."
          acao={<button style={btnPri} onClick={onIrContratos}>Ir para Contratos & comissões</button>} />
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Kpi titulo="Receita mensal com comissão" valor={brl(k.mrr_com_comissao)} sub={`${k.contratos_com_comissao} contrato(s)`} ajuda="comrec.kpi_mrr" />
        <Kpi titulo="Comissão prevista / mês" valor={brl(k.comissao_prevista_mes)} destaque ajuda="comrec.kpi_prevista" />
        <Kpi titulo="Gerada no mês" valor={brl(k.comissao_gerada_mes)} sub="clientes que já pagaram" ajuda="comrec.kpi_gerada" />
        <Kpi titulo="Paga no mês" valor={brl(k.comissao_paga_mes)} sub={`${k.vendedores_ativos} vendedor(es) ativo(s)`} ajuda="comrec.kpi_paga" />
      </div>
      <div className="flex items-center gap-2 text-[11px] uppercase" style={{ color: MUTED }}>
        Vendedores ativos: <b style={{ color: ESP }}>{k.vendedores_ativos}</b><AjudaCampo chave="comrec.kpi_vendedores" />
      </div>

      <div className="rounded-xl p-4 flex items-start gap-3" style={{ background: '#fff', border: `1px solid ${LINE}` }} data-testid="comrec-semaforo">
        <span aria-hidden style={{ width: 14, height: 14, borderRadius: 99, background: corSem, marginTop: 3, flex: '0 0 auto' }} />
        <div className="flex-1">
          <div className="font-semibold flex items-center">Previsto × pago<AjudaCampo chave="comrec.semaforo" /></div>
          <div className="text-sm" style={{ color: corSem }}>{textoSem}</div>
          {k.pendencias_estorno > 0 && (
            <div className="text-sm mt-1" style={{ color: RED }}>{k.pendencias_estorno} comissão(ões) estornada(s) que já tinham sido paga(s) ao vendedor: compensar manualmente (veja Comissões geradas).</div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Bloco titulo="Por vertical ou serviço" ajuda="comrec.por_vertical">
          {painel.por_vertical.length === 0 ? <p className="text-sm" style={{ color: MUTED }}>Sem contratos ativos com comissão.</p> : (
            <table className="w-full text-sm">
              <thead><tr style={{ color: MUTED }} className="text-left text-[11px] uppercase"><th className="py-1">Vertical<AjudaCampo chave="comrec.por_vertical" /></th><th className="text-right">Receita/mês</th><th className="text-right">Comissão/mês</th><th className="text-right">Gerada no mês</th></tr></thead>
              <tbody>{painel.por_vertical.map((v) => (
                <tr key={v.vertical} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td className="py-2">{v.vertical}<div className="text-[11px]" style={{ color: MUTED }}>{v.contratos} contrato(s)</div></td>
                  <td className="text-right">{brl(v.mrr)}</td><td className="text-right font-semibold">{brl(v.prevista)}</td><td className="text-right">{brl(v.gerada_mes)}</td>
                </tr>))}</tbody>
            </table>)}
        </Bloco>
        <Bloco titulo="Por vendedor · projeção enquanto os contratos durarem" ajuda="comrec.por_vendedor">
          {painel.por_vendedor.length === 0 ? <p className="text-sm" style={{ color: MUTED }}>Nenhum vendedor com regra ativa.</p> : (
            <table className="w-full text-sm">
              <thead><tr style={{ color: MUTED }} className="text-left text-[11px] uppercase"><th className="py-1">Vendedor<AjudaCampo chave="comrec.por_vendedor" /></th><th className="text-right">Por mês</th><th className="text-right">Projeção</th><th className="text-right">A pagar</th></tr></thead>
              <tbody>{painel.por_vendedor.map((v) => (
                <tr key={v.fornecedor_id} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td className="py-2">{v.vendedor}<div className="text-[11px]" style={{ color: MUTED }}>{v.contratos} contrato(s) · acumulado {brl(v.acumulado)}</div></td>
                  <td className="text-right font-semibold">{brl(v.prevista)}</td><td className="text-right" style={{ color: GOLD }}>{brl(v.projecao)}</td><td className="text-right">{brl(v.a_pagar)}</td>
                </tr>))}</tbody>
            </table>)}
        </Bloco>
      </div>

      <Bloco titulo="Contratos que pararam de comissionar" ajuda="comrec.alertas">
        {painel.alertas_corte.length === 0 ? <p className="text-sm" style={{ color: MUTED }}>Nenhum contrato com comissão está suspenso ou encerrado.</p> : (
          <ul className="space-y-2 text-sm" data-testid="comrec-alertas">
            {painel.alertas_corte.map((a) => (
              <li key={a.contrato_id + a.vendedor} className="rounded-lg p-3" style={{ background: '#FBEDEA' }}>
                <b>{a.cliente ?? '—'}</b> · {a.contrato} · {a.vendedor}: parou de comissionar {a.desde ? `em ${dataBR(a.desde)}` : ''} (contrato {a.status}).
              </li>))}
          </ul>)}
      </Bloco>

      <Bloco titulo='Simulador "e se"' ajuda="comrec.simulador">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label style={lbl}>Contratos novos<AjudaCampo chave="comrec.sim_qtd" />
            <input style={inp} inputMode="numeric" value={simQtd} onChange={(e) => setSimQtd(e.target.value)} data-testid="comrec-sim-qtd" /></label>
          <label style={lbl}>Valor mensal de cada (R$)<AjudaCampo chave="comrec.sim_valor" />
            <input style={inp} inputMode="decimal" value={simValor} onChange={(e) => setSimValor(e.target.value)} /></label>
          <label style={lbl}>% de comissão<AjudaCampo chave="comrec.sim_pct" />
            <input style={inp} inputMode="decimal" value={simPct} onChange={(e) => setSimPct(e.target.value)} /></label>
        </div>
        <div className="mt-3 text-sm" data-testid="comrec-sim-resultado">
          Comissão mensal sobe <b style={{ color: GOLD }}>{brl(simMes)}</b> (de {brl(atualMes)} para {brl(atualMes + simMes)}) · em 12 meses: <b>{brl(simMes * 12)}</b>.
        </div>
      </Bloco>
    </div>
  )
}

// ───────────────────────────── Contratos & comissões ─────────────────────────────
function ContratosAba({ contratos, regras, fornPorId, onNova, onEditar, onExcluir, onToast, onRecarregar }: {
  contratos: Contrato[]; regras: Regra[]; fornPorId: Record<string, Fornecedor>
  onNova: (contratoId: string) => void; onEditar: (r: Regra) => void; onExcluir: (r: Regra) => void
  onToast: (m: string) => void; onRecarregar: () => void
}) {
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<'com' | 'sem' | 'todos'>(regras.length ? 'com' : 'todos')
  const [aberto, setAberto] = useState<string | null>(null)
  const regrasPor = useMemo(() => {
    const m: Record<string, Regra[]> = {}
    for (const r of regras) (m[r.contrato_id] ??= []).push(r)
    return m
  }, [regras])
  const q = busca.trim().toLowerCase()
  const lista = contratos.filter((c) => {
    const rs = regrasPor[c.id] ?? []
    if (filtro === 'com' && rs.length === 0) return false
    if (filtro === 'sem' && rs.length > 0) return false
    if (!q) return true
    const hay = `${c.cliente_nome ?? ''} ${c.nome} ${c.numero} ${c.tipo ?? ''} ${rs.map((r) => nomeForn(fornPorId[r.fornecedor_id])).join(' ')}`.toLowerCase()
    return hay.includes(q)
  })

  return (
    <div className="space-y-3" data-testid="comrec-contratos">
      <div className="flex gap-3 flex-wrap items-end">
        <label style={{ ...lbl, flex: '1 1 220px' }}>Buscar<AjudaCampo chave="comrec.busca_contrato" />
          <input style={inp} placeholder="Cliente, contrato ou vendedor" value={busca} onChange={(e) => setBusca(e.target.value)} /></label>
        <label style={lbl}>Mostrar<AjudaCampo chave="comrec.filtro_contrato" />
          <select style={inp} value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} data-testid="comrec-filtro-contratos">
            <option value="com">Com comissão</option><option value="sem">Sem comissão</option><option value="todos">Todos</option>
          </select></label>
      </div>
      {contratos.length === 0 && (
        <Vazio titulo="Nenhum contrato de receita nesta empresa"
          texto="As comissões usam os contratos recorrentes já cadastrados. Cadastre o contrato do cliente primeiro."
          acao={<a href="/dashboard/cadastros/contratos-recorrentes" style={btnPri}>Abrir contratos recorrentes</a>} />
      )}
      {contratos.length > 0 && lista.length === 0 && <p className="text-sm" style={{ color: MUTED }}>Nenhum contrato neste filtro.</p>}
      {lista.slice(0, 300).map((c) => {
        const rs = regrasPor[c.id] ?? []
        const ativo = c.status === 'ativo'
        return (
          <div key={c.id} className="rounded-xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }} data-testid="comrec-contrato">
            <div className="flex justify-between gap-3 flex-wrap">
              <div>
                <div className="font-semibold">{c.cliente_nome ?? 'Cliente'} · {c.nome}</div>
                <div className="text-[12px]" style={{ color: MUTED }}>
                  {c.numero} · {c.tipo ?? 'sem tipo'} · {brl(valorMensal(c))}/mês ·{' '}
                  <span style={{ color: ativo ? GREEN : RED, fontWeight: 600 }}>{c.status ?? '—'}</span>
                  {!ativo && (c.data_suspensao || c.data_encerramento) && ` desde ${dataBR(c.data_suspensao ?? c.data_encerramento)}`}
                </div>
              </div>
              <div className="flex gap-2 flex-wrap items-start">
                <button style={btnSec} onClick={() => onNova(c.id)}>+ Vendedor neste contrato</button>
                {rs.length > 0 && <button style={btnSec} onClick={() => setAberto(aberto === c.id ? null : c.id)}>{aberto === c.id ? 'Fechar esteira' : 'Ver esteira'}</button>}
              </div>
            </div>
            {rs.length > 0 && (
              <div className="mt-3 grid gap-2">
                {rs.map((r) => {
                  const f = fornPorId[r.fornecedor_id]
                  return (
                    <div key={r.id} className="rounded-lg p-3 flex justify-between gap-2 flex-wrap items-center" style={{ background: BG }}>
                      <div className="text-sm">
                        <b>{nomeForn(f)}</b> · {rotuloRegra(r)} · ≈ {brl(comissaoMensal(r, c))}/mês
                        <div className="text-[11px]" style={{ color: MUTED }}>
                          {r.vertical ? `${r.vertical} · ` : ''}desde {dataBR(r.vigencia_inicio)}{r.vigencia_fim ? ` até ${dataBR(r.vigencia_fim)}` : ' · enquanto o contrato durar'} · vence em {r.dias_vencimento} dia(s)
                          {!r.ativo && <span style={{ color: AMBER, fontWeight: 600 }}> · pausada</span>}
                          {f && !prontoPagar(f) && <span style={{ color: RED }}> · vendedor sem PIX/conta</span>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button style={btnLink} onClick={() => onEditar(r)}>Editar</button>
                        <button style={{ ...btnLink, color: RED }} onClick={() => onExcluir(r)} className="inline-flex items-center">Excluir<AjudaCampo chave="comrec.excluir_regra" /></button>
                      </div>
                    </div>)
                })}
              </div>
            )}
            {aberto === c.id && <Esteira contratoId={c.id} onToast={onToast} onRecarregar={onRecarregar} />}
          </div>)
      })}
      {lista.length > 300 && <p className="text-sm" style={{ color: MUTED }}>Mostrando 300 de {lista.length}: use a busca.</p>}
    </div>
  )
}

function Esteira({ contratoId, onToast, onRecarregar }: { contratoId: string; onToast: (m: string) => void; onRecarregar: () => void }) {
  const [eventos, setEventos] = useState<Evento[] | null>(null)
  const [rodando, setRodando] = useState(false)
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('erp_comissao_recorrente_evento')
      .select('id, tipo, mensagem, created_at, pagar_id').eq('contrato_id', contratoId)
      .order('created_at', { ascending: false }).limit(40)
    if (error) onToast(erroAmigavel(error, 'carregar a esteira'))
    setEventos((data ?? []) as Evento[])
  }, [contratoId, onToast])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega a esteira quando o contrato abre
  useEffect(() => { carregar() }, [carregar])
  async function reprocessar() {
    setRodando(true)
    const { data, error } = await supabase.rpc('fn_comissao_recorrente_reprocessar_contrato', { p_contrato_id: contratoId })
    setRodando(false)
    const d = data as { ok?: boolean; geradas?: number; estornadas?: number; recebimentos?: number } | null
    if (error || !d?.ok) { onToast(erroAmigavel(error ?? d, 'reprocessar o contrato')); return }
    onToast(`${d.recebimentos ?? 0} recebimento(s) conferido(s): ${d.geradas ?? 0} comissão(ões) gerada(s), ${d.estornadas ?? 0} estornada(s).`)
    carregar(); onRecarregar()
  }
  const icone: Record<string, LucideIcon> = { identificado: Search, gerada: ReceiptText, estornada: Undo2, sem_comissao: PauseCircle, erro: AlertTriangle }
  return (
    <div className="mt-3 rounded-lg p-3" style={{ border: `1px dashed ${LINE}` }} data-testid="comrec-esteira">
      <div className="flex justify-between items-center gap-2 flex-wrap mb-2">
        <div className="text-[11px] uppercase font-semibold flex items-center" style={{ color: MUTED }}>Cliente pagou → sistema identificou → gerou conta a pagar<AjudaCampo chave="comrec.esteira" /></div>
        <button style={btnSec} onClick={reprocessar} disabled={rodando} className="inline-flex items-center">{rodando ? 'Conferindo…' : 'Reprocessar pagamentos'}<AjudaCampo chave="comrec.reprocessar" /></button>
      </div>
      {eventos === null ? <p className="text-sm" style={{ color: MUTED }}>Carregando…</p> : eventos.length === 0 ? (
        <p className="text-sm" style={{ color: MUTED }}>Nenhum pagamento deste contrato passou pela comissão ainda. Quando o cliente pagar, aparece aqui.</p>
      ) : (
        <ol className="space-y-1 text-sm">
          {eventos.map((e) => (
            <li key={e.id} className="flex gap-2" style={{ color: e.tipo === 'erro' ? RED : e.tipo === 'estornada' ? AMBER : ESP }}>
              {(() => { const Ic = icone[e.tipo] ?? Search; return <Ic aria-hidden size={16} strokeWidth={1.5} style={{ flex: '0 0 auto', marginTop: 2 }} /> })()}
              <span><span style={{ color: MUTED }}>{new Date(e.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span> · {e.mensagem}</span>
            </li>))}
        </ol>)}
    </div>
  )
}

// ───────────────────────────── Comissões geradas (livro) ─────────────────────────────
function GeradasAba({ lancs, fornecedores, contratos }: { lancs: Lancamento[]; fornecedores: Fornecedor[]; contratos: Contrato[] }) {
  const [fVend, setFVend] = useState('')
  const [fContrato, setFContrato] = useState('')
  const [fComp, setFComp] = useState('')
  const [fStatus, setFStatus] = useState<'' | 'gerada' | 'estornada'>('')
  const vendIds = useMemo(() => new Set(lancs.map((l) => l.fornecedor_id)), [lancs])
  const contIds = useMemo(() => new Set(lancs.map((l) => l.contrato_id)), [lancs])
  const lista = lancs.filter((l) => (!fVend || l.fornecedor_id === fVend) && (!fContrato || l.contrato_id === fContrato)
    && (!fComp || (l.competencia ?? '').startsWith(fComp)) && (!fStatus || l.status === fStatus))
  const total = lista.filter((l) => l.status === 'gerada').reduce((s, l) => s + Number(l.valor_comissao), 0)

  return (
    <div className="space-y-3" data-testid="comrec-geradas">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <label style={lbl}>Vendedor<AjudaCampo chave="comrec.f_vendedor" />
          <select style={inp} value={fVend} onChange={(e) => setFVend(e.target.value)}>
            <option value="">Todos</option>
            {fornecedores.filter((f) => vendIds.has(f.id)).map((f) => <option key={f.id} value={f.id}>{nomeForn(f)}</option>)}
          </select></label>
        <label style={lbl}>Contrato<AjudaCampo chave="comrec.f_contrato" />
          <select style={inp} value={fContrato} onChange={(e) => setFContrato(e.target.value)}>
            <option value="">Todos</option>
            {contratos.filter((c) => contIds.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.cliente_nome ?? ''} · {c.nome}</option>)}
          </select></label>
        <label style={lbl}>Competência<AjudaCampo chave="comrec.f_competencia" />
          <input type="month" style={inp} value={fComp} onChange={(e) => setFComp(e.target.value)} /></label>
        <label style={lbl}>Situação<AjudaCampo chave="comrec.f_status" />
          <select style={inp} value={fStatus} onChange={(e) => setFStatus(e.target.value as typeof fStatus)}>
            <option value="">Todas</option><option value="gerada">Geradas</option><option value="estornada">Estornadas</option>
          </select></label>
      </div>
      <div className="text-sm flex items-center" style={{ color: MUTED }}>{lista.length} linha(s) · {brl(total)} gerados no filtro<AjudaCampo chave="comrec.livro" /></div>
      {lancs.length === 0 && <Vazio titulo="Nenhuma comissão gerada ainda" texto="Assim que um cliente com contrato comissionado pagar, a comissão aparece aqui ligada à conta a pagar do vendedor." />}
      <div className="space-y-2">
        {lista.slice(0, 500).map((l) => {
          const pago = l.pagar_status === 'pago'
          return (
            <div key={l.id} className="rounded-xl p-3 flex justify-between gap-3 flex-wrap" style={{ background: '#fff', border: `1px solid ${LINE}`, opacity: l.status === 'estornada' ? 0.75 : 1 }} data-testid="comrec-lancamento">
              <div className="text-sm min-w-[220px] flex-1">
                <div><b>{l.vendedor ?? 'Vendedor'}</b> · {l.cliente ?? '—'} · {l.contrato ?? ''}</div>
                <div className="text-[12px]" style={{ color: MUTED }}>
                  Cliente pagou {brl(l.valor_base)} em {dataBR(l.competencia)}{l.recebivel_documento ? ` (título ${l.recebivel_documento})` : ''} →{' '}
                  {l.percentual_aplicado != null ? `${String(l.percentual_aplicado).replace('.', ',')}%` : `fixo ${brl(l.valor_fixo_aplicado)} proporcional`} → conta a pagar {l.pagar_documento ?? ''}
                </div>
                {l.status === 'estornada' && (
                  <div className="text-[12px]" style={{ color: l.pendencia ? RED : AMBER }}>
                    Estornada em {dataBR(l.estornado_em)}: {l.estornado_motivo}{l.pendencia ? ` · ${l.pendencia}` : ''}
                  </div>)}
              </div>
              <div className="text-right">
                <div className="font-bold" style={{ color: l.status === 'estornada' ? MUTED : GOLD, textDecoration: l.status === 'estornada' ? 'line-through' : undefined }}>{brl(l.valor_comissao)}</div>
                <div className="text-[11px]" style={{ color: pago ? GREEN : MUTED }}>
                  {l.status === 'estornada' ? 'estornada' : pago ? 'paga ao vendedor' : `pendente · vence ${dataBR(l.pagar_vencimento)}`}
                </div>
                {l.pagar_documento && (
                  <a className="text-[12px] underline inline-flex items-center" style={{ color: ESP }}
                     href={`/dashboard/financeiro/pagar?busca=${encodeURIComponent(l.pagar_documento)}`}>Ver no contas a pagar<AjudaCampo chave="comrec.ver_pagar" /></a>)}
              </div>
            </div>)
        })}
      </div>
    </div>
  )
}

// ───────────────────────────── Vendedores ─────────────────────────────
function VendedoresAba({ fornecedores, regras, painel, onEditar }: {
  fornecedores: Fornecedor[]; regras: Regra[]; painel: Painel | null; onEditar: (f: Fornecedor) => void
}) {
  const comRegra = new Set(regras.map((r) => r.fornecedor_id))
  const lista = fornecedores.filter((f) => comRegra.has(f.id) || (f.categoria ?? '').toLowerCase() === 'vendedor')
  const porVend = Object.fromEntries((painel?.por_vendedor ?? []).map((v) => [v.fornecedor_id, v]))
  return (
    <div className="space-y-3" data-testid="comrec-vendedores">
      <p className="text-sm" style={{ color: MUTED }}>
        O vendedor é cadastrado como fornecedor da empresa: com PIX ou conta bancária preenchidos, a conta a pagar de cada comissão já nasce pronta para pagar.
      </p>
      {lista.length === 0 && <Vazio titulo="Nenhum vendedor ainda" texto='Toque em "+ Vendedor" no topo para cadastrar o primeiro (nome, CPF/CNPJ, telefone e PIX).' />}
      <div className="grid gap-2 md:grid-cols-2">
        {lista.map((f) => {
          const ok = prontoPagar(f); const v = porVend[f.id]
          return (
            <div key={f.id} className="rounded-xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }} data-testid="comrec-vendedor">
              <div className="flex justify-between gap-2">
                <div>
                  <div className="font-semibold">{nomeForn(f)} <span className="text-[11px]" style={{ color: MUTED }}>{f.tipo_pessoa ?? ''}</span></div>
                  <div className="text-[12px]" style={{ color: MUTED }}>{f.cpf_cnpj ?? f.cnpj_cpf ?? 'sem CPF/CNPJ'} · {f.whatsapp ?? f.celular ?? f.telefone ?? 'sem telefone'}</div>
                </div>
                <span className="text-[11px] px-2 py-0.5 rounded-full h-fit inline-flex items-center" style={{ background: ok ? '#DCEFD7' : '#FBE3E0', color: ok ? GREEN : RED, fontWeight: 600 }}>
                  {ok ? 'pronto para pagar' : 'falta PIX/conta'}<AjudaCampo chave="comrec.v_pronto" />
                </span>
              </div>
              <div className="text-[12px] mt-2">{f.pix ? `PIX ${f.pix}` : f.banco ? `Banco ${f.banco} · Ag ${f.agencia ?? '—'} · CC ${f.conta ?? '—'}` : ''}</div>
              {v && <div className="text-[12px] mt-1" style={{ color: MUTED }}>{v.contratos} contrato(s) · {brl(v.prevista)}/mês · projeção {brl(v.projecao)} · a pagar {brl(v.a_pagar)}</div>}
              <button style={{ ...btnLink, marginTop: 8 }} onClick={() => onEditar(f)}>Editar dados de pagamento</button>
            </div>)
        })}
      </div>
    </div>
  )
}

// ───────────────────────────── Modais ─────────────────────────────
function RegraModal({ empresa, inicial, contratos, fornecedores, onFechar, onSalvo, onNovoVendedor }: {
  empresa: string; inicial: Partial<Regra>; contratos: Contrato[]; fornecedores: Fornecedor[]
  onFechar: () => void; onSalvo: (m: string) => void; onNovoVendedor: () => void
}) {
  const [d, setD] = useState<Partial<Regra>>(inicial)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [filtroVend, setFiltroVend] = useState('')
  const set = <K extends keyof Regra>(k: K, v: Regra[K] | null) => setD((x) => ({ ...x, [k]: v }))
  const contrato = contratos.find((c) => c.id === d.contrato_id)
  const vendOpc = fornecedores.filter((f) => !filtroVend.trim() || nomeForn(f).toLowerCase().includes(filtroVend.trim().toLowerCase()) || f.id === d.fornecedor_id).slice(0, 300)
  const exemplo = contrato ? (d.tipo_comissao === 'fixo' ? Number(d.valor_fixo) || 0 : ((Number(d.percentual) || 0) / 100) * valorMensal(contrato)) : 0

  async function salvar() {
    setSalvando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_comissao_recorrente_regra_salvar', { p_company_id: empresa, p_dados: d })
    setSalvando(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error) { setErro(erroAmigavel(error, 'salvar a comissão')); return }
    if (!r?.ok) { setErro(r?.erro ?? 'Não foi possível salvar.'); return }
    onSalvo(d.id ? 'Comissão atualizada.' : 'Comissão cadastrada: o próximo pagamento do cliente já gera a conta a pagar do vendedor.')
  }

  return (
    <Modal titulo={d.id ? 'Editar comissão' : 'Comissão em contrato'} onFechar={onFechar}>
      <div className="grid gap-3" data-testid="comrec-form-regra">
        <label style={lbl}>Contrato (cliente · pacote)<AjudaCampo chave="comrec.contrato" />
          <select style={inp} value={d.contrato_id ?? ''} onChange={(e) => set('contrato_id', e.target.value)} data-testid="comrec-regra-contrato">
            <option value="">Escolha…</option>
            {contratos.map((c) => <option key={c.id} value={c.id}>{c.cliente_nome ?? 'Cliente'} · {c.nome} · {brl(valorMensal(c))}/mês{c.status !== 'ativo' ? ` (${c.status})` : ''}</option>)}
          </select></label>
        <label style={lbl}>Vendedor<AjudaCampo chave="comrec.vendedor" />
          <input style={inp} placeholder="Digite para filtrar" value={filtroVend} onChange={(e) => setFiltroVend(e.target.value)} />
          <select style={inp} value={d.fornecedor_id ?? ''} onChange={(e) => set('fornecedor_id', e.target.value)} data-testid="comrec-regra-vendedor">
            <option value="">Escolha…</option>
            {vendOpc.map((f) => <option key={f.id} value={f.id}>{nomeForn(f)}{prontoPagar(f) ? '' : ' (sem PIX/conta)'}</option>)}
          </select></label>
        <button style={{ ...btnLink, justifySelf: 'start' }} onClick={onNovoVendedor}>+ Cadastrar vendedor novo</button>
        <div className="grid grid-cols-2 gap-3">
          <label style={lbl}>Tipo<AjudaCampo chave="comrec.tipo" />
            <select style={inp} value={d.tipo_comissao ?? 'percentual'} onChange={(e) => set('tipo_comissao', e.target.value as Regra['tipo_comissao'])}>
              <option value="percentual">% do que o cliente pagou</option><option value="fixo">Valor fixo por pagamento</option>
            </select></label>
          {d.tipo_comissao === 'fixo' ? (
            <label style={lbl}>Valor fixo (R$)<AjudaCampo chave="comrec.valor_fixo" />
              {/* #6874 — campo monetário padrão (CampoMoeda): texto mascarado em R$; o número puro continua indo ao banco
                  (d.valor_fixo segue number via moedaParaNumero), sem mudar o cálculo do exemplo nem o RPC de salvar. */}
              <CampoMoeda value={numeroParaMoeda(d.valor_fixo)} onChange={(v) => set('valor_fixo', moedaParaNumero(v))} placeholder="R$ 0,00" style={inp} testId="comrec-regra-valor-fixo" /></label>
          ) : (
            <label style={lbl}>Percentual (%)<AjudaCampo chave="comrec.percentual" />
              <input style={inp} type="number" min="0" max="100" step="0.01" value={d.percentual ?? ''} onChange={(e) => set('percentual', e.target.value === '' ? null : Number(e.target.value))} data-testid="comrec-regra-pct" /></label>
          )}
        </div>
        {contrato && <div className="text-sm rounded-lg p-2" style={{ background: BG }}>Cliente pagando {brl(valorMensal(contrato))} → vendedor recebe <b style={{ color: GOLD }}>{brl(exemplo)}</b> por pagamento.</div>}
        <label style={lbl}>Vertical ou serviço (opcional)<AjudaCampo chave="comrec.vertical" />
          <input style={inp} placeholder={contrato?.tipo ?? 'Ex.: BPO Financeiro'} value={d.vertical ?? ''} onChange={(e) => set('vertical', e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label style={lbl}>Início da vigência<AjudaCampo chave="comrec.vigencia_inicio" />
            <input style={inp} type="date" value={d.vigencia_inicio ?? ''} onChange={(e) => set('vigencia_inicio', e.target.value)} /></label>
          <label style={lbl}>Fim (opcional)<AjudaCampo chave="comrec.vigencia_fim" />
            <input style={inp} type="date" value={d.vigencia_fim ?? ''} onChange={(e) => set('vigencia_fim', e.target.value || null)} /></label>
        </div>
        <div className="grid grid-cols-2 gap-3 items-end">
          <label style={lbl}>Pagar o vendedor em (dias)<AjudaCampo chave="comrec.dias_vencimento" />
            <input style={inp} type="number" min="0" max="120" value={d.dias_vencimento ?? 7} onChange={(e) => set('dias_vencimento', Number(e.target.value))} /></label>
          <label style={{ ...lbl, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={d.ativo ?? true} onChange={(e) => set('ativo', e.target.checked)} /> Regra ativa<AjudaCampo chave="comrec.ativo" /></label>
        </div>
        <label style={lbl}>Observação<AjudaCampo chave="comrec.observacao" />
          <textarea style={{ ...inp, minHeight: 60 }} value={d.observacao ?? ''} onChange={(e) => set('observacao', e.target.value)} /></label>
        <p className="text-[12px]" style={{ color: MUTED }}>A conta a pagar nasce pendente: o sistema nunca paga o vendedor sozinho.</p>
        {erro && <p className="text-sm" style={{ color: RED }} role="alert">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button style={btnSec} onClick={onFechar}>Cancelar</button>
          <button style={btnPri} onClick={salvar} disabled={salvando} data-testid="comrec-regra-salvar">{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </Modal>
  )
}

function ExcluirModal({ regra, vendedor, onFechar, onFeito }: { regra: Regra; vendedor: string; onFechar: () => void; onFeito: (m: string) => void }) {
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  async function confirmar() {
    const { data, error } = await supabase.rpc('fn_comissao_recorrente_regra_excluir', { p_id: regra.id, p_motivo: motivo })
    const r = data as { ok?: boolean; erro?: string } | null
    if (error) { setErro(erroAmigavel(error, 'excluir a comissão')); return }
    if (!r?.ok) { setErro(r?.erro ?? 'Não foi possível excluir.'); return }
    onFeito('Comissão excluída. O que já foi gerado continua em Comissões geradas.')
  }
  return (
    <Modal titulo={`Excluir a comissão de ${vendedor}`} onFechar={onFechar}>
      <p className="text-sm mb-3">Os próximos pagamentos deste contrato não geram mais comissão para {vendedor}. O histórico fica guardado com o motivo e quem excluiu.</p>
      <label style={lbl}>Motivo<AjudaCampo chave="comrec.motivo_exclusao" />
        <textarea style={{ ...inp, minHeight: 70 }} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></label>
      {erro && <p className="text-sm mt-2" style={{ color: RED }} role="alert">{erro}</p>}
      <div className="flex justify-end gap-2 mt-3">
        <button style={btnSec} onClick={onFechar}>Cancelar</button>
        <button style={{ ...btnPri, background: RED }} onClick={confirmar} disabled={!motivo.trim()}>Excluir</button>
      </div>
    </Modal>
  )
}

function VendedorModal({ empresa, inicial, onFechar, onSalvo }: { empresa: string; inicial: Partial<Fornecedor>; onFechar: () => void; onSalvo: (m: string) => void }) {
  const [d, setD] = useState({
    id: inicial.id ?? '', nome: inicial.nome_fantasia ?? '', tipo_pessoa: inicial.tipo_pessoa ?? 'PF',
    cpf_cnpj: inicial.cpf_cnpj ?? inicial.cnpj_cpf ?? '', telefone: inicial.telefone ?? '', whatsapp: inicial.whatsapp ?? inicial.celular ?? '',
    email: inicial.email ?? '', pix: inicial.pix ?? '', banco: inicial.banco ?? '', agencia: inicial.agencia ?? '', conta: inicial.conta ?? '',
  })
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const set = (k: keyof typeof d, v: string) => setD((x) => ({ ...x, [k]: v }))
  async function salvar() {
    setSalvando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_comissao_recorrente_vendedor_salvar', { p_company_id: empresa, p_dados: { ...d, celular: d.whatsapp } })
    setSalvando(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error) { setErro(erroAmigavel(error, 'salvar o vendedor')); return }
    if (!r?.ok) { setErro(r?.erro ?? 'Não foi possível salvar.'); return }
    onSalvo(d.id ? 'Vendedor atualizado.' : 'Vendedor cadastrado: já pode ligá-lo a um contrato.')
  }
  return (
    <Modal titulo={d.id ? 'Dados do vendedor' : 'Novo vendedor'} onFechar={onFechar}>
      <div className="grid gap-3" data-testid="comrec-form-vendedor">
        <label style={lbl}>Nome<AjudaCampo chave="comrec.v_nome" />
          <input style={inp} value={d.nome} onChange={(e) => set('nome', e.target.value)} data-testid="comrec-vend-nome" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label style={lbl}>PF ou PJ<AjudaCampo chave="comrec.v_tipo_pessoa" />
            <select style={inp} value={d.tipo_pessoa} onChange={(e) => set('tipo_pessoa', e.target.value)}><option value="PF">Pessoa física</option><option value="PJ">Pessoa jurídica</option></select></label>
          <label style={lbl}>{d.tipo_pessoa === 'PJ' ? 'CNPJ' : 'CPF'}<AjudaCampo chave="comrec.v_documento" />
            <input style={inp} inputMode="numeric" value={d.cpf_cnpj} onChange={(e) => set('cpf_cnpj', e.target.value)} /></label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label style={lbl}>WhatsApp / celular<AjudaCampo chave="comrec.v_contato" />
            <input style={inp} inputMode="tel" value={d.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} /></label>
          <label style={lbl}>Telefone<AjudaCampo chave="comrec.v_contato" />
            <input style={inp} inputMode="tel" value={d.telefone} onChange={(e) => set('telefone', e.target.value)} /></label>
        </div>
        <label style={lbl}>E-mail<AjudaCampo chave="comrec.v_email" />
          <input style={inp} type="email" value={d.email} onChange={(e) => set('email', e.target.value)} /></label>
        <label style={lbl}>Chave PIX<AjudaCampo chave="comrec.v_pix" />
          <input style={inp} value={d.pix} onChange={(e) => set('pix', e.target.value)} data-testid="comrec-vend-pix" /></label>
        <div className="grid grid-cols-3 gap-3">
          <label style={lbl}>Banco<AjudaCampo chave="comrec.v_banco" /><input style={inp} value={d.banco} onChange={(e) => set('banco', e.target.value)} /></label>
          <label style={lbl}>Agência<AjudaCampo chave="comrec.v_banco" /><input style={inp} value={d.agencia} onChange={(e) => set('agencia', e.target.value)} /></label>
          <label style={lbl}>Conta<AjudaCampo chave="comrec.v_banco" /><input style={inp} value={d.conta} onChange={(e) => set('conta', e.target.value)} /></label>
        </div>
        {erro && <p className="text-sm" style={{ color: RED }} role="alert">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button style={btnSec} onClick={onFechar}>Cancelar</button>
          <button style={btnPri} onClick={salvar} disabled={salvando} data-testid="comrec-vend-salvar">{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </Modal>
  )
}

// ───────────────────────────── Peças visuais ─────────────────────────────
function Modal({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(30,18,10,0.45)', zIndex: 50 }} onClick={onFechar}>
      <div className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5" style={{ background: '#fff', color: ESP }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={titulo}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">{titulo}</h2>
          <button onClick={onFechar} aria-label="Fechar" style={{ ...btnLink, fontSize: 20 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
function Kpi({ titulo, valor, sub, destaque, ajuda }: { titulo: string; valor: string; sub?: string; destaque?: boolean; ajuda: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: BG, minHeight: 84 }}>
      <div className="text-[11px] uppercase leading-tight flex items-center" style={{ color: MUTED }}>{titulo}<AjudaCampo chave={ajuda} /></div>
      <div className="text-lg font-bold leading-tight mt-1" style={{ color: destaque ? GOLD : ESP }}>{valor}</div>
      {sub && <div className="text-[11px]" style={{ color: MUTED }}>{sub}</div>}
    </div>
  )
}
function Bloco({ titulo, ajuda, children }: { titulo: string; ajuda: string; children: ReactNode }) {
  return (
    <section className="rounded-xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
      <h2 className="font-semibold mb-3 flex items-center">{titulo}<AjudaCampo chave={ajuda} /></h2>
      <div className="overflow-x-auto">{children}</div>
    </section>
  )
}
function Vazio({ titulo, texto, acao }: { titulo: string; texto: string; acao?: ReactNode }) {
  return (
    <div className="rounded-xl p-6 text-center" style={{ background: BG }}>
      <p className="font-medium">{titulo}</p>
      <p className="text-sm mb-3" style={{ color: MUTED }}>{texto}</p>
      {acao}
    </div>
  )
}

const tabBar: CSSProperties = { display: 'flex', gap: 4, borderBottom: `1px solid ${LINE}`, marginBottom: 16, overflowX: 'auto' }
const tab = (on: boolean): CSSProperties => ({
  padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer', whiteSpace: 'nowrap',
  borderBottom: on ? `3px solid ${GOLD}` : '3px solid transparent', color: on ? ESP : MUTED, fontWeight: on ? 700 : 500,
})
const lbl: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: ESP }
const inp: CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 10px', fontSize: 14, fontWeight: 400, background: '#fff', color: ESP, width: '100%' }
const btnPri: CSSProperties = { background: ESP, color: '#fff', border: 'none', borderRadius: 10, padding: '9px 14px', fontWeight: 600, cursor: 'pointer', fontSize: 14, display: 'inline-block' }
const btnSec: CSSProperties = { background: '#fff', color: ESP, border: `1px solid ${LINE}`, borderRadius: 10, padding: '8px 12px', fontWeight: 600, cursor: 'pointer', fontSize: 13 }
const btnLink: CSSProperties = { background: 'transparent', border: 'none', color: ESP, textDecoration: 'underline', cursor: 'pointer', fontSize: 13, padding: 0 }
