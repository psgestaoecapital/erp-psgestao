// Gate (#9991 · jordana-code): o botão "Resolver" de a receber/a pagar (atrasado e hoje) em
// "Para tratar hoje" tem de levar à LISTA FILTRADA. A tela (ListagemPagarReceberView) só filtra
// pelo parâmetro ?status= com os valores 'vencido' | 'hoje' | 'avencer'. A migration que define
// fn_ge_pendencias_dia tem de emitir esses links com o parâmetro/valor certo — nunca mais o antigo
// ?situacao=vencidos/hoje, que caía na tela geral sem filtrar.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const MIG = 'supabase/migrations/20261120214020_pendencias_dia_resolver_deeplink_status.sql'
const sql = readFileSync(MIG, 'utf8')

// os 4 links corrigidos
ok(sql.includes("/dashboard/financeiro/receber?status=vencido"), 'a receber atrasado → ?status=vencido')
ok(sql.includes("/dashboard/financeiro/receber?status=hoje"), 'a receber hoje → ?status=hoje')
ok(sql.includes("/dashboard/financeiro/pagar?status=vencido"), 'a pagar atrasado → ?status=vencido')
ok(sql.includes("/dashboard/financeiro/pagar?status=hoje"), 'a pagar hoje → ?status=hoje')

// nunca o parâmetro antigo que a tela ignora (ignora comentários -- do SQL; vale o código)
const sqlSemComentarios = sql.replace(/--[^\n]*/g, '')
ok(!/\?situacao=/.test(sqlSemComentarios), 'sem o parâmetro antigo ?situacao= (a tela ignora, não filtra)')

// contrato da tela: continua lendo ?status= com os valores esperados
const tela = readFileSync('src/components/financeiro/ListagemPagarReceberView.tsx', 'utf8')
ok(tela.includes("qs.get('status')"), 'a tela lê o parâmetro ?status=')
for (const v of ['vencido', 'hoje', 'avencer']) {
  ok(tela.includes(`st === '${v}'`), `a tela trata ?status=${v}`)
}

if (falhas) process.exit(1)
