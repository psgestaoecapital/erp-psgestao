// Gate (#776): empresa isenta de IE grava a convenção "ISENTO" em companies.inscricao_estadual.
// Para a NF-e, o EMITENTE com IE vazia OU "ISENTO" (qualquer caixa/espaço) é tratado como IE AUSENTE —
// buildNFeRequest recusa com "Inscricao Estadual obrigatoria pra NFe". IE numérica passa (não recusa por IE).
// Roda no build, sem rede. Espelha a MESMA regra do nfe-builder e confere que o builder continua com ela.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// A MESMA regra do emitente em src/lib/fiscal/nfe-builder.ts (IE ausente para NF-e):
//   !emp.inscricao_estadual || emp.inscricao_estadual.trim().toUpperCase() === 'ISENTO'
const ieEmitenteAusenteParaNfe = (ie: string | null | undefined) =>
  !ie || String(ie).trim().toUpperCase() === 'ISENTO'

// ISENTO em qualquer caixa/espaço → IE ausente (NF-e recusada)
ok(ieEmitenteAusenteParaNfe('ISENTO'), 'ISENTO → IE ausente p/ NF-e')
ok(ieEmitenteAusenteParaNfe('isento') && ieEmitenteAusenteParaNfe(' Isento ') && ieEmitenteAusenteParaNfe('ISENTO\t'),
  'ISENTO com caixa/espaços diferentes → IE ausente')
// IE vazia/nula → ausente (caso antigo)
ok(ieEmitenteAusenteParaNfe('') && ieEmitenteAusenteParaNfe(null) && ieEmitenteAusenteParaNfe(undefined),
  'IE vazia/nula → IE ausente (recusa)')
// IE numérica → presente (passa; NF-e não recusa por IE)
ok(!ieEmitenteAusenteParaNfe('123') && !ieEmitenteAusenteParaNfe('112233445'),
  'IE numérica → presente (passa)')

// O builder tem que carregar a MESMA regra e a mesma recusa (sincroniza o gate com a rota).
const builder = readFileSync('src/lib/fiscal/nfe-builder.ts', 'utf8')
ok(/toUpperCase\(\)\s*===\s*'ISENTO'/.test(builder), 'nfe-builder trata "ISENTO" como IE ausente (trim + toUpperCase)')
ok(/!emp\.inscricao_estadual/.test(builder), 'nfe-builder também recusa IE vazia do emitente')
ok(/Inscricao Estadual obrigatoria/.test(builder), 'nfe-builder recusa NF-e com "Inscricao Estadual obrigatoria"')

if (falhas) { console.error(`\ncheck-nfe-ie-isento: ${falhas} falha(s) — build bloqueado.`); process.exit(1) }
console.log('\ncheck-nfe-ie-isento: ok')
