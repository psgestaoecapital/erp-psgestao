// Gate (#6732, jordana-code) — "Cancelar boleto" do Sicredi cancela SÓ o boleto no banco, nunca o título.
// Espelha o gate do Sicoob (check-cancelar-boleto.ts) para o conector Sicredi (banco 748, REST sem mTLS).
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const rota = readFileSync('src/app/api/banco/sicredi/cancelar-boleto/route.ts', 'utf8')
const acoes = readFileSync('src/components/financeiro/BoletoActions.tsx', 'utf8')
const lib = readFileSync('src/lib/banco/sicredi/index.ts', 'utf8')

ok(/export async function baixarBoleto/.test(lib) && /\/baixa\?/.test(lib) && /method: 'PATCH'/.test(lib), 'lib Sicredi: baixa do boleto por PATCH no endpoint /baixa')
ok(/cobranca\/boleto\/v1\/boletos\/\$\{encodeURIComponent/.test(lib) && /codigoBeneficiario: c\.codigo_beneficiario/.test(lib), 'lib Sicredi: endpoint chaveado por codigoBeneficiario (igual a consultar/pdf)')
ok(/auth\.getUser\(\)/.test(rota) && /status: 401/.test(rota), 'rota: exige usuário logado')
ok(/boleto_status !== 'registrado'/.test(rota) && /'pago', 'liquidado', 'quitado'/.test(rota), 'rota: só boleto registrado e título não quitado')
ok(/String\(rec\.boleto_banco_codigo\) !== BANCO/.test(rota) && /BANCO = '748'/.test(rota), 'rota: confere que o boleto é do Sicredi (748)')
ok(/boleto_status: 'cancelado'/.test(rota), 'rota: marca o boleto como cancelado')
const upd = rota.slice(rota.indexOf("from('erp_receber').update("), rota.indexOf(".eq('id', receber_id).eq('company_id'"))
ok(upd.length > 0 && !/\bstatus:|valor_pago|data_pagamento|deleted_at|ativo/.test(upd.replace(/boleto_status/g, '')), 'rota: o UPDATE não toca no título (status/valor/baixa/exclusão)')
ok(/boleto_cancelar/.test(rota) && /por: user\.id/.test(rota), 'rota: auditoria (quem, quando, retorno do banco)')
ok(/errUpd/.test(rota) && /não atualizou/.test(rota), 'rota: erro do UPDATE local após a baixa no banco é tratado e auditado')
ok(/fn_acesso_efetivo/.test(rota) && /status: 403/.test(rota) && /CLIENT_VIEWER/.test(rota), 'rota: confere o papel do usuário antes de baixar no banco')
ok(/if \(!papel \|\|/.test(rota), 'rota: papel nulo bloqueia (fail-closed)')
ok(/ambiente: SicrediAmbiente = 'producao'/.test(rota), 'rota: baixa só em produção (onde o boleto real foi registrado)')
ok(/provider === 'sicredi'/.test(acoes) && /cancelaViaApi/.test(acoes), 'tela: botão de cancelar habilitado para o Sicredi')
ok(/ainda não está disponível/.test(acoes), 'tela: provedor sem rota de baixa (Bradesco) ainda avisa em vez de falhar calado')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
