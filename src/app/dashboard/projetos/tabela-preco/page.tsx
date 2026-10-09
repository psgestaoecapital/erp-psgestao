'use client'
// HB2 · Tabela de preço por cliente (fatia 2) — consulta: escolhe tabela, serviço, quantidade e condição; o sistema
// acha a faixa, aplica o adicional e mostra o código externo do cliente. Só leitura (RLS por empresa).
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { escolherFaixa, precoUnitario } from '@/lib/hub/tabelaPreco'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERM = '#B91C1C'
const campo = { width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${LINE}`, fontSize: 14, background: '#fff', color: ESP, boxSizing: 'border-box' as const }
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Tabela = { id: string; nome: string }
type Item = { servico_ref: string; servico_nome: string; unidade: string; faixa_de: number; faixa_ate: number | null; preco_base: number; adicional: boolean }
type Cond = { condicao: string; percentual: number | null }
type Cod = { servico_ref: string; condicao: string; codigo_externo: string; preco_fixo: number | null }

export default function TabelaPrecoPage() {
  const { companyIds } = useCompanyIds()
  const [tabelas, setTabelas] = useState<Tabela[]>([])
  const [tabelaId, setTabelaId] = useState('')
  const [itens, setItens] = useState<Item[]>([])
  const [conds, setConds] = useState<Cond[]>([])
  const [cods, setCods] = useState<Cod[]>([])
  const [servico, setServico] = useState('')
  const [qtd, setQtd] = useState('')
  const [condicao, setCondicao] = useState('normal')
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!companyIds?.length) return
    supabase.from('erp_tabela_preco_cliente').select('id,nome').in('company_id', companyIds).eq('ativo', true).order('nome')
      .then(({ data, error }) => { if (error) setErro(error.message); else setTabelas((data ?? []) as Tabela[]) })
  }, [companyIds])

  useEffect(() => {
    if (!tabelaId) return
    setServico(''); setCondicao('normal')
    Promise.all([
      supabase.from('erp_tabela_preco_item').select('servico_ref,servico_nome,unidade,faixa_de,faixa_ate,preco_base,adicional').eq('tabela_id', tabelaId),
      supabase.from('erp_tabela_preco_condicao').select('condicao,percentual').eq('tabela_id', tabelaId),
      supabase.from('erp_tabela_preco_codigo').select('servico_ref,condicao,codigo_externo,preco_fixo').eq('tabela_id', tabelaId),
    ]).then(([i, c, k]) => {
      const e = i.error ?? c.error ?? k.error
      if (e) { setErro(e.message); return }
      setErro(''); setItens((i.data ?? []) as Item[]); setConds((c.data ?? []) as Cond[]); setCods((k.data ?? []) as Cod[])
    })
  }, [tabelaId])

  const servicos = useMemo(() => {
    const m = new Map<string, string>()
    itens.filter(i => !i.adicional).forEach(i => m.set(i.servico_ref, i.servico_nome))
    return [...m.entries()]
  }, [itens])

  const q = Number(qtd.replace(',', '.'))
  const faixas = itens.filter(i => i.servico_ref === servico && !i.adicional)
  const faixa = servico && q > 0 ? escolherFaixa(faixas, q) : null
  const cod = cods.find(c => c.servico_ref === servico && c.condicao === condicao)
  const cd = conds.find(c => c.condicao === condicao)
  const preco = faixa ? precoUnitario(faixas, q, { condicao, percentual: cd?.percentual ?? 0, preco_fixo: cod?.preco_fixo ?? null }) : null

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }} data-testid="hub-tabela-preco">
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>Hub · Orçamento</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: ESP, margin: '2px 0 14px' }}>Tabela de preço do cliente</h1>
        <div style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}><span>Tabela<AjudaCampo chave="projetos.tabela_preco.tabela" /></span>
            <select data-testid="tp-tabela" style={campo} value={tabelaId} onChange={e => setTabelaId(e.target.value)}>
              <option value="">Escolha a tabela do cliente</option>
              {tabelas.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select></label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}><span>Serviço<AjudaCampo chave="projetos.tabela_preco.servico" /></span>
            <select data-testid="tp-servico" style={campo} value={servico} onChange={e => setServico(e.target.value)} disabled={!tabelaId}>
              <option value="">Escolha o serviço</option>
              {servicos.map(([ref, nome]) => <option key={ref} value={ref}>{nome}</option>)}
            </select></label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}><span>Quantidade<AjudaCampo chave="projetos.tabela_preco.quantidade" /></span>
            <input data-testid="tp-qtd" inputMode="decimal" style={campo} value={qtd} onChange={e => setQtd(e.target.value)} placeholder="Ex.: 350" /></label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}><span>Condição<AjudaCampo chave="projetos.tabela_preco.condicao" /></span>
            <select data-testid="tp-condicao" style={campo} value={condicao} onChange={e => setCondicao(e.target.value)}>
              <option value="normal">Normal</option>
              {conds.filter(c => c.condicao !== 'normal').map(c => <option key={c.condicao} value={c.condicao}>{c.condicao}{c.percentual != null ? ` (+${c.percentual}%)` : ''}</option>)}
            </select></label>
          {erro && <div role="alert" style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: 10, fontSize: 13 }}>{erro}</div>}
          {tabelaId && servico && q > 0 && (
            <div data-testid="tp-resultado" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 14, color: ESP }}>
              {preco == null ? <div>Nenhuma faixa cobre essa quantidade nesta tabela.</div> : <>
                <div style={{ fontSize: 12, color: MUT }}>Faixa {faixa!.faixa_de}–{faixa!.faixa_ate ?? 'sem teto'} · base {brl(faixa!.preco_base)}</div>
                <div data-testid="tp-preco" style={{ fontSize: 26, fontFamily: 'Fraunces, Georgia, serif' }}>{brl(preco)} <span style={{ fontSize: 13 }}>por {faixa!.unidade}</span></div>
                <div style={{ fontSize: 13 }}>Total: {brl(Math.round(preco * q * 100) / 100)}</div>
                {cod && <div style={{ fontSize: 12, color: MUT, marginTop: 6 }}>Código do cliente: <b>{cod.codigo_externo}</b></div>}
              </>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
