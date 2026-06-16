'use client'

// importador-universal-produtos-fiscal-v1
// Wizard 3 passos: upload XLSX -> mapeamento + preview -> aplicar.
// RPC pronta: fn_import_produtos_fiscal(company, rows, dry_run, user, arquivo)
//   - rows aceita { codigo, ncm, icms_st (texto), cest, pis_cofins (texto) }
//   - retorno: { total, atualizados, avisos, nao_encontrados, detalhes[] }

import { useMemo, useState } from 'react'
import ExcelJS from 'exceljs'
import { supabase } from '@/lib/supabase'

type Campo = 'codigo' | 'ncm' | 'icms_st' | 'cest' | 'pis_cofins'
type Passo = 'upload' | 'preview' | 'resultado'

interface Detalhe {
  codigo: string | null
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
  total: number
  atualizados: number
  avisos: number
  nao_encontrados: number
  detalhes: Detalhe[]
}

type Mapping = Record<Campo, string | null>

const SINONIMOS: Record<Campo, string[]> = {
  codigo: ['codigo do produto', 'codigo produto', 'codigo', 'sku', 'cod', 'ref', 'referencia', 'id'],
  ncm: ['codigo ncm', 'ncm', 'ncm/sh'],
  icms_st: ['icms st', 'icms-st', 'st', 'substituicao tributaria', 'tem st', 'possui st'],
  cest: ['cest'],
  pis_cofins: ['pis/cofins', 'pis cofins', 'piscofins', 'tributacao pis', 'monofasico', 'pis'],
}

function normalize(s: string): string {
  return s
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 /]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function autoDetect(headers: string[]): Mapping {
  const normHeaders = headers.map((h) => ({ raw: h, norm: normalize(h) }))
  const out: Mapping = { codigo: null, ncm: null, icms_st: null, cest: null, pis_cofins: null }
  for (const campo of Object.keys(SINONIMOS) as Campo[]) {
    const sinNorm = SINONIMOS[campo].map(normalize)
    const match = normHeaders.find((h) => sinNorm.some((s) => h.norm === s || h.norm.includes(s)))
    if (match) out[campo] = match.raw
  }
  return out
}

function pickSheet(wb: ExcelJS.Workbook): ExcelJS.Worksheet | null {
  // tenta achar "Relação de Produtos" (normalizado), senao pega a primeira
  const alvo = 'relacao de produtos'
  for (const ws of wb.worksheets) {
    if (normalize(ws.name) === alvo) return ws
  }
  return wb.worksheets[0] ?? null
}

interface ParsedFile {
  headers: string[]
  rowsBruto: Array<Record<string, unknown>>
  sheetName: string
}

async function parseXlsx(file: File): Promise<ParsedFile> {
  const buf = await file.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const ws = pickSheet(wb)
  if (!ws) throw new Error('Planilha sem abas')
  const headers: string[] = []
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
    headers.push(String(cell.value ?? '').trim())
  })
  const rowsBruto: Array<Record<string, unknown>> = []
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const obj: Record<string, unknown> = {}
    headers.forEach((h, idx) => {
      const cell = row.getCell(idx + 1)
      obj[h] = cell.value ?? null
    })
    rowsBruto.push(obj)
  }
  return { headers, rowsBruto, sheetName: ws.name }
}

function valorTexto(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'object' && raw !== null && 'text' in raw) {
    return String((raw as { text: unknown }).text ?? '').trim()
  }
  return String(raw).trim()
}

