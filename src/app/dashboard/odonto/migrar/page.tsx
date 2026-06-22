'use client'
import React, { useEffect, useState } from 'react'
import { UploadCloud, Check, AlertTriangle, ArrowRight } from 'lucide-react'
import ExcelJS from 'exceljs'
import { supabase } from '@/lib/supabase'
import { odontoParseRows, type OdontoParsedRecord } from '@/lib/import/odonto'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.55)'

function useCompanyId(): string | null {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => {
      if (typeof window === 'undefined') return null
      const v = localStorage.getItem('ps_empresa_sel')
      if (!v || v === 'consolidado' || v.startsWith('group_')) return null
      return v
    }
    setId(read())
    const t = setInterval(() => {
      const v = read()
      setId((prev) => (prev === v ? prev : v))
    }, 800)
    return () => clearInterval(t)
  }, [])
  return id
}

async function parseCsv(file: File): Promise<Record<string, string>[]> {
  const text = await file.text()
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []
  const sep = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ','
  const split = (line: string) => {
    const out: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') { inQ = !inQ; continue }
      if (c === sep && !inQ) { out.push(cur); cur = ''; continue }
      cur += c
    }
    out.push(cur)
    return out.map((s) => s.trim())
  }
  const headers = split(lines[0])
  return lines.slice(1).map((line) => {
    const cells = split(line)
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = cells[i] ?? '' })
    return obj
  })
}

async function parseXlsx(file: File): Promise<Record<string, unknown>[]> {
  const buf = await file.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const ws = wb.worksheets[0]
  if (!ws) return []
  const headers: string[] = []
  ws.getRow(1).eachCell((cell, col) => {
    headers[col - 1] = String(cell.value ?? '').trim()
  })
  const rows: Record<string, unknown>[] = []
  ws.eachRow((row, num) => {
    if (num === 1) return
    const obj: Record<string, unknown> = {}
    row.eachCell((cell, col) => {
      const h = headers[col - 1] || `col_${col}`
      obj[h] = cell.value
    })
    rows.push(obj)
  })
  return rows
}

type Preview = { dry_run: boolean; total: number; novos: number; duplicados: number; erros: number; amostra: Array<{ nome: string; cpf: string | null; convenio: string | null }> }

