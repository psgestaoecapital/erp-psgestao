#!/usr/bin/env tsx
// Publicar SEM re-teste quando a mudança da main não tem relação com a PR (CEO 19/10; Eng. Chefe 18/10 22:10).
// Hoje a PR verde que fica atrás da main é atualizada e re-testada inteira. Esta decisão PURA diz quando o re-teste pode ser
// dispensado. TODAS as condições são obrigatórias:
//   (1) nenhum arquivo em comum entre a PR e os commits que entraram na main desde o teste verde dela;
//   (2) nenhuma das duas tem migration;
//   (3) a PR não toca núcleo compartilhado (auth/RBAC, supabase/functions, middleware, scripts/merge, scripts/banco-testes, workflows);
//   (4) o teste verde tem no máximo 2 h.
// PROTEÇÃO: aceitação da main (vaga 1) vermelha (ou desconhecida) → desliga sozinha, volta quando ficar verde.
// Fail-closed: qualquer dado ausente = exige o re-teste. CLI: JSON em stdin → {"dispensa":bool,"motivo":"..."}.
export const TESTE_VERDE_MAX_MS = 2 * 60 * 60 * 1000

export type EntradaSemReteste = {
  arquivosPr: string[]
  arquivosMain: string[] // arquivos dos commits que entraram na main desde o teste verde da PR
  testeVerdeEm: string | null // ISO do fim do teste verde da PR
  agora: string // ISO
  mainVerde: boolean | null // aceitação da main (vaga 1); null = desconhecida
}
export type DecisaoSemReteste = { dispensa: boolean; motivo: string }

const MIGRATION = /^supabase\/migrations\//
const NUCLEO = [
  /^src\/middleware\./,
  /^middleware\./,
  /^src\/(lib|libs|server)\/.*(auth|rbac|permiss|guarda)/,
  /^src\/app\/api\/auth\//,
  /^supabase\/functions\//,
  /^scripts\/merge\//,
  /^scripts\/banco-testes\//,
  /^\.github\/workflows\//,
]

export function decidirSemReteste(e: EntradaSemReteste): DecisaoSemReteste {
  const nao = (motivo: string) => ({ dispensa: false, motivo })
  if (e.mainVerde !== true) return nao(`aceitação da main ${e.mainVerde === false ? 'vermelha' : 'desconhecida'}: proteção ligada, re-testa`)
  if (!e.testeVerdeEm) return nao('PR sem teste verde registrado: re-testa')
  const idade = Date.parse(e.agora) - Date.parse(e.testeVerdeEm)
  if (!Number.isFinite(idade) || idade < 0) return nao('horário do teste ilegível: re-testa')
  if (idade > TESTE_VERDE_MAX_MS) return nao(`teste verde com ${Math.round(idade / 60000)} min (máx. 120): re-testa`)
  const mig = [...e.arquivosPr, ...e.arquivosMain].find((f) => MIGRATION.test(f))
  if (mig) return nao(`migration (${mig}): re-testa`)
  const nuc = e.arquivosPr.find((f) => NUCLEO.some((r) => r.test(f)))
  if (nuc) return nao(`PR toca núcleo compartilhado (${nuc}): re-testa`)
  if (e.arquivosPr.length === 0 || e.arquivosMain.length === 0) return nao('lista de arquivos vazia (dado ausente): re-testa')
  const main = new Set(e.arquivosMain)
  const comum = e.arquivosPr.find((f) => main.has(f))
  if (comum) return nao(`arquivo em comum com a main (${comum}): re-testa`)
  return { dispensa: true, motivo: 'sem arquivo em comum, sem migration, sem núcleo, teste ≤ 2 h, main verde: publica sem re-teste' }
}

async function main(): Promise<void> {
  let txt = ''
  for await (const c of process.stdin) txt += c
  try {
    process.stdout.write(JSON.stringify(decidirSemReteste(JSON.parse(txt))))
  } catch {
    process.stdout.write(JSON.stringify({ dispensa: false, motivo: 'entrada ilegível: re-testa' }))
  }
}

if (process.argv[1] && /\/publicar-sem-reteste\.ts$/.test(process.argv[1])) void main()
