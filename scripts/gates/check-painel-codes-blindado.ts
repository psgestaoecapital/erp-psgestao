// Gate (CEO 16/10) — a aba Codes não pode cair inteira: cada bloco fica sob BlocoSeguro, o painel monta <MeuCode/> uma
// única vez e nenhum componente da aba assina canal Realtime de nome fixo compartilhado (o 2º .on() depois do subscribe()
// lança exceção e derruba a página — "This page couldn't load" no celular).
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const painel = readFileSync('src/components/dev/PainelCodes.tsx', 'utf8')
const meu = readFileSync('src/components/dev/MeuCode.tsx', 'utf8')
const canal = readFileSync('src/components/dev/CanalPs.tsx', 'utf8')

ok((painel.match(/<MeuCode\b/g) ?? []).length === 1, 'PainelCodes monta <MeuCode/> uma única vez')
for (const n of ['SaudeEsteira', 'SaudeCodes', 'GraficosCodes', 'MeuCode', 'EsperandoOkCeo', 'CartaoCode', 'ConectarClaude', 'LinhaDoTempo', 'ResumoPorCode', 'CartaoAuditor']) {
  ok(new RegExp(`<BlocoSeguro[^>]*>\\s*<${n}\\b`).test(painel), `${n} protegido por BlocoSeguro`)
}
ok(/supabase\.channel\(`dev-meu-code-\$\{/.test(meu), 'MeuCode usa canal Realtime único por instância')
ok(/supabase\.channel\(`dev-codes-ok-ceo-\$\{/.test(canal), 'EsperandoOkCeo usa canal Realtime único por instância')
process.exit(falhas ? 1 : 0)
