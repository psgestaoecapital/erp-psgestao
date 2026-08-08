'use client'

// import-produtos-fiscal-v1
// Tela: Importar / Migrar produtos (fiscal). Fluxo:
//   1. Upload XLSX livre
//   2. Auto-mapeamento de colunas (editavel)
//   3. Preview com semaforo (verde/amarelo/vermelho)
//   4. Aplicar → fn_import_produtos_fiscal grava + registra em erp_importacoes.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { authFetch } from '@/lib/authFetch'
import { ArrowLeft, Upload, FileSpreadsheet, AlertCircle, Loader2, Eye, Play, CheckCircle2 } from 'lucide-react'

type Campo = 'codigo' | 'ncm' | 'st' | 'cest' | 'monofasico'
type Mapping = Record<Campo, string | null>

interface ParseResp {
  ok: boolean
  headers: string[]
  mapping_auto: Mapping
  sample: Array<Record<string, unknown>>
  total_rows: number
  mensagem?: string
}

interface PreviewDetalhe {
  codigo: string | null
  status: 'verde' | 'amarelo' | 'vermelho'
  msg: string | null
  antes?: Record<string, unknown>
  depois?: Record<string, unknown>
}

interface PreviewResp {
  ok: boolean
  total: number
  atualizados: number
  avisos: number
  nao_encontrados: number
  detalhes: PreviewDetalhe[]
  mensagem?: string
}

function resolveCompanyId(): string | null {
  if (typeof window === 'undefined') return null
  const sel = localStorage.getItem('ps_empresa_sel')
  if (!sel || sel === 'consolidado' || sel.startsWith('group_')) return null
  return sel
}

const CAMPOS: Array<{ key: Campo; label: string; obrig: boolean }> = [
  { key: 'codigo', label: 'Código do produto', obrig: true },
  { key: 'ncm', label: 'NCM', obrig: false },
  { key: 'st', label: 'ICMS-ST (SIM/NÃO)', obrig: false },
  { key: 'cest', label: 'CEST', obrig: false },
  { key: 'monofasico', label: 'PIS/COFINS monofásico (SIM/NÃO)', obrig: false },
]

