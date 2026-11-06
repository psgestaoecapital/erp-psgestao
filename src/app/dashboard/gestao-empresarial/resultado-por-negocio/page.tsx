'use client'

// GE › Resultado por negócio (CEO 06/11/2026). Quanto cada linha de negócio entrega de resultado no período.
// Lê só a fn_ge_resultado_por_negocio (porta com login + empresa do usuário). As regras ficam em Centros de Custo:
// linha de negócio da receita > centro de custo do lançamento > texto > conta; o comum é rateado pela receita.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useEmpresaSelecionada } from '@/lib/agro/usePecuaria'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.6)'; const GREEN = '#4E7D34'; const RED = '#B23A2E'

type Negocio = {
  id: string; nome: string; receita: number; deducoes: number; custos: number; desp_variaveis: number; desp_fixas: number
  resultado_direto: number; pct_rateio: number; rateio: number; resultado_operacional: number; nao_operacional: number
  resultado: number; margem_pct: number | null
}
type ContaLinha = { negocio: string; conta: string; nome: string; linha: string; via: string; valor: number; qtd: number }
type SemRegra = { conta: string; nome: string; origem: string; valor: number; qtd: number }
type Dados = {
  metodo_rateio: string
  negocios: Negocio[]
  comum: { total: number; rateado: number }
  sem_negocio: { receita: number; outras: number }
  fora_do_resultado: { investimentos: number; distribuicao: number; neutro: number }
  total_empresa: number
  contas: ContaLinha[]
  sem_regra: SemRegra[]
}

const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const hoje = new Date()
const mesStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const fimDoMes = (m: string) => { const [a, mm] = m.split('-').map(Number); return `${m}-${String(new Date(a, mm, 0).getDate()).padStart(2, '0')}` }
const NOME_LINHA: Record<string, string> = {
  receita: 'Receita', deducoes: 'Impostos e deduções', custos: 'Custos', desp_variaveis: 'Despesas variáveis',
  desp_fixas: 'Despesas fixas', nao_operacional: 'Não operacional',
}

