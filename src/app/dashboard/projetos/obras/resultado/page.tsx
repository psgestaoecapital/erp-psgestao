'use client'

// HB1 · Resultado por obra (fatia 2) — lê v_obra_resultado (receita serviço + material, custo material + viagens,
// previsto × realizado). Só leitura. 3 estados: erro / vazio (ensina) / dados. Linha "Consolidado" no fim. Excel (CSV).
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { fmtR } from '@/lib/psgc-tokens'
import { supabase } from '@/lib/supabase'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', VERM = '#B91C1C'

type Linha = {
  obra_id: string; numero: string; nome: string; status: string
  custo_previsto: number; receita_prevista: number; receita_servico: number; receita_material: number
  custo_material: number; custo_viagens: number; margem_realizada: number
}

const n = (v: unknown) => Number(v ?? 0)
const receita = (l: Linha) => n(l.receita_servico) + n(l.receita_material)
const custo = (l: Linha) => n(l.custo_material) + n(l.custo_viagens)

export default function ResultadoObrasPage() {
  const { companyIds } = useCompanyIds()
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    if (!companyIds?.length) { setLoading(false); return }
    setLoading(true); setErro('')
    try {
      const { data, error } = await comPrazo(
        async () => await supabase.from('v_obra_resultado').select('*').in('company_id', companyIds).order('numero', { ascending: false }),
        { ms: 8000, tentativas: 1, label: 'v_obra_resultado' },
      )
      if (error) { setErro(error.message); return }
      setLinhas((data ?? []) as Linha[])
    } catch { setErro(MSG_CARREGAMENTO_FALHOU) } finally { setLoading(false) }
  }, [companyIds])
  useEffect(() => { carregar() }, [carregar])

  const total = useMemo(() => linhas.reduce((a, l) => ({
    receita: a.receita + receita(l), custo: a.custo + custo(l), margem: a.margem + n(l.margem_realizada),
    prevista: a.prevista + n(l.receita_prevista), custoPrev: a.custoPrev + n(l.custo_previsto),
  }), { receita: 0, custo: 0, margem: 0, prevista: 0, custoPrev: 0 }), [linhas])

  const baixarCsv = () => {
    const cab = ['Obra', 'Nome', 'Receita serviço', 'Receita material', 'Custo material', 'Custo viagens', 'Margem', 'Receita prevista', 'Custo previsto']
    const rows = linhas.map(l => [l.numero, l.nome, l.receita_servico, l.receita_material, l.custo_material, l.custo_viagens, l.margem_realizada, l.receita_prevista, l.custo_previsto])
    const csv = [cab, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = 'resultado-por-obra.csv'; a.click()
  }

  const th: React.CSSProperties = { textAlign: 'right', padding: '8px 10px', fontSize: 12, color: MUT, fontWeight: 600, whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { textAlign: 'right', padding: '8px 10px', fontSize: 13, whiteSpace: 'nowrap' }
  const cor = (v: number) => (v < 0 ? VERM : VERDE)

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: 16, color: ESP }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <Link href="/dashboard/projetos/obras" style={{ color: GOLD, fontSize: 13 }}>← Obras</Link>
        <h1 style={{ fontSize: 22, margin: '8px 0 4px' }}>Resultado por obra</h1>
        <p style={{ fontSize: 13, color: MUT, margin: '0 0 12px' }}>Receita (serviço medido + material vendido) menos custo (material e viagens), previsto × realizado.</p>
        {loading && <p data-testid="resultado-carregando">Carregando…</p>}
        {!loading && erro && <p role="alert" style={{ color: VERM }}>{erro} <button onClick={carregar}>Tentar de novo</button></p>}
        {!loading && !erro && linhas.length === 0 && (
          <p data-testid="resultado-vazio">Nenhuma obra ainda. A obra nasce do orçamento aprovado; assim que houver medição, venda de material ou viagem, o resultado aparece aqui.</p>
        )}
        {!loading && !erro && linhas.length > 0 && (
          <>
            <button onClick={baixarCsv} style={{ marginBottom: 8, padding: '6px 12px', border: `1px solid ${LINE}`, background: '#fff', borderRadius: 8 }}>Baixar Excel (CSV)</button>
            <div style={{ overflowX: 'auto', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12 }}>
              <table data-testid="resultado-tabela" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: `1px solid ${LINE}` }}>
                  <th style={{ ...th, textAlign: 'left' }}>Obra</th><th style={th}>Receita</th><th style={th}>Custo</th>
                  <th style={th}>Margem</th><th style={th}>Receita prevista</th><th style={th}>Custo previsto</th>
                </tr></thead>
                <tbody>
                  {linhas.map(l => (
                    <tr key={l.obra_id} style={{ borderBottom: `1px solid ${LINE}` }}>
                      <td style={{ ...td, textAlign: 'left' }}>{l.numero} · {l.nome}</td>
                      <td style={td}>{fmtR(receita(l))}</td><td style={td}>{fmtR(custo(l))}</td>
                      <td style={{ ...td, color: cor(n(l.margem_realizada)), fontWeight: 600 }}>{fmtR(n(l.margem_realizada))}</td>
                      <td style={td}>{fmtR(n(l.receita_prevista))}</td><td style={td}>{fmtR(n(l.custo_previsto))}</td>
                    </tr>
                  ))}
                  <tr data-testid="resultado-consolidado" style={{ fontWeight: 700 }}>
                    <td style={{ ...td, textAlign: 'left' }}>Consolidado</td>
                    <td style={td}>{fmtR(total.receita)}</td><td style={td}>{fmtR(total.custo)}</td>
                    <td style={{ ...td, color: cor(total.margem) }}>{fmtR(total.margem)}</td>
                    <td style={td}>{fmtR(total.prevista)}</td><td style={td}>{fmtR(total.custoPrev)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
