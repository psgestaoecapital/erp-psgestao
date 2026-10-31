/**
 * Gate (#2876): crédito de ICMS do Simples na NF-e (CSOSN 101 + pCredSN/vCredICMSSN + texto do art. 23 da LC 123).
 * Travas do CEO: só emitente do Simples com alíquota cadastrada · só destinatário contribuinte que não é consumidor
 * final · nota normal (devolução fora) · sem alíquota = nada muda.
 */
import { readFileSync } from 'node:fs'
import {
  aplicaCreditoSN, csosnDoItem, empresaComCreditoSN, observacoesComSimples, valorCreditoSN, textoCreditoSN,
  TEXTO_SIMPLES, type CondicaoCreditoSN,
} from '../../src/lib/fiscal/creditoIcmsSimples'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const base: CondicaoCreditoSN = { ehSimples: true, aliquota: 3.8, indIEDest: 1, consumidorFinal: false, finalidade: 'normal' }
ok(aplicaCreditoSN(base), 'Simples + alíquota + contribuinte revenda → crédito')
ok(!aplicaCreditoSN({ ...base, consumidorFinal: true }), 'consumidor final → sem crédito')
ok(!aplicaCreditoSN({ ...base, indIEDest: 9 }) && !aplicaCreditoSN({ ...base, indIEDest: 2 }), 'não contribuinte / isento → sem crédito')
ok(!aplicaCreditoSN({ ...base, ehSimples: false }), 'emitente fora do Simples → sem crédito')
ok(!aplicaCreditoSN({ ...base, aliquota: null }) && !aplicaCreditoSN({ ...base, aliquota: 0 }) && !aplicaCreditoSN({ ...base, aliquota: 12 }), 'sem alíquota válida → sem crédito')
ok(!aplicaCreditoSN({ ...base, finalidade: 'devolucao' }), 'devolução → sem crédito (regra própria)')

ok(csosnDoItem('102', base) === '101' && csosnDoItem('101', base) === '101', 'contribuinte: 101/102 do cadastro saem 101')
ok(csosnDoItem('101', { ...base, consumidorFinal: true }) === '102' && csosnDoItem('102', { ...base, consumidorFinal: true }) === '102', 'consumidor final: sai 102')
ok(csosnDoItem('500', base) === '500' && csosnDoItem('900', base) === '900' && csosnDoItem(undefined, base) === undefined, 'outros CSOSN (ST 500, 900, vazio) não mudam')
ok(csosnDoItem('101', { ...base, aliquota: null }) === '101' && csosnDoItem('102', { ...base, ehSimples: false }) === '102', 'empresa sem alíquota: CSOSN do cadastro intocado (nada muda)')
ok(!empresaComCreditoSN({ ehSimples: true, aliquota: null }) && empresaComCreditoSN({ ehSimples: true, aliquota: 3.8 }), 'opt-in pela alíquota cadastrada')

ok(valorCreditoSN(1000, 3.8) === 38 && valorCreditoSN(123.45, 3.8) === 4.69 && valorCreditoSN(-5, 3.8) === 0, 'vCredICMSSN = valor do item × alíquota, 2 casas')
ok(textoCreditoSN(38, 3.8).includes('R$ 38,00') && textoCreditoSN(38, 3.8).includes('3,80%') && /ART\. 23 DA LEI COMPLEMENTAR Nº 123\/2006/.test(textoCreditoSN(38, 3.8)), 'texto do crédito com valor e alíquota em pt-BR')
const obs = observacoesComSimples('Pedido 55', 38, 3.8)
ok(obs.startsWith('Pedido 55') && obs.includes(TEXTO_SIMPLES) && obs.includes('R$ 38,00'), 'observações: mantém o que havia + Simples + crédito')
ok(!observacoesComSimples(undefined, null, 3.8).includes('APROVEITAMENTO') && observacoesComSimples(undefined, null, 3.8) === TEXTO_SIMPLES, 'consumidor final: só a frase do Simples')
ok(observacoesComSimples(obs, 38, 3.8) === obs, 'não duplica as frases')

const builder = readFileSync('src/lib/fiscal/nfe-builder.ts', 'utf8')
const focus = readFileSync('src/lib/fiscal/providers/focusnfe.ts', 'utf8')
ok(/csosnDoItem\(cstIcmsProd, condCreditoSN\)/.test(builder), 'builder aplica a regra no CSOSN do item (fora da devolução)')
ok(/it\.icmsOverride\s*\n?\s*\?\s*\{\s*\n\s*cst: it\.icmsOverride\.csosn/.test(builder), 'devolução (icmsOverride) segue intocada')
ok(/observacoes: ehSimples\s*\n\s*\? observacoesComSimples\(/.test(builder), 'frase do Simples em TODA nota do Simples, com ou sem alíquota (ajuste 20/10, NF-e nº 2 FCR)')
ok(/aliqCreditoSN \?\? 0,/.test(builder) && observacoesComSimples(undefined, null, 0) === TEXTO_SIMPLES, 'sem alíquota: só a frase do Simples, nunca a do crédito')
ok(/select\('serie_nfe_padrao, aliquota_credito_icms_sn'\)/.test(builder), 'alíquota vem da configuração fiscal da empresa')
ok(/icms_aliquota_credito_simples: item\.icms\.creditoSN\.aliquota/.test(focus) && /icms_valor_credito_simples: item\.icms\.creditoSN\.valor/.test(focus), 'payload Focus: pCredSN e vCredICMSSN')

const mig = readFileSync('supabase/migrations/20261017022020_fiscal_credito_icms_simples.sql', 'utf8')
ok(/ADD COLUMN IF NOT EXISTS aliquota_credito_icms_sn numeric/.test(mig) && !/DEFAULT\s+\d/.test(mig.split('aliquota_credito_icms_sn numeric')[1]?.slice(0, 20) ?? ''), 'coluna nova nula por padrão (ninguém muda sem cadastrar)')
ok(/fn__guarda_empresa\(p_company_id\)/.test(mig) && /fn_pagar_usuario_master\(p_company_id\)/.test(mig), 'gravação com guarda de empresa e de Master')
ok(/REVOKE EXECUTE ON FUNCTION public\.fn_fiscal_credito_icms_sn_salvar\(uuid, numeric\) FROM anon, public/.test(mig), 'função nova sem acesso anônimo')
const card = readFileSync('src/components/fiscal/ConfigFiscalEditCard.tsx', 'utf8')
for (const c of [...card.matchAll(/<AjudaCampo chave="([^"]+credito[^"]*)"/g)].map((m) => m[1])) ok(mig.includes(`'${c}'`), `"?" cadastrado: ${c}`)

if (falhas) { console.error(`\n[check-nfe-credito-icms-simples] ${falhas} falha(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-nfe-credito-icms-simples] crédito de ICMS do Simples conferido.')