export default function ResultadoPorNegocioPage() {
  const { companyId } = useEmpresaSelecionada()
  const empresa = companyId && !companyId.startsWith('group_') && companyId !== 'consolidado' ? companyId : null
  const [ini, setIni] = useState(`${hoje.getFullYear()}-01`)
  const [fim, setFim] = useState(mesStr(hoje))
  const [regime, setRegime] = useState<'competencia' | 'caixa'>('competencia')
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [aberto, setAberto] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) return
    setCarregando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_ge_resultado_por_negocio', {
      p_company_id: empresa, p_ini: `${ini}-01`, p_fim: fimDoMes(fim), p_regime: regime,
    })
    setCarregando(false)
    if (error) { setErro(error.message); setDados(null); return }
    setDados(data as Dados)
  }, [empresa, ini, fim, regime])

  useEffect(() => { void carregar() }, [carregar])

  const somaNegocios = useMemo(() => (dados?.negocios ?? []).reduce((s, n) => s + Number(n.resultado), 0), [dados])

  if (!empresa) return <div style={{ padding: 24, color: ESP60 }}>Selecione UMA empresa específica.</div>

  return (
    <div style={{ padding: '24px 16px', background: BG, minHeight: '100vh', color: ESP, maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.3 }}>Resultado por negócio</div>
      <div style={{ fontSize: 13, color: ESP60, marginBottom: 18 }}>
        Quanto cada negócio entrega depois dos seus custos e da sua parte do comum. As regras ficam em{' '}
        <a href="/dashboard/gestao-empresarial/centros-custo" style={{ color: GOLD, fontWeight: 600 }}>Centros de Custo</a>.
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 18 }}>
        <label style={lbl}>
          <span style={lblTxt}>De <AjudaCampo chave="rpn.periodo" /></span>
          <input type="month" style={inp} value={ini} onChange={(e) => setIni(e.target.value)} />
        </label>
        <label style={lbl}>
          <span style={lblTxt}>Até <AjudaCampo chave="rpn.periodo" /></span>
          <input type="month" style={inp} value={fim} onChange={(e) => setFim(e.target.value)} />
        </label>
        <label style={lbl}>
          <span style={lblTxt}>Visão <AjudaCampo chave="rpn.regime" /></span>
          <select style={inp} value={regime} onChange={(e) => setRegime(e.target.value as 'competencia' | 'caixa')}>
            <option value="competencia">Competência (resultado)</option>
            <option value="caixa">Caixa (pago e recebido)</option>
          </select>
        </label>
        {carregando && <span style={{ fontSize: 13, color: ESP60 }}>calculando…</span>}
      </div>

      {erro && <div style={{ color: RED, fontSize: 13, marginBottom: 12 }}>Erro: {erro}</div>}

      {dados && (
        <>
          {/* cartões por negócio */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginBottom: 18 }}>
            {dados.negocios.map((n) => (
              <button key={n.id} onClick={() => setAberto(aberto === n.nome ? null : n.nome)}
                style={{ textAlign: 'left', background: '#fff', border: `1px solid ${aberto === n.nome ? GOLD : LINE}`, borderRadius: 12, padding: 16, cursor: 'pointer', color: ESP }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: ESP60, textTransform: 'uppercase', letterSpacing: 0.6 }}>{n.nome}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: n.resultado >= 0 ? GREEN : RED, margin: '4px 0' }}>{brl(n.resultado)}</div>
                <div style={{ fontSize: 13, color: ESP60, display: 'flex', alignItems: 'center', gap: 4 }}>
                  resultado · margem {n.margem_pct == null ? '—' : `${n.margem_pct.toLocaleString('pt-BR')}%`} <AjudaCampo chave="rpn.margem" />
                </div>
                <div style={{ fontSize: 12, color: ESP60, marginTop: 8 }}>
                  {somaNegocios > 0 && n.resultado > 0 ? `${Math.round((n.resultado / somaNegocios) * 100)}% do resultado dos negócios · ` : ''}toque para ver as contas
                </div>
              </button>
            ))}
          </div>

          {/* DRE lado a lado */}
          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, overflowX: 'auto', marginBottom: 18 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead><tr style={{ color: ESP60 }}>
                <th style={{ ...th, textAlign: 'left' }}></th>
                {dados.negocios.map((n) => <th key={n.id} style={th}>{n.nome}</th>)}
              </tr></thead>
              <tbody>
                <Linha rotulo="Receita" ajuda="rpn.receita" vals={dados.negocios.map((n) => n.receita)} forte />
                <Linha rotulo="Impostos e deduções" vals={dados.negocios.map((n) => n.deducoes)} />
                <Linha rotulo="Custos diretos" ajuda="rpn.direto" vals={dados.negocios.map((n) => n.custos)} />
                <Linha rotulo="Despesas variáveis" vals={dados.negocios.map((n) => n.desp_variaveis)} />
                <Linha rotulo="Despesas fixas diretas" vals={dados.negocios.map((n) => n.desp_fixas)} />
                <Linha rotulo="Resultado direto" vals={dados.negocios.map((n) => n.resultado_direto)} forte />
                <Linha rotulo="Rateio do comum" ajuda="rpn.rateio" vals={dados.negocios.map((n) => n.rateio)}
                  extra={dados.negocios.map((n) => (n.pct_rateio ? `${n.pct_rateio.toLocaleString('pt-BR')}%` : ''))} />
                <Linha rotulo="Não operacional" vals={dados.negocios.map((n) => n.nao_operacional)} />
                <Linha rotulo="Resultado do negócio" ajuda="rpn.resultado" vals={dados.negocios.map((n) => n.resultado)} forte cor />
                <tr style={{ borderTop: `1px solid ${LINE}` }}>
                  <td style={{ ...td, color: ESP60 }}>Margem</td>
                  {dados.negocios.map((n) => <td key={n.id} style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{n.margem_pct == null ? '—' : `${n.margem_pct.toLocaleString('pt-BR')}%`}</td>)}
                </tr>
              </tbody>
            </table>
          </div>

          {/* totais e o que fica fora */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 18 }}>
            <Mini titulo="Resultado da empresa" valor={dados.total_empresa} nota="soma dos negócios + sem negócio" />
            <Mini titulo="Receita sem negócio" valor={dados.sem_negocio.receita + dados.sem_negocio.outras} nota="receita sem linha nem regra" />
            <Mini titulo="Comum rateado" valor={dados.comum.rateado} nota={dados.metodo_rateio === 'receita' ? 'dividido pela receita' : 'sem receita: não rateado'} ajuda="rpn.rateio" />
            <Mini titulo="Investimentos (fora)" valor={dados.fora_do_resultado.investimentos} nota="não é despesa do negócio" ajuda="rpn.fora" />
            <Mini titulo="Distribuição de lucros (fora)" valor={dados.fora_do_resultado.distribuicao} nota="retirada dos sócios" ajuda="rpn.fora" />
          </div>

          {/* detalhe do negócio aberto */}
          {aberto && (
            <div style={{ background: '#fff', border: `1px solid ${GOLD}`, borderRadius: 12, padding: 16, marginBottom: 18, overflowX: 'auto' }}>
              <div style={{ fontWeight: 800, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>De onde vem o resultado — {aberto} <AjudaCampo chave="rpn.detalhe" /></div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ color: ESP60, textAlign: 'left' }}><th style={th}>Conta</th><th style={th}>Linha do DRE</th><th style={th}>Regra que levou</th><th style={{ ...th, textAlign: 'right' }}>Lanç.</th><th style={{ ...th, textAlign: 'right' }}>Valor</th></tr></thead>
                <tbody>
                  {dados.contas.filter((c) => c.negocio === aberto).sort((a, b) => a.conta.localeCompare(b.conta, 'pt-BR', { numeric: true })).map((c, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}>
                      <td style={td}><b>{c.conta}</b> {c.nome}</td>
                      <td style={td}>{NOME_LINHA[c.linha] ?? c.linha}</td>
                      <td style={{ ...td, color: ESP60 }}>{c.via}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{c.qtd}</td>
                      <td style={{ ...td, textAlign: 'right', color: c.valor < 0 ? RED : GREEN, fontWeight: 600 }}>{brl(c.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* pendências de configuração */}
          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontWeight: 800, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>Contas sem regra <AjudaCampo chave="rpn.sem_regra" /></div>
            {dados.sem_regra.length === 0
              ? <div style={{ fontSize: 13, color: GREEN }}>Tudo com regra: nenhuma despesa caiu no rateio por falta de configuração.</div>
              : (
                <>
                  <div style={{ fontSize: 12, color: ESP60, marginBottom: 8 }}>Despesa sem regra vai para o rateio; receita sem regra fica em &quot;sem negócio&quot;. Cadastre a regra em <a href="/dashboard/gestao-empresarial/centros-custo" style={{ color: GOLD, fontWeight: 600 }}>Centros de Custo</a>.</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <tbody>
                      {dados.sem_regra.map((s, i) => (
                        <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}>
                          <td style={td}><b>{s.conta}</b> {s.nome}</td>
                          <td style={{ ...td, color: ESP60 }}>{s.origem === 'pagar' ? 'despesa → rateio' : 'receita → sem negócio'}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{s.qtd} lanç.</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{brl(s.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
          </div>
        </>
      )}
    </div>
  )
}

function Linha({ rotulo, vals, ajuda, forte, cor, extra }: { rotulo: string; vals: number[]; ajuda?: string; forte?: boolean; cor?: boolean; extra?: string[] }) {
  return (
    <tr style={{ borderTop: `1px solid ${LINE}`, background: forte ? '#FBF8F2' : 'transparent' }}>
      <td style={{ ...td, fontWeight: forte ? 700 : 400 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{rotulo}{ajuda && <AjudaCampo chave={ajuda} />}</span>
      </td>
      {vals.map((v, i) => (
        <td key={i} style={{ ...td, textAlign: 'right', fontWeight: forte ? 700 : 400, color: cor ? (v >= 0 ? GREEN : RED) : ESP, whiteSpace: 'nowrap' }}>
          {Number(v) === 0 ? '—' : brl(Number(v))}{extra?.[i] ? <span style={{ fontSize: 11, color: ESP60 }}> ({extra[i]})</span> : null}
        </td>
      ))}
    </tr>
  )
}

function Mini({ titulo, valor, nota, ajuda }: { titulo: string; valor: number; nota: string; ajuda?: string }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 12, color: ESP60, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>{titulo}{ajuda && <AjudaCampo chave={ajuda} />}</div>
      <div style={{ fontSize: 18, fontWeight: 800, margin: '2px 0' }}>{brl(Number(valor))}</div>
      <div style={{ fontSize: 11, color: ESP60 }}>{nota}</div>
    </div>
  )
}

const inp: React.CSSProperties = { padding: '8px 10px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 14, background: '#fff', color: ESP, minWidth: 150 }
const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }
const lblTxt: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: ESP60, display: 'flex', alignItems: 'center', gap: 4 }
const th: React.CSSProperties = { padding: '8px 10px', fontWeight: 700, whiteSpace: 'nowrap', textAlign: 'right' }
const td: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'middle' }
