'use client'

// fiscal-base-ncm-autoclassificacao-v1
// Roda fn_autoclassificar_produtos: classifica produtos sem CST/CFOP/CEST
// reusando a base fiscal_ncm_regras (NCM+UF).
// Modos:
//   - p_somente_sem_classificacao=true (default): so produtos sem cst_icms
//   - p_dry_run=true: preview · false: aplica + grava em erp_importacoes

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Detalhe {
  codigo: string | null
  ncm: string | null
  status: 'verde' | 'amarelo' | 'vermelho'
  msg: string | null
  antes?: {
    ncm?: string | null
    cest?: string | null
    cst_icms?: string | null
    cfop_venda?: string | null
    cst_pis?: string | null
    cst_cofins?: string | null
  }
  depois?: {
    ncm?: string | null
    cest?: string | null
    cst_icms?: string | null
    cfop_venda?: string | null
    cst_pis?: string | null
    cst_cofins?: string | null
  }
}

interface ResultadoRPC {
  ok: boolean
  dry_run: boolean
  importacao_id?: string | null
  uf: string
  total: number
  classificados: number
  parciais: number
  sem_regra: number
  ncms_sem_regra: string[]
  detalhes: Detalhe[]
}

export default function AutoclassificarProdutosCard({ companyId, onAplicado }: { companyId: string; onAplicado?: () => void }) {
  const [loading, setLoading] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [somenteSemClassificacao, setSomenteSemClassificacao] = useState(true)
  const [resultado, setResultado] = useState<ResultadoRPC | null>(null)
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'verde' | 'amarelo' | 'vermelho'>('todos')
  const [aplicado, setAplicado] = useState(false)

  async function rodar(aplicar: boolean) {
    setErro(null)
    if (aplicar) setAplicando(true)
    else setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.rpc('fn_autoclassificar_produtos', {
      p_company_id: companyId,
      p_uf: null,
      p_somente_sem_classificacao: somenteSemClassificacao,
      p_dry_run: !aplicar,
      p_user_id: user?.id ?? null,
    })
    if (aplicar) setAplicando(false)
    else setLoading(false)
    if (error) {
      setErro(error.message)
      return
    }
    setResultado(data as ResultadoRPC)
    if (aplicar) {
      setAplicado(true)
      onAplicado?.()
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    rodar(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, somenteSemClassificacao])

  function exportarNcmsCsv() {
    if (!resultado || resultado.ncms_sem_regra.length === 0) return
    const linhas = ['ncm', ...resultado.ncms_sem_regra].join('\n')
    const blob = new Blob([linhas], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ncms_sem_regra_${resultado.uf}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const detalhesFiltrados = useMemo(() => {
    if (!resultado) return [] as Detalhe[]
    if (filtroStatus === 'todos') return resultado.detalhes
    return resultado.detalhes.filter((d) => d.status === filtroStatus)
  }, [resultado, filtroStatus])

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 10, color: '#C8941A', textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700, marginBottom: 4 }}>
            🤖 Base PS · auto-classificacao por NCM
          </div>
          <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 500, color: '#3D2314', margin: 0 }}>
            Classificar fiscalidade pelos NCMs já conhecidos
          </h2>
          <p style={{ fontSize: 12, color: 'rgba(61,35,20,0.7)', margin: '4px 0 0' }}>
            Usa a base <code>fiscal_ncm_regras</code> (semeada pelos contadores) pra preencher CST/CFOP/CEST por NCM+UF.
            {resultado?.uf && <> · UF: <strong>{resultado.uf}</strong></>}
          </p>
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#3D2314', marginBottom: 12, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={somenteSemClassificacao}
          onChange={(e) => setSomenteSemClassificacao(e.target.checked)}
          style={{ width: 16, height: 16 }}
        />
        Apenas produtos sem classificacao (cst_icms vazio)
      </label>

      {loading && (
        <div style={{ padding: '12px 16px', fontSize: 13, color: 'rgba(61,35,20,0.65)' }}>
          ⏳ Rodando preview…
        </div>
      )}

      {erro && <div style={erroBox}>{erro}</div>}

      {resultado && !loading && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
            <KpiCard label="Total" valor={resultado.total} cor="#3D2314" ativo={filtroStatus === 'todos'} onClick={() => setFiltroStatus('todos')} />
            <KpiCard label="🟢 Classificados" valor={resultado.classificados} cor="#3B6D11" ativo={filtroStatus === 'verde'} onClick={() => setFiltroStatus('verde')} />
            <KpiCard label="🟡 Parciais" valor={resultado.parciais} cor="#BA7517" ativo={filtroStatus === 'amarelo'} onClick={() => setFiltroStatus('amarelo')} />
            <KpiCard label="🔴 Sem regra" valor={resultado.sem_regra} cor="#A32D2D" ativo={filtroStatus === 'vermelho'} onClick={() => setFiltroStatus('vermelho')} />
          </div>

          {resultado.ncms_sem_regra.length > 0 && (
            <div style={{ background: '#FAEEDA', border: '1px solid #BA7517', borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#3D2314', marginBottom: 6 }}>
                Pendencias do contador · {resultado.ncms_sem_regra.length} NCM(s) sem regra
              </div>
              <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.75)', marginBottom: 8, maxHeight: 80, overflowY: 'auto', wordBreak: 'break-all' }}>
                {resultado.ncms_sem_regra.join(' · ')}
              </div>
              <button onClick={exportarNcmsCsv} style={ghostBtn}>
                📥 Exportar lista CSV
              </button>
            </div>
          )}

          <div style={{ border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, overflow: 'auto', maxHeight: 380, marginBottom: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: 'rgba(61,35,20,0.04)', position: 'sticky', top: 0, zIndex: 1 }}>
                  <th style={th}>Status</th>
                  <th style={th}>Código</th>
                  <th style={th}>NCM</th>
                  <th style={th}>CST ICMS</th>
                  <th style={th}>CFOP</th>
                  <th style={th}>CEST</th>
                  <th style={th}>CST PIS</th>
                  <th style={th}>Aviso</th>
                </tr>
              </thead>
              <tbody>
                {detalhesFiltrados.slice(0, 500).map((d, i) => (
                  <tr key={`${d.codigo}-${i}`} style={{ borderTop: '0.5px solid rgba(61,35,20,0.06)' }}>
                    <td style={td}>{statusEmoji(d.status)}</td>
                    <td style={td}>{d.codigo ?? '—'}</td>
                    <td style={td}>{d.ncm ?? '—'}</td>
                    <td style={td}>{antesDepois(d.antes?.cst_icms, d.depois?.cst_icms)}</td>
                    <td style={td}>{antesDepois(d.antes?.cfop_venda, d.depois?.cfop_venda)}</td>
                    <td style={td}>{antesDepois(d.antes?.cest, d.depois?.cest)}</td>
                    <td style={td}>{antesDepois(d.antes?.cst_pis, d.depois?.cst_pis)}</td>
                    <td style={{ ...td, color: '#BA7517', fontSize: 10 }}>{d.msg ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {detalhesFiltrados.length > 500 && (
              <div style={{ padding: '8px 12px', fontSize: 11, color: 'rgba(61,35,20,0.55)', background: '#FAF7F2' }}>
                Mostrando 500 de {detalhesFiltrados.length}
              </div>
            )}
          </div>

          <button
            onClick={() => {
              const aplicaveis = resultado.classificados + resultado.parciais
              if (aplicaveis === 0 || aplicado) return
              const msg = `CLASSIFICAR automaticamente ${aplicaveis} produto(s)?\n\n🟢 ${resultado.classificados} completo(s) · 🟡 ${resultado.parciais} parciais (faltam dados do contador)\n🔴 ${resultado.sem_regra} sem regra ficam intocados.`
              if (window.confirm(msg)) rodar(true)
            }}
            disabled={aplicando || aplicado || (resultado.classificados + resultado.parciais) === 0}
            style={primaryBtn(aplicando)}
          >
            {aplicado
              ? `✅ CLASSIFICOU ${resultado.classificados + resultado.parciais} produto(s)`
              : aplicando
                ? 'Aplicando…'
                : `🚀 Aplicar em ${resultado.classificados + resultado.parciais} produto(s)`}
          </button>
        </>
      )}
    </div>
  )
}

function KpiCard({ label, valor, cor, ativo, onClick }: { label: string; valor: number; cor: string; ativo: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: ativo ? '#FFF8E7' : '#FFFFFF',
        border: `2px solid ${ativo ? cor : 'rgba(61,35,20,0.12)'}`,
        borderRadius: 8, padding: '10px 14px',
        textAlign: 'left', cursor: 'pointer', font: 'inherit', minHeight: 44,
      }}
    >
      <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: cor, marginTop: 2 }}>{valor}</div>
    </button>
  )
}

