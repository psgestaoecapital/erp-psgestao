// Mapeia os arquivos tocados por uma PR → rotas do Hub afetadas — ferramenta do eng-chefe-auto.
// Serve à regra do plantão (CEO 16/10): PR que toca tela do Hub → auditoria completa; PR de outra vertical → só
// checagem barata. Puro (sem rede): recebe a lista de caminhos alterados (git diff --name-only) e decide.
//
// Uso:
//   git diff --name-only origin/main...HEAD | npm run hub:pr-rotas
//   npm run hub:pr-rotas -- src/app/dashboard/projetos/insumos/page.tsx src/components/hub/Foo.tsx

const PREFIXO_APP_HUB = 'src/app/dashboard/projetos/'
// Palavras do Hub para pegar componentes/libs compartilhados do Hub fora de src/app/dashboard/projetos.
const PALAVRAS_HUB = ['projetos', '/hub', 'obra', 'takeoff', 'insumo', 'mao-obra', 'mao_de_obra', 'orcamento-hub', 'calculadora-obra']

export interface MapaRotas {
  tocou_hub: boolean
  rotas_hub: string[]            // rotas derivadas de page.tsx/layout.tsx em src/app/dashboard/projetos
  componentes_hub: string[]      // outros arquivos que cheiram a Hub (componentes/libs compartilhados)
  veredito: 'auditoria-completa' | 'checagem-barata'
}

// src/app/dashboard/projetos/insumos/page.tsx → /dashboard/projetos/insumos
function rotaDeArquivoApp(path: string): string | null {
  if (!path.startsWith('src/app/')) return null
  if (!/\/(page|layout)\.tsx?$/.test(path)) return null
  let rota = path.replace(/^src\/app/, '').replace(/\/(page|layout)\.tsx?$/, '')
  // Remove grupos de rota do Next (pastas entre parênteses) e normaliza.
  rota = rota.replace(/\/\([^/]+\)/g, '')
  return rota || '/'
}

export function mapearRotas(paths: string[]): MapaRotas {
  const limpos = paths.map((p) => p.trim().replace(/^\.\//, '')).filter(Boolean)
  const rotasHub = new Set<string>()
  const componentesHub = new Set<string>()

  for (const p of limpos) {
    if (p.startsWith(PREFIXO_APP_HUB)) {
      const rota = rotaDeArquivoApp(p)
      if (rota && rota.startsWith('/dashboard/projetos')) rotasHub.add(rota)
      else componentesHub.add(p) // ex.: arquivo de apoio dentro da pasta do Hub que não é page/layout
      continue
    }
    const n = p.toLowerCase()
    if (PALAVRAS_HUB.some((w) => n.includes(w))) componentesHub.add(p)
  }

  const tocouHub = rotasHub.size > 0 || componentesHub.size > 0
  return {
    tocou_hub: tocouHub,
    rotas_hub: Array.from(rotasHub).sort(),
    componentes_hub: Array.from(componentesHub).sort(),
    veredito: tocouHub ? 'auditoria-completa' : 'checagem-barata',
  }
}

async function lerStdin(): Promise<string[]> {
  if (process.stdin.isTTY) return []
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf-8').split('\n')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const paths = args.length ? args : await lerStdin()
  const mapa = mapearRotas(paths)
  console.log(JSON.stringify(mapa, null, 2))
  console.log(`\n→ ${mapa.veredito === 'auditoria-completa'
    ? `Tocou o Hub: auditoria COMPLETA (${mapa.rotas_hub.length} rota(s), ${mapa.componentes_hub.length} componente(s))`
    : 'Não tocou o Hub: checagem BARATA (abre, sem erro de console, sem 4xx/5xx/404, sem lentidão)'}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('pr-rotas-tocadas falhou:', err); process.exit(1) })
}
