// Gate (#3842, Karol · Pausas térmicas › Conferência) · prova do fluxo "anexar comprovante assinado do ajuste".
// Pedido do revisor na consolidação das PRs duplicadas (#3398/#3403 fechadas, #3407 mantida):
//   (1) escolher UMA implementação; (2) LGPD: nada de link público e sem CPF no caminho do arquivo; (3) prova do wiring.
// Este gate é ESTÁTICO (sem rede/banco): confere que a camada de comprovante existe e está ligada à tela com as
// propriedades de LGPD exigidas. Se a migration for renomeada pela fila, o gate acha pelo conteúdo, não pelo nome.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const erro = (m: string) => { falhas++; console.error(`✗ ${m}`) }
const ok = (m: string) => console.log(`✓ ${m}`)

// 1) Migration da camada de comprovante (achada pelo conteúdo — nome pode mudar na renumeração da fila)
const MIG_DIR = join('supabase', 'migrations')
const migs = existsSync(MIG_DIR) ? readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')) : []
const migFile = migs.find((f) => readFileSync(join(MIG_DIR, f), 'utf8').includes('nr36_releitura_anexo'))
if (!migFile) {
  erro('migration da camada de comprovante (tabela nr36_releitura_anexo) não encontrada em supabase/migrations')
} else {
  const sql = readFileSync(join(MIG_DIR, migFile), 'utf8')
  ok(`migration do comprovante: ${migFile}`)
  const checa = (cond: boolean, m: string) => cond ? ok(`  ${m}`) : erro(`  ${m}`)
  checa(/create\s+table\s+(if\s+not\s+exists\s+)?public\.nr36_releitura_anexo/i.test(sql), 'cria tabela nr36_releitura_anexo')
  checa(/alter\s+table\s+public\.nr36_releitura_anexo\s+enable\s+row\s+level\s+security/i.test(sql), 'RLS ligada na tabela')
  checa(/revoke\s+all\s+on\s+public\.nr36_releitura_anexo[\s\S]*?\banon\b/i.test(sql), 'REVOKE ... FROM anon na tabela')
  checa(/create\s+or\s+replace\s+function\s+public\.fn_nr36_releitura_anexar\b/i.test(sql), 'função fn_nr36_releitura_anexar (INSERT)')
  checa(/create\s+or\s+replace\s+function\s+public\.fn_nr36_releitura_anexos_listar\b/i.test(sql), 'função fn_nr36_releitura_anexos_listar (SELECT)')
  // guarda de empresa + autoria: INSERT só com acesso à empresa e autor por auth.uid() (sem forjar identidade)
  checa(/get_user_company_ids\(\)/.test(sql) && /auth\.uid\(\)/.test(sql), 'guarda de empresa (get_user_company_ids) + autoria por auth.uid()')
  checa(/revoke\s+all\s+on\s+function\s+public\.fn_nr36_releitura_anexar[\s\S]*?\banon\b/i.test(sql), 'REVOKE anon na função de anexar')
}

// 2) Tela liga as RPCs e respeita LGPD (link assinado, sem CPF no caminho do objeto)
const PAGE = join('src', 'app', 'dashboard', 'compliance', 'pausas-tecnicas', 'page.tsx')
if (!existsSync(PAGE)) {
  erro(`tela não encontrada: ${PAGE}`)
} else {
  const page = readFileSync(PAGE, 'utf8')
  const checa = (cond: boolean, m: string) => cond ? ok(`  ${m}`) : erro(`  ${m}`)
  checa(page.includes("'fn_nr36_releitura_anexar'"), 'tela chama fn_nr36_releitura_anexar')
  checa(page.includes("'fn_nr36_releitura_anexos_listar'"), 'tela chama fn_nr36_releitura_anexos_listar')
  checa(page.includes('createSignedUrl'), 'exibição por URL assinada (createSignedUrl)')
  // o bloco do comprovante usa getPublicUrl? (link público sem login = vazamento LGPD)
  const blocoInicio = page.indexOf('function ComprovanteConferencia')
  const bloco = blocoInicio >= 0 ? page.slice(blocoInicio, blocoInicio + 3500) : page
  checa(!/getPublicUrl/.test(bloco), 'não usa getPublicUrl no comprovante (sem link público)')
  // o caminho do objeto no Storage NÃO pode interpolar o cpf (dado pessoal no nome do arquivo)
  const pathLinha = bloco.split('\n').find((l) => l.includes('comprovante/') && l.includes('const path'))
  checa(!!pathLinha && !/\$\{cpf\}/.test(pathLinha), 'caminho do comprovante no Storage sem CPF (LGPD)')
}

if (falhas) { console.error(`\n#3842: ${falhas} verificação(ões) do comprovante falharam.`); process.exit(1) }
console.log('✓ #3842: camada de comprovante da Conferência presente, ligada à tela e sem vazamento (LGPD)')
