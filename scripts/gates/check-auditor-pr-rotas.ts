// Gate (eng-chefe-auto · RD-97) — prova o mapeador PR → rotas tocadas (src/lib/dev/prRotas.ts), a ferramenta
// que decide, por PR publicada, entre auditoria completa do Hub e checagem barata. Estático, sem rede nem login.
// Também confere que a CLI (scripts/auditor/pr-rotas-tocadas.ts) existe e usa a mesma biblioteca.
import { readFileSync, existsSync } from 'node:fs'
import { classificarPR, PREFIXO_HUB } from '../../src/lib/dev/prRotas'

let falhas = 0
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    falhas++
    console.error('✗', msg)
  } else console.log('✓', msg)
}

// (1) prefixo do Hub
ok(PREFIXO_HUB === '/dashboard/projetos', 'prefixo do Hub = /dashboard/projetos')

// (2) PR que toca uma tela do Hub → veredito 'hub', exige auditoria
{
  const c = classificarPR(['src/app/dashboard/projetos/catalogo/page.tsx', 'README.md'])
  ok(c.veredito === 'hub' && c.exigeAuditoriaHub, 'tela do Hub → veredito hub + exige auditoria')
  ok(c.rotasHub.includes('/dashboard/projetos/catalogo'), 'rota do Hub mapeada corretamente')
  ok(c.outros.includes('README.md'), 'arquivo fora de tela cai em "outros"')
}

// (3) rota dinâmica e raiz do Hub
{
  const c = classificarPR(['src/app/dashboard/projetos/obras/[id]/cockpit/page.tsx'])
  ok(c.tocaHub && c.rotasHub[0] === '/dashboard/projetos/obras/[id]/cockpit', 'rota dinâmica do Hub preserva [id]')
  const raiz = classificarPR(['src/app/dashboard/projetos/page.tsx'])
  ok(raiz.rotasHub.includes('/dashboard/projetos'), 'raiz do Hub (/dashboard/projetos) detectada')
}

// (4) outra vertical (não-Hub) → checagem barata, NÃO exige auditoria do Hub
{
  const c = classificarPR(['src/app/dashboard/financeiro/pagar/page.tsx'])
  ok(c.veredito === 'outra-vertical' && !c.exigeAuditoriaHub, 'tela de outra vertical → outra-vertical, sem auditoria do Hub')
  ok(c.tocaHub === false, 'financeiro não é Hub')
}

// (5) código compartilhado → pode regredir o Hub → exige auditoria do Hub
{
  const c = classificarPR(['src/components/ajuda/AjudaCampo.tsx', 'src/lib/formato.ts'])
  ok(c.veredito === 'compartilhado' && c.exigeAuditoriaHub, 'compartilhado → exige auditoria do Hub (conservador)')
  ok(c.compartilhados.length === 2 && c.rotas.length === 0, 'compartilhado não vira rota')
}

// (6) PR só de CI/infra (sem tela, sem compartilhado) → sem-tela, nada a auditar (ex.: a #2893 real)
{
  const c = classificarPR(['scripts/merge/fila-merge.sh', '.github/workflows/gates.yml', 'supabase/migrations/20260101000000_x.sql'])
  ok(c.veredito === 'sem-tela' && !c.exigeAuditoriaHub, 'CI/infra puro → sem-tela, nada a auditar')
}

// (7) Hub vence compartilhado quando ambos aparecem
{
  const c = classificarPR(['src/app/dashboard/projetos/obras/page.tsx', 'src/components/x/Y.tsx'])
  ok(c.veredito === 'hub' && c.exigeAuditoriaHub, 'Hub + compartilhado → veredito hub')
}

// (8) normalização de caminhos (./, /, barra invertida) e vazios
{
  const c = classificarPR(['./src/app/dashboard/projetos/visitas/page.tsx', '', '  ', 'src\\app\\dashboard\\financeiro\\receber\\page.tsx'])
  ok(c.tocaHub && c.rotasHub.includes('/dashboard/projetos/visitas'), 'caminho ./ e vazio normalizados')
  ok(c.rotas.includes('/dashboard/financeiro/receber'), 'separador do Windows normalizado')
}

// (9) grupos de rota (parênteses) são ignorados no caminho da rota
{
  const c = classificarPR(['src/app/(app)/dashboard/projetos/takeoff/page.tsx'])
  ok(c.rotasHub.includes('/dashboard/projetos/takeoff'), 'grupo de rota (app) não entra na URL')
}

// (10) a CLI existe e reusa a biblioteca (não reimplementa a regra)
{
  const cli = 'scripts/auditor/pr-rotas-tocadas.ts'
  ok(existsSync(cli), `CLI ${cli} existe`)
  const src = existsSync(cli) ? readFileSync(cli, 'utf8') : ''
  ok(/from '\.\.\/\.\.\/src\/lib\/dev\/prRotas'/.test(src) && /classificarPR/.test(src), 'CLI importa classificarPR da biblioteca')
}

if (falhas) {
  console.error(`\n[check-auditor-pr-rotas] ${falhas} falha(s)`)
  process.exit(1)
}
console.log('\n[check-auditor-pr-rotas] OK')
