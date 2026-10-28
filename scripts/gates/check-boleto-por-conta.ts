// Gate #5404 (FC Pisos): o boleto sai pelo banco da CONTA BANCÁRIA do título — nunca pelo "primeiro banco ativo".
// Sem rede, sem banco.
import { readFileSync } from 'node:fs'
import { resolverProviderDaConta, type RoteamentoBoleto } from '../../src/lib/banco/boletoPorConta'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

// FC Pisos depois do vínculo: BB (001) e Sicredi (748), contas com banco_codigo
const fc: RoteamentoBoleto = {
  configs: [
    { provider: 'bb', banco_codigo: '001', banco_conta_id: 'c-bb' },
    { provider: 'sicredi', banco_codigo: '748', banco_conta_id: 'c-sic' },
  ],
  contas: {
    'c-bb': { id: 'c-bb', nome: 'Banco do Brasil', banco_codigo: '001' },
    'c-sic': { id: 'c-sic', nome: 'Sicredi', banco_codigo: '748' },
    'c-cx': { id: 'c-cx', nome: 'Caixa', banco_codigo: null },
  },
}
const r1 = resolverProviderDaConta(fc, 'c-bb')
ok(!!r1 && r1.ok && r1.provider === 'bb', 'conta Banco do Brasil → BB (não o Sicredi)')
const r2 = resolverProviderDaConta(fc, 'c-sic')
ok(!!r2 && r2.ok && r2.provider === 'sicredi', 'conta Sicredi → Sicredi')
const r3 = resolverProviderDaConta(fc, 'c-cx')
ok(!!r3 && !r3.ok && r3.motivo === 'A conta Caixa não tem boleto ativado.', 'conta sem boleto → "A conta Caixa não tem boleto ativado." (sem cair em outro banco)')
ok(resolverProviderDaConta(fc, null) === null, 'título sem conta → null (segue a escolha manual de sempre)')

// vínculo só pelo código do banco (config sem banco_conta_id)
const porCodigo: RoteamentoBoleto = {
  configs: [{ provider: 'bb', banco_codigo: '001', banco_conta_id: null }, { provider: 'sicredi', banco_codigo: '748', banco_conta_id: null }],
  contas: { a: { id: 'a', nome: 'BB', banco_codigo: '001' }, b: { id: 'b', nome: 'Itaú', banco_codigo: '341' } },
}
const r4 = resolverProviderDaConta(porCodigo, 'a')
ok(!!r4 && r4.ok && r4.provider === 'bb', 'sem vínculo de conta, o banco_codigo da conta escolhe a configuração')
const r5 = resolverProviderDaConta(porCodigo, 'b')
ok(!!r5 && !r5.ok, 'banco_codigo sem configuração de boleto → mensagem, não outro banco')

// empresa de UM banco só, nada preenchido: continua emitindo (não quebra quem já funciona)
const um: RoteamentoBoleto = { configs: [{ provider: 'sicoob', banco_codigo: null, banco_conta_id: null }], contas: { x: { id: 'x', nome: 'Sicoob', banco_codigo: null } } }
const r6 = resolverProviderDaConta(um, 'x')
ok(!!r6 && r6.ok && r6.provider === 'sicoob', 'empresa com um único banco de boleto e conta sem código → usa esse banco')
// dois bancos, conta sem vínculo nem código: não adivinha
const dois: RoteamentoBoleto = { configs: fc.configs.map((c) => ({ ...c, banco_conta_id: null })), contas: { x: { id: 'x', nome: 'Conta X', banco_codigo: null } } }
const r7 = resolverProviderDaConta(dois, 'x')
ok(!!r7 && !r7.ok, 'dois bancos e conta sem vínculo → mensagem, nunca o primeiro da lista')

// as telas usam a regra
const ger = readFileSync('src/components/financeiro/GerarBoletosReceita.tsx', 'utf8')
ok(ger.includes('resolverProviderDaConta') && ger.includes('/api/banco/${prov}/registrar-boleto'), 'GerarBoletosReceita: emite pelo banco da conta do título')
const lis = readFileSync('src/components/financeiro/ListagemPagarReceberView.tsx', 'utf8')
ok(lis.includes('resolverProviderDaConta') && lis.includes('boleto-sem-conta'), 'Listagem: banco da conta do título + mensagem de conta sem boleto')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-boleto-por-conta: OK')
