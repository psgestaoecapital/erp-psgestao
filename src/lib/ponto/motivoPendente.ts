// #587 (CEO 04/10): o dia "aguardando confirmação" diz POR QUÊ, em linguagem simples (RD-51 / RD-38: sem estimativa
// virando veredito). Motivos vindos da apuração: sem_registro_pausa | pausas_faltantes | (outro) pausa sem hora de saída.
export type PendenteMotivo = {
  motivo?: string | null
  sem_registro_pausa?: boolean
  pausas_devidas?: number | null
  pausas_realizadas?: number | null
  almoco_min?: number | null
}

export function rotuloPendente(p: PendenteMotivo): string {
  if (p.sem_registro_pausa === true || p.motivo === 'sem_registro_pausa') return 'Sem registro de pausa'
  if (p.motivo === 'pausas_faltantes') return 'Pausas faltantes'
  return 'Pausa sem hora de saída'
}

export function explicaPendente(p: PendenteMotivo): string | null {
  if (p.motivo !== 'pausas_faltantes') return null
  const dev = p.pausas_devidas, real = p.pausas_realizadas
  const conta = dev != null && real != null ? `A jornada pedia ${dev} pausa(s) e há ${real} registrada(s)` : 'Há menos pausas registradas do que a jornada pedia'
  const alm = p.almoco_min ? ` (já descontados ${p.almoco_min} min de almoço)` : ''
  return `${conta}${alm}. Nenhuma está abaixo do mínimo; falta confirmar com o colaborador se houve outra pausa.`
}
