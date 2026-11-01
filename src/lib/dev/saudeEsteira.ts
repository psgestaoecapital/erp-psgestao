// Regras puras do card "Saúde da Esteira" (aba Codes): semáforo só de performance. Entrada = jsonb de fn_esteira_saude().
export type Semaforo = 'verde' | 'amarelo' | 'vermelho'
export type SaudeEsteira = {
  portao_verde: boolean | null; portao_desde: string | null; portao_spec_falha: string | null
  quedas_24h: number | null; tempo_vermelho_24h_min: number | null; merges_24h: number | null
  intervalo_mediano_merge_min: number | null; fila_esperando: number | null; fila_parada: number | null
  pr_parada_mais_antiga_h: number | null
}

export function formatarMin(min: number): string {
  if (min < 60) return `${Math.round(min)} min`
  const h = Math.floor(min / 60), m = Math.round(min % 60)
  return m ? `${h} h ${m} min` : `${h} h`
}

export function classificarSaude(s: SaudeEsteira, agora: Date) {
  const med = s.intervalo_mediano_merge_min
  const cadencia: Semaforo = med === null || med > 90 ? 'vermelho' : med > 30 ? 'amarelo' : 'verde'
  const q = s.quedas_24h ?? 0, v = s.tempo_vermelho_24h_min ?? 0
  const estabilidade: Semaforo = q === 0 && v === 0 ? 'verde' : q <= 2 && v <= 60 ? 'amarelo' : 'vermelho'
  const h = s.pr_parada_mais_antiga_h ?? 0, par = s.fila_parada ?? 0
  const fila: Semaforo = par === 0 ? 'verde' : h < 6 ? 'amarelo' : 'vermelho'
  const portao: Semaforo = s.portao_verde === true ? 'verde' : 'vermelho'
  const portaoHa = s.portao_desde ? formatarMin(Math.max(0, (agora.getTime() - new Date(s.portao_desde).getTime()) / 60000)) : ''
  return { cadencia, estabilidade, fila, portao, portaoHa, cadenciaTexto: med === null ? 'sem dado' : `a cada ${formatarMin(med)}` }
}
