// Gate (CEO 25/11) — Indústria · RH · Folha › Encargos. Trava no estático o que não pode regredir na entrega:
//   1) a tela /dashboard/industrial/rh/folha existe, tem <h1>, usa AbasRH e renderiza a aba "Encargos" (EncargosFolha);
//   2) o editor EncargosFolha lê e grava pelos RPCs certos (fn_mao_obra_encargos_vigentes / fn_mao_obra_encargos_salvar);
//   3) o salvar PRESERVA os padrões da ficha (round-trip) — senão o INSERT…ON CONFLICT com defaults os zeraria (RD-97);
//   4) os campos-chave do editor têm data-testid (prova de caminho real) e o "?" aponta para a rota da ajuda publicada.
// Só leitura estática; sem rede, banco ou variável.  npm run gates -- rh-folha-encargos
import { readFileSync, existsSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }
const ler = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

const pagina = ler('src/app/dashboard/industrial/rh/folha/page.tsx')
const editor = ler('src/components/rh/EncargosFolha.tsx')

// 1) a tela
ok(!!pagina, 'página src/app/dashboard/industrial/rh/folha/page.tsx existe')
ok(/<h1\b/.test(pagina), 'página tem <h1> (RD-26)')
ok(/\bAbasRH\b/.test(pagina) && /EncargosFolha/.test(pagina), 'página usa AbasRH e renderiza EncargosFolha')
ok(/chave:\s*'encargos'/.test(pagina), 'aba "encargos" declarada')

// 2) os RPCs certos
ok(!!editor, 'componente src/components/rh/EncargosFolha.tsx existe')
ok(/fn_mao_obra_encargos_vigentes/.test(editor), 'EncargosFolha lê por fn_mao_obra_encargos_vigentes')
ok(/fn_mao_obra_encargos_salvar/.test(editor), 'EncargosFolha grava por fn_mao_obra_encargos_salvar')

// 3) round-trip dos padrões da ficha (RD-97): o salvar reenvia os padrões vindos de `padroes`
for (const campo of ['horas_produtivas_padrao', 'vinculo_padrao', 'dsr_fator', 'salario_minimo_ref', 'incidencia_padrao']) {
  ok(new RegExp(`${campo}\\s*:`).test(editor), `salvar preserva padrão da ficha: ${campo}`)
}
ok(/enc\.padroes|\.padroes\s*\?\?/.test(editor), 'salvar parte dos padrões vigentes (round-trip), não de defaults')

// 4) caminho real + ajuda
for (const t of ['folha-encargos', 'folha-regime', 'folha-inss', 'folha-rat', 'folha-fgts', 'folha-encargos-salvar', 'folha-encargos-confirmar']) {
  ok(editor.includes(`data-testid="${t}"`), `data-testid presente: ${t}`)
}
ok(/AjudaCampo/.test(editor) && /rota=\{AJUDA_ROTA\}/.test(editor), 'campos têm "?" apontando para a rota da ajuda publicada (RD-95)')

if (falhas > 0) { console.error(`\n[check-rh-folha-encargos] ${falhas} verificação(ões) falharam`); process.exit(1) }
console.log('\n[check-rh-folha-encargos] OK')
