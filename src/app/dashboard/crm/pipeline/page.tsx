'use client'
// PS CRM · Funil de vendas (quadro). Colunas = etapas do funil CADASTRADO (funil_etapa, editável em /dashboard/crm/funis,
// reflete sem deploy). Quadro = componente genérico QuadroFunil (o mesmo dos leads do P&M). Arrastar (ou "Mover para",
// no celular) chama fn_crm_oportunidade_mover: muda a etapa, grava o histórico (gatilho) e zera o tempo na etapa.
// Perdido exige motivo do cadastro. Vendedor vê só a própria carteira (o banco filtra).
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { erroAmigavel } from '@/lib/erroAmigavel'
import Modal from '@/components/ui/Modal'
import QuadroFunil from '@/components/crm/QuadroFunil'
import NovoNegocioModal from '@/components/crm/NovoNegocioModal'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { C, Campo, Cabecalho, Pagina, Aviso, Vazio, SemEmpresa, inp, btnPri, btnSec, chip, brl, waHref, rpcCrm, useCrm, type Etapa } from '@/components/crm/crmUi'

type Cartao = {
  id: string; titulo: string; cliente: string | null; telefone: string | null; valor: number | null; probabilidade: number | null
  responsavel_id: string | null; responsavel_nome: string | null; etapa_id: string; dias_na_etapa: number
  data_prevista: string | null; motivo_perda: string | null; semaforo: 'verde' | 'amarelo' | 'vermelho'
}
type Quadro = { cards: Cartao[]; resumo: { abertas: number; valor_aberto: number; valor_ponderado: number; ganhos_30d: number; valor_ganho_30d: number } }

