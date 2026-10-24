// Gate (24/10, gilberto-desenv, msg ba5e5e8a): migration que grava numa EMPRESA REAL fixa (uuid constante, fora das DEMO
// b0700000-…) precisa sair sem gravar quando a empresa não existe. O banco de testes aplica os arquivos do zero e não tem
// as empresas de cliente: a 20261023141505 (papéis do Hub na FC Pisos) parava o `db push` da vaga 1 com FK
// org_unidade_company_id_fkey e a aceitação da main abortava em segundos (#812-#814). Sem rede, banco ou variável.
import { readdirSync, readFileSync } from 'node:fs'

const DIR = 'supabase/migrations'
const DESDE = '20261020'

const erros: string[] = []
let conferidas = 0
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.sql') && x >= DESDE).sort()) {
  const s = readFileSync(`${DIR}/${f}`, 'utf8')
  const re = /(\w+)\s+constant\s+uuid\s*:=\s*'([0-9a-f-]{36})'/gi
  for (let m; (m = re.exec(s)); ) {
    const [, v, id] = m
    if (id.startsWith('b0700000')) continue
    const usaEmpresa = new RegExp(`company_id\\s*=\\s*${v}\\b|\\(\\s*${v}\\s*,`).test(s)
    if (!usaEmpresa) continue
    conferidas++
    const guarda = new RegExp(`NOT\\s+EXISTS\\s*\\(\\s*SELECT\\s+1\\s+FROM\\s+(public\\.)?companies\\s+WHERE\\s+id\\s*=\\s*${v}\\b[\\s\\S]{0,200}?RETURN`, 'i')
    if (!guarda.test(s)) erros.push(`${f}: grava na empresa fixa ${id} (${v}) sem sair quando ela não existe (IF NOT EXISTS (SELECT 1 FROM companies WHERE id = ${v}) THEN … RETURN)`)
  }
}

if (!conferidas) erros.push('nenhuma migration com empresa fixa encontrada: o gate deixou de enxergar a 20261023141505')
if (erros.length) { for (const e of erros) console.error('✗ ' + e); console.error(`\n${erros.length} falha(s)`); process.exit(1) }
console.log(`✓ ${conferidas} migration(s) com empresa real fixa: todas saem sem gravar quando a empresa não existe`)
