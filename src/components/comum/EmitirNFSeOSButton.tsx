'use client'

// Chamado #20 · Fase 2 · Emitir NFS-e (serviços) a partir da OS.
//
// Fluxo:
//   1) fn_os_nfse_preparar(os) resolve, no banco (RD-38): valor de SERVIÇOS (só mão de obra/serviços
//      aprovados), valor de PEÇAS (só pra mostrar o que NÃO entra), o SERVIÇO FISCAL da empresa
//      (erp_servicos com LC116 — nunca o serviço de oficina/tempário) e o tomador (cliente da OS).
//   2) #centralizado: quando os itens de serviço já têm VÍNCULO fiscal (servico_fiscal_id), a preparação
//      devolve `grupos_fiscais` (um por serviço fiscal, com o valor total e a lista de itens). A tela então
//      NÃO pede escolha manual: pré-preenche e emite UMA nota por grupo (a NFS-e aceita um serviço por nota).
//      As descrições de cada item vão nas observações (discriminação). Itens sem vínculo caem no seletor antigo.
//   3) Sem vínculo nenhum (ex.: modelo tablet/Gean): comportamento EXATO de antes — seletor + uma nota.
//   4) "Continuar" abre o NFSeEmitirGovModal (RD-26: reusa o caminho provado de emissão, sem tocá-lo).

import { useState, type CSSProperties } from 'react'
import { Receipt } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { carregarProducaoDisponivel } from '@/lib/fiscal/producaoDisponivel'
import { NotaDaOSStatus, notaJaEmitida, useNotaDaOS } from '@/components/comum/NotaFiscalDaOS'
import NFSeEmitirGovModal from '@/components/fiscal/NFSeEmitirGovModal'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { buscarVeiculoLigado, montarObservacoesNfseOS, type DadosOSNfse } from '@/lib/oficina/observacoesNfseOS'

type ServicoFiscal = {
  id: string
  descricao: string | null
  codigo_servico_municipio: string | null
  codigo_lc116: string | null
  aliquota_iss: number | null
}
type ItemDisc = { descricao: string | null; quantidade: number; valor: number }
type CadastroGrupo = { servico_fiscal_id: string; descricao: string | null }
type GrupoFiscal = {
  servico_fiscal_id: string        // sugerido: cadastro do item de maior valor (operador pode trocar entre `cadastros`)
  descricao: string | null
  codigo_lc116: string | null
  codigo_servico_municipio: string | null
  aliquota_iss: number | null
  iss_retido?: boolean
  tipo_tributacao?: string | null
  valor_total: number
  qtd_itens: number
  itens: ItemDisc[]
  cadastros?: CadastroGrupo[]       // candidatos (mesma chave fiscal) para escolher o serviço da nota
}
type SemVinculo = { qtd: number; valor_total: number; itens: ItemDisc[] }
type Prep = {
  ok: boolean
  motivo?: string
  erro?: string
  os_numero?: string | null
  valor_servicos?: number
  valor_pecas?: number
  qtd_servicos?: number
  descricao_sugerida?: string
  tomador?: { documento: string; tipo: 'cpf' | 'cnpj' | 'indefinido'; nome: string | null; email: string | null }
  servico_fiscal_id_default?: string | null
  servicos_fiscais?: ServicoFiscal[]
  // #centralizado (aditivos):
  tem_vinculo?: boolean
  qtd_grupos?: number
  grupos_fiscais?: GrupoFiscal[]
  itens_sem_vinculo?: SemVinculo
}
// Uma NFS-e a emitir (um serviço fiscal por nota).
type NotaSpec = {
  servicoId: string
  descricao: string
  valor: number
  codigoLC116?: string
  codigoServicoMunicipio?: string
  aliquotaIss?: number
  observacoes: string
  rotulo: string
}

const C = { espresso: '#3D2314', espressoM: '#6B5D4F', gold: '#C8941A', line: '#E7DECF',
  green: '#166534', greenBg: '#EAF3DE', amber: '#B45309', amberBg: '#FAEEDA', red: '#A32D2D' }

