// Gate (jordana-code · 20/10, Proplay/Pdois) — nenhum hook do React DEPOIS de um retorno antecipado no corpo do
// componente. O NFSePreviewModal tinha `if (!props.open) return null` seguido de `useRef(...)`: montado fechado
// (EmitirNFSeButton) e aberto no clique, a contagem de hooks mudava e o React derrubava a tela inteira
// ("This page couldn't load"). Resultado: nenhuma NFS-e emitida pelo título de 17/10 a 20/10 em nenhuma empresa.
// Checagem estática: em .tsx de src/, uma linha de hook no nível do componente (2 espaços) depois de
// `  if (...) return ...` no mesmo componente (até a `}` de coluna 0) reprova.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RETORNO = /^ {2}if \(.+\) return\b/
const HOOK = /^ {2}(?:(?:const|let|var)\s+[^=]+=\s*)?use[A-Z]\w*\s*[<(]/

export function violacoes(texto: string): number[] {
  const linhas = texto.split('\n')
  const achadas: number[] = []
  let retornou = false
  linhas.forEach((l, i) => {
    if (/^\S/.test(l)) retornou = false // nova declaração de coluna 0 = outro componente/função
    if (RETORNO.test(l)) retornou = true
    else if (retornou && HOOK.test(l)) achadas.push(i + 1)
  })
  return achadas
}

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return arquivos(p)
    return p.endsWith('.tsx') ? [p] : []
  })
}

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── a regra pega o caso real e não acusa o certo ────────────────────────────────────────────────────────────
ok(violacoes('function M(props) {\n  const [a] = useState(0)\n  if (!props.open) return null\n\n  const r = useRef<string | null>(null)\n  return <div/>\n}').length === 1,
  'regra: hook depois de `if (...) return null` reprova (caso do NFSePreviewModal)')
ok(violacoes('function M(props) {\n  const r = useRef(null)\n  if (!props.open) return null\n  return <div/>\n}\nfunction N() {\n  const [b] = useState(1)\n  return null\n}').length === 0,
  'regra: hook antes do retorno, e hook de outro componente, não reprovam')

// ── o modal da NFS-e ────────────────────────────────────────────────────────────────────────────────────────
const modal = readFileSync('src/components/fiscal/NFSePreviewModal.tsx', 'utf8')
ok(violacoes(modal).length === 0, 'NFSePreviewModal: nenhum hook depois de `if (!props.open) return null`')

// ── varredura de src/ ───────────────────────────────────────────────────────────────────────────────────────
const achados = arquivos('src').flatMap((f) => violacoes(readFileSync(f, 'utf8')).map((n) => `${f}:${n}`))
ok(achados.length === 0, `src/: nenhum hook depois de retorno antecipado${achados.length ? ` — ${achados.join(', ')}` : ''}`)

if (falhas) { console.error(`\n${falhas} falha(s) em check-hook-depois-de-return`); process.exit(1) }