export default function ImportProdutosFiscalCard({ companyId }: { companyId: string }) {
  const [passo, setPasso] = useState<Passo>('upload')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [arquivoNome, setArquivoNome] = useState<string>('')
  const [sheetName, setSheetName] = useState<string>('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rowsBruto, setRowsBruto] = useState<Array<Record<string, unknown>>>([])
  const [mapping, setMapping] = useState<Mapping>({ codigo: null, ncm: null, icms_st: null, cest: null, pis_cofins: null })
  const [resultado, setResultado] = useState<ResultadoRPC | null>(null)
  const [aplicando, setAplicando] = useState(false)
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'verde' | 'amarelo' | 'vermelho'>('todos')

  async function handleFile(file: File) {
    setErro(null)
    setLoading(true)
    try {
      const parsed = await parseXlsx(file)
      if (parsed.headers.length === 0) {
        setErro('Cabeçalho vazio na primeira linha')
        setLoading(false)
        return
      }
      setArquivoNome(file.name)
      setSheetName(parsed.sheetName)
      setHeaders(parsed.headers)
      setRowsBruto(parsed.rowsBruto)
      setMapping(autoDetect(parsed.headers))
      setPasso('preview')
      // ja roda preview automaticamente
      await rodarRpc(false, parsed.rowsBruto, autoDetect(parsed.headers), file.name)
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }

  function rowsParaRpc(
    bruto: Array<Record<string, unknown>>,
    map: Mapping,
  ): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = []
    for (const r of bruto) {
      const codigo = map.codigo ? valorTexto(r[map.codigo]) : ''
      if (!codigo) continue // ignora linhas sem codigo (ex.: "teste001")
      const obj: Record<string, unknown> = { codigo }
      if (map.ncm) obj.ncm = valorTexto(r[map.ncm])
      if (map.icms_st) obj.icms_st = valorTexto(r[map.icms_st])
      if (map.cest) obj.cest = valorTexto(r[map.cest])
      if (map.pis_cofins) obj.pis_cofins = valorTexto(r[map.pis_cofins])
      out.push(obj)
    }
    return out
  }

  async function rodarRpc(
    aplicar: boolean,
    bruto = rowsBruto,
    map = mapping,
    arquivo = arquivoNome,
  ) {
    setErro(null)
    if (!map.codigo) {
      setErro('Mapeie o campo Código (obrigatório).')
      return
    }
    const rows = rowsParaRpc(bruto, map)
    if (rows.length === 0) {
      setErro('Nenhuma linha com código válido.')
      return
    }
    if (aplicar) setAplicando(true)
    else setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.rpc('fn_import_produtos_fiscal', {
      p_company_id: companyId,
      p_rows: rows,
      p_dry_run: !aplicar,
      p_user_id: user?.id ?? null,
      p_arquivo: arquivo,
    })
    if (aplicar) setAplicando(false)
    else setLoading(false)
    if (error) {
      setErro(error.message)
      return
    }
    setResultado(data as ResultadoRPC)
    if (aplicar) setPasso('resultado')
  }

  async function reMapeamento(novo: Mapping) {
    setMapping(novo)
    if (passo === 'preview') {
      await rodarRpc(false, rowsBruto, novo)
    }
  }

  function resetar() {
    setHeaders([])
    setRowsBruto([])
    setMapping({ codigo: null, ncm: null, icms_st: null, cest: null, pis_cofins: null })
    setResultado(null)
    setErro(null)
    setArquivoNome('')
    setSheetName('')
    setFiltroStatus('todos')
    setPasso('upload')
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
            🧾 Produtos · atualização fiscal
          </div>
          <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 500, color: '#3D2314', margin: 0 }}>
            Migrar fiscalidade (NCM · ICMS-ST · CEST · PIS/COFINS)
          </h2>
          <p style={{ fontSize: 12, color: 'rgba(61,35,20,0.7)', margin: '4px 0 0' }}>
            Planilha livre · auto-detecta cabeçalhos · preview com semáforo antes de aplicar
          </p>
        </div>
        {passo !== 'upload' && (
          <button onClick={resetar} style={ghostBtn}>← Recomeçar</button>
        )}
      </div>

      {passo === 'upload' && (
        <div>
          <UploadArea onFile={handleFile} loading={loading} />
          <p style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 8 }}>
            Sem template fixo · lê a aba <strong>&quot;Relação de Produtos&quot;</strong> ou a primeira.
            Auto-mapeia: Código do Produto → codigo · Código NCM → ncm · ICMS-ST → icms_st (texto SIM/NÃO) · CEST → cest · PIS/COFINS → pis_cofins (MONOFASICO/NÃO MONOFASICO).
          </p>
        </div>
      )}

      {passo === 'preview' && (
        <div>
          <div style={{ background: '#FFF8E7', border: '0.5px solid #C8941A', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 12, color: '#3D2314' }}>
            📄 <strong>{arquivoNome}</strong> · aba <em>{sheetName}</em> · {rowsBruto.length} linhas lidas
          </div>

          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, marginBottom: 8 }}>
            Mapeamento (editável)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 16 }}>
            {(['codigo', 'ncm', 'icms_st', 'cest', 'pis_cofins'] as Campo[]).map((c) => (
              <MapField
                key={c}
                campo={c}
                obrigatorio={c === 'codigo'}
                headers={headers}
                value={mapping[c]}
                onChange={(v) => reMapeamento({ ...mapping, [c]: v })}
              />
            ))}
          </div>

          {loading && (
            <div style={{ padding: '12px 16px', fontSize: 13, color: 'rgba(61,35,20,0.65)' }}>
              ⏳ Rodando preview…
            </div>
          )}

          {resultado && !loading && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
                <KpiCard label="Total" valor={resultado.total} cor="#3D2314" ativo={filtroStatus === 'todos'} onClick={() => setFiltroStatus('todos')} />
                <KpiCard label="🟢 Casaram" valor={resultado.atualizados} cor="#3B6D11" ativo={filtroStatus === 'verde'} onClick={() => setFiltroStatus('verde')} />
                <KpiCard label="🟡 Avisos" valor={resultado.avisos} cor="#BA7517" ativo={filtroStatus === 'amarelo'} onClick={() => setFiltroStatus('amarelo')} />
                <KpiCard label="🔴 Não enc." valor={resultado.nao_encontrados} cor="#A32D2D" ativo={filtroStatus === 'vermelho'} onClick={() => setFiltroStatus('vermelho')} />
              </div>

              <div style={{ border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, overflow: 'auto', maxHeight: 420, marginBottom: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: 'rgba(61,35,20,0.04)', position: 'sticky', top: 0, zIndex: 1 }}>
                      <th style={th}>Status</th>
                      <th style={th}>Código</th>
                      <th style={th}>CST ICMS</th>
                      <th style={th}>CFOP</th>
                      <th style={th}>CEST</th>
                      <th style={th}>CST PIS</th>
                      <th style={th}>CST COFINS</th>
                      <th style={th}>Aviso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalhesFiltrados.slice(0, 500).map((d, i) => (
                      <tr key={`${d.codigo}-${i}`} style={{ borderTop: '0.5px solid rgba(61,35,20,0.06)' }}>
                        <td style={td}>{statusEmoji(d.status)}</td>
                        <td style={td}>{d.codigo ?? '—'}</td>
                        <td style={td}>{antesDepois(d.antes?.cst_icms, d.depois?.cst_icms)}</td>
                        <td style={td}>{antesDepois(d.antes?.cfop_venda, d.depois?.cfop_venda)}</td>
                        <td style={td}>{antesDepois(d.antes?.cest, d.depois?.cest)}</td>
                        <td style={td}>{antesDepois(d.antes?.cst_pis, d.depois?.cst_pis)}</td>
                        <td style={td}>{antesDepois(d.antes?.cst_cofins, d.depois?.cst_cofins)}</td>
                        <td style={{ ...td, color: '#BA7517', fontSize: 10 }}>{d.msg ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {detalhesFiltrados.length > 500 && (
                  <div style={{ padding: '8px 12px', fontSize: 11, color: 'rgba(61,35,20,0.55)', background: '#FAF7F2' }}>
                    Mostrando 500 de {detalhesFiltrados.length} · todas serão aplicadas
                  </div>
                )}
              </div>

              {erro && <div style={erroBox}>{erro}</div>}

              <button
                onClick={() => {
                  if (resultado.atualizados === 0) return
                  const msg = `Aplicar atualização fiscal em ${resultado.atualizados} produto(s)?\n\n🟡 ${resultado.avisos} aviso(s) · 🔴 ${resultado.nao_encontrados} não encontrado(s) (serão ignorados)`
                  if (window.confirm(msg)) rodarRpc(true)
                }}
                disabled={aplicando || resultado.atualizados === 0}
                style={primaryBtn(aplicando)}
              >
                {aplicando ? 'Aplicando…' : `🚀 Aplicar em ${resultado.atualizados} produto(s)`}
              </button>
            </>
          )}

          {erro && !loading && !resultado && <div style={erroBox}>{erro}</div>}
        </div>
      )}

      {passo === 'resultado' && resultado && (
        <div>
          <div style={{ background: resultado.nao_encontrados > 0 ? '#FAEEDA' : '#EAF3DE', border: `1px solid ${resultado.nao_encontrados > 0 ? '#BA7517' : '#3B6D11'}`, borderRadius: 8, padding: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#3D2314', marginBottom: 8 }}>
              {resultado.nao_encontrados === 0 ? '✅ Importação concluída' : '⚠ Importou com pendências'}
            </div>
            <div style={{ fontSize: 13, color: '#3D2314' }}>
              IMPORTOU <strong>{resultado.atualizados}</strong> produto(s) · 🟡 <strong>{resultado.avisos}</strong> aviso(s) · 🔴 <strong>{resultado.nao_encontrados}</strong> não encontrado(s)
            </div>
            {resultado.importacao_id && (
              <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 6 }}>
                Lote: <code>{resultado.importacao_id}</code>
              </div>
            )}
          </div>
          <button onClick={resetar} style={primaryBtn(false)}>Importar outra planilha</button>
        </div>
      )}
    </div>
  )
}

