'use client'
import React, { useState } from 'react'
import { useDREPorLinha, useBenchmark, useLinhasNegocio } from '@/hooks/useLinhasNegocio'
import { useEmpresaSelecionada } from '@/lib/agro/usePecuaria'
import WaterfallChart from '@/components/linhas-negocio/WaterfallChart'
import DREPorLinhaCard from '@/components/linhas-negocio/DREPorLinha'
import HealthScorePanel from '@/components/linhas-negocio/HealthScore'
import BudgetVsRealizado from '@/components/linhas-negocio/BudgetVsRealizado'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { supabase } from '@/lib/supabase'
import type { DREPorLinha, LinhaNegocio } from '@/types/linhas-negocio'

// Design system PS premium (RD-96) — mesmos tokens das telas irmãs da jornada (Divisões / P&M):
const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const SERIF = 'Fraunces, Georgia, serif'

const mesAtual = new Date().toISOString().slice(0, 7)

export default function LinhasNegocioPage() {
  const [periodo, setPeriodo] = useState(mesAtual)
  const [, setLinhaSelecionada] = useState<DREPorLinha | null>(null)
  // Mesma resolução de empresa das telas irmãs da GE (Bens, Implantação, Resultado por negócio):
  // a empresa SELECIONADA no seletor global, não a empresa-sede fixa do perfil. Sem isso, a tela
  // consultava a empresa errada e exibia o empty-state "Configure" mesmo com linhas cadastradas.
  const { companyId } = useEmpresaSelecionada()
  const empresaId = companyId ?? ''
  const { data: dre, loading } = useDREPorLinha(empresaId, periodo)
  const { data: benchmark } = useBenchmark(empresaId, periodo)
  const { linhas, loading: loadingLinhas, refetch: refetchLinhas } = useLinhasNegocio(empresaId)
  const [removendoId, setRemovendoId] = useState<string | null>(null)

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

  // RD-98 p2: Editar/Remover de cada linha ficam visíveis na lista. Remover usa o DELETE já existente
  // (/api/linhas-negocio?id=...), que DESATIVA a linha (ativo=false, com guarda por empresa) — histórico mantido.
  async function removerLinha(l: LinhaNegocio) {
    if (!window.confirm(`Remover a linha "${l.nome}"? Ela sai dos indicadores; o histórico é mantido.`)) return
    setRemovendoId(l.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await window.fetch(`/api/linhas-negocio?id=${l.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as { error?: string }))
        window.alert('Não consegui remover a linha: ' + (j?.error ?? res.statusText)); return
      }
      refetchLinhas()
    } finally { setRemovendoId(null) }
  }

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>Gestão Empresarial</div>
            <h1 style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, color: ESPRESSO, margin: '2px 0 0' }}>Linhas de negócio</h1>
            <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>
              Performance e contribuição marginal por linha — visão executiva
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <input type='month' value={periodo} onChange={e => setPeriodo(e.target.value)}
                style={{ border: `1px solid ${BORDA}`, borderRadius: 8, padding: '7px 12px', fontSize: 13, background: '#fff', color: ESPRESSO, minHeight: 40 }}/>
              <AjudaCampo chave='ge.linhas.periodo' />
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <a href='/dashboard/linhas-negocio/configurar'
                style={{ fontSize: 13, fontWeight: 700, border: `1px solid ${ESPRESSO}`, color: ESPRESSO, borderRadius: 8, padding: '7px 14px', textDecoration: 'none', background: '#fff', display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 40 }}>
                ⚙ Configurar
              </a>
              <AjudaCampo chave='ge.linhas.configurar' />
            </span>
          </div>
        </header>

        {!empresaId && (
          <div style={{ border: `1px dashed ${BORDA}`, background: '#fff', borderRadius: 16, padding: 48, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🏢</div>
            <h2 style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 400, color: ESPRESSO, margin: '0 0 8px' }}>Selecione uma empresa</h2>
            <p style={{ fontSize: 13, color: TEXTM, margin: '0 auto', maxWidth: 420 }}>
              As linhas de negócio e o resultado por linha são por empresa. Escolha uma empresa no seletor
              no topo para ver os indicadores. (A visão consolidada ainda não é suportada aqui.)
            </p>
          </div>
        )}

        {empresaId && !loadingLinhas && linhas.length === 0 && (
          <div style={{ border: `1px dashed ${DOURADO}`, background: '#fff', borderRadius: 16, padding: 48, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
            <h2 style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 400, color: ESPRESSO, margin: '0 0 8px' }}>Configure suas linhas de negócio</h2>
            <p style={{ fontSize: 13, color: TEXTM, margin: '0 auto 16px', maxWidth: 420 }}>
              Saiba exatamente qual parte do seu negócio gera resultado. Cada linha tem sua própria DRE,
              margem de contribuição e health score — com análise de IA incluída.
            </p>
            <a href='/dashboard/linhas-negocio/configurar'
              style={{ display: 'inline-block', background: ESPRESSO, color: '#fff', padding: '9px 22px', borderRadius: 10, fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
              Criar primeira linha →
            </a>
          </div>
        )}

        {empresaId && !loadingLinhas && linhas.length > 0 && (
          <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 14, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
              <h2 style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 400, color: ESPRESSO, margin: 0 }}>Suas linhas de negócio</h2>
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                <a href='/dashboard/linhas-negocio/configurar' style={{ fontSize: 12.5, fontWeight: 700, color: DOURADO, textDecoration: 'none' }}>+ Nova linha</a>
                <AjudaCampo chave='ge.linhas.nova_linha' />
              </span>
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
              {linhas.map((l, i) => (
                <li key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 2px', borderTop: i === 0 ? 'none' : `1px solid ${BORDA}`, flexWrap: 'wrap' }}>
                  <span aria-hidden style={{ width: 12, height: 12, borderRadius: 3, background: l.cor || DOURADO, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 140 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: ESPRESSO }}>{l.nome}</span>
                    {l.descricao && <span style={{ fontSize: 12, color: TEXTM, marginLeft: 8 }}>{l.descricao}</span>}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <a href='/dashboard/linhas-negocio/configurar' style={{ fontSize: 12.5, fontWeight: 700, color: ESPRESSO, textDecoration: 'none', padding: '6px 12px', border: `1px solid ${BORDA}`, borderRadius: 8, minHeight: 36, display: 'inline-flex', alignItems: 'center' }}>Editar</a>
                    <AjudaCampo chave='ge.linhas.editar_linha' />
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <button onClick={() => removerLinha(l)} disabled={removendoId === l.id}
                      style={{ fontSize: 12.5, fontWeight: 700, color: '#A32D2D', background: 'transparent', border: `1px solid ${BORDA}`, borderRadius: 8, padding: '6px 12px', minHeight: 36, cursor: removendoId === l.id ? 'default' : 'pointer', opacity: removendoId === l.id ? 0.6 : 1 }}>
                      {removendoId === l.id ? 'Removendo…' : 'Remover'}
                    </button>
                    <AjudaCampo chave='ge.linhas.remover_linha' />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Estado vazio do bloco de performance (RD-98/critério d): há linhas cadastradas, mas ainda
            não há DRE/rateio no período — sem isso não há como calcular receita, CM3 nem contribuição
            marginal por linha. Antes ficava um espaço em branco sob o subtítulo "Performance e
            contribuição marginal"; agora explicamos o que falta e damos o caminho. */}
        {empresaId && !loadingLinhas && linhas.length > 0 && !loading && !benchmark && dre.length === 0 && (
          <div style={{ border: `1px dashed ${DOURADO}`, background: '#fff', borderRadius: 16, padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📈</div>
            <h2 style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 400, color: ESPRESSO, margin: '0 0 8px' }}>
              Ainda sem performance no período {new Date(periodo + '-02').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
            </h2>
            <p style={{ fontSize: 13, color: TEXTM, margin: '0 auto 16px', maxWidth: 460, lineHeight: 1.5 }}>
              Suas linhas já estão cadastradas, mas a performance por linha (receita, CM3 e contribuição marginal)
              só aparece quando as receitas e despesas do período são rateadas para cada linha. Configure o rateio
              para ver a DRE por linha, o health score e o comparativo com o orçamento.
            </p>
            <a href='/dashboard/rateio'
              style={{ display: 'inline-block', background: ESPRESSO, color: '#fff', padding: '9px 22px', borderRadius: 10, fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
              Configurar rateio →
            </a>
          </div>
        )}

        {benchmark && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 14 }}>
            {[
              { label: 'Receita total', val: fmt(benchmark.consolidado.receita_total), chave: 'ge.linhas.receita_total' },
              { label: 'CM3 consolidado', val: fmt(benchmark.consolidado.cm3_total), chave: 'ge.linhas.cm3_consolidado' },
              { label: 'Margem CM3', val: benchmark.consolidado.cm3_pct_media.toFixed(1) + '%', chave: 'ge.linhas.margem_cm3' },
              { label: 'Melhor linha', val: benchmark.consolidado.melhor_linha, chave: 'ge.linhas.melhor_linha' },
            ].map((k, i) => (
              <div key={i} style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 14, padding: 16 }}>
                <p style={{ display: 'flex', alignItems: 'center', fontSize: 11, color: TEXTM, textTransform: 'uppercase', letterSpacing: 0.6, margin: 0 }}>{k.label}<AjudaCampo chave={k.chave} /></p>
                <p style={{ fontSize: 22, fontWeight: 700, color: ESPRESSO, margin: '6px 0 0' }}>{k.val}</p>
              </div>
            ))}
          </div>
        )}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 128, color: TEXTM, fontSize: 13 }}>
            Calculando margens por linha...
          </div>
        )}

        {!loading && dre.length > 0 && (
          <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 14, padding: 16 }}>
            <WaterfallChart linhas={dre} onLinhaClick={setLinhaSelecionada}/>
          </div>
        )}

        {!loading && dre.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px,1fr))', gap: 16 }}>
            {dre.map(l => <DREPorLinhaCard key={l.linha_id} linha={l}/>)}
          </div>
        )}

        {!loading && dre.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px,1fr))', gap: 20 }}>
            <HealthScorePanel linhas={dre}/>
            <BudgetVsRealizado linhas={dre}/>
          </div>
        )}
      </div>
    </div>
  )
}