export default function ProdutosFiscalImportClient() {
  // resolve uma vez (lazy init · localStorage so existe no client)
  const [companyId] = useState<string | null>(() => resolveCompanyId())
  const erroEmpresa: string | null = companyId
    ? null
    : 'Selecione uma empresa específica no trocador da TopNav.'
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseResp, setParseResp] = useState<ParseResp | null>(null)
  const [mapping, setMapping] = useState<Mapping>({ codigo: '', ncm: '', st: '', cest: '', monofasico: '' })
  const [preview, setPreview] = useState<PreviewResp | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [aplicado, setAplicado] = useState<PreviewResp | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'verde' | 'amarelo' | 'vermelho'>('todos')

  async function fazerParse() {
    if (!file || !companyId) return
    setParsing(true); setErro(null); setParseResp(null); setPreview(null); setAplicado(null)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('companyId', companyId)
    fd.append('mode', 'parse')
    try {
      const resp = await authFetch('/api/import/produtos-fiscal', { method: 'POST', body: fd })
      const json = await resp.json() as ParseResp
      if (!resp.ok || !json.ok) {
        setErro(json.mensagem ?? 'Falha ao ler planilha')
        setParsing(false); return
      }
      setParseResp(json)
      setMapping(json.mapping_auto)
      setParsing(false)
    } catch (e) {
      setErro((e as Error)?.message ?? 'Erro ao ler planilha')
      setParsing(false)
    }
  }

  async function fazerPreview() {
    if (!file || !companyId) return
    if (!mapping.codigo) { setErro('Mapeamento obrigatório: Código do produto'); return }
    setPreviewing(true); setErro(null); setPreview(null); setAplicado(null)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('companyId', companyId)
    fd.append('mode', 'preview')
    fd.append('mapping', JSON.stringify(mapping))
    try {
      const resp = await authFetch('/api/import/produtos-fiscal', { method: 'POST', body: fd })
      const json = await resp.json() as PreviewResp
      if (!resp.ok || !json.ok) {
        setErro(json.mensagem ?? 'Falha ao gerar preview')
        setPreviewing(false); return
      }
      setPreview(json)
      setPreviewing(false)
    } catch (e) {
      setErro((e as Error)?.message ?? 'Erro no preview')
      setPreviewing(false)
    }
  }

  async function aplicar() {
    if (!file || !companyId || !preview) return
    if (!confirm(`APLICAR alterações fiscais em ${preview.atualizados} produto(s)?\n\n${preview.nao_encontrados} código(s) não encontrado(s) serão ignorados.\n${preview.avisos} aviso(s) fiscal(is).`)) return
    setAplicando(true); setErro(null)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('companyId', companyId)
    fd.append('mode', 'aplicar')
    fd.append('mapping', JSON.stringify(mapping))
    try {
      const resp = await authFetch('/api/import/produtos-fiscal', { method: 'POST', body: fd })
      const json = await resp.json() as PreviewResp
      if (!resp.ok || !json.ok) {
        setErro(json.mensagem ?? 'Falha ao aplicar')
        setAplicando(false); return
      }
      setAplicado(json)
      setAplicando(false)
      alert(`ATUALIZOU ${json.atualizados} · 🟡 ${json.avisos} avisos · 🔴 ${json.nao_encontrados} não encontrados.`)
    } catch (e) {
      setErro((e as Error)?.message ?? 'Erro ao aplicar')
      setAplicando(false)
    }
  }

  const detalhesFiltrados = useMemo(() => {
    if (!preview) return []
    if (filtroStatus === 'todos') return preview.detalhes
    return preview.detalhes.filter((d) => d.status === filtroStatus)
  }, [preview, filtroStatus])

  if (erroEmpresa) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-[#FCEBEB] text-[#A32D2D] p-4 rounded-lg flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <div>{erroEmpresa}</div>
        </div>
      </div>
    )
  }

  const SeloStatus = ({ s }: { s: 'verde' | 'amarelo' | 'vermelho' }) => {
    const cor = s === 'verde' ? { bg: '#E7F4EC', fg: '#1B873F', emoji: '🟢' }
      : s === 'amarelo' ? { bg: '#FBF3E0', fg: '#B7791F', emoji: '🟡' }
        : { bg: '#FCE8E8', fg: '#C53030', emoji: '🔴' }
    return (
      <span style={{ background: cor.bg, color: cor.fg }} className="text-[10.5px] font-bold px-2 py-0.5 rounded">
        {cor.emoji} {s.toUpperCase()}
      </span>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <Link href="/dashboard/importar-universal" className="text-[#3D2314]/65 hover:text-[#3D2314] flex items-center gap-1.5 text-[12.5px]">
          <ArrowLeft size={14} /> Importação
        </Link>
        <span className="text-[#3D2314]/30">/</span>
        <h1 className="text-[18px] font-semibold text-[#3D2314] flex items-center gap-1.5">
          <FileSpreadsheet size={16} /> Importar / Migrar produtos (fiscal)
        </h1>
      </div>

      <div className="mb-4 p-3 bg-[#FBF3E0] border border-[#C8941A]/40 rounded-lg text-[11.5px] text-[#3D2314]/85 leading-snug">
        <strong>Sem template fixo.</strong> Suba qualquer planilha de produtos · o sistema detecta os cabeçalhos automaticamente. Você pode ajustar o mapeamento antes de visualizar. <strong>Pré-visualize sempre antes de aplicar</strong> (semáforo mostra avisos fiscais).
      </div>

      {/* Passo 1: upload */}
      <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4 sm:p-5 mb-4">
        <h2 className="text-[13px] font-semibold text-[#3D2314] mb-3">1 · Suba a planilha</h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 px-4 py-2 text-[12.5px] font-medium border border-dashed border-[#3D2314]/30 rounded-lg cursor-pointer hover:bg-[#FAF7F2]">
            <Upload size={14} />
            {file ? file.name : 'Escolher arquivo (.xlsx)'}
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setParseResp(null); setPreview(null); setAplicado(null); setErro(null) }}
              className="hidden"
            />
          </label>
          <button
            type="button"
            onClick={fazerParse}
            disabled={!file || parsing}
            className="px-4 py-2 text-[12.5px] font-medium rounded-lg bg-[#3D2314] text-white hover:bg-[#5A3520] disabled:opacity-50 flex items-center gap-1.5"
          >
            {parsing ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />}
            {parsing ? 'Lendo…' : 'Ler cabeçalhos'}
          </button>
        </div>
        {parseResp && (
          <div className="mt-3 text-[11.5px] text-[#3D2314]/70">
            Detectei <strong>{parseResp.headers.length}</strong> coluna(s) · <strong>{parseResp.total_rows}</strong> linha(s) de dados.
          </div>
        )}
      </div>

      {/* Passo 2: mapeamento */}
      {parseResp && (
        <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4 sm:p-5 mb-4">
          <h2 className="text-[13px] font-semibold text-[#3D2314] mb-3">2 · Confirme o mapeamento</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CAMPOS.map((c) => (
              <div key={c.key}>
                <label className="block text-[11px] text-[#3D2314]/70 mb-1">
                  {c.label} {c.obrig && <span className="text-[#A32D2D]">*</span>}
                </label>
                <select
                  value={mapping[c.key] ?? ''}
                  onChange={(e) => setMapping({ ...mapping, [c.key]: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-[12.5px] border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]"
                >
                  <option value="">— ignorar —</option>
                  {parseResp.headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={fazerPreview}
              disabled={previewing || !mapping.codigo}
              className="px-4 py-2 text-[12.5px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A77A12] disabled:opacity-50 flex items-center gap-1.5"
            >
              {previewing ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
              {previewing ? 'Gerando preview…' : 'Pré-visualizar'}
            </button>
          </div>
        </div>
      )}

      {/* Passo 3: preview */}
      {preview && !aplicado && (
        <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4 sm:p-5 mb-4">
          <h2 className="text-[13px] font-semibold text-[#3D2314] mb-3">3 · Confira o resultado</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <div className="p-2 rounded bg-[#FAF7F2] text-center">
              <div className="text-[10.5px] text-[#3D2314]/55 uppercase">Total</div>
              <div className="text-[16px] font-semibold text-[#3D2314]">{preview.total}</div>
            </div>
            <button onClick={() => setFiltroStatus('verde')} className="p-2 rounded bg-[#E7F4EC] text-center hover:opacity-80">
              <div className="text-[10.5px] text-[#1B873F] uppercase">🟢 Casaram</div>
              <div className="text-[16px] font-semibold text-[#1B873F]">{preview.atualizados - preview.avisos}</div>
            </button>
            <button onClick={() => setFiltroStatus('amarelo')} className="p-2 rounded bg-[#FBF3E0] text-center hover:opacity-80">
              <div className="text-[10.5px] text-[#B7791F] uppercase">🟡 Avisos</div>
              <div className="text-[16px] font-semibold text-[#B7791F]">{preview.avisos}</div>
            </button>
            <button onClick={() => setFiltroStatus('vermelho')} className="p-2 rounded bg-[#FCE8E8] text-center hover:opacity-80">
              <div className="text-[10.5px] text-[#C53030] uppercase">🔴 Não enc.</div>
              <div className="text-[16px] font-semibold text-[#C53030]">{preview.nao_encontrados}</div>
            </button>
          </div>
          <div className="mb-2 flex gap-2 text-[11.5px]">
            {(['todos', 'verde', 'amarelo', 'vermelho'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFiltroStatus(s)}
                className={`px-2.5 py-1 rounded border ${filtroStatus === s ? 'border-[#C8941A] bg-[#C8941A]/10' : 'border-[#3D2314]/15'}`}
              >
                {s === 'todos' ? `Todos (${preview.detalhes.length})` : s.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="max-h-[400px] overflow-y-auto border border-[#3D2314]/10 rounded">
            <table className="w-full text-[11.5px]">
              <thead className="bg-[#FAF7F2] sticky top-0">
                <tr>
                  <th className="px-2 py-1.5 text-left text-[10.5px] text-[#3D2314]/65 uppercase">Status</th>
                  <th className="px-2 py-1.5 text-left text-[10.5px] text-[#3D2314]/65 uppercase">Código</th>
                  <th className="px-2 py-1.5 text-left text-[10.5px] text-[#3D2314]/65 uppercase">Antes</th>
                  <th className="px-2 py-1.5 text-left text-[10.5px] text-[#3D2314]/65 uppercase">Depois</th>
                  <th className="px-2 py-1.5 text-left text-[10.5px] text-[#3D2314]/65 uppercase">Aviso</th>
                </tr>
              </thead>
              <tbody>
                {detalhesFiltrados.slice(0, 500).map((d, idx) => (
                  <tr key={idx} className="border-t border-[#3D2314]/5">
                    <td className="px-2 py-1.5"><SeloStatus s={d.status} /></td>
                    <td className="px-2 py-1.5 font-mono">{d.codigo ?? '—'}</td>
                    <td className="px-2 py-1.5 text-[#3D2314]/65 font-mono text-[10.5px]">
                      {d.antes ? `CST ${String(d.antes.cst_icms ?? '—')}/${String(d.antes.cst_pis ?? '—')} · CFOP ${String(d.antes.cfop_venda ?? '—')} · CEST ${String(d.antes.cest ?? '—')}` : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-[#3D2314] font-mono text-[10.5px]">
                      {d.depois ? `CST ${String(d.depois.cst_icms ?? '—')}/${String(d.depois.cst_pis ?? '—')} · CFOP ${String(d.depois.cfop_venda ?? '—')} · CEST ${String(d.depois.cest ?? '—')}` : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-[#B7791F]">{d.msg ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {detalhesFiltrados.length > 500 && (
              <div className="px-2 py-1.5 text-[10.5px] text-[#3D2314]/55 bg-[#FAF7F2] border-t border-[#3D2314]/10">
                Mostrando primeiros 500 · total {detalhesFiltrados.length}
              </div>
            )}
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={aplicar}
              disabled={aplicando || preview.atualizados === 0}
              className="px-5 py-2 text-[12.5px] font-semibold rounded-lg bg-[#1B873F] text-white hover:bg-[#136530] disabled:opacity-50 flex items-center gap-1.5"
            >
              {aplicando ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              {aplicando ? 'Aplicando…' : `Aplicar em ${preview.atualizados} produto(s)`}
            </button>
          </div>
        </div>
      )}

      {/* Passo 4: resultado */}
      {aplicado && (
        <div className="bg-white border border-[#1B873F]/40 rounded-xl p-4 sm:p-5 mb-4">
          <h2 className="text-[13px] font-semibold text-[#1B873F] mb-2 flex items-center gap-2">
            <CheckCircle2 size={14} /> Importação concluída
          </h2>
          <div className="text-[12.5px] text-[#3D2314]">
            <strong>ATUALIZOU {aplicado.atualizados}</strong> · 🟡 {aplicado.avisos} avisos · 🔴 {aplicado.nao_encontrados} não encontrados (total: {aplicado.total}).
          </div>
        </div>
      )}

      {erro && (
        <div className="mb-4 p-3 bg-[#FCEBEB] text-[#A32D2D] text-[12.5px] rounded-lg flex items-start gap-2">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{erro}</span>
        </div>
      )}
    </div>
  )
}
