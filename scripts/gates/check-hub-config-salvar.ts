// Gate (PDCA Hub 24/10): Configurações do Hub grava de verdade. projetos_modulo_config só tem policy de SELECT,
// então a tela grava pela RPC fn_projetos_config_salvar (guardada), com os nomes REAIS das colunas
// (bdi_admin_central_pct / bdi_garantias_pct). Toggle sem consumidor (Omie) aparece desligado como "Em breve".
import { readFileSync, readdirSync } from 'node:fs'
let falhas = 0
const ok = (c: boolean, m: string) => { console.log(`${c ? 'ok  ' : 'FALHA'} ${m}`); if (!c) falhas++ }

const tela = readFileSync('src/app/dashboard/projetos/configuracoes/page.tsx', 'utf8')
ok(!/bdi_administracao_central_pct|bdi_garantia_pct\b/.test(tela), 'a tela não usa nomes de coluna inexistentes')
ok(!/from\("projetos_modulo_config"\)\s*\.update\(/.test(tela), 'a tela não faz UPDATE direto (a tabela só tem policy de leitura)')
ok(/rpc\("fn_projetos_config_salvar"/.test(tela), 'o autosave grava pela RPC fn_projetos_config_salvar')
// Omie e aprovação do engenheiro ainda não têm consumidor: desde o #3374 (RD-96) saíram do caminho principal e foram
// para a seção "No roadmap · em breve" (array ROADMAP), como itens informativos — NÃO como toggle que finge salvar.
const roadmap = tela.match(/const ROADMAP[^=]*=\s*\[([\s\S]*?)\];/)?.[1] ?? ''
const omieRoadmap = [...roadmap.matchAll(/label:\s*"([^"]*\bOmie\b[^"]*)"/g)].map((m) => m[1])
ok(/No roadmap[\s\S]{0,80}?em breve/i.test(tela) && omieRoadmap.length === 2, `integrações Omie (sem consumidor) ficam no roadmap "em breve", não como toggle (${omieRoadmap.length})`)

const migs = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
const sql = migs.map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
const fn = migs.find((f) => /CREATE (OR REPLACE )?FUNCTION public\.fn_projetos_config_salvar/.test(readFileSync(`supabase/migrations/${f}`, 'utf8')))
const corpo = fn ? readFileSync(`supabase/migrations/${fn}`, 'utf8') : ''
ok(!!fn, `migration da RPC presente (${fn ?? 'nenhuma'})`)
ok(/get_user_company_ids\(\)/.test(corpo) && /42501/.test(corpo), 'a RPC barra empresa de fora do usuário')
ok(/REVOKE ALL ON FUNCTION public\.fn_projetos_config_salvar\(uuid, jsonb\) FROM PUBLIC, anon/.test(corpo), 'anon não executa a RPC')
const payload = tela.match(/const payload = \{([\s\S]*?)\};/)?.[1] ?? ''
const chaves = [...payload.matchAll(/^\s*(\w+):/gm)].map((m) => m[1])
const fora = chaves.filter((k) => !corpo.includes(`'${k}'`))
ok(chaves.length >= 16 && fora.length === 0, `toda chave enviada é gravada pela RPC (${chaves.length}${fora.length ? '; ignoradas: ' + fora.join(', ') : ''})`)

const ajudas = new Set([...tela.matchAll(/ajuda="([^"]+)"/g)].map((m) => m[1]))
const semAjuda = [...ajudas].filter((k) => !sql.includes(`'${k}'`))
// Piso ajustado de 19 → 16 (PDCA Hub 28/10): o #3374 ("recursos Em breve fora do caminho principal", RD-96) tirou do
// caminho principal os 3 toggles ainda sem consumidor — exige_engenheiro, omie_estoque e omie_pagar — e com eles o "?".
// A régua real (todo "?" visível tem ajuda no banco: semAjuda === 0) continua intacta; só o piso de contagem foi
// realinhado ao número de campos que a tela de fato mostra hoje, senão o gate fica vermelho na main sem campo descoberto.
ok(ajudas.size >= 16 && semAjuda.length === 0, `todo "?" da tela tem ajuda em migration (${ajudas.size}${semAjuda.length ? '; faltam ' + semAjuda.join(', ') : ''})`)
if (falhas) process.exit(1)
