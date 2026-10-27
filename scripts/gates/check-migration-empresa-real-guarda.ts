// Gate (24/10, gilberto-desenv, msg ba5e5e8a): migration que grava dado de uma empresa REAL (uuid fixo declarado como
// `v_x constant uuid := '…'`) pula quando a empresa não existe no banco. As vagas do banco de testes têm o schema sem os
// dados das empresas reais: a 20261023141505 (papéis do Hub na FC Pisos) quebrava o `db push` da vaga 1 com FK
// org_unidade_company_id_fkey e a aceitação da main abortava (#812/#813). Regra: com INSERT/UPDATE/DELETE e uuid de
// empresa fixo (fora das DEMO b0700000-… e da org fixa c830f980-…), o arquivo tem `FROM companies WHERE id = v_x`.
// A partir da 20261023141505 (as anteriores já passaram no db push das vagas). Sem rede, banco ou variável.
import { readdirSync, readFileSync } from 'node:fs'

const DIR = 'supabase/migrations'
const DESDE = '20261023141505'
const DEMO = /^(b0700000-|00000000-0000-|c830f980-)/

export function faltaGuarda(sql: string): string[] {
  const semComentario = sql.replace(/--[^\n]*/g, '')
  if (!/\b(INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM)\b/i.test(semComentario)) return []
  const falta: string[] = []
  for (const m of semComentario.matchAll(/\b(v_\w+)\s+constant\s+uuid\s*:=\s*'([0-9a-f-]{36})'/gi)) {
    const [, v, id] = m
    if (DEMO.test(id)) continue
    const guarda = new RegExp(`FROM\\s+(public\\.)?companies\\s+WHERE\\s+id\\s*=\\s*${v}\\b`, 'i')
    if (!guarda.test(semComentario)) falta.push(`${v} = ${id}`)
  }
  return falta
}

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── regra pura ──
const sem = "DO $m$ DECLARE v_fc constant uuid := 'b202b50f-37cb-462e-accf-126869de49f0'; BEGIN INSERT INTO org_unidade (company_id) VALUES (v_fc); END $m$;"
const com = sem.replace('BEGIN ', 'BEGIN IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_fc) THEN RETURN; END IF; ')
ok(faltaGuarda(sem).length === 1, 'INSERT com empresa real sem guarda reprova')
ok(faltaGuarda(com).length === 0, 'com a guarda "FROM companies WHERE id = v_fc" passa')
ok(faltaGuarda(sem.replace('b202b50f-37cb-462e-accf-126869de49f0', 'b0700000-0000-4000-a000-000000000006')).length === 0, 'empresa DEMO não exige guarda')
ok(faltaGuarda("DO $m$ DECLARE v_fc constant uuid := 'b202b50f-37cb-462e-accf-126869de49f0'; BEGIN PERFORM 1; END $m$;").length === 0, 'sem escrita não exige guarda')

// ── migrations ──
const arquivos = readdirSync(DIR).filter((f) => f.endsWith('.sql') && f.slice(0, 14) >= DESDE).sort()
for (const f of arquivos) {
  const falta = faltaGuarda(readFileSync(`${DIR}/${f}`, 'utf8'))
  if (falta.length) ok(false, `${f}: grava dado de empresa real sem pular quando ela não existe (${falta.join(', ')}) — acrescente IF NOT EXISTS (SELECT 1 FROM companies WHERE id = …) THEN RETURN`)
}
ok(arquivos.includes('20261023141505_hub_aplicar_papeis_fc_pisos.sql'), 'a 20261023141505 (FC Pisos) está no escopo do gate')

if (falhas) { console.error(`\ncheck-migration-empresa-real-guarda: ${falhas} falha(s)`); process.exit(1) }
console.log(`\ncheck-migration-empresa-real-guarda: ok (${arquivos.length} migrations)`)
