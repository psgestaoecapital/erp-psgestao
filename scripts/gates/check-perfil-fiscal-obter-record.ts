// Gate #6698: fn_veic_perfil_fiscal_obter precisa atribuir o record v_apr em qualquer caminho
// (sql_state 55000 "tuple structure of a not-yet-assigned record is indeterminate" com rascunho existente).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(process.cwd(), 'supabase/migrations')
const arqs = readdirSync(dir)
  .filter((f) => /^\d{14}_.*\.sql$/.test(f))
  .map((f) => ({ f, s: readFileSync(join(dir, f), 'utf8') }))
  .filter((x) => /CREATE OR REPLACE FUNCTION public\.fn_veic_perfil_fiscal_obter\(/.test(x.s))
  .sort((a, b) => a.f.localeCompare(b.f))
const ultima = arqs[arqs.length - 1]
if (!ultima) throw new Error('check-perfil-fiscal-obter-record: migration da função não encontrada')
const s = ultima.s
const iniRecord = s.search(/SELECT \* INTO v_apr FROM veic_perfil_fiscal WHERE false;/)
const iniIf = s.search(/IF FOUND THEN/)
if (iniRecord < 0 || iniRecord > iniIf) {
  throw new Error(`check-perfil-fiscal-obter-record: ${ultima.f} deve atribuir v_apr (WHERE false) antes do IF FOUND`)
}
console.log('check-perfil-fiscal-obter-record: ok')
