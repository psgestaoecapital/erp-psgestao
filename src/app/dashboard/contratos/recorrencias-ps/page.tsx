'use client'

// RECORR-F4 · Recorrências PS (tela nova, ADITIVA). Lista/dashboard + wizard (4 passos) + preview do
// cronograma. Reusa o motor erp_contratos (fn_contrato_recorrencia_criar / fn_contrato_preview_cronograma
// / views v_contratos_*). NÃO substitui as telas existentes de contratos. Identidade Espresso, mobile-first.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF'
const MUT = 'rgba(61,35,20,0.55)', GREEN = '#166534', RED = '#A32D2D'
const brl = (n: number | null | undefined) => 'R$ ' + Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dt = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split('-').reverse().join('/') : '—')

type Contrato = {
  id: string; numero: string; nome: string | null; cliente_nome: string | null; tipo: string | null
  valor_mensal: number | null; valor_atual: number | null; periodicidade: string | null; status: string | null
  proxima_fatura_prevista: string | null; proximo_reajuste_em: string | null; situacao_vigencia: string | null
  situacao_reajuste: string | null; mrr_equivalente: number | null; faturas_vencidas: number | null
}
type ClienteOpt = { id: string; nome_fantasia: string | null; razao_social: string | null; cpf_cnpj: string | null }
type Comp = { data: string; valor: number; com_reajuste: boolean; o_que_gera: string }

const PERIODOS = [['mensal', 'Mensal'], ['bimestral', 'Bimestral'], ['trimestral', 'Trimestral'], ['semestral', 'Semestral'], ['anual', 'Anual']] as const
const hojeISO = () => new Date().toISOString().slice(0, 10)

