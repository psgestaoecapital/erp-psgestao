// #nfe-venda PF: destinatário pessoa física sem razão social usa o nome do cadastro (nome_fantasia); PJ segue exigindo razão social.
import { readFileSync } from 'node:fs'
const s = readFileSync('src/lib/fiscal/nfe-builder.ts', 'utf8')
const i = s.indexOf('else if (input.vendaVeiculo)')
const bloco = s.slice(i, s.indexOf('montarItemVeiculo(input.vendaVeiculo', i))
const erros: string[] = []
if (!/select\('razao_social, nome_fantasia,/.test(bloco)) erros.push('select sem nome_fantasia')
if (!/docLimpo\.length === 11 \? cli\.nome_fantasia/.test(bloco)) erros.push('PF não cai para nome_fantasia')
if (!/\|\| cli\.razao_social,/.test(bloco)) erros.push('PJ perdeu a exigência de razão social')
if (erros.length) { console.error('check-nfe-venda-pf-razao: ' + erros.join('; ')); process.exit(1) }
console.log('check-nfe-venda-pf-razao: ok')
