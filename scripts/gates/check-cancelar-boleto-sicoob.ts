// Gate (pedido do Rodrigo, Canal PS 21/10 · "Cancelar boleto"). Travas estáticas do código, sem rede.
// Regra central: cancela SÓ o boleto no banco; o TÍTULO (erp_receber) permanece ativo.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const rota = readFileSync('src/app/api/banco/sicoob/cancelar-boleto/route.ts', 'utf8')
const lib = readFileSync('src/lib/banco/sicoob/index.ts', 'utf8')
const tela = readFileSync('src/components/financeiro/BoletoActions.tsx', 'utf8')

ok(/export async function baixarBoleto/.test(lib) && lib.includes("SICOOB_SCOPE_BAIXAR_BOLETO = 'boletos_baixa'"), 'lib Sicoob tem a baixa de boleto com scope próprio')
ok(rota.includes('sb.auth.getUser()') && rota.includes("'nao autenticado'"), 'exige usuário logado')
ok(rota.includes("rec.boleto_status !== 'registrado'") && rota.includes("['pago', 'recebido', 'cancelado']"), 'só boleto registrado e título não pago/cancelado')
ok(rota.indexOf('baixarBoleto(') < rota.indexOf("boleto_status: 'cancelado'"), 'só marca cancelado DEPOIS de o banco confirmar')
const update = rota.match(/\.from\('erp_receber'\)\.update\(\{([\s\S]*?)\}\)/)?.[1] ?? ''
ok(update.includes("boleto_status: 'cancelado'") && !/\b(status|valor|data_vencimento|deleted_at)\s*:/.test(update.replace(/boleto_\w+\s*:/g, '')), 'o UPDATE mexe só em colunas boleto_* (título intacto)')
ok(!/\.delete\(|deleted_at/.test(rota.split('baixarBoleto(')[1] ?? ''), 'não exclui nem apaga o título')
ok(rota.includes("tipo: 'boleto_cancelar'") && rota.includes('por: user.id'), 'auditoria: quem, quando e retorno do banco')
ok(tela.includes('window.confirm(') && tela.includes('data-testid="boleto-cancelar"') && tela.includes("provider === 'sicoob'"), 'tela pede confirmação e só oferece no Sicoob; outros bancos avisam indisponível')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
