// Gate (#5451 — Gean): a busca de cliente/fornecedor acha COM ou SEM acento, no PONTO ÚNICO compartilhado.
// Dois pontos cobrem todas as telas: (1) o helper `orFiltroClienteBusca` (OS, orçamento, agenda, re-vínculo da OS)
// filtra a coluna gerada `busca_norm` com o termo normalizado (sem acento, minúsculo); (2) as RPCs canônicas
// fn_cliente_buscar / fn_fornecedor_buscar (NF-e avulsa e seletores por RPC) comparam `busca_norm` via
// public.fn_texto_busca_norm. Nada de ILIKE cru acento-sensível em nome/razão. Estático, sem rede.
import { readFileSync, readdirSync } from 'node:fs'
import { orFiltroClienteBusca, normalizarBuscaTexto } from '../../src/lib/clienteBusca'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

// ---- helper compartilhado (telas que filtram direto via .or()) ----
ok(normalizarBuscaTexto('Romário') === 'romario', 'normalizador tira acento e minusculiza (espelha fn_texto_busca_norm)')
ok(orFiltroClienteBusca('Romário') === orFiltroClienteBusca('romario'), 'com e sem acento geram o MESMO filtro')
ok(/busca_norm\.ilike\.%romario%/.test(orFiltroClienteBusca('Romário') ?? ''), 'nome com acento vira filtro por busca_norm sem acento')
ok(/busca_norm\.ilike\.%romar%/.test(orFiltroClienteBusca('romar') ?? ''), 'parte do nome (sem escrever 100%) acha')
ok(!/nome_fantasia\.ilike|razao_social\.ilike/.test(orFiltroClienteBusca('Romário') ?? ''), 'não usa mais ILIKE cru (acento-sensível) em nome/razão')
ok(orFiltroClienteBusca('a') === null, 'termo com menos de 2 caracteres não filtra (não varre a base)')
// documento inalterado: as DUAS colunas, só dígitos
const docFiltro = orFiltroClienteBusca('028.144.060-35') ?? ''
ok(/cpf_cnpj\.ilike\.%02814406035%/.test(docFiltro) && /cnpj_cpf\.ilike\.%02814406035%/.test(docFiltro), 'documento continua buscando em cpf_cnpj E cnpj_cpf (dígitos)')

// ---- migration das RPCs canônicas ----
const dir = 'supabase/migrations'
const nome = readdirSync(dir).find((n) => n.endsWith('_fn_cliente_fornecedor_buscar_sem_acento_5451.sql'))
ok(!!nome, 'migration do #5451 presente')
const mig = nome ? readFileSync(`${dir}/${nome}`, 'utf8') : ''
const semComentarios = mig.replace(/--.*$/gm, '')
ok(/CREATE OR REPLACE FUNCTION public\.fn_cliente_buscar\(/.test(mig), 'migration recria fn_cliente_buscar')
ok(/CREATE OR REPLACE FUNCTION public\.fn_fornecedor_buscar\(/.test(mig), 'migration recria fn_fornecedor_buscar')
ok(/c\.busca_norm ILIKE '%'\|\|public\.fn_texto_busca_norm\(v_termo\)\|\|'%'/.test(mig), 'cliente: nome compara busca_norm via fn_texto_busca_norm (sem acento)')
ok(/f\.busca_norm ILIKE '%'\|\|public\.fn_texto_busca_norm\(v_termo\)\|\|'%'/.test(mig), 'fornecedor: nome compara busca_norm via fn_texto_busca_norm (sem acento)')
ok(/NOT public\.is_admin\(\) AND p_company_id NOT IN \(SELECT (public\.)?get_user_company_ids\(\)\)/.test(mig), 'guarda de empresa mantida nas duas funções')
ok(/REVOKE ALL ON FUNCTION public\.fn_cliente_buscar\(uuid, text, integer\) FROM PUBLIC, anon;/.test(mig)
   && /REVOKE ALL ON FUNCTION public\.fn_fornecedor_buscar\(uuid, text, integer\) FROM PUBLIC, anon;/.test(mig), 'fechadas ao anon (REVOKE), execução a authenticated/service_role')
ok(/'cliente_id', c\.id/.test(mig) && /'fornecedor_id', f\.id/.test(mig) && /'cnpj_cpf'/.test(mig), 'forma da resposta preservada (cliente_id/fornecedor_id, nome, cnpj_cpf, cidade) — não quebra a NF-e avulsa')
ok(!/\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b|\bDROP\b|ALTER TABLE/i.test(semComentarios), 'migration só de leitura: sem UPDATE/DELETE/DROP/ALTER em dado')

if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
console.log('check-busca-cliente-sem-acento-5451 OK')
