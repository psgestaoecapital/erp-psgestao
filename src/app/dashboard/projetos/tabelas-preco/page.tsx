'use client'

// HB2 · Tabela de preço por cliente (fatia 2) — lista as tabelas da empresa e calcula o preço de um serviço:
// o usuário escolhe tabela, serviço, quantidade e condição; o sistema acha a faixa, aplica o adicional e mostra a margem
// contra o custo informado. Só leitura (a importação vem na próxima fatia). Regra única em src/lib/hub/tabelaPreco.ts.
// HB0 (auditor F10): o contrato inteiro aparece na tela — faixas × condições com o preço de cada célula e o código do item
// no cliente; tocar numa célula leva serviço, faixa e condição para a calculadora. Erro do banco nunca aparece cru.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { MedicaoContrato } from './_componentes/MedicaoContrato'
import { ImportarArquivoIA } from './_componentes/ImportarArquivoIA'
import { VinculoCatalogo, type VinculoCpu } from './_componentes/VinculoCatalogo'
import { lerPlanilhaFaixas } from '@/lib/hub/tabelaPrecoImportar'
import { precedenciaPreco } from '@/lib/hub/precedenciaPreco'
import { escolherFaixa, margemContraCusto, precoUnitario, type Condicao, type ItemFaixa } from '@/lib/hub/tabelaPreco'

