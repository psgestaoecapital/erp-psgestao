// Gate (#9991 fatia 2 · jordana-code): o botão "Resolver" das pendências "X despesa(s)/receita(s) sem
// categoria — classificar p/ o DRE" em "Para tratar hoje" tem de levar à LISTA JÁ FILTRADA só nos títulos
// sem categoria. A tela (ListagemPagarReceberView) filtra por ?semcategoria=1 (seleciona a sentinela
// "— sem categoria —"). A migration que define fn_ge_pendencias_dia tem de emitir esses 2 links com o
// parâmetro certo — nunca mais a tela geral de A pagar / A receber sem filtrar.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

// Localiza a migration pelo SUFIXO (não pela versão): a fila de merge renumera o
// timestamp acima da main, então amarrar o gate ao número quebraria a cada renumeração.
const DIR = 'supabase/migrations'
const arq = readdirSync(DIR).find((f) => f.endsWith('_pendencias_dia_sem_categoria_deeplink.sql'))
ok(!!arq, 'migration _pendencias_dia_sem_categoria_deeplink.sql existe')
const sql = arq ? readFileSync(`${DIR}/${arq}`, 'utf8') : ''

// os 2 links corrigidos nesta fatia
ok(sql.includes("/dashboard/financeiro/pagar?semcategoria=1"), 'despesa sem categoria → ?semcategoria=1')
ok(sql.includes("/dashboard/financeiro/receber?semcategoria=1"), 'receita sem categoria → ?semcategoria=1')

// os 2 links aparecem exatamente no bloco de cada tipo de pendência (pagar_sem_categoria / receber_sem_categoria)
ok(/'tipo','pagar_sem_categoria'[\s\S]*?\/dashboard\/financeiro\/pagar\?semcategoria=1/.test(sql),
  'o link ?semcategoria=1 está no bloco pagar_sem_categoria')
ok(/'tipo','receber_sem_categoria'[\s\S]*?\/dashboard\/financeiro\/receber\?semcategoria=1/.test(sql),
  'o link ?semcategoria=1 está no bloco receber_sem_categoria')

// contrato da tela: lê o parâmetro ?semcategoria=1 e seleciona a sentinela de categoria vazia
const tela = readFileSync('src/components/financeiro/ListagemPagarReceberView.tsx', 'utf8')
ok(tela.includes("qs.get('semcategoria')"), 'a tela lê o parâmetro ?semcategoria=')
ok(tela.includes('SEM_CATEGORIA'), 'a tela tem a sentinela SEM_CATEGORIA para filtrar os sem categoria')

// CEO 25/11: os 2 links (pagar/receber sem categoria) levam também a empresa (company=<id>), na definição VIVA.
const viva = readdirSync(DIR).filter((f) => f.endsWith('.sql'))
  .filter((f) => /CREATE OR REPLACE FUNCTION public\.fn_ge_pendencias_dia/.test(readFileSync(`${DIR}/${f}`, 'utf8')))
  .sort().pop()
const sqlViva = viva ? readFileSync(`${DIR}/${viva}`, 'utf8') : ''
ok(/pagar\?semcategoria=1&company=/.test(sqlViva), 'despesa sem categoria → ?semcategoria=1&company=<id>')
ok(/receber\?semcategoria=1&company=/.test(sqlViva), 'receita sem categoria → ?semcategoria=1&company=<id>')

if (falhas) process.exit(1)
