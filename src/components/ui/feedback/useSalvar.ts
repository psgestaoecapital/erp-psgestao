'use client'

import { useCallback, useState } from 'react'
import {
  type ResultadoSalvar,
  type AcaoSalvar,
  VERBO_SUCESSO,
  mensagemDeResultado,
} from './contratoSalvar'
import { type EstadoFeedback } from './FeedbackSalvar'

// ═══════════════════════════════════════════════════════════════════════════
// RASCUNHO (RD-26) · Hook central de salvamento. Faz o cast tipado do contrato,
// mapeia erro→mensagem da casa + campo a destacar, e monta o texto de sucesso
// (CRIOU/ALTEROU/EXCLUIU). Elimina o error.message cru e os alert(). NÃO ligado
// a nenhuma tela ainda — base pro SPEC do piloto.
//
// Uso previsto:
//   const { salvar, salvando, feedback, erroCampo, limpar } = useSalvar()
//   const r = await salvar(
//     () => supabase.rpc('fn_pagar_...', { ...params }),
//     { acao: 'criar', label: '3 parcelas · R$ 1.200,00' },
//   )
//   if (r.sucesso) { /* redirect / fechar modal */ }
//   // <FeedbackSalvar estado={feedback} /> no local fixo do form
//   // <Campo erro={erroCampo === 'valor' ? mensagemDeResultado(...) : null}> no input
// ═══════════════════════════════════════════════════════════════════════════

type RespostaSupabase = { data: unknown; error: { message: string } | null }

export function useSalvar() {
  const [salvando, setSalvando] = useState(false)
  const [feedback, setFeedback] = useState<EstadoFeedback>(null)
  const [erroCampo, setErroCampo] = useState<string | null>(null) // nome do campo a destacar

  const limpar = useCallback(() => {
    setFeedback(null)
    setErroCampo(null)
  }, [])

  const salvar = useCallback(
    async (
      chamada: () => Promise<RespostaSupabase>,
      opts: { acao: AcaoSalvar; label?: string },
    ): Promise<ResultadoSalvar> => {
      setSalvando(true)
      setFeedback(null)
      setErroCampo(null)
      try {
        const { data, error } = await chamada()

        // Erro de transporte (rede/PostgREST): mensagem amigável, nunca crua.
        if (error) {
          setFeedback({ tipo: 'erro', texto: mensagemDeResultado(null) })
          return { sucesso: false, erro: 'transporte' }
        }

        const r = (data ?? {}) as ResultadoSalvar

        // Regra de negócio negou (sucesso:false OU sem_plano).
        if (r.sucesso === false || r.sem_plano) {
          setFeedback({ tipo: 'erro', texto: mensagemDeResultado(r) })
          if (r.campo) setErroCampo(r.campo)
          return { ...r, sucesso: false }
        }

        // Sucesso — verbo da casa + label opcional (ex.: "CRIOU 3 parcelas...").
        const verbo = VERBO_SUCESSO[opts.acao]
        setFeedback({ tipo: 'sucesso', texto: `${verbo}${opts.label ? ' ' + opts.label : ''}` })
        return { ...r, sucesso: true }
      } finally {
        setSalvando(false)
      }
    },
    [],
  )

  return { salvar, salvando, feedback, erroCampo, limpar, setFeedback, setErroCampo }
}
