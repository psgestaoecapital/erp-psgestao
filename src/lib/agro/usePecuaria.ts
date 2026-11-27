'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { comPrazo } from '@/lib/comPrazo'

// useEmpresaSelecionada vive agora em @/lib/empresa/useEmpresaSelecionada — é um hook GENÉRICO (seletor
// global de empresa), e o núcleo (GE › Resultado por negócio, Linhas de negócio) também o usa. Núcleo não
// pode depender da vertical agro (PRINCÍPIO 1), então o hook saiu daqui. Re-exportado por compatibilidade
// com todas as telas do Agro que ainda importam deste caminho — nada muda para elas.
export { useEmpresaSelecionada } from '@/lib/empresa/useEmpresaSelecionada'

export type Propriedade = { id: string; nome: string }

export function usePropriedade(companyId: string | null): { propriedade: Propriedade | null; loading: boolean } {
  const [propriedade, setPropriedade] = useState<Propriedade | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!companyId) { setPropriedade(null); setLoading(false); return }
    let alive = true
    setLoading(true)
    ;(async () => {
      try {
        // Colunas do schema real (auditado): id, nome existem em erp_pec_propriedade.
        const { data, error } = await comPrazo(async () => await supabase.from('erp_pec_propriedade')
          .select('id, nome').eq('company_id', companyId).eq('ativo', true).order('nome').limit(1),
          { ms: 8000, tentativas: 1, label: 'agro_propriedade' })
        if (!alive) return
        if (error) {
          // eslint-disable-next-line no-console
          console.warn('[agro] usePropriedade query falhou', error.message, { companyId })
        }
        const lst = (data ?? []) as Propriedade[]
        setPropriedade(lst[0] ?? null)
      } catch {
        if (!alive) return
        setPropriedade(null)
      } finally {
        if (alive) setLoading(false)  // nunca "Carregando…" eterno se pendurar
      }
    })()
    return () => { alive = false }
  }, [companyId])
  return { propriedade, loading }
}

export type PainelRebanho = {
  total_cabecas: number
  por_categoria: Array<{ categoria: string; qtd: number }>
  lotes_ativos: number
  areas: number
  propriedades: number
}

export function usePainelRebanho(companyId: string | null, propriedadeId: string | null, refresh: number) {
  const [data, setData] = useState<PainelRebanho | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState(false)
  useEffect(() => {
    if (!companyId || !propriedadeId) { setData(null); return }
    let alive = true
    setLoading(true); setErro(false)
    ;(async () => {
      try {
        const { data: r } = await comPrazo(async () => await supabase.rpc('fn_pec_painel_rebanho', {
          p_company_id: companyId, p_propriedade_id: propriedadeId,
        }), { ms: 8000, tentativas: 1, label: 'agro_painel_rebanho' })
        if (!alive) return
        setData(r as PainelRebanho)
      } catch {
        if (!alive) return
        setErro(true)
      } finally {
        if (alive) setLoading(false)  // nunca "Carregando…" eterno se a RPC pendurar
      }
    })()
    return () => { alive = false }
  }, [companyId, propriedadeId, refresh])
  return { data, loading, erro }
}

