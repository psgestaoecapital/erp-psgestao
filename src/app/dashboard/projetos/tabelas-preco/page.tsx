'use client'

// HB2 · Tabela de preço por cliente (fatia 2) — lista as tabelas da empresa e calcula o preço de um serviço:
// o usuário escolhe tabela, serviço, quantidade e condição; o sistema acha a faixa, aplica o adicional e mostra a margem
// contra o custo informado. Só leitura (a importação vem na próxima fatia). Regra única em src/lib/hub/tabelaPreco.ts.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { fmtR } from '@/lib/psgc-tokens'
import { supabase } from '@/lib/supabase'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { escolherFaixa, margemContraCusto, precoUnitario, type Condicao, type ItemFaixa } from '@/lib/hub/tabelaPreco'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'

type Tabela = { id: string; nome: string; vigencia_inicio: string; vigencia_fim: string | null }
type Item = ItemFaixa & { servico_ref: string; servico_nome: string; unidade: string; adicional: boolean }
type Cond = { condicao: string; percentual: number | null }
type Cod = { servico_ref: string; condicao: string; codigo_externo: string; preco_fixo: number | null }

export default function TabelasPrecoPage() {
  const { companyIds } = useCompanyIds()
  const [tabelas, setTabelas] = useState<Tabela[]>([])
  const [tabelaId, setTabelaId] = useState('')
  const [itens, setItens] = useState<Item[]>([])
  const [conds, setConds] = useState<Cond[]>([])
  const [cods, setCods] = useState<Cod[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [servico, setServico] = useState('')
  const [qtd, setQtd] = useState('1')
  const [condSel, setCondSel] = useState('normal')
  const [custo, setCusto] = useState('')

  const carregarTabelas = useCallback(async () => {
    if (!companyIds?.length) { setLoading(false); return }
    setLoading(true); setErro('')
    try {
      const { data, error } = await comPrazo(
        async () => await supabase.from('erp_tabela_preco_cliente').select('id,nome,vigencia_inicio,vigencia_fim').in('company_id', companyIds).eq('ativo', true).order('nome'),
        { ms: 8000, tentativas: 1, label: 'tabelas de preço' },
      )
      if (error) { setErro(error.message); return }
      const t = (data ?? []) as Tabela[]
      setTabelas(t)
      setTabelaId(prev => prev || t[0]?.id || '')
    } catch { setErro(MSG_CARREGAMENTO_FALHOU) } finally { setLoading(false) }
  }, [companyIds])
  useEffect(() => { carregarTabelas() }, [carregarTabelas])

  useEffect(() => {
    if (!tabelaId) { setItens([]); setConds([]); setCods([]); return }
    let vivo = true
    ;(async () => {
      const [i, c, k] = await Promise.all([
        supabase.from('erp_tabela_preco_item').select('servico_ref,servico_nome,unidade,faixa_de,faixa_ate,preco_base,adicional').eq('tabela_id', tabelaId).order('servico_nome').order('faixa_de'),
        supabase.from('erp_tabela_preco_condicao').select('condicao,percentual').eq('tabela_id', tabelaId).order('condicao'),
        supabase.from('erp_tabela_preco_codigo').select('servico_ref,condicao,codigo_externo,preco_fixo').eq('tabela_id', tabelaId),
      ])
      if (!vivo) return
      const its = ((i.data ?? []) as Item[]).map(x => ({ ...x, faixa_de: Number(x.faixa_de), faixa_ate: x.faixa_ate == null ? null : Number(x.faixa_ate), preco_base: Number(x.preco_base) }))
      setItens(its)
      setConds(((c.data ?? []) as Cond[]).map(x => ({ ...x, percentual: x.percentual == null ? null : Number(x.percentual) })))
      setCods(((k.data ?? []) as Cod[]).map(x => ({ ...x, preco_fixo: x.preco_fixo == null ? null : Number(x.preco_fixo) })))
      setServico(its[0]?.servico_ref ?? '')
      setCondSel('normal')
    })()
    return () => { vivo = false }
  }, [tabelaId])

  const servicos = useMemo(() => {
    const m = new Map<string, Item>()
    itens.forEach(i => { if (!m.has(i.servico_ref)) m.set(i.servico_ref, i) })
    return [...m.values()]
  }, [itens])
  const faixas = useMemo(() => itens.filter(i => i.servico_ref === servico), [itens, servico])
  const q = Number(qtd.replace(',', '.')) || 0
  const cond: Condicao | null = useMemo(() => {
    if (condSel === 'normal') return null
    const c = conds.find(x => x.condicao === condSel)
    const fixo = cods.find(x => x.servico_ref === servico && x.condicao === condSel)?.preco_fixo ?? null
    return { condicao: condSel, percentual: c?.percentual ?? 0, preco_fixo: fixo }
  }, [condSel, conds, cods, servico])
  const faixa = escolherFaixa(faixas, q)
  const preco = precoUnitario(faixas, q, cond)
  const codigo = cods.find(x => x.servico_ref === servico && x.condicao === condSel)?.codigo_externo
  const custoN = Number(custo.replace(',', '.')) || 0
  const margem = preco != null && custoN > 0 ? margemContraCusto(preco, custoN) : null

  const campo: React.CSSProperties = { display: 'block', width: '100%', padding: 10, border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 15, background: '#fff', color: ESP }
  const rot: React.CSSProperties = { fontSize: 13, color: MUT, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: 16, color: ESP }} data-testid="hub-tabelas-preco">
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <Link href="/dashboard/projetos/propostas" style={{ color: GOLD, fontSize: 13 }}>← Propostas</Link>
        <h1 style={{ fontSize: 22, margin: '8px 0 4px' }}>Tabela de preço por cliente <AjudaCampo chave="hub.tabela_preco.tela" /></h1>
        <p style={{ fontSize: 13, color: MUT, margin: '0 0 16px' }}>Escolha o serviço, a quantidade e o turno: o preço sai pela faixa certa, já com o adicional.</p>
        {loading && <p data-testid="tabelas-carregando">Carregando…</p>}
        {!loading && erro && <p role="alert" style={{ color: '#B91C1C' }}>{erro} <button onClick={carregarTabelas}>Tentar de novo</button></p>}
        {!loading && !erro && tabelas.length === 0 && (
          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 20 }} data-testid="tabelas-vazio">
            <b>Nenhuma tabela de preço cadastrada.</b>
            <p style={{ fontSize: 14, color: MUT }}>A tabela do cliente (faixas de quantidade e adicionais por turno) entra pela importação de planilha, na próxima entrega. Enquanto isso, o Eng. Chefe carrega a primeira tabela.</p>
          </div>
        )}
        {!loading && !erro && tabelas.length > 0 && (
          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, display: 'grid', gap: 14 }}>
            <label><span style={rot}>Tabela do cliente <AjudaCampo chave="hub.tabela_preco.tabela" /></span>
              <select data-testid="tp-tabela" style={campo} value={tabelaId} onChange={e => setTabelaId(e.target.value)}>
                {tabelas.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select></label>
            <label><span style={rot}>Serviço <AjudaCampo chave="hub.tabela_preco.servico" /></span>
              <select data-testid="tp-servico" style={campo} value={servico} onChange={e => setServico(e.target.value)}>
                {servicos.map(s => <option key={s.servico_ref} value={s.servico_ref}>{s.servico_nome} ({s.unidade})</option>)}
              </select></label>
            <label><span style={rot}>Quantidade <AjudaCampo chave="hub.tabela_preco.quantidade" /></span>
              <input data-testid="tp-qtd" inputMode="decimal" style={campo} value={qtd} onChange={e => setQtd(e.target.value)} /></label>
            <label><span style={rot}>Condição (turno / dia) <AjudaCampo chave="hub.tabela_preco.condicao" /></span>
              <select data-testid="tp-cond" style={campo} value={condSel} onChange={e => setCondSel(e.target.value)}>
                <option value="normal">Normal</option>
                {conds.map(c => <option key={c.condicao} value={c.condicao}>{c.condicao}{c.percentual != null ? ` (+${c.percentual}%)` : ''}</option>)}
              </select></label>
            <label><span style={rot}>Custo da CPU por unidade (opcional) <AjudaCampo chave="hub.tabela_preco.custo" /></span>
              <input data-testid="tp-custo" inputMode="decimal" style={campo} value={custo} onChange={e => setCusto(e.target.value)} placeholder="para ver a margem" /></label>
            <div data-testid="tp-resultado" style={{ background: BG, borderRadius: 10, padding: 14, border: `1px solid ${LINE}` }}>
              {preco == null ? <b>Sem faixa para essa quantidade.</b> : (<>
                <div style={{ fontSize: 26, fontWeight: 700 }} data-testid="tp-preco">{fmtR(preco)} <span style={{ fontSize: 14, fontWeight: 400 }}>por {servicos.find(s => s.servico_ref === servico)?.unidade}</span></div>
                <div style={{ fontSize: 13, color: MUT, marginTop: 4 }}>
                  Faixa {faixa!.faixa_de}–{faixa!.faixa_ate ?? 'em diante'} · preço base {fmtR(faixa!.preco_base)}
                  {cond?.preco_fixo != null ? ' · preço fixo da condição' : cond?.percentual ? ` · adicional +${cond.percentual}%` : ''}
                </div>
                <div style={{ fontSize: 14, marginTop: 6 }}>Total: <b>{fmtR(preco * q)}</b>{codigo ? <> · código no cliente: <b>{codigo}</b></> : null}</div>
                {margem != null && <div style={{ fontSize: 14, marginTop: 6 }} data-testid="tp-margem">Margem sobre o custo: <b>{(margem * 100).toFixed(1)}%</b></div>}
              </>)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
