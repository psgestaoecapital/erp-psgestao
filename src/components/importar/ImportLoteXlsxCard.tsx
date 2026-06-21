'use client'

// Import Lote XLSX · Sub-frente 4.5 Onda 4 (CEO 27/05/2026)
// Wizard 3 passos: tipo → template → upload+preview → confirma.
// Onda 4/v3 (CEO Jun-2026): troca a RPC legada fn_importar_planilha_lote
// pelo dispatch novo (fn_import_universal_dispatch · planilha_modelo_ps).
// Ganha idempotencia (ON CONFLICT por hash) + trilha em erp_importacoes.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ExcelJS from 'exceljs'
import { supabase } from '@/lib/supabase'

type Tipo = 'pagar' | 'receber'
type Passo = 'tipo' | 'upload' | 'resultado'

interface LinhaParse {
  linha_num: number
  raw: Record<string, unknown>
  descricao: string
  valor: number
  data_vencimento: string
  data_competencia?: string
  cnpj?: string
  categoria_codigo?: string
  fornecedor_id?: string | null
  cliente_id?: string | null
  pessoa_nome?: string | null
  valida: boolean
  erros: string[]
}

interface ResultadoDispatch {
  status?: string
  total?: number
  inseridos?: number
  duplicados?: number
  erros?: number
  lista_erros?: Array<{ linha?: number; descricao?: string; erro: string }>
  importacao_id?: string
}

function fmtBRL(v: number): string {
  return Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function parseValor(raw: unknown): number {
  if (typeof raw === 'number') return raw
  const s = String(raw ?? '').replace(/[R$\s.]/g, '').replace(',', '.')
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}

function parseData(raw: unknown): string {
  if (!raw) return ''
  if (raw instanceof Date) return raw.toISOString().split('T')[0]
  const s = String(raw).trim()
  // DD/MM/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    const [, d, mo, y] = m
    const ano = y.length === 2 ? `20${y}` : y
    return `${ano}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10)
  return ''
}

function cnpjLimpo(s: unknown): string {
  return String(s ?? '').replace(/\D/g, '')
}

async function baixarTemplate(tipo: Tipo) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(tipo === 'pagar' ? 'Contas a Pagar' : 'Contas a Receber')
  const pessoaCol = tipo === 'pagar' ? 'fornecedor_cnpj' : 'cliente_cnpj'
  ws.columns = [
    { header: 'descricao*', key: 'descricao', width: 40 },
    { header: 'valor*', key: 'valor', width: 12 },
    { header: 'data_vencimento*', key: 'data_vencimento', width: 16 },
    { header: 'data_competencia', key: 'data_competencia', width: 18 },
    { header: pessoaCol, key: 'cnpj', width: 22 },
    { header: 'categoria_codigo', key: 'categoria_codigo', width: 18 },
  ]
  ws.getRow(1).font = { bold: true }
  ws.addRow({
    descricao: tipo === 'pagar' ? 'Aluguel Maio 2026' : 'Mensalidade Consultoria · Maio',
    valor: 1500,
    data_vencimento: '15/05/2026',
    data_competencia: '15/05/2026',
    cnpj: '12.345.678/0001-90',
    categoria_codigo: '5.1.1.01',
  })
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `template_lancamentos_${tipo}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

async function parseXlsx(file: File): Promise<LinhaParse[]> {
  const buf = await file.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const ws = wb.worksheets[0]
  if (!ws) return []

  const header: string[] = []
  ws.getRow(1).eachCell((cell, col) => {
    header[col - 1] = String(cell.value ?? '').replace('*', '').trim().toLowerCase()
  })

  const linhas: LinhaParse[] = []
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return
    const raw: Record<string, unknown> = {}
    row.eachCell((cell, col) => {
      const key = header[col - 1]
      if (key) raw[key] = cell.value
    })
    const descricao = String(raw['descricao'] ?? '').trim()
    const valor = parseValor(raw['valor'])
    const data_vencimento = parseData(raw['data_vencimento'])
    const data_competencia = parseData(raw['data_competencia']) || data_vencimento
    const cnpj = cnpjLimpo(raw['fornecedor_cnpj'] ?? raw['cliente_cnpj'])
    const categoria_codigo = raw['categoria_codigo'] ? String(raw['categoria_codigo']).trim() : undefined

    const erros: string[] = []
    if (!descricao) erros.push('descrição vazia')
    if (valor <= 0) erros.push('valor inválido')
    if (!data_vencimento) erros.push('data_vencimento inválida')

    linhas.push({
      linha_num: rowNum,
      raw, descricao, valor, data_vencimento, data_competencia,
      cnpj: cnpj || undefined,
      categoria_codigo,
      valida: erros.length === 0,
      erros,
    })
  })
  return linhas
}

