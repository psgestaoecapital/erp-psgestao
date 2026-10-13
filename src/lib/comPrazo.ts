// P0 · nenhuma tela presa em "Carregando…" (contexto 16bc8561). Uma promessa que NUNCA resolve
// (trava de sessão do supabase-js no mobile, rede que some) prende a tela para sempre — o catch só
// pega rejeição, não um pendurado. comPrazo() corre a promessa contra um prazo e, se estourar/falhar,
// tenta 1x de novo antes de desistir. Quem chama decide o que fazer no erro (ir p/ rota padrão ou
// mostrar "Não conseguimos carregar · Tentar de novo"). NUNCA spinner infinito.
//
// Camada 4 · "registro de travamentos": todo carregamento que estoura o prazo (pendurou) ou que
// demora mais de LIMITE_TELEMETRIA_MS (lento) é gravado fire-and-forget para o CEO/Eng. Chefe ver
// no dado onde/quanto trava (RD-38). A telemetria nunca bloqueia nem lança.
import { registrarTravamento } from '@/lib/telemetria'

// Acima disto um carregamento é "lento" o suficiente para registrar mesmo que tenha dado certo.
const LIMITE_TELEMETRIA_MS = 10000

export class PrazoEsgotado extends Error {
  constructor(public readonly label: string, public readonly ms: number) {
    super(`Prazo esgotado (${ms}ms) em: ${label}`)
    this.name = 'PrazoEsgotado'
  }
}

export interface ComPrazoOpts {
  ms?: number          // prazo por tentativa (default 8000)
  tentativas?: number  // re-tentativas automáticas após a 1ª (default 1 → 2 tentativas no total)
  label?: string       // rótulo p/ log/telemetria
}

/**
 * Corre `fn()` contra um prazo. Estourou ou rejeitou → tenta de novo (até `tentativas` vezes).
 * Esgotou tudo → lança o último erro (PrazoEsgotado no caso de timeout). Sucesso → devolve o valor.
 */
export async function comPrazo<T>(fn: () => Promise<T>, opts: ComPrazoOpts = {}): Promise<T> {
  const ms = opts.ms ?? 8000
  const tentativas = opts.tentativas ?? 1
  const label = opts.label ?? 'carregamento'
  const inicio = Date.now()
  let ultimoErro: unknown
  for (let i = 0; i <= tentativas; i++) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const valor = await Promise.race([
        fn(),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new PrazoEsgotado(label, ms)), ms) }),
      ])
      // Sucesso: se demorou demais (mesmo tendo carregado), registra como "lento".
      const dur = Date.now() - inicio
      if (dur > LIMITE_TELEMETRIA_MS) registrarTravamento(label, dur, false)
      return valor
    } catch (e) {
      ultimoErro = e
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  // Esgotou todas as tentativas: pendurou/falhou → registra como travamento (timeout=true se prazo).
  registrarTravamento(label, Date.now() - inicio, ultimoErro instanceof PrazoEsgotado)
  throw ultimoErro
}

export const MSG_CARREGAMENTO_FALHOU = 'Não conseguimos carregar. Tente de novo.'
