'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CheckCircle2, XCircle, AlertTriangle, Loader2, PlaneTakeoff, Package, Users } from 'lucide-react'

// Pré-voo fiscal · Fase 1 (SPEC aprovada 24/09). Mostra, ANTES de tentar emitir NF-e, o que impede
// a emissão nesta empresa — E TAMBÉM o que já está certo (pedido do CEO: dar noção de progresso, não
// só mais uma lista de erros). Fonte única: RPC fn_fiscal_previo, que reusa os MESMOS predicados do
// nfe-validator (se fossem duas regras, divergiriam em três meses).

interface ConfigItem {
  chave: string
  rotulo: string
  ok: boolean
  valor?: string | null
  severidade: 'bloqueio' | 'aviso'
}
interface ProdAmostra { codigo: string | null; nome: string; motivos: string[] }
interface DestAmostra { nome: string }
interface PreVoo {
  config: ConfigItem[]
  produtos: {
    incompletos: number
    sem_ncm: number
    cst_st_incompleto: number
    ncm2710_sem_anp: number
    sem_tipo_item_sped: number
    amostra: ProdAmostra[]
  }
  destinatarios: { contribuinte_sem_ie: number; amostra: DestAmostra[] }
  resumo: {
    config_bloqueios: number
    config_avisos: number
    produtos_incompletos: number
    destinatarios_pendentes: number
    pronto_para_emitir: boolean
  }
}

