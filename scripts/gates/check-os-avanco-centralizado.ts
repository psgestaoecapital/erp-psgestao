/**
 * Gate de build · #135 (Triches) ajuste 21/10: no atendimento centralizado a OS anda na própria ficha —
 * Iniciar serviço → Finalizar → Entregar —, sem Diagnóstico técnico nem Aprovação do cliente. Regra única em
 * src/lib/oficina/avancoNaOS.ts; no modo com tablet os botões não aparecem (nada muda).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { aprovaPendentesAoAvancar, proximoPassoOS } from '../../src/lib/oficina/avancoNaOS'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

for (const st of ['orcamento', 'aberta', 'aguardando_aprovacao', 'aprovada', 'aguardando_peca']) {
  ok(proximoPassoOS('centralizado', st)?.para === 'em_execucao', `centralizado + "${st}" → Iniciar serviço (sem exigir diagnóstico/aprovação)`)
}
ok(proximoPassoOS('centralizado', 'em_execucao')?.para === 'pronta', 'em execução → Finalizar (Pronta)')
ok(proximoPassoOS('centralizado', 'pronta')?.para === 'entregue', 'pronta → Entregar')
ok(proximoPassoOS('centralizado', 'entregue') === null && proximoPassoOS('centralizado', 'cancelada') === null, 'entregue/cancelada → sem botão')
for (const st of ['aberta', 'em_execucao', 'pronta']) ok(proximoPassoOS('tablet', st) === null, `modelo com tablet + "${st}" → sem botão (fluxo completo intacto)`)

const ini = proximoPassoOS('centralizado', 'aberta')
ok(aprovaPendentesAoAvancar(ini, true, 2), 'itens sem decisão são aprovados junto ao avançar (senão o total fica R$ 0,00)')
ok(!aprovaPendentesAoAvancar(ini, false, 2), 'perfil sem permissão de valor não aprova (mesma trava do banco)')
ok(!aprovaPendentesAoAvancar(ini, true, 0), 'sem item pendente → só muda o status')
ok(!aprovaPendentesAoAvancar(null, true, 2), 'sem passo → nada')

const card = readFileSync('src/components/comum/OrdemServicoCard.tsx', 'utf8')
ok(card.includes('proximoPassoOS(oficina.modelo'), 'a ficha usa a regra única de avancoNaOS.ts')
ok(/async function avancarOS[\s\S]*?window\.confirm[\s\S]*?fn_oficina_orcamento_registrar[\s\S]*?fn_os_salvar/.test(card),
  'pede confirmação, aprova pela RPC da Aprovação e grava o status pela fn_os_salvar (histórico em audit_log_global)')
ok(card.includes('data-testid={passoOS.testid}') && card.includes('<AjudaCampo chave="oficina.os.avancar_status"'), 'botão de avanço com "?" (RD-95)')

const migs = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'))
ok(migs.some((f) => readFileSync(`supabase/migrations/${f}`, 'utf8').includes("'oficina.os.avancar_status'")), 'migration cria a chave de ajuda do botão')

if (falhas > 0) { console.error(`\n[check-os-avanco-centralizado] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-os-avanco-centralizado] avanço de status da OS no centralizado conferido.')