const brl = (v: number | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Discriminação nas observações: nome de cada item (conforme o cadastro/OS), quantidade e valor.
// Só acrescenta quando o grupo tem mais de um item (uma linha só já é a própria descrição da nota).
function comDiscriminacao(base: string, itens: ItemDisc[]): string {
  const linhas = (itens ?? []).map((it) => `- ${(it.descricao ?? '').trim()} (${it.quantidade}x) ${brl(it.valor)}`)
  if (linhas.length <= 1) return base
  return [base, 'Itens:', ...linhas].filter(Boolean).join('\n')
}

export default function EmitirNFSeOSButton({
  osId,
  companyId,
  buttonStyle,
  onEmitida,
}: {
  osId: string
  companyId: string
  buttonStyle?: CSSProperties
  onEmitida?: () => void
}) {
  const [prep, setPrep] = useState<Prep | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [confirmAberto, setConfirmAberto] = useState(false)
  const [modalAberto, setModalAberto] = useState(false)
  const [producao, setProducao] = useState(false)
  const [servSel, setServSel] = useState('')
  const [clienteId, setClienteId] = useState<string | null>(null)
  const [obsOS, setObsOS] = useState('')
  // #centralizado · fila de notas a emitir (uma por serviço fiscal). Vazia = fluxo antigo (nota única).
  const [fila, setFila] = useState<NotaSpec[]>([])
  const [filaIdx, setFilaIdx] = useState(0)
  // ajuste #6426 · por grupo (índice), qual cadastro o operador escolheu como serviço da nota (default = sugerido).
  const [escolhaCadastro, setEscolhaCadastro] = useState<Record<number, string>>({})
  const { nota, recarregar } = useNotaDaOS('nfse', osId, companyId)
  const notaEmitida = notaJaEmitida(nota)

  async function preparar() {
    setErro(null)
    setCarregando(true)
    try {
      const [rpc, prod, os] = await Promise.all([
        supabase.rpc('fn_os_nfse_preparar', { p_os_id: osId }),
        carregarProducaoDisponivel(companyId),
        supabase.from('erp_os').select('cliente_id, numero, marca, modelo, placa, veic_veiculo_id')
          .eq('id', osId).eq('company_id', companyId).maybeSingle(),
      ])
      if (rpc.error) { setErro(rpc.error.message); return }
      const p = rpc.data as Prep | null
      if (!p?.ok) { setErro(p?.erro ?? 'Não foi possível preparar a NFS-e.'); return }
      setPrep(p)
      setFila([]); setFilaIdx(0); setEscolhaCadastro({})
      const osDados = os.data as (DadosOSNfse & { cliente_id?: string | null; veic_veiculo_id?: string | null }) | null
      setClienteId(osDados?.cliente_id ?? null)
      setObsOS(montarObservacoesNfseOS(osDados ? { ...osDados, veiculo: await buscarVeiculoLigado(osDados.veic_veiculo_id,
        (id) => supabase.from('veic_veiculo').select('marca, modelo, placa').eq('id', id).maybeSingle()) } : null))
      setProducao(prod)
      setServSel(p.servico_fiscal_id_default ?? p.servicos_fiscais?.[0]?.id ?? '')
      setConfirmAberto(true)
    } finally {
      setCarregando(false)
    }
  }

  const grupos = prep?.grupos_fiscais ?? []
  const temVinculo = !!prep?.tem_vinculo && grupos.length > 0
  const semVinculo = prep?.itens_sem_vinculo
  const precisaSeletorSemVinculo = temVinculo && (semVinculo?.qtd ?? 0) > 0
  // fluxo antigo (sem vínculo): serviço escolhido no seletor
  const servico = prep?.servicos_fiscais?.find((s) => s.id === servSel) ?? prep?.servicos_fiscais?.[0]
  const varios = (prep?.servicos_fiscais?.length ?? 0) > 1
  // quantas notas vão sair no modo com vínculo (grupos + eventual nota dos itens sem vínculo)
  const totalNotas = temVinculo ? grupos.length + (precisaSeletorSemVinculo ? 1 : 0) : 1
  const obsBase = obsOS

  function continuar() {
    if (temVinculo) {
      const specs: NotaSpec[] = grupos.map((g, gi) => {
        // serviço da nota = cadastro escolhido pelo operador (ou o sugerido). O VALOR não muda: é o total do grupo.
        const escolhidoId = escolhaCadastro[gi] ?? g.servico_fiscal_id
        const cad = g.cadastros?.find((c) => c.servico_fiscal_id === escolhidoId)
        const desc = cad?.descricao || g.descricao || prep?.descricao_sugerida || 'Serviços'
        return {
          servicoId: escolhidoId,
          descricao: desc,
          valor: g.valor_total,
          codigoLC116: g.codigo_lc116 ?? undefined,
          codigoServicoMunicipio: g.codigo_servico_municipio ?? undefined,
          aliquotaIss: g.aliquota_iss ?? undefined,
          observacoes: comDiscriminacao(obsBase, g.itens),
          rotulo: `${desc} · ${brl(g.valor_total)}`,
        }
      })
      if (precisaSeletorSemVinculo && servico) {
        specs.push({
          servicoId: servico.id,
          descricao: servico.descricao || prep?.descricao_sugerida || 'Serviços',
          valor: semVinculo!.valor_total,
          codigoLC116: servico.codigo_lc116 ?? undefined,
          codigoServicoMunicipio: servico.codigo_servico_municipio ?? undefined,
          aliquotaIss: servico.aliquota_iss ?? undefined,
          observacoes: comDiscriminacao(obsBase, semVinculo!.itens),
          rotulo: `Demais serviços · ${brl(semVinculo!.valor_total)}`,
        })
      }
      setFila(specs); setFilaIdx(0)
    } else {
      setFila([]); setFilaIdx(0)
    }
    setConfirmAberto(false); setModalAberto(true)
  }

  // props da nota corrente: da fila (modo com vínculo) ou do fluxo antigo (nota única)
  const atual: NotaSpec | null = fila.length > 0 ? fila[filaIdx] : null
  const modalDescricao = atual?.descricao ?? prep?.descricao_sugerida
  const modalCodigoMun = atual?.codigoServicoMunicipio ?? servico?.codigo_servico_municipio ?? undefined
  const modalLC116 = atual?.codigoLC116 ?? servico?.codigo_lc116 ?? undefined
  const modalAliquota = atual?.aliquotaIss ?? servico?.aliquota_iss ?? undefined
  const modalValor = atual?.valor ?? prep?.valor_servicos
  const modalServicoId = atual?.servicoId ?? servico?.id
  const modalObs = atual?.observacoes ?? obsOS

  const defBtn: CSSProperties = {
    fontSize: 12, fontWeight: 600, color: C.espresso, background: '#FFFFFF',
    border: `1px solid ${C.line}`, borderRadius: 8, padding: '10px 14px', minHeight: 44, cursor: 'pointer',
  }
  const selStyle: CSSProperties = { width: '100%', border: `1px solid ${C.line}`, borderRadius: 6, padding: '8px 10px', fontSize: 13, color: C.espresso, background: '#FFFFFF' }

  return (
    <>
      {notaEmitida ? (
        <NotaDaOSStatus tipo="nfse" nota={nota} companyId={companyId}
          onAtualizar={() => void recarregar()} onEmitirOutra={() => void preparar()} />
      ) : (
        <button
          type="button"
          onClick={() => void preparar()}
          disabled={carregando}
          data-testid="os-nfse-emitir"
          title={nota?.status === 'rejeitada'
            ? `A última NFS-e desta OS foi rejeitada${nota.motivo_rejeicao ? `: ${nota.motivo_rejeicao}` : ''}. Corrija e emita de novo.`
            : 'Emite a NFS-e (nota de SERVIÇO) da OS. Só o valor de serviços entra — peças saem na NF-e de produto.'}
          style={{ ...defBtn, ...buttonStyle, opacity: carregando ? 0.6 : 1 }}
        >
          {carregando ? 'Preparando…' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Receipt size={14} aria-hidden />{nota?.status === 'rejeitada' ? 'Reenviar NFS-e' : 'Emitir NFS-e'}</span>}
        </button>
      )}

      {erro && !confirmAberto && (
        <div role="alert"
          style={{ flexBasis: '100%', marginTop: 8, fontSize: 12, color: '#791F1F',
            background: '#FCEBEB', borderLeft: `4px solid ${C.red}`, borderRadius: 6, padding: '8px 12px' }}>
          {erro}
          <button type="button" onClick={() => setErro(null)}
            style={{ marginLeft: 8, textDecoration: 'underline', background: 'none', border: 'none', color: '#791F1F', cursor: 'pointer' }}>ok</button>
        </div>
      )}

      {confirmAberto && prep && (
        <div role="dialog" aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmAberto(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', zIndex: 1000,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: '#FFFFFF', borderRadius: 12, maxWidth: 460, width: '100%', padding: 20 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: C.espresso }}>Emitir NFS-e · OS {prep.os_numero}</h3>
            <p style={{ margin: '4px 0 14px', fontSize: 12, color: C.espressoM }}>Nota de <b>serviço</b>. Confira antes de emitir.</p>

            <div style={{ background: C.greenBg, borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: C.green, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>Vai na nota (serviços · {prep.qtd_servicos})</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: C.green }}>{brl(prep.valor_servicos)}</div>
            </div>

            <div style={{ background: C.amberBg, borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: C.amber, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>Fica de fora (peças)</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.amber }}>{brl(prep.valor_pecas)}</div>
              <div style={{ fontSize: 11, color: C.amber, marginTop: 2 }}>Peça não entra em nota de serviço — sai na NF-e de produto.</div>
            </div>

            {temVinculo ? (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: C.espressoM, marginBottom: 6 }}>
                  {totalNotas > 1 ? <>Serão emitidas <b>{totalNotas} notas</b> (uma por serviço fiscal):</> : <>Serviço fiscal da OS (preenchido automaticamente):</>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {grupos.map((g, gi) => {
                    const cadastros = g.cadastros ?? []
                    const escolhido = escolhaCadastro[gi] ?? g.servico_fiscal_id
                    return (
                      <div key={gi} style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: '8px 10px' }}>
                        <div style={{ fontSize: 13, color: C.green, fontWeight: 700 }}>{brl(g.valor_total)} <span style={{ fontSize: 11, color: C.espressoM, fontWeight: 400 }}>· {g.qtd_itens} {g.qtd_itens === 1 ? 'item' : 'itens'} · LC {g.codigo_lc116}</span></div>
                        <div style={{ fontSize: 11, color: C.espressoM, marginTop: 2 }}>Itens (na discriminação da nota): {g.itens.map((it) => `${(it.descricao ?? '').trim()} (${brl(it.valor)})`).filter(Boolean).join(' · ')}</div>
                        {cadastros.length > 1 ? (
                          <label style={{ display: 'block', marginTop: 6 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.espressoM, marginBottom: 3 }}>Serviço da nota <AjudaCampo chave="oficina.os.nfse_servico_nota" rota="/dashboard/os" /></span>
                            <select value={escolhido} onChange={(e) => setEscolhaCadastro((m) => ({ ...m, [gi]: e.target.value }))} style={selStyle}>
                              {cadastros.map((c) => (<option key={c.servico_fiscal_id} value={c.servico_fiscal_id}>{c.descricao}</option>))}
                            </select>
                          </label>
                        ) : (
                          <div style={{ fontSize: 12, color: C.espresso, marginTop: 4 }}>Serviço da nota: <b>{g.descricao}</b></div>
                        )}
                      </div>
                    )
                  })}
                  {precisaSeletorSemVinculo && (
                    <div style={{ border: `1px dashed ${C.amber}`, borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ fontSize: 12, color: C.amber, marginBottom: 4 }}>{semVinculo!.qtd} serviço(s) sem vínculo (texto livre) — escolha o serviço fiscal para eles ({brl(semVinculo!.valor_total)}):</div>
                      <label style={{ display: 'block' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.espressoM, marginBottom: 4 }}>Serviço fiscal (LC116) <AjudaCampo chave="oficina.os.nfse_servico_fiscal" rota="/dashboard/os" /></span>
                        <select value={servSel} onChange={(e) => setServSel(e.target.value)} style={selStyle}>
                          {prep.servicos_fiscais?.map((s) => (<option key={s.id} value={s.id}>{s.descricao} · LC {s.codigo_lc116}</option>))}
                        </select>
                      </label>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <label style={{ display: 'block', marginBottom: 14 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.espressoM, marginBottom: 4 }}>Serviço fiscal (LC116) <AjudaCampo chave="oficina.os.nfse_servico_fiscal" rota="/dashboard/os" /></span>
                {varios ? (
                  <select value={servSel} onChange={(e) => setServSel(e.target.value)} style={selStyle}>
                    {prep.servicos_fiscais?.map((s) => (<option key={s.id} value={s.id}>{s.descricao} · LC {s.codigo_lc116}</option>))}
                  </select>
                ) : (
                  <div style={{ fontSize: 13, color: C.espresso }}>{servico?.descricao} · <span style={{ color: C.espressoM }}>LC {servico?.codigo_lc116} · mun. {servico?.codigo_servico_municipio}</span></div>
                )}
              </label>
            )}

            <div style={{ fontSize: 12, color: C.espressoM, marginBottom: 16 }}>
              Tomador: <b style={{ color: C.espresso }}>{prep.tomador?.nome ?? '—'}</b>
              {prep.tomador?.documento ? ` · ${prep.tomador.tipo.toUpperCase()} ${prep.tomador.documento}` : ' · sem documento (informe no cadastro do cliente)'}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => setConfirmAberto(false)}
                style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.line}`, background: '#FFFFFF', color: C.espresso, fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
              <button type="button" onClick={continuar} data-testid="os-nfse-continuar"
                style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: 'none', background: C.gold, color: C.espresso, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                {totalNotas > 1 ? `Emitir ${totalNotas} notas →` : 'Continuar →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* reusa o modal de emissão (um serviço por nota). No modo com vínculo, key força remontar a cada grupo da fila. */}
      <NFSeEmitirGovModal
        key={`nfse-${filaIdx}-${fila.length}`}
        companyId={companyId}
        aberto={modalAberto}
        onFechar={() => { setModalAberto(false); setFila([]); setFilaIdx(0) }}
        onEmitida={(providerReference) => {
          if (providerReference) void supabase.rpc('fn_os_nfse_vincular', { p_os_id: osId, p_provider_reference: providerReference }).then(() => recarregar())
          // fila com vínculo: avança para a próxima nota; senão encerra.
          if (fila.length > 0 && filaIdx + 1 < fila.length) {
            setFilaIdx((i) => i + 1)   // key muda → modal remonta já com o próximo grupo
          } else {
            setModalAberto(false); setPrep(null); setFila([]); setFilaIdx(0); onEmitida?.()
          }
        }}
        producaoDisponivel={producao}
        tomadorDocumento={prep?.tomador?.documento}
        tomadorTipo={prep?.tomador?.tipo}
        tomadorNome={prep?.tomador?.nome ?? undefined}
        tomadorEmail={prep?.tomador?.email ?? undefined}
        tomadorClienteId={clienteId ?? undefined}
        descricaoServico={modalDescricao}
        codigoServicoMunicipio={modalCodigoMun}
        codigoLC116={modalLC116}
        aliquotaIss={modalAliquota}
        valorServicos={modalValor}
        servicoId={modalServicoId}
        observacoesIniciais={modalObs}
      />
    </>
  )
}