export default function MigrarPacientesPage() {
  const companyId = useCompanyId()
  const [parsed, setParsed] = useState<{ records: OdontoParsedRecord[]; columns: Record<string, string> } | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [done, setDone] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const onFile = async (f: File) => {
    setFileName(f.name)
    setDone(null); setPreview(null); setErro(null); setParsed(null)
    try {
      const rows = /\.csv$/i.test(f.name)
        ? await parseCsv(f)
        : await parseXlsx(f)
      setParsed(odontoParseRows(rows))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setErro(`Nao foi possivel ler a planilha: ${msg}`)
    }
  }

  const rodar = async (dryRun: boolean) => {
    if (!companyId || !parsed) return
    setBusy(true); setErro(null)
    const { data: u } = await supabase.auth.getUser()
    const { data, error } = await supabase.rpc('fn_odonto_migrar_pacientes', {
      p_company_id: companyId,
      p_user_id: u?.user?.id,
      p_arquivo_nome: fileName,
      p_records: parsed.records,
      p_dry_run: dryRun,
    })
    setBusy(false)
    if (error) { setErro(error.message); return }
    if (dryRun) setPreview(data as Preview)
    else setDone(data as Preview)
  }

  if (!companyId) return (
    <div style={{ background: BG, color: ESP60, minHeight: '100%' }} className="p-6 text-sm">
      Selecione uma empresa especifica no topo do menu para migrar pacientes.
    </div>
  )

  return (
    <div style={{ background: BG, color: ESP, minHeight: '100%' }} className="p-4 sm:p-6 max-w-2xl mx-auto">
      <div className="text-xs font-semibold tracking-widest uppercase" style={{ color: GOLD }}>Migração assistida</div>
      <h1 className="text-2xl sm:text-3xl mt-1 mb-1" style={{ fontFamily: 'ui-serif,Georgia,serif', fontWeight: 600 }}>Trazer pacientes do sistema atual</h1>
      <p className="text-sm mb-5" style={{ color: ESP60 }}>Suba a planilha exportada do seu sistema. A gente reconhece as colunas e traz tudo — sem redigitar.</p>

      <label className="block rounded-2xl p-8 text-center cursor-pointer" style={{ border: `2px dashed ${LINE}`, background: '#fff' }}>
        <UploadCloud size={28} style={{ color: GOLD }} className="mx-auto mb-2" />
        <span className="text-sm font-medium">{fileName || 'Escolher planilha (.xlsx / .csv)'}</span>
        <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files && onFile(e.target.files[0])} />
      </label>

      {erro && (
        <div className="mt-4 rounded-xl p-3 text-sm" style={{ background: '#FEE', border: '1px solid #FBB', color: '#A65A3A' }}>
          <AlertTriangle size={14} className="inline mr-1" /> {erro}
        </div>
      )}

      {parsed && (
        <div className="mt-5 rounded-2xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
          <div className="text-sm font-semibold mb-2">Colunas reconhecidas</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(parsed.columns).map(([campo, header]) => (
              <span key={campo} className="text-xs rounded-full px-2 py-1" style={{ background: BG, border: `1px solid ${LINE}` }}>
                <b>{campo}</b> ← {header}
              </span>
            ))}
            {Object.keys(parsed.columns).length === 0 && (
              <span className="text-xs inline-flex items-center gap-1" style={{ color: '#A65A3A' }}>
                <AlertTriangle size={13} /> Nenhuma coluna reconhecida — confira o cabeçalho da planilha.
              </span>
            )}
          </div>
          <div className="text-xs mt-3" style={{ color: ESP60 }}>{parsed.records.length} linhas válidas detectadas.</div>
          {!preview && (
            <button disabled={busy || !companyId || parsed.records.length === 0} onClick={() => rodar(true)} className="mt-3 px-4 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-2" style={{ background: GOLD, color: '#fff', opacity: busy ? 0.6 : 1 }}>
              Pré-visualizar <ArrowRight size={15} />
            </button>
          )}
        </div>
      )}

      {preview && !done && (
        <div className="mt-4 rounded-2xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
          <div className="text-sm font-semibold mb-2">Prévia (nada gravado ainda)</div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat n={preview.novos} l="novos" />
            <Stat n={preview.duplicados} l="já existem" />
            <Stat n={preview.erros} l="sem nome" />
          </div>
          {preview.amostra?.length > 0 && (
            <div className="text-xs mt-3" style={{ color: ESP60 }}>Ex.: {preview.amostra.map((a) => a.nome).join(' · ')}</div>
          )}
          <button disabled={busy || preview.novos === 0} onClick={() => rodar(false)} className="mt-4 w-full py-2.5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2" style={{ background: ESP, color: '#fff', opacity: busy ? 0.6 : 1 }}>
            <Check size={16} /> Migrar {preview.novos} pacientes
          </button>
        </div>
      )}

      {done && (
        <div className="mt-4 rounded-2xl p-5 text-center" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
          <Check size={28} style={{ color: GOLD }} className="mx-auto mb-2" />
          <div className="text-lg font-semibold" style={{ fontFamily: 'ui-serif,Georgia,serif' }}>{done.novos} pacientes migrados</div>
          <div className="text-xs mt-1" style={{ color: ESP60 }}>{done.duplicados} já existiam · {done.erros} ignorados</div>
          <a href="/dashboard/odonto/pacientes" className="inline-block mt-4 px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: GOLD, color: '#fff' }}>Ver pacientes</a>
        </div>
      )}
    </div>
  )
}

function Stat({ n, l }: { n: number; l: string }) {
  return (
    <div className="rounded-xl py-2" style={{ background: BG }}>
      <div className="text-xl font-bold" style={{ color: GOLD }}>{n}</div>
      <div className="text-xs" style={{ color: ESP60 }}>{l}</div>
    </div>
  )
}
