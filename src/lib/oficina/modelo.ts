'use client'

// #135 · modelo de atendimento da Oficina (erp_oficina_parametros.modelo_atendimento).
//  - 'tablet' (padrão): Diagnóstico lança itens/quantidades; os valores entram na Aprovação do Cliente.
//  - 'centralizado': sem tablet no box — a atendente lança itens, quantidades e VALORES no Diagnóstico; a
//    Aprovação só mostra o valor e registra a decisão do cliente.
// podePreco = modo centralizado E o usuário pode lançar valor (mecânico e operador não — mesma trava do banco).
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type ModeloAtendimento = 'tablet' | 'centralizado'

export function useOficinaModelo(companyId: string | null): { modelo: ModeloAtendimento; podePreco: boolean; carregado: boolean } {
  const [estado, setEstado] = useState<{ companyId: string; modelo: ModeloAtendimento; podePreco: boolean } | null>(null)
  useEffect(() => {
    let vivo = true
    if (!companyId) return
    void supabase.rpc('fn_oficina_modelo_atendimento', { p_company_id: companyId }).then(({ data }) => {
      if (!vivo) return
      const d = data as { modelo?: string; pode_preco?: boolean } | null
      setEstado({ companyId, modelo: d?.modelo === 'centralizado' ? 'centralizado' : 'tablet', podePreco: d?.pode_preco === true })
    })
    return () => { vivo = false }
  }, [companyId])
  const atual = estado && estado.companyId === companyId ? estado : null
  return { modelo: atual?.modelo ?? 'tablet', podePreco: atual?.podePreco ?? false, carregado: atual !== null }
}
