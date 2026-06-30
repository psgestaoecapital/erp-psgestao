// Modelo canonico de ponto eletronico — provider-agnostic.
// Cada provider (iopoint, henry, control_id, secullum, ...) tem um adapter
// que converte o formato proprio pra esses tipos.

export type PontoProvider = 'iopoint' | 'henry' | 'control_id' | 'secullum'

export type PontoColaborador = {
  cpf: string
  matricula: string | null
  nome: string
  email: string | null
  funcao: string | null
  departamento: string | null
  equipe: string | null
  unidade_negocio: string | null
  admissao: string | null   // ISO YYYY-MM-DD
  pis: string | null
  raw: unknown
}

export type PontoHoras = {
  cpf: string
  periodo_inicio: string    // ISO YYYY-MM-DD
  periodo_fim: string       // ISO YYYY-MM-DD
  total_horas: number
  funcao: string | null
  departamento: string | null
  equipe: string | null
  unidade_negocio: string | null
  raw: unknown
}

export type PontoCredencial = {
  token: string
  base_url: string
}

export interface PontoAdapter {
  listarColaboradores(cred: PontoCredencial): Promise<PontoColaborador[]>
  listarHoras(cred: PontoCredencial, beginISO: string, endISO: string): Promise<PontoHoras[]>
}
