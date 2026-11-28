/**
 * Gate · ambiente da NFS-e (spec 27/11 · Code: rodrigo-manual). A emissão de NFS-e usa o ambiente da NFS-e
 * (erp_fiscal_provider_config.ambiente) — NUNCA o da NF-e (ambiente_nfe). O modal de intermediação (ficha do
 * veículo) tem de receber producaoDisponivel para o banner E a emissão baterem; sem a prop ele caía no default
 * 'homologacao' e mostrava "teste" numa nota que vai pelo config.ambiente (produção) — banner mentiroso.
 * Checagem estática (sem rede/banco).
 */
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }
const read = (p: string) => readFileSync(p, 'utf8')

// Fonte única do ambiente da NFS-e: lê 'ambiente' (NFS-e), nunca 'ambiente_nfe'.
const prod = read('src/lib/fiscal/producaoDisponivel.ts')
ok(/\.select\('ambiente'\)/.test(prod) && !/ambiente_nfe/.test(prod), 'producaoDisponivel: lê o campo da NFS-e (ambiente), nunca ambiente_nfe')
ok(/ambiente\?: string \| null \} \| null\)\?\.ambiente === 'producao'/.test(prod), 'producaoDisponivel: produção só quando config.ambiente === producao')

// Ficha do veículo: carrega e repassa producaoDisponivel ao modal de intermediação.
const ficha = read('src/app/dashboard/revenda/veiculo/[id]/page.tsx')
ok(/import \{ carregarProducaoDisponivel \} from '@\/lib\/fiscal\/producaoDisponivel'/.test(ficha), 'ficha: usa o resolvedor compartilhado de ambiente da NFS-e')
ok(/carregarProducaoDisponivel\(v\.company_id\)/.test(ficha), 'ficha: resolve producaoDisponivel pela empresa do veículo')
ok(/producaoDisponivel=\{nfseProducao\}/.test(ficha), 'ficha: repassa producaoDisponivel ao NFSeEmitirGovModal (banner e emissão do mesmo campo)')

// Rota de emissão da NFS-e: usa o ambiente da empresa (config.ambiente), sem forçar o tipo 'nfe' (que leria ambiente_nfe).
const rota = read('src/app/api/fiscal/nfse/emitir/route.ts')
ok(/createFiscalService\(body\.companyId\)/.test(rota), 'rota nfse: createFiscalService sem tipo nfe → usa o ambiente da NFS-e (config.ambiente)')
ok(!/createFiscalService\(body\.companyId,\s*\{[^}]*tipo:\s*'nfe'/.test(rota), 'rota nfse: NÃO pede o ambiente da NF-e (ambiente_nfe)')

// Regressão: os outros pontos de emissão de NFS-e continuam passando producaoDisponivel.
const lista = read('src/app/dashboard/fiscal/nfse/NFSeListClient.tsx')
const otc = read('src/app/dashboard/commerce/otc/page.tsx')
ok(/producaoDisponivel=\{producaoDisponivel\}/.test(lista), 'lista NFSes Emitidas: passa producaoDisponivel')
ok(/producaoDisponivel=\{nfseProducaoDisponivel\}/.test(otc), 'pedido (OTC): passa producaoDisponivel')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nOK')
