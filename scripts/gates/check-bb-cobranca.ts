// Gate #5404 parte b: boleto do Banco do Brasil (Cobrança v2) — corpo do registro, carteira só número, dados por ambiente,
// ambiente visível na tela e emissor ligado. Sem rede, sem banco.
import { readFileSync } from 'node:fs'
import { carteiraBb, faltasCobrancaBb, montarCorpoRegistroBb } from '../../src/lib/banco/bb/cobranca'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

ok(carteiraBb('17/01-9') === '17' && carteiraBb('17') === '17', 'carteira "17/01-9" vira "17"')
const teste = { convenio: '3128557', carteira: '17', variacao: '35', modalidade: 1 }
ok(faltasCobrancaBb(teste).length === 0, 'dados de teste do BB completos')
ok(faltasCobrancaBb({ convenio: '3128557', carteira: '17', variacao: null, modalidade: null }).join() === 'Variação da carteira,Modalidade', 'diz o que falta (variação, modalidade)')

const c = montarCorpoRegistroBb({
  cfg: teste, seuNumero: 'NF123', nossoNumeroSeq: '2600000001', emissaoISO: '2026-10-28', vencimentoISO: '2026-11-05', valor: 2,
  pagador: { documento: '12345678909', nome: 'Fulano', logradouro: 'Rua A', numero: '10', cep: '89000-000', cidade: 'Blumenau', bairro: 'Centro', uf: 'SC' },
}) as Record<string, unknown> & { pagador: Record<string, unknown> }
ok(c.numeroConvenio === 3128557 && c.numeroCarteira === 17 && c.numeroVariacaoCarteira === 35 && c.codigoModalidade === 1, 'corpo usa convênio/carteira/variação/modalidade de teste')
ok(c.dataVencimento === '05.11.2026' && c.dataEmissao === '28.10.2026', 'datas no formato dd.mm.aaaa')
ok(c.numeroTituloCliente === '0003128557' + '2600000001', 'nosso número = 000 + convênio(7) + sequencial(10)')
ok(String(c.numeroTituloCliente).length === 20, 'nosso número com 20 dígitos')
ok(c.pagador.tipoInscricao === 1 && c.pagador.numeroInscricao === 12345678909, 'pagador CPF = tipo 1')

const rota = readFileSync('src/app/api/banco/bb/registrar-boleto/route.ts', 'utf8')
ok(/eq\('ambiente', ambiente\)/.test(rota) && /variacao_carteira/.test(rota), 'rota lê os dados de cobrança da linha do AMBIENTE em uso')
ok(!/sicredi/i.test(rota), 'rota do BB nunca usa o Sicredi')
const tela = readFileSync('src/app/dashboard/financeiro/conexoes-bancarias/page.tsx', 'utf8')
ok(/bb-ambiente-em-uso/.test(tela) && /HOMOLOGAÇÃO — o boleto emitido é só de TESTE/.test(tela), 'tela mostra o ambiente (homologação/produção)')
ok(/fn_banco_config_salvar_bb_cobranca/.test(tela), 'tela salva variação/modalidade pela função nova')
ok(/EMISSORES = \[[^\]]*'bb'/.test(readFileSync('src/components/financeiro/GerarBoletosReceita.tsx', 'utf8')), 'emissão em lote reconhece o BB')
const mig = readFileSync('supabase/migrations/20261030160020_banco_bb_cobranca_variacao_modalidade.sql', 'utf8')
ok(/REVOKE ALL ON FUNCTION public\.fn_banco_config_salvar_bb_cobranca[^;]*FROM PUBLIC, anon/.test(mig), 'função nova sem acesso anon')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nOK')
