'use client'

import React, { useState } from 'react'

const C = { bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2', muted: '#B0AB9F', green: '#4CAF50', red: '#EF5350', yellow: '#FFC107', blue: '#42A5F5', teal: '#009688' }

export default function DiagnosticosPage() {
  const [modo, setModo] = useState<'csv' | 'erp' | null>(null)
  const [empresas, setEmpresas] = useState<any[]>([])
  const [empresaSel, setEmpresaSel] = useState('')
  const [resultado, setResultado] = useState<any>(null)
  const [parecer, setParecer] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingIA, setLoadingIA] = useState(false)

  const loadEmpresas = async () => {
    try {
      const resp = await fetch('/api/assessor/empresas-erp')
      const data = await resp.json()
      setEmpresas(data.empresas || [])
    } catch (e) { /* */ }
  }

  const analisarERP = async () => {
    if (!empresaSel) { alert('Selecione uma empresa'); return }
    setLoading(true)
    try {
      const resp = await fetch('/api/assessor/analisar-erp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa_id: empresaSel }),
      })
      const data = await resp.json()
      setResultado(data)
    } catch (e) { alert('Erro na analise') }
    setLoading(false)
  }

  const gerarParecer = async () => {
    if (!resultado) return
    setLoadingIA(true)
    try {
      const resp = await fetch('/api/assessor/consultor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diagnostico: resultado, cliente_nome: 'Cliente', assessoria_nome: 'PS Assessor' }),
      })
      const data = await resp.json()
      setParecer(data.parecer || 'Erro ao gerar parecer')
    } catch (e) { setParecer('Erro de conexao') }
    setLoadingIA(false)
  }

  const fmt = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 0 })
  const inputSt: React.CSSProperties = { background: C.bg, border: '1px solid ' + C.border, color: C.text, padding: '8px 12px', borderRadius: 6, fontSize: 12 }

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.text }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: C.gold, marginBottom: 4 }}>Diagnostico Inteligente</h1>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 16 }}>PS Assessor | Analise automatica via ERP ou import CSV</div>

      {/* Modo selector */}
      {!modo && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div onClick={() => { setModo('erp'); loadEmpresas() }} style={{ background: C.card, borderRadius: 8, padding: 24, cursor: 'pointer', textAlign: 'center', borderLeft: '3px solid ' + C.teal }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>{'<>'}</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: C.teal }}>Conector ERP</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Puxa dados direto do ERP PS Gestao. Gera ABC + DFCL automaticamente.</div>
          </div>
          <div onClick={() => setModo('csv')} style={{ background: C.card, borderRadius: 8, padding: 24, cursor: 'pointer', textAlign: 'center', borderLeft: '3px solid ' + C.blue }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>CSV</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: C.blue }}>Import CSV</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Upload de arquivo CSV com dados financeiros do cliente.</div>
          </div>
        </div>
      )}

      {/* ERP Mode */}
      {modo === 'erp' && (
        <div>
          <button onClick={() => { setModo(null); setResultado(null); setParecer('') }} style={{ background: 'transparent', border: '1px solid ' + C.border, color: C.muted, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11, marginBottom: 12 }}>Voltar</button>

          <div style={{ background: C.card, borderRadius: 8, padding: 16, marginBottom: 12, borderLeft: '3px solid ' + C.teal }}>
            <div style={{ fontWeight: 700, color: C.teal, marginBottom: 10 }}>Conector ERP</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <select value={empresaSel} onChange={e => setEmpresaSel(e.target.value)} style={{ ...inputSt, flex: 1 }}>
                <option value="">Selecione a empresa</option>
                {empresas.map((e: any) => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
              <button onClick={analisarERP} disabled={loading || !empresaSel} style={{ background: C.teal, color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', opacity: loading ? 0.5 : 1 }}>
                {loading ? 'Analisando...' : 'Analisar'}
              </button>
            </div>
          </div>

          {/* Resultado */}
          {resultado && !resultado.error && (
            <div>
              <div style={{ background: C.card, borderRadius: 8, padding: 16, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, color: C.gold }}>Resultado: {resultado.total_lancamentos} lancamentos analisados</div>
                  <button onClick={gerarParecer} disabled={loadingIA} style={{ background: C.gold, color: '#3D2314', border: 'none', padding: '8px 16px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 11, opacity: loadingIA ? 0.5 : 1 }}>
                    {loadingIA ? 'Gerando...' : 'Gerar Parecer IA'}
                  </button>
                </div>

                {/* ABC tables */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 6 }}>ABC Clientes (Top 10)</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                      <thead><tr><th style={{ padding: '4px 6px', textAlign: 'left', color: C.gold }}>Cliente</th><th style={{ padding: '4px 6px', textAlign: 'right', color: C.gold }}>Valor</th></tr></thead>
                      <tbody>
                        {(resultado.abc_clientes || []).slice(0, 10).map((c: any, i: number) => (
                          <tr key={i} style={{ borderBottom: '1px solid ' + C.border }}>
                            <td style={{ padding: '3px 6px' }}>{c.nome}</td>
                            <td style={{ padding: '3px 6px', textAlign: 'right', color: C.green }}>{fmt(c.valor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.red, marginBottom: 6 }}>ABC Fornecedores (Top 10)</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                      <thead><tr><th style={{ padding: '4px 6px', textAlign: 'left', color: C.gold }}>Fornecedor</th><th style={{ padding: '4px 6px', textAlign: 'right', color: C.gold }}>Valor</th></tr></thead>
                      <tbody>
                        {(resultado.abc_fornecedores || []).slice(0, 10).map((f: any, i: number) => (
                          <tr key={i} style={{ borderBottom: '1px solid ' + C.border }}>
                            <td style={{ padding: '3px 6px' }}>{f.nome}</td>
                            <td style={{ padding: '3px 6px', textAlign: 'right', color: C.red }}>{fmt(f.valor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Parecer IA */}
              {parecer && (
                <div style={{ background: C.card, borderRadius: 8, padding: 16, borderLeft: '3px solid ' + C.gold }}>
                  <div style={{ fontWeight: 700, color: C.gold, marginBottom: 10 }}>Parecer do Consultor IA</div>
                  <div style={{ fontSize: 12, color: C.text, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{parecer}</div>
                </div>
              )}
            </div>
          )}

          {resultado && resultado.error && (
            <div style={{ background: C.card, borderRadius: 8, padding: 16, borderLeft: '3px solid ' + C.red }}>
              <div style={{ color: C.red }}>{resultado.error}</div>
            </div>
          )}
        </div>
      )}

      {modo === 'csv' && (
        <div>
          <button onClick={() => setModo(null)} style={{ background: 'transparent', border: '1px solid ' + C.border, color: C.muted, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11, marginBottom: 12 }}>Voltar</button>
          <div style={{ background: C.card, borderRadius: 8, padding: 24, textAlign: 'center', borderLeft: '3px solid ' + C.blue }}>
            <div style={{ fontSize: 14, color: C.blue, fontWeight: 700 }}>Import CSV</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>Acesse a pagina de diagnosticos original em /dashboard/assessor/diagnosticos para upload CSV.</div>
          </div>
        </div>
      )}
    </div>
  )
}