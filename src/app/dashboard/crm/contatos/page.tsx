'use client'
// PS CRM · Contatos: as pessoas de cada empresa (erp_contatos com entidade 'cliente' — o mesmo cadastro do sistema).
// WhatsApp em 1 toque; grava por fn_crm_contato_salvar. Aceita ?empresa=<id> vindo da tela de Empresas.
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { erroAmigavel } from '@/lib/erroAmigavel'
import Modal from '@/components/ui/Modal'
import { C, Campo, Titulo, Cabecalho, Pagina, Aviso, Vazio, SemEmpresa, inp, btnPri, btnSec, chip, cartao, waHref, rpcCrm, useCrm } from '@/components/crm/crmUi'

type Contato = {
  id: string; entidade_id: string; nome: string; cargo: string | null; telefone: string | null; celular: string | null; whatsapp: string | null
  email: string | null; principal: boolean; ativo: boolean; observacoes: string | null
}
type Cli = { id: string; nome: string }
const VAZIO = { id: '', cliente_id: '', nome: '', cargo: '', telefone: '', whatsapp: '', email: '', principal: false, observacoes: '' }

export default function CrmContatosPage() {
  return <Suspense fallback={<Pagina><div style={{ color: C.TEXTM }}>Carregando…</div></Pagina>}><Contatos /></Suspense>
}