async function resolverPessoas(linhas: LinhaParse[], companyId: string, tipo: Tipo): Promise<void> {
  const cnpjs = Array.from(new Set(linhas.map((l) => l.cnpj).filter(Boolean) as string[]))
  if (cnpjs.length === 0) return

  if (tipo === 'pagar') {
    const { data } = await supabase
      .from('erp_fornecedores')
      .select('id, cpf_cnpj, nome_fantasia')
      .eq('company_id', companyId)
      .in('cpf_cnpj', cnpjs)
    const map = new Map<string, { id: string; nome: string | null }>()
    for (const f of (data ?? []) as Array<{ id: string; cpf_cnpj: string; nome_fantasia: string | null }>) {
      map.set(cnpjLimpo(f.cpf_cnpj), { id: f.id, nome: f.nome_fantasia })
    }
    for (const l of linhas) {
      if (l.cnpj) {
        const hit = map.get(l.cnpj)
        l.fornecedor_id = hit?.id ?? null
        l.pessoa_nome = hit?.nome ?? null
      }
    }
  } else {
    const { data } = await supabase
      .from('erp_clientes')
      .select('id, cnpj_cpf, cpf_cnpj, nome_fantasia')
      .eq('company_id', companyId)
    const map = new Map<string, { id: string; nome: string | null }>()
    for (const c of (data ?? []) as Array<{ id: string; cnpj_cpf: string | null; cpf_cnpj: string | null; nome_fantasia: string | null }>) {
      const key = cnpjLimpo(c.cnpj_cpf ?? c.cpf_cnpj)
      if (key) map.set(key, { id: c.id, nome: c.nome_fantasia })
    }
    for (const l of linhas) {
      if (l.cnpj) {
        const hit = map.get(l.cnpj)
        l.cliente_id = hit?.id ?? null
        l.pessoa_nome = hit?.nome ?? null
      }
    }
  }
}