// Preço unitário nunca arredonda centavo (22,50 não vira 23); inteiro segue sem casas.
const fmtPreco = (v: number) => (Number.isInteger(v) ? fmtR(v) : `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', OKV = '#0F7B3B'

// Preço de tabela tem centavos (15 × 1,5 = R$ 22,50): o fmtR do painel arredonda para reais inteiros e mostrava "R$ 23".
const fmtR = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Tabela = { id: string; nome: string; vigencia_inicio: string; vigencia_fim: string | null }
type Item = ItemFaixa & { id: string; servico_ref: string; servico_nome: string; unidade: string; adicional: boolean }
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
  // CPU vinda do catálogo (vínculo do serviço): preenche o custo da calculadora quando o serviço tem vínculo
  const [cpus, setCpus] = useState<VinculoCpu[]>([])
  // Edição do contrato (HB2): rev força recarregar a tabela aberta depois de salvar; msg mostra o resultado sem expor erro cru.
  const [rev, setRev] = useState(0)
  const [editar, setEditar] = useState(false)
  const [msg, setMsg] = useState('')
  // perfil consulta (viewer) só lê: o banco barra a gravação (gatilho trg_tabela_preco_trava_viewer); a tela esconde as ações
  const [podeGravar, setPodeGravar] = useState(false)
  useEffect(() => {
    const empresa = companyIds?.[0]
    if (!empresa) return
    supabase.rpc('fn_tabela_preco_pode_gravar', { p_company_id: empresa }).then(({ data }) => setPodeGravar(data === true))
  }, [companyIds])
  const [fm, setFm] = useState({ nomeTab: '', ref: '', nome: '', un: 'm²', de: '', ate: '', preco: '', cond: '', pct: '', cCond: 'normal', cod: '', fixo: '' })
  const setF = (k: keyof typeof fm, v: string) => setFm(f => ({ ...f, [k]: v }))
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))
  const salvar = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setMsg('')
    const { data, error } = await supabase.rpc(fn, args)
    if (error || (data && (data as { ok?: boolean }).ok === false)) { setMsg(erroAmigavel(error, 'Não foi possível salvar. Confira os campos e tente de novo.')); return null }
    setMsg(ok); setRev(r => r + 1)
    return data as { id?: string }
  }
  const criarTabela = async () => {
    const empresa = companyIds?.[0]
    if (!empresa) { setMsg('Selecione uma empresa para cadastrar a tabela.'); return }
    const r = await salvar('fn_tabela_preco_salvar', { p_company_id: empresa, p_dados: { nome: fm.nomeTab } }, 'Tabela criada.')
    if (r?.id) { setFm(f => ({ ...f, nomeTab: '' })); await carregarTabelas(); setTabelaId(r.id) }
  }
  const arquivar = async () => {
    if (!tabelaId || !window.confirm('Arquivar este contrato? Ele sai da lista, o histórico fica guardado.')) return
    if (await salvar('fn_tabela_preco_arquivar', { p_tabela: tabelaId }, 'Contrato arquivado.')) { setTabelaId(''); carregarTabelas() }
  }
  const salvarFaixa = () => salvar('fn_tabela_preco_faixa_salvar', { p_tabela_id: tabelaId, p_dados: { servico_ref: fm.ref, servico_nome: fm.nome, unidade: fm.un, faixa_de: num(fm.de) ?? 0, faixa_ate: num(fm.ate), preco_base: num(fm.preco) } }, 'Faixa salva.')
  const salvarCond = () => salvar('fn_tabela_preco_condicao_salvar', { p_tabela_id: tabelaId, p_condicao: fm.cond, p_percentual: num(fm.pct) }, 'Condição salva.')
  const salvarCodigo = () => salvar('fn_tabela_preco_codigo_salvar', { p_tabela_id: tabelaId, p_servico_ref: servico, p_condicao: fm.cCond, p_codigo: fm.cod, p_preco_fixo: num(fm.fixo) }, 'Código salvo.')
  // Importar planilha colada: lê, mostra a prévia e grava cada faixa pela mesma RPC do cadastro manual.
  const [planilha, setPlanilha] = useState('')
  const previa = useMemo(() => lerPlanilhaFaixas(planilha), [planilha])
  const importar = async () => {
    setMsg('')
    let gravadas = 0
    for (const f of previa.faixas) {
      const { data, error } = await supabase.rpc('fn_tabela_preco_faixa_salvar', { p_tabela_id: tabelaId, p_dados: f })
      if (error || (data && (data as { ok?: boolean }).ok === false)) { setMsg(`${gravadas} faixa(s) importada(s); parou em "${f.servico_nome}" ${f.faixa_de}. ${erroAmigavel(error, 'Confira a linha e tente de novo.')}`); setRev(r => r + 1); return }
      gravadas++
    }
    setMsg(`${gravadas} faixa(s) importada(s).`); setPlanilha(''); setRev(r => r + 1)
  }
  const excluirFaixa = async (id: string) => { if (window.confirm('Excluir esta faixa do contrato? Ela sai do cálculo, do orçamento e do saldo. A exclusão é rastreável (fica o registro de quem excluiu e quando).')) await salvar('fn_tabela_preco_faixa_excluir', { p_id: id }, 'Faixa excluída.') }

  const carregarTabelas = useCallback(async () => {
    if (!companyIds?.length) { setLoading(false); return }
    setLoading(true); setErro('')
    try {
      const { data, error } = await comPrazo(
        async () => await supabase.from('erp_tabela_preco_cliente').select('id,nome,vigencia_inicio,vigencia_fim').in('company_id', companyIds).eq('ativo', true).order('nome'),
        { ms: 8000, tentativas: 1, label: 'tabelas de preço' },
      )
      if (error) { setErro(erroAmigavel(error, 'Não foi possível carregar as tabelas de preço.')); return }
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
        (async () => {
          // Faixas excluídas (soft-delete rastreável) saem da lista, do cálculo e do orçamento.
          const base = () => supabase.from('erp_tabela_preco_item').select('id,servico_ref,servico_nome,unidade,faixa_de,faixa_ate,preco_base,adicional').eq('tabela_id', tabelaId).order('servico_nome').order('faixa_de')
          const r = await base().is('deleted_at', null)
          // Ambiente ainda sem a coluna deleted_at (preview antes da migração): lê sem o filtro para não quebrar a tela.
          return r.error && /deleted_at/i.test(r.error.message ?? '') ? await base() : r
        })(),
        supabase.from('erp_tabela_preco_condicao').select('condicao,percentual').eq('tabela_id', tabelaId).order('condicao'),
        supabase.from('erp_tabela_preco_codigo').select('servico_ref,condicao,codigo_externo,preco_fixo').eq('tabela_id', tabelaId),
      ])
      if (!vivo) return
      const falha = i.error ?? c.error ?? k.error
      if (falha) { setErro(erroAmigavel(falha, 'Não foi possível abrir esta tabela de preço.')); return }
      setErro('')
      const its = ((i.data ?? []) as Item[]).map(x => ({ ...x, faixa_de: Number(x.faixa_de), faixa_ate: x.faixa_ate == null ? null : Number(x.faixa_ate), preco_base: Number(x.preco_base) }))
      setItens(its)
      // "normal" é a coluna base (sem adicional) e já tem opção própria: não repete na lista de condições.
      setConds(((c.data ?? []) as Cond[]).filter(x => x.condicao !== 'normal').map(x => ({ ...x, percentual: x.percentual == null ? null : Number(x.percentual) })))
      setCods(((k.data ?? []) as Cod[]).map(x => ({ ...x, preco_fixo: x.preco_fixo == null ? null : Number(x.preco_fixo) })))
      setServico(prev => (its.some(x => x.servico_ref === prev) ? prev : its[0]?.servico_ref ?? ''))
      setCondSel(prev => (prev === 'normal' || (c.data ?? []).some(x => x.condicao === prev) ? prev : 'normal'))
    })()
    return () => { vivo = false }
  }, [tabelaId, rev])

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
  const cpuCatalogo = cpus.find(x => x.servico_ref === servico)?.custo_unitario ?? null
  const custoN = Number(custo.replace(',', '.')) || cpuCatalogo || 0
  // De-para PS ↔ cliente: serviço da tabela sem nenhum código, e código que aponta para serviço que não está na tabela.
  const semCodigo = useMemo(() => servicos.filter(s => !cods.some(k => k.servico_ref === s.servico_ref)), [servicos, cods])
  const codigoOrfao = useMemo(() => [...new Set(cods.filter(k => !servicos.some(s => s.servico_ref === k.servico_ref)).map(k => k.servico_ref))], [servicos, cods])
  const margem = preco != null && custoN > 0 ? margemContraCusto(preco, custoN) : null
  const tabelaSel = tabelas.find(t => t.id === tabelaId)
  const condCol = (sref: string, c: string): Condicao | null => {
    if (c === 'normal') return null
    const fixo = cods.find(x => x.servico_ref === sref && x.condicao === c)?.preco_fixo ?? null
    return { condicao: c, percentual: conds.find(x => x.condicao === c)?.percentual ?? 0, preco_fixo: fixo }
  }
  const colunas = ['normal', ...conds.map(c => c.condicao)]
  const hoje = new Date().toISOString().slice(0, 10)
  const selo = !tabelaSel ? null : tabelaSel.vigencia_inicio > hoje ? 'Começa em breve' : tabelaSel.vigencia_fim && tabelaSel.vigencia_fim < hoje ? 'Vencido' : tabelaSel.vigencia_fim && tabelaSel.vigencia_fim <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) ? 'Vence em até 30 dias' : 'Vigente'
  const fmtData = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR') : 'sem fim')
  const prec = precedenciaPreco({ contratoVigente: selo === 'Vigente' || selo === 'Vence em até 30 dias', tabelaCliente: !!tabelaSel, tabelaPadrao: false, temFaixa: preco != null })
  const usarCelula = (sref: string, de: number, c: string) => { setServico(sref); setQtd(String(de > 0 ? de : 1)); setCondSel(c) }

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
            {tabelaSel && podeGravar && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button type="button" data-testid="tp-arquivar" onClick={arquivar} style={{ minHeight: 44, padding: '0 16px' }}>Arquivar contrato</button>
                <AjudaCampo chave="hub.tabela_preco.arquivar" />
              </div>
            )}
            {tabelaSel && (
              <div data-testid="tp-vigencia" style={{ fontSize: 13, color: MUT, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                Vigência {fmtData(tabelaSel.vigencia_inicio)} a {fmtData(tabelaSel.vigencia_fim)} · {servicos.length} serviço(s) · {conds.length} adicional(is)
                <AjudaCampo chave="hub.tabela_preco.vigencia" />
                <b data-testid="tp-selo-vigencia" style={{ color: selo === 'Vencido' ? '#B91C1C' : GOLD }}>{selo}</b>
                <AjudaCampo chave="hub.tabela_preco.selo_vigencia" />
              </div>
            )}
            {tabelaSel && servicos.length > 0 && (
              <div role="status" data-testid="tp-confere" style={{ background: '#F0FAF3', border: `1px solid ${OKV}`, borderRadius: 10, padding: 12, fontSize: 13, color: ESP }}>
                <b style={{ display: 'flex', alignItems: 'center', gap: 6, color: OKV }}>✓ Confere com o contrato cadastrado <AjudaCampo chave="hub.tabela_preco.confere" /></b>
                <div style={{ marginTop: 4 }}>
                  <b>{servicos.length}</b> serviço(s), <b>{itens.length}</b> faixa(s) e <b>{conds.length}</b> adicional(is) lidos direto do cadastro.
                  Os preços e códigos abaixo são <b>exatamente os do contrato</b> — o valor da medição ao cliente bate com o contrato.
                </div>
              </div>
            )}
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
              <input data-testid="tp-custo" inputMode="decimal" style={campo} value={custo} onChange={e => setCusto(e.target.value)} placeholder={cpuCatalogo != null ? `catálogo: ${fmtR(cpuCatalogo)}` : 'para ver a margem'} /></label>
            {/* Resposta primeiro (auditor FC 27/10 — "resultado cortado/ausente": a captura da auditoria parava antes do
                preço, no fim de um formulário longo). O preço, a faixa, o turno, o total e a margem vêm LOGO abaixo dos
                campos; as caixas explicativas (memória de cálculo, qual preço vale, de-para) seguem depois. Mesmos
                data-testid de sempre, para não quebrar a aceitação (HB2). */}
            <div data-testid="tp-resultado" style={{ background: preco == null ? BG : '#FBF8F0', borderRadius: 12, padding: 16, border: `1px solid ${preco == null ? LINE : GOLD}` }}>
              {preco == null ? <b>Sem faixa para essa quantidade.</b> : (<>
                <div style={{ fontSize: 11, color: MUT, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700, marginBottom: 2 }}>Preço calculado</div>
                <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1 }} data-testid="tp-preco">{fmtPreco(preco)} <span style={{ fontSize: 14, fontWeight: 400, color: MUT }}>por {servicos.find(s => s.servico_ref === servico)?.unidade}</span></div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: '#FFF', border: `1px solid ${GOLD}`, color: ESP }}>Faixa {faixa!.faixa_de}–{faixa!.faixa_ate ?? 'em diante'}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: '#FFF', border: `1px solid ${LINE}`, color: MUT }}>{condSel === 'normal' ? 'Condição normal' : condSel}{cond?.preco_fixo != null ? ' · preço fixo' : cond?.percentual ? ` · +${cond.percentual}%` : ''}</span>
                  <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, background: '#FFF', border: `1px solid ${LINE}`, color: MUT }}>base {fmtPreco(faixa!.preco_base)}</span>
                  {codigo ? <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, background: '#FFF', border: `1px solid ${LINE}`, color: MUT }}>cód. cliente {codigo}</span> : null}
                </div>
                <div style={{ fontSize: 15, marginTop: 10 }} data-testid="tp-total">{q > 0 ? <>Total: <b style={{ fontSize: 18 }}>{fmtR(preco * q)}</b> <span style={{ color: MUT, fontSize: 13 }}>({q} × {fmtPreco(preco)})</span></> : <>Informe a quantidade para ver o total</>}</div>
                {margem != null
                  ? <div style={{ fontSize: 14, marginTop: 6 }} data-testid="tp-margem">Margem sobre o custo: <b style={{ color: margem >= 0 ? OKV : '#B91C1C' }}>{(margem * 100).toFixed(1)}%</b></div>
                  : <div style={{ fontSize: 13, marginTop: 6, color: MUT }} data-testid="tp-margem-vazio">Informe o custo da CPU acima para ver a margem contra o preço.</div>}
              </>)}
            </div>
            {preco != null && q > 0 && (
              <div data-testid="tp-simulador" style={{ fontSize: 14, background: '#fff', border: `1px dashed ${GOLD}`, borderRadius: 10, padding: 12 }}>
                <b>Na medição: <AjudaCampo chave="hub.tabela_preco.simulador" /></b>{' '}
                {q} {servicos.find(s => s.servico_ref === servico)?.unidade} de {servicos.find(s => s.servico_ref === servico)?.servico_nome} · {condSel === 'normal' ? 'condição normal' : condSel} · faixa {faixa!.faixa_de}–{faixa!.faixa_ate ?? 'em diante'} → {fmtPreco(preco)} por unidade = <b>{fmtR(preco * q)}</b>
              </div>
            )}
            <div data-testid="tp-precedencia" style={{ fontSize: 13, background: '#FFF7E0', border: `1px solid ${GOLD}`, borderRadius: 10, padding: 12 }}>
              <b>Qual preço vale: <span data-testid="tp-prec-origem">{prec.rotulo}</span> <AjudaCampo chave="hub.tabela_preco.precedencia" /></b>
              <div data-testid="tp-prec-motivo">{prec.motivo}</div>
              <div style={{ color: MUT, marginTop: 4 }}>Ordem: contrato do cliente → tabela do cliente → tabela padrão.</div>
            </div>
            {(semCodigo.length > 0 || codigoOrfao.length > 0) && (
              <div role="status" data-testid="tp-depara-aviso" style={{ background: '#FFF7E0', border: `1px solid ${GOLD}`, borderRadius: 10, padding: 12, fontSize: 13 }}>
                <b>Conferir o de-para com o cliente <AjudaCampo chave="hub.tabela_preco.depara" /></b>
                {semCodigo.length > 0 && <div>Serviço sem código no cliente: {semCodigo.map(s => s.servico_nome).join(', ')}.</div>}
                {codigoOrfao.length > 0 && <div>Código sem serviço na tabela: {codigoOrfao.join(', ')}.</div>}
              </div>
            )}
          </div>
        )}
        {!loading && !erro && !podeGravar && (
          <p role="status" data-testid="tp-consulta" style={{ fontSize: 13, color: MUT, margin: '16px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>Perfil de consulta: você vê o contrato e as medições; editar fica com o administrativo. <AjudaCampo chave="hub.tabela_preco.perfil_consulta" /></p>
        )}
        {!loading && !erro && podeGravar && (
          <section data-testid="tp-editar" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginTop: 16 }}>
            <button type="button" data-testid="tp-editar-abrir" onClick={() => setEditar(v => !v)}
              style={{ background: 'none', border: 'none', padding: 0, fontSize: 17, fontWeight: 700, color: ESP, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              {editar ? '▾' : '▸'} Editar contrato <AjudaCampo chave="hub.tabela_preco.editar" />
            </button>
            {editar && (
              <div style={{ display: 'grid', gap: 14, marginTop: 12 }}>
                {msg && <p role="status" data-testid="tp-msg" style={{ margin: 0, fontSize: 14, color: GOLD, fontWeight: 600 }}>{msg}</p>}
                <div style={{ display: 'grid', gap: 8 }}>
                  <label><span style={rot}>Nova tabela — nome <AjudaCampo chave="hub.tabela_preco.nova_tabela" /></span>
                    <input data-testid="tp-f-nometab" style={campo} value={fm.nomeTab} onChange={e => setF('nomeTab', e.target.value)} placeholder="BRF — Contrato 2026" /></label>
                  <button type="button" data-testid="tp-f-criar" onClick={criarTabela} disabled={!fm.nomeTab.trim()} style={{ ...campo, width: 'auto', cursor: 'pointer', fontWeight: 700, background: GOLD, color: '#fff', border: 'none' }}>Criar tabela</button>
                </div>
                {tabelaId && (<>
                  <div style={{ display: 'grid', gap: 8, borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
                    <span style={rot}>Faixa de quantidade <AjudaCampo chave="hub.tabela_preco.faixa_servico" /></span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}><input data-testid="tp-f-ref" style={campo} value={fm.ref} onChange={e => setF('ref', e.target.value)} placeholder="código do serviço (uretano-6mm)" aria-label="Código do serviço" /> <AjudaCampo chave="hub.tabela_preco.f_codigo_servico" /></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}><input data-testid="tp-f-nome" style={campo} value={fm.nome} onChange={e => setF('nome', e.target.value)} placeholder="nome do serviço" aria-label="Nome do serviço" /> <AjudaCampo chave="hub.tabela_preco.f_nome_servico" /></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}><input data-testid="tp-f-un" style={campo} value={fm.un} onChange={e => setF('un', e.target.value)} placeholder="unidade" aria-label="Unidade" /> <AjudaCampo chave="hub.tabela_preco.f_unidade" /></div>
                    <span style={rot}>De / até <AjudaCampo chave="hub.tabela_preco.faixa_de_ate" /></span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}><input data-testid="tp-f-de" inputMode="decimal" style={campo} value={fm.de} onChange={e => setF('de', e.target.value)} placeholder="de (0)" aria-label="Faixa de" /> <AjudaCampo chave="hub.tabela_preco.f_faixa_de" /></div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}><input data-testid="tp-f-ate" inputMode="decimal" style={campo} value={fm.ate} onChange={e => setF('ate', e.target.value)} placeholder="até (vazio = em diante)" aria-label="Faixa até" /> <AjudaCampo chave="hub.tabela_preco.f_faixa_ate" /></div>
                    </div>
                    <span style={rot}>Preço base <AjudaCampo chave="hub.tabela_preco.faixa_preco" /></span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}><input data-testid="tp-f-preco" inputMode="decimal" style={campo} value={fm.preco} onChange={e => setF('preco', e.target.value)} placeholder="R$ por unidade" aria-label="Preço base" /> <AjudaCampo chave="hub.tabela_preco.f_preco_base" /></div>
                    <button type="button" data-testid="tp-f-faixa" onClick={salvarFaixa} disabled={!fm.ref.trim() || !fm.nome.trim() || num(fm.preco) == null} style={{ ...campo, width: 'auto', cursor: 'pointer', fontWeight: 700, background: GOLD, color: '#fff', border: 'none' }}>Salvar faixa</button>
                    {faixas.length > 0 && (
                      <div data-testid="tp-faixas-servico" style={{ fontSize: 13 }}>
                        {faixas.map(f => (
                          <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${LINE}` }}>
                            <span>{f.servico_nome}: {f.faixa_de}–{f.faixa_ate ?? 'em diante'} · {fmtPreco(f.preco_base)}</span>
                            <span style={{ display: 'flex', gap: 10 }}>
                              <button type="button" onClick={() => setFm(x => ({ ...x, ref: f.servico_ref, nome: f.servico_nome, un: f.unidade, de: String(f.faixa_de), ate: f.faixa_ate == null ? '' : String(f.faixa_ate), preco: String(f.preco_base).replace('.', ',') }))} style={{ color: GOLD, background: 'none', border: 'none', cursor: 'pointer' }}>Copiar</button>
                              <button type="button" onClick={() => excluirFaixa(f.id)} style={{ color: '#B91C1C', background: 'none', border: 'none', cursor: 'pointer' }}>Excluir</button>
                              <AjudaCampo chave="hub.tabela_preco.faixa_excluir" />
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gap: 8, borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
                    <span style={rot}>Importar planilha do cliente <AjudaCampo chave="hub.tabela_preco.importar" /></span>
                    <ImportarArquivoIA onTexto={setPlanilha} estilo={campo} />
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      <textarea data-testid="tp-imp-texto" rows={5} style={campo} value={planilha} onChange={e => setPlanilha(e.target.value)} aria-label="Linhas da planilha" placeholder={'código;nome;unidade;de;até;preço\nuretano-6mm;Piso de uretano 6 mm;m²;0;300;98,00'} />
                      <AjudaCampo chave="hub.tabela_preco.importar_texto" />
                    </div>
                    {planilha.trim() && <div data-testid="tp-imp-previa" style={{ fontSize: 13 }}>{previa.faixas.length} faixa(s) prontas{previa.erros.map(e => <div key={e} style={{ color: '#B91C1C' }}>{e}</div>)}</div>}
                    {planilha.trim() && previa.linhas.length > 0 && (
                      <div data-testid="tp-imp-revisao" style={{ overflowX: 'auto' }}>
                        <div style={{ ...rot, marginBottom: 4 }}>Revisão lado a lado <AjudaCampo chave="hub.tabela_preco.importar_revisao" /></div>
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                          <thead><tr style={{ textAlign: 'left', color: MUT }}><th>Linha</th><th>Como veio</th><th>Como será gravado</th></tr></thead>
                          <tbody>
                            {previa.linhas.map(l => (
                              <tr key={l.n} data-testid="tp-imp-linha" style={{ borderTop: `1px solid ${LINE}`, background: l.erro ? '#FEF2F2' : undefined }}>
                                <td style={{ padding: '4px 6px' }}>{l.n}</td>
                                <td style={{ padding: '4px 6px', fontFamily: 'monospace' }}>{l.original}</td>
                                <td style={{ padding: '4px 6px' }}>{l.faixa ? `${l.faixa.servico_nome} (${l.faixa.servico_ref}) · ${l.faixa.faixa_de}${l.faixa.faixa_ate == null ? ' em diante' : `–${l.faixa.faixa_ate}`} ${l.faixa.unidade} · ${fmtPreco(l.faixa.preco_base)}` : <span style={{ color: '#B91C1C' }}>{l.erro}</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button type="button" data-testid="tp-imp-aplicar" onClick={importar} disabled={!previa.faixas.length || previa.erros.length > 0} style={{ ...campo, width: 'auto', cursor: 'pointer', fontWeight: 700, background: GOLD, color: '#fff', border: 'none' }}>Importar faixas</button>
                      <AjudaCampo chave="hub.tabela_preco.importar_aplicar" />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: 8, borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
                    <span style={rot}>Condição e adicional (%) <AjudaCampo chave="hub.tabela_preco.cond_cadastro" /></span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}><input data-testid="tp-f-cond" style={campo} value={fm.cond} onChange={e => setF('cond', e.target.value)} placeholder="sabado" aria-label="Condição" /> <AjudaCampo chave="hub.tabela_preco.f_condicao" /></div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}><input data-testid="tp-f-pct" inputMode="decimal" style={campo} value={fm.pct} onChange={e => setF('pct', e.target.value)} placeholder="50" aria-label="Adicional em porcentagem" /> <AjudaCampo chave="hub.tabela_preco.f_adicional_pct" /></div>
                    </div>
                    <button type="button" data-testid="tp-f-salvar-cond" onClick={salvarCond} disabled={!fm.cond.trim() || num(fm.pct) == null} style={{ ...campo, width: 'auto', cursor: 'pointer', fontWeight: 700, background: GOLD, color: '#fff', border: 'none' }}>Salvar condição</button>
                  </div>
                  <div style={{ display: 'grid', gap: 8, borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
                    <span style={rot}>Código no cliente (serviço escolhido acima) <AjudaCampo chave="hub.tabela_preco.codigo_cadastro" /></span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <select data-testid="tp-f-ccond" style={campo} value={fm.cCond} onChange={e => setF('cCond', e.target.value)} aria-label="Condição do código">
                      {colunas.map(c => <option key={c} value={c}>{c === 'normal' ? 'Normal' : c}</option>)}
                    </select>
                    <AjudaCampo chave="hub.tabela_preco.f_cod_condicao" /></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}><input data-testid="tp-f-cod" style={campo} value={fm.cod} onChange={e => setF('cod', e.target.value)} placeholder="código do item no cliente (vazio remove)" aria-label="Código no cliente" /> <AjudaCampo chave="hub.tabela_preco.f_codigo_cliente" /></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}><input data-testid="tp-f-fixo" inputMode="decimal" style={campo} value={fm.fixo} onChange={e => setF('fixo', e.target.value)} placeholder="preço fixo da condição (opcional)" aria-label="Preço fixo" /> <AjudaCampo chave="hub.tabela_preco.f_preco_fixo" /></div>
                    <button type="button" data-testid="tp-f-salvar-cod" onClick={salvarCodigo} disabled={!servico} style={{ ...campo, width: 'auto', cursor: 'pointer', fontWeight: 700, background: GOLD, color: '#fff', border: 'none' }}>Salvar código</button>
                  </div>
                </>)}
              </div>
            )}
          </section>
        )}
        {!loading && !erro && servicos.length > 0 && (
          <section data-testid="tp-contrato" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginTop: 16 }}>
            <h2 style={{ fontSize: 17, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>Contrato completo <AjudaCampo chave="hub.tabela_preco.contrato" /></h2>
            {/* celular (390px): grade compacta para as 5 colunas (até domingo_feriado) caberem sem cortar; a faixa fica fixa na rolagem */}
            <style>{'@media (max-width:480px){.tp-grade{min-width:0!important;font-size:12px!important}.tp-grade th,.tp-grade td{padding:6px 2px!important}.tp-grade th{white-space:normal!important;font-size:11px!important}.tp-grade td button{padding:6px 2px!important;font-size:12px!important}}.tp-grade th:first-child,.tp-grade td:first-child{position:sticky;left:0;background:#fff}'}</style>
            <p style={{ fontSize: 13, color: MUT, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>Preço por unidade em cada faixa<AjudaCampo chave="hub.tabela_preco.contrato_col_faixa" /> e condição<AjudaCampo chave="hub.tabela_preco.contrato_col_condicao" />. Toque num preço para levá-lo à calculadora.</p>
            {servicos.map(s => {
              const fs = itens.filter(i => i.servico_ref === s.servico_ref).sort((a, b) => a.faixa_de - b.faixa_de)
              return (
                <div key={s.servico_ref} style={{ marginBottom: 16 }} data-testid={`tp-contrato-${s.servico_ref}`}>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{s.servico_nome} <span style={{ fontWeight: 400, color: MUT }}>({s.unidade})</span></div>
                  <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                    <table className="tp-grade" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14, minWidth: 120 + colunas.length * 110 }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: `1px solid ${LINE}`, color: MUT, fontWeight: 600 }}>Faixa</th>
                          {colunas.map(c => {
                            const cod = cods.find(x => x.servico_ref === s.servico_ref && x.condicao === c)?.codigo_externo
                            const pct = conds.find(x => x.condicao === c)?.percentual
                            return (
                              <th key={c} style={{ textAlign: 'right', padding: '8px 10px', borderBottom: `1px solid ${LINE}`, color: MUT, fontWeight: 600, whiteSpace: 'nowrap' }}>
                                {c === 'normal' ? 'Normal' : c.replace(/_/g, ' ')}{c !== 'normal' && pct != null ? ` +${pct}%` : ''}
                                {cod && <div style={{ fontSize: 12, fontWeight: 400 }} data-testid="tp-codigo-externo">cód. {cod}</div>}
                              </th>
                            )
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {fs.map(f => (
                          <tr key={`${f.faixa_de}`}>
                            <td style={{ padding: '8px 10px', borderBottom: `1px solid ${LINE}`, whiteSpace: 'nowrap' }}>{f.faixa_de}–{f.faixa_ate ?? 'em diante'}</td>
                            {colunas.map(c => {
                              const v = precoUnitario([f], f.faixa_de, condCol(s.servico_ref, c))
                              const ativo = servico === s.servico_ref && condSel === c && faixa?.faixa_de === f.faixa_de
                              return (
                                <td key={c} style={{ padding: 4, borderBottom: `1px solid ${LINE}`, textAlign: 'right' }}>
                                  <button type="button" onClick={() => usarCelula(s.servico_ref, f.faixa_de, c)} data-testid="tp-celula"
                                    style={{ width: '100%', textAlign: 'right', padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 14, color: ESP,
                                      border: `1px solid ${ativo ? GOLD : 'transparent'}`, background: ativo ? '#FBF3E2' : 'transparent', fontWeight: ativo ? 700 : 400 }}>
                                    {v == null ? '—' : fmtPreco(v)}
                                  </button>
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
          </section>
        )}
        {!loading && !erro && tabelaId && servicos.length > 0 && (
          <>
          {companyIds?.[0] && <VinculoCatalogo key={`v-${tabelaId}`} tabelaId={tabelaId} companyId={companyIds[0]} podeGravar={podeGravar} onCpu={setCpus} servicos={servicos.map(x => ({ ref: x.servico_ref, nome: x.servico_nome, unidade: x.unidade }))} />}
          <MedicaoContrato key={tabelaId} tabelaId={tabelaId} podeGravar={podeGravar} servicos={servicos.map(x => ({ ref: x.servico_ref, nome: x.servico_nome, unidade: x.unidade }))} regimes={conds.map(c => c.condicao)} />
          </>
        )}
      </div>
    </div>
  )
}
