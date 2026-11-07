// Estado do certificado A1 calculado pela data de validade (chamado #5661).
export type EstadoCertificado = 'ativo' | 'vencendo' | 'vencido' | 'sem_data'

export function estadoCertificado(validadeFim?: string | null, agora: Date = new Date()) {
  if (!validadeFim) return { estado: 'sem_data' as EstadoCertificado, dias: null as number | null }
  const fim = new Date(validadeFim)
  if (Number.isNaN(fim.getTime())) return { estado: 'sem_data' as EstadoCertificado, dias: null as number | null }
  const dias = Math.ceil((fim.getTime() - agora.getTime()) / 86400000)
  if (dias < 0) return { estado: 'vencido' as EstadoCertificado, dias }
  if (dias <= 30) return { estado: 'vencendo' as EstadoCertificado, dias }
  return { estado: 'ativo' as EstadoCertificado, dias }
}
