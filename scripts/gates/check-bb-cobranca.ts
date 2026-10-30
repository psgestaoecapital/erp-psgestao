// Gate #5404 (FC Pisos) parte (b): boleto do Banco do Brasil (Cobrança v2). Funções puras + ligação nas rotas/telas.
// Sem rede, sem banco.
import { readFileSync, existsSync } from 'node:fs'
import { dataBb, faltasCobrancaBb, modalidadeBb, montarCorpoRegistroBb, normalizarCarteiraBb, nossoNumeroBb } from '../../src/lib/banco/bb/cobrancaPura'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

// carteira só com o número; variação separada (e o formato antigo "17/35" ainda funciona)
ok(normalizarCarteiraBb('17/01-9', '35').carteira === '17', 'carteira "17/01-9" → 17')
ok(normalizarCarteiraBb('17/01-9', '35').variacao === '35', 'variação explícita (35) vence a da carteira')
const velho = normalizarCarteiraBb('17/35', null)
ok(velho.carteira === '17' && velho.variacao === '35', 'formato antigo "17/35" → carteira 17, variação 35')
ok(normalizarCarteiraBb('17', '').variacao === '', 'sem variação → vazia (a rota barra e diz o que falta)')
ok(modalidadeBb(null) === 1 && modalidadeBb('1') === 1 && modalidadeBb('4') === 4, 'modalidade: padrão 1 (simples), 4 (vinculada)')
ok(faltasCobrancaBb({ convenio: '3128557', carteira: '17', variacao_carteira: '35' }).length === 0, 'config de teste do BB (3128557 · 17 · 35) está completa')
ok(faltasCobrancaBb({ convenio: '2923830', carteira: '17/01-9', variacao_carteira: null }).join() === 'Variação da carteira', 'config sem variação → "Variação da carteira"')

// nosso número: 000 + convênio(7) + sequencial(10) = 20
ok(nossoNumeroBb('3128557', '2600000001') === '00031285572600000001', 'nosso número BB = 000 + convênio + sequencial (20 posições)')
ok(nossoNumeroBb('3128557', '2600000001').length === 20, 'nosso número com 20 posições')
ok(dataBb('2026-10-30') === '30.10.2026', 'data no formato do BB (dd.mm.aaaa)')

// corpo do registro com os dados de teste
const corpo = montarCorpoRegistroBb({
  cfg: { convenio: '3128557', carteira: '17', variacao: '35', modalidade: 1 },
  nossoNumero: '00031285572600000001', seuNumero: 'REC-123/45', valor: 2, emissaoISO: '2026-10-28', vencimentoISO: '2026-11-05',
  pagador: { documento: '123.456.789-09', nome: 'Jordana Carolina Richter', logradouro: 'Rua São José, 10', bairro: 'Centro', cidade: 'Chapecó', uf: 'sc', cep: '89800-000' },
}) as Record<string, unknown> & { pagador: Record<string, unknown> }
ok(corpo.numeroConvenio === 3128557 && corpo.numeroCarteira === 17 && corpo.numeroVariacaoCarteira === 35 && corpo.codigoModalidade === 1, 'corpo: convênio 3128557, carteira 17, variação 35, modalidade 1')
ok(corpo.valorOriginal === 2 && corpo.dataVencimento === '05.11.2026', 'corpo: valor e vencimento')
ok(corpo.pagador.tipoInscricao === 1 && corpo.pagador.numeroInscricao === 12345678909, 'pagador CPF → tipoInscricao 1 (pelo documento)')
ok(corpo.pagador.uf === 'SC' && corpo.pagador.nome === 'Jordana Carolina Richter' && corpo.pagador.endereco === 'Rua Sao Jose, 10', 'pagador: UF maiúscula e sem acento')
ok(corpo.numeroTituloBeneficiario === 'REC12345', 'seu número só alfanumérico')
const pj = montarCorpoRegistroBb({ cfg: { convenio: '3128557', carteira: '17', variacao: '35', modalidade: 1 }, nossoNumero: 'x', seuNumero: '1', valor: 10, emissaoISO: '2026-10-28', vencimentoISO: '2026-10-28',
  pagador: { documento: '12.345.678/0001-95', nome: 'Empresa', logradouro: null, bairro: null, cidade: null, uf: null, cep: null } }) as { pagador: Record<string, unknown> }
ok(pj.pagador.tipoInscricao === 2, 'pagador CNPJ → tipoInscricao 2')
let barrou = false
try { montarCorpoRegistroBb({ cfg: { convenio: '1', carteira: '17', variacao: '35', modalidade: 1 }, nossoNumero: 'x', seuNumero: '1', valor: 1, emissaoISO: '2026-10-28', vencimentoISO: '2026-10-28', pagador: { documento: '123', nome: 'A', logradouro: null, bairro: null, cidade: null, uf: null, cep: null } }) } catch { barrou = true }
ok(barrou, 'documento incompleto não vai ao banco')

// ligação: rotas, telas e migration
for (const r of ['registrar-boleto', 'cancelar-boleto', 'consultar-boleto']) ok(existsSync(`src/app/api/banco/bb/${r}/route.ts`), `rota /api/banco/bb/${r}`)
const reg = readFileSync('src/app/api/banco/bb/registrar-boleto/route.ts', 'utf8')
ok(reg.includes('cobrancas.convenio-requisicao') && reg.includes('Portal Developers'), 'registrar: erro de escopo diz o que conferir no Portal Developers')
ok(reg.includes('fn_banco_proximo_seu_numero') && !reg.includes("p_ambiente: 'homologacao'"), 'registrar: nosso número por sequencial atômico; ambiente vem da config (sem fixar)')
const srv = readFileSync('src/lib/banco/bb/servidor.ts', 'utf8')
ok(srv.indexOf("'producao'") < srv.indexOf("'homologacao'"), 'credencial: produção quando ativa, senão homologação (cada ambiente é uma linha)')
const ger = readFileSync('src/components/financeiro/GerarBoletosReceita.tsx', 'utf8')
ok(ger.includes("EMISSORES = ['sicoob', 'sicredi', 'bradesco', 'bb']"), 'GerarBoletosReceita: BB é emissor')
const lis = readFileSync('src/components/financeiro/ListagemPagarReceberView.tsx', 'utf8')
ok(!lis.includes('boleto-bb-implantacao') && lis.includes("provT === 'bb'"), 'Listagem: BB emite (sem mensagem "em implantação")')
const pg = readFileSync('src/app/dashboard/financeiro/conexoes-bancarias/page.tsx', 'utf8')
ok(pg.includes('variacao_carteira') && pg.includes('modalidade_boleto') && pg.includes('banco-homolog-aviso') && pg.includes('banco-ambiente'), 'Conexões: variação, modalidade e ambiente em destaque')
const mig = readFileSync('supabase/migrations/20261030220020_bb_cobranca_variacao_modalidade.sql', 'utf8')
ok(mig.includes('ADD COLUMN IF NOT EXISTS variacao_carteira') && mig.includes("'variacao_carteira', c.variacao_carteira") && mig.includes("p_dados->>'modalidade_boleto'"), 'migration: colunas + credencial + salvar CNAB')
ok(!/\b(DELETE|DROP|TRUNCATE)\b/i.test(mig), 'migration aditiva (sem DELETE/DROP/TRUNCATE)')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-bb-cobranca: OK')