export default function RecorrenciasPsPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)

  const [lista, setLista] = useState<Contrato[]>([])
  const [natMap, setNatMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState<'tudo' | 'receita' | 'despesa'>('tudo')
  const [wizardOpen, setWizardOpen] = useState(false)
  // Janela [hoje, hoje+30d] capturada uma vez (lazy init) — evita chamar new Date()/Date.now() no render.
  const [janela30] = useState<readonly [string, string]>(() => {
    const d = new Date(); const a = d.toISOString().slice(0, 10)
    d.setDate(d.getDate() + 30); return [a, d.toISOString().slice(0, 10)] as const
  })

  const carregar = useCallback(async () => {
    if (!empresa) { setLista([]); setLoading(false); return }
    setLoading(true)
    const [d, c] = await Promise.all([
      supabase.from('v_contratos_dashboard').select('id, numero, nome, cliente_nome, tipo, valor_mensal, valor_atual, periodicidade, status, proxima_fatura_prevista, proximo_reajuste_em, situacao_vigencia, situacao_reajuste, mrr_equivalente, faturas_vencidas').eq('company_id', empresa),
      supabase.from('erp_contratos').select('id, natureza').eq('company_id', empresa),
    ])
    setLista(((d.data ?? []) as Contrato[]))
    const m: Record<string, string> = {}
    for (const r of ((c.data ?? []) as { id: string; natureza: string | null }[])) m[r.id] = r.natureza ?? 'receita'
    setNatMap(m)
    setLoading(false)
  }, [empresa])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const filtrada = useMemo(() => lista.filter((c) => filtro === 'tudo' || (natMap[c.id] ?? 'receita') === filtro), [lista, natMap, filtro])
  const kpis = useMemo(() => {
    const em30 = (s: string | null) => { if (!s) return false; const v = s.slice(0, 10); return v >= janela30[0] && v <= janela30[1] }
    const ativos = lista.filter((c) => (c.status ?? 'ativo') === 'ativo')
    const mrrRec = ativos.filter((c) => (natMap[c.id] ?? 'receita') === 'receita').reduce((s, c) => s + Number(c.mrr_equivalente ?? 0), 0)
    const mrrDesp = ativos.filter((c) => natMap[c.id] === 'despesa').reduce((s, c) => s + Number(c.mrr_equivalente ?? 0), 0)
    const aGerar30 = ativos.filter((c) => em30(c.proxima_fatura_prevista)).reduce((s, c) => s + Number(c.valor_atual ?? c.valor_mensal ?? 0), 0)
    const proxReaj = ativos.map((c) => c.proximo_reajuste_em).filter(Boolean).sort()[0] as string | undefined
    return { mrrRec, mrrDesp, aGerar30, proxReaj }
  }, [lista, natMap, janela30])

  if (!empresa) return <div style={{ background: BG, minHeight: '100vh', padding: 40, color: MUT, fontSize: 14 }}>Selecione uma empresa específica para ver as recorrências.</div>

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px clamp(14px,4vw,40px)', color: ESP }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>🔁 Contratos &amp; Vendas</div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Recorrências PS</h1>
            <p style={{ fontSize: 12.5, color: MUT, margin: '4px 0 0' }}>Receita recorrente de serviço · cria o contrato e o sistema gera as competências sozinho.</p>
          </div>
          <button type="button" onClick={() => setWizardOpen(true)} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>+ Nova recorrência</button>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 16 }}>
          {[
            { l: 'MRR receita', v: brl(kpis.mrrRec), cor: GREEN },
            { l: 'MRR despesa', v: brl(kpis.mrrDesp), cor: RED },
            { l: 'A gerar (30d)', v: brl(kpis.aGerar30) },
            { l: 'Próximo reajuste', v: dt(kpis.proxReaj) },
          ].map((k, i) => (
            <div key={i} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 10.5, color: MUT, textTransform: 'uppercase', letterSpacing: 0.5 }}>{k.l}</div>
              <div style={{ fontSize: 19, fontWeight: 700, marginTop: 2, color: (k as { cor?: string }).cor ?? ESP }}>{k.v}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {(['tudo', 'receita', 'despesa'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFiltro(f)} style={{ background: filtro === f ? ESP : '#fff', color: filtro === f ? BG : ESP, border: `1px solid ${filtro === f ? ESP : LINE}`, borderRadius: 999, padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize' }}>{f}</button>
          ))}
        </div>

        {loading ? <div style={{ padding: 30, textAlign: 'center', color: MUT, fontSize: 13 }}>Carregando…</div>
        : filtrada.length === 0 ? (
          <div style={{ background: '#fff', border: `1px dashed ${LINE}`, borderRadius: 12, padding: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 34, marginBottom: 8 }}>🔁</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Nenhuma recorrência {filtro !== 'tudo' ? `de ${filtro}` : ''} ainda</div>
            <div style={{ fontSize: 12.5, color: MUT }}>Clique em <strong>+ Nova recorrência</strong> para criar um contrato — BPO, honorários, mensalidade — e ver o cronograma antes de confirmar.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}>
            {filtrada.map((c) => {
              const nat = natMap[c.id] ?? 'receita'
              const saude = c.faturas_vencidas && c.faturas_vencidas > 0 ? RED : (c.situacao_vigencia === 'vigente' || !c.situacao_vigencia) ? GREEN : GOLD
              return (
                <div key={c.id} style={{ background: '#fff', border: `1px solid ${LINE}`, borderLeft: `4px solid ${saude}`, borderRadius: 12, padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 13.5 }}>{c.cliente_nome || c.nome || c.numero}</strong>
                    <span style={{ fontSize: 10, fontWeight: 700, color: nat === 'despesa' ? RED : GREEN, background: nat === 'despesa' ? '#FCEBEB' : '#E7F3E7', borderRadius: 999, padding: '2px 8px' }}>{nat}</span>
                  </div>
                  <div style={{ fontSize: 11, color: MUT, marginTop: 2 }}>{c.numero} · {c.periodicidade ?? 'mensal'}{c.nome && c.nome !== c.cliente_nome ? ` · ${c.nome}` : ''}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: GOLD, marginTop: 8 }}>{brl(c.valor_atual ?? c.valor_mensal)}<span style={{ fontSize: 11, color: MUT, fontWeight: 400 }}> /mês</span></div>
                  <div style={{ fontSize: 11.5, color: MUT, marginTop: 6 }}>Próxima geração: <b style={{ color: ESP }}>{dt(c.proxima_fatura_prevista)}</b></div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {c.situacao_reajuste && c.situacao_reajuste !== 'sem_reajuste' && <span style={{ fontSize: 10, fontWeight: 700, color: GOLD, background: '#FBF3DE', borderRadius: 999, padding: '2px 8px' }}>📈 {c.situacao_reajuste}</span>}
                    {(c.faturas_vencidas ?? 0) > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: RED, background: '#FCEBEB', borderRadius: 999, padding: '2px 8px' }}>⚠ {c.faturas_vencidas} vencida(s)</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {wizardOpen && empresa && <WizardModal empresa={empresa} onClose={() => setWizardOpen(false)} onCriado={() => { setWizardOpen(false); void carregar() }} />}
    </div>
  )
}

// ── Wizard 4 passos ─────────────────────────────────────────────────────────────────────────────
function WizardModal({ empresa, onClose, onCriado }: { empresa: string; onClose: () => void; onCriado: () => void }) {
  const [passo, setPasso] = useState(1)
  const [natureza, setNatureza] = useState<'receita' | 'despesa'>('receita')
  const [clienteId, setClienteId] = useState<string | null>(null)
  const [clienteNome, setClienteNome] = useState('')
  const [clienteCnpj, setClienteCnpj] = useState('')
  const [nome, setNome] = useState('')
  const [periodicidade, setPeriodicidade] = useState('mensal')
  const [diaGeracao, setDiaGeracao] = useState('10')
  const [dataInicio, setDataInicio] = useState(hojeISO())
  const [dataFim, setDataFim] = useState('')
  const [reajusteAtivo, setReajusteAtivo] = useState(false)
  const [reajIndice, setReajIndice] = useState('IPCA')
  const [reajMes, setReajMes] = useState('1')
  const [reajPct, setReajPct] = useState('')
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [forma, setForma] = useState('boleto')
  const [preview, setPreview] = useState<Comp[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // busca de cliente
  const [cliTermo, setCliTermo] = useState('')
  const [cliSug, setCliSug] = useState<ClienteOpt[]>([])
  const cliTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function onCliTermo(v: string) {
    setCliTermo(v); setClienteId(null)
    if (cliTimer.current) clearTimeout(cliTimer.current)
    cliTimer.current = setTimeout(async () => {
      if (v.trim().length < 2) { setCliSug([]); return }
      const { data } = await supabase.from('erp_clientes').select('id, nome_fantasia, razao_social, cpf_cnpj').eq('company_id', empresa).eq('ativo', true).or(`nome_fantasia.ilike.%${v}%,razao_social.ilike.%${v}%,cpf_cnpj.ilike.%${v}%`).limit(8)
      setCliSug((data as ClienteOpt[]) ?? [])
    }, 300)
  }
  function escolherCliente(c: ClienteOpt) {
    setClienteId(c.id); const n = c.nome_fantasia || c.razao_social || ''
    setClienteNome(n); setClienteCnpj(c.cpf_cnpj ?? ''); setCliTermo(n); setCliSug([])
    if (!nome) setNome(`${natureza === 'despesa' ? 'Despesa' : 'Serviço'} · ${n}`)
  }

  const valorNum = parseFloat(valor) || 0
  const podeProx = (p: number) => p === 1 ? (clienteNome.trim() !== '' || cliTermo.trim() !== '') : p === 3 ? valorNum > 0 : true

  const carregarPreview = useCallback(async () => {
    const params = {
      natureza, valor: valorNum, dia_geracao: parseInt(diaGeracao || '10', 10) || 10, data_inicio: dataInicio, periodicidade,
      reajuste: reajusteAtivo ? { indice: reajIndice, mes: parseInt(reajMes || '0', 10) || null, pct: parseFloat(reajPct) || 0 } : {},
    }
    const { data } = await supabase.rpc('fn_contrato_preview_cronograma', { p_company_id: empresa, p_params: params, p_n: 6 })
    const r = data as { ok?: boolean; competencias?: Comp[] } | null
    setPreview(r?.ok ? (r.competencias ?? []) : [])
  }, [empresa, natureza, valorNum, diaGeracao, dataInicio, periodicidade, reajusteAtivo, reajIndice, reajMes, reajPct])
  // set-state assíncrono (após await do RPC), não síncrono no corpo do efeito — mas a regra não distingue.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (passo === 4) void carregarPreview() }, [passo, carregarPreview])

  async function criar() {
    setBusy(true); setMsg(null)
    const campos = {
      company_id: empresa, natureza, tipo: 'servico',
      cliente_id: clienteId, cliente_nome: clienteNome || cliTermo, cliente_cnpj: clienteCnpj,
      nome: nome || `Recorrência · ${clienteNome || cliTermo}`, descricao,
      valor_mensal: valorNum, data_inicio: dataInicio, data_fim: dataFim || null,
      dia_vencimento: parseInt(diaGeracao || '10', 10) || 10, periodicidade, forma_pagamento: forma,
      tipo_reajuste: reajusteAtivo ? reajIndice : null,
      reajuste_percentual: reajusteAtivo ? (parseFloat(reajPct) || null) : null,
      mes_reajuste: reajusteAtivo ? (parseInt(reajMes || '0', 10) || null) : null,
    }
    const { data, error } = await supabase.rpc('fn_contrato_recorrencia_criar', { p_campos: campos })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string; numero?: string } | null
    if (error || !j?.ok) { setMsg('Erro ao criar: ' + (error?.message ?? j?.erro ?? 'falhou')); return }
    onCriado()
  }

  const inp: React.CSSProperties = { width: '100%', border: `0.5px solid ${LINE}`, borderRadius: 6, padding: '9px 10px', fontSize: 13, color: ESP, background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box' }
  const lbl: React.CSSProperties = { fontSize: 11.5, color: MUT, display: 'block', marginBottom: 4, fontWeight: 600 }
  const passos = ['Tipo & cliente', 'Recorrência', 'Item & valor', 'Automação & preview']

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 12px', zIndex: 60, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: BG, borderRadius: 14, width: '100%', maxWidth: 620 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: ESP, borderRadius: '14px 14px 0 0' }}>
          <div style={{ color: GOLD, fontWeight: 700, fontSize: 15 }}>Nova recorrência · passo {passo}/4</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: BG, cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: 4, padding: '10px 18px 0' }}>
          {passos.map((p, i) => <div key={i} title={p} style={{ flex: 1, height: 4, borderRadius: 2, background: i < passo ? GOLD : LINE }} />)}
        </div>

        <div style={{ padding: 18 }}>
          {passo === 1 && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <span style={lbl}>Tipo</span>
                <div style={{ display: 'inline-flex', border: `0.5px solid ${LINE}`, borderRadius: 8, overflow: 'hidden' }}>
                  {(['receita', 'despesa'] as const).map((n) => <button key={n} type="button" onClick={() => setNatureza(n)} style={{ padding: '8px 16px', fontSize: 12.5, fontWeight: 700, border: 'none', cursor: 'pointer', textTransform: 'capitalize', background: natureza === n ? ESP : '#fff', color: natureza === n ? BG : ESP }}>{n}</button>)}
                </div>
              </div>
              <div style={{ position: 'relative' }}>
                <span style={lbl}>Cliente (busca por nome / CPF / CNPJ)</span>
                <input style={inp} value={cliTermo} onChange={(e) => onCliTermo(e.target.value)} placeholder="Digite para buscar o cliente cadastrado" />
                {cliSug.length > 0 && (
                  <div style={{ position: 'absolute', zIndex: 5, top: '100%', left: 0, right: 0, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 8, marginTop: 2, maxHeight: 200, overflowY: 'auto', boxShadow: '0 6px 16px rgba(61,35,20,.12)' }}>
                    {cliSug.map((c) => <button key={c.id} type="button" onMouseDown={(e) => { e.preventDefault(); escolherCliente(c) }} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: '8px 10px', fontSize: 13, cursor: 'pointer', color: ESP }}>{c.nome_fantasia || c.razao_social}{c.cpf_cnpj ? <span style={{ color: MUT, fontSize: 11 }}> · {c.cpf_cnpj}</span> : null}</button>)}
                  </div>
                )}
                {clienteId && <small style={{ fontSize: 10.5, color: GREEN }}>✓ cliente cadastrado selecionado</small>}
              </div>
              <div><span style={lbl}>Nome do contrato (opcional)</span><input style={inp} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: BPO Financeiro mensal" /></div>
            </div>
          )}

          {passo === 2 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }}>
              <div><span style={lbl}>Periodicidade</span><select style={inp} value={periodicidade} onChange={(e) => setPeriodicidade(e.target.value)}>{PERIODOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
              <div><span style={lbl}>Dia da geração</span><input style={inp} type="number" min="1" max="31" value={diaGeracao} onChange={(e) => setDiaGeracao(e.target.value.replace(/\D/g, ''))} /></div>
              <div><span style={lbl}>Início</span><input style={inp} type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} /></div>
              <div><span style={lbl}>Término (opcional)</span><input style={inp} type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} /></div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  <input type="checkbox" checked={reajusteAtivo} onChange={(e) => setReajusteAtivo(e.target.checked)} /> Reajuste automático por índice
                </label>
                {reajusteAtivo && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginTop: 8 }}>
                    <div><span style={lbl}>Índice</span><input style={inp} value={reajIndice} onChange={(e) => setReajIndice(e.target.value)} placeholder="IPCA / IGPM" /></div>
                    <div><span style={lbl}>Mês do reajuste</span><input style={inp} type="number" min="1" max="12" value={reajMes} onChange={(e) => setReajMes(e.target.value.replace(/\D/g, ''))} /></div>
                    <div><span style={lbl}>% estimado</span><input style={inp} inputMode="decimal" value={reajPct} onChange={(e) => setReajPct(e.target.value.replace(/[^\d.,]/g, '').replace(',', '.'))} placeholder="ex.: 4,5" /></div>
                  </div>
                )}
              </div>
            </div>
          )}

          {passo === 3 && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div><span style={lbl}>Descrição do serviço</span><input style={inp} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="ex.: Honorários contábeis · BPO financeiro" /></div>
              <div><span style={lbl}>Valor mensal (R$)</span><input style={inp} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, '').replace(',', '.'))} placeholder="0,00" /></div>
              <div style={{ background: '#FBF3DE', border: `1px solid ${GOLD}`, borderRadius: 8, padding: '10px 12px', fontSize: 13 }}>Total mensal: <b>{brl(valorNum)}</b> <span style={{ color: MUT, fontSize: 11 }}>(grade de itens múltiplos com margem vem na F2)</span></div>
            </div>
          )}

          {passo === 4 && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <span style={lbl}>Como vai receber</span>
                <div style={{ display: 'inline-flex', border: `0.5px solid ${LINE}`, borderRadius: 8, overflow: 'hidden' }}>
                  {[['boleto', 'Boleto'], ['pix', 'Pix'], ['cartao', 'Cartão']].map(([v, l]) => <button key={v} type="button" onClick={() => setForma(v)} style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: 700, border: 'none', cursor: 'pointer', background: forma === v ? ESP : '#fff', color: forma === v ? BG : ESP }}>{l}</button>)}
                </div>
              </div>
              <div>
                <span style={lbl}>Cronograma das próximas 6 competências</span>
                <div style={{ border: `0.5px solid ${LINE}`, borderRadius: 8, overflow: 'hidden' }}>
                  {preview === null ? <div style={{ padding: 14, textAlign: 'center', color: MUT, fontSize: 12.5 }}>Calculando…</div>
                    : preview.length === 0 ? <div style={{ padding: 14, textAlign: 'center', color: MUT, fontSize: 12.5 }}>Preencha valor e datas para ver o cronograma.</div>
                    : preview.map((c, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderTop: i ? `0.5px solid ${LINE}` : 'none', background: c.com_reajuste ? '#FBF3DE' : '#fff' }}>
                        <span style={{ fontSize: 12.5 }}>{dt(c.data)} <span style={{ color: MUT, fontSize: 11 }}>· {c.o_que_gera}</span>{c.com_reajuste ? <span style={{ color: GOLD, fontSize: 10.5, fontWeight: 700 }}> · 📈 reajuste</span> : ''}</span>
                        <b style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{brl(c.valor)}</b>
                      </div>
                    ))}
                </div>
                <small style={{ fontSize: 10.5, color: MUT }}>É exatamente o que o sistema vai gerar por competência (via o motor de contratos).</small>
              </div>
              {msg && <div style={{ fontSize: 12.5, color: RED, fontWeight: 600 }}>{msg}</div>}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '0 18px 18px' }}>
          <button type="button" onClick={() => passo > 1 ? setPasso(passo - 1) : onClose()} style={{ background: 'transparent', border: `0.5px solid ${LINE}`, color: ESP, borderRadius: 8, padding: '10px 18px', fontSize: 13, cursor: 'pointer' }}>{passo > 1 ? '← Voltar' : 'Cancelar'}</button>
          {passo < 4
            ? <button type="button" disabled={!podeProx(passo)} onClick={() => setPasso(passo + 1)} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontSize: 13, fontWeight: 700, cursor: podeProx(passo) ? 'pointer' : 'not-allowed', opacity: podeProx(passo) ? 1 : 0.5 }}>Avançar →</button>
            : <button type="button" disabled={busy || valorNum <= 0} onClick={() => void criar()} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: busy || valorNum <= 0 ? 0.6 : 1 }}>{busy ? 'Criando…' : 'Criar recorrência'}</button>}
        </div>
      </div>
    </div>
  )
}
