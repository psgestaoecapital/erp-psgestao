// #9726 — a IM do prestador na NFS-e Nacional (DPS) é POR MUNICÍPIO.
//   • Guarujá do Sul (4206603) rejeita E0120 quando a IM é informada; outros municípios rejeitam E0116 quando a IM
//     NÃO vai. A decisão vem de erp_gov_nfse_municipios.informa_im do município emissor (default true = manda a IM).
// Este gate prova o comportamento no caminho REAL da emissão (provider focusnfe → buildNacionalNFSePayload), não na
// edge gov-nfse-emitir (inalcançável desde 23/09).
import { readFileSync } from 'node:fs'
import { buildNacionalNFSePayload } from '../../src/lib/fiscal/providers/focusnfe'
import type { NFSeRequest } from '../../src/lib/fiscal/types'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const ler = (p: string) => readFileSync(p, 'utf8')
const reqBase = (informa?: boolean): NFSeRequest => ({
  serie: '1', cnaeServico: '7311400', codigoServico: '170601', descricaoServico: 'Serviço', valorServicos: 1000,
  prestador: { cnpj: '14547274000100', razaoSocial: 'Mecânica', codigoMunicipio: '4206603', inscricaoMunicipal: '760', informaInscricaoMunicipal: informa },
  tomador: { cnpj: '00000000000272', razaoSocial: 'Cliente' },
  padraoNacional: true, opcaoSimplesNacional: 3, regimeTributario: 'simples_nacional', percentualTribSN: 12.63,
  codigoNbs: '1.1406.11.00',
})

// ── comportamento do payload (buildNacionalNFSePayload) ──
ok(buildNacionalNFSePayload(reqBase(undefined)).inscricao_municipal_prestador === '760',
  'default (informaInscricaoMunicipal ausente) → manda a IM (nenhum município de E0116 regride)')
ok(buildNacionalNFSePayload(reqBase(true)).inscricao_municipal_prestador === '760',
  'informaInscricaoMunicipal=true → manda a IM')
ok(!('inscricao_municipal_prestador' in buildNacionalNFSePayload(reqBase(false))),
  'informaInscricaoMunicipal=false (Guarujá do Sul) → NÃO manda a IM (evita E0120)')

// ── estático: o caminho real seta/consulta o flag ──
const fnfe = ler('src/lib/fiscal/providers/focusnfe.ts')
ok(/informaInscricaoMunicipal\s*!==\s*false/.test(fnfe), 'focusnfe: o payload só inclui a IM quando informaInscricaoMunicipal !== false')

const helper = ler('src/lib/fiscal/municipioInformaIm.ts')
ok(/erp_gov_nfse_municipios/.test(helper) && /informa_im/.test(helper), 'helper lê erp_gov_nfse_municipios.informa_im')
ok(/return true/.test(helper), 'helper é resiliente: erro/ausência/código inválido → true (comportamento atual)')

const builder = ler('src/lib/fiscal/nfse-builder.ts')
ok(/municipioInformaIm\(/.test(builder) && /informaInscricaoMunicipal:/.test(builder),
  'nfse-builder (recebível) seta informaInscricaoMunicipal a partir de municipioInformaIm')

const rota = ler('src/app/api/fiscal/nfse/emitir/route.ts')
ok(/municipioInformaIm\(/.test(rota) && /informaInscricaoMunicipal:/.test(rota),
  'rota /api/fiscal/nfse/emitir (avulsa) seta informaInscricaoMunicipal a partir de municipioInformaIm')

if (falhas > 0) { console.error(`check-nfse-im-por-municipio-9726: ${falhas} falha(s)`); process.exit(1) }
console.log('check-nfse-im-por-municipio-9726: ok')
