/**
 * Gate de build: a NFS-e AVULSA (caminho manual da rota de emissão) leva série, CNAE e município do prestador
 * da Configuração Fiscal — a mesma leitura do Recebível. Antes ia com série '1' e sem município, e travava.
 *   tsx scripts/check-nfse-avulsa-emissor.ts
 */
import { readFileSync } from 'node:fs'
import { dadosEmissorDaConfig } from '../src/lib/fiscal/emissorConfig'
import { buildNacionalNFSePayload } from '../src/lib/fiscal/providers/focusnfe'
import type { NFSeRequest } from '../src/lib/fiscal/types'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

// 1) a leitura da config
const cfg = { serie_nfse_padrao: '15000', cnae_padrao: '43.30-4-05', gov_nfse_municipio_codigo: '4207650' }
const e = dadosEmissorDaConfig(cfg)
ok(e.serie === '15000' && e.codigoMunicipio === '4207650' && e.cnaeServico === '43.30-4-05', 'config completa → série, município e CNAE da config')
ok(dadosEmissorDaConfig(cfg, '4330401').cnaeServico === '4330401', 'CNAE informado na emissão tem prioridade')
ok(dadosEmissorDaConfig(null).serie === '1' && dadosEmissorDaConfig(null).codigoMunicipio === undefined, 'sem config → série 1 e sem município (a guarda da rota explica)')
ok(dadosEmissorDaConfig({ ...cfg, gov_nfse_municipio_codigo: '  ' }).codigoMunicipio === undefined, 'município em branco não vira código')

// 2) a rota: o caminho manual usa a mesma leitura e põe o município no prestador
const rota = readFileSync('src/app/api/fiscal/nfse/emitir/route.ts', 'utf8')
const manual = rota.slice(rota.indexOf('} else if (body.manual) {'), rota.indexOf('// NFS-e avulsa: a tela manda só nome + documento'))
ok(manual.includes('dadosEmissorDaConfig(cfgEmissor'), 'avulsa lê a Configuração Fiscal')
ok(/serie:\s*emissor\.serie/.test(manual) && !/serie:\s*'1'/.test(manual), "avulsa não fixa mais a série '1'")
ok(/codigoMunicipio:\s*emissor\.codigoMunicipio/.test(manual), 'avulsa põe o município (IBGE) no prestador')
const builder = readFileSync('src/lib/fiscal/nfse-builder.ts', 'utf8')
ok(builder.includes('dadosEmissorDaConfig(cfg'), 'Recebível usa a mesma leitura')

// 3) o payload da avulsa com a config da FC: emissor 4207650 (Iporã do Oeste), prestação em Lages
const req = {
  serie: e.serie, dataEmissao: '2026-09-29T09:00:00.000Z', cnaeServico: e.cnaeServico, codigoServico: '070501', valorServicos: 98165.7,
  descricaoServico: 'SERVIÇO DE TESTE', retemIss: true, tipoRetencaoISS: 2, padraoNacional: true, opcaoSimplesNacional: 1,
  prestador: { cnpj: '25277862000197', razaoSocial: 'FC', inscricaoMunicipal: '6617', codigoMunicipio: e.codigoMunicipio },
  tomador: { cnpj: '05532428000107', razaoSocial: 'TOMADOR', endereco: { logradouro: 'RUA A', numero: '105', bairro: 'CDL', cidade: 'LAGES', uf: 'SC', cep: '88517625', codigoMunicipio: '4209300' } },
  obra: { logradouro: 'RUA A', numero: '105', bairro: 'CDL', cep: '88517625', uf: 'SC', codigoMunicipio: '4209300' },
  tributosAproxPct: { federal: 13.45, estadual: 0, municipal: 3.15, fonte: 'IBPT 26.2.B' },
} as unknown as NFSeRequest
const p = buildNacionalNFSePayload(req) as Record<string, unknown>
ok(p.codigo_municipio_emissora === 4207650, 'payload: município emissor 4207650')
ok(p.codigo_municipio_prestacao === 4209300, 'payload: prestação em Lages 4209300')

if (falhas > 0) { console.error(`\n[check-nfse-avulsa-emissor] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-nfse-avulsa-emissor] emissor da NFS-e avulsa conferido.')
