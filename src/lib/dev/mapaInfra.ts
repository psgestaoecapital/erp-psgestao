// Regras puras do Mapa da Infra (CEO 14/10): agrupamento por camada e rótulos. O estado (cor) é calculado no banco
// (fn_infra_estado) — aqui só se organiza para a tela.
export type NoInfra = {
  chave: string; nome: string; camada: Camada; tipo: string; dono: string; ordem: number
  cadencia_min: number | null; tolerancia_min: number
  ultimo_batimento: string | null; resultado: string | null; detalhe: string | null
  itens_olhados: number; itens_decididos: number; atraso_min: number | null
  cor: Cor
}
export type Ligacao = { de_no: string; para_no: string; rotulo: string }
export type Camada = 'sistemas' | 'esteira' | 'bancos_teste' | 'producao' | 'auditores' | 'agentes'
export type Cor = 'verde' | 'amarelo' | 'vermelho' | 'sem_cadencia' | 'sem_dados'

// ordem do fluxo: sistemas → esteira → bancos de teste → produção → auditores (agentes alimentam a esteira)
export const CAMADAS: { id: Camada; titulo: string }[] = [
  { id: 'sistemas', titulo: 'Sistemas' }, { id: 'agentes', titulo: 'Codes' }, { id: 'esteira', titulo: 'Esteira' },
  { id: 'bancos_teste', titulo: 'Bancos de teste' }, { id: 'producao', titulo: 'Produção' }, { id: 'auditores', titulo: 'Auditores' },
]

export const ROTULO_COR: Record<Cor, string> = {
  verde: 'Na cadência', amarelo: 'Atrasado', vermelho: 'Parado', sem_cadencia: 'Por evento', sem_dados: 'Sem batimento',
}

export function porCamada(nos: NoInfra[]): { id: Camada; titulo: string; nos: NoInfra[] }[] {
  return CAMADAS.map((c) => ({ ...c, nos: nos.filter((n) => n.camada === c.id).sort((a, b) => a.ordem - b.ordem) }))
    .filter((c) => c.nos.length > 0)
}

export function resumo(nos: NoInfra[]): Record<Cor, number> {
  const r: Record<Cor, number> = { verde: 0, amarelo: 0, vermelho: 0, sem_cadencia: 0, sem_dados: 0 }
  for (const n of nos) r[n.cor] = (r[n.cor] ?? 0) + 1
  return r
}

export function haQuanto(iso: string | null, agora = Date.now()): string {
  if (!iso) return 'nunca'
  const min = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 60000))
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  return h < 24 ? `há ${h} h` : `há ${Math.floor(h / 24)} d`
}
