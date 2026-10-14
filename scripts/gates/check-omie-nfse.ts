// Gate (#2712) — importação de NFS-e emitidas do OMIE: mapeamento puro (sem rede) + rota protegida e idempotente.
import { readFileSync } from 'node:fs'
import { mapearNfseOmie, extrairLista, numero, dataIso } from '../../src/lib/omie/nfse'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const prest = { cnpj: '12.345.678/0001-90', razao: 'R.R Serviços', im: '123' }
const item = {
  Cabecalho: { nCodNF: 987, nNumeroNFSe: 55, cCodigoVerifNFSe: 'ABC123' },
  Emissao: { dEmissao: '02/10/2026', hEmissao: '14:30:00' },
  Cancelamento: { cCancelada: 'N' },
  Tomador: { cRazaoSocial: 'Supreme Garden', cCnpjCpf: '11.222.333/0001-44', cEmail: 'a@b.com' },
  Valores: { nValorNFSe: '1.234,56', nValorISS: 61.73, nAliqISS: 5 },
  Links: { cLinkXml: 'https://exemplo.com/nfse.xml' },
}
const m = mapearNfseOmie(item, prest)
ok(!!m && m.row.provider_reference === '987', 'referência = nCodNF')
ok(m?.row.data_emissao === '2026-10-02T14:30:00-03:00', 'data/hora de emissão')
ok(m?.row.valor_servicos === 1234.56, 'valor pt-BR 1.234,56')
ok(m?.row.tomador_cnpj === '11222333000144' && m?.row.tomador_cpf === null, 'tomador CNPJ só dígitos')
ok(m?.row.status === 'autorizada', 'status autorizada')
ok(m?.xmlUrl === 'https://exemplo.com/nfse.xml', 'url do XML')
ok(mapearNfseOmie({ Cancelamento: { cCancelada: 'S' }, Cabecalho: { nCodNF: 1 }, Emissao: { dEmissao: '01/01/2020' } }, prest)?.row.status === 'cancelada', 'cancelada')
ok(mapearNfseOmie({ Cabecalho: {} }, prest) === null, 'sem referência/data = pulada')
ok(extrairLista({ nfseEncontradas: [item] }).length === 1, 'extrai lista')
ok(numero('273,81') === 273.81 && numero('1,234.56') === 1234.56 && numero(5) === 5, 'números')
ok(dataIso('2026-10-02T00:00:00') === '2026-10-02', 'data ISO')

const rota = readFileSync('src/app/api/omie/nfse/importar/route.ts', 'utf8')
ok(/exigirUsuario\(req, \{ admin: true \}\)/.test(rota), 'rota só equipe PS')
ok(/exigirEmpresas\(guarda/.test(rota), 'rota confere empresa')
ok(/eq\('provider_reference'/.test(rota) && /provider', 'omie'/.test(rota), 'idempotente por provider_reference')
ok(!/\.delete\(/.test(rota), 'rota não apaga nada')
process.exit(falhas ? 1 : 0)
