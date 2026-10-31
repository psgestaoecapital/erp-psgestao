// Gate (CEO 10/10) — tema por usuário. Confere a fonte única dos presets, que o semáforo NUNCA é tematizado, a trava
// dos documentos (@media print na marca), o modo claro, a RLS por usuário (sem company_id) e os "?" da tela.
import { readFileSync } from 'node:fs'
import { MODO_DEFAULT, TEMA_DEFAULT, TEMA_PRESETS, corDestaque, presetPorId, resolverModo } from '../../src/theme/theme-presets'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

// ── presets: fonte única, curada ────────────────────────────────────────────────────────────────────────────────
ok(TEMA_PRESETS.length >= 7 && TEMA_PRESETS[0].id === 'dourado' && TEMA_DEFAULT === 'dourado' && MODO_DEFAULT === 'automatico',
  'presets: fonte única, dourado é o default (1º), modo automático por padrão')
ok(TEMA_PRESETS.every((p) => /^#[0-9A-Fa-f]{6}$/.test(p.dia) && /^#[0-9A-Fa-f]{6}$/.test(p.noite)),
  'presets: cada um tem hex válido para claro (dia) e escuro (noite)')
ok(!TEMA_PRESETS.some((p) => /verde|vinho|green|wine/i.test(p.id) || /verde|vinho/i.test(p.nome)),
  'presets: sem verde nem vinho (conflito com o semáforo) até o CEO mudar a regra')
// funções puras
ok(resolverModo('automatico', true) === 'escuro' && resolverModo('automatico', false) === 'claro'
  && resolverModo('claro', true) === 'claro', 'resolverModo: automático segue o aparelho; claro/escuro mandam')
ok(corDestaque(presetPorId('roxo'), 'escuro') === presetPorId('roxo').noite && presetPorId('xyz').id === 'dourado',
  'corDestaque usa o hex do modo; preset desconhecido cai no default')

// ── aplicação: só destaque + modo; NUNCA o semáforo ─────────────────────────────────────────────────────────────
const ap = readFileSync('src/theme/aplicar-tema.ts', 'utf8')
ok(/setProperty\('--gold'/.test(ap) && /setAttribute\('data-modo'/.test(ap), 'applier: seta --gold e data-modo (claro/escuro)')
ok(!/--green|--red|--yellow/.test(ap), 'applier: NUNCA mexe no semáforo (--green/--yellow/--red)')
const lay = readFileSync('src/app/dashboard/layout.tsx', 'utf8')
ok(/ThemeApplier/.test(lay), 'ThemeApplier montado no layout do dashboard')

// ── globals: modo claro + trava de documento (impressão na marca) ───────────────────────────────────────────────
const css = readFileSync('src/app/globals.css', 'utf8')
ok(/:root\[data-modo="claro"\]/.test(css), 'globals: modo claro definido (tokens de superfície)')
ok(/@media print/.test(css) && /--gold: #C6973F/.test(css.slice(css.indexOf('@media print'))),
  'globals: @media print força a marca PS (documentos nunca saem no tema do usuário)')

// ── migration: RLS por usuário, sem company_id, defaults, chaves de ajuda ───────────────────────────────────────
const mig = readFileSync('supabase/migrations/20261010190005_tema_por_usuario.sql', 'utf8')
ok(/CREATE TABLE IF NOT EXISTS public\.erp_usuario_preferencia/.test(mig) && !/company_id\s+(uuid|text)/.test(mig) && !/company_id\s*=/.test(mig),
  'migration: erp_usuario_preferencia SEM coluna company_id (é do usuário, não da empresa)')
ok(/ENABLE ROW LEVEL SECURITY/.test(mig) && /REVOKE ALL ON public\.erp_usuario_preferencia FROM PUBLIC, anon/.test(mig)
  && (mig.match(/auth\.uid\(\) = user_id/g) ?? []).length >= 3,
  'migration: RLS ligada, REVOKE anon, policies só auth.uid()=user_id (select/insert/update)')
ok(/DEFAULT 'dourado'/.test(mig) && /DEFAULT 'automatico'/.test(mig) && /CHECK \(modo IN \('claro', 'escuro', 'automatico'\)\)/.test(mig),
  'migration: default dourado/automatico e modo válido')
ok(['tema', 'modo', 'semaforo', 'documentos'].every((k) => mig.includes(`configuracoes.aparencia.${k}`)),
  'migration: "?" (erp_ajuda_campo) para tema, modo, semáforo e documentos (RD-95)')

// ── tela: usa os "?" e os presets da fonte única ────────────────────────────────────────────────────────────────
const pg = readFileSync('src/app/dashboard/configuracoes/aparencia/page.tsx', 'utf8')
ok(/from '@\/theme\/theme-presets'/.test(pg) && /aplicarTema\(/.test(pg), 'tela: usa a fonte única de presets e aplica a prévia ao vivo')
ok(['tema', 'modo', 'semaforo', 'documentos'].every((k) => pg.includes(`configuracoes.aparencia.${k}`)), 'tela: "?" em tema, modo, semáforo e documentos')

if (falhas) { console.error(`\ncheck-tema-por-usuario: ${falhas} falha(s)`); process.exit(1) }
console.log('\nTema por usuário: ok')
