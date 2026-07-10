// Parser da folha "Encargos da Empresa" do Domínio Sistemas (.xls/.xlsx).
// Layout de índices FIXOS (validado 10/07 contra rodapé R$800.795,47, 184 func):
//   codigo=0, nome=2, remuneracao=8, fgts=14, fgts_resc=17, inss_emp=20,
//   inss_terc=23, rat=24, deducoes=26, pis=29, total=32.
// Linha de DADO: col[0] é NÚMERO (matrícula). Grupos/cabeçalhos/rodapé/licença
// não têm número em col[0] → ignorados naturalmente.

export type FolhaVerba = { codigo_verba: string; descricao: string; valor: number; tipo: 'provento' | 'encargo' | 'desconto' }
export type FolhaFuncionario = {
  matricula: number
  nome: string
  remuneracao: number
  total_geral: number
  verbas: FolhaVerba[]
  raw: Record<string, unknown>
}
export type FolhaParse = {
  competencia: string | null   // YYYY-MM-01
  cnpj: string | null
  funcionarios: FolhaFuncionario[]
  total_geral: number
}

const VERBAS: { col: number; codigo: string; descricao: string; tipo: FolhaVerba['tipo'] }[] = [
  { col: 8, codigo: 'REMUNERACAO', descricao: 'Remuneração', tipo: 'provento' },
  { col: 14, codigo: 'FGTS', descricao: 'FGTS', tipo: 'encargo' },
  { col: 17, codigo: 'FGTS_RESC', descricao: 'FGTS Rescisório', tipo: 'encargo' },
  { col: 20, codigo: 'INSS_EMP', descricao: 'INSS Empresa', tipo: 'encargo' },
  { col: 23, codigo: 'INSS_TERC', descricao: 'INSS Terceiros', tipo: 'encargo' },
  { col: 24, codigo: 'RAT', descricao: 'RAT', tipo: 'encargo' },
  { col: 26, codigo: 'DEDUCOES', descricao: 'Deduções', tipo: 'desconto' },
  { col: 29, codigo: 'PIS', descricao: 'PIS', tipo: 'encargo' },
]
const COL_NOME = 2
const COL_TOTAL = 32

function num(v: unknown): number {
  if (typeof v === 'number') return isFinite(v) ? v : 0
  const s = String(v ?? '').trim()
  if (!s || s === '-') return 0
  let x = s.replace(/[R$\s]/g, '')
  if (x.includes(',') && x.includes('.')) x = x.replace(/\./g, '').replace(',', '.')
  else if (x.includes(',')) x = x.replace(',', '.')
  const n = parseFloat(x)
  return isNaN(n) ? 0 : n
}
function ehMatricula(v: unknown): boolean {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0
  const s = String(v ?? '').trim()
  return /^\d+$/.test(s)
}

// rows = array-of-arrays (SheetJS sheet_to_json { header: 1 }).
export function parseFolhaDominio(rows: unknown[][]): FolhaParse {
  let competencia: string | null = null
  let cnpj: string | null = null
  // metadados no topo (primeiras ~8 linhas): competência "MM/YYYY" e CNPJ (14 dígitos)
  for (const r of rows.slice(0, 8)) {
    for (const cell of r) {
      const s = String(cell ?? '')
      if (!competencia) {
        const m = s.match(/(\d{2})\/(\d{4})/)
        if (m) competencia = `${m[2]}-${m[1]}-01`
      }
      if (!cnpj) {
        const c = s.replace(/\D/g, '')
        if (c.length === 14) cnpj = c
      }
    }
  }

  const funcionarios: FolhaFuncionario[] = []
  for (const r of rows) {
    if (!Array.isArray(r) || !ehMatricula(r[0])) continue
    const matricula = Number(String(r[0]).replace(/\D/g, ''))
    const nome = String(r[COL_NOME] ?? '').trim()
    if (!nome) continue
    const verbas: FolhaVerba[] = []
    let remuneracao = 0
    for (const v of VERBAS) {
      const valor = num(r[v.col])
      if (v.codigo === 'REMUNERACAO') remuneracao = valor
      if (valor !== 0) verbas.push({ codigo_verba: v.codigo, descricao: v.descricao, valor, tipo: v.tipo })
    }
    const total_geral = num(r[COL_TOTAL])
    funcionarios.push({ matricula, nome, remuneracao, total_geral, verbas, raw: { linha: r } })
  }

  const total_geral = funcionarios.reduce((s, f) => s + f.total_geral, 0)
  return { competencia, cnpj, funcionarios, total_geral: Number(total_geral.toFixed(2)) }
}
