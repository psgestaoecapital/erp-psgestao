/** Gate: NF-e de venda de veículo — destinatário PF sem razão social usa o nome do cadastro; PJ segue exigindo razão social. */
import { readFileSync } from 'node:fs'
import { nomeDestinatario } from '../../src/lib/fiscal/nomeDestinatarioPF'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }
ok(nomeDestinatario({ razao_social: null, nome_fantasia: 'CLIENTE TESTE HOMOLOGACAO' }, '52998224725') === 'CLIENTE TESTE HOMOLOGACAO', 'PF sem razão social usa nome_fantasia')
ok(nomeDestinatario({ razao_social: 'Fulano de Tal', nome_fantasia: 'Fulano' }, '52998224725') === 'Fulano de Tal', 'PF com razão social mantém a razão social')
ok(nomeDestinatario({ razao_social: null, nome_fantasia: 'Loja X' }, '11222333000181') === '', 'PJ sem razão social continua sem nome (validador recusa)')
ok(nomeDestinatario({ razao_social: '  ', nome_fantasia: ' ' }, '52998224725') === '', 'PF sem nenhum nome continua sem nome')
const b = readFileSync('src/lib/fiscal/nfe-builder.ts', 'utf8')
ok(/razaoSocial: nomeDestinatario\(cli, docLimpo\)/.test(b) && /nome_fantasia, cnpj_cpf/.test(b) || /razao_social, nome_fantasia/.test(b), 'builder da venda de veículo usa o helper e lê nome_fantasia')
if (falhas) process.exit(1)
