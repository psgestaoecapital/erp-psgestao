/**
 * Gate · NFS-e "sem tributos aproximados do IBPT" (spec 26/11 · Code: rodrigo-manual).
 * O totTrib (Lei 12.741) da NFS-e Nacional do NÃO optante é OBRIGATÓRIO (E0713) e NÃO pode depender da flag
 * opcional ibpt_empresa_nas_notas: a emissão consulta o IBPT-da-empresa (cache→token) SEMPRE, com a master
 * como último recurso; mensagem correta (token presente/vencido ≠ sem token); botão "Atualizar agora" reconsulta
 * com o token salvo. NÃO mexe no caminho órfão (fn_ibpt_aliquota/erp_ibpt_tabela/fn_ibpt_importar).
 * Checagem estática (sem rede/banco).
 */
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }
const read = (p: string) => readFileSync(p, 'utf8')

const rota = read('src/app/api/fiscal/nfse/emitir/route.ts')
// (1) O tributo da NFS-e Nacional não é mais barrado pela flag: o ramo do IBPT-da-empresa roda sem usarIbptEmpresa.
ok(!/usarIbptEmpresa/.test(rota), 'nfse: flag opcional ibpt_empresa_nas_notas não gateia mais o tributo obrigatório (var removida)')
ok(/aliquotaIbptEmpresa\(/.test(rota) && /tipo: 'servico'/.test(rota), 'nfse: consulta o IBPT-da-empresa (cache→token) para o serviço')
ok(/if \(lc116Digits\.length === 4 && ufPrest\.length === 2\) \{/.test(rota), 'nfse: consulta condicionada só a código LC116 + UF (não à flag)')
// (2) master como último recurso (fallback preservado).
ok(/fn_ibpt_aliquota_vigente/.test(rota), 'nfse: master (fn_ibpt_aliquota_vigente) preservada como último recurso')
// (3) mensagem correta: distingue token presente/vencido de sem token.
ok(/erp_ibpt_empresa_status/.test(rota) && /token_salvo_em/.test(rota), 'nfse: mensagem lê o status do token para distinguir os casos')
ok(/Atualizar agora/.test(rota) && /Cadastre o token do IBPT/.test(rota), 'nfse: mensagem certa — token presente→"Atualizar agora"; ausente→"Cadastre o token"')
// (4) NÃO mexe no caminho órfão.
ok(!/erp_ibpt_tabela|fn_ibpt_importar|rpc\('fn_ibpt_aliquota'/.test(rota), 'nfse: não usa o caminho órfão (erp_ibpt_tabela/fn_ibpt_importar/fn_ibpt_aliquota)')

const tokenRoute = read('src/app/api/fiscal/ibpt-token/route.ts')
ok(/export const PUT = withAuth/.test(tokenRoute), 'ibpt-token: ação "Atualizar agora" (PUT)')
ok(/credencialEmpresa\(companyId, 'ibpt', 'token'\)/.test(tokenRoute), 'ibpt-token: reconsulta com o token JÁ salvo (Vault), sem recolocar')
ok(/papelMinimo: 'gerente'/.test(tokenRoute.split('export const PUT')[1] ?? ''), 'ibpt-token: PUT com guarda gerente')
ok(/gravarCacheIbpt/.test(tokenRoute.split('export const PUT')[1] ?? ''), 'ibpt-token: PUT repopula o cache')

const card = read('src/components/fiscal/IbptTokenCard.tsx')
ok(/data-testid="ibpt-atualizar"/.test(card) && /method: 'PUT'/.test(card), 'card: botão "Atualizar agora" chama o PUT')
ok(/chave="fiscal\.config\.ibpt_atualizar_agora"/.test(card), 'card: "?" RD-95 no botão')

const mig = read('supabase/migrations/20261128134130_ibpt_atualizar_agora_ajuda_rd95.sql')
ok(/fiscal\.config\.ibpt_atualizar_agora/.test(mig) && /ON CONFLICT \(chave\) DO UPDATE/.test(mig), 'migration: ajuda RD-95 idempotente do botão')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nOK')
