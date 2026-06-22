// Normaliza um array de linhas {header: valor} para o contrato do migrador de pacientes.
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

const ALIASES: Record<string, string[]> = {
  nome:        ['nome', 'paciente', 'nome do paciente', 'nome completo', 'cliente'],
  cpf:         ['cpf', 'cpf paciente', 'documento', 'cpf/cnpj'],
  nascimento:  ['nascimento', 'data nascimento', 'data de nascimento', 'dt nascimento', 'dt nasc', 'nasc'],
  telefone:    ['telefone', 'fone', 'tel', 'telefone fixo'],
  celular:     ['celular', 'cel', 'whatsapp', 'whats', 'telefone celular'],
  email:       ['email', 'e-mail', 'e mail'],
  convenio:    ['convenio', 'plano', 'convenio/plano', 'operadora'],
  carteirinha: ['carteirinha', 'matricula', 'numero carteirinha', 'cartao'],
  sexo:        ['sexo', 'genero'],
  observacao:  ['observacao', 'obs', 'observacoes', 'anotacoes'],
}

export function odontoDetectColumns(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const [campo, aliases] of Object.entries(ALIASES)) {
    const found = headers.find((h) => aliases.includes(norm(h)))
    if (found) map[campo] = found
  }
  return map
}

function toIsoDate(v: unknown): string | null {
  if (!v) return null
  const s = String(v).trim()
  let m = s.match(/^(\d{2})[/\-.](\d{2})[/\-.](\d{4})$/) // dd/mm/aaaa
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/) // aaaa-mm-dd
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

export interface OdontoParsedRecord {
  nome: string
  cpf: string
  nascimento: string | null
  telefone: string | null
  celular: string | null
  email: string | null
  convenio: string | null
  carteirinha: string | null
  sexo: string | null
  observacao: string | null
}

export function odontoParseRows(rows: Record<string, unknown>[]): {
  records: OdontoParsedRecord[]
  columns: Record<string, string>
} {
  const headers = rows.length ? Object.keys(rows[0]) : []
  const cols = odontoDetectColumns(headers)
  const get = (row: Record<string, unknown>, campo: string) =>
    cols[campo] ? row[cols[campo]] : undefined
  const records = rows
    .map<OdontoParsedRecord>((row) => ({
      nome: (get(row, 'nome') ?? '').toString().trim(),
      cpf: (get(row, 'cpf') ?? '').toString(),
      nascimento: toIsoDate(get(row, 'nascimento')),
      telefone: ((get(row, 'telefone') ?? '').toString().trim() || null),
      celular: ((get(row, 'celular') ?? '').toString().trim() || null),
      email: ((get(row, 'email') ?? '').toString().trim() || null),
      convenio: ((get(row, 'convenio') ?? '').toString().trim() || null),
      carteirinha: ((get(row, 'carteirinha') ?? '').toString().trim() || null),
      sexo: ((get(row, 'sexo') ?? '').toString().trim() || null),
      observacao: ((get(row, 'observacao') ?? '').toString().trim() || null),
    }))
    .filter((r) => r.nome)
  return { records, columns: cols }
}
