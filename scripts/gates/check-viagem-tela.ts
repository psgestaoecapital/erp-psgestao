// Gate · Viagem V2 (tela do administrativo + fechamento). Sem rede: regras puras e contrato da tela/migration.
import { readFileSync } from 'node:fs'
import { resumoTexto, validarLancamento, type LancamentoForm } from '../../src/lib/viagem/tela'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const base: LancamentoForm = { tipo: 'despesa', data: '2026-11-03', fornecedor_nome: 'Posto X', categoria: '2.05', forma_pagamento: 'dinheiro', valor: '50', obra_id: 'o', pago_colaborador: true, litros: '', hodometro: '', tanque_cheio: false }
ok(validarLancamento(base, '2026-11-01', '2026-11-05').length === 0, 'despesa válida passa')
ok(validarLancamento({ ...base, data: '2026-11-09' }, '2026-11-01', '2026-11-05').length === 1, 'data fora do período recusada')
ok(validarLancamento({ ...base, valor: '0', fornecedor_nome: ' ' }, '2026-11-01', '2026-11-05').length === 2, 'valor zero e fornecedor vazio recusados')
ok(validarLancamento({ ...base, tipo: 'abastecimento' }, '2026-11-01', '2026-11-05').length === 2, 'abastecimento exige litros e hodômetro')
ok(validarLancamento({ ...base, tipo: 'abastecimento', categoria: '', litros: '40', hodometro: '1200' }, '2026-11-01', '2026-11-05').length === 0, 'abastecimento sem categoria usa a de combustível do banco')
ok(resumoTexto(10) === 'Colaborador devolve à empresa' && resumoTexto(-1) === 'Empresa reembolsa o colaborador' && resumoTexto(0) === 'Acertado', 'saldo: devolve / reembolsa / acertado')

const tela = readFileSync('src/app/dashboard/projetos/viagens/page.tsx', 'utf8')
ok(/fn_viagem_lancamento_salvar/.test(tela) && /fn_viagem_fechar/.test(tela) && /fn_viagem_resumo/.test(tela), 'tela grava só pelas funções fn_viagem_*')
ok(!/\.(insert|update|delete)\(/.test(tela) && !/contas_pagar|erp_pagar|fn_pagar/.test(tela), 'tela nunca grava tabela nem lança financeiro (fronteira GE)')
const mig = readFileSync('supabase/migrations/20261016220305_viagem_fechamento_evento.sql', 'utf8')
ok(/ENABLE ROW LEVEL SECURITY/.test(mig) && /REVOKE ALL ON public\.erp_viagem_evento FROM PUBLIC, anon/.test(mig) && /fn__guarda_empresa/.test(mig), 'migration: RLS, REVOKE anon e guarda de empresa')
ok(!/DELETE\s+FROM/i.test(mig) && !/UPDATE\s+public\.(?!erp_viagem\s+SET)/i.test(mig), 'migration aditiva: sem DELETE e sem UPDATE em outra tabela')
// perfil consulta (viewer) só lê — auditor 24/10: a tela esconde as ações e o banco barra a gravação nas 4 tabelas
const trava = readFileSync('supabase/migrations/20261025140052_viagem_viewer_somente_leitura.sql', 'utf8')
ok(/fn_viagem_pode_gravar/.test(tela) && /podeGravar && <span/.test(tela) && /aberta\.status === 'aberta' && podeGravar && (!previa && )?\(lf/.test(tela), 'tela: Nova viagem, lançamento e fechar só para quem pode gravar')
ok(['erp_viagem', 'erp_viagem_lancamento', 'erp_viagem_obra', 'erp_viagem_config'].every((t) => new RegExp(`BEFORE INSERT OR UPDATE OR DELETE ON public\\.${t}\\s`).test(trava)), 'banco: gatilho de consulta nas 4 tabelas da viagem')
ok(/NOT IN \('viewer', 'visualizador'\)/.test(trava) && /REVOKE ALL ON FUNCTION public\.fn_viagem_pode_gravar\(uuid\) FROM PUBLIC, anon/.test(trava) && !/CREATE OR REPLACE (VIEW|FUNCTION public\.fn_viagem_(salvar|fechar|lancamento))/.test(trava), 'banco: viewer barrado, REVOKE anon, nenhuma fn_viagem_* existente reescrita')
if (falhas) process.exit(1)