function MapField({
  campo, obrigatorio, headers, value, onChange,
}: {
  campo: Campo
  obrigatorio?: boolean
  headers: string[]
  value: string | null
  onChange: (v: string | null) => void
}) {
  const labels: Record<Campo, string> = {
    codigo: 'Código*',
    ncm: 'NCM',
    icms_st: 'ICMS-ST (texto SIM/NÃO)',
    cest: 'CEST',
    pis_cofins: 'PIS/COFINS (texto MONOFASICO/NÃO)',
  }
  return (
    <div>
      <label style={{ display: 'block', fontSize: 10, color: 'rgba(61,35,20,0.6)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
        {labels[campo]}
      </label>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        style={{ width: '100%', background: obrigatorio && !value ? '#FCEBEB' : '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.2)', borderRadius: 6, padding: '6px 8px', fontSize: 12, color: '#3D2314', fontFamily: 'inherit' }}
      >
        <option value="">— (ignorar) —</option>
        {headers.map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
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

function UploadArea({ onFile, loading }: { onFile: (f: File) => void; loading: boolean }) {
  const [drag, setDrag] = useState(false)
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
      style={{
        display: 'block', border: `2px dashed ${drag ? '#C8941A' : 'rgba(61,35,20,0.2)'}`,
        background: drag ? '#FFF8E7' : '#FFFFFF', borderRadius: 8, padding: '28px 20px',
        textAlign: 'center', cursor: loading ? 'wait' : 'pointer', transition: 'all 0.15s',
      }}
    >
      <input
        type="file"
        accept=".xlsx,.xls"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
        disabled={loading}
        style={{ display: 'none' }}
      />
      <div style={{ fontSize: 32, marginBottom: 8 }}>{loading ? '⏳' : '🧾'}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#3D2314' }}>
        {loading ? 'Lendo planilha…' : 'Arraste o XLSX de produtos ou clique para selecionar'}
      </div>
      <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 4 }}>
        Aceita .xlsx e .xls
      </div>
    </label>
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
