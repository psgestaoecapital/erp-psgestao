'use client'

// FASE 1 · CLIENTES de obra (Hub de Projetos). CRUD real sobre erp_clientes
// (reuso do cadastro central — NÃO cria tabela nova), escopado por empresa.
// SEGURANÇA (Pilar 2): erp_clientes tem RLS (company_id via user_companies +
// bypass adm) e projetos_obras via get_user_company_ids() — a query ainda
// filtra explicitamente por empresaUnica pra mostrar só a empresa selecionada.
// Elo da jornada: cliente → obra (projetos_obras.cliente_id; criada por fn_hub_criar_obra_rapida) → orçamento (fase seguinte).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import Link from 'next/link'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { buscarCEP } from '@/lib/cadastros/buscarCEP'
import { aplicarCEP, aplicarCNPJ, brlCurto, cepCompleto, cnpjCompleto, comercialPorCliente, etapaPorCliente, ETAPAS_FECHADAS, ganhasSemObra, iniciais, linkNovaOportunidade, obraRecenteCidadePorCliente, obraRecenteIdPorCliente, obraRecenteNomePorCliente, obraRecentePorCliente, obrasPorCliente, oportunidadesComObra, resultadoPorCliente, rotuloStatusObra, temContato, tipoPessoaNormal, valorOportunidade, type Comercial, type ObraLinha, type ObraResultadoLinha, type OpLinha, type ResultadoCliente, type TipoPF } from './clientes-regras'
import { cpfValido, soDigitosCpf } from '@/lib/documentos/cpf'
import { cnpjValido, soDigitosCnpj } from '@/lib/documentos/cnpj'
import { consultarCNPJ } from '@/lib/cadastros/buscarCNPJ'

// Documento válido: PF exige CPF (11 díg. + DV), PJ exige CNPJ (14 díg. + DV). Vazio é permitido
// (documento é opcional no cadastro); só um documento PREENCHIDO e inválido barra o salvar (correção de
// dado — CEO: toda tela tem de estar CORRETA). Mesma regra do dígito verificador do banco.
function docInvalido(tipo: string | null | undefined, v: string | null | undefined): boolean {
  const pj = (tipo ?? 'PJ') !== 'PF'
  const dig = pj ? soDigitosCnpj(v) : soDigitosCpf(v)
  if (dig.length === 0) return false
  return pj ? !cnpjValido(dig) : !cpfValido(dig)
}

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const GOLD_D = '#A57A15'
const LINE = '#E7DECF'
const CREAM = '#F2EBDF'
const MUT = 'rgba(61,35,20,0.55)'
const RED = '#A32D2D'
const RED_BG = '#FCEBEB'
const GREEN = '#166534'
const GREEN_BG = '#DCFCE7'

type Cliente = {
  id: string
  tipo_pessoa: string | null
  nome_fantasia: string | null
  razao_social: string | null
  cpf_cnpj: string | null
  cnpj_cpf: string | null
  telefone: string | null
  celular: string | null
  email: string | null
  cep: string | null
  logradouro: string | null
  numero: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  ativo: boolean | null
}
type Oportunidade = OpLinha & { titulo: string | null; obra_endereco: string | null; obra_cidade: string | null }
type PropostaCli = { id: string; cliente_id: string | null; numero: string | null; status: string | null; total: number | null }
const ETAPA_ROTULO: Record<string, string> = {
  prospeccao: 'Prospecção', visita_agendada: 'Visita agendada', visita_feita: 'Visita feita', orcando: 'Orçando',
  proposta_enviada: 'Proposta enviada', negociacao: 'Negociação', ganho: 'Ganho', perdido: 'Perdido',
}
const SEM_COMERCIAL: Comercial = { abertas: 0, valorAberto: 0, ganhas: 0, propostas: 0, visitas: 0 }
type Obra = { id: string; numero: string | null; nome: string | null; status: string | null; obra_endereco: string | null; obra_cidade: string | null; obra_uf: string | null; created_at: string | null }

const VAZIO: Partial<Cliente> = { tipo_pessoa: 'PJ', nome_fantasia: '', razao_social: '', cpf_cnpj: '', telefone: '', email: '', cep: '', logradouro: '', numero: '', bairro: '', cidade: '', uf: '', ativo: true }

const docLabel = (t: string | null) => (t === 'PF' ? 'CPF' : 'CNPJ')
const docOf = (c: Cliente) => c.cpf_cnpj || c.cnpj_cpf || '—'
const tipoOf = (c: Cliente): TipoPF => tipoPessoaNormal(c.tipo_pessoa, c.cpf_cnpj || c.cnpj_cpf)
const nomeOf = (c: Cliente) => c.nome_fantasia || c.razao_social || '(sem nome)'

