// Mapeamento PR → rotas tocadas (eng-chefe-auto · RD-97). Estático, sem login e sem rede: dados os arquivos
// alterados por uma PR, diz quais rotas do dashboard a PR toca e se ela exige auditoria do Hub.
//
// Para que serve: o plantão do auditor (CHECK do PDCA do Hub) decide, a cada PR publicada, entre
//   • auditoria COMPLETA (tocou tela do Hub, ou código compartilhado que pode regredir o Hub) e
//   • checagem BARATA (tocou outra vertical, sem nota de IA — RD-42) ou NADA (CI-only, sem tela).
// Antes isso era feito à mão (abrir os arquivos da PR e julgar). Esta função torna a decisão determinística.
//
// App Router: um arquivo em src/app/<segmentos>/<arquivo> pertence à rota "/<segmentos>". O Hub é tudo
// sob /dashboard/projetos. Código em src/components, src/lib, src/hooks etc. é COMPARTILHADO: pode afetar
// qualquer tela (inclusive o Hub), então, por segurança, também exige auditoria do Hub.

export const PREFIXO_HUB = '/dashboard/projetos'

// Arquivos especiais do App Router que definem/alteram o render de uma rota.
const ARQUIVOS_ROTA = new Set([
  'page.tsx', 'page.ts', 'page.jsx', 'page.js',
  'layout.tsx', 'layout.ts',
  'template.tsx', 'template.ts',
  'loading.tsx', 'error.tsx', 'not-found.tsx', 'default.tsx',
  'route.ts', 'route.tsx',
])

export type VereditoPR = 'hub' | 'compartilhado' | 'outra-vertical' | 'sem-tela'

export interface ClassificacaoPR {
  rotas: string[] // rotas de página diretamente tocadas (ordenadas, sem duplicata)
  rotasHub: string[] // subconjunto de `rotas` sob /dashboard/projetos
  tocaHub: boolean // alguma rota do Hub foi tocada diretamente
  compartilhados: string[] // arquivos compartilhados tocados (src/components, src/lib, src/hooks…)
  tocaCompartilhado: boolean
  outros: string[] // arquivos fora de telas e de código compartilhado (migrations, scripts, workflows, .md…)
  veredito: VereditoPR
  exigeAuditoriaHub: boolean // true = o auditor deve rodar auditoria completa do Hub
}

function normalizar(caminho: string): string {
  // aceita "a/b.tsx", "./a/b.tsx", "/a/b.tsx" e separador do Windows
  return caminho.trim().replace(/\\/g, '/').replace(/^\.?\/+/, '')
}

// src/app/dashboard/projetos/catalogo/page.tsx → /dashboard/projetos/catalogo
// src/app/dashboard/projetos/page.tsx          → /dashboard/projetos
// Qualquer arquivo sob src/app mapeia para o diretório que o contém (melhor esforço p/ arquivos colocados);
// para a decisão do Hub basta o prefixo, que é preservado.
function rotaDeArquivoApp(rel: string): string | null {
  if (!rel.startsWith('src/app/')) return null
  const resto = rel.slice('src/app/'.length)
  const partes = resto.split('/')
  partes.pop() // remove o nome do arquivo
  const rota = '/' + partes.filter((p) => p.length > 0 && !(p.startsWith('(') && p.endsWith(')'))).join('/')
  return rota === '/' ? '/' : rota.replace(/\/$/, '')
}

const COMPARTILHADO_PREFIXOS = ['src/components/', 'src/lib/', 'src/hooks/', 'src/contexts/', 'src/providers/', 'src/styles/']

export function classificarPR(arquivos: string[]): ClassificacaoPR {
  const rotas = new Set<string>()
  const compartilhados: string[] = []
  const outros: string[] = []

  for (const bruto of arquivos) {
    const rel = normalizar(bruto)
    if (!rel) continue
    if (rel.startsWith('src/app/')) {
      const r = rotaDeArquivoApp(rel)
      if (r) rotas.add(r)
      else outros.push(rel)
    } else if (COMPARTILHADO_PREFIXOS.some((p) => rel.startsWith(p))) {
      compartilhados.push(rel)
    } else {
      outros.push(rel)
    }
  }

  const rotasOrd = [...rotas].sort()
  const rotasHub = rotasOrd.filter((r) => r === PREFIXO_HUB || r.startsWith(PREFIXO_HUB + '/'))
  const tocaHub = rotasHub.length > 0
  const tocaCompartilhado = compartilhados.length > 0

  let veredito: VereditoPR
  if (tocaHub) veredito = 'hub'
  else if (tocaCompartilhado) veredito = 'compartilhado'
  else if (rotasOrd.length > 0) veredito = 'outra-vertical'
  else veredito = 'sem-tela'

  return {
    rotas: rotasOrd,
    rotasHub,
    tocaHub,
    compartilhados: compartilhados.sort(),
    tocaCompartilhado,
    outros: outros.sort(),
    veredito,
    exigeAuditoriaHub: veredito === 'hub' || veredito === 'compartilhado',
  }
}
