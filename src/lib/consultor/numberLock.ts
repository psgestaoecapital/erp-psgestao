/**
 * numberLock.ts — Consultor IA (PR B, item 4): "trava de número".
 *
 * Regra do Eng. Chefe: "o servidor confere se cada valor R$ citado aparece nos resultados das
 * ferramentas; se não, refaz uma vez; persistindo, mostra com o aviso 'confira este valor'."
 * Aqui só a CONFERÊNCIA (pura, testável). A rota decide refazer/avisar.
 *
 * Método: normaliza todo valor para CENTAVOS e compara o conjunto citado na resposta contra o
 * conjunto que aparece nos RESULTADOS das ferramentas (números crus e números dentro de strings).
 * Tolerância de ±1 centavo cobre arredondamento. Objetivo: pegar número INVENTADO — não é auditoria
 * contábil; um valor citado que não aparece em NENHUM resultado é suspeito e volta para a IA.
 */

/** Valores em R$ citados no texto da resposta: "R$ 1.234,56", "R$ 1234,56", "R$ 1.234", "R$ 50". */
export function valoresCitados(texto: string): string[] {
  const re = /R\$\s*(\d[\d.]*(?:,\d{1,2})?)/g
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(texto || ''))) out.push(m[1])
  return out
}

/** pt-BR "1.234,56" → 123456 centavos. */
function ptBrCentavos(s: string): number | null {
  const n = Number(s.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 100) : null
}
/** en "1,234.56" → 123456 centavos (interpretação alternativa, para dados crus da RPC). */
function enCentavos(s: string): number | null {
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

/** Conjunto de todos os valores (em centavos) que aparecem nos resultados das ferramentas. */
export function numerosDosResultados(resultados: unknown): Set<number> {
  const set = new Set<number>()
  const visit = (v: unknown) => {
    if (v == null) return
    if (typeof v === 'number') {
      if (Number.isFinite(v)) set.add(Math.round(v * 100))
      return
    }
    if (typeof v === 'string') {
      // Números dentro de strings: adiciona AS DUAS interpretações (pt-BR e en) — ser tolerante aqui
      // só evita falso-alarme; o que importa é não deixar passar número inventado.
      for (const mm of v.matchAll(/\d[\d.,]*\d|\d/g)) {
        const tok = mm[0]
        const a = ptBrCentavos(tok); if (a != null) set.add(a)
        const b = enCentavos(tok); if (b != null) set.add(b)
      }
      return
    }
    if (Array.isArray(v)) { v.forEach(visit); return }
    if (typeof v === 'object') { Object.values(v as Record<string, unknown>).forEach(visit); return }
  }
  visit(resultados)
  return set
}

export type ConferenciaNumeros = { ok: boolean; naoCasados: string[] }

/** Confere os valores R$ citados na resposta contra os resultados. tolCent cobre arredondamento. */
export function conferirNumeros(resposta: string, resultados: unknown, tolCent = 1): ConferenciaNumeros {
  const nums = numerosDosResultados(resultados)
  const naoCasados: string[] = []
  for (const cit of valoresCitados(resposta)) {
    const c = ptBrCentavos(cit)
    if (c == null) continue
    let casou = false
    for (let d = -tolCent; d <= tolCent && !casou; d++) if (nums.has(c + d)) casou = true
    if (!casou) naoCasados.push('R$ ' + cit)
  }
  return { ok: naoCasados.length === 0, naoCasados }
}
