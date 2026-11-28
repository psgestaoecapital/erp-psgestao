/**
 * Gate · NFS-e Nacional da revenda (spec 26/11 · Code: rodrigo-manual).
 * Item 2: ação idempotente que sincroniza a adesão do município (lista nacional) para a CONFIG da empresa.
 * Item 4: botão que expõe a emissão de NFS-e de intermediação (10.02.01) reusando o emissor nacional.
 * Checagem estática (sem rede/banco): constantes do padrão nacional + fiação da rota/tela/migration.
 */
import { readFileSync } from 'node:fs'
import {
  adnEndpointBase, ADN_NACIONAL_PRODUCAO, ADN_NACIONAL_PRODUCAO_RESTRITA,
  INTERMEDIACAO_CODIGO_TRIBUTACAO_NACIONAL, INTERMEDIACAO_CODIGO_LC116, INTERMEDIACAO_DESCRICAO_PADRAO,
} from '../../src/lib/fiscal/govNfseNacional'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }
const read = (p: string) => readFileSync(p, 'utf8')

// Constantes do padrão nacional (endpoints OFICIAIS do ADN por ambiente; código de tributação da intermediação).
ok(adnEndpointBase('producao') === ADN_NACIONAL_PRODUCAO, 'ADN: ambiente producao → endpoint de produção')
ok(adnEndpointBase('homologacao') === ADN_NACIONAL_PRODUCAO_RESTRITA, 'ADN: homologacao → produção restrita')
ok(adnEndpointBase(null) === ADN_NACIONAL_PRODUCAO_RESTRITA && adnEndpointBase(undefined) === ADN_NACIONAL_PRODUCAO_RESTRITA, 'ADN: ambiente ausente → produção restrita (nunca produção por engano)')
ok(ADN_NACIONAL_PRODUCAO === 'https://adn.nfse.gov.br' && ADN_NACIONAL_PRODUCAO_RESTRITA === 'https://adn.producaorestrita.nfse.gov.br', 'ADN: URLs oficiais do portal gov.br/nfse')
ok(INTERMEDIACAO_CODIGO_TRIBUTACAO_NACIONAL === '100201' && INTERMEDIACAO_CODIGO_LC116 === '10.02', 'intermediação: código de tributação nacional 10.02.01 (100201) + LC 10.02')
ok(INTERMEDIACAO_DESCRICAO_PADRAO.length > 0 && !/\d{2,}/.test(INTERMEDIACAO_DESCRICAO_PADRAO), 'intermediação: descrição padrão sem valor fiscal embutido')

// Item 2 · rota backend: lê a lista global, grava os 3 campos na config, com guarda gerente, idempotente.
const rota = read('src/app/api/fiscal/gov-nfse/sincronizar-municipio/route.ts')
ok(/from\('erp_gov_nfse_municipios'\)/.test(rota), 'rota: lê a adesão da tabela global erp_gov_nfse_municipios')
ok(/gov_nfse_municipio_aderido:/.test(rota) && /gov_nfse_endpoint_base:/.test(rota) && /gov_nfse_ultima_consulta_municipio:/.test(rota), 'rota: grava aderido + endpoint_base + ultima_consulta na config')
ok(/guardaEmpresaFiscal/.test(rota) && /papelMinimo: 'gerente'/.test(rota), 'rota: guarda de empresa (gerente)')
ok(/adnEndpointBase\(/.test(rota), 'rota: endpoint vem de adnEndpointBase (não hardcode)')
ok(/\.length !== 7/.test(rota), 'rota: recusa sem código IBGE (7 dígitos) com mensagem clara')

// Item 2 · tela de config: card com o botão que chama a rota + "?" RD-95.
const cfgTela = read('src/app/dashboard/configuracoes/fiscal/FiscalConfigClient.tsx')
ok(/SincronizarMunicipioCard/.test(cfgTela), 'config: card de sincronização do município presente')
ok(/\/api\/fiscal\/gov-nfse\/sincronizar-municipio/.test(cfgTela), 'config: botão chama a rota de sincronização')
ok(/chave="fiscal\.config\.gov_nfse_sincronizar_municipio"/.test(cfgTela), 'config: "?" RD-95 na ação de sincronizar')
ok(/gov_nfse_ultima_consulta_municipio/.test(cfgTela), 'config: lê a última consulta para mostrar na tela')

// Item 4 · tela da revenda: botão abre o emissor nacional com os seeds da intermediação + "?" RD-95.
const veic = read('src/app/dashboard/revenda/veiculo/[id]/page.tsx')
ok(/import NFSeEmitirGovModal from '@\/components\/fiscal\/NFSeEmitirGovModal'/.test(veic), 'revenda: reusa o NFSeEmitirGovModal (emissor nacional)')
ok(/codigoServicoMunicipio=\{INTERMEDIACAO_CODIGO_TRIBUTACAO_NACIONAL\}/.test(veic) && /codigoLC116=\{INTERMEDIACAO_CODIGO_LC116\}/.test(veic), 'revenda: seeds do serviço de intermediação (10.02.01 / LC 10.02)')
ok(/valorServicos=\{venda\?\.retorno_banco/.test(veic) && /tomadorNome=\{venda\?\.banco_nome/.test(veic), 'revenda: tomador = banco, valor = retorno do banco')
ok(!/aliquotaIss=/.test(veic), 'revenda: NÃO hardcoda alíquota de ISS (vem da parametrização: ISS por município)')
ok(/chave="revenda\.veiculo\.nfse_intermediacao"/.test(veic), 'revenda: "?" RD-95 na ação de emitir NFS-e')

// Migration RD-95: as duas chaves de ajuda seedadas.
const mig = read('supabase/migrations/20261128120330_nfse_nacional_sync_intermediacao_ajuda_rd95.sql')
ok(/fiscal\.config\.gov_nfse_sincronizar_municipio/.test(mig) && /revenda\.veiculo\.nfse_intermediacao/.test(mig), 'migration: ajuda RD-95 das duas ações')
ok(/ON CONFLICT \(chave\) DO UPDATE/.test(mig), 'migration: idempotente (ON CONFLICT chave)')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nOK')
