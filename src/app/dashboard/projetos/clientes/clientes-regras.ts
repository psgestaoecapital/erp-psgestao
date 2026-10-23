// Regras puras da tela Clientes de obra (Hub). Sem React nem banco, para o gate provar.
// PDCA 23/10: o auditor viu "J" em todo cliente — a DEMO grava tipo_pessoa 'J'/'F' (legado) e a
// tela só conhecia 'PJ'/'PF'. O tipo agora sai normalizado; sem tipo, o documento decide.
import { tipoPessoaPorDocumento } from '@/lib/banco/documento'

export type TipoPF = 'PF' | 'PJ'

export function tipoPessoaNormal(tipo: string | null | undefined, documento?: string | null): TipoPF {
  const t = (tipo ?? '').trim().toUpperCase()
  if (t === 'PF' || t === 'F' || t === 'FISICA' || t === 'FÍSICA') return 'PF'
  if (t === 'PJ' || t === 'J' || t === 'JURIDICA' || t === 'JURÍDICA') return 'PJ'
  return tipoPessoaPorDocumento(documento) === 'FISICA' ? 'PF' : 'PJ'
}

// Iniciais do nome real (até 2 letras), ignorando conectivos: "Clínica Bem Viver" → "CB".
const CONECTIVOS = new Set(['da', 'de', 'do', 'das', 'dos', 'e', '&'])
export function iniciais(nome: string | null | undefined): string {
  const partes = (nome ?? '').trim().split(/\s+/).filter((p) => p && !CONECTIVOS.has(p.toLowerCase()))
  if (partes.length === 0) return '?'
  const letras = partes.slice(0, 2).map((p) => p.match(/[\p{L}\p{N}]/u)?.[0] ?? '').join('')
  return (letras || '?').toUpperCase()
}

// Conta obras por cliente a partir das linhas de erp_obra_planta (uma consulta por tela).
export function obrasPorCliente(linhas: { cliente_id: string | null }[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const l of linhas) if (l.cliente_id) m[l.cliente_id] = (m[l.cliente_id] ?? 0) + 1
  return m
}

export const temContato = (c: { telefone?: string | null; celular?: string | null; email?: string | null }) =>
  !!((c.telefone ?? '').trim() || (c.celular ?? '').trim() || (c.email ?? '').trim())
