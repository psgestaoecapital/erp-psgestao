/**
 * Gate de build · #135 (Triches): no atendimento centralizado (sem tablet) a oficina aprova o orçamento na própria
 * Ordem de Serviço. Regra única em src/lib/oficina/aprovarNaOS.ts; a ficha usa a mesma RPC da tela de Aprovação
 * e o botão tem o "?" (RD-95) com a chave criada por migration.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { itensPendentesOS, podeAprovarNaOS } from '../../src/lib/oficina/aprovarNaOS'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

const itens = [
  { id: 'a', status_item: 'pendente', preco: 100 },
  { id: 'b', status_item: 'aprovado', preco: 50 },
  { id: 'c', status_item: 'recusado', preco: 30 },
  { id: 'd', status_item: null, preco: null },
  { id: null, status_item: 'pendente', preco: 10 },   // linha ainda não gravada
]
ok(itensPendentesOS(itens).map((i) => i.id).join(',') === 'a,d', 'só os itens gravados e sem decisão entram na aprovação')
ok(itensPendentesOS([]).length === 0, 'OS sem itens não tem o que aprovar')

ok(podeAprovarNaOS('centralizado', true, 'aguardando_aprovacao', 2), 'centralizado + pode lançar valor + aguardando aprovação → mostra o botão')
ok(podeAprovarNaOS('centralizado', true, 'aberta', 1), 'centralizado + OS recebida → mostra o botão')
ok(!podeAprovarNaOS('tablet', true, 'aguardando_aprovacao', 2), 'modelo com tablet → não mostra (aprovação segue na tela própria)')
ok(!podeAprovarNaOS('centralizado', false, 'aguardando_aprovacao', 2), 'perfil sem permissão de valor (mecânico/operador) → não mostra')
ok(!podeAprovarNaOS('centralizado', true, 'em_execucao', 2), 'OS já em execução → não mostra')
ok(!podeAprovarNaOS('centralizado', true, 'aprovada', 2), 'OS já aprovada → não mostra')
ok(!podeAprovarNaOS('centralizado', true, 'aguardando_aprovacao', 0), 'sem item pendente → não mostra')

const card = readFileSync('src/components/comum/OrdemServicoCard.tsx', 'utf8')
ok(card.includes("supabase.rpc('fn_oficina_orcamento_registrar'"), 'a ficha usa a mesma RPC da tela de Aprovação (sem regra paralela)')
ok(card.includes('itensPendentesOS(itensDiag)') && card.includes('podeAprovarNaOS('), 'a ficha usa a regra única de aprovarNaOS.ts')
ok(card.includes('data-testid="os-aprovar-orcamento"'), 'botão "Aprovar orçamento" na ficha da OS')
ok(card.includes('<AjudaCampo chave="oficina.os.aprovar_orcamento"'), 'botão tem o "?" (RD-95)')
ok(card.includes('await carregar()') && /aprovarOrcamento[\s\S]*?window\.confirm/.test(card), 'pede confirmação e recarrega a OS depois de aprovar')

const migs = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'))
ok(migs.some((f) => readFileSync(`supabase/migrations/${f}`, 'utf8').includes("'oficina.os.aprovar_orcamento'")), 'migration cria a chave de ajuda do botão')

if (falhas > 0) { console.error(`\n[check-os-aprovar-orcamento] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-os-aprovar-orcamento] aprovação do orçamento na OS conferida.')
