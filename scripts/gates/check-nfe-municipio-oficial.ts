// Gate (chamado #1679 · Jordana/Gean): a NF-e mandava o município do destinatário como digitado ("SAO MIGUEL DO OESTE")
// e a Focus recusava "Município do destinatário inválido". O builder agora troca pelo nome OFICIAL do IBGE antes de
// enviar; sem achar na tabela, não chuta. Sem rede: a busca é injetada.
import { readFileSync } from 'node:fs'
import { enderecoComMunicipioOficial, type BuscaMunicipio } from '../../src/lib/fiscal/municipioDestinatario'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// Tabela de exemplo com os dois casos reais das rejeições da Gean.
const tabela: Record<string, { codigo_ibge: string; nome_municipio: string }> = {
  'sao miguel do oeste|SC': { codigo_ibge: '4217204', nome_municipio: 'São Miguel do Oeste' },
  'ipora do oeste|SC': { codigo_ibge: '4207650', nome_municipio: 'Iporã do Oeste' },
}
const busca: BuscaMunicipio = async (nome, uf) =>
  tabela[`${nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()}|${uf}`] ?? null
const end = (cidade: string, uf = 'SC') => ({ logradouro: 'Rua A', numero: '1', bairro: 'Centro', cidade, uf, cep: '89900000' })

async function main() {
  const a = await enderecoComMunicipioOficial(end('SAO MIGUEL DO OESTE'), busca)
  ok(a?.cidade === 'São Miguel do Oeste' && a?.codigoMunicipio === '4217204', 'nome sem acento vira o nome oficial + código IBGE')
  const b = await enderecoComMunicipioOficial(end('IPORA DO OESTE', 'sc'), busca)
  ok(b?.cidade === 'Iporã do Oeste' && b?.uf === 'SC' && b?.codigoMunicipio === '4207650', 'UF em minúscula também resolve')
  const c = await enderecoComMunicipioOficial(end('Cidade Inexistente'), busca)
  ok(c?.cidade === 'Cidade Inexistente' && c?.codigoMunicipio === undefined, 'não achou → endereço sai como veio (não chuta)')
  const d = await enderecoComMunicipioOficial(end('SAO MIGUEL DO OESTE'), async () => { throw new Error('rede') })
  ok(d?.cidade === 'SAO MIGUEL DO OESTE', 'busca falhou → não quebra a emissão')
  ok(await enderecoComMunicipioOficial(undefined, busca) === undefined, 'sem endereço → continua sem endereço')
  const e = await enderecoComMunicipioOficial(end('São Miguel do Oeste', ''), busca)
  ok(e?.cidade === 'São Miguel do Oeste' && e?.codigoMunicipio === undefined, 'sem UF → não busca')
  const f = await enderecoComMunicipioOficial(end('SAO MIGUEL DO OESTE'), async () => ({ codigo_ibge: '42', nome_municipio: 'X' }))
  ok(f?.cidade === 'SAO MIGUEL DO OESTE', 'código IBGE inválido (≠ 7 dígitos) → ignora')

  const b2 = readFileSync('src/lib/fiscal/nfe-builder.ts', 'utf8')
  ok(/enderecoComMunicipioOficial\(destinatario\.endereco/.test(b2) && /rpc\('fn_municipio_por_nome_uf'/.test(b2),
    'builder aplica o município oficial no destinatário pela tabela do IBGE')
  const p = readFileSync('src/lib/fiscal/providers/focusnfe.ts', 'utf8')
  ok(/municipio_destinatario: req\.destinatario\.endereco\?\.cidade/.test(p), 'Focus recebe o nome já corrigido')

  if (falhas) { console.error(`\n${falhas} falha(s) no município do destinatário (#1679)`); process.exit(1) }
  console.log('\nMunicípio oficial do destinatário na NF-e (#1679): ok')
}
main()