export default function ImportLoteXlsxCard({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [tipo, setTipo] = useState<Tipo>('pagar')
  const [passo, setPasso] = useState<Passo>('tipo')
  const [linhas, setLinhas] = useState<LinhaParse[]>([])
  const [arquivoNome, setArquivoNome] = useState('')
  const [loading, setLoading] = useState(false)
  const [resultado, setResultado] = useState<ResultadoDispatch | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function handleFile(file: File) {
    setErro(null)
    setLoading(true)
    try {
      const parsed = await parseXlsx(file)
      if (parsed.length === 0) {
        setErro('Planilha vazia ou sem dados além do cabeçalho')
        setLoading(false)
        return
      }
      await resolverPessoas(parsed, companyId, tipo)
      setLinhas(parsed)
      setArquivoNome(file.name)
      setPasso('upload')
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }

  async function importar() {
    setErro(null)
    const validas = linhas.filter((l) => l.valida)
    if (validas.length === 0) { setErro('Nenhuma linha válida pra importar'); return }
    setLoading(true)

    const { data: userData } = await supabase.auth.getUser()
    const userId = userData?.user?.id ?? null

    // Contrato fn_import_financeiro_v3: por linha o 'tipo' = pagar|receber.
    // import_hash null → o RPC gera md5 deterministico de fallback
    // (company + tipo + valor + data_vencimento + descricao), suficiente
    // pra dedupar reimportacoes da mesma planilha. Quando a planilha
    // tiver numero_documento futuramente, podemos incluir no hash aqui.
    const records = validas.map((l) => ({
      company_id: companyId,
      tipo, // 'pagar' | 'receber' (mesmo pra todas as linhas neste card)
      valor_documento: l.valor,
      data_vencimento: l.data_vencimento,
      data_emissao: l.data_competencia || l.data_vencimento,
      descricao: l.descricao,
      categoria: l.categoria_codigo ?? null,
      nome_pessoa: l.pessoa_nome ?? null,
      import_hash: null,
    }))

    const { data, error } = await supabase.rpc('fn_import_universal_dispatch', {
      p_tipo: 'planilha_modelo_ps',
      p_company_id: companyId,
      p_user_id: userId,
      p_arquivo_nome: arquivoNome || `import_${tipo}.xlsx`,
      p_records: records,
    })
    setLoading(false)
    if (error) { setErro(error.message); return }
    setResultado(data as ResultadoDispatch)
    setPasso('resultado')
  }

  function resetar() {
    setLinhas([])
    setResultado(null)
    setErro(null)
    setPasso('tipo')
  }

  const validas = linhas.filter((l) => l.valida).length
  const invalidas = linhas.length - validas
  const totalValor = linhas.filter((l) => l.valida).reduce((s, l) => s + l.valor, 0)

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 10, color: '#C8941A', textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700, marginBottom: 4 }}>
            📥 Modo recomendado · em lote
          </div>
          <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 500, color: '#3D2314', margin: 0 }}>
            Importar Pagar/Receber em lote (XLSX)
          </h2>
          <p style={{ fontSize: 12, color: 'rgba(61,35,20,0.7)', margin: '4px 0 0' }}>
            Wizard 3 passos · template baixável · preview com validação · resolução CNPJ automática · até centenas de lançamentos
          </p>
        </div>
        {passo !== 'tipo' && (
          <button onClick={resetar} style={ghostBtn}>← Recomeçar</button>
        )}
      </div>

      {passo === 'tipo' && (
        <div>
          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, marginBottom: 8 }}>
            1. Tipo de lançamento
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 16 }}>
            <TipoCard ativo={tipo === 'pagar'} onClick={() => setTipo('pagar')} icone="📋" nome="Despesas a Pagar" cor="#A32D2D" />
            <TipoCard ativo={tipo === 'receber'} onClick={() => setTipo('receber')} icone="💰" nome="Receitas a Receber" cor="#3B6D11" />
          </div>

          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, marginBottom: 8 }}>
            2. Template
          </div>
          <button onClick={() => baixarTemplate(tipo)} style={primaryBtn(false)}>
            📥 Baixar template XLSX modelo
          </button>
          <p style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 6 }}>
            Preencha o template com seus dados. Campos com * são obrigatórios.
            Colunas: descrição · valor · data_vencimento · data_competencia · {tipo === 'pagar' ? 'fornecedor_cnpj' : 'cliente_cnpj'} · categoria_codigo.
          </p>

          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, marginTop: 18, marginBottom: 8 }}>
            3. Upload preenchido
          </div>
          <UploadArea onFile={handleFile} loading={loading} />
        </div>
      )}

      {passo === 'upload' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
            <Stat label="Linhas válidas" valor={String(validas)} cor="#3B6D11" />
            <Stat label="Com erro" valor={String(invalidas)} cor={invalidas > 0 ? '#A32D2D' : 'rgba(61,35,20,0.5)'} />
            <Stat label="Total a importar" valor={`R$ ${fmtBRL(totalValor)}`} cor="#C8941A" />
          </div>

          <div style={{ border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, overflow: 'auto', maxHeight: 400, marginBottom: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'rgba(61,35,20,0.04)', position: 'sticky', top: 0 }}>
                  <th style={th}>Linha</th>
                  <th style={th}>Descrição</th>
                  <th style={{ ...th, textAlign: 'right' }}>Valor</th>
                  <th style={th}>Vencimento</th>
                  <th style={th}>{tipo === 'pagar' ? 'Fornecedor' : 'Cliente'}</th>
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {linhas.slice(0, 100).map((l) => {
                  const pessoaId = tipo === 'pagar' ? l.fornecedor_id : l.cliente_id
                  const pessoaInfo = l.cnpj
                    ? (pessoaId ? `CNPJ ${l.cnpj}` : `⚠ CNPJ ${l.cnpj} não encontrado`)
                    : '—'
                  return (
                    <tr key={l.linha_num} style={{ borderTop: '0.5px solid rgba(61,35,20,0.06)', background: l.valida ? 'transparent' : 'rgba(252,235,235,0.5)' }}>
                      <td style={td}>{l.linha_num}</td>
                      <td style={td}>{l.descricao || '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }}>R$ {fmtBRL(l.valor)}</td>
                      <td style={td}>{l.data_vencimento || '—'}</td>
                      <td style={{ ...td, fontSize: 11, color: pessoaId ? 'rgba(61,35,20,0.65)' : '#BA7517' }}>{pessoaInfo}</td>
                      <td style={td}>
                        {l.valida ? (
                          <span style={{ color: '#3B6D11', fontSize: 11, fontWeight: 600 }}>✅ OK</span>
                        ) : (
                          <span style={{ color: '#A32D2D', fontSize: 11 }}>❌ {l.erros.join(', ')}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {linhas.length > 100 && (
              <div style={{ padding: '8px 12px', fontSize: 11, color: 'rgba(61,35,20,0.55)', background: '#FAF7F2' }}>
                Mostrando 100 de {linhas.length} linhas · todas serão importadas
              </div>
            )}
          </div>

          {erro && <div style={erroBox}>{erro}</div>}

          <button onClick={importar} disabled={loading || validas === 0} style={primaryBtn(loading)}>
            {loading ? 'Importando…' : `🚀 Importar ${validas} ${validas === 1 ? 'lançamento' : 'lançamentos'} ${invalidas > 0 ? '(válidos apenas)' : ''}`}
          </button>
        </div>
      )}

      {passo === 'resultado' && resultado && (() => {
        const inseridos = resultado.inseridos ?? 0
        const duplicados = resultado.duplicados ?? 0
        const erros = resultado.erros ?? 0
        const total = resultado.total ?? (inseridos + duplicados + erros)
        const valorInseridos = totalValor * (total > 0 ? inseridos / total : 0)
        const headerBg = erros > 0 ? '#FAEEDA' : '#EAF3DE'
        const headerBorder = erros > 0 ? '#BA7517' : '#3B6D11'
        return (
          <div>
            <div style={{ background: headerBg, border: `1px solid ${headerBorder}`, borderRadius: 8, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#3D2314', marginBottom: 8 }}>
                {erros === 0 ? '✅ Tudo importado!' : '⚠ Importado com erros'}
              </div>
              <div style={{ fontSize: 13, color: '#3D2314', marginBottom: 4 }}>
                ✅ <strong>{inseridos}</strong> criado{inseridos === 1 ? '' : 's'}
                {inseridos > 0 && ` · R$ ${fmtBRL(valorInseridos)}`}
              </div>
              {duplicados > 0 && (
                <div style={{ fontSize: 13, color: 'rgba(61,35,20,0.7)', marginBottom: 4 }}>
                  🔁 <strong>{duplicados}</strong> já existia{duplicados === 1 ? '' : 'm'} (pulado{duplicados === 1 ? '' : 's'} pela idempotência)
                </div>
              )}
              {erros > 0 && (
                <div style={{ fontSize: 13, color: '#A32D2D' }}>
                  ❌ <strong>{erros}</strong> falhar{erros === 1 ? 'am' : 'am'}
                </div>
              )}
              {resultado.importacao_id && (
                <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 6, fontFamily: 'monospace' }}>
                  trilha: {resultado.importacao_id.slice(0, 8)}…
                </div>
              )}
            </div>

            {resultado.lista_erros && resultado.lista_erros.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, marginBottom: 6 }}>
                  Erros detalhados
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {resultado.lista_erros.map((e, i) => (
                    <div key={i} style={{ background: '#FCEBEB', padding: '6px 10px', borderRadius: 4, fontSize: 12, color: '#A32D2D' }}>
                      {e.linha != null ? `Linha ${e.linha}: ` : ''}{e.descricao ? `"${e.descricao}" — ` : ''}{e.erro}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => router.push(`/dashboard/financeiro/${tipo}`)} style={primaryBtn(false)}>
                Ver {tipo === 'pagar' ? 'despesas' : 'receitas'}
              </button>
              <button onClick={resetar} style={ghostBtn}>Importar outra planilha</button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function TipoCard({ ativo, onClick, icone, nome, cor }: { ativo: boolean; onClick: () => void; icone: string; nome: string; cor: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: ativo ? '#FFF8E7' : '#FFFFFF',
        border: `2px solid ${ativo ? cor : 'rgba(61,35,20,0.12)'}`,
        borderRadius: 8, padding: '14px 16px',
        cursor: 'pointer', textAlign: 'left', font: 'inherit',
        display: 'flex', alignItems: 'center', gap: 10,
      }}
    >
      <span style={{ fontSize: 24 }}>{icone}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#3D2314' }}>{nome}</span>
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
      <div style={{ fontSize: 32, marginBottom: 8 }}>{loading ? '⏳' : '📤'}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#3D2314' }}>
        {loading ? 'Lendo planilha…' : 'Arraste o XLSX preenchido ou clique para selecionar'}
      </div>
      <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 4 }}>
        Aceita .xlsx e .xls
      </div>
    </label>
  )
}

function Stat({ label, valor, cor }: { label: string; valor: string; cor: string }) {
  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderLeft: `3px solid ${cor}`, borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: cor, marginTop: 2 }}>{valor}</div>
    </div>
  )
}

const card: React.CSSProperties = {
  background: 'linear-gradient(135deg, #FFF8E7 0%, #FFFFFF 100%)',
  border: '2px solid #C8941A',
  borderRadius: 12, padding: '20px 24px', marginBottom: 20,
  boxShadow: '0 4px 12px rgba(200,148,26,0.15)',
}
const th: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', fontSize: 10,
  color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase',
  letterSpacing: 0.6, fontWeight: 600, whiteSpace: 'nowrap',
}
const td: React.CSSProperties = { padding: '6px 10px', color: '#3D2314' }
const erroBox: React.CSSProperties = {
  background: '#FCEBEB', color: '#A32D2D',
  padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 8,
}
function primaryBtn(loading: boolean): React.CSSProperties {
  return { background: loading ? 'rgba(200,148,26,0.5)' : '#C8941A', color: '#3D2314', border: 'none', padding: '10px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }
}
const ghostBtn: React.CSSProperties = {
  background: 'transparent', color: '#3D2314',
  border: '0.5px solid rgba(61,35,20,0.2)',
  padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
}