function Contatos() {
  const params = useSearchParams()
  const { empresa, cfg, erro: erroCfg, carregando, soLeitura } = useCrm()
  const [lista, setLista] = useState<Contato[]>([])
  const [clientes, setClientes] = useState<Cli[]>([])
  const [busca, setBusca] = useState('')
  const [filtroCli, setFiltroCli] = useState(params.get('empresa') ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [form, setForm] = useState<typeof VAZIO | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) return
    const [ct, cl] = await Promise.all([
      supabase.from('erp_contatos').select('id, entidade_id, nome, cargo, telefone, celular, whatsapp, email, principal, ativo, observacoes')
        .eq('company_id', empresa).eq('entidade_tipo', 'cliente').eq('ativo', true).order('nome').limit(2000),
      supabase.from('erp_clientes').select('id, nome_fantasia, razao_social').eq('company_id', empresa).is('excluido_em', null).order('nome_fantasia').limit(1000),
    ])
    if (ct.error) { setErro(erroAmigavel(ct.error)); return }
    setLista((ct.data ?? []) as Contato[])
    setClientes(((cl.data ?? []) as { id: string; nome_fantasia: string | null; razao_social: string | null }[]).map((c) => ({ id: c.id, nome: c.nome_fantasia || c.razao_social || '—' })))
  }, [empresa])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga/sincronia ao trocar empresa, funil ou filtro
  useEffect(() => { void carregar() }, [carregar])

  const nomeCli = useMemo(() => new Map(clientes.map((c) => [c.id, c.nome])), [clientes])
  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return lista.filter((c) => (!filtroCli || c.entidade_id === filtroCli)
      && (!t || [c.nome, c.cargo, c.email, c.whatsapp, c.telefone, nomeCli.get(c.entidade_id)].some((x) => (x ?? '').toLowerCase().includes(t))))
  }, [lista, busca, filtroCli, nomeCli])

  async function salvar() {
    if (!form || !empresa) return
    try {
      await rpcCrm('fn_crm_contato_salvar', { p_company_id: empresa, p_dados: { ...form, id: form.id || null } })
      setOk(form.id ? 'Contato atualizado.' : 'Contato cadastrado.'); setForm(null); void carregar()
    } catch (e) { setErro((e as Error).message) }
  }
  async function inativar(c: Contato) {
    if (!empresa) return
    try { await rpcCrm('fn_crm_contato_salvar', { p_company_id: empresa, p_dados: { id: c.id, cliente_id: c.entidade_id, nome: c.nome, cargo: c.cargo, telefone: c.telefone, whatsapp: c.whatsapp, email: c.email, ativo: false, observacoes: c.observacoes } }); setOk('Contato removido da lista.'); void carregar() }
    catch (e) { setErro((e as Error).message) }
  }

  if (carregando) return <Pagina><div style={{ color: C.TEXTM }}>Carregando…</div></Pagina>
  if (!empresa) return <Pagina><Cabecalho titulo="Contatos" /><SemEmpresa /></Pagina>
  if (!cfg) return <Pagina><Cabecalho titulo="Contatos" /><Aviso texto={erroCfg ?? 'Não foi possível abrir o CRM.'} /></Pagina>
  const set = (k: 'nome' | 'cargo' | 'telefone' | 'whatsapp' | 'email' | 'observacoes' | 'cliente_id') => (e: { target: { value: string } }) => setForm((f) => f && { ...f, [k]: e.target.value })

  return (
    <Pagina>
      <Cabecalho titulo="Contatos" subtitulo="As pessoas com quem você fala em cada empresa."
        acoes={!soLeitura && <button onClick={() => setForm({ ...VAZIO, cliente_id: filtroCli })} style={btnPri} data-testid="crm-contato-novo">+ Novo contato</button>} />
      <Aviso texto={erro} onFechar={() => setErro(null)} />
      <Aviso texto={ok} tipo="ok" onFechar={() => setOk(null)} />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <Campo rotulo="Buscar" ajuda="crm.contatos.busca" largura={240}><input style={inp} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, cargo, e-mail…" /></Campo>
        <Campo rotulo="Empresa" ajuda="crm.contatos.empresa" largura={220}>
          <select style={inp} value={filtroCli} onChange={(e) => setFiltroCli(e.target.value)}>
            <option value="">Todas</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Campo>
      </div>
      <section style={cartao}>
        <Titulo texto={`${filtrados.length} contato(s)`} ajuda="crm.contatos.nome" />
        {filtrados.length === 0 && <Vazio texto={clientes.length === 0 ? 'Cadastre uma empresa primeiro; depois as pessoas dela aqui.' : 'Nenhum contato ainda. Cadastre quem decide e quem influencia em cada empresa.'}
          acao={!soLeitura && clientes.length > 0 ? <button onClick={() => setForm({ ...VAZIO, cliente_id: filtroCli })} style={btnPri}>+ Novo contato</button> : undefined} />}
        {filtrados.map((c) => {
          const wa = waHref(c.whatsapp || c.celular || c.telefone, `Olá ${c.nome.split(' ')[0]}, tudo bem?`)
          return (
            <div key={c.id} data-testid="crm-contato-linha" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', borderTop: `1px solid ${C.BORDA}`, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{c.nome}{c.principal && <span style={{ fontSize: 11, color: C.DOURADO, marginLeft: 6 }}>★ principal</span>}</div>
                <div style={{ fontSize: 12, color: C.TEXTM }}>{[nomeCli.get(c.entidade_id), c.cargo, c.email].filter(Boolean).join(' · ')}</div>
              </div>
              {wa && <a href={wa} target="_blank" rel="noreferrer" style={chip(C.WA)}>WhatsApp</a>}
              {!soLeitura && <button style={chip(C.ESPRESSO)} onClick={() => setForm({ id: c.id, cliente_id: c.entidade_id, nome: c.nome, cargo: c.cargo ?? '', telefone: c.telefone ?? '',
                whatsapp: c.whatsapp ?? c.celular ?? '', email: c.email ?? '', principal: c.principal, observacoes: c.observacoes ?? '' })}>Editar</button>}
              {!soLeitura && <button style={chip(C.TEXTM)} onClick={() => void inativar(c)} aria-label={`Remover ${c.nome}`}>Remover</button>}
            </div>
          )
        })}
      </section>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Editar contato' : 'Novo contato'} maxWidth={520}
        footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={() => setForm(null)} style={btnSec}>Cancelar</button>
          <button onClick={() => void salvar()} disabled={!form?.nome.trim() || !form?.cliente_id} style={{ ...btnPri, opacity: form?.nome.trim() && form?.cliente_id ? 1 : 0.5 }} data-testid="crm-contato-salvar">Salvar</button>
        </div>}>
        {form && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Campo rotulo="Empresa" ajuda="crm.contatos.empresa">
              <select style={inp} value={form.cliente_id} onChange={set('cliente_id')}>
                <option value="">Escolha…</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </Campo>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Campo rotulo="Nome" ajuda="crm.contatos.nome" largura={200}><input style={inp} value={form.nome} onChange={set('nome')} data-testid="crm-contato-nome" /></Campo>
              <Campo rotulo="Cargo" ajuda="crm.contatos.cargo" largura={160}><input style={inp} value={form.cargo} onChange={set('cargo')} placeholder="Ex.: Sócio, Compras" /></Campo>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Campo rotulo="WhatsApp" ajuda="crm.contatos.whatsapp" largura={160}><input style={inp} inputMode="tel" value={form.whatsapp} onChange={set('whatsapp')} /></Campo>
              <Campo rotulo="E-mail" ajuda="crm.contatos.email" largura={200}><input style={inp} type="email" value={form.email} onChange={set('email')} /></Campo>
            </div>
            <Campo rotulo="Contato principal da empresa" ajuda="crm.contatos.principal">
              <select style={inp} value={form.principal ? 'sim' : 'nao'} onChange={(e) => setForm((f) => f && { ...f, principal: e.target.value === 'sim' })}>
                <option value="nao">Não</option><option value="sim">Sim</option>
              </select>
            </Campo>
          </div>
        )}
      </Modal>
    </Pagina>
  )
}
