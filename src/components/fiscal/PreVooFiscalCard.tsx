'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { authFetch } from '@/lib/authFetch'
import { CheckCircle2, XCircle, AlertTriangle, Loader2, PlaneTakeoff, Package, Users, ShieldCheck, GitCompareArrows } from 'lucide-react'

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
    // OS-0179 · empresa do Simples com produto em CST (regime normal) — ausente até a migration 20260926190000
    simples_cst_regime_normal?: number
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

// Leitura REAL do certificado A1 (não só validade). Fonte: /api/fiscal/certificado/verificar-leitura.
interface CertLeitura {
  presente: boolean
  legivel?: boolean
  openssl_nativo?: boolean
  formato?: 'moderno' | 'legado' | 'ilegivel'
  tamanho_bytes?: number | null
  validade_fim?: string | null
  dias_para_vencer?: number | null
  status_validade?: string
  erro?: string | null
}

// Conferência do cadastro da empresa no FOCUS × config local. Fonte: /api/fiscal/focus-empresas.
// A Focus CARIMBA no DPS o que está no cadastro dela — divergência = rejeição na emissão (E0713/E0010).
interface FocusCampo { chave: string; rotulo: string; local: string | null; focus: string | null; diverge: boolean; observacao?: string }
interface FocusConf { presente: boolean; divergencias?: number; campos?: FocusCampo[]; erro?: string }

export default function PreVooFiscalCard({ companyId }: { companyId: string }) {
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [dados, setDados] = useState<PreVoo | null>(null)
  const [cert, setCert] = useState<CertLeitura | null>(null)
  const [focusConf, setFocusConf] = useState<FocusConf | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const { data, error } = await supabase.rpc('fn_fiscal_previo', { p_company_id: companyId })
      if (error) throw new Error(error.message)
      setDados(data as unknown as PreVoo)
      // Teste de LEITURA do certificado (o RPC só olha a validade; aqui abrimos o arquivo de verdade).
      try {
        const r = await authFetch('/api/fiscal/certificado/verificar-leitura', {
          method: 'POST', body: JSON.stringify({ companyId }),
        })
        const j = (await r.json().catch(() => null)) as CertLeitura | null
        setCert(j)
      } catch { setCert(null) }
      // Conferência Focus × local (o RPC não enxerga o cadastro da Focus; divergência bloqueia a emissão).
      try {
        const rf = await authFetch('/api/fiscal/focus-empresas', {
          method: 'POST', body: JSON.stringify({ companyId }),
        })
        const jf = (await rf.json().catch(() => null)) as FocusConf | null
        setFocusConf(jf)
      } catch { setFocusConf(null) }
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

          {/* Leitura REAL do certificado A1 — não só a validade (um cert válido mas ilegível reprova aqui). */}
          {cert && (
            <div className="px-5 py-3" data-testid="previo-cert-leitura">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck
                  className={!cert.presente ? 'text-[#BA7517]' : cert.legivel ? 'text-[#3F7012]' : 'text-[#C94544]'}
                  size={15}
                />
                <div className="text-[12.5px] font-medium text-[#3D2314]">
                  {!cert.presente
                    ? 'Nenhum certificado A1 ativo cadastrado'
                    : cert.legivel
                      ? 'Certificado A1 legível pelo sistema'
                      : 'Certificado A1 NÃO é legível — a emissão e o boleto vão falhar'}
                </div>
              </div>
              {cert.presente && (
                <div className="text-[11px] text-[#3D2314]/65 ml-[23px] space-y-0.5">
                  {cert.legivel ? (
                    <>
                      <div>
                        {cert.formato === 'legado'
                          ? 'Formato legado (PKCS#12 antigo) — lido pelo sistema; o mTLS bancário usa o leitor tolerante.'
                          : 'Formato moderno.'}
                        {typeof cert.tamanho_bytes === 'number' ? ` · ${cert.tamanho_bytes} bytes` : ''}
                      </div>
                      {cert.status_validade === 'vencido' ? (
                        <div className="text-[#791F1F]">Atenção: certificado VENCIDO.</div>
                      ) : cert.status_validade === 'expirando' ? (
                        <div className="text-[#633806]">Expira em {cert.dias_para_vencer} dia(s){cert.validade_fim ? ` (${cert.validade_fim.slice(0, 10)})` : ''}.</div>
                      ) : cert.validade_fim ? (
                        <div>Válido até {cert.validade_fim.slice(0, 10)}.</div>
                      ) : null}
                    </>
                  ) : (
                    <div className="text-[#791F1F]">{cert.erro ?? 'Não foi possível abrir o certificado com a senha guardada.'}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Conferência Focus × local — divergência aqui BLOQUEIA a emissão (a Focus carimba o cadastro dela no DPS). */}
          {focusConf && (
            <div className="px-5 py-3" data-testid="previo-focus-conferencia">
              <div className="flex items-center gap-2 mb-1">
                <GitCompareArrows
                  className={!focusConf.presente ? 'text-[#BA7517]' : (focusConf.divergencias ?? 0) > 0 ? 'text-[#C94544]' : 'text-[#3F7012]'}
                  size={15}
                />
                <div className={`text-[12.5px] font-medium ${(focusConf.divergencias ?? 0) > 0 ? 'text-[#791F1F]' : 'text-[#3D2314]'}`}>
                  {!focusConf.presente
                    ? 'Cadastro da empresa no Focus não encontrado'
                    : (focusConf.divergencias ?? 0) > 0
                      ? `Config da Focus DIVERGE da local em ${focusConf.divergencias} campo(s) — impede a emissão`
                      : 'Config da Focus confere com a local'}
                </div>
              </div>
              {!focusConf.presente && focusConf.erro && (
                <div className="text-[11px] text-[#3D2314]/65 ml-[23px]">{focusConf.erro}</div>
              )}
              {focusConf.presente && focusConf.campos && focusConf.campos.length > 0 && (
                <ul className="ml-[23px] space-y-1 mt-0.5">
                  {focusConf.campos.map((c) => (
                    <li key={c.chave} className="text-[11.5px] flex flex-wrap items-baseline gap-x-1.5">
                      {c.diverge
                        ? <XCircle className="text-[#C94544] flex-shrink-0 self-center" size={13} />
                        : <CheckCircle2 className="text-[#3F7012] flex-shrink-0 self-center" size={13} />}
                      <span className={`font-medium ${c.diverge ? 'text-[#791F1F]' : 'text-[#3D2314]/80'}`}>{c.rotulo}:</span>
                      {c.diverge ? (
                        <span className="text-[#791F1F]">local <b>{c.local ?? '—'}</b> ≠ Focus <b>{c.focus ?? '—'}</b></span>
                      ) : (
                        <span className="text-[#3D2314]/60">
                          {c.observacao ? c.observacao : `local ${c.local ?? '—'} = Focus ${c.focus ?? '—'}`}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {(focusConf.divergencias ?? 0) > 0 && (
                <div className="text-[11px] text-[#3D2314]/65 ml-[23px] mt-1">
                  Ajuste o cadastro da empresa no painel do Focus (app-v2.focusnfe.com.br) para bater com a config local — ou corrija a config local, o que estiver errado.
                </div>
              )}
            </div>
          )}

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
                  {(dados.produtos.simples_cst_regime_normal ?? 0) > 0 && <span>CST de regime normal (Simples usa CSOSN): {dados.produtos.simples_cst_regime_normal}</span>}
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