function statusEmoji(s: Detalhe['status']): string {
  return s === 'verde' ? '🟢' : s === 'amarelo' ? '🟡' : '🔴'
}

function antesDepois(antes: string | null | undefined, depois: string | null | undefined): React.ReactNode {
  const a = antes ?? '—'
  const d = depois ?? '—'
  if (a === d) return <span style={{ color: 'rgba(61,35,20,0.5)' }}>{d}</span>
  return (
    <span>
      <span style={{ color: 'rgba(61,35,20,0.45)', textDecoration: 'line-through' }}>{a}</span>
      {' → '}
      <strong style={{ color: '#3D2314' }}>{d}</strong>
    </span>
  )
}

const card: React.CSSProperties = {
  background: 'linear-gradient(135deg, #FFF8E7 0%, #FFFFFF 100%)',
  border: '2px solid #C8941A',
  borderRadius: 12, padding: '20px 24px', marginBottom: 20,
  boxShadow: '0 4px 12px rgba(200,148,26,0.15)',
}
const th: React.CSSProperties = {
  textAlign: 'left', padding: '6px 8px', fontSize: 10,
  color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase',
  letterSpacing: 0.6, fontWeight: 600, whiteSpace: 'nowrap',
}
const td: React.CSSProperties = { padding: '5px 8px', color: '#3D2314', whiteSpace: 'nowrap' }
const erroBox: React.CSSProperties = {
  background: '#FCEBEB', color: '#A32D2D',
  padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 8,
}
function primaryBtn(loading: boolean): React.CSSProperties {
  return { background: loading ? 'rgba(200,148,26,0.5)' : '#C8941A', color: '#3D2314', border: 'none', padding: '10px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: loading ? 'wait' : 'pointer', minHeight: 44 }
}
const ghostBtn: React.CSSProperties = {
  background: 'transparent', color: '#3D2314',
  border: '0.5px solid rgba(61,35,20,0.2)',
  padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', minHeight: 44,
}
