'use client'
// PS CRM · Empresas (contas). É o MESMO cadastro de clientes do sistema (erp_clientes, RD-26): quem tem CRM e Gestão
// Empresarial vê a mesma empresa nos dois. Aqui só o que o comercial precisa; grava por fn_crm_empresa_salvar.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { erroAmigavel } from '@/lib/erroAmigavel'
import Modal from '@/components/ui/Modal'
import { C, Campo, Titulo, Cabecalho, Pagina, Aviso, Vazio, SemEmpresa, inp, btnPri, btnSec, chip, cartao, waHref, rpcCrm, useCrm } from '@/components/crm/crmUi'

type Empresa = {
  id: string; nome_fantasia: string | null; razao_social: string | null; cpf_cnpj: string | null; telefone: string | null; whatsapp: string | null
  celular: string | null; email: string | null; cidade: string | null; uf: string | null; segmento: string | null; site: string | null; observacoes: string | null
}
const VAZIO = { id: '', nome: '', razao_social: '', cpf_cnpj: '', telefone: '', whatsapp: '', email: '', cidade: '', uf: '', segmento: '', site: '', observacoes: '' }

export default function CrmEmpresasPage() {
  const { empresa, cfg, erro: erroCfg, carregando, soLeitura } = useCrm()
  const [lista, setLista] = useState<Empresa[]>([])
  const [negocios, setNegocios] = useState<Map<string, number>>(new Map())
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [form, setForm] = useState<typeof VAZIO | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) return
    const [cli, ops] = await Promise.all([
      supabase.from('erp_clientes').select('id, nome_fantasia, razao_social, cpf_cnpj, telefone, whatsapp, celular, email, cidade, uf, segmento, site, observacoes')
        .eq('company_id', empresa).is('excluido_em', null).order('nome_fantasia').limit(1000),
      supabase.from('erp_crm_oportunidade').select('cliente_id').eq('company_id', empresa).is('deleted_at', null).not('etapa', 'in', '(ganho,perdido)').limit(5000),
    ])
    if (cli.error) { setErro(erroAmigavel(cli.error)); return }
    setLista((cli.data ?? []) as Empresa[])
    const m = new Map<string, number>()
    for (const o of (ops.data ?? []) as { cliente_id: string | null }[]) if (o.cliente_id) m.set(o.cliente_id, (m.get(o.cliente_id) ?? 0) + 1)
    setNegocios(m)
  }, [empresa])
  useEffect(() => { void carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return t ? lista.filter((e) => [e.nome_fantasia, e.razao_social, e.cpf_cnpj, e.cidade, e.segmento, e.email].some((x) => (x ?? '').toLowerCase().includes(t))) : lista
  }, [lista, busca])

  async function salvar() {
    if (!form || !empresa) return
    try {
      await rpcCrm('fn_crm_empresa_salvar', { p_company_id: empresa, p_dados: { ...form, id: form.id || null } })
      setOk(form.id ? 'Empresa atualizada.' : 'Empresa cadastrada.'); setForm(null); void carregar()
    } catch (e) { setErro((e as Error).message) }
  }

  if (carregando) return <Pagina><div style={{ color: C.TEXTM }}>Carregando…</div></Pagina>
  if (!empresa) return <Pagina><Cabecalho titulo="Empresas" /><SemEmpresa /></Pagina>
  if (!cfg) return <Pagina><Cabecalho titulo="Empresas" /><Aviso texto={erroCfg ?? 'Não foi possível abrir o CRM.'} /></Pagina>
  const set = (k: keyof typeof VAZIO) => (e: { target: { value: string } }) => setForm((f) => f && { ...f, [k]: e.target.value })

  return (
    <Pagina>
      <Cabecalho titulo="Empresas" subtitulo="As empresas e pessoas com quem você negocia."
        acoes={!soLeitura && <button onClick={() => setForm({ ...VAZIO })} style={btnPri} data-testid="crm-empresa-nova">+ Nova empresa</button>} />
      <Aviso texto={erro} onFechar={() => setErro(null)} />
      <Aviso texto={ok} tipo="ok" onFechar={() => setOk(null)} />
      <div style={{ marginBottom: 12, maxWidth: 360 }}>
        <Campo rotulo="Buscar" ajuda="crm.empresas.busca"><input style={inp} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, CNPJ, cidade, segmento…" /></Campo>
      </div>
      <section style={cartao}>
        <Titulo texto={`${filtrados.length} empresa(s)`} ajuda="crm.empresas.nome" />
        {filtrados.length === 0 && <Vazio texto={lista.length === 0 ? 'Nenhuma empresa ainda. Cadastre a primeira ou crie direto ao abrir um negócio.' : 'Nenhuma empresa com essa busca.'}
          acao={!soLeitura && lista.length === 0 ? <button onClick={() => setForm({ ...VAZIO })} style={btnPri}>+ Nova empresa</button> : undefined} />}
        {filtrados.map((e) => {
          const wa = waHref(e.whatsapp || e.celular || e.telefone)
          const n = negocios.get(e.id) ?? 0
          return (
            <div key={e.id} data-testid="crm-empresa-linha" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', borderTop: `1px solid ${C.BORDA}`, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{e.nome_fantasia || e.razao_social}</div>
                <div style={{ fontSize: 12, color: C.TEXTM }}>
                  {[e.segmento, e.cidade && `${e.cidade}${e.uf ? `/${e.uf}` : ''}`, e.email].filter(Boolean).join(' · ') || 'Sem dados de contato'}
                  {n > 0 && <> · <strong style={{ color: C.DOURADO }}>{n} negócio(s) em aberto</strong></>}
                </div>
              </div>
              {wa && <a href={wa} target="_blank" rel="noreferrer" style={chip(C.WA)}>WhatsApp</a>}
              <Link href={`/dashboard/crm/contatos?empresa=${e.id}`} style={chip(C.ESPRESSO)}>Contatos</Link>
              {!soLeitura && <button style={chip(C.ESPRESSO)} onClick={() => setForm({
                id: e.id, nome: e.nome_fantasia ?? e.razao_social ?? '', razao_social: e.razao_social ?? '', cpf_cnpj: e.cpf_cnpj ?? '', telefone: e.telefone ?? '',
                whatsapp: e.whatsapp ?? '', email: e.email ?? '', cidade: e.cidade ?? '', uf: e.uf ?? '', segmento: e.segmento ?? '', site: e.site ?? '', observacoes: e.observacoes ?? '' })}>Editar</button>}
            </div>
          )
        })}
      </section>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Editar empresa' : 'Nova empresa'} subtitle="Só o nome é obrigatório." maxWidth={560}
        footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={() => setForm(null)} style={btnSec}>Cancelar</button>
          <button onClick={() => void salvar()} disabled={!form?.nome.trim()} style={{ ...btnPri, opacity: form?.nome.trim() ? 1 : 0.5 }} data-testid="crm-empresa-salvar">Salvar</button>
        </div>}>
        {form && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Campo rotulo="Nome" ajuda="crm.empresas.nome"><input style={inp} value={form.nome} onChange={set('nome')} data-testid="crm-empresa-nome" /></Campo>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Campo rotulo="Razão social" ajuda="crm.empresas.razao" largura={200}><input style={inp} value={form.razao_social} onChange={set('razao_social')} /></Campo>
              <Campo rotulo="CNPJ ou CPF" ajuda="crm.empresas.documento" largura={160}><input style={inp} inputMode="numeric" value={form.cpf_cnpj} onChange={set('cpf_cnpj')} /></Campo>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Campo rotulo="WhatsApp" ajuda="crm.empresas.whatsapp" largura={160}><input style={inp} inputMode="tel" value={form.whatsapp} onChange={set('whatsapp')} /></Campo>
              <Campo rotulo="Telefone" ajuda="crm.empresas.telefone" largura={160}><input style={inp} inputMode="tel" value={form.telefone} onChange={set('telefone')} /></Campo>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Campo rotulo="E-mail" ajuda="crm.empresas.email" largura={200}><input style={inp} type="email" value={form.email} onChange={set('email')} /></Campo>
              <Campo rotulo="Segmento" ajuda="crm.empresas.segmento" largura={160}><input style={inp} value={form.segmento} onChange={set('segmento')} placeholder="Ex.: Clínica, Indústria" /></Campo>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Campo rotulo="Cidade" ajuda="crm.empresas.cidade" largura={200}><input style={inp} value={form.cidade} onChange={set('cidade')} /></Campo>
              <Campo rotulo="UF" ajuda="crm.empresas.cidade" largura={70}><input style={inp} maxLength={2} value={form.uf} onChange={set('uf')} /></Campo>
            </div>
            <Campo rotulo="Observações" ajuda="crm.empresas.observacoes"><textarea style={{ ...inp, minHeight: 70 }} value={form.observacoes} onChange={set('observacoes')} /></Campo>
          </div>
        )}
      </Modal>
    </Pagina>
  )
}
