// Gate (Rodrigo 21/10, Canal PS) — "Cancelar boleto" em Receitas a Receber cancela SÓ o boleto no banco; o título
// (erp_receber) continua ativo. Checagem estática da rota e da tela. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const rota = readFileSync('src/app/api/boleto/cancelar/route.ts', 'utf8')
const tela = readFileSync('src/components/financeiro/BoletoActions.tsx', 'utf8')
const lib = readFileSync('src/lib/banco/sicoob/index.ts', 'utf8')

// O UPDATE do título mexe só em colunas boleto_* — nunca em status, deleted_at, valor ou vencimento.
const upd = rota.match(/\.from\('erp_receber'\)\.update\(\{([\s\S]*?)\}\)/)?.[1] ?? ''
const colunas = [...upd.matchAll(/(\w+)\s*:/g)].map((m) => m[1])
ok(colunas.length > 0 && colunas.every((c) => c.startsWith('boleto_')), 'rota: o UPDATE do título toca só colunas boleto_* (título intacto)')
ok(/boleto_status: 'cancelado'/.test(upd), 'rota: boleto fica "cancelado" no registro da receita')
ok(!/\.delete\(|deleted_at\s*:/.test(rota), 'rota: não exclui nem marca o título como removido')
ok(/boleto_status !== 'registrado'/.test(rota) && /'pago', 'recebido', 'cancelado'/.test(rota), 'rota: só boleto registrado de título em aberto')
ok(/situacao === 'LIQUIDADO'/.test(rota), 'rota: boleto já liquidado no banco não é cancelado')
ok(/auth\.getUser\(\)/.test(rota) && /tipo: 'boleto_cancelamento'/.test(rota) && /usuario: user\.id/.test(rota), 'rota: exige usuário e registra quem/quando/retorno do banco')
ok(/não está disponível para o/.test(rota), 'rota: banco sem cancelamento por API avisa claramente')
ok(/\/baixar/.test(lib) && /method: 'PATCH'/.test(lib), 'sicoob: baixa do boleto via PATCH /baixar')
ok(/window\.confirm\(/.test(tela) && /\/api\/boleto\/cancelar/.test(tela) && /podeCancelar/.test(tela), 'tela: confirmação antes de enviar e ação só quando permitido')
ok(/AjudaCampo chave="financeiro\.receber\.cancelar_boleto"/.test(tela), 'tela: "?" da ação (RD-95)')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-cancelar-boleto: OK')
