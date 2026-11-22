'use client'
// Hub · Gestão de Obras · Relatórios do Orçamento (blueprint vivo tela 330, releitura 21/11).
// Três formatos sobre o MESMO orçamento por EAP, só leitura (nenhuma escrita):
//  · Sintético  — árvore da EAP com material × mão de obra × total e % por etapa (fn_projetos_orcamento_eap_arvore).
//  · Analítico  — todos os itens com custos unitários e subtotal (fn_projetos_orcamento_item_eap_listar).
//  · Planilha cega — os itens SEM preços, para cotar com empreiteiros sem revelar o orçamento da obra.
// "Imprimir / PDF" usa a impressão do navegador; a planilha cega sai pronta para enviar ao fornecedor.
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ehUuid, erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/projetos/obras/[id]/orcamento/relatorios'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERM = '#B91C1C'
const brl = (n: number | null | undefined) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`
const qtd = (n: number | null | undefined) => (n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })

type NoEap = { eap_codigo: string; nome: string; nivel: number; parent_codigo: string | null; material: number; mao_obra: number; total: number; pct: number }
type Arvore = { orcamento_id: string; modo: 'eap' | 'local'; total_geral: number; material_geral: number; mao_obra_geral: number; nos: NoEap[] }
type ObraInfo = { numero: string; nome: string | null; orcamento_id: string | null }
type ItemEap = { item_id: string; servico_codigo: string | null; servico_descricao: string | null; unidade: string | null; eap_codigo: string; local_nome: string | null; quantidade: number; custo_material_unit: number | null; custo_mao_obra_unit: number | null; subtotal: number }

type Formato = 'sintetico' | 'analitico' | 'cega'
const FORMATOS: { codigo: Formato; nome: string; desc: string }[] = [
  { codigo: 'sintetico', nome: 'Sintético', desc: 'Totais por etapa (EAP), com material, mão de obra e peso de cada etapa.' },
  { codigo: 'analitico', nome: 'Analítico', desc: 'Todos os itens, com custo unitário de material e mão de obra e subtotal.' },
  { codigo: 'cega', nome: 'Planilha cega', desc: 'Os itens sem preços, para enviar ao empreiteiro cotar sem ver o seu orçamento.' },
]

export default function RelatoriosOrcamentoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [obra, setObra] = useState<ObraInfo | null>(null)
  const [arvore, setArvore] = useState<Arvore | null>(null)
  const [itens, setItens] = useState<ItemEap[]>([])
  const [orcTotal, setOrcTotal] = useState<number | null>(null)
  const [itensVivos, setItensVivos] = useState<number | null>(null)
  const [formato, setFormato] = useState<Formato>('sintetico')
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!ehUuid(id)) { setLoading(false); setErro('Obra não encontrada. Abra pela lista de obras.'); return }
    setLoading(true); setErro(null)
    const { data: od, error: oe } = await supabase.from('projetos_obras').select('numero,nome,orcamento_id').eq('id', id).maybeSingle()
    if (oe || !od) { setLoading(false); setErro(erroAmigavel(oe, 'Não foi possível carregar a obra.')); return }
    const info = od as ObraInfo
    setObra(info)
    if (!info.orcamento_id) { setLoading(false); setArvore(null); setItens([]); return }
    const { data, error } = await supabase.rpc('fn_projetos_orcamento_eap_arvore', { p_orcamento_id: info.orcamento_id, p_por_local: false })
    if (error) { setLoading(false); setErro(erroAmigavel(error, 'Não foi possível carregar o orçamento.')); return }
    setArvore(data as Arvore)
    const { data: li } = await supabase.rpc('fn_projetos_orcamento_item_eap_listar', { p_orcamento_id: info.orcamento_id })
    setItens(((li as { itens?: ItemEap[] } | null)?.itens) ?? [])
    // Total cheio do orçamento e nº de itens vivos — para distinguir a fatia EAP do total real (caso misto).
    const { data: orc } = await supabase.from('erp_orcamentos').select('total').eq('id', info.orcamento_id).maybeSingle()
    setOrcTotal((orc as { total?: number } | null)?.total ?? null)
    const { count } = await supabase.from('erp_orcamentos_itens').select('id', { count: 'exact', head: true }).eq('orcamento_id', info.orcamento_id).is('excluido_em', null)
    setItensVivos(count ?? null)
    setLoading(false)
  }, [id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  // modo sintético: monta a árvore a partir da lista achatada (parent_codigo → filhos)
  const filhosPorPai = useMemo(() => {
    const m = new Map<string | null, NoEap[]>()
    for (const n of arvore?.nos ?? []) {
      const k = n.parent_codigo
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(n)
    }
    for (const arr of m.values()) arr.sort((a, b) => a.eap_codigo.localeCompare(b.eap_codigo, undefined, { numeric: true }))
    return m
  }, [arvore])
  const raizes = filhosPorPai.get(null) ?? []

  const vazio = !!obra && (!obra.orcamento_id || itens.length === 0)
  const formatoAtual = FORMATOS.find((f) => f.codigo === formato)!
  // Soma dos subtotais dos itens listados — linha de total do relatório analítico (confere com o total da EAP).
  const somaSubtotais = useMemo(() => itens.reduce((a, it) => a + (it.subtotal ?? 0), 0), [itens])
  // Orçamento MISTO: há itens no orçamento sem complemento EAP, então a fatia listada (só EAP) NÃO é o total real.
  // Espelha a tela 315 (orcamento/page.tsx): nunca rotular a fatia EAP como "Total do orçamento" quando falta algo.
  const faltaSemEap = orcTotal != null ? orcTotal - somaSubtotais : 0
  const temNaoEap = faltaSemEap > 0.005

  // Exporta o formato atual em CSV (;) para abrir no Excel. Planilha cega sai sem preços, com a coluna de
  // cotação em branco para o empreiteiro preencher. Puro cliente (Blob), sem rede nem dado extra.
  const csvCampo = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v)
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const exportarCsv = () => {
    if (vazio) return
    let linhas: (string | number | null)[][]
    if (formato === 'sintetico') {
      linhas = [['EAP', 'Etapa', 'Nível', 'Material', 'Mão de obra', 'Total', '%']]
      for (const n of arvore?.nos ?? []) linhas.push([n.eap_codigo, n.nome, n.nivel, n.material, n.mao_obra, n.total, n.pct])
    } else if (formato === 'analitico') {
      linhas = [['EAP', 'Serviço', 'Local', 'Quantidade', 'Unidade', 'Material unit.', 'MO unit.', 'Subtotal']]
      for (const it of itens) linhas.push([it.eap_codigo, `${it.servico_codigo ? it.servico_codigo + ' · ' : ''}${it.servico_descricao ?? 'Serviço'}`, it.local_nome ?? '', it.quantidade, it.unidade ?? '', it.custo_material_unit ?? '', it.custo_mao_obra_unit ?? '', it.subtotal])
      if (temNaoEap) {
        // Caso misto: nunca exportar "TOTAL" menor que o orçamento sem rótulo claro (PDCA §330).
        linhas.push(['', `TOTAL ESTRUTURADO PELA EAP (${itens.length} de ${itensVivos ?? itens.length})`, '', '', '', '', '', somaSubtotais])
        linhas.push(['', 'ITENS SEM EAP (não listados)', '', '', '', '', '', faltaSemEap])
        linhas.push(['', 'TOTAL DO ORÇAMENTO', '', '', '', '', '', orcTotal])
      } else {
        linhas.push(['', 'TOTAL', '', '', '', '', '', somaSubtotais])
      }
    } else {
      linhas = [['EAP', 'Serviço', 'Local', 'Quantidade', 'Unidade', 'Preço unit. (cotação)']]
      for (const it of itens) linhas.push([it.eap_codigo, `${it.servico_codigo ? it.servico_codigo + ' · ' : ''}${it.servico_descricao ?? 'Serviço'}`, it.local_nome ?? '', it.quantidade, it.unidade ?? '', ''])
    }
    const texto = '﻿' + linhas.map((r) => r.map(csvCampo).join(';')).join('\r\n')
    const blob = new Blob([texto], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `orcamento-${obra?.numero ?? 'obra'}-${formato}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

  const chip = (ativo: boolean): CSSProperties => ({
    padding: '7px 14px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer',
    border: `1px solid ${ativo ? ESP : LINE}`, background: ativo ? ESP : '#fff', color: ativo ? '#fff' : MUT,
  })
  const th: CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: MUT, fontWeight: 700, textAlign: 'left', padding: '8px 8px', borderBottom: `1px solid ${LINE}`, whiteSpace: 'nowrap' }
  const td: CSSProperties = { fontSize: 13, color: ESP, padding: '8px 8px', borderBottom: `1px solid ${LINE}`, verticalAlign: 'top' }
  const tdR: CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap' }

  const barra = (p: number) => (
    <div style={{ height: 5, borderRadius: 3, background: LINE, overflow: 'hidden', minWidth: 48, flex: '0 0 48px' }}>
      <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, p))}%`, background: GOLD }} />
    </div>
  )

  const linhaNo = (n: NoEap) => {
    const filhos = filhosPorPai.get(n.eap_codigo) ?? []
    const recuo = (n.nivel - 1) * 16
    return (
      <div key={n.eap_codigo}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px solid ${LINE}` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flex: 1, minWidth: 0, paddingLeft: recuo }}>
            <span style={{ fontSize: 11, color: MUT, fontFamily: 'ui-monospace, monospace', flex: '0 0 auto' }}>{n.eap_codigo}</span>
            <span style={{ fontSize: 14, color: ESP, fontWeight: n.nivel <= 1 ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.nome}</span>
          </div>
          <span style={{ fontSize: 13, color: ESP, fontWeight: 600, flex: '0 0 auto', textAlign: 'right' }}>{brl(n.total)}</span>
          {barra(n.pct)}
          <span style={{ fontSize: 11, color: MUT, flex: '0 0 44px', textAlign: 'right' }}>{pct(n.pct)}</span>
        </div>
        {filhos.map((f) => linhaNo(f))}
      </div>
    )
  }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px' }}>
      {/* Impressão: só o relatório; esconde navegação e botões. */}
      <style>{`@media print{.no-print{display:none!important}body{background:#fff}}`}</style>
      <div style={{ maxWidth: 900, margin: '0 auto' }} data-testid="hub-obra-orcamento-relatorios">
        <Link href={`/dashboard/projetos/obras/${id}/orcamento`} className="no-print" style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Orçamento por EAP</Link>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 8 }}>Hub · Obra{obra ? ` · ${obra.numero}` : ''}{obra?.nome ? ` · ${obra.nome}` : ''}</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: ESP, margin: '2px 0 4px' }}>Relatórios do orçamento</h1>
        <div style={{ fontSize: 13, color: MUT, marginBottom: 14 }} data-testid="orc-rel-desc">{formatoAtual.desc}</div>

        {erro && <div role="alert" data-testid="orc-rel-erro" style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 12 }}>{erro}</div>}

        {/* Seletor de formato + imprimir */}
        <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: MUT, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Formato <AjudaCampo chave="projetos.orcamento_eap.relatorio_formato" rota={ROTA} />
          </span>
          {FORMATOS.map((f) => (
            <button key={f.codigo} data-testid={`orc-rel-formato-${f.codigo}`} onClick={() => setFormato(f.codigo)} style={chip(formato === f.codigo)}>{f.nome}</button>
          ))}
          <div style={{ flex: 1 }} />
          <button data-testid="orc-rel-csv" onClick={exportarCsv} disabled={vazio}
            style={{ padding: '7px 16px', borderRadius: 999, border: `1px solid ${LINE}`, background: '#fff', color: vazio ? MUT : ESP, fontSize: 13, fontWeight: 700, cursor: vazio ? 'default' : 'pointer' }}>
            Exportar CSV
          </button>
          <button data-testid="orc-rel-imprimir" onClick={() => window.print()} disabled={vazio}
            style={{ padding: '7px 16px', borderRadius: 999, border: `1px solid ${ESP}`, background: '#fff', color: vazio ? MUT : ESP, fontSize: 13, fontWeight: 700, cursor: vazio ? 'default' : 'pointer' }}>
            Imprimir / PDF
          </button>
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div> : vazio ? (
          <div data-testid="orc-rel-vazio" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 15, color: ESP, fontWeight: 600, marginBottom: 6 }}>Nada para relatar ainda</div>
            <div style={{ fontSize: 13, color: MUT, lineHeight: 1.5 }}>
              {obra && !obra.orcamento_id
                ? 'Esta obra ainda não tem um orçamento vinculado.'
                : 'O orçamento ainda não tem itens estruturados pela EAP. Monte o orçamento e volte para gerar os relatórios.'}
            </div>
            <Link href={`/dashboard/projetos/obras/${id}/orcamento`} className="no-print" style={{ display: 'inline-block', marginTop: 14, padding: '9px 16px', borderRadius: 999, border: `1px solid ${ESP}`, background: ESP, color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
              Ir para o orçamento
            </Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {/* Totais (ocultos na planilha cega — ela não revela preço) */}
            {formato !== 'cega' && arvore && (
              <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, display: 'flex', flexWrap: 'wrap', gap: 20 }}>
                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700 }}>Total estruturado (EAP)</div>
                  <div style={{ fontSize: 22, color: ESP, fontWeight: 700 }}>{brl(arvore.total_geral)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700 }}>Material</div>
                  <div style={{ fontSize: 18, color: ESP, fontWeight: 600 }}>{brl(arvore.material_geral)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700 }}>Mão de obra</div>
                  <div style={{ fontSize: 18, color: ESP, fontWeight: 600 }}>{brl(arvore.mao_obra_geral)}</div>
                </div>
              </div>
            )}

            {/* Orçamento MISTO: a EAP é só uma fatia — não deixar o relatório parecer o total real (PDCA §330). */}
            {formato !== 'cega' && temNaoEap && (
              <div data-testid="orc-rel-aviso-fatia" style={{ background: '#FBF3E0', border: `0.5px solid ${GOLD}`, borderRadius: 10, padding: '10px 14px', fontSize: 13, color: ESP, lineHeight: 1.5 }}>
                Este relatório mostra só o que está <strong>estruturado pela EAP</strong> ({brl(somaSubtotais)}
                {itensVivos != null ? ` · ${itens.length} de ${itensVivos} ${itensVivos === 1 ? 'item' : 'itens'}` : ''}). O orçamento tem mais <strong>{brl(faltaSemEap)}</strong> em itens ainda <strong>sem EAP</strong> — total do orçamento <strong>{brl(orcTotal)}</strong>. Estruture-os pela EAP no orçamento para o relatório fechar o total.
              </div>
            )}

            {/* Sintético — árvore EAP */}
            {formato === 'sintetico' && (
              <div data-testid="orc-rel-sintetico" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: '4px 16px 12px' }}>
                {raizes.map((n) => linhaNo(n))}
              </div>
            )}

            {/* Analítico — itens com preços */}
            {formato === 'analitico' && (
              <div data-testid="orc-rel-analitico" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: '4px 8px', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                  <thead><tr>
                    <th style={th}>EAP</th><th style={th}>Serviço</th><th style={th}>Local</th><th style={{ ...th, textAlign: 'right' }}>Qtd.</th>
                    <th style={{ ...th, textAlign: 'right' }}>Material un.</th><th style={{ ...th, textAlign: 'right' }}>MO un.</th><th style={{ ...th, textAlign: 'right' }}>Subtotal</th>
                  </tr></thead>
                  <tbody>
                    {itens.map((it) => (
                      <tr key={it.item_id} data-testid={`orc-rel-item-${it.item_id}`}>
                        <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{it.eap_codigo}</td>
                        <td style={td}>{it.servico_codigo ? `${it.servico_codigo} · ` : ''}{it.servico_descricao ?? 'Serviço'}</td>
                        <td style={td}>{it.local_nome ?? '—'}</td>
                        <td style={tdR}>{qtd(it.quantidade)}{it.unidade ? ` ${it.unidade}` : ''}</td>
                        <td style={tdR}>{brl(it.custo_material_unit)}</td>
                        <td style={tdR}>{brl(it.custo_mao_obra_unit)}</td>
                        <td style={{ ...tdR, fontWeight: 600 }}>{brl(it.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr data-testid="orc-rel-analitico-total">
                      <td style={{ ...td, fontWeight: 700, borderTop: `2px solid ${LINE}`, borderBottom: 'none' }} colSpan={6}>
                        {temNaoEap
                          ? `Total estruturado pela EAP (${itens.length} de ${itensVivos ?? itens.length} ${(itensVivos ?? itens.length) === 1 ? 'item' : 'itens'})`
                          : `Total do orçamento (${itens.length} ${itens.length === 1 ? 'item' : 'itens'})`}
                      </td>
                      <td style={{ ...tdR, fontWeight: 800, color: ESP, borderTop: `2px solid ${LINE}`, borderBottom: 'none' }}>{brl(somaSubtotais)}</td>
                    </tr>
                    {temNaoEap && (
                      <tr data-testid="orc-rel-analitico-total-real">
                        <td style={{ ...td, fontWeight: 700, borderBottom: 'none', color: ESP }} colSpan={6}>Total do orçamento <span style={{ fontWeight: 500, color: MUT }}>(com itens sem EAP)</span></td>
                        <td style={{ ...tdR, fontWeight: 800, color: ESP, borderBottom: 'none' }}>{brl(orcTotal)}</td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>
            )}

            {/* Planilha cega — itens SEM preços, com coluna de preço em branco para o empreiteiro preencher */}
            {formato === 'cega' && (
              <>
                <div data-testid="orc-rel-cega-aviso" style={{ background: '#FBF3E0', border: `0.5px solid ${GOLD}`, borderRadius: 10, padding: '10px 14px', fontSize: 13, color: ESP, lineHeight: 1.5 }}>
                  Esta é a <strong>planilha cega</strong>: os itens da obra <strong>sem os seus preços</strong>. Imprima ou gere o PDF e envie ao empreiteiro para ele cotar na coluna em branco.
                  {temNaoEap && itensVivos != null && <> Lista só os <strong>{itens.length} de {itensVivos}</strong> itens estruturados pela EAP; estruture os demais para incluí-los na cotação.</>}
                </div>
                <div data-testid="orc-rel-cega" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: '4px 8px', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                    <thead><tr>
                      <th style={th}>EAP</th><th style={th}>Serviço</th><th style={th}>Local</th><th style={{ ...th, textAlign: 'right' }}>Qtd.</th><th style={th}>Un.</th><th style={{ ...th, textAlign: 'right' }}>Preço unit. (cotação)</th>
                    </tr></thead>
                    <tbody>
                      {itens.map((it) => (
                        <tr key={it.item_id} data-testid={`orc-rel-cega-item-${it.item_id}`}>
                          <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{it.eap_codigo}</td>
                          <td style={td}>{it.servico_codigo ? `${it.servico_codigo} · ` : ''}{it.servico_descricao ?? 'Serviço'}</td>
                          <td style={td}>{it.local_nome ?? '—'}</td>
                          <td style={tdR}>{qtd(it.quantidade)}</td>
                          <td style={td}>{it.unidade ?? '—'}</td>
                          <td style={{ ...tdR, color: LINE, borderBottom: `1px solid ${LINE}` }}>_______________</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
