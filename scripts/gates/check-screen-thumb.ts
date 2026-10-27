/**
 * Gate de build (miniatura base64 da foto da tela, para o aud8 ler por SELECT no Max).
 * Prova estática, sem rede:
 *   1) tabela erp_screen_thumb: RLS ligada, sem acesso a anon/authenticated (só service_role);
 *   2) fn_screenshot_thumb: SECURITY DEFINER, só lê, REVOKE de PUBLIC/anon/authenticated;
 *   3) helper: largura 480, limite de 120 KB, Page.captureScreenshot com clip.scale (sem mexer no viewport);
 *   4) a captura grava a miniatura por rotaBase, e a falha não derruba a captura (catch).
 *   npm run gates -- screen-thumb
 */
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const migDir = 'supabase/migrations'
const mig = readFileSync(`${migDir}/${readdirSync(migDir).find(f => f.endsWith('_erp_screen_thumb_fn_screenshot_thumb.sql'))}`, 'utf8').replace(/--[^\n]*/g, '')
const helper = readFileSync('src/lib/gold/miniaturaRota.ts', 'utf8')
const rota = readFileSync('src/app/api/screen-watcher/playwright/route.ts', 'utf8')

ok(/CREATE TABLE IF NOT EXISTS public\.erp_screen_thumb \(\s*rota\s+text PRIMARY KEY,\s*thumb_b64\s+text NOT NULL/.test(mig), 'tabela erp_screen_thumb com rota PK e thumb_b64 obrigatório')
ok(/ENABLE ROW LEVEL SECURITY/.test(mig) && /REVOKE ALL ON TABLE public\.erp_screen_thumb FROM PUBLIC, anon, authenticated/.test(mig), 'tabela: RLS ligada e REVOKE de PUBLIC/anon/authenticated')
ok(/GRANT ALL ON TABLE public\.erp_screen_thumb TO service_role/.test(mig) && !/GRANT[^;]*TO (anon|authenticated|PUBLIC)[^;]*erp_screen_thumb/i.test(mig), 'tabela: grant só para service_role')
ok(/CREATE OR REPLACE FUNCTION public\.fn_screenshot_thumb\(p_rota text\)[\s\S]*?SECURITY DEFINER/.test(mig), 'fn_screenshot_thumb é SECURITY DEFINER')
ok(/REVOKE ALL ON FUNCTION public\.fn_screenshot_thumb\(text\) FROM PUBLIC, anon, authenticated/.test(mig) && /GRANT EXECUTE ON FUNCTION public\.fn_screenshot_thumb\(text\) TO service_role/.test(mig), 'fn_screenshot_thumb: REVOKE de anon/authenticated e EXECUTE só service_role')
ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(mig.slice(mig.indexOf('FUNCTION public.fn_screenshot_thumb'), mig.indexOf('$fn$;'))), 'fn_screenshot_thumb só lê (sem INSERT/UPDATE/DELETE)')

ok(/MINIATURA_LARGURA = 480/.test(helper) && /MINIATURA_LIMITE_B64 = 120 \* 1024/.test(helper), 'helper: largura 480 e limite de 120 KB')
ok(/Page\.captureScreenshot/.test(helper) && /scale: MINIATURA_LARGURA \/ VIEWPORT_LARGURA/.test(helper) && !/setDeviceMetricsOverride/.test(helper), 'helper: captura pelo CDP com clip.scale, sem mexer no viewport')

ok(/import \{ salvarMiniaturaRota \} from '@\/lib\/gold\/miniaturaRota'/.test(rota), 'rota importa salvarMiniaturaRota')
ok(/salvarMiniaturaRota\(supabase, rotaBase, page, alturaCaptura\)\.catch\(/.test(rota), 'rota grava a miniatura por rotaBase e a falha não derruba a captura')

if (falhas > 0) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nOK: miniatura base64 da tela (RLS, guarda, limite e captura) provada')
