'use client'

import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

const C = { bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2', muted: '#B0AB9F', green: '#4CAF50', red: '#EF5350' }

export default function ImportarPage() {
  const [empresas, setEmpresas] = useState<any[]>([])
  const [empresaSel, setEmpresaSel] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<any[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ success: number; errors: number } | null>(null)
  const [step, setStep] = useState(1)
  const fileRef = useRef<HTMLInputElement>(null)

  const CAMPOS = ['data', 'descricao', 'valor', 'categoria', 'fornecedor', 'tipo']

  useEffect(() => {
    supabase.from('empresas').select('id, nome').order('nome').then(({ data }) => {
      if (data && data.length > 0) { setEmpresas(data); setEmpresaSel(data[0].id) }
    })
  }, [])

  const parseCSV = (text: string) => {
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) return { headers: [], rows: [] }
    const sep = lines[0].includes(';') ? ';' : ','
    const hdrs = lines[0].split(sep).map(h => h.replace(/"/g, '').trim())
    const rows = lines.slice(1).map(line => {
      const vals = line.split(sep).map(v => v.replace(/"/g, '').trim())
      const obj: Record<string, string> = {}
      hdrs.forEach((h, i) => obj[h] = vals[i] || '')
      return obj
    })
    return { headers: hdrs, rows }
  }

  const parseOFX = (text: string) => {
    const rows: any[] = []
    const transactions = text.split('<STMTTRN>').slice(1)
    transactions.forEach(t => {
      const get = (tag: string) => { const m = t.match(new RegExp('<' + tag + '>([^<\\n]+)')); return m ? m[1].trim() : '' }
      const dtposted = get('DTPOSTED')
      const data = dtposted ? dtposted.substring(0, 4) + '-' + dtposted.substring(4, 6) + '-' + dtposted.substring(6, 8) : ''
      rows.push({ data, descricao: get('MEMO') || get('NAME'), valor: get('TRNAMT'), tipo: get('TRNTYPE'), id_banco: get('FITID') })
    })
    return { headers: ['data', 'descricao', 'valor', 'tipo', 'id_banco'], rows }
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setResult(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const isOFX = f.name.toLowerCase().endsWith('.ofx')
      const parsed = isOFX ? parseOFX(text) : parseCSV(text)
      setHeaders(parsed.headers)
      setPreview(parsed.rows.slice(0, 50))
      // Auto-mapping
      const autoMap: Record<string, string> = {}
      CAMPOS.forEach(campo => {
        const match = parsed.headers.find(h => h.toLowerCase().includes(campo))
        if (match) autoMap[campo] = match
      })
      setMapping(autoMap)
      setStep(2)
    }
    reader.readAsText(f, 'UTF-8')
  }

  const handleImport = async () => {
    if (!empresaSel || preview.length === 0) return
    setImporting(true)
    let success = 0, errors = 0

    for (const row of preview) {
      try {
        const valorStr = (row[mapping.valor] || '0').replace(/[^\d.,-]/g, '').replace(',', '.')
        const valor = parseFloat(valorStr) || 0
        if (valor === 0) { errors++; continue }

        const lancamento = {
          empresa_id: empresaSel,
          data: row[mapping.data] || new Date().toISOString().split('T')[0],
          descricao: row[mapping.descricao] || '',
          valor: valor,
          categoria: row[mapping.categoria] || 'Importado',
          fornecedor: row[mapping.fornecedor] || '',
          tipo: row[mapping.tipo] || (valor >= 0 ? 'receita' : 'despesa'),
          origem: 'import_' + (file?.name || 'manual'),
        }

        const { error } = await supabase.from('lancamentos').insert(lancamento)
        if (error) { errors++; console.error(error) } else success++
      } catch { errors++ }
    }

    setResult({ success, errors })
    setImporting(false)
    setStep(3)
  }

  const inputStyle: React.CSSProperties = { background: C.card, border: '1px solid ' + C.border, color: C.text, padding: '8px 12px', borderRadius: 6, fontSize: 13, width: '100%' }

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.text }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: C.gold, marginBottom: 16 }}>📥 Importar Dados</h1>

      {/* Step 1: Upload */}
      <div style={{ background: C.card, borderRadius: 8, padding: 16, marginBottom: 12, borderLeft: '4px solid ' + (step >= 1 ? C.gold : C.border) }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>1. Selecione o arquivo (CSV ou OFX)</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={empresaSel} onChange={e => setEmpresaSel(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
            {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
          <input ref={fileRef} type="file" accept=".csv,.ofx,.txt" onChange={handleFile} style={{ display: 'none' }} />
          <button onClick={() => fileRef.current?.click()} style={{ background: C.gold, color: '#3D2314', border: 'none', padding: '10px 20px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
            📁 Selecionar Arquivo
          </button>
          {file && <span style={{ fontSize: 12, color: C.muted }}>{file.name} ({preview.length} registros)</span>}
        </div>
      </div>

      {/* Step 2: Map & Preview */}
      {step >= 2 && (
        <div style={{ background: C.card, borderRadius: 8, padding: 16, marginBottom: 12, borderLeft: '4px solid ' + C.gold }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>2. Mapeamento de Colunas</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginBottom: 16 }}>
            {CAMPOS.map(campo => (
              <div key={campo}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>{campo.toUpperCase()}</div>
                <select value={mapping[campo] || ''} onChange={e => setMapping({ ...mapping, [campo]: e.target.value })} style={inputStyle}>
                  <option value="">-- ignorar --</option>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>

          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Preview ({preview.length} registros)</div>
          <div style={{ overflow: 'auto', maxHeight: 250 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>{headers.slice(0, 6).map(h => <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: C.gold, whiteSpace: 'nowrap' }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {preview.slice(0, 10).map((row, i) => (
                  <tr key={i} style={{ borderTop: '1px solid ' + C.border }}>
                    {headers.slice(0, 6).map(h => <td key={h} style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{row[h] || '-'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button onClick={handleImport} disabled={importing || !mapping.valor} style={{ marginTop: 12, background: '#2E7D32', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 14, opacity: importing ? 0.5 : 1 }}>
            {importing ? '⏳ Importando...' : '✅ IMPORTAR ' + preview.length + ' REGISTROS'}
          </button>
        </div>
      )}

      {/* Step 3: Result */}
      {result && (
        <div style={{ background: C.card, borderRadius: 8, padding: 20, textAlign: 'center', borderLeft: '4px solid ' + (result.errors === 0 ? C.green : C.red) }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>{result.errors === 0 ? '✅' : '⚠️'}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.green }}>{result.success} importados</div>
          {result.errors > 0 && <div style={{ fontSize: 14, color: C.red, marginTop: 4 }}>{result.errors} erros</div>}
          <button onClick={() => { setStep(1); setFile(null); setPreview([]); setResult(null) }} style={{ marginTop: 12, background: C.gold, color: '#3D2314', border: 'none', padding: '8px 16px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>Nova Importação</button>
        </div>
      )}
    </div>
  )
}