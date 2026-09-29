// Gate (CEO 29/09 · virada FCR): na importação da migração financeira, título que já existe no sistema (mesmo
// tipo + pessoa + valor + vencimento) aparece como "já existe" e NÃO é importado. Roda no build. Sem rede.
import { readFileSync } from 'node:fs'
import { marcarJaExistentes, normNome, type TituloExistente, type LinhaPlanilha } from '../src/lib/financeiro/importDuplicidade'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const idx = (s: Set<number>) => Array.from(s).sort((a, b) => a - b)

// o que a FCR já tem (formato de erp_receber): Car House 306.000 em 30/06/2027; Somave 3 parcelas no mesmo dia
const sistema: TituloExistente[] = [
  { tipo: 'receber', nome: 'CAR HOUSE VEICULOS LTDA', valor: 306000, vencimento: '2027-06-30' },
  { tipo: 'receber', nome: 'SOMAVE S.A.', valor: 1500, vencimento: '2026-09-12' },
  { tipo: 'receber', nome: 'SOMAVE S.A.', valor: 1500, vencimento: '2026-09-12' },
]

ok(normNome('Car House Veículos Ltda.') === normNome('CAR HOUSE VEICULOS LTDA'), 'nome: maiúscula, acento e pontuação não importam')
ok(normNome('Somave S/A') === normNome('SOMAVE SA') && normNome('SOMAVE SA') === normNome('somave s.a.'), 'nome: S/A, S.A. e SA são iguais')

const l = (tipo: string, nome: string, valor: number | null, venc: string | null): LinhaPlanilha => ({ tipo, nome_pessoa: nome, valor, vencimento: venc })
const r1 = marcarJaExistentes([
  l('receber', 'Car House Veículos Ltda.', 306000, '2027-06-30'),   // 0: já existe
  l('receber', 'CAR HOUSE VEICULOS LTDA', 306000.01, '2027-06-30'), // 1: 1 centavo a mais ⇒ novo
  l('pagar', 'CAR HOUSE VEICULOS LTDA', 306000, '2027-06-30'),      // 2: outro tipo ⇒ novo
  l('receber', 'CAR HOUSE VEICULOS LTDA', 306000, '2027-07-30'),    // 3: outro vencimento ⇒ novo
  l('receber', 'OUTRO CLIENTE', 306000, '2027-06-30'),              // 4: outra pessoa ⇒ novo
], sistema)
ok(JSON.stringify(idx(r1)) === '[0]', 'só a linha igual em tipo+pessoa+valor+vencimento é "já existe"')

// multiconjunto: 2 iguais no sistema, 3 na planilha ⇒ 2 "já existe" + 1 novo (parcelas legítimas não somem)
const r2 = marcarJaExistentes([
  l('receber', 'Somave S/A', 1500, '2026-09-12'),
  l('receber', 'SOMAVE SA', 1500, '2026-09-12'),
  l('receber', 'somave s.a.', 1500, '2026-09-12'),
], sistema)
ok(r2.size === 2, 'Somave: 2 no sistema, 3 na planilha ⇒ 2 já existem, 1 entra')

// a mesma planilha duas vezes ⇒ na 2ª tudo já existe
const planilha = [l('receber', 'X', 10, '2026-10-01'), l('pagar', 'Y', 20, '2026-10-02')]
const jaImportado: TituloExistente[] = planilha.map((p) => ({ tipo: p.tipo as 'pagar' | 'receber', nome: p.nome_pessoa, valor: p.valor!, vencimento: p.vencimento! }))
ok(marcarJaExistentes(planilha, jaImportado).size === 2, 'reimportar a mesma planilha não duplica nada')
ok(marcarJaExistentes([l('tipo errado', 'X', 10, '2026-10-01'), l('receber', 'X', null, '2026-10-01'), l('receber', 'X', 10, null)], jaImportado).size === 0,
  'linha inválida nunca casa (fica como erro, não como "já existe")')

// a tela usa a regra: não envia "já existe" e bloqueia se a conferência falhar
const card = readFileSync('src/components/financeiro/ImportMigracaoFinanceiraCard.tsx', 'utf8')
ok(card.includes("l.nivel !== 'erro' && !l.exemplo && !l.jaExiste"), 'importar() não envia linhas "já existe"')
ok(/existentes === null\) \{\s*setParseErro/.test(card), 'conferência que falha bloqueia a importação')
ok(card.includes(".is('deleted_at', null)") && card.includes("'cancelado'"), 'compara só com títulos ativos (não excluídos, não cancelados)')

if (falhas) { console.error(`\ncheck-importador-ja-existe: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-importador-ja-existe: ok')
