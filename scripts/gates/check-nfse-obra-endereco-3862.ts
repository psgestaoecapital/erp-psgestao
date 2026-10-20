/**
 * Gate de build (#3862, FC Pisos): NFS-e de construção civil sai só com o ENDEREÇO da obra (sem CNO e sem obra
 * cadastrada). A tela abre o quadro da obra em "Informar o endereço agora" quando o serviço exige obra, a
 * mensagem diz "CNO ou endereço" e a falta de alíquota de ISS leva à tela "ISS por município".
 *   tsx scripts/gates/check-nfse-obra-endereco-3862.ts
 */
import { readFileSync, existsSync } from 'node:fs'
import { modoObraInicial, ROTA_ISS_MUNICIPIOS, textoBloqueioNfse } from '../../src/lib/fiscal/bloqueioNfseTexto'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

// 1) modo inicial do quadro da obra
ok(modoObraInicial({ modo: 'apontar', obraSel: null, tocado: false }, true) === 'informar', 'exige obra e nada escolhido → abre em informar o endereço')
ok(modoObraInicial({ modo: 'apontar', obraSel: null, tocado: true }, true) === 'apontar', 'pessoa escolheu apontar → respeita')
ok(modoObraInicial({ modo: 'apontar', obraSel: { id: 'x' }, tocado: false }, true) === 'apontar', 'obra já apontada → não troca')
ok(modoObraInicial({ modo: 'apontar', obraSel: null, tocado: false }, false) === 'apontar', 'serviço sem obra (reenvio) → não troca')

// 2) textos dos bloqueios
const obra = textoBloqueioNfse({ codigo: 'obra_obrigatoria', mensagem: 'O servico 07.05 exige informacao de obra na nota.', acao: 'Vincule a nota a uma obra.', onde: 'faturamento' })
ok(!!obra.acao && obra.acao.includes('CNO ou o endereço da obra') && !obra.acao.includes('Vincule'), 'obra: "Informe o CNO ou o endereço da obra"')
const iss = textoBloqueioNfse({ codigo: 'aliquota_iss_desconhecida', mensagem: 'A aliquota de ISS de Paraíso nao esta cadastrada.', acao: 'Cadastre a aliquota ou consulte o contador.', onde: 'configuracoes/fiscal/iss-municipios' })
ok(iss.link?.href === ROTA_ISS_MUNICIPIOS && !(iss.acao ?? '').includes('configuracoes/'), 'ISS: link para a tela, sem caminho cru')
ok(existsSync('src/app/dashboard/configuracoes/fiscal/iss-municipios/page.tsx'), 'a tela ISS por município existe')
const outro = textoBloqueioNfse({ codigo: 'servico_sem_lc116', mensagem: 'm', acao: 'Cadastre.', onde: 'cadastro do servico' })
ok(outro.acao === 'Cadastre. (cadastro do servico)' && outro.link === null, 'demais bloqueios: texto de antes')

// 3) a tela usa os dois
const modal = readFileSync('src/components/fiscal/NFSeEmitirGovModal.tsx', 'utf8')
ok(modal.includes('textoBloqueioNfse(b)'), 'modal mostra os bloqueios pelo helper')
ok(modal.includes('modoObraInicial(') && modal.includes('setObraTocada(true)'), 'modal abre a obra em informar até a pessoa mexer')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nOK — NFS-e de obra pelo endereço (#3862)')
