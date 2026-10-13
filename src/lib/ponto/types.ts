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

// Marcação diária (granularidade por dia). LGPD: sem nome/email — cpf p/ dedup + setor p/ agregado.
export type PontoMarcacaoPonto = {
  point_id: number | null
  datetime: string | null   // ISO
  hora: string | null       // HH:MM:SS
  method: string | null
  origin: string | null
  is_adjusted: boolean
  adjustment_reason: string | null
  adjusted_by: string | null
  has_audit_photo: boolean
}
export type PontoDia = {
  cpf: string
  registration_number: string | null
  data: string              // YYYY-MM-DD
  shift: string | null
  worked_seconds: number
  departamento: string | null
  equipe: string | null
  unidade_negocio: string | null
  total_pontos: number
  tem_ajuste: boolean
  pontos: PontoMarcacaoPonto[]
  raw: unknown
}

// Pausa técnica (NR-36 psicofisiológica / Art.253 térmica). Fase 2 do coletor: alimenta ind_ponto_pausa,
// que o motor fn_nr36_apurar cruza com a jornada. Endpoint da IOPoint ainda a confirmar com o Jian — por
// isso listarPausas é OPCIONAL e o adapter IO Point hoje devolve [] (no-op seguro até o endpoint ser ligado).
export type PontoPausa = {
  cpf: string
  data: string              // YYYY-MM-DD
  inicio: string            // ISO datetime
  fim: string | null
  duracao_seg: number | null
  tipo: string | null       // 'termica_253' | 'psicofisiologica' | bruto da IOPoint (a mapear)
  point_id: number | null
  raw: unknown
}

export interface PontoAdapter {
  listarColaboradores(cred: PontoCredencial): Promise<PontoColaborador[]>
  listarHoras(cred: PontoCredencial, beginISO: string, endISO: string): Promise<PontoHoras[]>
  // Opcional: nem todo provider expõe marcação diária. IO Point implementa.
  listarMarcacoesDiarias?(cred: PontoCredencial, beginISO: string, endISO: string): Promise<PontoDia[]>
  // Opcional (Fase 2): pausas técnicas. IO Point tem um stub até o endpoint de pausas ser confirmado.
  listarPausas?(cred: PontoCredencial, beginISO: string, endISO: string): Promise<PontoPausa[]>
}
