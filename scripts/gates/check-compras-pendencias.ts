/**
 * Gate (#1677 B3): tela do comprador — solicitação aprovada vira pendência; a cotação nasce da solicitação (sem redigitar)
 * e abre direto na tela de Cotações que já existe. Confere a regra pura (filtro, link), a tela só pelas RPCs, o "?" com
 * chave cadastrada (RD-95), o menu/inventário e, no SQL: só solicitação aprovada vira cotação, não duplica cotação ativa,
 * guarda de empresa, REVOKE anon e migration aditiva.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { FILTROS_PENDENCIA, filtrarPorSituacao, linkCotacao } from '../../src/lib/compras/pendencias'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const lista = [{ situacao: 'pendente' }, { situacao: 'em_cotacao' }, { situacao: 'comprada' }, { situacao: 'pendente' }]
ok(filtrarPorSituacao(lista, 'pendente').length === 2, 'filtro Pendentes mostra só as sem cotação')
ok(filtrarPorSituacao(lista, 'comprada').length === 1, 'filtro Compradas mostra só as fechadas')
ok(filtrarPorSituacao(lista, 'todas').length === 4, 'filtro Todas mostra tudo')
ok(FILTROS_PENDENCIA[0].id === 'pendente', 'a tela abre nas pendentes')
ok(linkCotacao('abc-1') === '/dashboard/commerce/compras?area=gestao_empresarial&cotacao=abc-1', 'link abre a cotação na tela de Cotações')

const tela = readFileSync('src/app/dashboard/compras/pendencias/page.tsx', 'utf8')
const cotacoes = readFileSync('src/app/dashboard/commerce/compras/page.tsx', 'utf8')
// acha a migration pelo nome (a fila de merge pode renumerar a versão)
const migArq = readdirSync('supabase/migrations').find((f) => f.endsWith('_compras_pendencias_comprador.sql'))
const mig = migArq ? readFileSync(`supabase/migrations/${migArq}`, 'utf8') : ''
ok(!!migArq, 'migration das pendências de compra existe')
for (const fn of ['fn_compras_pendencias_listar', 'fn_compras_solicitacao_gerar_cotacao'])
  ok(tela.includes(`'${fn}'`) && mig.includes(`FUNCTION public.${fn}(`), `tela usa e migration cria ${fn}`)
ok(!/\.(insert|update|upsert|delete)\(/.test(tela), 'tela não escreve direto em tabela')
ok(/router\.push\(linkCotacao\(/.test(tela), 'Gerar/Abrir cotação leva à tela de Cotações')
ok(/useSearchParams\(\)\.get\('cotacao'\)/.test(cotacoes) && /setCotSel\(alvo\)/.test(cotacoes), 'tela de Cotações abre a cotação do link')
const chaves = [...tela.matchAll(/<AjudaCampo chave="([^"]+)"/g)].map((m) => m[1])
ok(chaves.length >= 5, `tela tem "?" no filtro, nas ações e nos blocos (${chaves.length})`)
for (const c of new Set(chaves)) ok(mig.includes(`'${c}'`), `chave de ajuda cadastrada: ${c}`)

const semCom = mig.replace(/--[^\n]*/g, '')
const corpo = (f: string) => semCom.slice(semCom.indexOf(`FUNCTION public.${f}(`), semCom.indexOf('END $$', semCom.indexOf(`FUNCTION public.${f}(`)))
const gerar = corpo('fn_compras_solicitacao_gerar_cotacao')
ok(/fn__guarda_empresa\(s\.company_id\)/.test(gerar), 'gerar cotação confere a empresa')
ok(/s\.status <> 'aprovada'/.test(gerar), 'só solicitação aprovada vira cotação')
ok(/solicitacao_id = p_id[\s\S]*<> 'cancelada'[\s\S]*'ja_existia',true/.test(gerar), 'não duplica cotação ativa da mesma solicitação')
ok(/p\.company_id = s\.company_id/.test(gerar), 'produto do item só da mesma empresa')
ok(/get_user_company_ids\(\)/.test(corpo('fn_compras_pendencias_listar')), 'listar confere a empresa')
for (const f of ['fn_compras_solicitacao_gerar_cotacao', 'fn_compras_pendencias_listar'])
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\(uuid\\) FROM anon`).test(semCom), `anon sem acesso a ${f}`)
ok(/ALTER TABLE public\.erp_cotacoes ADD COLUMN IF NOT EXISTS solicitacao_id uuid/.test(semCom), 'vínculo cotação → solicitação (coluna nova)')
ok(/INSERT INTO public\.module_catalog[\s\S]*'\/dashboard\/compras\/pendencias'/.test(mig), 'tela entra no menu (module_catalog)')
ok(/INSERT INTO public\.system_screens[\s\S]*'\/dashboard\/compras\/pendencias'/.test(mig), 'tela no inventário (system_screens)')
ok(!/\b(DROP TABLE|DROP FUNCTION|DROP POLICY|CREATE POLICY|DELETE FROM|UPDATE public\.erp_)/i.test(semCom), 'migration aditiva (sem DROP, policy, DELETE nem UPDATE em dado)')

if (falhas) { console.error(`\n[check-compras-pendencias] ${falhas} falha(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-compras-pendencias] pendências de compra conferidas.')
