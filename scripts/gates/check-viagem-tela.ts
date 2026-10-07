// Gate · Viagem V2 (tela do administrativo + fechamento). Sem rede: regras puras e contrato da tela/migration.
import { readFileSync } from 'node:fs'
import { resumoTexto, validarLancamento, type LancamentoForm } from '../../src/lib/viagem/tela'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const base: LancamentoForm = { tipo: 'despesa', data: '2026-11-03', fornecedor_nome: 'Posto X', categoria: '2.05', forma_pagamento: 'dinheiro', valor: '50', obra_id: 'o', pago_colaborador: true, litros: '', hodometro: '' }
ok(validarLancamento(base, '2026-11-01', '2026-11-05').length === 0, 'despesa válida passa')
ok(validarLancamento({ ...base, data: '2026-11-09' }, '2026-11-01', '2026-11-05').length === 1, 'data fora do período recusada')
ok(validarLancamento({ ...base, valor: '0', fornecedor_nome: ' ' }, '2026-11-01', '2026-11-05').length === 2, 'valor zero e fornecedor vazio recusados')
ok(validarLancamento({ ...base, tipo: 'abastecimento' }, '2026-11-01', '2026-11-05').length === 2, 'abastecimento exige litros e hodômetro')
ok(validarLancamento({ ...base, tipo: 'abastecimento', categoria: '', litros: '40', hodometro: '1200' }, '2026-11-01', '2026-11-05').length === 0, 'abastecimento sem categoria usa a de combustível do banco')
ok(resumoTexto(10) === 'Colaborador devolve à empresa' && resumoTexto(-1) === 'Empresa reembolsa o colaborador' && resumoTexto(0) === 'Acertado', 'saldo: devolve / reembolsa / acertado')

const tela = readFileSync('src/app/dashboard/projetos/viagens/page.tsx', 'utf8')
ok(/fn_viagem_lancamento_salvar/.test(tela) && /fn_viagem_fechar/.test(tela) && /fn_viagem_resumo/.test(tela), 'tela grava só pelas funções fn_viagem_*')
ok(!/\.(insert|update|delete)\(/.test(tela) && !/contas_pagar|erp_pagar|fn_pagar/.test(tela), 'tela nunca grava tabela nem lança financeiro (fronteira GE)')
const mig = readFileSync('supabase/migrations/20261007140005_viagem_fechamento_evento.sql', 'utf8')
ok(/ENABLE ROW LEVEL SECURITY/.test(mig) && /REVOKE ALL ON public\.erp_viagem_evento FROM PUBLIC, anon/.test(mig) && /fn__guarda_empresa/.test(mig), 'migration: RLS, REVOKE anon e guarda de empresa')
ok(!/DELETE\s+FROM/i.test(mig) && !/UPDATE\s+public\.(?!erp_viagem\s+SET)/i.test(mig), 'migration aditiva: sem DELETE e sem UPDATE em outra tabela')
if (falhas) process.exit(1)
