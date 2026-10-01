// Gate (CEO 29/09 · baixa de boleto ciente do banco; #297). Regras puras + travas do código. Roda no build. Sem rede.
import { readFileSync } from 'node:fs'
import { PROVEDORES_LIQUIDACAO, BANCOS_COM_CONSULTA, provedorPorBanco, situacaoPaga, statusExecucao } from '../../src/lib/banco/liquidacao'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// 1) bancos com consulta e seus códigos (Sicoob e Sicredi agora; Bradesco quando chegar a documentação)
ok(PROVEDORES_LIQUIDACAO.sicoob.banco_codigo === '756' && PROVEDORES_LIQUIDACAO.sicredi.banco_codigo === '748', 'Sicoob=756, Sicredi=748')
ok(!BANCOS_COM_CONSULTA.includes('237'), 'Bradesco (237) não usa a consulta título a título genérica: tem rotina própria (lista 7h / individual 13h — #297)')
ok(provedorPorBanco('748')?.provider === 'sicredi' && provedorPorBanco('001') === null, 'banco → provedor; banco sem consulta → nenhum')

// 2) o que é PAGO (e o que não é)
for (const s of ['LIQUIDADO', 'Liquidado', 'PAGO', 'BAIXADO_LIQUIDADO', 'LIQUIDADO_REDE', 'Liquidado Compe', 'LIQUIDACAO_PIX'.replace('LIQUIDACAO', 'LIQUIDADO')]) {
  ok(situacaoPaga(s), `"${s}" é pagamento`)
}
for (const s of ['EM_ABERTO', 'BAIXADO', 'BAIXADO_POR_SOLICITACAO', 'VENCIDO', 'PROTESTADO', '', null]) {
  ok(!situacaoPaga(s as string | null), `"${s}" NÃO é pagamento`)
}

// 3) status da execução
ok(statusExecucao(0, 0) === 'sem_boletos' && statusExecucao(5, 0) === 'ok' && statusExecucao(5, 2) === 'parcial' && statusExecucao(3, 3) === 'erro', 'status: sem_boletos / ok / parcial / erro')

// 4) a rota: só os boletos DAQUELE banco, baixa com o banco, registra cada execução, aceita o agendado
const rota = readFileSync('src/app/api/boleto/sync-liquidacao/route.ts', 'utf8')
ok(rota.includes(".eq('boleto_banco_codigo', alvo.banco_codigo)"), 'consulta só os boletos do banco da conexão (antes mandava tudo ao Sicoob)')
ok(/fn_boleto_liquidar'[\s\S]{0,400}p_banco_codigo: alvo\.banco_codigo/.test(rota) && /p_provider: prov\.provider/.test(rota), 'baixa passa provider e banco (conta do banco certo)')
ok(rota.includes("fn_boleto_liquidacao_registrar") && /await registrar\(lote, origem, r, usuario\)/.test(rota), 'cada execução empresa/banco é registrada (sucesso ou falha)')
ok(rota.includes('ehChamadaServico(req)') && rota.includes('empresasDoUsuario'), 'agendado (service key) e botão (empresa do usuário)')
ok(!rota.includes("const BANCO = '756'"), 'sem banco fixo no código')

// 5) a migration: busca por banco, trava única, agendamento 7h/13h, alerta no briefing
const mig = readFileSync('supabase/migrations/20260930090000_boleto_baixa_por_banco.sql', 'utf8')
ok(/WHERE company_id = p_company_id AND boleto_banco_codigo = p_banco_codigo AND boleto_nosso_numero = p_nosso_numero/.test(mig), 'fn_boleto_liquidar acha por empresa + banco + nosso número')
ok(mig.includes("'banco_obrigatorio'"), 'sem banco não baixa')
ok(/CREATE UNIQUE INDEX IF NOT EXISTS uq_receber_boleto_banco_nosso_numero[\s\S]{0,200}\(company_id, boleto_banco_codigo, boleto_nosso_numero\)/.test(mig), 'trava única empresa + banco + nosso número')
ok(mig.includes("cron.schedule('boleto-liquidacao-7h-13h', '0 10,16 * * *'"), 'agendamento 10h e 16h UTC = 7h e 13h de Brasília')
ok(mig.includes("'{alertas_pendentes_para_ceo,baixa_boleto_falhando}'"), 'falha repetida vira alerta no briefing')

// 6) o webhook do Sicredi já passa o banco (748)
const wh = readFileSync('src/app/api/banco/sicredi/webhook/route.ts', 'utf8')
ok(/p_banco_codigo: BANCO/.test(wh) && wh.includes("const BANCO = '748'"), 'webhook Sicredi baixa com banco 748')

if (falhas) { console.error(`\ncheck-baixa-boleto-banco: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-baixa-boleto-banco: ok')
