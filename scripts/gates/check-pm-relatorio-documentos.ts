// Gate · P&M Relatório de Documentos. Sem rede: regras puras + tela só leitura (nada gravado no financeiro).
import { readFileSync } from 'node:fs'
import { COLUNAS, MAX_COLUNAS, colunasValidas, deContrato, dePropostas, filtrarDocs, linhasCsv, totais } from '../../src/lib/pm/relatorioDocumentos'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

ok(COLUNAS.length === MAX_COLUNAS, 'catálogo com 11 colunas')
ok(colunasValidas(['x', 'valor', 'valor']).join() === 'valor' && colunasValidas([]).length === 7, 'colunas: ignora desconhecida/repetida, vazio = padrão')
ok(colunasValidas(COLUNAS.map((c) => c.chave as string).concat(['valor'])).length <= MAX_COLUNAS, 'colunas: no máximo 11')
const fee = deContrato({ id: 'f', tipo: 'fee', fee_mensal: 5000, valor_projeto: null, status: 'ativo', data_inicio: '2026-01-01', data_fim: null, cliente_id: 'c1', responsavel_id: 'u1' })
const orc = dePropostas({ id: 'o', numero: '12', titulo: 'Site', cliente_id: 'c2', valor_total: 1000, desconto: 100, valor_final: 900, status: 'enviada', created_at: '2026-09-10T10:00:00Z', validade_proposta: '2026-10-10', responsavel_id: null })
ok(fee.valor_a_faturar === 5000 && orc.valor_a_faturar === 900, 'valor a faturar: fee mensal; orçamento líquido do desconto')
const docs = [fee, orc]
ok(filtrarDocs(docs, { tipo: 'fee' }).length === 1 && filtrarDocs(docs, { clientes: ['c2'] }).length === 1 && filtrarDocs(docs, { de: '2026-09-01' }).length === 1 && filtrarDocs(docs, {}).length === 2, 'filtros tipo/cliente/período')
const t = totais(docs); ok(t.quantidade === 2 && t.valor === 6000 && t.aFaturar === 5900, 'totais')
const csv = linhasCsv(docs, ['tipo', 'cliente', 'valor_a_faturar'], { clientes: { c1: 'Aurora; Cia' }, responsaveis: {} }).split('\n')
ok(csv[0] === 'Tipo;Cliente;Valor a faturar' && csv[1] === 'Fee;"Aurora; Cia";5000' && csv[2] === 'Orçamento;;900', 'CSV: cabeçalho, escape e decimal')
const tela = readFileSync('src/app/dashboard/pm/relatorio-documentos/page.tsx', 'utf8')
ok(!/\.(insert|update|delete|upsert)\(/.test(tela) && !/rpc\(/.test(tela), 'tela só lê (nada lançado)')
ok(/company_id/.test(tela), 'consultas por empresa')
if (falhas) process.exit(1)
