'use client'
// PS CRM · Ficha do negócio. Tudo numa tela só: etapa (toque no chip para mover), dados, campos próprios da empresa,
// registrar o que aconteceu (WhatsApp, ligação, reunião…), agendar o próximo passo e a linha do tempo (histórico de
// etapas + atividades + visitas). Leitura: fn_crm_oportunidade_ficha · escrita: RPCs fn_crm_* (o banco confere a carteira).
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { erroAmigavel } from '@/lib/erroAmigavel'
import Modal from '@/components/ui/Modal'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { MessageCircle } from 'lucide-react'
import { C, Campo, Titulo, Cabecalho, Pagina, Aviso, Vazio, inp, btnPri, btnSec, chip, cartao, dataBR, horaBR, waHref, rpcCrm, useCrm,
  TIPOS_ATIVIDADE, TIPOS_TAREFA, IconeTipo, type CampoCustom } from '@/components/crm/crmUi'

type EtapaF = { id: string; rotulo: string; tipo_etapa: 'normal' | 'ganho' | 'perda'; cor: string | null; probabilidade: number | null }
type Op = {
  id: string; company_id: string; titulo: string; cliente_id: string | null; cliente_nome: string | null; cliente_fone: string | null
  contato_id: string | null; contato_nome: string | null; contato_fone: string | null; funil_etapa_id: string | null; etapa: string
  valor_estimado: number | null; valor_proposta: number | null; origem_id: string | null; responsavel_id: string | null; responsavel_nome: string | null
  data_prevista_fechamento: string | null; observacoes: string | null; campos_custom: Record<string, unknown> | null; motivo_perda: string | null
  dias_na_etapa: number
}
type Evento = { tipo: string; acao?: string; texto: string | null; quando: string; autor: string | null }
type Tarefa = { id: string; tipo: string; titulo: string; vence_em: string; concluida_em: string | null; responsavel_id: string | null }
type Ficha = { oportunidade: Op; etapas: EtapaF[]; linha_do_tempo: Evento[]; tarefas: Tarefa[]; evento_ge: { status: string; criado_em: string } | null }
type Contato = { id: string; nome: string }

const numBR = (v: string) => (v ? Number(v.replace(/\./g, '').replace(',', '.')) : null)
const paraCampo = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','))