export default function PreVooFiscalCard({ companyId }: { companyId: string }) {
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [dados, setDados] = useState<PreVoo | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const { data, error } = await supabase.rpc('fn_fiscal_previo', { p_company_id: companyId })
      if (error) throw new Error(error.message)
      setDados(data as unknown as PreVoo)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar o pré-voo')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { carregar() }, [carregar])

  return (
    <div className="bg-white border border-[#3D2314]/10 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-[#3D2314]/10 flex items-center gap-2">
        <PlaneTakeoff className="text-[#C8941A]" size={16} />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-[#3D2314]/55 tracking-[0.8px] uppercase font-medium">Pré-voo de emissão (NF-e)</div>
          <h2 className="text-[14px] font-medium text-[#3D2314]">O que impede — e o que já está pronto</h2>
        </div>
        {!loading && (
          <button
            onClick={carregar}
            className="text-[12px] font-medium text-[#C8941A] hover:underline whitespace-nowrap"
          >
            Recarregar
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="animate-spin text-[#C8941A]" size={22} />
        </div>
      ) : erro ? (
        <div className="px-5 py-4 flex items-start gap-3 text-[13px] text-[#791F1F]">
          <XCircle className="text-[#C94544] flex-shrink-0 mt-0.5" size={16} />
          <div>{erro}</div>
        </div>
      ) : dados ? (
        <div className="divide-y divide-[#3D2314]/8">
          {/* Veredito */}
          <div className="px-5 py-3">
            {dados.resumo.pronto_para_emitir ? (
              <div className="flex items-center gap-2 text-[13px] font-medium text-[#1B3608]">
                <CheckCircle2 className="text-[#3F7012]" size={16} />
                Sem impeditivos de configuração — a empresa pode emitir NF-e.
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[13px] font-medium text-[#791F1F]">
                <XCircle className="text-[#C94544]" size={16} />
                {dados.resumo.config_bloqueios} impeditivo(s) de configuração antes de emitir.
              </div>
            )}
            {(dados.resumo.produtos_incompletos > 0 || dados.resumo.destinatarios_pendentes > 0) && (
              <div className="text-[11.5px] text-[#3D2314]/65 mt-1">
                Além disso: {dados.resumo.produtos_incompletos} produto(s) e {dados.resumo.destinatarios_pendentes} destinatário(s) precisam de ajuste para não serem rejeitados na SEFAZ.
              </div>
            )}
          </div>

          {/* Config — mostra o CERTO (✓) e o que falta (✗/aviso) */}
          <ul className="divide-y divide-[#3D2314]/8">
            {dados.config.map((c) => (
              <li key={c.chave} className="px-5 py-2.5 flex items-start gap-3" data-testid={`previo-config-${c.chave}`}>
                {c.ok ? (
                  <CheckCircle2 className="text-[#3F7012] flex-shrink-0 mt-0.5" size={15} />
                ) : c.severidade === 'aviso' ? (
                  <AlertTriangle className="text-[#BA7517] flex-shrink-0 mt-0.5" size={15} />
                ) : (
                  <XCircle className="text-[#C94544] flex-shrink-0 mt-0.5" size={15} />
                )}
                <div className="flex-1 min-w-0">
                  <div className={`text-[12.5px] font-medium ${c.ok ? 'text-[#1B3608]' : c.severidade === 'aviso' ? 'text-[#633806]' : 'text-[#3D2314]'}`}>
                    {c.rotulo}
                  </div>
                  <div className={`text-[11px] mt-0.5 ${c.ok ? 'text-[#1B3608]/70' : 'text-[#3D2314]/65'}`}>
                    {c.ok
                      ? (c.valor ? `OK · ${c.valor}` : 'OK')
                      : c.severidade === 'aviso'
                        ? 'Recomendado (não impede emitir)'
                        : 'Impede a emissão — preencha na configuração acima'}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* Produtos incompletos */}
          <div className="px-5 py-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Package className={dados.produtos.incompletos > 0 ? 'text-[#BA7517]' : 'text-[#3F7012]'} size={15} />
              <div className="text-[12.5px] font-medium text-[#3D2314]">
                {dados.produtos.incompletos > 0
                  ? `${dados.produtos.incompletos} produto(s) com cadastro fiscal incompleto`
                  : 'Produtos com cadastro fiscal completo'}
              </div>
            </div>
            {dados.produtos.incompletos > 0 && (
              <>
                <div className="text-[11px] text-[#3D2314]/65 flex flex-wrap gap-x-3 gap-y-0.5 mb-1.5">
                  {dados.produtos.sem_ncm > 0 && <span>NCM ausente/inválido: {dados.produtos.sem_ncm}</span>}
                  {dados.produtos.cst_st_incompleto > 0 && <span>CST ST sem retido: {dados.produtos.cst_st_incompleto}</span>}
                  {dados.produtos.ncm2710_sem_anp > 0 && <span>NCM 2710 sem ANP: {dados.produtos.ncm2710_sem_anp}</span>}
                  {dados.produtos.sem_tipo_item_sped > 0 && <span>Sem tipo do item (SPED): {dados.produtos.sem_tipo_item_sped}</span>}
                </div>
                <ul className="space-y-1">
                  {dados.produtos.amostra.map((p, i) => (
                    <li key={i} className="text-[11.5px] text-[#3D2314]/80">
                      <span className="font-medium">{p.codigo ?? '—'}</span> · {p.nome || 'sem nome'}
                      {p.motivos.length > 0 && <span className="text-[#791F1F]"> — {p.motivos.join(', ')}</span>}
                    </li>
                  ))}
                  {dados.produtos.incompletos > dados.produtos.amostra.length && (
                    <li className="text-[11px] text-[#3D2314]/55">
                      … e mais {dados.produtos.incompletos - dados.produtos.amostra.length}.
                    </li>
                  )}
                </ul>
              </>
            )}
          </div>

          {/* Destinatários contribuintes sem IE */}
          <div className="px-5 py-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Users className={dados.destinatarios.contribuinte_sem_ie > 0 ? 'text-[#BA7517]' : 'text-[#3F7012]'} size={15} />
              <div className="text-[12.5px] font-medium text-[#3D2314]">
                {dados.destinatarios.contribuinte_sem_ie > 0
                  ? `${dados.destinatarios.contribuinte_sem_ie} cliente(s) contribuinte(s) sem Inscrição Estadual`
                  : 'Clientes contribuintes com IE em ordem'}
              </div>
            </div>
            {dados.destinatarios.contribuinte_sem_ie > 0 && (
              <>
                <div className="text-[11px] text-[#3D2314]/65 mb-1.5">
                  Contribuinte sem IE gera rejeição 232 na SEFAZ. Informe a IE no cadastro, ou marque como isento / não contribuinte.
                </div>
                <ul className="space-y-1">
                  {dados.destinatarios.amostra.map((d, i) => (
                    <li key={i} className="text-[11.5px] text-[#3D2314]/80">{d.nome || 'sem nome'}</li>
                  ))}
                  {dados.destinatarios.contribuinte_sem_ie > dados.destinatarios.amostra.length && (
                    <li className="text-[11px] text-[#3D2314]/55">
                      … e mais {dados.destinatarios.contribuinte_sem_ie - dados.destinatarios.amostra.length}.
                    </li>
                  )}
                </ul>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