export default function PipelinePage() {
  const { empresa, cfg, erro: erroCfg, carregando, gestor, soLeitura } = useCrm()
  const funis = useMemo(() => (cfg?.funis ?? []).filter((f) => f.ativo), [cfg])
  const [funilId, setFunilId] = useState<string>('')
  const [resp, setResp] = useState('')
  const [quadro, setQuadro] = useState<Quadro | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [novo, setNovo] = useState(false)
  const [perda, setPerda] = useState<{ card: Cartao; etapa: Etapa } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [motivoTexto, setMotivoTexto] = useState('')

  useEffect(() => { if (!funilId && funis.length) setFunilId(funis[0].id) }, [funis, funilId])
  const funil = funis.find((f) => f.id === funilId) ?? null
  const etapas = funil?.etapas ?? []

  const carregar = useCallback(async () => {
    if (!empresa || !funilId) return
    const { data, error } = await supabase.rpc('fn_crm_quadro', { p_company_id: empresa, p_funil_id: funilId, p_responsavel_id: resp || null })
    if (error) { setErro(erroAmigavel(error)); return }
    setQuadro(data as Quadro)
  }, [empresa, funilId, resp])
  useEffect(() => { void carregar() }, [carregar])

  async function mover(card: Cartao, etapaId: string, motivoId?: string, texto?: string) {
    const et = etapas.find((e) => e.id === etapaId)
    if (!et) return
    if (et.tipo_etapa === 'perda' && !motivoId) { setPerda({ card, etapa: et }); setMotivo(''); setMotivoTexto(''); return }
    // otimista: o cartão já muda de coluna; se o banco recusar, volta
    setQuadro((q) => q && { ...q, cards: q.cards.map((c) => (c.id === card.id ? { ...c, etapa_id: etapaId, dias_na_etapa: 0, semaforo: 'verde' } : c)) })
    try {
      await rpcCrm('fn_crm_oportunidade_mover', { p_id: card.id, p_etapa_id: etapaId, p_motivo_perda_id: motivoId ?? null, p_motivo_texto: texto ?? null })
      setOk(et.tipo_etapa === 'ganho' ? `🎉 "${card.titulo}" ganho!${cfg?.tem_ge ? ' A Gestão Empresarial foi avisada.' : ''}` : null)
      setPerda(null)
    } catch (e) { setErro((e as Error).message) }
    void carregar()
  }

  if (!empresa && !carregando) return <Pagina><Cabecalho titulo="Funil de vendas" /><SemEmpresa /></Pagina>
  const cards = quadro?.cards ?? []
  const r = quadro?.resumo
  const motivos = (cfg?.motivos ?? []).filter((m) => m.ativo)
  const motivoSel = motivos.find((m) => m.id === motivo)

  return (
    <Pagina>
      <Cabecalho titulo="Funil de vendas" subtitulo="Arraste o negócio para a próxima etapa. No celular, use “Mover para”."
        acoes={!soLeitura && cfg ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><button style={btnPri} onClick={() => setNovo(true)} data-testid="crm-novo-negocio">+ Novo negócio</button><AjudaCampo chave="crm.hoje.novo_negocio" /></span> : undefined} />
      <Aviso texto={erroCfg || erro} onFechar={() => setErro(null)} />
      <Aviso texto={ok} tipo="ok" onFechar={() => setOk(null)} />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        {funis.length > 0 && (
          <Campo rotulo="Funil" ajuda="crm.pipeline.funil" largura={200}>
            <select style={inp} value={funilId} onChange={(e) => setFunilId(e.target.value)} data-testid="crm-funil-sel">
              {funis.map((f) => <option key={f.id} value={f.id}>{f.nome}{f.tipo_negocio ? ` · ${f.tipo_negocio}` : ''}</option>)}
            </select>
          </Campo>
        )}
        {gestor && (
          <Campo rotulo="Responsável" ajuda="crm.pipeline.responsavel" largura={200}>
            <select style={inp} value={resp} onChange={(e) => setResp(e.target.value)}>
              <option value="">Toda a equipe</option>
              {(cfg?.equipe ?? []).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </Campo>
        )}
        {r && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginLeft: 'auto' }}>
            <Indicador rotulo="Em aberto" valor={`${r.abertas} · ${brl(r.valor_aberto)}`} />
            <Indicador rotulo="Previsão (ponderado)" valor={brl(r.valor_ponderado)} ajuda="crm.pipeline.ponderado" destaque />
            <Indicador rotulo="Ganhos em 30 dias" valor={`${r.ganhos_30d} · ${brl(r.valor_ganho_30d)}`} />
          </div>
        )}
      </div>

      {carregando || !quadro ? <div style={{ padding: 40, textAlign: 'center', color: C.TEXTM }}>Carregando…</div>
        : etapas.length === 0 ? <Vazio texto="Este funil ainda não tem etapas." acao={<Link href="/dashboard/crm/funis" style={{ ...btnPri, textDecoration: 'none', display: 'inline-block' }}>Cadastrar etapas</Link>} />
        : (
          <>
            {cards.length === 0 && (
              <div style={{ marginBottom: 12 }}>
                <Vazio texto="Nenhum negócio neste funil ainda. Crie o primeiro — leva 10 segundos." acao={!soLeitura ? <button style={btnPri} onClick={() => setNovo(true)}>+ Novo negócio</button> : undefined} />
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: C.TEXTM, marginBottom: 8 }}>Colunas = etapas do funil cadastrado<AjudaCampo chave="crm.pipeline.quadro" /></div>
            <QuadroFunil<Cartao>
              colunas={etapas.map((e) => ({ chave: e.id, rotulo: e.rotulo, cor: e.cor, tipo: e.tipo_etapa, detalhe: e.tipo_etapa === 'normal' && e.probabilidade != null ? `${e.probabilidade}%` : null }))}
              itens={cards}
              idDe={(c) => c.id}
              colunaDe={(c) => c.etapa_id}
              valorDe={(c) => Number(c.valor ?? 0)}
              onMover={(c, etapaId) => void mover(c, etapaId)}
              podeArrastar={!soLeitura}
              testIdCartao="crm-cartao"
              vazio="Solte um negócio aqui"
              estiloCartao={(c) => ({ border: c.semaforo === 'vermelho' ? `1.5px solid ${C.RED}` : c.semaforo === 'amarelo' ? `1.5px solid ${C.DOURADO}` : `1px solid ${C.BORDA}` })}
              renderCartao={(c) => {
                const wa = waHref(c.telefone, `Olá! Aqui é da equipe comercial sobre "${c.titulo}".`)
                const corDias = c.semaforo === 'vermelho' ? C.RED : c.semaforo === 'amarelo' ? C.DOURADO : C.TEXTM
                const fechado = etapas.find((e) => e.id === c.etapa_id)?.tipo_etapa !== 'normal'
                return (
                  <>
                    <Link href={`/dashboard/crm/oportunidade/${c.id}`} style={{ color: C.ESPRESSO, textDecoration: 'none', display: 'block' }}>
                      <strong style={{ fontSize: 13.5, lineHeight: 1.3 }}>{c.titulo}</strong>
                      {c.cliente && <div style={{ fontSize: 12, color: C.TEXTM, marginTop: 2 }}>{c.cliente}</div>}
                    </Link>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 700 }}>{c.valor ? brl(c.valor) : '—'}</span>
                      {!fechado && <span style={{ fontSize: 11, color: corDias, fontWeight: c.semaforo === 'verde' ? 400 : 700 }}>⏱ {c.dias_na_etapa} {c.dias_na_etapa === 1 ? 'dia' : 'dias'} na etapa</span>}
                    </div>
                    {c.responsavel_nome && <div style={{ fontSize: 11, color: C.TEXTM, marginTop: 2 }}>👤 {c.responsavel_nome}</div>}
                    {c.motivo_perda && <div style={{ fontSize: 11, color: C.RED, marginTop: 2 }}>motivo: {c.motivo_perda}</div>}
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      {wa && <a href={wa} target="_blank" rel="noopener noreferrer" style={chip('#fff', C.WA)} data-testid="crm-cartao-whatsapp" onClick={(e) => e.stopPropagation()}>💬 WhatsApp</a>}
                      {!soLeitura && (
                        <select aria-label="Mover para" value="" onChange={(e) => { if (e.target.value) void mover(c, e.target.value) }}
                          style={{ ...chip(C.ESPRESSO), padding: '4px 6px', maxWidth: 140 }} data-ajuda="crm.pipeline.mover" data-testid="crm-cartao-mover">
                          <option value="">Mover para…</option>
                          {etapas.filter((e) => e.id !== c.etapa_id).map((e) => <option key={e.id} value={e.id}>{e.rotulo}</option>)}
                        </select>
                      )}
                    </div>
                  </>
                )
              }}
            />
          </>
        )}

      {cfg && empresa && <NovoNegocioModal aberto={novo} onFechar={() => setNovo(false)} empresa={empresa} cfg={cfg} funilId={funilId}
        onCriado={() => { setNovo(false); setOk('Negócio criado.'); void carregar() }} />}

      <Modal open={!!perda} onClose={() => setPerda(null)} title="Por que este negócio foi perdido?" subtitle={perda?.card.titulo}
        footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={btnSec} onClick={() => setPerda(null)}>Cancelar</button>
          <button style={{ ...btnPri, background: C.RED, opacity: !motivo || (motivoSel?.exige_descricao && !motivoTexto.trim()) ? 0.5 : 1 }}
            disabled={!motivo || (!!motivoSel?.exige_descricao && !motivoTexto.trim())}
            onClick={() => perda && void mover(perda.card, perda.etapa.id, motivo, motivoTexto)} data-testid="crm-perda-confirmar">Marcar como perdido</button>
        </div>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Campo rotulo="Motivo da perda" ajuda="crm.pipeline.motivo_perda">
            <select style={inp} value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid="crm-perda-motivo">
              <option value="">Escolha…</option>
              {motivos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo={motivoSel?.exige_descricao ? 'Conte um pouco mais (obrigatório)' : 'Complemento (opcional)'} ajuda="crm.pipeline.motivo_perda">
            <input style={inp} value={motivoTexto} onChange={(e) => setMotivoTexto(e.target.value)} placeholder="Ex.: concorrente cobrou 15% menos" />
          </Campo>
        </div>
      </Modal>
    </Pagina>
  )
}

function Indicador({ rotulo, valor, ajuda, destaque }: { rotulo: string; valor: string; ajuda?: string; destaque?: boolean }) {
  return (
    <div style={{ background: destaque ? C.ESPRESSO : '#fff', color: destaque ? C.OFFWHITE : C.ESPRESSO, border: `1px solid ${destaque ? C.ESPRESSO : C.BORDA}`, borderRadius: 12, padding: '8px 12px', minWidth: 140 }}>
      <div style={{ fontSize: 11, opacity: 0.8, display: 'inline-flex', alignItems: 'center', gap: 2 }}>{rotulo}{ajuda && <AjudaCampo chave={ajuda} />}</div>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{valor}</div>
    </div>
  )
}
