// Gate (Rodrigo, Canal PS 21/10) — "Cancelar boleto" cancela SÓ o boleto no banco, nunca o título.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const rota = readFileSync('src/app/api/banco/sicoob/cancelar-boleto/route.ts', 'utf8')
const acoes = readFileSync('src/components/financeiro/BoletoActions.tsx', 'utf8')
const lib = readFileSync('src/lib/banco/sicoob/index.ts', 'utf8')

ok(/export async function baixarBoleto/.test(lib) && /\/baixar`/.test(lib) && /method: 'PATCH'/.test(lib), 'lib Sicoob: baixa do boleto por PATCH')
ok(/auth\.getUser\(\)/.test(rota) && /status: 401/.test(rota), 'rota: exige usuário logado')
ok(/boleto_status !== 'registrado'/.test(rota) && /'pago', 'liquidado', 'quitado'/.test(rota), 'rota: só boleto registrado e título não quitado')
ok(/boleto_status: 'cancelado'/.test(rota), 'rota: marca o boleto como cancelado')
const upd = rota.slice(rota.indexOf("from('erp_receber').update("), rota.indexOf(".eq('id', receber_id).eq('company_id'"))
ok(upd.length > 0 && !/\bstatus:|valor_pago|data_pagamento|deleted_at|ativo/.test(upd.replace(/boleto_status/g, '')), 'rota: o UPDATE não toca no título (status/valor/baixa/exclusão)')
ok(/boleto_cancelar/.test(rota) && /por: user\.id/.test(rota), 'rota: auditoria (quem, quando, retorno do banco)')
ok(/window\.confirm\(/.test(acoes) && /boleto-cancelar/.test(acoes) && /!pago &&/.test(acoes), 'tela: confirmação antes e ação oculta para título pago')
ok(/provider === 'sicoob'/.test(acoes) && /ainda não está disponível/.test(acoes), 'tela: provedor sem suporte avisa em vez de falhar calado')
ok(/errUpd/.test(rota) && /não atualizou/.test(rota), 'rota: erro do UPDATE local após a baixa no banco é tratado e auditado')
ok(/<AjudaCampo chave="financeiro\.receber\.cancelar_boleto"/.test(acoes), 'tela: "?" (AjudaCampo) no botão')
ok(/fn_acesso_efetivo/.test(rota) && /status: 403/.test(rota) && /CLIENT_VIEWER/.test(rota), 'rota: confere o papel do usuário antes de baixar no banco')
ok(/if \(!papel \|\|/.test(rota), 'rota: papel nulo bloqueia (fail-closed)')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