export default function FichaNegocioPage() {
  const { id } = useParams<{ id: string }>()
  const { empresa, cfg, gestor, soLeitura } = useCrm()
  const [ficha, setFicha] = useState<Ficha | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [naoAchou, setNaoAchou] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [custom, setCustom] = useState<Record<string, unknown>>({})
  const [contatos, setContatos] = useState<Contato[]>([])
  const [ativTipo, setAtivTipo] = useState('whatsapp')
  const [ativTexto, setAtivTexto] = useState('')
  const [tarTipo, setTarTipo] = useState('whatsapp')
  const [tarTitulo, setTarTitulo] = useState('')
  const [tarData, setTarData] = useState('')
  const [perda, setPerda] = useState<EtapaF | null>(null)
  const [motivo, setMotivo] = useState('')
  const [motivoTexto, setMotivoTexto] = useState('')

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_crm_oportunidade_ficha', { p_id: id })
    if (error) { setErro(erroAmigavel(error)); return }
    if (!data) { setNaoAchou(true); return }
    const f = data as Ficha
    setFicha(f)
    const o = f.oportunidade
    setForm({
      titulo: o.titulo ?? '', valor_estimado: paraCampo(o.valor_estimado), valor_proposta: paraCampo(o.valor_proposta),
      data_prevista_fechamento: o.data_prevista_fechamento ?? '', origem_id: o.origem_id ?? '', responsavel_id: o.responsavel_id ?? '',
      contato_id: o.contato_id ?? '', observacoes: o.observacoes ?? '',
    })
    setCustom(o.campos_custom ?? {})
  }, [id])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga/sincronia ao trocar empresa, funil ou filtro
  useEffect(() => { void carregar() }, [carregar])

  const clienteId = ficha?.oportunidade.cliente_id
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga/sincronia ao trocar empresa, funil ou filtro
    if (!clienteId) { setContatos([]); return }
    void supabase.from('erp_contatos').select('id, nome').eq('entidade_tipo', 'cliente').eq('entidade_id', clienteId).eq('ativo', true).order('nome')
      .then(({ data }) => setContatos((data ?? []) as Contato[]))
  }, [clienteId])

  const camposOp = useMemo(() => (cfg?.campos ?? []).filter((c) => c.entidade === 'oportunidade' && c.ativo), [cfg])

  async function mover(et: EtapaF, motivoId?: string, texto?: string) {
    if (!ficha || et.id === ficha.oportunidade.funil_etapa_id) return
    if (et.tipo_etapa === 'perda' && !motivoId) { setPerda(et); setMotivo(''); setMotivoTexto(''); return }
    try {
      await rpcCrm('fn_crm_oportunidade_mover', { p_id: id, p_etapa_id: et.id, p_motivo_perda_id: motivoId ?? null, p_motivo_texto: texto ?? null })
      setOk(et.tipo_etapa === 'ganho' ? `Negócio ganho!${cfg?.tem_ge ? ' A Gestão Empresarial foi avisada.' : ''}` : `Movido para ${et.rotulo}.`)
      setPerda(null); void carregar()
    } catch (e) { setErro((e as Error).message) }
  }

  async function salvarDados() {
    for (const c of camposOp) {
      const v = custom[c.chave]
      if (c.obrigatorio && (v === undefined || v === null || v === '')) { setErro(`Preencha "${c.rotulo}".`); return }
    }
    try {
      const dados: Record<string, unknown> = {
        titulo: form.titulo, valor_estimado: numBR(form.valor_estimado), valor_proposta: numBR(form.valor_proposta),
        data_prevista_fechamento: form.data_prevista_fechamento || null, origem_id: form.origem_id || null,
        contato_id: form.contato_id || null, observacoes: form.observacoes, campos_custom: custom,
      }
      if (gestor) dados.responsavel_id = form.responsavel_id || null
      await rpcCrm('fn_crm_oportunidade_atualizar', { p_id: id, p_dados: dados })
      setOk('Dados salvos.'); void carregar()
    } catch (e) { setErro((e as Error).message) }
  }

  async function registrarAtividade() {
    if (!ficha) return
    try {
      await rpcCrm('fn_crm_interacao_registrar', { p_company_id: ficha.oportunidade.company_id, p_oportunidade_id: id, p_lead_id: null, p_tipo: ativTipo, p_descricao: ativTexto })
      setAtivTexto(''); setOk('Atividade registrada.'); void carregar()
    } catch (e) { setErro((e as Error).message) }
  }

  async function agendar() {
    if (!ficha) return
    try {
      await rpcCrm('fn_crm_tarefa_salvar', { p_company_id: ficha.oportunidade.company_id, p_dados: {
        oportunidade_id: id, tipo: tarTipo, titulo: tarTitulo, vence_em: tarData ? new Date(tarData).toISOString() : null } })
      setTarTitulo(''); setTarData(''); setOk('Próximo passo agendado.'); void carregar()
    } catch (e) { setErro((e as Error).message) }
  }

  async function concluir(t: Tarefa) {
    try { await rpcCrm('fn_crm_tarefa_concluir', { p_id: t.id, p_concluida: !t.concluida_em }); void carregar() }
    catch (e) { setErro((e as Error).message) }
  }

  if (naoAchou) return <Pagina><Cabecalho titulo="Negócio" /><Vazio texto="Negócio não encontrado (ou foi excluído)." acao={<Link href="/dashboard/crm/pipeline" style={chip(C.ESPRESSO)}>Voltar ao funil</Link>} /></Pagina>
  if (!ficha || !cfg) return <Pagina><Aviso texto={erro} />{!erro && <div style={{ color: C.TEXTM }}>Carregando…</div>}</Pagina>
  if (empresa && ficha.oportunidade.company_id !== empresa) return <Pagina><Vazio texto="Este negócio é de outra empresa. Troque a empresa no seletor do topo." /></Pagina>

  const o = ficha.oportunidade
  const fone = o.contato_fone ?? o.cliente_fone
  const wa = waHref(fone, `Olá${o.contato_nome ? ` ${o.contato_nome.split(' ')[0]}` : ''}, tudo bem?`)
  const atual = ficha.etapas.find((e) => e.id === o.funil_etapa_id)
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const bloqueado = soLeitura

  return (
    <Pagina>
      <div style={{ marginBottom: 8 }}><Link href="/dashboard/crm/pipeline" style={{ color: C.TEXTM, fontSize: 13 }}>← Funil</Link></div>
      <Cabecalho titulo={o.titulo}
        subtitulo={`${o.cliente_nome ?? 'Sem empresa'}${o.contato_nome ? ` · ${o.contato_nome}` : ''} · ${atual?.rotulo ?? o.etapa} há ${o.dias_na_etapa} dia(s)`}
        acoes={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {wa ? <a href={wa} target="_blank" rel="noreferrer" style={{ ...chip(C.WA), minHeight: 44, padding: '0 14px', fontSize: 14 }} data-testid="crm-ficha-whatsapp"><MessageCircle size={16} strokeWidth={1.5} aria-hidden /> WhatsApp</a>
            : <span style={{ fontSize: 12, color: C.TEXTM }}>Sem telefone cadastrado</span>}
          <AjudaCampo chave="crm.ficha.whatsapp" />
        </span>} />
      <Aviso texto={erro} onFechar={() => setErro(null)} />
      <Aviso texto={ok} tipo="ok" onFechar={() => setOk(null)} />
      {ficha.evento_ge && <Aviso tipo="ok" texto={`Ganho enviado à Gestão Empresarial em ${dataBR(ficha.evento_ge.criado_em)} (situação: ${ficha.evento_ge.status}).`} />}

      <section style={{ ...cartao, marginBottom: 14 }}>
        <Titulo texto="Etapa" ajuda="crm.ficha.etapa" />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-testid="crm-ficha-etapas">
          {ficha.etapas.map((e) => {
            const sel = e.id === o.funil_etapa_id
            const cor = e.tipo_etapa === 'ganho' ? C.GREEN : e.tipo_etapa === 'perda' ? C.RED : C.ESPRESSO
            return (
              <button key={e.id} disabled={bloqueado} onClick={() => void mover(e)}
                style={{ ...chip(cor, sel ? (e.tipo_etapa === 'ganho' ? C.GREEN_BG : e.tipo_etapa === 'perda' ? C.RED_BG : '#F3E9D6') : '#fff'), minHeight: 40, fontSize: 13, borderWidth: sel ? 2 : 1 }}>
                {e.tipo_etapa === 'ganho' ? '✓ ' : e.tipo_etapa === 'perda' ? '✕ ' : ''}{e.rotulo}{e.probabilidade != null && e.tipo_etapa === 'normal' ? ` · ${e.probabilidade}%` : ''}
              </button>
            )
          })}
        </div>
        {o.etapa === 'perdido' && o.motivo_perda && <div style={{ marginTop: 8, fontSize: 13, color: C.RED }}>Motivo: {o.motivo_perda}</div>}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <section style={cartao}>
          <Titulo texto="Dados do negócio" ajuda="crm.ficha.dados" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Campo rotulo="Nome do negócio" ajuda="crm.novo.titulo"><input style={inp} value={form.titulo ?? ''} onChange={set('titulo')} disabled={bloqueado} /></Campo>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Campo rotulo="Valor estimado (R$)" ajuda="crm.novo.valor" largura={140}>
                <input style={inp} inputMode="decimal" value={form.valor_estimado ?? ''} onChange={(e) => setForm((f) => ({ ...f, valor_estimado: e.target.value.replace(/[^\d.,]/g, '') }))} disabled={bloqueado} />
              </Campo>
              <Campo rotulo="Valor da proposta (R$)" ajuda="crm.ficha.valor_proposta" largura={140}>
                <input style={inp} inputMode="decimal" value={form.valor_proposta ?? ''} onChange={(e) => setForm((f) => ({ ...f, valor_proposta: e.target.value.replace(/[^\d.,]/g, '') }))} disabled={bloqueado} />
              </Campo>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Campo rotulo="Previsão de fechamento" ajuda="crm.novo.previsao" largura={140}>
                <input style={inp} type="date" value={form.data_prevista_fechamento ?? ''} onChange={set('data_prevista_fechamento')} disabled={bloqueado} />
              </Campo>
              <Campo rotulo="Origem" ajuda="crm.novo.origem" largura={140}>
                <select style={inp} value={form.origem_id ?? ''} onChange={set('origem_id')} disabled={bloqueado}>
                  <option value="">—</option>
                  {cfg.origens.filter((x) => x.ativo || x.id === form.origem_id).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                </select>
              </Campo>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Campo rotulo="Contato" ajuda="crm.ficha.contato" largura={140}>
                <select style={inp} value={form.contato_id ?? ''} onChange={set('contato_id')} disabled={bloqueado || !o.cliente_id}>
                  <option value="">{o.cliente_id ? '—' : 'Sem empresa'}</option>
                  {contatos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </Campo>
              {gestor && (
                <Campo rotulo="Responsável" ajuda="crm.novo.responsavel" largura={140}>
                  <select style={inp} value={form.responsavel_id ?? ''} onChange={set('responsavel_id')}>
                    <option value="">Sem responsável</option>
                    {cfg.equipe.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                  </select>
                </Campo>
              )}
            </div>
            {camposOp.length > 0 && (
              <div style={{ borderTop: `1px solid ${C.BORDA}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Titulo texto="Campos da sua empresa" ajuda="crm.ficha.campos_custom" />
                {camposOp.map((c) => <CampoProprio key={c.id} campo={c} valor={custom[c.chave]} bloqueado={bloqueado}
                  onChange={(v) => setCustom((x) => ({ ...x, [c.chave]: v }))} />)}
              </div>
            )}
            <Campo rotulo="Observações" ajuda="crm.ficha.observacoes">
              <textarea style={{ ...inp, minHeight: 80 }} value={form.observacoes ?? ''} onChange={set('observacoes')} disabled={bloqueado} />
            </Campo>
            {!bloqueado && <button onClick={() => void salvarDados()} style={btnPri} data-testid="crm-ficha-salvar">Salvar dados</button>}
          </div>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!bloqueado && (
            <section style={cartao}>
              <Titulo texto="Registrar o que aconteceu" ajuda="crm.ficha.atividade" />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {TIPOS_ATIVIDADE.map((t) => (
                  <button key={t.v} onClick={() => setAtivTipo(t.v)} style={chip(C.ESPRESSO, ativTipo === t.v ? '#F3E9D6' : '#fff')}><IconeTipo tipo={t.v} size={14} /> {t.l}</button>
                ))}
              </div>
              <Campo rotulo="O que foi conversado" ajuda="crm.ficha.atividade">
                <textarea style={{ ...inp, minHeight: 70 }} value={ativTexto} onChange={(e) => setAtivTexto(e.target.value)} placeholder="Ex.: Cliente pediu desconto de 5% para fechar este mês." data-testid="crm-ficha-atividade" />
              </Campo>
              <button onClick={() => void registrarAtividade()} disabled={!ativTexto.trim()} style={{ ...btnPri, marginTop: 8, opacity: ativTexto.trim() ? 1 : 0.5 }}>Registrar</button>
            </section>
          )}

          <section style={cartao}>
            <Titulo texto="Próximos passos" ajuda="crm.ficha.tarefa" />
            {ficha.tarefas.length === 0 && <div style={{ fontSize: 13, color: C.TEXTM, marginBottom: 8 }}>Nenhum próximo passo agendado. Negócio sem próximo passo esfria.</div>}
            {ficha.tarefas.map((t) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: `1px solid ${C.BORDA}` }}>
                <IconeTipo tipo={t.tipo} />
                <div style={{ flex: 1, textDecoration: t.concluida_em ? 'line-through' : 'none', color: t.concluida_em ? C.TEXTM : C.ESPRESSO, fontSize: 14 }}>
                  {t.titulo}<div style={{ fontSize: 12, color: C.TEXTM }}>{dataBR(t.vence_em)} {horaBR(t.vence_em)}</div>
                </div>
                {!bloqueado && <button onClick={() => void concluir(t)} style={chip(t.concluida_em ? C.TEXTM : C.GREEN, t.concluida_em ? '#fff' : C.GREEN_BG)}>{t.concluida_em ? 'Reabrir' : '✓ Feito'}</button>}
              </div>
            ))}
            {!bloqueado && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'flex-end' }}>
                <Campo rotulo="Tipo" ajuda="crm.ficha.tarefa" largura={110}>
                  <select style={inp} value={tarTipo} onChange={(e) => setTarTipo(e.target.value)}>
                    {TIPOS_TAREFA.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                  </select>
                </Campo>
                <Campo rotulo="O que fazer" ajuda="crm.ficha.tarefa" largura={180}>
                  <input style={inp} value={tarTitulo} onChange={(e) => setTarTitulo(e.target.value)} placeholder="Ex.: Ligar para confirmar a proposta" data-testid="crm-ficha-tarefa" />
                </Campo>
                <Campo rotulo="Quando" ajuda="crm.ficha.tarefa" largura={170}>
                  <input style={inp} type="datetime-local" value={tarData} onChange={(e) => setTarData(e.target.value)} />
                </Campo>
                <button onClick={() => void agendar()} disabled={!tarTitulo.trim()} style={{ ...btnSec, opacity: tarTitulo.trim() ? 1 : 0.5 }}>Agendar</button>
              </div>
            )}
          </section>

          <section style={cartao}>
            <Titulo texto="Linha do tempo" ajuda="crm.ficha.linha_tempo" />
            {ficha.linha_do_tempo.length === 0 && <div style={{ fontSize: 13, color: C.TEXTM }}>Nada registrado ainda.</div>}
            {ficha.linha_do_tempo.map((ev, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, padding: '8px 0', borderTop: `1px solid ${C.BORDA}`, fontSize: 13.5 }}>
                <IconeTipo tipo={ev.tipo} />
                <div style={{ flex: 1 }}>
                  <div>{ev.texto ?? ev.acao}</div>
                  <div style={{ fontSize: 11.5, color: C.TEXTM }}>{dataBR(ev.quando)} {horaBR(ev.quando)}{ev.autor ? ` · ${ev.autor}` : ''}</div>
                </div>
              </div>
            ))}
          </section>
        </div>
      </div>

      <Modal open={!!perda} onClose={() => setPerda(null)} title="Por que o negócio foi perdido?" subtitle="O motivo alimenta o relatório de perdas." maxWidth={460}
        footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={() => setPerda(null)} style={btnSec}>Cancelar</button>
          <button onClick={() => perda && void mover(perda, motivo, motivoTexto)} disabled={!motivo} style={{ ...btnPri, opacity: motivo ? 1 : 0.5 }}>Marcar como perdido</button>
        </div>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Campo rotulo="Motivo" ajuda="crm.pipeline.motivo_perda">
            <select style={inp} value={motivo} onChange={(e) => setMotivo(e.target.value)}>
              <option value="">Escolha…</option>
              {cfg.motivos.filter((m) => m.ativo).map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Detalhe (opcional)" ajuda="crm.pipeline.motivo_perda">
            <input style={inp} value={motivoTexto} onChange={(e) => setMotivoTexto(e.target.value)} />
          </Campo>
        </div>
      </Modal>
    </Pagina>
  )
}

/** Campo próprio da empresa (crm_campo_custom): texto, número, data, lista ou sim/não. */
function CampoProprio({ campo, valor, onChange, bloqueado }: { campo: CampoCustom; valor: unknown; onChange: (v: unknown) => void; bloqueado: boolean }) {
  const v = valor == null ? '' : String(valor)
  const rotulo = campo.rotulo + (campo.obrigatorio ? ' *' : '')
  return (
    <Campo rotulo={rotulo} ajuda="crm.ficha.campos_custom">
      {campo.tipo === 'lista' ? (
        <select style={inp} value={v} onChange={(e) => onChange(e.target.value || null)} disabled={bloqueado}>
          <option value="">—</option>
          {campo.opcoes.map((op) => <option key={op} value={op}>{op}</option>)}
        </select>
      ) : campo.tipo === 'sim_nao' ? (
        <select style={inp} value={valor === true ? 'sim' : valor === false ? 'nao' : ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'sim')} disabled={bloqueado}>
          <option value="">—</option><option value="sim">Sim</option><option value="nao">Não</option>
        </select>
      ) : (
        <input style={inp} type={campo.tipo === 'data' ? 'date' : 'text'} inputMode={campo.tipo === 'numero' ? 'decimal' : undefined} value={v}
          onChange={(e) => onChange(campo.tipo === 'numero' ? (e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) || e.target.value) : e.target.value)} disabled={bloqueado} />
      )}
    </Campo>
  )
}
