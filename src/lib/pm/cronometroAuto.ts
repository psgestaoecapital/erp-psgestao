// PM-T (2) · início/fim automático do cronômetro pela situação do job (CEO 06/10, blueprint 00.5-B).
// Só SUGERE: quem decide é a pessoa (confirmação). Um ativo por pessoa (cronometroGlobal).
export type SugestaoCronometro = 'iniciar' | 'parar' | null

const PARA_PARAR = new Set(['aguardando', 'em_aprovacao', 'concluida', 'publicado', 'cancelado'])

export function sugestaoCronometro(novaSituacao: string, jobId: string, abertoJobId: string | null): SugestaoCronometro {
  if (novaSituacao === 'em_producao') return abertoJobId === jobId ? null : 'iniciar'
  if (PARA_PARAR.has(novaSituacao)) return abertoJobId === jobId ? 'parar' : null
  return null
}

export const textoSugestao = (s: Exclude<SugestaoCronometro, null>, situacao: string) =>
  s === 'iniciar' ? `O job foi para "${situacao}". Iniciar o cronômetro?` : `O job foi para "${situacao}". Parar o cronômetro e gravar as horas?`

// PM-T (4c) · concluir job sem horas pede apontamento. Só avisa; a pessoa decide.
export const exigeApontamentoAoConcluir = (novaSituacao: string, totalHoras: number) => novaSituacao === 'concluida' && !(totalHoras > 0)
export const textoSemHoras = 'Este job foi concluído sem nenhuma hora apontada. Lançar as horas agora?'
