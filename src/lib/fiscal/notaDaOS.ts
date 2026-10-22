// Chamado #2167 · qual nota a ficha da OS mostra (regra pura, testada no gate check-os-nota-emitida).

export type NotaDaOS = {
  id: string
  status: string
  numero: string | null
  data_emissao: string | null
  criado_em: string | null
  pdf_url: string | null
  doc: string | null
  razao: string | null
  motivo_rejeicao: string | null
}

/** Cancelada/denegada não conta como emitida: a OS volta a oferecer a emissão. */
export const STATUS_NOTA_FORA = ['cancelada', 'denegada']

/** A autorizada mais recente; sem autorizada, a mais recente (processando/rejeitada); sem nota válida, null. */
export function escolherNotaDaOS(notas: NotaDaOS[]): NotaDaOS | null {
  const validas = notas.filter((n) => !STATUS_NOTA_FORA.includes(n.status))
  const ordenadas = [...validas].sort((a, b) => String(b.criado_em ?? '').localeCompare(String(a.criado_em ?? '')))
  return ordenadas.find((n) => n.status === 'autorizada') ?? ordenadas[0] ?? null
}

/** A OS troca o botão de emitir pelo estado da nota (verde = abrir PDF; âmbar = processando). */
export function notaJaEmitida(nota: NotaDaOS | null): boolean {
  return nota?.status === 'autorizada' || nota?.status === 'processando'
}
