/**
 * Gate · NFS-e nacional E1235 (spec 27/11 · Code: rodrigo-manual).
 * FIX 1: indDest/indFinal/finNFSe são OBRIGATÓRIOS na DPS nacional e vão SEMPRE, independentes do grupo IBS/CBS
 *   (antes só iam junto com o IBS/CBS → sem cadastro, o XML saía sem indDest e o nacional rejeitava E1235).
 * FIX 2: a NFS-e de intermediação é ligada ao veículo (origem_tipo/origem_id) e a ficha mostra status +
 *   Visualizar + Acompanhar. Checagem estática (sem rede/banco).
 */
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }
const read = (p: string) => readFileSync(p, 'utf8')

// ── FIX 1 · rota nfse: defaults obrigatórios de indDest/indFinal/finNFSe, com config tendo prioridade ──────
const rota = read('src/app/api/fiscal/nfse/emitir/route.ts')
ok(/E1235/.test(rota), 'nfse: comentário documenta o E1235 (origem do bug)')
ok(/indicadorDestinatario: nfseReq\.reforma\?\.indicadorDestinatario \?\? reformaEmpresa\?\.indicadorDestinatario \?\? 0/.test(rota), 'nfse: indDest sempre presente (default 0 = tomador é o destinatário)')
ok(/consumidorFinal: nfseReq\.reforma\?\.consumidorFinal \?\? reformaEmpresa\?\.consumidorFinal \?\? indFinalPadrao/.test(rota), 'nfse: indFinal sempre presente (default por tipo do tomador)')
ok(/finalidadeEmissao: nfseReq\.reforma\?\.finalidadeEmissao \?\? reformaEmpresa\?\.finalidadeEmissao \?\? 0/.test(rota), 'nfse: finNFSe sempre presente (default 0 = NFS-e regular)')
ok(/const tomadorPJ = !!nfseReq\.tomador\.cnpj/.test(rota) && /tomadorPJ \? 0 : \(nfseReq\.tomador\.cpf \? 1 : 0\)/.test(rota), 'nfse: indFinal = PJ (CNPJ) → 0; PF (CPF) → 1')
// decoupling: os defaults são setados FORA do bloco do serviço/IBS-CBS (sobrevivem mesmo sem servicoId/IBS-CBS)
const posValida = rota.indexOf('validarIbsCbsObrigatorio')
const posDefault = rota.indexOf('indDest / indFinal / finNFSe')
ok(posDefault > posValida && posValida !== -1, 'nfse: defaults aplicados após o bloco IBS/CBS (independem do grupo)')

// provider Focus mapeia os três campos
const focus = read('src/lib/fiscal/providers/focusnfe.ts')
ok(/p\.indicador_destinatario = rt\.indicadorDestinatario/.test(focus) && /p\.consumidor_final = rt\.consumidorFinal/.test(focus) && /p\.finalidade_emissao = rt\.finalidadeEmissao/.test(focus), 'focus: mapeia indicador_destinatario + consumidor_final + finalidade_emissao')

// ── FIX 2 · vínculo de origem + ficha mostra status/visualizar/acompanhar ───────────────────────────────────
ok(/origemTipo\?: string/.test(rota) && /origemId\?: string/.test(rota), 'rota: aceita origemTipo/origemId no corpo')
ok(/from\('erp_nfse_emitidas'\)[\s\S]{0,160}\.update\(\{ origem_tipo: body\.origemTipo, origem_id: body\.origemId \}\)/.test(rota), 'rota: grava origem_tipo/origem_id na nota emitida (update leve pós-registro)')

const modal = read('src/components/fiscal/NFSeEmitirGovModal.tsx')
ok(/origemTipo\?: string/.test(modal) && /\.\.\.\(origemTipo && origemId \? \{ origemTipo, origemId \} : \{\}\)/.test(modal), 'modal: repassa origemTipo/origemId no corpo da emissão')

const ficha = read('src/app/dashboard/revenda/veiculo/[id]/page.tsx')
ok(/from\('erp_nfse_emitidas'\)[\s\S]{0,200}\.eq\('origem_tipo', 'veic_intermediacao'\)\.eq\('origem_id', id\)/.test(ficha), 'ficha: carrega as NFS-e do veículo por origem')
ok(/origemTipo="veic_intermediacao"/.test(ficha) && /origemId=\{id\}/.test(ficha), 'ficha: passa o vínculo de origem ao modal')
ok(/Visualizar nota/.test(ficha) && /function acompanharNfse/.test(ficha) && /\/api\/fiscal\/nfse\/consultar\//.test(ficha), 'ficha: botões Visualizar (PDF) + Acompanhar (consultar status)')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nOK')
