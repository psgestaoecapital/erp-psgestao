// #2861 (Gean) · busca nas listas da Oficina (Diagnóstico e Aprovação), com a mesma regra da tela de Ordens de Serviço:
// número, cliente, marca/modelo e placa (a placa compara só letras e números, a partir de 3 caracteres).
export type OSBuscavel = { numero?: string | null; cliente_nome?: string | null; placa?: string | null; marca?: string | null; modelo?: string | null }

const soAlnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export function filtrarOS<T extends OSBuscavel>(lista: T[], busca: string): T[] {
  const b = busca.trim().toLowerCase()
  if (!b) return lista
  const bPlaca = soAlnum(b)
  return lista.filter((o) =>
    (o.numero ?? '').toLowerCase().includes(b) ||
    (o.cliente_nome ?? '').toLowerCase().includes(b) ||
    [o.marca, o.modelo].filter(Boolean).join(' ').toLowerCase().includes(b) ||
    (bPlaca.length >= 3 && soAlnum(o.placa ?? '').includes(bPlaca))
  )
}
