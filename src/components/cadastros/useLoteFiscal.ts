'use client'

// Chamado #11065 — gancho compartilhado pela Edição fiscal em massa e pelo Padrão fiscal por NCM: acompanha e conduz a
// aplicação em LOTES (um passo curto por chamada). Ao abrir a tela, se já existe uma aplicação em andamento nesta empresa
// (a pessoa fechou o navegador no meio), ela é retomada daqui; o agendador do servidor também a termina sozinho.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { conduzirLote, emAndamento, mensagemDoErro, type LoteFiscal, type RespostaPasso } from '@/lib/produtos/fiscalMassaLotes'

type Estado = { job: LoteFiscal | null; rodando: boolean; erro: string | null }

export function useLoteFiscal(companyId: string, aoTerminar?: (job: LoteFiscal) => void) {
  const [estado, setEstado] = useState<Estado>({ job: null, rodando: false, erro: null })
  const parar = useRef(false)
  const rodando = useRef(false)
  const vivo = useRef(true)
  const aoTerminarRef = useRef(aoTerminar)
  aoTerminarRef.current = aoTerminar

  useEffect(() => {
    vivo.current = true
    return () => { vivo.current = false; parar.current = true }
  }, [])

  const chamarPasso = useCallback(async (jobId: string, retentar: boolean): Promise<RespostaPasso> => {
    const { data, error } = await supabase.rpc('fn_produtos_fiscal_job_processar', { p_job_id: jobId, p_retentar: retentar })
    if (error) throw error
    return data as RespostaPasso
  }, [])

  const conduzir = useCallback(async (jobId: string, retentar = false) => {
    if (rodando.current) return
    rodando.current = true
    parar.current = false
    setEstado((e) => ({ ...e, rodando: true, erro: null }))
    try {
      let falhasRede = 0
      for (;;) {
        try {
          const r = await conduzirLote(jobId, chamarPasso, {
            aoProgredir: (job) => { if (vivo.current) setEstado((e) => ({ ...e, job })) },
            deveParar: () => parar.current,
          }, retentar)
          retentar = false
          if (r.job && !emAndamento(r.job)) aoTerminarRef.current?.(r.job)
          return
        } catch (e) {
          // rede/timeout isolado: o lote anterior está gravado; tenta de novo (3x) antes de mostrar o aviso
          falhasRede++
          if (falhasRede >= 3 || parar.current) {
            if (vivo.current) setEstado((s) => ({ ...s, erro: mensagemDoErro(e) }))
            return
          }
          await new Promise((res) => setTimeout(res, 1500 * falhasRede))
        }
      }
    } finally {
      rodando.current = false
      if (vivo.current) setEstado((e) => ({ ...e, rodando: false }))
    }
  }, [chamarPasso])

  // ao abrir: retoma a aplicação que estiver andando (ou mostra a última parada por erro)
  useEffect(() => {
    let ativo = true
    void (async () => {
      const { data } = await supabase.rpc('fn_produtos_fiscal_job_obter', { p_company_id: companyId })
      const job = (data as { job: LoteFiscal | null } | null)?.job ?? null
      if (!ativo || !job) return
      if (emAndamento(job) || job.status === 'erro') {
        setEstado((e) => ({ ...e, job }))
        if (emAndamento(job)) void conduzir(job.id)
      }
    })()
    return () => { ativo = false }
  }, [companyId, conduzir])

  /** a aplicação acabou de ser criada no servidor: mostra a barra e começa */
  const iniciar = useCallback((job: LoteFiscal) => {
    setEstado({ job, rodando: false, erro: null })
    void conduzir(job.id)
  }, [conduzir])

  const continuar = useCallback(() => { if (estado.job) void conduzir(estado.job.id, estado.job.status === 'erro') }, [estado.job, conduzir])

  const cancelar = useCallback(async () => {
    if (!estado.job) return
    parar.current = true
    const { data, error } = await supabase.rpc('fn_produtos_fiscal_job_cancelar', { p_job_id: estado.job.id })
    if (error) { setEstado((e) => ({ ...e, erro: mensagemDoErro(error) })); return }
    const job = (data as { job: LoteFiscal | null } | null)?.job ?? null
    if (job) setEstado((e) => ({ ...e, job }))
  }, [estado.job])

  const dispensar = useCallback(() => setEstado({ job: null, rodando: false, erro: null }), [])

  return { ...estado, iniciar, continuar, cancelar, dispensar }
}
