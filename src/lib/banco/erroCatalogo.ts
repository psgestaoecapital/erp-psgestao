// Erro do banco → linha do catálogo erp_banco_erro_catalogo (o que é, o que fazer, o que pedir ao banco).
// Antes só o Assistente usava; a tela de Conexões mostrava o erro cru ("401 invalid_grant") — #88 (FC, 29/09).
// Só casa o que reconhece COM CONFIANÇA: nada casou ⇒ null e a tela mostra o erro cru (RD-51/RD-58: erro não
// reconhecido é melhor que erro errado). Gate: scripts/check-sicredi-erro-claro.ts.

export type ErroCatalogo = {
  provider: string
  codigo: string
  titulo: string
  o_que_e: string
  o_que_fazer: string
  quem_contatar: string | null
  pedir_ao_banco?: string | null
}

export const ERRO_MATCHERS: { re: RegExp; codigo: string }[] = [
  { re: /invalid_grant|invalid user credentials/i, codigo: '401_invalid_user_credentials' },
  { re: /10 caracteres|seu.?n[uú]mero/i,           codigo: '400_seu_numero' },
  { re: /\b429\b|muitas requisi|too many request/i, codigo: '429' },
]

export function acharErroCatalogo(detalhe: unknown, catalogo: ErroCatalogo[], provider?: string | null): ErroCatalogo | null {
  const raw = typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe ?? '')
  for (const m of ERRO_MATCHERS) {
    if (!m.re.test(raw)) continue
    const doBanco = provider ? catalogo.find((c) => c.codigo === m.codigo && c.provider === provider) : null
    return doBanco ?? catalogo.find((c) => c.codigo === m.codigo) ?? null
  }
  return null
}

// Frase para a tela: título + o que fazer (+ o que pedir ao banco, quando houver).
export function textoErroCatalogo(e: ErroCatalogo): string {
  const partes = [`${e.titulo}.`, e.o_que_fazer]
  if (e.pedir_ao_banco) partes.push(`Como fazer: ${e.pedir_ao_banco}.`)
  return partes.join(' ')
}