export default function ClientesPage() {
  const { selInfo, sel } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && sel ? sel : null

  const [lista, setLista] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [fTipo, setFTipo] = useState<'' | TipoPF>('')
  const [fCidade, setFCidade] = useState('')
  const [nObras, setNObras] = useState<Record<string, number>>({})
  const [obraRecente, setObraRecente] = useState<Record<string, string>>({})
  const [obraRecenteNome, setObraRecenteNome] = useState<Record<string, string>>({})
  const [obraRecenteCidade, setObraRecenteCidade] = useState<Record<string, string>>({})
  const [obraRecenteId, setObraRecenteId] = useState<Record<string, string>>({})
  const [resultado, setResultado] = useState<Record<string, ResultadoCliente>>({})
  const [resultadoObra, setResultadoObra] = useState<Record<string, { margemPrevista: number; margemPct: number | null }>>({})
  const [opsComObra, setOpsComObra] = useState<Set<string>>(new Set())
  const [demo, setDemo] = useState(false)
  const [ops, setOps] = useState<Oportunidade[]>([])
  const [props, setProps] = useState<PropostaCli[]>([])
  const [comercial, setComercial] = useState<Record<string, Comercial>>({})
  const [orcSemItens, setOrcSemItens] = useState<Record<string, number>>({})
  const [etapa, setEtapa] = useState<Record<string, string>>({})
  const [cepMsg, setCepMsg] = useState<string | null>(null)
  const [docMsg, setDocMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const [form, setForm] = useState<Partial<Cliente> | null>(null) // null=fechado; sem id=criar; com id=editar
  const [salvando, setSalvando] = useState(false)
  const [sel2, setSel2] = useState<Cliente | null>(null) // cliente aberto (detalhe + obras)
  const [obras, setObras] = useState<Obra[]>([])
  const [obrasLoad, setObrasLoad] = useState(false)

  const carregar = useCallback(async () => {
    if (!empresaUnica) { setLoading(false); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase
      .from('erp_clientes')
      .select('id, tipo_pessoa, nome_fantasia, razao_social, cpf_cnpj, cnpj_cpf, telefone, celular, email, cep, logradouro, numero, bairro, cidade, uf, ativo')
      .eq('company_id', empresaUnica)
      .eq('ativo', true)
      .order('nome_fantasia', { nullsFirst: false })
      .limit(1000)
    if (error) { setErro(error.message); setLista([]) } else { setLista((data ?? []) as Cliente[]) }
    // Obras de cada cliente (quantas, a mais recente com cidade) e o RESULTADO de cada obra (v_obra_resultado — a mesma
    // base do cockpit): uma consulta cada, contadas/agregadas na tela. O resultado por cliente desfaz a suspeita do auditor
    // ("Com obra = Clientes ativos" parecer hardcode): cada cliente ganha uma margem própria (RD-38, fecha com a obra).
    const [{ data: ob }, { data: emp }, { data: res }] = await Promise.all([
      supabase.from('projetos_obras').select('id, cliente_id, nome, obra_cidade:cidade, obra_uf:uf, created_at, oportunidade_id').eq('company_id', empresaUnica).limit(5000),
      supabase.from('companies').select('is_demo').eq('id', empresaUnica).maybeSingle(),
      supabase.from('v_obra_resultado').select('obra_id, receita_prevista, custo_previsto, margem_realizada').eq('company_id', empresaUnica).limit(5000),
    ])
    const obL = (ob ?? []) as (ObraLinha & { oportunidade_id: string | null })[]
    setNObras(obrasPorCliente(obL)); setObraRecente(obraRecentePorCliente(obL)); setObraRecenteNome(obraRecenteNomePorCliente(obL)); setObraRecenteCidade(obraRecenteCidadePorCliente(obL)); setObraRecenteId(obraRecenteIdPorCliente(obL)); setOpsComObra(oportunidadesComObra(obL))
    const resL = (res ?? []) as ObraResultadoLinha[]
    setResultado(resultadoPorCliente(obL, resL))
    setResultadoObra(Object.fromEntries(resL.map((r) => {
      const prev = Number(r.receita_prevista ?? 0) - Number(r.custo_previsto ?? 0)
      const pct = Number(r.receita_prevista ?? 0) > 0 ? (prev / Number(r.receita_prevista)) * 100 : null
      return [r.obra_id, { margemPrevista: prev, margemPct: pct }]
    })))
    setDemo(!!(emp as { is_demo?: boolean } | null)?.is_demo)
    // Elo comercial (cliente → oportunidade → visita → proposta): 3 consultas da empresa, contadas na tela.
    const [rOp, rOrc, rVis] = await Promise.all([
      supabase.from('erp_crm_oportunidade').select('id, cliente_id, titulo, etapa, valor_estimado, valor_proposta, obra_endereco, obra_cidade').eq('company_id', empresaUnica).is('deleted_at', null).limit(5000),
      supabase.from('erp_orcamentos').select('id, cliente_id, numero, status, total').eq('company_id', empresaUnica).not('cliente_id', 'is', null).limit(5000),
      supabase.from('erp_crm_visita').select('oportunidade_id').eq('company_id', empresaUnica).limit(5000),
    ])
    const opsL = (rOp.data ?? []) as Oportunidade[]
    const orcL = (rOrc.data ?? []) as PropostaCli[]
    setOps(opsL); setProps(orcL); setEtapa(etapaPorCliente(opsL))
    setComercial(comercialPorCliente(opsL, orcL, (rVis.data ?? []) as { oportunidade_id: string | null }[]))
    // Indicador "orçamento sem itens" por cliente (trava crítica do blueprint: orçamento sem item não tem custo/preço).
    // Uma consulta agregada set-based por empresa (fn_clientes_orcamentos_sem_itens, SECURITY INVOKER — respeita RLS).
    const { data: osi } = await supabase.rpc('fn_clientes_orcamentos_sem_itens', { p_company: empresaUnica })
    setOrcSemItens(Object.fromEntries(((osi ?? []) as { cliente_id: string; sem_itens: number }[]).map((r) => [r.cliente_id, Number(r.sem_itens)])))
    setLoading(false)
  }, [empresaUnica])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial dos dados da empresa (loading/erro)
  useEffect(() => { void carregar() }, [carregar])

  const carregarObras = useCallback(async (clienteId: string) => {
    setObrasLoad(true)
    const { data } = await supabase
      .from('projetos_obras')
      .select('id, numero, nome, status, obra_endereco:endereco, obra_cidade:cidade, obra_uf:uf, created_at')
      .eq('cliente_id', clienteId)
      .order('created_at', { ascending: false })
    setObras((data ?? []) as Obra[])
    setObrasLoad(false)
  }, [])

  const abrir = (c: Cliente) => { setSel2(c); setObras([]); void carregarObras(c.id) }
  const alternar = (c: Cliente) => { if (sel2?.id === c.id) setSel2(null); else abrir(c) }

  const cidades = useMemo(() => [...new Set(lista.map((c) => (c.cidade ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [lista])
  const resumo = useMemo(() => ({
    total: lista.length,
    comObra: lista.filter((c) => (nObras[c.id] ?? 0) > 0).length,
    incompletos: lista.filter((c) => !temContato(c) || docOf(c) === '—').length,
    emAberto: lista.reduce((t, c) => t + (comercial[c.id]?.valorAberto ?? 0), 0),
  }), [lista, nObras, comercial])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const base = lista.filter((c) => (!fTipo || tipoOf(c) === fTipo) && (!fCidade || (c.cidade ?? '').trim() === fCidade))
    if (!q) return base
    return base.filter((c) =>
      nomeOf(c).toLowerCase().includes(q) ||
      (docOf(c) ?? '').toLowerCase().includes(q) ||
      (c.cidade ?? '').toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q) ||
      (c.telefone ?? '').includes(q) ||
      (c.celular ?? '').includes(q))
  }, [lista, busca, fTipo, fCidade])
  const filtrando = !!(busca || fTipo || fCidade)

  async function salvar() {
    if (!empresaUnica || !form) return
    const nome = (form.nome_fantasia ?? '').trim()
    if (!nome) { setErro('Informe o nome do cliente.'); return }
    // Não deixa gravar documento inválido (dígito verificador) — evita cadastro com CPF/CNPJ errado.
    if (docInvalido(form.tipo_pessoa, form.cpf_cnpj)) {
      setErro(`${docLabel(form.tipo_pessoa ?? 'PJ')} inválido — confira os números (ou deixe em branco).`); return
    }
    setSalvando(true); setErro(null); setOk(null)
    const doc = (form.cpf_cnpj ?? '').trim() || null
    const payload = {
      company_id: empresaUnica,
      tipo_pessoa: form.tipo_pessoa || 'PJ',
      nome_fantasia: nome,
      razao_social: (form.razao_social ?? '').trim() || nome,
      cpf_cnpj: doc, cnpj_cpf: doc, // espelha nas duas colunas (legado + canônica)
      telefone: (form.telefone ?? '').trim() || null,
      email: (form.email ?? '').trim() || null,
      cep: (form.cep ?? '').trim() || null,
      logradouro: (form.logradouro ?? '').trim() || null,
      numero: (form.numero ?? '').trim() || null,
      bairro: (form.bairro ?? '').trim() || null,
      cidade: (form.cidade ?? '').trim() || null,
      uf: (form.uf ?? '').trim().toUpperCase().slice(0, 2) || null,
      ativo: true,
    }
    const editando = !!form.id
    const q = editando
      ? supabase.from('erp_clientes').update(payload).eq('id', form.id!)
      : supabase.from('erp_clientes').insert(payload)
    const { error } = await q
    setSalvando(false)
    if (error) { setErro(`Erro ao salvar: ${error.message}`); return }
    setOk(editando ? `ALTEROU cliente ${nome}` : `CRIOU cliente ${nome}`)
    setForm(null)
    await carregar()
    setTimeout(() => setOk(null), 4000)
  }

  async function excluir(c: Cliente) {
    if (!window.confirm(`Excluir o cliente "${nomeOf(c)}"?\n\nEle sai da lista de clientes de obra (arquivado). Obras e histórico são preservados.`)) return
    // RD-98 p4: exclusão rastreável via RPC (soft-delete ativo=false + excluido_em/excluido_por + audit_log_global),
    // em vez do update direto que não registrava quem/quando. A listagem segue filtrando ativo=true.
    const { data, error } = await supabase.rpc('fn_cliente_arquivar', { p_id: c.id })
    if (error || !(data as { ok?: boolean } | null)?.ok) { setErro(`Erro ao excluir: ${error?.message ?? (data as { erro?: string } | null)?.erro ?? 'tente de novo'}`); return }
    setOk(`EXCLUIU (arquivou) ${nomeOf(c)}`)
    if (sel2?.id === c.id) setSel2(null)
    await carregar()
    setTimeout(() => setOk(null), 4000)
  }

  // CEP com 8 dígitos busca o endereço (BrasilAPI, mesmo helper do cadastro central) e completa o formulário.
  async function mudarCep(v: string) {
    setForm((f) => (f ? { ...f, cep: v } : f))
    if (!cepCompleto(v)) { setCepMsg(null); return }
    setCepMsg('Buscando endereço do CEP…')
    const d = await buscarCEP(v)
    if (!d) { setCepMsg('CEP não encontrado — preencha o endereço à mão.'); return }
    setForm((f) => (f && (f.cep ?? '') === v ? aplicarCEP(f, d) : f))
    setCepMsg(`Endereço do CEP: ${d.cidade}/${d.uf}`)
  }

  // CNPJ completo (14 díg., só PJ) busca na Receita (BrasilAPI → ReceitaWS, rota interna /api/cnpj-lookup — o mesmo
  // helper do cadastro central) e completa razão social, contato e endereço nos campos AINDA vazios (aplicarCNPJ nunca
  // sobrescreve o que a pessoa já digitou). CPF (PF) não consulta. A guarda do documento atual evita aplicar o retorno
  // de uma consulta antiga se o usuário já mudou o número no meio tempo (igual ao mudarCep).
  async function mudarDoc(v: string) {
    setForm((f) => (f ? { ...f, cpf_cnpj: v } : f))
    if ((form?.tipo_pessoa ?? 'PJ') === 'PF' || !cnpjCompleto(v)) { setDocMsg(null); return }
    const dig = soDigitosCnpj(v)
    setDocMsg('Buscando dados do CNPJ na Receita…')
    const r = await consultarCNPJ(dig)
    if (r.status === 'nao_encontrado') { setDocMsg('CNPJ não encontrado — preencha os dados à mão.'); return }
    if (r.status === 'indisponivel') { setDocMsg('Consulta de CNPJ indisponível agora — preencha à mão.'); return }
    setForm((f) => (f && soDigitosCnpj(f.cpf_cnpj) === dig ? aplicarCNPJ(f, r.dados) : f))
    setDocMsg(`Dados da Receita: ${r.dados.razao_social || r.dados.nome_fantasia || 'cadastro encontrado'}`)
  }

  // Sem oportunidade: obra avulsa do cliente. Com a oportunidade ganha: a obra nasce com o título e o endereço da venda.
  async function novaObra(c: Cliente, op?: Oportunidade) {
    const nome = window.prompt(`Nome da obra para ${nomeOf(c)}:`, op?.titulo || `Obra ${nomeOf(c)}`)
    if (!nome || !nome.trim()) return
    if (!empresaUnica) return
    // Mesma RPC da tela Nova obra (numeração OBR-AAAA-NNNN, guarda de empresa). Endereço: o da venda; sem venda, o do cliente.
    const { data: obraId, error: eCria } = await supabase.rpc('fn_hub_criar_obra_rapida', {
      p_company_id: empresaUnica, p_cliente_id: c.id, p_cliente_nome: nomeOf(c), p_nome: nome.trim(),
      p_logradouro: op ? op.obra_endereco || null : c.logradouro, p_numero: op ? null : c.numero, p_bairro: op ? null : c.bairro,
      p_cidade: op ? op.obra_cidade || null : c.cidade, p_uf: op ? null : c.uf, p_cep: op ? null : c.cep, p_codigo_ibge: null, p_cno: null,
    })
    let error = eCria
    // A obra da venda guarda a oportunidade de origem (o botão some e o funil sabe que a venda virou obra).
    if (!error && op && obraId) ({ error } = await supabase.from('projetos_obras').update({ oportunidade_id: op.id }).eq('id', obraId as string))
    if (error) { setErro(`Erro ao criar obra: ${error.message}`); return }
    setOk(`CRIOU obra "${nome.trim()}" para ${nomeOf(c)}`)
    await Promise.all([carregarObras(c.id), carregar()])
    setTimeout(() => setOk(null), 4000)
  }

  // ── Gate empresa ────────────────────────────────────────────────
  if (!empresaUnica) {
    return (
      <Casca>
        <Box><b style={{ color: ESP }}>Selecione uma empresa</b><div style={{ color: MUT, marginTop: 6, fontSize: 13 }}>Clientes são por empresa. Escolha uma empresa específica no seletor do topo (sem modo consolidado/grupo).</div></Box>
      </Casca>
    )
  }

  return (
    <Casca>
      {demo && <div data-testid="hub-clientes-demo" style={aviso(GOLD_D, 'rgba(200,148,26,0.12)')}>Empresa de demonstração — clientes, valores e obras são fictícios, para testar a jornada.</div>}
      {erro && <div style={aviso(RED, RED_BG)}>{erro}</div>}
      {ok && <div style={aviso(GREEN, GREEN_BG)}>✓ {ok}</div>}

      {/* Resumo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 14 }}>
        <Indicador rotulo="Clientes ativos" valor={loading ? '…' : String(resumo.total)} ajuda="projetos.clientes.kpi.total" />
        <Indicador rotulo="Com obra" valor={loading ? '…' : String(resumo.comObra)} ajuda="projetos.clientes.kpi.com_obra" dica={!loading && resumo.total > 0 && resumo.comObra === 0 ? 'Nenhum cliente com obra vinculada — abra um cliente e crie a obra' : undefined} />
        <Indicador rotulo="Cadastro incompleto" valor={loading ? '…' : String(resumo.incompletos)} ajuda="projetos.clientes.kpi.incompletos" alerta={!loading && resumo.incompletos > 0} />
        <Indicador rotulo="Em negociação" valor={loading ? '…' : brlCurto(resumo.emAberto)} ajuda="projetos.clientes.kpi.em_aberto" dica={!loading && resumo.emAberto === 0 ? 'Sem proposta ou oportunidade em aberto neste recorte' : undefined} />
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, documento, cidade, contato…" style={{ ...inp, flex: 1, minWidth: 200 }} />
        <AjudaCampo chave="projetos.clientes.busca" />
        <button onClick={() => { setCepMsg(null); setDocMsg(null); setForm({ ...VAZIO }) }} style={btnGold}>+ Novo cliente</button>
        <AjudaCampo chave="projetos.clientes.acao.novo" />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        {([['', 'Todos'], ['PJ', 'Pessoa jurídica'], ['PF', 'Pessoa física']] as const).map(([v, r]) => (
          <button key={v || 'todos'} onClick={() => setFTipo(v)} aria-pressed={fTipo === v} style={chip(fTipo === v)}>{r}</button>
        ))}
        <AjudaCampo chave="projetos.clientes.filtro_tipo" />
        <select value={fCidade} onChange={(e) => setFCidade(e.target.value)} aria-label="Filtrar por cidade" style={{ ...inp, padding: '6px 10px', fontSize: 12 }}>
          <option value="">Todas as cidades</option>
          {cidades.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <AjudaCampo chave="projetos.clientes.filtro_cidade" />
      </div>

      {loading ? (
        <Box><span style={{ color: MUT }}>Carregando clientes…</span></Box>
      ) : filtrados.length === 0 ? (
        <Box>
          <b style={{ color: ESP }}>{filtrando ? 'Nenhum cliente encontrado' : 'Nenhum cliente ainda'}</b>
          <div style={{ color: MUT, marginTop: 6, fontSize: 13 }}>{filtrando ? 'Ajuste a busca ou os filtros.' : 'Clique em “+ Novo cliente” para cadastrar o primeiro.'}</div>
        </Box>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 11, color: MUT, display: 'flex', alignItems: 'center', gap: 4 }}>{filtrados.length} cliente(s){filtrando ? ' (filtrado)' : ''} · toque no cliente para ver as obras <AjudaCampo chave="projetos.clientes.lista" /></div>
          {filtrados.map((c) => {
            const tipo = tipoOf(c)
            const n = nObras[c.id] ?? 0
            const cm = comercial[c.id] ?? SEM_COMERCIAL
            const semItens = orcSemItens[c.id] ?? 0
            const contato = [c.telefone || c.celular, c.email].filter(Boolean).join(' · ')
            const semObra = ganhasSemObra(cm.ganhas, n)
            const rc = resultado[c.id]
            return (
            <div key={c.id} style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 10, overflow: 'hidden' }}>
              <div role="button" tabIndex={0} aria-expanded={sel2?.id === c.id} onKeyDown={(e) => { if (e.key === 'Enter') alternar(c) }} onClick={() => alternar(c)} style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span aria-hidden style={{ width: 38, height: 38, flex: '0 0 38px', borderRadius: '50%', background: CREAM, color: GOLD_D, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800 }}>{iniciais(nomeOf(c))}</span>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: ESP, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {nomeOf(c)}
                    <span title={tipo === 'PF' ? 'Pessoa física' : 'Pessoa jurídica'} style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, padding: '2px 7px', borderRadius: 5, background: CREAM, color: GOLD_D }}>{tipo}</span>
                  </div>
                  <div style={{ fontSize: 11, color: MUT }}>{docLabel(tipo)}: {docOf(c) === '—' ? <i>não informado</i> : docOf(c)}{c.cidade ? ` · ${c.cidade}${c.uf ? '/' + c.uf : ''}` : ''}</div>
                  <div style={{ fontSize: 11, color: contato ? MUT : RED }}>{contato || 'Sem telefone nem e-mail — complete em Editar'}</div>
                  {obraRecente[c.id] && (
                    // Cadeia cliente → obra → resultado em HIERARQUIA (auditor FC 27/10): linha 1 = nome da obra (link para o
                    // Resultado/cockpit); linha 2 = cidade da obra + a margem prevista daquela obra (reaproveita v_obra_resultado).
                    // Antes vinha tudo concatenado num texto só, truncado.
                    <div data-testid="hub-cliente-obra" style={{ marginTop: 3, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {obraRecenteId[c.id]
                        ? <Link href={`/dashboard/projetos/obras/${obraRecenteId[c.id]}/cockpit`} onClick={(e) => e.stopPropagation()} style={{ fontSize: 11.5, color: GOLD_D, fontWeight: 700, textDecoration: 'none' }}>Obra: {obraRecenteNome[c.id] || obraRecente[c.id]}{n > 1 ? ` (+${n - 1})` : ''} · resultado ›</Link>
                        : <span style={{ fontSize: 11.5, color: ESP, fontWeight: 700 }}>Obra: {obraRecenteNome[c.id] || obraRecente[c.id]}{n > 1 ? ` (+${n - 1})` : ''}</span>}
                      <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 11, color: MUT }}>
                        {obraRecenteCidade[c.id] && <span>{obraRecenteCidade[c.id]}</span>}
                        {rc && rc.margemPrevista !== 0 && (
                          <span data-testid="hub-cliente-margem" title="Margem prevista do orçamento da obra (receita prevista − custo previsto)" style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: rc.margemPrevista >= 0 ? GREEN_BG : RED_BG, color: rc.margemPrevista >= 0 ? GREEN : RED, whiteSpace: 'nowrap' }}>
                            Margem prev. {brlCurto(rc.margemPrevista)}{rc.margemPct != null ? ` · ${rc.margemPct.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%` : ''}
                          </span>
                        )}
                        <AjudaCampo chave="projetos.clientes.margem_obra" />
                      </span>
                    </div>
                  )}
                </div>
                {/* RD-95 (auditor FC 27/10): cada indicador comercial tem o SEU "?" — antes os 7 selos dividiam uma única
                    chave de ajuda. Cada selo e seu "?" ficam juntos num inline-flex para a linha continuar legível ao quebrar. */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }} data-testid="hub-cliente-comercial">
                  {etapa[c.id] && <span style={PILL_WRAP}><span data-testid="hub-cliente-etapa" title="Etapa mais avançada do funil entre as oportunidades em aberto" style={pilula(true)}>Funil: {ETAPA_ROTULO[etapa[c.id]] ?? etapa[c.id]}</span><AjudaCampo chave="projetos.clientes.comercial.funil" /></span>}
                  {cm.abertas > 0 && <span style={PILL_WRAP}><span title="Oportunidades em aberto e o valor delas" style={pilula(true)}>{cm.abertas === 1 ? '1 em aberto' : `${cm.abertas} em aberto`} · {brlCurto(cm.valorAberto)}</span><AjudaCampo chave="projetos.clientes.comercial.em_aberto" /></span>}
                  {cm.ganhas > 0 && <span style={PILL_WRAP}><span title="Oportunidades ganhas" style={pilula(true)}>{cm.ganhas === 1 ? '1 ganha' : `${cm.ganhas} ganhas`}</span><AjudaCampo chave="projetos.clientes.comercial.ganhas" /></span>}
                  <span style={PILL_WRAP}><span title="Propostas (orçamentos) do cliente" style={pilula(cm.propostas > 0)}>{cm.propostas === 1 ? '1 proposta' : `${cm.propostas} propostas`}</span><AjudaCampo chave="projetos.clientes.comercial.propostas" /></span>
                  {semItens > 0 && <span style={PILL_WRAP}><span data-testid="hub-cliente-orc-sem-itens" title="Orçamentos do cliente ainda sem itens lançados — trava a jornada (sem item não há custo/preço). Abra Propostas para completar." style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, background: RED_BG, color: RED, whiteSpace: 'nowrap' }}>{semItens === 1 ? '1 orçamento sem itens' : `${semItens} orçamentos sem itens`}</span><AjudaCampo chave="projetos.clientes.comercial.orcamentos_sem_itens" /></span>}
                  {cm.visitas > 0 && <span style={PILL_WRAP}><span title="Visitas técnicas do cliente" style={pilula(true)}>{cm.visitas === 1 ? '1 visita' : `${cm.visitas} visitas`}</span><AjudaCampo chave="projetos.clientes.comercial.visitas" /></span>}
                  <span style={PILL_WRAP}><span title="Obras do cliente" style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, background: n > 0 ? GREEN_BG : CREAM, color: n > 0 ? GREEN : MUT, whiteSpace: 'nowrap' }}>{n === 1 ? '1 obra' : `${n} obras`}</span><AjudaCampo chave="projetos.clientes.comercial.obras" /></span>
                  {semObra > 0 && <span style={PILL_WRAP}><span data-testid="hub-cliente-ganha-sem-obra" title="Venda ganha que ainda não virou obra — abra a obra no detalhe" style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, background: RED_BG, color: RED, whiteSpace: 'nowrap' }}>{semObra === 1 ? '1 ganha sem obra' : `${semObra} ganhas sem obra`}</span><AjudaCampo chave="projetos.clientes.comercial.ganhas_sem_obra" /></span>}
                </div>
                <span style={{ color: GOLD, fontSize: 12 }}>{sel2?.id === c.id ? '▲' : '▼'}</span>
              </div>

              {/* CRUD à vista na LISTAGEM (auditor FC 27/10, gap 1): editar/excluir sem precisar abrir o card. A foto do
                  auditor pega a lista fechada, então os botões precisam aparecer aqui, não só no detalhe. stopPropagation
                  para o clique não alternar o card. Excluir pede confirmação (arquiva — obras e histórico preservados). */}
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', borderTop: `0.5px solid ${LINE}`, padding: '7px 14px', fontSize: 12 }}>
                <button onClick={(e) => { e.stopPropagation(); setCepMsg(null); setDocMsg(null); setForm({ ...c, tipo_pessoa: tipo, cpf_cnpj: c.cpf_cnpj || c.cnpj_cpf || '' }) }} data-testid="hub-cliente-editar" style={{ background: 'none', border: 'none', color: GOLD_D, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Editar</button>
                <AjudaCampo chave="projetos.clientes.acao.editar" />
                <button onClick={(e) => { e.stopPropagation(); void excluir(c) }} data-testid="hub-cliente-excluir" style={{ background: 'none', border: 'none', color: RED, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Excluir</button>
                <AjudaCampo chave="projetos.clientes.acao.excluir" />
                <span style={{ marginLeft: 'auto', color: MUT, fontSize: 11 }}>{sel2?.id === c.id ? 'detalhes abertos' : 'toque no cliente para ver obras e propostas'}</span>
              </div>

              {sel2?.id === c.id && (
                <div style={{ borderTop: `0.5px solid ${LINE}`, padding: 14, background: BG }}>
                  {/* Editar/Excluir ficam no rodapé sempre visível do card (acima); aqui, no detalhe, só as ações de CRIAR
                      (obra, oportunidade, proposta) — o elo da jornada a partir do cliente. */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    <button onClick={() => novaObra(c)} style={btnGold}>+ Nova obra</button>
                    <AjudaCampo chave="projetos.clientes.acao.nova_obra" />
                    <Link href={linkNovaOportunidade(c.id)} data-testid="hub-cliente-nova-oportunidade" style={{ ...btnOutline, textDecoration: 'none' }}>Nova oportunidade</Link>
                    <AjudaCampo chave="projetos.clientes.acao.oportunidade" />
                    <Link href="/dashboard/orcamentos" style={{ ...btnOutline, textDecoration: 'none' }}>Nova proposta</Link>
                    <AjudaCampo chave="projetos.clientes.acao.proposta" />
                  </div>
                  {(c.logradouro || c.bairro || c.cep) && (
                    <div style={{ fontSize: 12, color: MUT, marginBottom: 12 }}>
                      Endereço: {[c.logradouro, c.numero].filter(Boolean).join(', ')}{c.bairro ? ` · ${c.bairro}` : ''}{c.cep ? ` · CEP ${c.cep}` : ''}
                    </div>
                  )}
                  <BlocoComercial ops={ops.filter((o) => o.cliente_id === c.id)} props={props.filter((x) => x.cliente_id === c.id)} abrirObra={semObra > 0 ? (op) => novaObra(c, op) : undefined} comObra={opsComObra} />
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>Obras deste cliente <AjudaCampo chave="projetos.clientes.obras" /></div>
                  {obrasLoad ? (
                    <div style={{ fontSize: 12, color: MUT }}>Carregando obras…</div>
                  ) : obras.length === 0 ? (
                    <div style={{ fontSize: 12, color: MUT, fontStyle: 'italic' }}>Nenhuma obra ainda. Use “+ Nova obra” para começar o elo Cliente → Obra → Orçamento.</div>
                  ) : (
                    <div style={{ display: 'grid', gap: 6 }}>
                      {obras.map((o) => {
                        const ro = resultadoObra[o.id]
                        return (
                        <Link key={o.id} href={`/dashboard/projetos/obras/${o.id}/cockpit`} style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center', textDecoration: 'none' }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: ESP }}>{o.numero ? `${o.numero} · ` : ''}{o.nome || '(sem nome)'}</span>
                          <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            {ro && ro.margemPrevista !== 0 && (
                              <span title="Margem prevista do orçamento desta obra" style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: ro.margemPrevista >= 0 ? GREEN_BG : RED_BG, color: ro.margemPrevista >= 0 ? GREEN : RED, whiteSpace: 'nowrap' }}>Margem {brlCurto(ro.margemPrevista)}{ro.margemPct != null ? ` · ${ro.margemPct.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%` : ''}</span>
                            )}
                            <span style={{ fontSize: 11, color: MUT }}>{rotuloStatusObra(o.status)}{o.obra_endereco ? ` · ${o.obra_endereco}` : ''}{o.obra_cidade ? ` · ${o.obra_cidade}${o.obra_uf ? '/' + o.obra_uf : ''}` : ''} · abrir ›</span>
                          </span>
                        </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}

      {/* Modal criar/editar */}
      {form && (
        <div onClick={() => !salvando && setForm(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.35)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 12px', zIndex: 50, overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#FFF', borderRadius: 14, border: `0.5px solid ${LINE}`, padding: 18, width: '100%', maxWidth: 520 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: ESP, marginBottom: 2 }}>{form.id ? 'Editar cliente' : 'Novo cliente'}</div>
            <div style={{ fontSize: 11, color: MUT, marginBottom: 14 }}>Cadastro de cliente de obra (PF ou PJ).</div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 12, alignItems: 'center' }}>
              {(['PJ', 'PF'] as const).map((t) => (
                <button key={t} onClick={() => { setDocMsg(null); setForm({ ...form, tipo_pessoa: t }) }} style={{ flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: `1px solid ${form.tipo_pessoa === t ? GOLD : LINE}`, background: form.tipo_pessoa === t ? 'rgba(200,148,26,0.10)' : '#FFF', color: form.tipo_pessoa === t ? GOLD_D : MUT }}>
                  {t === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física'}
                </button>
              ))}
              <AjudaCampo chave="projetos.clientes.tipo_pessoa" />
            </div>

            <Campo label={form.tipo_pessoa === 'PF' ? 'Nome completo *' : 'Nome fantasia *'} ajuda="projetos.clientes.nome" v={form.nome_fantasia ?? ''} on={(v) => setForm({ ...form, nome_fantasia: v })} />
            {form.tipo_pessoa === 'PJ' && <Campo label="Razão social" ajuda="projetos.clientes.razao_social" v={form.razao_social ?? ''} on={(v) => setForm({ ...form, razao_social: v })} />}
            <Campo label={docLabel(form.tipo_pessoa ?? 'PJ')} ajuda="projetos.clientes.documento" v={form.cpf_cnpj ?? ''} on={(v) => { void mudarDoc(v) }} />
            {docInvalido(form.tipo_pessoa, form.cpf_cnpj) && (
              <div data-testid="hub-cliente-doc-invalido" style={{ fontSize: 11, color: RED, margin: '-4px 0 8px' }}>
                {docLabel(form.tipo_pessoa ?? 'PJ')} inválido — confira os números.
              </div>
            )}
            {/* CNPJ auto-preenche na Receita: hint discreto (PJ sem documento ainda) + feedback vivo da consulta.
                Some quando há o aviso de documento inválido, para não empilhar mensagens no mesmo campo. */}
            {!docInvalido(form.tipo_pessoa, form.cpf_cnpj) && (docMsg
              ? <div data-testid="hub-cliente-doc-msg" style={{ fontSize: 11, color: MUT, margin: '-4px 0 8px' }}>{docMsg}</div>
              : (form.tipo_pessoa ?? 'PJ') !== 'PF' && !cnpjCompleto(form.cpf_cnpj) && (
                <div style={{ fontSize: 11, color: MUT, margin: '-4px 0 8px' }}>Digite o CNPJ completo e buscamos razão social, contato e endereço na Receita.</div>
              ))}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 140 }}><Campo label="Telefone" ajuda="projetos.clientes.telefone" v={form.telefone ?? ''} on={(v) => setForm({ ...form, telefone: v })} /></div>
              <div style={{ flex: 1, minWidth: 140 }}><Campo label="E-mail" ajuda="projetos.clientes.email" v={form.email ?? ''} on={(v) => setForm({ ...form, email: v })} /></div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 140 }}><Campo label="CEP" ajuda="projetos.clientes.cep" v={form.cep ?? ''} on={(v) => { void mudarCep(v) }} /></div>
              <div style={{ flex: 2, minWidth: 180 }}><Campo label="Logradouro" ajuda="projetos.clientes.logradouro" v={form.logradouro ?? ''} on={(v) => setForm({ ...form, logradouro: v })} /></div>
              <div style={{ width: 80 }}><Campo label="Nº" ajuda="projetos.clientes.numero" v={form.numero ?? ''} on={(v) => setForm({ ...form, numero: v })} /></div>
            </div>
            {cepMsg && <div data-testid="hub-cliente-cep-msg" style={{ fontSize: 11, color: MUT, margin: '-4px 0 8px' }}>{cepMsg}</div>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 140 }}><Campo label="Bairro" ajuda="projetos.clientes.bairro" v={form.bairro ?? ''} on={(v) => setForm({ ...form, bairro: v })} /></div>
              <div style={{ flex: 1, minWidth: 140 }}><Campo label="Cidade" ajuda="projetos.clientes.cidade" v={form.cidade ?? ''} on={(v) => setForm({ ...form, cidade: v })} /></div>
              <div style={{ width: 64 }}><Campo label="UF" ajuda="projetos.clientes.uf" v={form.uf ?? ''} on={(v) => setForm({ ...form, uf: v })} /></div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button onClick={() => setForm(null)} disabled={salvando} style={btnOutline}>Cancelar</button>
              <button onClick={salvar} disabled={salvando} style={{ ...btnGold, opacity: salvando ? 0.6 : 1 }}>{salvando ? 'Salvando…' : (form.id ? 'Salvar alterações' : 'Criar cliente')}</button>
            </div>
          </div>
        </div>
      )}
    </Casca>
  )
}

// ── Peças ────────────────────────────────────────────────────────────
const brl = (v: number | null) => (v === null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
function BlocoComercial({ ops, props, abrirObra, comObra }: { ops: Oportunidade[]; props: PropostaCli[]; abrirObra?: (op: Oportunidade) => void; comObra: Set<string> }) {
  const titulo = (t: string, k: string) => (
    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>{t} <AjudaCampo chave={k} /></div>
  )
  const linha: React.CSSProperties = { background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', textDecoration: 'none' }
  return (
    <div style={{ display: 'grid', gap: 12, marginBottom: 12 }}>
      <div>
        {titulo('Oportunidades deste cliente', 'projetos.clientes.oportunidades')}
        {ops.length === 0 ? <div style={{ fontSize: 12, color: MUT, fontStyle: 'italic' }}>Nenhuma oportunidade ainda. Use “Nova oportunidade”.</div> : (
          <div style={{ display: 'grid', gap: 6 }}>
            {ops.map((o) => (
              <div key={o.id} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <Link href={`/dashboard/projetos/oportunidades/${o.id}`} style={{ ...linha, flex: 1, minWidth: 220 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: ESP }}>{o.titulo || '(sem título)'}</span>
                  <span style={{ fontSize: 11, color: ETAPAS_FECHADAS.has(o.etapa ?? '') ? MUT : GOLD_D, fontWeight: 600 }}>{ETAPA_ROTULO[o.etapa ?? ''] ?? o.etapa ?? '—'} · {brl(valorOportunidade(o))} · abrir ›</span>
                </Link>
                {abrirObra && o.etapa === 'ganho' && !comObra.has(o.id) && (
                  <>
                    <button onClick={() => abrirObra(o)} data-testid="hub-cliente-abrir-obra" style={btnGold}>Abrir obra desta venda</button>
                    <AjudaCampo chave="projetos.clientes.acao.nova_obra" />
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        {titulo('Propostas deste cliente', 'projetos.clientes.propostas')}
        {props.length === 0 ? <div style={{ fontSize: 12, color: MUT, fontStyle: 'italic' }}>Nenhuma proposta ainda. Use “Nova proposta”.</div> : (
          <div style={{ display: 'grid', gap: 6 }}>
            {props.map((x) => (
              <Link key={x.id} href={`/dashboard/orcamentos?id=${x.id}`} style={linha}>
                <span style={{ fontSize: 13, fontWeight: 600, color: ESP }}>{x.numero ? `Proposta ${x.numero}` : 'Proposta sem número'}</span>
                <span style={{ fontSize: 11, color: MUT }}>{x.status || 'rascunho'} · {brl(x.total)} · abrir ›</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
const pilula = (on: boolean): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, background: on ? 'rgba(200,148,26,0.12)' : CREAM, color: on ? GOLD_D : MUT, whiteSpace: 'nowrap' })
// cada selo comercial anda junto do seu "?" (RD-95), sem quebrar entre o selo e a ajuda
const PILL_WRAP: React.CSSProperties = { display: 'inline-flex', alignItems: 'center' }
function Casca({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: GOLD, margin: 0 }}>Projetos · Comercial</p>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: ESP, margin: '4px 0 2px' }}>Clientes de obra</h1>
        <p style={{ fontSize: 12, color: MUT, margin: '0 0 18px' }}>Clientes finais (PF/PJ) e suas obras. O cliente vira dono da obra, que ancora o orçamento.</p>
        {children}
      </div>
    </div>
  )
}
function Indicador({ rotulo, valor, ajuda, alerta, dica }: { rotulo: string; valor: string; ajuda: string; alerta?: boolean; dica?: string }) {
  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${alerta ? RED + '55' : LINE}`, borderRadius: 10, padding: '10px 14px' }}>
      <div style={{ fontSize: 10, color: MUT, textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 4 }}>{rotulo} <AjudaCampo chave={ajuda} /></div>
      <div style={{ fontSize: 22, fontWeight: 700, color: alerta ? RED : ESP, marginTop: 2 }}>{valor}</div>
      {dica && <div style={{ fontSize: 11, color: MUT, marginTop: 2 }}>{dica}</div>}
    </div>
  )
}
function Box({ children }: { children: React.ReactNode }) {
  return <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 28, textAlign: 'center' }}>{children}</div>
}
function Campo({ label, v, on, ajuda }: { label: string; v: string; on: (v: string) => void; ajuda: string }) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <span style={{ display: 'block', fontSize: 10, color: MUT, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>{label} <AjudaCampo chave={ajuda} /></span>
      <input value={v} onChange={(e) => on(e.target.value)} style={{ ...inp, width: '100%' }} />
    </label>
  )
}
const chip = (on: boolean): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: `1px solid ${on ? GOLD : LINE}`, background: on ? 'rgba(200,148,26,0.10)' : '#FFF', color: on ? GOLD_D : MUT })
const aviso = (fg: string, bg: string): React.CSSProperties => ({ background: bg, color: fg, padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13, fontWeight: 600 })
const inp: React.CSSProperties = { padding: '9px 12px', border: '0.5px solid rgba(61,35,20,0.25)', borderRadius: 6, fontSize: 13, color: ESP, background: '#FFF', boxSizing: 'border-box' }
const btnGold: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: 'none', background: GOLD, color: '#FFF', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const btnOutline: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#FFF', color: ESP, fontSize: 13, fontWeight: 600, cursor: 'pointer' }
