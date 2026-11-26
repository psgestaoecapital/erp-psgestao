'use client'
// Hub · Gestão de Obras · Orçamento por EAP (blueprint vivo tela 315, Onda C-2).
// Slice 1 (leitura): árvore da EAP com material × mão de obra × total e % por nó, mais o toggle Etapa/Local.
// Slice 2 (escrita · "+ Item"): adiciona serviço do catálogo da empresa, com local e quantidade, pela RPC
// fn_projetos_orcamento_item_eap_salvar (SECURITY DEFINER, guarda por empresa). O custo vem do serviço e pode ser
// editado antes de gravar. O importador xlsx (tela 334) é tela à parte. Aberta pelo cockpit da obra.
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ehUuid, erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/projetos/obras/[id]/orcamento'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERM = '#B91C1C'
const brl = (n: number | null | undefined) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
// §315 — situação do orçamento (erp_orcamentos.status, compartilhado com o Comércio). Só leitura aqui:
// a mudança de estado continua no fluxo de orçamento do Comércio; o Hub apenas mostra em que pé está.
const SITUACAO: Record<string, { rotulo: string; cor: string; bg: string }> = {
  rascunho: { rotulo: 'Rascunho', cor: MUT, bg: '#F3EEE7' },
  enviado: { rotulo: 'Enviado', cor: GOLD, bg: '#FBF3E0' },
  aprovado: { rotulo: 'Aprovado', cor: '#166534', bg: '#E8F3EC' },
  convertido: { rotulo: 'Convertido', cor: '#166534', bg: '#E8F3EC' },
  cancelado: { rotulo: 'Cancelado', cor: VERM, bg: '#FBEAEA' },
}
const pct = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`

// Nó da árvore EAP (modo 'eap')
type NoEap = { eap_codigo: string; nome: string; nivel: number; parent_codigo: string | null; material: number; mao_obra: number; total: number; pct: number }
// Linha por local (modo 'local')
type NoLocal = { local_tipo: string | null; local_nome: string; material: number; mao_obra: number; total: number; pct: number }
type Arvore = {
  orcamento_id: string; modo: 'eap' | 'local'
  total_geral: number; material_geral: number; mao_obra_geral: number
  nos: NoEap[] | NoLocal[]
}
type ObraInfo = { numero: string; nome: string | null; orcamento_id: string | null; area_construida_m2: number | null; company_id: string | null }
// §315 MODOS (perfil do Hub, fn_hub_perfil_obter): o modo filtra a NAVEGAÇÃO, nunca os dados.
// Prestadora: por padrão vê só as etapas do(s) ramo(s) dela (projetos_ref_ramo.eap_prefixos), com "ver todas".
// Pessoa física: versão simplificada — sem a separação material × mão de obra na tela (só o total).
type ModoHub = 'construtora' | 'prestadora' | 'escritorio' | 'pessoa_fisica'
// Prefixo do ramo: "14" casa 14 e 14.x; "=23" casa só o nó 23 (o agrupador, sem os filhos).
const casaPrefixo = (cod: string, p: string) => p.startsWith('=') ? cod === p.slice(1) : (cod === p || cod.startsWith(p + '.'))
// Ancestral de algum prefixo (ex.: "09" é pai de "09.01"): aparece para manter o caminho da árvore.
const ehAncestral = (cod: string, p: string) => (p.startsWith('=') ? p.slice(1) : p).startsWith(cod + '.')
// Serviço do catálogo da empresa (origem do custo do item)
type Servico = { id: string; codigo: string | null; nome: string; unidade: string | null; eap_codigo: string | null; custo_material: number | null; custo_mao_obra: number | null }
// Item individual do orçamento com complemento EAP (para editar/excluir) — fn_projetos_orcamento_item_eap_listar (#5814)
type ItemEap = { item_id: string; servico_id: string | null; servico_codigo: string | null; servico_descricao: string | null; unidade: string | null; eap_codigo: string; local_tipo: string | null; local_nome: string | null; quantidade: number; custo_material_unit: number | null; custo_mao_obra_unit: number | null; subtotal: number }
// §108 — orçamento candidato a ORIGEM da cópia (outro orçamento da MESMA empresa). fn_projetos_orcamento_copiar
// ADICIONA os itens da origem a este orçamento (não substitui) — a RPC exige mesma empresa (isolamento de tenant).
type OrcamentoOrigem = { id: string; numero: string | null; cliente_nome: string | null; total: number | null; status: string | null; data_emissao: string | null }
// Os 6 tipos de local (projetos_local_tipo). O LOCAL é dimensão do item, não nível da EAP.
const LOCAIS: { codigo: string; nome: string }[] = [
  { codigo: 'ambiente', nome: 'Ambiente / área comum' },
  { codigo: 'equipamento', nome: 'Equipamento' },
  { codigo: 'fachada', nome: 'Fachada' },
  { codigo: 'pavimento', nome: 'Pavimento' },
  { codigo: 'unidade', nome: 'Unidade autônoma' },
  { codigo: 'zona', nome: 'Zona / bloco' },
]

export default function OrcamentoEapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [obra, setObra] = useState<ObraInfo | null>(null)
  const [arvore, setArvore] = useState<Arvore | null>(null)
  const [porLocal, setPorLocal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  // nós recolhidos (chave = eap_codigo). Começa tudo expandido.
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set())
  // Itens individuais do orçamento (para editar/excluir). A árvore só devolve nós agregados por EAP.
  const [itens, setItens] = useState<ItemEap[]>([])
  const [excluindoId, setExcluindoId] = useState<string | null>(null)
  // Criar o orçamento da própria obra quando ela ainda não tem um (fluxo rápido deixa orcamento_id NULL).
  const [criandoOrc, setCriandoOrc] = useState(false)
  // Total cheio do orçamento e nº de itens vivos — para avisar quando a EAP é só uma fatia do orçamento.
  const [orcTotal, setOrcTotal] = useState<number | null>(null)
  const [orcStatus, setOrcStatus] = useState<string | null>(null)
  const [itensVivos, setItensVivos] = useState<number | null>(null)
  // "+ Item" / editar: catálogo de serviços e estado do formulário
  const [servicos, setServicos] = useState<Servico[]>([])
  const [formAberto, setFormAberto] = useState(false)
  const [editId, setEditId] = useState<string | null>(null) // null = novo item; preenchido = editando
  const [servicoId, setServicoId] = useState('')
  const [quantidade, setQuantidade] = useState('')
  const [localTipo, setLocalTipo] = useState('')
  const [localNome, setLocalNome] = useState('')
  const [custoMat, setCustoMat] = useState('')
  const [custoMo, setCustoMo] = useState('')
  const [eapOverride, setEapOverride] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erroForm, setErroForm] = useState<string | null>(null)
  const servicoSel = useMemo(() => servicos.find((s) => s.id === servicoId) ?? null, [servicos, servicoId])
  // §315 C-2: memorial descritivo e especificação técnica por item (RPCs fn_projetos_orcamento_item_eap_memorial_*).
  const [memoriais, setMemoriais] = useState<Record<string, { memorial: string; especificacao: string }>>({})
  const [memAberto, setMemAberto] = useState<string | null>(null)
  const [memForm, setMemForm] = useState<{ memorial: string; especificacao: string }>({ memorial: '', especificacao: '' })
  const [memSalvando, setMemSalvando] = useState(false)
  const [memErro, setMemErro] = useState<string | null>(null)
  // §315 (essencial): reserva do orçamento — "Riscos e imprevistos" e "Pós-obra" como % do custo (editável),
  // com projeção do custo total. Leitura por RLS (projetos_orcamento_reserva); escrita por RPC.
  const [reservaRiscos, setReservaRiscos] = useState('')
  const [reservaPos, setReservaPos] = useState('')
  const [reservaSalvando, setReservaSalvando] = useState(false)
  const [reservaErro, setReservaErro] = useState<string | null>(null)
  const [reservaMsg, setReservaMsg] = useState<string | null>(null)
  // §315 MODOS: modo do Hub da empresa e prefixos EAP do(s) ramo(s) da prestadora.
  const [modoHub, setModoHub] = useState<ModoHub>('construtora')
  const [prefixosRamo, setPrefixosRamo] = useState<string[]>([])
  const [soMeuRamo, setSoMeuRamo] = useState(true)
  // §108 "Copiar de outro orçamento": modal de seleção da origem (mesma empresa) + resultado da cópia.
  const [copiarAberto, setCopiarAberto] = useState(false)
  const [origens, setOrigens] = useState<OrcamentoOrigem[]>([])
  const [origensCarregando, setOrigensCarregando] = useState(false)
  const [origemSel, setOrigemSel] = useState('')
  const [copiando, setCopiando] = useState(false)
  const [erroCopiar, setErroCopiar] = useState<string | null>(null)
  const [avisoCopia, setAvisoCopia] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!ehUuid(id)) { setLoading(false); setErro('Obra não encontrada. Abra pela lista de obras.'); return }
    setLoading(true); setErro(null)
    const { data: od, error: oe } = await supabase.from('projetos_obras').select('numero,nome,orcamento_id,area_construida_m2,company_id').eq('id', id).maybeSingle()
    if (oe || !od) { setLoading(false); setErro(erroAmigavel(oe, 'Não foi possível carregar a obra.')); return }
    const info = od as ObraInfo
    setObra(info)
    if (!info.orcamento_id) { setLoading(false); setArvore(null); return }
    const { data, error } = await supabase.rpc('fn_projetos_orcamento_eap_arvore', { p_orcamento_id: info.orcamento_id, p_por_local: porLocal })
    setLoading(false)
    if (error || !data) { setErro(erroAmigavel(error, 'Não foi possível carregar o orçamento.')); return }
    setArvore(data as Arvore)
    // Lista dos itens individuais (com id) para editar/excluir.
    const { data: li } = await supabase.rpc('fn_projetos_orcamento_item_eap_listar', { p_orcamento_id: info.orcamento_id })
    setItens(((li as { itens?: ItemEap[] } | null)?.itens) ?? [])
    // §315: memorial descritivo / especificação técnica por item (colunas em projetos_orcamento_item_eap).
    const { data: mem } = await supabase.rpc('fn_projetos_orcamento_item_eap_memorial_listar', { p_orcamento_id: info.orcamento_id })
    const mapaMem: Record<string, { memorial: string; especificacao: string }> = {}
    for (const r of (mem as { orcamento_item_id: string; memorial_descritivo: string | null; especificacao_tecnica: string | null }[] | null) ?? []) {
      mapaMem[r.orcamento_item_id] = { memorial: r.memorial_descritivo ?? '', especificacao: r.especificacao_tecnica ?? '' }
    }
    setMemoriais(mapaMem)
    // §315: reserva (riscos/imprevistos e pós-obra) do orçamento — leitura por RLS (escrita por RPC).
    const { data: rsv } = await supabase.from('projetos_orcamento_reserva').select('riscos_pct,pos_obra_pct').eq('orcamento_id', info.orcamento_id).maybeSingle()
    const r = rsv as { riscos_pct?: number; pos_obra_pct?: number } | null
    setReservaRiscos(r?.riscos_pct != null && r.riscos_pct > 0 ? String(r.riscos_pct) : '')
    setReservaPos(r?.pos_obra_pct != null && r.pos_obra_pct > 0 ? String(r.pos_obra_pct) : '')
    setReservaMsg(null); setReservaErro(null)
    // Total cheio do orçamento e nº de itens vivos — para distinguir a fatia EAP do total do orçamento.
    const { data: orc } = await supabase.from('erp_orcamentos').select('total,status').eq('id', info.orcamento_id).maybeSingle()
    setOrcTotal((orc as { total?: number } | null)?.total ?? null)
    setOrcStatus((orc as { status?: string } | null)?.status ?? null)
    const { count } = await supabase.from('erp_orcamentos_itens').select('id', { count: 'exact', head: true }).eq('orcamento_id', info.orcamento_id).is('excluido_em', null)
    setItensVivos(count ?? null)
  }, [id, porLocal])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  // Catálogo de serviços da empresa (RLS filtra por empresa). Usado pelo "+ Item".
  const carregarServicos = useCallback(async () => {
    const { data } = await supabase.from('projetos_servicos')
      .select('id,codigo,nome,unidade,eap_codigo,custo_material,custo_mao_obra')
      .eq('ativo', true).is('deleted_at', null).order('codigo', { ascending: true })
    setServicos((data ?? []) as Servico[])
  }, [])
  useEffect(() => { void carregarServicos() }, [carregarServicos]) // eslint-disable-line react-hooks/set-state-in-effect

  // §315 MODOS: perfil do Hub da empresa da obra. Sem perfil = construtora (tudo como antes).
  const companyId = obra?.company_id ?? null
  const carregarPerfil = useCallback(async () => {
    if (!companyId) return
    const { data } = await supabase.rpc('fn_hub_perfil_obter', { p_company_id: companyId })
    const p = data as { modo?: ModoHub; ramos?: string[] } | null
    const modo: ModoHub = p?.modo ?? 'construtora'
    setModoHub(modo)
    const ramos = p?.ramos ?? []
    if (modo !== 'prestadora' || ramos.length === 0) { setPrefixosRamo([]); return }
    const { data: rr } = await supabase.from('projetos_ref_ramo').select('eap_prefixos').in('codigo', ramos)
    const pre = new Set<string>()
    for (const r of (rr as { eap_prefixos: string[] | null }[] | null) ?? []) for (const x of r.eap_prefixos ?? []) pre.add(x)
    setPrefixosRamo([...pre])
  }, [companyId])
  useEffect(() => { void carregarPerfil() }, [carregarPerfil]) // eslint-disable-line react-hooks/set-state-in-effect
  const filtroRamo = prefixosRamo.length > 0 && soMeuRamo
  const simples = modoHub === 'pessoa_fisica'
  const visivelNoRamo = useCallback((cod: string) => !filtroRamo || prefixosRamo.some((p) => casaPrefixo(cod, p) || ehAncestral(cod, p)), [filtroRamo, prefixosRamo])
  const itemDoRamo = useCallback((cod: string) => !filtroRamo || prefixosRamo.some((p) => casaPrefixo(cod, p)), [filtroRamo, prefixosRamo])

  // Ao escolher o serviço, o custo (material/MO) e a EAP vêm dele e podem ser editados antes de gravar.
  const escolherServico = (sid: string) => {
    setServicoId(sid)
    const s = servicos.find((x) => x.id === sid)
    setCustoMat(s?.custo_material != null ? String(s.custo_material) : '')
    setCustoMo(s?.custo_mao_obra != null ? String(s.custo_mao_obra) : '')
    setEapOverride('')
    setErroForm(null)
  }

  const fecharForm = () => {
    setFormAberto(false); setEditId(null); setServicoId(''); setQuantidade(''); setLocalTipo(''); setLocalNome('')
    setCustoMat(''); setCustoMo(''); setEapOverride(''); setErroForm(null)
  }

  // §315: abrir/salvar o memorial descritivo e a especificação técnica de um item da EAP.
  const abrirMemorial = (it: ItemEap) => {
    setMemAberto(it.item_id)
    setMemForm(memoriais[it.item_id] ?? { memorial: '', especificacao: '' })
    setMemErro(null)
  }
  const salvarMemorial = async (itemId: string) => {
    setMemSalvando(true); setMemErro(null)
    const { data, error } = await supabase.rpc('fn_projetos_orcamento_item_eap_memorial_salvar', {
      p_item_id: itemId, p_memorial: memForm.memorial, p_especificacao: memForm.especificacao,
    })
    setMemSalvando(false)
    const j = data as { ok?: boolean } | null
    if (error || !j?.ok) { setMemErro(erroAmigavel(error, 'Não foi possível salvar o memorial.')); return }
    setMemoriais((m) => ({ ...m, [itemId]: { memorial: memForm.memorial.trim(), especificacao: memForm.especificacao.trim() } }))
    setMemAberto(null)
  }

  // §315: salva a reserva (riscos/imprevistos e pós-obra) do orçamento pela RPC (guarda por empresa).
  const salvarReserva = async () => {
    if (!obra?.orcamento_id) return
    const risc = num(reservaRiscos) ?? 0
    const pos = num(reservaPos) ?? 0
    if (risc < 0 || risc > 100 || pos < 0 || pos > 100) { setReservaErro('Os percentuais devem ficar entre 0 e 100.'); return }
    setReservaSalvando(true); setReservaErro(null); setReservaMsg(null)
    const { data, error } = await supabase.rpc('fn_projetos_orcamento_reserva_salvar', {
      p_orcamento_id: obra.orcamento_id, p_riscos_pct: risc, p_pos_obra_pct: pos,
    })
    setReservaSalvando(false)
    const j = data as { ok?: boolean } | null
    if (error || !j?.ok) { setReservaErro(erroAmigavel(error, 'Não foi possível salvar a reserva.')); return }
    setReservaMsg('Reserva salva.')
  }

  // Abre o formulário em branco para um item novo.
  const abrirNovo = () => { fecharForm(); setFormAberto(true) }

  // Abre o formulário já preenchido com o item para EDITAR (reaproveita fn_..._salvar com p_item_id).
  const abrirEdicao = (it: ItemEap) => {
    setEditId(it.item_id)
    setServicoId(it.servico_id ?? '')
    setQuantidade(it.quantidade != null ? String(it.quantidade) : '')
    setLocalTipo(it.local_tipo ?? '')
    setLocalNome(it.local_nome ?? '')
    setCustoMat(it.custo_material_unit != null ? String(it.custo_material_unit) : '')
    setCustoMo(it.custo_mao_obra_unit != null ? String(it.custo_mao_obra_unit) : '')
    setEapOverride(it.eap_codigo ?? '')
    setErroForm(null)
    setFormAberto(true)
  }

  // Exclui o item por fn_projetos_orcamento_item_eap_excluir (#5814): apaga o complemento EAP
  // (sai da árvore) e marca o item compartilhado como excluído (recalcula o total). Com confirmação.
  const excluirItem = async (it: ItemEap) => {
    if (!obra?.orcamento_id) return
    const rot = `${it.servico_codigo ? it.servico_codigo + ' · ' : ''}${it.servico_descricao ?? 'item'}`
    if (!window.confirm(`Excluir "${rot}" do orçamento? Esta ação remove o item (com rastro) e recalcula o total.`)) return
    setExcluindoId(it.item_id); setErro(null)
    const { data, error } = await supabase.rpc('fn_projetos_orcamento_item_eap_excluir', { p_item_id: it.item_id, p_orcamento_id: obra.orcamento_id })
    setExcluindoId(null)
    const res = data as { ok?: boolean } | null
    if (error || (res && res.ok === false)) { setErro(erroAmigavel(error, 'Não foi possível excluir o item.')); return }
    await carregar()
  }

  // Cria e vincula um orçamento vazio para a obra que ainda não tem um (fluxo rápido de obra deixa orcamento_id NULL).
  // Idempotente no banco (fn_projetos_orcamento_garantir): se já houver, devolve o mesmo. Recarrega já com "+ Item"/Importar.
  const criarOrcamento = async () => {
    if (!obra || obra.orcamento_id) return
    setCriandoOrc(true); setErro(null)
    const { error } = await supabase.rpc('fn_projetos_orcamento_garantir', { p_obra_id: id })
    setCriandoOrc(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível criar o orçamento desta obra.')); return }
    await carregar()
  }

  // §108: abre o seletor e carrega os OUTROS orçamentos da mesma empresa (candidatos a origem da cópia).
  // Filtra por company_id da obra (a RPC só copia dentro da mesma empresa) e exclui o próprio destino. RLS reforça.
  const abrirCopiar = useCallback(async () => {
    setCopiarAberto(true); setErroCopiar(null); setOrigemSel(''); setAvisoCopia(null)
    if (!companyId || !obra?.orcamento_id) { setOrigens([]); return }
    setOrigensCarregando(true)
    const { data } = await supabase.from('erp_orcamentos')
      .select('id,numero,cliente_nome,total,status,data_emissao')
      .eq('company_id', companyId).neq('id', obra.orcamento_id)
      .order('data_emissao', { ascending: false, nullsFirst: false }).limit(200)
    setOrigens((data ?? []) as OrcamentoOrigem[])
    setOrigensCarregando(false)
  }, [companyId, obra?.orcamento_id])

  const fecharCopiar = () => { setCopiarAberto(false); setOrigemSel(''); setErroCopiar(null) }

  // §108: copia (ADICIONA) os itens do orçamento de origem para este, pela RPC fn_projetos_orcamento_copiar.
  const copiarOrcamento = async () => {
    if (!obra?.orcamento_id) return
    if (!origemSel) { setErroCopiar('Escolha o orçamento de origem.'); return }
    setCopiando(true); setErroCopiar(null)
    const { data, error } = await supabase.rpc('fn_projetos_orcamento_copiar', {
      p_orcamento_destino: obra.orcamento_id, p_orcamento_origem: origemSel,
    })
    setCopiando(false)
    const j = data as { ok?: boolean; itens_copiados?: number; eap_copiados?: number } | null
    if (error || !j?.ok) { setErroCopiar(erroAmigavel(error, 'Não foi possível copiar o orçamento.')); return }
    const n = j.itens_copiados ?? 0
    setCopiarAberto(false); setOrigemSel('')
    setAvisoCopia(`${n} ${n === 1 ? 'item copiado' : 'itens copiados'} para este orçamento.`)
    await carregar()
  }

  // Aceita tanto o formato pt-BR digitado ("1.234,56") quanto o formato de máquina do prefil ("1234.56").
  // Regra: se houver vírgula, o ponto é separador de milhar; sem vírgula, um ponto é a casa decimal.
  const num = (s: string): number | null => {
    let v = s.trim()
    if (v === '') return null
    if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.')
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  const salvarItem = async () => {
    if (!obra?.orcamento_id) return
    if (!servicoId) { setErroForm('Escolha o serviço do catálogo.'); return }
    const qtd = num(quantidade)
    if (qtd == null || qtd <= 0) { setErroForm('Informe a quantidade (maior que zero).'); return }
    const eapEfetiva = eapOverride.trim() || (servicoSel?.eap_codigo ?? '').trim()
    if (!eapEfetiva) { setErroForm('Este serviço não tem código de EAP. Informe o código da EAP.'); return }
    const mat = num(custoMat), mo = num(custoMo)
    if ((mat != null && mat < 0) || (mo != null && mo < 0)) { setErroForm('Os custos não podem ser negativos.'); return }
    setSalvando(true); setErroForm(null)
    const { error } = await supabase.rpc('fn_projetos_orcamento_item_eap_salvar', {
      p_orcamento_id: obra.orcamento_id,
      p_servico_id: servicoId,
      p_quantidade: qtd,
      p_local_tipo: localTipo || null,
      p_local_nome: localNome.trim() || null,
      p_eap_codigo: eapOverride.trim() || null,
      p_custo_material_unit: mat,
      p_custo_mao_obra_unit: mo,
      p_item_id: editId,
    })
    setSalvando(false)
    if (error) { setErroForm(erroAmigavel(error, editId ? 'Não foi possível salvar o item.' : 'Não foi possível adicionar o item.')); return }
    fecharForm()
    await carregar()
  }

  // modo EAP: monta a árvore a partir da lista achatada (parent_codigo → filhos)
  const filhosPorPai = useMemo(() => {
    const m = new Map<string | null, NoEap[]>()
    if (arvore?.modo === 'eap') {
      for (const n of arvore.nos as NoEap[]) {
        const k = n.parent_codigo
        if (!m.has(k)) m.set(k, [])
        m.get(k)!.push(n)
      }
      for (const arr of m.values()) arr.sort((a, b) => a.eap_codigo.localeCompare(b.eap_codigo, undefined, { numeric: true }))
    }
    return m
  }, [arvore])

  const alternar = (cod: string) => setRecolhidos((s) => { const n = new Set(s); if (n.has(cod)) n.delete(cod); else n.add(cod); return n })

  const barra = (p: number) => (
    <div style={{ height: 5, borderRadius: 3, background: LINE, overflow: 'hidden', minWidth: 48, flex: '0 0 48px' }}>
      <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, p))}%`, background: GOLD }} />
    </div>
  )

  const linhaNo = (n: NoEap) => {
    const filhos = (filhosPorPai.get(n.eap_codigo) ?? []).filter((f) => visivelNoRamo(f.eap_codigo))
    const temFilhos = filhos.length > 0
    const aberto = !recolhidos.has(n.eap_codigo)
    const recuo = (n.nivel - 1) * 16
    return (
      <div key={n.eap_codigo}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: `1px solid ${LINE}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, paddingLeft: recuo }}>
            {temFilhos ? (
              <button data-testid={`orc-toggle-${n.eap_codigo}`} aria-label={aberto ? 'Recolher' : 'Expandir'} onClick={() => alternar(n.eap_codigo)}
                style={{ border: 'none', background: 'transparent', color: GOLD, fontSize: 12, fontWeight: 700, cursor: 'pointer', width: 16 }}>{aberto ? '▾' : '▸'}</button>
            ) : <span style={{ width: 16, color: MUT, textAlign: 'center' }}>•</span>}
            <span style={{ fontSize: 11, color: MUT, fontFamily: 'ui-monospace, monospace', flex: '0 0 auto' }}>{n.eap_codigo}</span>
            <div style={{ minWidth: 0, overflow: 'hidden' }}>
              <div style={{ fontSize: 14, color: ESP, fontWeight: n.nivel <= 1 ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.nome}</div>
              {/* §315 C-2: material × mão de obra separados também por nó da EAP (não só no total geral). */}
              {!simples && (n.material > 0 || n.mao_obra > 0) && (
                <div style={{ fontSize: 11, color: MUT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Material {brl(n.material)} · Mão de obra {brl(n.mao_obra)}
                </div>
              )}
            </div>
          </div>
          <span style={{ fontSize: 13, color: ESP, fontWeight: 600, flex: '0 0 auto', textAlign: 'right' }}>{brl(n.total)}</span>
          {barra(n.pct)}
          <span style={{ fontSize: 11, color: MUT, flex: '0 0 44px', textAlign: 'right' }}>{pct(n.pct)}</span>
        </div>
        {temFilhos && aberto && filhos.map((f) => linhaNo(f))}
      </div>
    )
  }

  const raizes = arvore?.modo === 'eap' ? (filhosPorPai.get(null) ?? []).filter((n) => visivelNoRamo(n.eap_codigo)) : []
  // Itens visíveis: no filtro do ramo, só os itens cujo código EAP é do ramo da prestadora.
  const itensVis = itens.filter((it) => itemDoRamo(it.eap_codigo))
  const locais = arvore?.modo === 'local' ? (arvore.nos as NoLocal[]) : []
  // Sem nós na EAP: pode ser orçamento REALMENTE vazio (0 itens) OU orçamento COM itens, porém nenhum
  // estruturado pela EAP ainda. São estados diferentes — não dizer "ainda não tem itens" quando há itens.
  const semArvoreEap = arvore != null && arvore.nos.length === 0
  const itensSemEap = !!obra?.orcamento_id && semArvoreEap && (itensVivos ?? 0) > 0
  const vazio = !!obra && (!obra.orcamento_id || semArvoreEap)

  const chip = (ativo: boolean) => ({
    padding: '7px 14px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer' as const,
    border: `1px solid ${ativo ? ESP : LINE}`, background: ativo ? ESP : '#fff', color: ativo ? '#fff' : MUT,
  })
  const campo: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 8, border: `1px solid ${LINE}`, fontSize: 14, color: ESP, background: '#fff' }
  const rotuloCampo: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, fontWeight: 700, marginBottom: 4 }
  const unid = servicoSel?.unidade ? ` (${servicoSel.unidade})` : ''
  // Subtotal previsto do item que está sendo lançado (material + mão de obra) × quantidade.
  const subtotalPrevia = (() => {
    const q = num(quantidade) ?? 0
    const m = num(custoMat) ?? (servicoSel?.custo_material ?? 0)
    const o = num(custoMo) ?? (servicoSel?.custo_mao_obra ?? 0)
    return q * (m + o)
  })()

  // Importador de orçamento por planilha (.xlsx) — tela 334. Porta de entrada visível (RD-98 p1/RD-99):
  // sem este link o usuário só chegaria ao importador digitando a URL.
  const importarHref = `/dashboard/projetos/obras/${id}/orcamento/importar`

  const painelAdd = !loading && obra && obra.orcamento_id ? (
    <div style={{ marginBottom: 14 }}>
      {avisoCopia && !formAberto && (
        <div role="status" data-testid="orc-copiar-aviso" style={{ background: '#E8F3EC', color: '#166534', border: '0.5px solid #B7DCC4', borderRadius: 10, padding: '9px 14px', fontSize: 13, marginBottom: 10 }}>
          {avisoCopia}
        </div>
      )}
      {!formAberto ? (
        <>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button data-testid="orc-add-abrir" onClick={abrirNovo}
            style={{ padding: '9px 16px', borderRadius: 999, border: `1px solid ${ESP}`, background: ESP, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + Item
          </button>
          <Link href={importarHref} data-testid="orc-importar-link"
            style={{ padding: '9px 16px', borderRadius: 999, border: `1px solid ${ESP}`, background: '#fff', color: ESP, fontSize: 13, fontWeight: 700, cursor: 'pointer', textDecoration: 'none' }}>
            Importar da planilha (.xlsx)
          </Link>
          <button data-testid="orc-copiar-abrir" onClick={() => void abrirCopiar()}
            style={{ padding: '9px 16px', borderRadius: 999, border: `1px solid ${ESP}`, background: '#fff', color: ESP, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Copiar de outro orçamento
          </button>
          <Link href={`/dashboard/projetos/obras/${id}/orcamento/relatorios`} data-testid="orc-relatorios-link"
            style={{ padding: '9px 16px', borderRadius: 999, border: `1px solid ${LINE}`, background: '#fff', color: ESP, fontSize: 13, fontWeight: 700, cursor: 'pointer', textDecoration: 'none' }}>
            Relatórios
          </Link>
        </div>
        {copiarAberto && (
          <div data-testid="orc-copiar-form" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, display: 'grid', gap: 12, marginTop: 12 }}>
            <div style={{ fontSize: 15, color: ESP, fontWeight: 700 }}>Copiar itens de outro orçamento</div>
            <div style={{ fontSize: 13, color: MUT, lineHeight: 1.5 }}>
              Os itens do orçamento escolhido são <strong>adicionados</strong> a este (não substituem os que já existem). Só orçamentos da mesma empresa.
            </div>
            {erroCopiar && <div role="alert" data-testid="orc-copiar-erro" style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: 9, fontSize: 13 }}>{erroCopiar}</div>}
            <label style={{ display: 'block' }}>
              <span style={rotuloCampo}>Orçamento de origem <AjudaCampo chave="projetos.orcamento_eap.copiar_origem" rota={ROTA} /></span>
              <select data-testid="orc-copiar-origem" value={origemSel} onChange={(e) => { setOrigemSel(e.target.value); setErroCopiar(null) }} disabled={origensCarregando} style={campo}>
                <option value="">{origensCarregando ? 'Carregando orçamentos…' : 'Escolha o orçamento de origem…'}</option>
                {origens.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.numero ? `Nº ${o.numero} · ` : ''}{o.cliente_nome ?? 'Sem cliente'} · {brl(o.total)}{o.status ? ` · ${SITUACAO[o.status]?.rotulo ?? o.status}` : ''}
                  </option>
                ))}
              </select>
              {!origensCarregando && origens.length === 0 && (
                <div style={{ fontSize: 12, color: MUT, marginTop: 4 }}>Nenhum outro orçamento desta empresa para copiar.</div>
              )}
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button data-testid="orc-copiar-cancelar" onClick={fecharCopiar} disabled={copiando}
                style={{ padding: '9px 16px', borderRadius: 999, border: `1px solid ${LINE}`, background: '#fff', color: MUT, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
              <button data-testid="orc-copiar-confirmar" onClick={() => void copiarOrcamento()} disabled={copiando || !origemSel}
                style={{ padding: '9px 16px', borderRadius: 999, border: `1px solid ${ESP}`, background: (copiando || !origemSel) ? MUT : ESP, color: '#fff', fontSize: 13, fontWeight: 700, cursor: (copiando || !origemSel) ? 'default' : 'pointer' }}>
                {copiando ? 'Copiando…' : 'Copiar itens'}
              </button>
            </div>
          </div>
        )}
        </>
      ) : (
        <div data-testid="orc-add-form" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 15, color: ESP, fontWeight: 700 }}>{editId ? 'Editar item do orçamento' : 'Adicionar item ao orçamento'}</div>
          {erroForm && <div role="alert" data-testid="orc-add-erro" style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: 9, fontSize: 13 }}>{erroForm}</div>}
          <label style={{ display: 'block' }}>
            <span style={rotuloCampo}>Serviço <AjudaCampo chave="projetos.orcamento_eap.item_servico" rota={ROTA} /></span>
            <select data-testid="orc-add-servico" value={servicoId} onChange={(e) => escolherServico(e.target.value)} style={campo}>
              <option value="">Escolha o serviço do catálogo…</option>
              {servicos.map((s) => (
                <option key={s.id} value={s.id}>{s.codigo ? `${s.codigo} · ` : ''}{s.nome}{s.unidade ? ` (${s.unidade})` : ''}</option>
              ))}
            </select>
            {servicos.length === 0 && (
              <div style={{ fontSize: 12, color: MUT, marginTop: 4 }}>
                Nenhum serviço no catálogo da empresa.{' '}
                <Link href="/dashboard/projetos/catalogo?aba=biblioteca" data-testid="orc-add-sem-servico-biblioteca" style={{ color: GOLD, fontWeight: 600, textDecoration: 'underline' }}>Escolha serviços prontos na Biblioteca padrão PS</Link>{' '}ou cadastre o seu no Catálogo para montar o orçamento.
              </div>
            )}
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <label style={{ display: 'block' }}>
              <span style={rotuloCampo}>Quantidade{unid} <AjudaCampo chave="projetos.orcamento_eap.item_quantidade" rota={ROTA} /></span>
              <input data-testid="orc-add-qtd" inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} placeholder="0" style={campo} />
            </label>
            <label style={{ display: 'block' }}>
              <span style={rotuloCampo}>Custo material (unit.) <AjudaCampo chave="projetos.orcamento_eap.item_custo_material" rota={ROTA} /></span>
              <input data-testid="orc-add-mat" inputMode="decimal" value={custoMat} onChange={(e) => setCustoMat(e.target.value)} placeholder="0,00" style={campo} />
            </label>
            <label style={{ display: 'block' }}>
              <span style={rotuloCampo}>Custo mão de obra (unit.) <AjudaCampo chave="projetos.orcamento_eap.item_custo_mao_obra" rota={ROTA} /></span>
              <input data-testid="orc-add-mo" inputMode="decimal" value={custoMo} onChange={(e) => setCustoMo(e.target.value)} placeholder="0,00" style={campo} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <label style={{ display: 'block' }}>
              <span style={rotuloCampo}>Local <AjudaCampo chave="projetos.orcamento_eap.item_local_tipo" rota={ROTA} /></span>
              <select data-testid="orc-add-local-tipo" value={localTipo} onChange={(e) => setLocalTipo(e.target.value)} style={campo}>
                <option value="">Sem local específico</option>
                {LOCAIS.map((l) => <option key={l.codigo} value={l.codigo}>{l.nome}</option>)}
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <span style={rotuloCampo}>Nome do local <AjudaCampo chave="projetos.orcamento_eap.item_local_nome" rota={ROTA} /></span>
              <input data-testid="orc-add-local-nome" value={localNome} onChange={(e) => setLocalNome(e.target.value)} placeholder="Ex.: Térreo, Bloco A, Unid. 101" style={campo} />
            </label>
            <label style={{ display: 'block' }}>
              <span style={rotuloCampo}>Código EAP <AjudaCampo chave="projetos.orcamento_eap.item_eap" rota={ROTA} /></span>
              <input data-testid="orc-add-eap" value={eapOverride} onChange={(e) => setEapOverride(e.target.value)} placeholder={servicoSel?.eap_codigo ?? 'Ex.: 08.03'} style={campo} />
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ fontSize: 13, color: MUT }}>Subtotal previsto: <strong style={{ color: ESP }}>{brl(subtotalPrevia)}</strong></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button data-testid="orc-add-cancelar" onClick={fecharForm} disabled={salvando}
                style={{ padding: '9px 16px', borderRadius: 999, border: `1px solid ${LINE}`, background: '#fff', color: MUT, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
              <button data-testid="orc-add-salvar" onClick={() => void salvarItem()} disabled={salvando}
                style={{ padding: '9px 16px', borderRadius: 999, border: `1px solid ${ESP}`, background: salvando ? MUT : ESP, color: '#fff', fontSize: 13, fontWeight: 700, cursor: salvando ? 'default' : 'pointer' }}>
                {salvando ? 'Salvando…' : editId ? 'Salvar alterações' : 'Adicionar item'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  ) : null

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }} data-testid="hub-obra-orcamento">
        <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Cockpit da obra</Link>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 8 }}>Hub · Obra{obra ? ` · ${obra.numero}` : ''}</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: ESP, margin: '2px 0 4px' }}>Orçamento por EAP</h1>
        <div style={{ fontSize: 13, color: MUT, marginBottom: 14 }}>O custo da obra estruturado pela EAP (serviço × local), com material e mão de obra separados. Veja o total e o peso de cada etapa.</div>

        {erro && <div role="alert" data-testid="orc-erro" style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 12 }}>{erro}</div>}

        {painelAdd}

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div> : vazio ? (
          <div data-testid="orc-vazio" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 15, color: ESP, fontWeight: 600, marginBottom: 6 }}>
              {itensSemEap ? 'Orçamento com itens — ainda sem EAP' : 'Orçamento ainda sem itens'}
            </div>
            <div style={{ fontSize: 13, color: MUT, lineHeight: 1.5 }}>
              {obra && !obra.orcamento_id ? (
                'Esta obra ainda não tem um orçamento vinculado. Crie o orçamento aqui e comece a montar a EAP sem sair da tela.'
              ) : itensSemEap ? (
                <>Este orçamento já tem <strong>{itensVivos} {itensVivos === 1 ? 'item' : 'itens'}</strong>{orcTotal != null && orcTotal > 0 ? <> somando <strong>{brl(orcTotal)}</strong></> : null}, mas <strong>nenhum está estruturado pela EAP</strong> ainda. Organize-os por etapa e local com o <em>+ Item</em>, importando a planilha da obra, ou partindo da Biblioteca padrão PS.</>
              ) : (
                'O orçamento está vinculado, mas ainda não tem itens. Adicione serviços um a um por etapa e local, ou importe a planilha da obra de uma vez pelo importador.'
              )}
            </div>
            {obra && !obra.orcamento_id && (
              <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button data-testid="orc-vazio-criar" onClick={() => void criarOrcamento()} disabled={criandoOrc}
                  style={{ padding: '9px 16px', borderRadius: 999, border: `1px solid ${ESP}`, background: criandoOrc ? MUT : ESP, color: '#fff', fontSize: 13, fontWeight: 700, cursor: criandoOrc ? 'default' : 'pointer' }}>
                  {criandoOrc ? 'Criando…' : 'Criar orçamento desta obra'}
                </button>
                <AjudaCampo chave="projetos.orcamento_eap.criar_orcamento" rota={ROTA} />
              </div>
            )}
            {obra?.orcamento_id && (
              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button data-testid="orc-vazio-add" onClick={abrirNovo}
                  style={{ padding: '9px 16px', borderRadius: 999, border: `1px solid ${ESP}`, background: ESP, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  + Item
                </button>
                <Link href={importarHref} data-testid="orc-vazio-importar"
                  style={{ padding: '9px 16px', borderRadius: 999, border: `1px solid ${ESP}`, background: '#fff', color: ESP, fontSize: 13, fontWeight: 700, cursor: 'pointer', textDecoration: 'none' }}>
                  Importar da planilha (.xlsx)
                </Link>
                {/* §315 "três jeitos de começar o orçamento" (1): partir da Biblioteca padrão PS (333). */}
                <Link href="/dashboard/projetos/catalogo?aba=biblioteca" data-testid="orc-vazio-biblioteca"
                  style={{ padding: '9px 16px', borderRadius: 999, border: `1px solid ${LINE}`, background: '#fff', color: ESP, fontSize: 13, fontWeight: 700, cursor: 'pointer', textDecoration: 'none' }}>
                  Começar pela Biblioteca padrão PS
                </Link>
                <AjudaCampo chave="projetos.orcamento_eap.comecar_biblioteca" rota={ROTA} />
              </div>
            )}
          </div>
        ) : arvore && (
          <div style={{ display: 'grid', gap: 14 }}>
            {/* Totais do orçamento */}
            <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, display: 'flex', flexWrap: 'wrap', gap: 20 }}>
              {/* Situação do orçamento (§315 essencial) — só leitura; o estado muda no fluxo do orçamento. */}
              {orcStatus != null && (
                <div data-testid="orc-situacao">
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700 }}>Situação <AjudaCampo chave="projetos.orcamento_eap.situacao" rota={ROTA} /></div>
                  <div style={{ marginTop: 2 }}>
                    <span style={{ display: 'inline-block', padding: '3px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, color: (SITUACAO[orcStatus] ?? { cor: ESP }).cor, background: (SITUACAO[orcStatus] ?? { bg: '#F3EEE7' }).bg }}>
                      {(SITUACAO[orcStatus]?.rotulo) ?? orcStatus}
                    </span>
                  </div>
                </div>
              )}
              <div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700 }}>Total estruturado (EAP) <AjudaCampo chave="projetos.orcamento_eap.total" rota={ROTA} /></div>
                <div style={{ fontSize: 22, color: ESP, fontWeight: 700 }}>{brl(arvore.total_geral)}</div>
              </div>
              {/* §315 MODOS: pessoa física vê a versão simples (só o total, sem material × mão de obra). */}
              {!simples && (<>
              <div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700 }}>Material <AjudaCampo chave="projetos.orcamento_eap.material" rota={ROTA} /></div>
                <div style={{ fontSize: 18, color: ESP, fontWeight: 600 }}>{brl(arvore.material_geral)}{arvore.total_geral > 0 && <span style={{ fontSize: 12, color: MUT, fontWeight: 500 }}> · {pct((arvore.material_geral / arvore.total_geral) * 100)} do total</span>}</div>
              </div>
              <div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700 }}>Mão de obra <AjudaCampo chave="projetos.orcamento_eap.mao_obra" rota={ROTA} /></div>
                <div style={{ fontSize: 18, color: ESP, fontWeight: 600 }}>{brl(arvore.mao_obra_geral)}{arvore.total_geral > 0 && <span style={{ fontSize: 12, color: MUT, fontWeight: 500 }}> · {pct((arvore.mao_obra_geral / arvore.total_geral) * 100)} do total</span>}</div>
              </div>
              </>)}
              {/* KPI Custo por m² (blueprint §315 essencial): total estruturado ÷ área construída da obra. */}
              {obra?.area_construida_m2 != null && obra.area_construida_m2 > 0 && (
                <div data-testid="orc-custo-m2">
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700 }}>Custo por m² <AjudaCampo chave="projetos.orcamento_eap.custo_m2" rota={ROTA} /></div>
                  <div style={{ fontSize: 18, color: ESP, fontWeight: 600 }}>{brl(arvore.total_geral / obra.area_construida_m2)}<span style={{ fontSize: 12, color: MUT, fontWeight: 500 }}> /m²</span></div>
                  <div style={{ fontSize: 11, color: MUT }}>{obra.area_construida_m2.toLocaleString('pt-BR')} m² construídos</div>
                </div>
              )}
            </div>

            {/* §315 (essencial): Reserva e projeção do custo — riscos/imprevistos e pós-obra como % do custo da EAP. */}
            {(() => {
              const base = arvore.total_geral
              const valRiscos = base * ((num(reservaRiscos) ?? 0) / 100)
              const valPos = base * ((num(reservaPos) ?? 0) / 100)
              const totalProjetado = base + valRiscos + valPos
              return (
                <div data-testid="orc-reserva" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, display: 'grid', gap: 12 }}>
                  <div style={{ fontSize: 15, color: ESP, fontWeight: 700 }}>Reserva e projeção do custo</div>
                  {reservaErro && <div role="alert" data-testid="orc-reserva-erro" style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: 9, fontSize: 13 }}>{reservaErro}</div>}
                  {reservaMsg && <div data-testid="orc-reserva-ok" style={{ background: '#E8F3EC', color: '#166534', borderRadius: 8, padding: 9, fontSize: 13 }}>{reservaMsg}</div>}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                    <label style={{ display: 'block' }}>
                      <span style={rotuloCampo}>Riscos e imprevistos (%) <AjudaCampo chave="projetos.orcamento_eap.reserva_riscos" rota={ROTA} /></span>
                      <input data-testid="orc-reserva-riscos" inputMode="decimal" value={reservaRiscos} onChange={(e) => { setReservaRiscos(e.target.value); setReservaMsg(null) }} placeholder="0" style={campo} />
                      <div style={{ fontSize: 12, color: MUT, marginTop: 4 }}>{brl(valRiscos)}</div>
                    </label>
                    <label style={{ display: 'block' }}>
                      <span style={rotuloCampo}>Pós-obra (%) <AjudaCampo chave="projetos.orcamento_eap.reserva_pos_obra" rota={ROTA} /></span>
                      <input data-testid="orc-reserva-pos" inputMode="decimal" value={reservaPos} onChange={(e) => { setReservaPos(e.target.value); setReservaMsg(null) }} placeholder="0" style={campo} />
                      <div style={{ fontSize: 12, color: MUT, marginTop: 4 }}>{brl(valPos)}</div>
                    </label>
                    <div>
                      <span style={rotuloCampo}>Custo total projetado <AjudaCampo chave="projetos.orcamento_eap.total_projetado" rota={ROTA} /></span>
                      <div data-testid="orc-reserva-total" style={{ fontSize: 20, color: ESP, fontWeight: 700 }}>{brl(totalProjetado)}</div>
                      <div style={{ fontSize: 11, color: MUT }}>Custo EAP {brl(base)} + reservas</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button data-testid="orc-reserva-salvar" onClick={() => void salvarReserva()} disabled={reservaSalvando}
                      style={{ padding: '9px 16px', borderRadius: 999, border: `1px solid ${ESP}`, background: reservaSalvando ? MUT : ESP, color: '#fff', fontSize: 13, fontWeight: 700, cursor: reservaSalvando ? 'default' : 'pointer' }}>
                      {reservaSalvando ? 'Salvando…' : 'Salvar reserva'}
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* Aviso quando a EAP é só uma fatia do orçamento: há itens no orçamento sem complemento EAP. */}
            {orcTotal != null && orcTotal - arvore.total_geral > 0.005 && (
              <div data-testid="orc-aviso-fatia" style={{ background: '#FBF3E0', border: `0.5px solid ${GOLD}`, borderRadius: 10, padding: '10px 14px', fontSize: 13, color: ESP, lineHeight: 1.5 }}>
                Este é o total <strong>estruturado pela EAP</strong> ({brl(arvore.total_geral)}
                {itensVivos != null ? ` · ${itens.length} de ${itensVivos} ${itensVivos === 1 ? 'item' : 'itens'}` : ''}). O orçamento tem mais <strong>{brl(orcTotal - arvore.total_geral)}</strong> em itens ainda <strong>sem EAP</strong> — use o <em>+ Item</em> ou o importador para estruturá-los e fechar o orçamento pela EAP.
              </div>
            )}

            {/* Toggle Etapa / Local */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: MUT, fontWeight: 600 }}>Agrupar por</span>
              <button data-testid="orc-modo-eap" onClick={() => setPorLocal(false)} style={chip(!porLocal)}>Etapa (EAP)</button>
              <button data-testid="orc-modo-local" onClick={() => setPorLocal(true)} style={chip(porLocal)}>Local</button>
              <AjudaCampo chave="projetos.orcamento_eap.agrupar" rota={ROTA} />
            </div>

            {/* §315 MODOS · prestadora: por padrão só as etapas do ramo dela; "Todas as etapas" mostra o orçamento inteiro. */}
            {prefixosRamo.length > 0 && arvore.modo === 'eap' && (
              <div data-testid="orc-filtro-ramo" data-ajuda="projetos.orcamento_eap.filtro_ramo" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: MUT, fontWeight: 600 }}>Mostrar</span>
                <button data-testid="orc-filtro-ramo-meu" onClick={() => setSoMeuRamo(true)} style={chip(soMeuRamo)}>Só o meu ramo</button>
                <button data-testid="orc-filtro-ramo-todas" onClick={() => setSoMeuRamo(false)} style={chip(!soMeuRamo)}>Todas as etapas</button>
                <AjudaCampo chave="projetos.orcamento_eap.filtro_ramo" rota={ROTA} />
              </div>
            )}
            {filtroRamo && arvore.modo === 'eap' && raizes.length === 0 && (
              <div data-testid="orc-filtro-ramo-vazio" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, fontSize: 13, color: ESP, lineHeight: 1.5 }}>
                Nenhuma etapa deste orçamento é do seu ramo ainda. Adicione o seu serviço com o <em>+ Item</em> ou veja o orçamento inteiro.{' '}
                <button data-testid="orc-filtro-ramo-vazio-todas" onClick={() => setSoMeuRamo(false)}
                  style={{ marginLeft: 4, padding: '6px 12px', borderRadius: 999, border: `1px solid ${ESP}`, background: '#fff', color: ESP, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Ver todas as etapas</button>
              </div>
            )}

            {/* Árvore / lista */}
            <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: '4px 16px 12px' }} data-testid="orc-arvore">
              {arvore.modo === 'eap'
                ? raizes.map((n) => linhaNo(n))
                : locais.map((l, i) => (
                  <div key={`${l.local_tipo ?? 'x'}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: `1px solid ${LINE}` }}>
                    {/* §315 C-2: material × mão de obra também no agrupamento por Local, igual ao nó da EAP. */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: ESP, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.local_nome}</div>
                      {!simples && (l.material > 0 || l.mao_obra > 0) && (
                        <div style={{ fontSize: 11, color: MUT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          Material {brl(l.material)} · Mão de obra {brl(l.mao_obra)}
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: 13, color: ESP, fontWeight: 600, flex: '0 0 auto', textAlign: 'right' }}>{brl(l.total)}</span>
                    {barra(l.pct)}
                    <span style={{ fontSize: 11, color: MUT, flex: '0 0 44px', textAlign: 'right' }}>{pct(l.pct)}</span>
                  </div>
                ))}
            </div>

            {/* Itens do orçamento — incluir (acima) / editar / excluir (RD-98 p2). Lista achatada com id. */}
            {itensVis.length > 0 && (
              <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: '14px 16px' }} data-testid="orc-itens">
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700, marginBottom: 10 }}>
                  Itens do orçamento <AjudaCampo chave="projetos.orcamento_eap.itens" rota={ROTA} />
                </div>
                {itensVis.map((it) => {
                  const loc = it.local_nome ? ` · ${it.local_nome}` : ''
                  const un = it.unidade ? ` ${it.unidade}` : ''
                  const excluindo = excluindoId === it.item_id
                  // §315 C-2: material × mão de obra separados também no item (não só no nó da EAP).
                  // Dados já vêm da listagem (custo unitário × quantidade) — sem nova chamada.
                  const q = it.quantidade ?? 0
                  const matTot = (it.custo_material_unit ?? 0) * q
                  const moTot = (it.custo_mao_obra_unit ?? 0) * q
                  const mem = memoriais[it.item_id]
                  const temMem = !!(mem && (mem.memorial || mem.especificacao))
                  const memOpen = memAberto === it.item_id
                  return (
                    <div key={it.item_id} style={{ borderBottom: `1px solid ${LINE}` }}>
                    <div data-testid={`orc-item-${it.item_id}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <div style={{ fontSize: 14, color: ESP, fontWeight: 500 }}>{it.servico_codigo ? `${it.servico_codigo} · ` : ''}{it.servico_descricao ?? 'Serviço'}</div>
                        <div style={{ fontSize: 11, color: MUT, fontFamily: 'ui-monospace, monospace' }}>
                          EAP {it.eap_codigo}{loc} · {(it.quantidade ?? 0).toLocaleString('pt-BR')}{un}
                        </div>
                        {!simples && (matTot > 0 || moTot > 0) && (
                          <div data-testid={`orc-item-split-${it.item_id}`} style={{ fontSize: 11, color: MUT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            Material {brl(matTot)} · Mão de obra {brl(moTot)}
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: 13, color: ESP, fontWeight: 600, textAlign: 'right' }}>{brl(it.subtotal)}</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button data-testid={`orc-item-editar-${it.item_id}`} onClick={() => abrirEdicao(it)} disabled={excluindo}
                          style={{ padding: '6px 12px', borderRadius: 999, border: `1px solid ${LINE}`, background: '#fff', color: ESP, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Editar</button>
                        <button data-testid={`orc-item-excluir-${it.item_id}`} onClick={() => void excluirItem(it)} disabled={excluindo}
                          style={{ padding: '6px 12px', borderRadius: 999, border: `1px solid ${VERM}`, background: '#fff', color: VERM, fontSize: 12, fontWeight: 700, cursor: excluindo ? 'default' : 'pointer' }}>{excluindo ? 'Excluindo…' : 'Excluir'}</button>
                        <button data-testid={`orc-item-memorial-${it.item_id}`} onClick={() => (memOpen ? setMemAberto(null) : abrirMemorial(it))}
                          style={{ padding: '6px 12px', borderRadius: 999, border: `1px solid ${temMem ? GOLD : LINE}`, background: temMem ? '#FBF3E0' : '#fff', color: temMem ? GOLD : ESP, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{temMem ? '✓ Memorial' : 'Memorial'}</button>
                      </div>
                    </div>
                    {memOpen && (
                      <div data-testid={`orc-item-memorial-form-${it.item_id}`} style={{ padding: '2px 0 14px', display: 'grid', gap: 10 }}>
                        {memErro && <div role="alert" style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: 8, fontSize: 12 }}>{memErro}</div>}
                        <div data-ajuda="projetos.orcamento_eap.item_memorial">
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700, marginBottom: 4 }}>Memorial descritivo <AjudaCampo chave="projetos.orcamento_eap.item_memorial" rota={ROTA} /></div>
                          <textarea data-testid={`orc-item-memorial-texto-${it.item_id}`} value={memForm.memorial} onChange={(e) => setMemForm({ ...memForm, memorial: e.target.value })} rows={3}
                            placeholder="O que será executado neste serviço: método, etapas e acabamento." style={{ ...campo, resize: 'vertical' }} />
                        </div>
                        <div data-ajuda="projetos.orcamento_eap.item_especificacao">
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700, marginBottom: 4 }}>Especificação técnica <AjudaCampo chave="projetos.orcamento_eap.item_especificacao" rota={ROTA} /></div>
                          <textarea data-testid={`orc-item-especificacao-texto-${it.item_id}`} value={memForm.especificacao} onChange={(e) => setMemForm({ ...memForm, especificacao: e.target.value })} rows={3}
                            placeholder="Materiais, normas técnicas (ex.: ABNT NBR), traço, resistência e referências." style={{ ...campo, resize: 'vertical' }} />
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button data-testid={`orc-item-memorial-salvar-${it.item_id}`} onClick={() => void salvarMemorial(it.item_id)} disabled={memSalvando}
                            style={{ padding: '6px 14px', borderRadius: 999, border: 'none', background: ESP, color: '#fff', fontSize: 12, fontWeight: 700, cursor: memSalvando ? 'default' : 'pointer' }}>{memSalvando ? 'Salvando…' : 'Salvar'}</button>
                          <button onClick={() => setMemAberto(null)} disabled={memSalvando}
                            style={{ padding: '6px 14px', borderRadius: 999, border: `1px solid ${LINE}`, background: '#fff', color: MUT, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
                        </div>
                      </div>
                    )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
