'use client'
// PS CRM · Configurar (diretor/gerente): funis e etapas (nome, probabilidade, cor, ordem, retirar), origens, motivos de
// perda e campos próprios. Tudo vira cadastro no banco (RD-51) e o quadro reflete na hora, sem deploy.
// Ganho e Perdido existem em todo funil (fecham o negócio): podem ser renomeados, não retirados.
import { useEffect, useMemo, useState } from 'react'
import { C, Campo, Titulo, Cabecalho, Pagina, Aviso, Vazio, SemEmpresa, inp, btnPri, btnSec, chip, cartao, rpcCrm, useCrm, type Etapa, type Item, type CampoCustom } from '@/components/crm/crmUi'

const CORES = ['#F0E9DE', '#E8F0FB', '#FFF4D6', '#FBE7D5', '#E3F1E0', '#F3E3F5', '#FBE0E0']
const TIPOS_CAMPO: { v: CampoCustom['tipo']; l: string }[] = [
  { v: 'texto', l: 'Texto' }, { v: 'numero', l: 'Número' }, { v: 'data', l: 'Data' }, { v: 'lista', l: 'Lista de opções' }, { v: 'sim_nao', l: 'Sim / Não' },
]

export default function CrmFunisPage() {
  const { empresa, cfg, erro: erroCfg, carregando, gestor, recarregar } = useCrm()
  const [funilId, setFunilId] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [novoFunil, setNovoFunil] = useState('')
  const [novaEtapa, setNovaEtapa] = useState('')
  const [novaOrigem, setNovaOrigem] = useState('')
  const [novoMotivo, setNovoMotivo] = useState('')
  const [campo, setCampo] = useState<{ nome: string; entidade: 'oportunidade' | 'lead'; tipo: CampoCustom['tipo']; opcoes: string; obrigatorio: boolean }>({ nome: '', entidade: 'oportunidade', tipo: 'texto', opcoes: '', obrigatorio: false })

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga/sincronia ao trocar empresa, funil ou filtro
  useEffect(() => { if (cfg && (!funilId || !cfg.funis.some((f) => f.id === funilId))) setFunilId(cfg.funis[0]?.id ?? '') }, [cfg, funilId])
  const funil = cfg?.funis.find((f) => f.id === funilId) ?? null
  const normais = useMemo(() => (funil?.etapas ?? []).filter((e) => e.tipo_etapa === 'normal'), [funil])
  const fechamento = useMemo(() => (funil?.etapas ?? []).filter((e) => e.tipo_etapa !== 'normal'), [funil])

  async function rodar(fn: string, args: Record<string, unknown>, msg: string) {
    setErro(null)
    try { const r = await rpcCrm<{ id?: string }>(fn, args); setOk(msg); await recarregar(); return r }
    catch (e) { setErro((e as Error).message); return null }
  }
  const salvarEtapa = (e: Etapa, mud: Partial<Etapa>) => rodar('fn_crm_funil_etapa_salvar', { p_company_id: empresa, p_dados: { id: e.id, ...mud } }, 'Etapa salva. O quadro já mostra a mudança.')
  async function mover(i: number, d: -1 | 1) {
    const ids = normais.map((e) => e.id)
    const j = i + d
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    await rodar('fn_crm_funil_etapas_ordenar', { p_company_id: empresa, p_funil_id: funilId, p_ids: ids }, 'Ordem salva.')
  }

  if (carregando) return <Pagina><div style={{ color: C.TEXTM }}>Carregando…</div></Pagina>
  if (!empresa) return <Pagina><Cabecalho titulo="Configurar o CRM" /><SemEmpresa /></Pagina>
  if (!cfg) return <Pagina><Cabecalho titulo="Configurar o CRM" /><Aviso texto={erroCfg ?? 'Não foi possível abrir o CRM.'} /></Pagina>
  if (!gestor) return <Pagina><Cabecalho titulo="Configurar o CRM" /><Vazio texto="Só o diretor ou o gerente comercial configuram funis e cadastros do CRM." /></Pagina>

  return (
    <Pagina>
      <Cabecalho titulo="Configurar o CRM" subtitulo="Funis, etapas e listas do jeito da sua empresa. Muda na hora no quadro." />
      <Aviso texto={erro} onFechar={() => setErro(null)} />
      <Aviso texto={ok} tipo="ok" onFechar={() => setOk(null)} />

      <section style={{ ...cartao, marginBottom: 14 }}>
        <Titulo texto="Funis" ajuda="crm.funis.funil" />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {cfg.funis.map((f) => (
            <button key={f.id} onClick={() => setFunilId(f.id)} style={{ ...chip(f.ativo ? C.ESPRESSO : C.TEXTM, f.id === funilId ? '#F3E9D6' : '#fff'), minHeight: 40, fontSize: 13 }}>
              {f.nome}{f.padrao ? ' ★' : ''}{!f.ativo ? ' (inativo)' : ''} · {f.abertas}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Campo rotulo="Novo funil" ajuda="crm.funis.nome" largura={240}>
            <input style={inp} value={novoFunil} onChange={(e) => setNovoFunil(e.target.value)} placeholder="Ex.: Renovação de contratos" data-testid="crm-funil-novo" />
          </Campo>
          <button style={btnSec} disabled={!novoFunil.trim()} onClick={() => void rodar('fn_crm_funil_salvar', { p_company_id: empresa, p_dados: { nome: novoFunil } }, 'Funil criado com as etapas iniciais.')
            .then((r) => { if (r) { setNovoFunil(''); if (r.id) setFunilId(r.id) } })}>Criar funil</button>
        </div>
      </section>

      {funil && (
        <section style={{ ...cartao, marginBottom: 14 }} data-testid="crm-funil-etapas">
          <FunilDados key={funil.id} nome={funil.nome} tipo={funil.tipo_negocio ?? ''} padrao={funil.padrao} ativo={funil.ativo}
            onSalvar={(d) => void rodar('fn_crm_funil_salvar', { p_company_id: empresa, p_dados: { id: funil.id, ...d } }, 'Funil salvo.')} />
          <Titulo texto="Etapas" ajuda="crm.funis.etapa_nome" />
          {normais.map((e, i) => (
            <LinhaEtapa key={e.id} etapa={e} primeira={i === 0} ultima={i === normais.length - 1} onSalvar={(m) => void salvarEtapa(e, m)}
              onMover={(d) => void mover(i, d)} onRetirar={() => void rodar('fn_crm_funil_etapa_desativar', { p_company_id: empresa, p_id: e.id }, 'Etapa retirada do funil.')} />
          ))}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', margin: '10px 0 14px' }}>
            <Campo rotulo="Nova etapa" ajuda="crm.funis.etapa_nome" largura={220}>
              <input style={inp} value={novaEtapa} onChange={(e) => setNovaEtapa(e.target.value)} placeholder="Ex.: Visita técnica" data-testid="crm-etapa-nova" />
            </Campo>
            <button style={btnSec} disabled={!novaEtapa.trim()} onClick={() => void rodar('fn_crm_funil_etapa_salvar', { p_company_id: empresa, p_dados: { funil_id: funil.id, rotulo: novaEtapa } }, 'Etapa criada. Já aparece no quadro.')
              .then((r) => r && setNovaEtapa(''))}>Adicionar etapa</button>
          </div>
          <Titulo texto="Fechamento" ajuda="crm.funis.etapa_retirar" />
          {fechamento.map((e) => <LinhaEtapa key={e.id} etapa={e} primeira ultima onSalvar={(m) => void salvarEtapa(e, m)} />)}
        </section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
        <ListaSimples titulo="Origens" ajuda="crm.funis.origem" itens={cfg.origens} novo={novaOrigem} setNovo={setNovaOrigem} placeholder="Ex.: Feira, Google, Indicação"
          onCriar={() => void rodar('fn_crm_cadastro_salvar', { p_company_id: empresa, p_tipo: 'origem', p_dados: { nome: novaOrigem } }, 'Origem criada.').then((r) => r && setNovaOrigem(''))}
          onAlternar={(it) => void rodar('fn_crm_cadastro_salvar', { p_company_id: empresa, p_tipo: 'origem', p_dados: { id: it.id, nome: it.nome, ativo: !it.ativo } }, it.ativo ? 'Origem desativada.' : 'Origem reativada.')} />
        <ListaSimples titulo="Motivos de perda" ajuda="crm.funis.motivo" itens={cfg.motivos} novo={novoMotivo} setNovo={setNovoMotivo} placeholder="Ex.: Preço, Prazo, Concorrência"
          onCriar={() => void rodar('fn_crm_cadastro_salvar', { p_company_id: empresa, p_tipo: 'motivo', p_dados: { nome: novoMotivo } }, 'Motivo criado.').then((r) => r && setNovoMotivo(''))}
          onAlternar={(it) => void rodar('fn_crm_cadastro_salvar', { p_company_id: empresa, p_tipo: 'motivo', p_dados: { id: it.id, nome: it.nome, ativo: !it.ativo } }, it.ativo ? 'Motivo desativado.' : 'Motivo reativado.')} />

        <section style={cartao}>
          <Titulo texto="Campos próprios" ajuda="crm.funis.campo" />
          {cfg.campos.length === 0 && <div style={{ fontSize: 13, color: C.TEXTM, marginBottom: 8 }}>Nenhum campo próprio. Crie os dados que só o seu negócio usa (ex.: &quot;Nº de funcionários&quot;).</div>}
          {cfg.campos.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: `1px solid ${C.BORDA}`, fontSize: 13.5, opacity: c.ativo ? 1 : 0.55 }}>
              <div style={{ flex: 1 }}>{c.rotulo}{c.obrigatorio ? ' *' : ''}
                <div style={{ fontSize: 11.5, color: C.TEXTM }}>{c.entidade === 'oportunidade' ? 'Negócio' : 'Lead'} · {TIPOS_CAMPO.find((t) => t.v === c.tipo)?.l}{c.opcoes.length ? `: ${c.opcoes.join(', ')}` : ''}</div>
              </div>
              <button style={chip(c.ativo ? C.TEXTM : C.ESPRESSO)} onClick={() => void rodar('fn_crm_cadastro_salvar', { p_company_id: empresa, p_tipo: 'campo', p_dados: { id: c.id, nome: c.rotulo, entidade: c.entidade, ativo: !c.ativo } }, 'Campo salvo.')}>{c.ativo ? 'Desativar' : 'Reativar'}</button>
            </div>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            <Campo rotulo="Nome do campo" ajuda="crm.funis.campo"><input style={inp} value={campo.nome} onChange={(e) => setCampo({ ...campo, nome: e.target.value })} /></Campo>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Campo rotulo="Aparece em" ajuda="crm.funis.campo" largura={120}>
                <select style={inp} value={campo.entidade} onChange={(e) => setCampo({ ...campo, entidade: e.target.value as 'oportunidade' | 'lead' })}>
                  <option value="oportunidade">Negócio</option><option value="lead">Lead</option>
                </select>
              </Campo>
              <Campo rotulo="Tipo" ajuda="crm.funis.campo_tipo" largura={120}>
                <select style={inp} value={campo.tipo} onChange={(e) => setCampo({ ...campo, tipo: e.target.value as CampoCustom['tipo'] })}>
                  {TIPOS_CAMPO.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Obrigatório" ajuda="crm.funis.campo" largura={90}>
                <select style={inp} value={campo.obrigatorio ? 'sim' : 'nao'} onChange={(e) => setCampo({ ...campo, obrigatorio: e.target.value === 'sim' })}>
                  <option value="nao">Não</option><option value="sim">Sim</option>
                </select>
              </Campo>
            </div>
            {campo.tipo === 'lista' && (
              <Campo rotulo="Opções (separe por vírgula)" ajuda="crm.funis.campo_tipo"><input style={inp} value={campo.opcoes} onChange={(e) => setCampo({ ...campo, opcoes: e.target.value })} placeholder="Pequena, Média, Grande" /></Campo>
            )}
            <button style={btnPri} disabled={!campo.nome.trim()} onClick={() => void rodar('fn_crm_cadastro_salvar', { p_company_id: empresa, p_tipo: 'campo', p_dados: {
              nome: campo.nome, entidade: campo.entidade, tipo: campo.tipo, obrigatorio: campo.obrigatorio,
              opcoes: campo.tipo === 'lista' ? campo.opcoes.split(',').map((s) => s.trim()).filter(Boolean) : [] } }, 'Campo criado.')
              .then((r) => r && setCampo({ nome: '', entidade: 'oportunidade', tipo: 'texto', opcoes: '', obrigatorio: false }))}>Criar campo</button>
          </div>
        </section>
      </div>
    </Pagina>
  )
}

function FunilDados({ nome, tipo, padrao, ativo, onSalvar }: { nome: string; tipo: string; padrao: boolean; ativo: boolean; onSalvar: (d: Record<string, unknown>) => void }) {
  const [n, setN] = useState(nome)
  const [t, setT] = useState(tipo)
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
      <Campo rotulo="Nome do funil" ajuda="crm.funis.nome" largura={200}><input style={inp} value={n} onChange={(e) => setN(e.target.value)} /></Campo>
      <Campo rotulo="Tipo de negócio" ajuda="crm.funis.tipo_negocio" largura={180}><input style={inp} value={t} onChange={(e) => setT(e.target.value)} placeholder="Ex.: Venda nova, Renovação" /></Campo>
      <button style={btnSec} onClick={() => onSalvar({ nome: n, tipo_negocio: t, padrao, ativo })}>Salvar</button>
      <span style={{ display: 'inline-flex', alignItems: 'center' }} data-ajuda="crm.funis.padrao">
        {!padrao && <button style={chip(C.DOURADO)} onClick={() => onSalvar({ nome: n, tipo_negocio: t, padrao: true, ativo: true })}>★ Tornar padrão</button>}
      </span>
      {!padrao && <button style={chip(ativo ? C.TEXTM : C.ESPRESSO)} onClick={() => onSalvar({ nome: n, tipo_negocio: t, padrao, ativo: !ativo })}>{ativo ? 'Desativar funil' : 'Reativar funil'}</button>}
    </div>
  )
}

function LinhaEtapa({ etapa, primeira, ultima, onSalvar, onMover, onRetirar }: {
  etapa: Etapa; primeira: boolean; ultima: boolean; onSalvar: (m: Partial<Etapa>) => void; onMover?: (d: -1 | 1) => void; onRetirar?: () => void
}) {
  const [rotulo, setRotulo] = useState(etapa.rotulo)
  const [prob, setProb] = useState(etapa.probabilidade == null ? '' : String(etapa.probabilidade))
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga/sincronia ao trocar empresa, funil ou filtro
  useEffect(() => { setRotulo(etapa.rotulo); setProb(etapa.probabilidade == null ? '' : String(etapa.probabilidade)) }, [etapa])
  const normal = etapa.tipo_etapa === 'normal'
  return (
    <div data-testid="crm-etapa-linha" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${C.BORDA}`, flexWrap: 'wrap' }}>
      {onMover && (
        <span style={{ display: 'inline-flex', gap: 2 }} data-ajuda="crm.funis.etapa_ordem">
          <button aria-label="Subir" disabled={primeira} onClick={() => onMover(-1)} style={{ ...chip(C.ESPRESSO), opacity: primeira ? 0.3 : 1 }}>↑</button>
          <button aria-label="Descer" disabled={ultima} onClick={() => onMover(1)} style={{ ...chip(C.ESPRESSO), opacity: ultima ? 0.3 : 1 }}>↓</button>
        </span>
      )}
      {!normal && <span style={{ fontWeight: 700, color: etapa.tipo_etapa === 'ganho' ? C.GREEN : C.RED }}>{etapa.tipo_etapa === 'ganho' ? '✓' : '✕'}</span>}
      <span style={{ flex: '1 1 160px' }} data-ajuda="crm.funis.etapa_nome">
        <input aria-label="Nome da etapa" style={inp} value={rotulo} onChange={(e) => setRotulo(e.target.value)} onBlur={() => rotulo.trim() && rotulo !== etapa.rotulo && onSalvar({ rotulo })} />
      </span>
      {normal && (
        <span style={{ width: 90 }} data-ajuda="crm.funis.etapa_prob">
          <input aria-label="Probabilidade (%)" style={inp} inputMode="numeric" value={prob} onChange={(e) => setProb(e.target.value.replace(/\D/g, ''))}
            onBlur={() => prob !== String(etapa.probabilidade ?? '') && onSalvar({ probabilidade: prob === '' ? null : Number(prob) })} />
        </span>
      )}
      <span style={{ display: 'inline-flex', gap: 3 }} data-ajuda="crm.funis.etapa_cor">
        {CORES.map((c) => (
          <button key={c} aria-label={`Cor ${c}`} onClick={() => onSalvar({ cor: c })}
            style={{ width: 22, height: 22, borderRadius: 6, background: c, border: etapa.cor === c ? `2px solid ${C.ESPRESSO}` : `1px solid ${C.BORDA}`, cursor: 'pointer' }} />
        ))}
      </span>
      {onRetirar && <span data-ajuda="crm.funis.etapa_retirar"><button onClick={onRetirar} style={chip(C.RED)}>Retirar</button></span>}
    </div>
  )
}

function ListaSimples({ titulo, ajuda, itens, novo, setNovo, placeholder, onCriar, onAlternar }: {
  titulo: string; ajuda: string; itens: Item[]; novo: string; setNovo: (v: string) => void; placeholder: string; onCriar: () => void; onAlternar: (it: Item) => void
}) {
  return (
    <section style={cartao}>
      <Titulo texto={titulo} ajuda={ajuda} />
      {itens.map((it) => (
        <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: `1px solid ${C.BORDA}`, fontSize: 13.5, opacity: it.ativo ? 1 : 0.55 }}>
          <span style={{ flex: 1 }}>{it.nome}</span>
          <button style={chip(it.ativo ? C.TEXTM : C.ESPRESSO)} onClick={() => onAlternar(it)}>{it.ativo ? 'Desativar' : 'Reativar'}</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 10 }}>
        <Campo rotulo={`Nova ${titulo === 'Origens' ? 'origem' : 'opção'}`} ajuda={ajuda} largura={180}>
          <input style={inp} value={novo} onChange={(e) => setNovo(e.target.value)} placeholder={placeholder} />
        </Campo>
        <button style={btnSec} disabled={!novo.trim()} onClick={onCriar}>Adicionar</button>
      </div>
    </section>
  )
}
