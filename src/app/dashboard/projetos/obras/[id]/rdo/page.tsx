'use client'
// HBF-4.2 · Diário de Obra (RDO) — tela dedicada por obra (Livro de Ordem, CONFEA 1.094/2017).
// Histórico diário da obra (todas as OS), novo/editar o diário do dia por OS e exclusão rastreável.
// Backend já existente: fn_obra_rdo_salvar (upsert por OS+dia) e fn_obra_rdo_excluir (soft-delete + audit).
// Leitura direta de projetos_obra_rdo / projetos_obra_os (RLS por empresa). Fotos no bucket privado com URL assinada.
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { parseNumBR } from '@/lib/num'
import { ehUuid, erroAmigavel } from '@/lib/erroAmigavel'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/projetos/obras/[id]/rdo'
// RD-95: os campos do formulário de RDO reusam as chaves de ajuda da tela de OS (projetos.os_obra.rdo_*),
// gravadas na rota /dashboard/projetos/obras/os. Apontamos esses "?" para lá; o resto (projetos.obra_rdo.*)
// usa a rota desta tela (ROTA). Sem rota explícita o AjudaCampo cairia no usePathname() (UUID), que não casa.
const ROTA_OS = '/dashboard/projetos/obras/os'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', VERM = '#B91C1C'

type Clima = 'sol' | 'nublado' | 'chuva' | 'chuva_forte'
const CLIMAS: [Clima, string][] = [['sol', 'Sol'], ['nublado', 'Nublado'], ['chuva', 'Chuva'], ['chuva_forte', 'Chuva forte']]
const rotuloClima = (c: string) => CLIMAS.find(([v]) => v === c)?.[1] ?? c
const hoje = () => new Date().toISOString().slice(0, 10)
const dataBR = (d: string | null) => (d ? d.split('-').reverse().join('/') : '')
// data (YYYY-MM-DD) a partir do timestamp de registro (criado_em), para separar execução × registro
const dataDeTs = (ts: string | null) => (ts ? ts.slice(0, 10) : '')
const BUCKET = 'projetos-plantas'
const OS_LANCAVEL = (s: string) => s === 'aberta' || s === 'em_execucao'

type Obra = {
  company_id: string; numero: string | null; nome: string | null; cliente_nome: string | null; cidade: string | null
  // §321 cabeçalho do diário: endereço completo da obra, responsável técnico e ART/CNO (colunas de projetos_obras)
  endereco: string | null; numero_endereco: string | null; bairro: string | null; uf: string | null; cep: string | null
  responsavel_nome: string | null; art: string | null; cno: string | null
}
// Cabeçalho legal do Livro de Ordem (CONFEA 1.094/2017): endereço completo da obra + responsável técnico + ART/CNO.
const enderecoObra = (o: Obra): string => {
  const linha1 = [o.endereco, o.numero_endereco].filter((p) => p && String(p).trim()).join(', ')
  const partes = [linha1, o.bairro, [o.cidade, o.uf].filter(Boolean).join('/'), o.cep && `CEP ${o.cep}`]
  return partes.filter((p) => p && String(p).trim()).join(' · ')
}
// "Rua X, 100 — Centro — Chapecó/SC — CEP 89802-000" (só o que estiver preenchido)
const enderecoCompleto = (o: Obra) => {
  const rua = [o.endereco, o.numero_endereco].filter(Boolean).join(', ')
  const cidUf = [o.cidade, o.uf].filter(Boolean).join('/')
  const cep = o.cep && /^\d{8}$/.test(o.cep) ? `CEP ${o.cep.slice(0, 5)}-${o.cep.slice(5)}` : o.cep ? `CEP ${o.cep}` : ''
  return [rua, o.bairro, cidUf, cep].filter(Boolean).join(' — ')
}
type Os = { id: string; numero: string | null; descricao: string | null; status: string }

// Livro de Ordem estruturado (blueprint 32e5bdfb): o que operou, o que chegou/foi aplicado e como cada serviço andou no dia.
type Equip = { nome: string; quantidade: string }
type Movimento = 'recebido' | 'usado'
type Material = { nome: string; quantidade: string; movimento: Movimento; fornecedor: string }
type Situacao = 'iniciado' | 'andamento' | 'concluido'
type Servico = { descricao: string; situacao: Situacao }
type Blocos = { equipamentos: Equip[]; materiais: Material[]; servicos: Servico[] }
const SITUACOES: [Situacao, string][] = [['iniciado', 'Iniciado'], ['andamento', 'Em andamento'], ['concluido', 'Concluído']]
const rotuloSituacao = (s: string) => SITUACOES.find(([v]) => v === s)?.[1] ?? s
const MAX_ITENS = 30
const blocosVazios = (): Blocos => ({ equipamentos: [], materiais: [], servicos: [] })
// Lê o que veio do banco com tolerância (linha antiga = '{}'); nunca quebra a tela por um item malformado.
const lerBlocos = (b: unknown): Blocos => {
  const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[] : [])
  const txt = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
  return {
    equipamentos: arr(o.equipamentos).map((e) => ({ nome: txt(e.nome), quantidade: txt(e.quantidade) })),
    materiais: arr(o.materiais).map((m) => ({ nome: txt(m.nome), quantidade: txt(m.quantidade),
      movimento: m.movimento === 'usado' ? 'usado' : 'recebido', fornecedor: txt(m.fornecedor) })),
    servicos: arr(o.servicos).map((s) => ({ descricao: txt(s.descricao),
      situacao: (['iniciado', 'andamento', 'concluido'] as string[]).includes(txt(s.situacao)) ? txt(s.situacao) as Situacao : 'andamento' })),
  }
}
// Só o que tem nome/descrição vai ao banco (linha em branco do formulário é descartada).
const limparBlocos = (b: Blocos): Blocos => ({
  equipamentos: b.equipamentos.filter((e) => e.nome.trim()).map((e) => ({ nome: e.nome.trim(), quantidade: e.quantidade.trim() })),
  materiais: b.materiais.filter((m) => m.nome.trim()).map((m) => ({ ...m, nome: m.nome.trim(), quantidade: m.quantidade.trim(), fornecedor: m.fornecedor.trim() })),
  servicos: b.servicos.filter((s) => s.descricao.trim()).map((s) => ({ ...s, descricao: s.descricao.trim() })),
})
const totalItens = (b: Blocos) => b.equipamentos.length + b.materiais.length + b.servicos.length
const textoBlocos = (b: Blocos) => [
  ...b.equipamentos.map((e) => `${e.nome} ${e.quantidade}`),
  ...b.materiais.map((m) => `${m.nome} ${m.quantidade} ${m.movimento} ${m.fornecedor}`),
  ...b.servicos.map((s) => `${s.descricao} ${rotuloSituacao(s.situacao)}`),
].join(' ')
const dataHoraBR = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

type Rdo = {
  id: string; os_id: string; data: string; clima: Clima; praticavel: boolean; efetivo: number
  atividades: string | null; ocorrencias: string | null; quantidade_executada: number | null; fotos: string[]; criado_em: string
  blocos: Blocos; atualizado_em: string | null; atualizado_por_nome: string | null
}
// atualizado_em nasce = criado_em (DEFAULT now()); só conta como alteração se houve edição de fato
// (editor registrado pelo fn_obra_rdo_salvar, ou carimbo mais de 1 min depois do lançamento).
const foiAlterado = (r: Rdo) => {
  if (r.atualizado_por_nome) return true
  if (!r.atualizado_em) return false
  const dif = new Date(r.atualizado_em).getTime() - new Date(r.criado_em).getTime()
  return Number.isFinite(dif) && dif > 60_000
}
const VAZIO = { os_id: '', data: '', clima: 'sol' as Clima, praticavel: true, efetivo: '', quantidade: '', atividades: '', ocorrencias: '', fotos: [] as string[], blocos: blocosVazios() }

export default function RdoObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [obra, setObra] = useState<Obra | null>(null)
  const [organizacao, setOrganizacao] = useState<string | null>(null)
  const [oss, setOss] = useState<Os[]>([])
  const [rdos, setRdos] = useState<Rdo[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtroOs, setFiltroOs] = useState('')
  const [busca, setBusca] = useState('')       // palavra-chave (atividades/ocorrências/clima)
  const [buscaData, setBuscaData] = useState('') // dia específico
  const [editando, setEditando] = useState<string | null>(null) // id do RDO em edição, 'novo' para incluir, ou null
  const [fr, setFr] = useState({ ...VAZIO })
  const [novasFotos, setNovasFotos] = useState<File[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [excluindo, setExcluindo] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!ehUuid(id)) { setLoading(false); setErro('Obra não encontrada. Abra pela lista de obras.'); return }
    setLoading(true); setErro(null)
    let carregou = false
    // Diários da obra. Se o banco ainda não tem as colunas novas (preview da PR antes da migration),
    // cai para as colunas antigas em vez de esvaziar a lista — a tela segue usável, só sem os blocos.
    const COLS_RDO = 'id,os_id,data,clima,praticavel,efetivo,atividades,ocorrencias,quantidade_executada,fotos,criado_em'
    const lerRdos = async () => {
      const q = (cols: string) => supabase.from('projetos_obra_rdo').select(cols)
        .eq('obra_id', id).is('excluido_em', null).order('data', { ascending: false }).order('criado_em', { ascending: false })
      const r = await q(`${COLS_RDO},blocos,atualizado_em,atualizado_por_nome`)
      if (r.error && /42703|column/i.test(`${r.error.code ?? ''} ${r.error.message ?? ''}`)) return q(COLS_RDO)
      return r
    }
    try {
      const [o, os, rd] = await comPrazo(async () => await Promise.all([
        supabase.from('projetos_obras').select('company_id,numero,nome,cliente_nome,cidade,endereco,numero_endereco,bairro,uf,cep,responsavel_nome,art,cno').eq('id', id).maybeSingle(),
        supabase.from('projetos_obra_os').select('id,numero,descricao,status').eq('obra_id', id).is('excluido_em', null).order('numero', { ascending: true }),
        lerRdos(),
      ]), { ms: 9000, tentativas: 1, label: 'obra-rdo' })
      if (o.error) { setLoading(false); setErro(erroAmigavel(o.error, 'Não foi possível carregar a obra. Tente de novo.')); return }
      if (rd.error) { setLoading(false); setErro(erroAmigavel(rd.error, 'Não foi possível carregar os diários desta obra. Tente de novo.')); return }
      if (!o.data) {
        const { data: ex } = await supabase.rpc('fn_obra_existe', { p_obra_id: id })
        const j = ex as { existe?: boolean; tem_acesso?: boolean } | null
        setLoading(false)
        setErro(j?.existe === false ? 'Esta obra não existe. O link pode estar desatualizado.'
          : j?.existe && !j.tem_acesso ? 'Você não tem acesso a esta obra na empresa ativa. Troque de empresa ou peça acesso.'
          : 'Não foi possível confirmar esta obra. Abra pela lista de obras.')
        return
      }
      setObra(o.data as Obra)
      // §321: organização que conduz a obra (cabeçalho do diário). Falha aqui não derruba a tela.
      const { data: emp } = await supabase.from('companies').select('razao_social, nome_fantasia').eq('id', (o.data as Obra).company_id).maybeSingle()
      const e = emp as { razao_social: string | null; nome_fantasia: string | null } | null
      setOrganizacao(e?.nome_fantasia || e?.razao_social || null)
      setOss(((os.data ?? []) as Os[]))
      type RdoBruto = Omit<Rdo, 'blocos' | 'atualizado_em' | 'atualizado_por_nome'> & { blocos?: unknown; atualizado_em?: string | null; atualizado_por_nome?: string | null }
      setRdos(((rd.data ?? []) as unknown as RdoBruto[]).map((r) => ({
        ...r, blocos: lerBlocos(r.blocos), atualizado_em: r.atualizado_em ?? null, atualizado_por_nome: r.atualizado_por_nome ?? null,
      })))
      carregou = true
      setLoading(false)
    } catch { setLoading(false); if (!carregou) setErro(MSG_CARREGAMENTO_FALHOU) }
  }, [id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const osMap = useMemo(() => new Map(oss.map((o) => [o.id, o])), [oss])
  const osLancaveis = useMemo(() => oss.filter((o) => OS_LANCAVEL(o.status)), [oss])
  const rotuloOs = (o: Os | undefined) => o ? `OS ${o.numero ?? '—'}${o.descricao ? ` · ${o.descricao}` : ''}` : 'OS removida'
  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return rdos.filter((r) => {
      if (filtroOs && r.os_id !== filtroOs) return false
      if (buscaData && r.data !== buscaData) return false
      if (termo) {
        const o = osMap.get(r.os_id)
        const alvo = `${r.atividades ?? ''} ${r.ocorrencias ?? ''} ${textoBlocos(r.blocos)} ${rotuloClima(r.clima)} OS ${o?.numero ?? ''} ${o?.descricao ?? ''}`.toLowerCase()
        if (!alvo.includes(termo)) return false
      }
      return true
    })
  }, [rdos, filtroOs, busca, buscaData, osMap])
  const filtrando = Boolean(filtroOs || busca.trim() || buscaData)
  const limparBusca = () => { setFiltroOs(''); setBusca(''); setBuscaData('') }

  const abrirNovo = () => {
    setErro(null); setNovasFotos([])
    setFr({ ...VAZIO, os_id: osLancaveis[0]?.id ?? '', data: hoje(), blocos: blocosVazios() })
    setEditando('novo')
  }
  const abrirEdicao = (r: Rdo) => {
    setErro(null); setNovasFotos([])
    setFr({ os_id: r.os_id, data: r.data, clima: r.clima, praticavel: r.praticavel, efetivo: String(r.efetivo),
      quantidade: r.quantidade_executada == null ? '' : String(r.quantidade_executada).replace('.', ','),
      atividades: r.atividades ?? '', ocorrencias: r.ocorrencias ?? '', fotos: r.fotos,
      blocos: { equipamentos: r.blocos.equipamentos.map((x) => ({ ...x })), materiais: r.blocos.materiais.map((x) => ({ ...x })),
        servicos: r.blocos.servicos.map((x) => ({ ...x })) } })
    setEditando(r.id)
  }
  const fechar = () => { setEditando(null); setFr({ ...VAZIO, blocos: blocosVazios() }); setNovasFotos([]) }

  // Edição imutável dos blocos estruturados (adicionar / alterar / remover linha).
  const setBloco = <K extends keyof Blocos>(k: K, itens: Blocos[K]) => setFr((f) => ({ ...f, blocos: { ...f.blocos, [k]: itens } }))
  const novoItem: { [K in keyof Blocos]: () => Blocos[K][number] } = {
    equipamentos: () => ({ nome: '', quantidade: '' }),
    materiais: () => ({ nome: '', quantidade: '', movimento: 'recebido', fornecedor: '' }),
    servicos: () => ({ descricao: '', situacao: 'andamento' }),
  }
  const addItem = <K extends keyof Blocos>(k: K) => {
    if (fr.blocos[k].length >= MAX_ITENS) { setErro(`No máximo ${MAX_ITENS} itens em cada bloco do diário.`); return }
    setBloco(k, [...fr.blocos[k], novoItem[k]()] as Blocos[K])
  }
  const mudarItem = <K extends keyof Blocos>(k: K, i: number, patch: Partial<Blocos[K][number]>) =>
    setBloco(k, fr.blocos[k].map((x, j) => (j === i ? { ...x, ...patch } : x)) as Blocos[K])
  const removerItem = <K extends keyof Blocos>(k: K, i: number) => setBloco(k, fr.blocos[k].filter((_, j) => j !== i) as Blocos[K])

  const verFoto = async (path: string) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600)
    if (error || !data) { setErro('Não foi possível abrir a foto.'); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setErro(null)
    if (!obra) return
    if (!fr.os_id) { setErro('Escolha a OS do diário.'); return }
    const blocos = limparBlocos(fr.blocos)
    if (!fr.atividades.trim() && !fr.ocorrencias.trim() && totalItens(blocos) === 0) {
      setErro('Conte o que foi feito ou o que aconteceu no dia — no texto ou nos blocos de equipamentos, materiais e serviços.'); return
    }
    if (fr.data > hoje()) { setErro('O diário é do dia que já aconteceu — a data não pode ser futura.'); return }
    if (fr.fotos.length + novasFotos.length > 10) { setErro('No máximo 10 fotos por dia.'); return }
    const qtd = fr.quantidade.trim() === '' ? null : (parseNumBR(fr.quantidade) ?? NaN)
    if (qtd !== null && (!Number.isFinite(qtd) || qtd < 0)) { setErro('A quantidade executada deve ser um número maior ou igual a zero.'); return }
    setOcupado(true)
    const enviadas: string[] = []
    for (const file of novasFotos) {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
      const path = `${obra.company_id}/rdo/${fr.os_id}/${crypto.randomUUID()}.${ext}`
      const up = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || 'image/jpeg' })
      if (up.error) { setOcupado(false); setErro('Não foi possível enviar uma das fotos. Confira a conexão e tente de novo.'); return }
      enviadas.push(path)
    }
    const { error } = await supabase.rpc('fn_obra_rdo_salvar', { p_os_id: fr.os_id, p_dados: {
      data: fr.data, clima: fr.clima, praticavel: fr.praticavel, efetivo: fr.efetivo === '' ? 0 : Number(fr.efetivo),
      quantidade_executada: qtd, atividades: fr.atividades, ocorrencias: fr.ocorrencias, fotos: [...fr.fotos, ...enviadas], blocos } })
    setOcupado(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível salvar o diário.')); return }
    fechar(); void carregar()
  }

  const excluir = async (r: Rdo) => {
    if (excluindo) return
    if (!window.confirm(`Excluir o diário de ${dataBR(r.data)} (${rotuloOs(osMap.get(r.os_id))})? A exclusão fica registrada (quem e quando).`)) return
    setExcluindo(r.id); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_rdo_excluir', { p_rdo_id: r.id })
    setExcluindo(null)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || (j && j.ok === false)) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível excluir o diário.')); return }
    void carregar()
  }

  const inp: React.CSSProperties = { padding: '10px 12px', border: `1px solid ${LINE}`, borderRadius: 10, background: '#fff', fontSize: 15, width: '100%', boxSizing: 'border-box', color: ESP }
  const lab: React.CSSProperties = { display: 'grid', gap: 6, fontSize: 13, color: MUT, fontWeight: 600 }
  const rot: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4 }
  const btn = (fundo: string, cor: string): React.CSSProperties => ({ padding: '9px 14px', minHeight: 40, background: fundo, color: cor, border: fundo === '#fff' ? `1px solid ${LINE}` : 0, borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: 'pointer' })
  const card: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 12, background: '#fff', padding: 14 }
  const blocoBox: React.CSSProperties = { gridColumn: '1 / -1', display: 'grid', gap: 8, border: `1px solid ${LINE}`, borderRadius: 10, background: BG, padding: 12 }
  const tituloBloco: React.CSSProperties = { fontSize: 13, color: ESP, fontWeight: 700 }
  const linhaBloco: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }
  const btnRemover: React.CSSProperties = { ...btn('#fff', VERM), padding: '8px 12px', fontSize: 13 }
  const btnAdd: React.CSSProperties = { ...btn('#fff', ESP), justifySelf: 'start', fontSize: 13 }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: 16, color: ESP }} data-rota={ROTA}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <Link href="/dashboard/projetos/obras?area=hub" style={{ color: GOLD, fontSize: 13 }}>← Obras</Link>
        <h1 style={{ fontSize: 24, margin: '8px 0 4px', fontWeight: 700 }}>Diário de Obra (RDO)</h1>
        <p style={{ fontSize: 14, color: MUT, margin: '0 0 16px', lineHeight: 1.5 }}>
          O Livro de Ordem da obra: um diário por dia e por OS — clima, equipe, o que foi feito, ocorrências e fotos.
        </p>

        {/* §321 cabeçalho do diário (Livro de Ordem): organização, obra, cliente, endereço e responsável. */}
        {obra && (
          <div data-testid="obra-rdo-cabecalho" data-ajuda="projetos.obra_rdo.cabecalho"
            style={{ border: `1px solid ${LINE}`, borderRadius: 12, background: '#fff', padding: 14, marginBottom: 16, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            {([
              ['Organização', organizacao, 'obra-rdo-cab-org'],
              ['Obra', `${obra.numero ?? ''}${obra.nome ? ` · ${obra.nome}` : ''}`, 'obra-rdo-cab-obra'],
              ['Cliente', obra.cliente_nome, 'obra-rdo-cab-cliente'],
              ['Endereço da obra', enderecoCompleto(obra), 'obra-rdo-cab-endereco'],
              ['Responsável', obra.responsavel_nome, 'obra-rdo-cab-resp'],
            ] as [string, string | null, string][]).map(([r, v, t]) => (
              <div key={t} data-testid={t}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, fontWeight: 700 }}>{r}</div>
                <div style={{ fontSize: 14, color: v ? ESP : MUT, fontWeight: v ? 600 : 400 }}>{v || 'Não informado'}</div>
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: MUT, gridColumn: '1 / -1' }}>
              <AjudaCampo chave="projetos.obra_rdo.cabecalho" rota={ROTA} />
              Os dados vêm da ficha da obra.{' '}
              <Link href={`/dashboard/projetos/obras/${id}/ficha`} data-testid="obra-rdo-cab-ficha" style={{ color: GOLD, fontWeight: 600 }}>Completar na ficha</Link>
            </div>
          </div>
        )}

        {loading && <p style={{ color: MUT }}>Carregando…</p>}
        {erro && <div style={{ ...card, borderColor: VERM, color: VERM, marginBottom: 14 }} role="alert">{erro}</div>}

        {!loading && obra && (
          <>
            {/* Cabeçalho legal do Livro de Ordem (CONFEA 1.094/2017): identificação completa da obra. */}
            <div style={{ ...card, marginBottom: 14, display: 'grid', gap: 6 }} data-testid="obra-rdo-cabecalho-legal">
              <div style={{ fontSize: 15, fontWeight: 700 }}>
                Obra {obra.numero ?? '—'}{obra.nome ? ` · ${obra.nome}` : ''}
              </div>
              <div style={{ display: 'grid', gap: 4, fontSize: 13, color: MUT }}>
                {obra.cliente_nome && <span><b style={{ color: ESP }}>Contratante:</b> {obra.cliente_nome}</span>}
                {enderecoObra(obra) && <span><b style={{ color: ESP }}>Endereço da obra:</b> {enderecoObra(obra)}</span>}
                {obra.responsavel_nome && <span><b style={{ color: ESP }}>Responsável técnico:</b> {obra.responsavel_nome}</span>}
                {(obra.art || obra.cno) && (
                  <span>
                    {obra.art && <><b style={{ color: ESP }}>ART/RRT:</b> {obra.art}</>}
                    {obra.art && obra.cno ? '  ·  ' : ''}
                    {obra.cno && <><b style={{ color: ESP }}>CNO:</b> {obra.cno}</>}
                  </span>
                )}
                {!obra.cliente_nome && !enderecoObra(obra) && !obra.responsavel_nome && !obra.art && !obra.cno && (
                  <span>Complete o endereço, o responsável técnico e a ART/CNO na ficha da obra para o cabeçalho legal do diário.</span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginBottom: 14 }}>
              <label style={{ ...lab, flex: '2 1 240px' }}>
                <span style={rot}>Buscar no diário <AjudaCampo chave="projetos.obra_rdo.busca" rota={ROTA} /></span>
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Serviço, ocorrência, palavra-chave…" style={inp} data-testid="obra-rdo-busca" />
              </label>
              <label style={{ ...lab, flex: '1 1 150px' }}>
                <span style={rot}>Dia <AjudaCampo chave="projetos.obra_rdo.busca_data" rota={ROTA} /></span>
                <input type="date" value={buscaData} max={hoje()} onChange={(e) => setBuscaData(e.target.value)} style={inp} data-testid="obra-rdo-busca-data" />
              </label>
              <label style={{ ...lab, flex: '1 1 180px' }}>
                <span style={rot}>Filtrar por OS <AjudaCampo chave="projetos.obra_rdo.filtro_os" rota={ROTA} /></span>
                <select value={filtroOs} onChange={(e) => setFiltroOs(e.target.value)} style={inp} data-testid="obra-rdo-filtro-os">
                  <option value="">Todas as OS</option>
                  {oss.map((o) => <option key={o.id} value={o.id}>{rotuloOs(o)}</option>)}
                </select>
              </label>
              {filtrando && (
                <button type="button" onClick={limparBusca} style={btn('#fff', ESP)} data-testid="obra-rdo-limpar-busca">Limpar</button>
              )}
              <span style={rot}>
                <button type="button" onClick={() => (editando === 'novo' ? fechar() : abrirNovo())} disabled={osLancaveis.length === 0}
                  style={btn(ESP, '#fff')} data-testid="obra-rdo-novo">
                  {editando === 'novo' ? 'Fechar' : '+ Novo diário'}
                </button>
                <AjudaCampo chave="projetos.obra_rdo.novo" rota={ROTA} />
              </span>
            </div>
            {osLancaveis.length === 0 && (
              <p style={{ fontSize: 13, color: MUT, margin: '0 0 14px' }}>
                Não há OS aberta ou em execução nesta obra — o diário é lançado em uma OS ativa.
              </p>
            )}

            {(editando === 'novo' || editando) && (
              <form onSubmit={salvar} data-testid="obra-rdo-form" style={{ ...card, display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr', marginBottom: 16 }}>
                <label style={{ ...lab, gridColumn: '1 / -1' }}>
                  <span style={rot}>OS do diário <AjudaCampo chave="projetos.obra_rdo.os" rota={ROTA} /></span>
                  <select value={fr.os_id} onChange={(e) => setFr({ ...fr, os_id: e.target.value })} disabled={editando !== 'novo'} style={inp} data-testid="obra-rdo-os">
                    {editando !== 'novo'
                      ? <option value={fr.os_id}>{rotuloOs(osMap.get(fr.os_id))}</option>
                      : <>{osLancaveis.length === 0 && <option value="">Sem OS ativa</option>}
                         {osLancaveis.map((o) => <option key={o.id} value={o.id}>{rotuloOs(o)}</option>)}</>}
                  </select>
                </label>
                <label style={lab}>
                  <span style={rot}>Dia da execução <AjudaCampo chave="projetos.os_obra.rdo_data" rota={ROTA_OS} /></span>
                  <input type="date" value={fr.data} max={hoje()} onChange={(e) => setFr({ ...fr, data: e.target.value })} style={inp} data-testid="obra-rdo-data" />
                </label>
                <label style={lab}>
                  <span style={rot}>Clima <AjudaCampo chave="projetos.os_obra.rdo_clima" rota={ROTA_OS} /></span>
                  <select value={fr.clima} onChange={(e) => setFr({ ...fr, clima: e.target.value as Clima })} style={inp} data-testid="obra-rdo-clima">
                    {CLIMAS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                  </select>
                </label>
                <label style={lab}>
                  <span style={rot}>Efetivo (pessoas) <AjudaCampo chave="projetos.os_obra.rdo_efetivo" rota={ROTA_OS} /></span>
                  <input inputMode="numeric" value={fr.efetivo} onChange={(e) => setFr({ ...fr, efetivo: e.target.value.replace(/\D/g, '') })} placeholder="Ex.: 4" style={inp} data-testid="obra-rdo-efetivo" />
                </label>
                <label style={{ ...lab, alignSelf: 'end' }}>
                  <span style={rot}>
                    <input type="checkbox" checked={fr.praticavel} onChange={(e) => setFr({ ...fr, praticavel: e.target.checked })} style={{ width: 20, height: 20 }} data-testid="obra-rdo-praticavel" />
                    Deu para trabalhar <AjudaCampo chave="projetos.os_obra.rdo_praticavel" rota={ROTA_OS} />
                  </span>
                </label>
                <label style={{ ...lab, gridColumn: '1 / -1' }}>
                  <span style={rot}>Quantidade executada no dia <AjudaCampo chave="projetos.os_obra.rdo_quantidade" rota={ROTA_OS} /></span>
                  <input inputMode="decimal" value={fr.quantidade} onChange={(e) => setFr({ ...fr, quantidade: e.target.value.replace(/[^\d.,]/g, '') })} placeholder="Ex.: 34 (na unidade do serviço, como m²)" style={inp} data-testid="obra-rdo-quantidade" />
                </label>
                <label style={{ ...lab, gridColumn: '1 / -1' }}>
                  <span style={rot}>O que foi feito <AjudaCampo chave="projetos.os_obra.rdo_atividades" rota={ROTA_OS} /></span>
                  <textarea value={fr.atividades} onChange={(e) => setFr({ ...fr, atividades: e.target.value })} rows={2} placeholder="Ex.: forro fechado nas salas 201 e 202 (34 m²)" style={{ ...inp, resize: 'vertical' }} data-testid="obra-rdo-atividades" />
                </label>
                <label style={{ ...lab, gridColumn: '1 / -1' }}>
                  <span style={rot}>Ocorrências <AjudaCampo chave="projetos.os_obra.rdo_ocorrencias" rota={ROTA_OS} /></span>
                  <textarea value={fr.ocorrencias} onChange={(e) => setFr({ ...fr, ocorrencias: e.target.value })} rows={2} placeholder="Ex.: faltou perfil de 3 m; chuva parou o serviço às 14h" style={{ ...inp, resize: 'vertical' }} data-testid="obra-rdo-ocorrencias" />
                </label>

                {/* Livro de Ordem estruturado (blueprint 32e5bdfb): equipamentos, materiais (+ fornecedor) e serviços do dia. */}
                <div role="group" aria-label="Equipamentos no dia" style={blocoBox} data-testid="obra-rdo-bloco-equipamentos">
                  <span style={{ ...rot, ...tituloBloco }}>Equipamentos no dia <AjudaCampo chave="projetos.obra_rdo.equipamentos" rota={ROTA} /></span>
                  {fr.blocos.equipamentos.map((it, i) => (
                    <div key={i} data-ajuda="projetos.obra_rdo.equipamentos" style={linhaBloco}>
                      <input aria-label="Equipamento" value={it.nome} onChange={(e) => mudarItem('equipamentos', i, { nome: e.target.value })}
                        placeholder="Equipamento (ex.: betoneira 400 L)" maxLength={120} style={{ ...inp, flex: '2 1 170px', minWidth: 0 }} data-testid="obra-rdo-equip-nome" />
                      <input aria-label="Quantidade ou horas" value={it.quantidade} onChange={(e) => mudarItem('equipamentos', i, { quantidade: e.target.value })}
                        placeholder="Qtd / horas" maxLength={40} style={{ ...inp, flex: '1 1 90px', minWidth: 0 }} data-testid="obra-rdo-equip-qtd" />
                      <button type="button" onClick={() => removerItem('equipamentos', i)} style={btnRemover}>Remover</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => addItem('equipamentos')} style={btnAdd} data-testid="obra-rdo-equip-add">+ Equipamento</button>
                </div>

                <div role="group" aria-label="Materiais do dia" style={blocoBox} data-testid="obra-rdo-bloco-materiais">
                  <span style={{ ...rot, ...tituloBloco }}>Materiais do dia <AjudaCampo chave="projetos.obra_rdo.materiais" rota={ROTA} /></span>
                  {fr.blocos.materiais.map((it, i) => (
                    <div key={i} data-ajuda="projetos.obra_rdo.materiais" style={linhaBloco}>
                      <input aria-label="Material" value={it.nome} onChange={(e) => mudarItem('materiais', i, { nome: e.target.value })}
                        placeholder="Material (ex.: cimento CP-II)" maxLength={120} style={{ ...inp, flex: '2 1 170px', minWidth: 0 }} data-testid="obra-rdo-mat-nome" />
                      <input aria-label="Quantidade" value={it.quantidade} onChange={(e) => mudarItem('materiais', i, { quantidade: e.target.value })}
                        placeholder="Qtd (ex.: 40 sc)" maxLength={40} style={{ ...inp, flex: '1 1 90px', minWidth: 0 }} data-testid="obra-rdo-mat-qtd" />
                      <select aria-label="Recebido ou usado" value={it.movimento} onChange={(e) => mudarItem('materiais', i, { movimento: e.target.value as Movimento })}
                        style={{ ...inp, flex: '1 1 110px', minWidth: 0 }} data-testid="obra-rdo-mat-mov">
                        <option value="recebido">Recebido</option>
                        <option value="usado">Usado</option>
                      </select>
                      <input aria-label="Fornecedor" value={it.fornecedor} onChange={(e) => mudarItem('materiais', i, { fornecedor: e.target.value })}
                        placeholder="Fornecedor (opcional)" maxLength={120} style={{ ...inp, flex: '2 1 170px', minWidth: 0 }} data-testid="obra-rdo-mat-forn" />
                      <button type="button" onClick={() => removerItem('materiais', i)} style={btnRemover}>Remover</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => addItem('materiais')} style={btnAdd} data-testid="obra-rdo-mat-add">+ Material</button>
                </div>

                <div role="group" aria-label="Serviços do dia" style={blocoBox} data-testid="obra-rdo-bloco-servicos">
                  <span style={{ ...rot, ...tituloBloco }}>Serviços do dia <AjudaCampo chave="projetos.obra_rdo.servicos" rota={ROTA} /></span>
                  {fr.blocos.servicos.map((it, i) => (
                    <div key={i} data-ajuda="projetos.obra_rdo.servicos" style={linhaBloco}>
                      <input aria-label="Serviço" value={it.descricao} onChange={(e) => mudarItem('servicos', i, { descricao: e.target.value })}
                        placeholder="Serviço (ex.: alvenaria do 2º pavimento)" maxLength={200} style={{ ...inp, flex: '3 1 200px', minWidth: 0 }} data-testid="obra-rdo-serv-desc" />
                      <select aria-label="Situação do serviço" value={it.situacao} onChange={(e) => mudarItem('servicos', i, { situacao: e.target.value as Situacao })}
                        style={{ ...inp, flex: '1 1 140px', minWidth: 0 }} data-testid="obra-rdo-serv-sit">
                        {SITUACOES.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                      </select>
                      <button type="button" onClick={() => removerItem('servicos', i)} style={btnRemover}>Remover</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => addItem('servicos')} style={btnAdd} data-testid="obra-rdo-serv-add">+ Serviço</button>
                </div>

                <label style={{ ...lab, gridColumn: '1 / -1' }}>
                  <span style={rot}>Fotos ({fr.fotos.length + novasFotos.length}/10) <AjudaCampo chave="projetos.os_obra.rdo_fotos" rota={ROTA_OS} /></span>
                  <input type="file" accept="image/*" capture="environment" multiple onChange={(e) => setNovasFotos(Array.from(e.target.files ?? []))} style={{ ...inp, padding: 8 }} data-testid="obra-rdo-fotos" />
                </label>
                {fr.fotos.length > 0 && (
                  <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {fr.fotos.map((p) => <button key={p} type="button" onClick={() => verFoto(p)} style={{ ...btn('#fff', ESP), fontSize: 12 }}>Ver foto</button>)}
                  </div>
                )}
                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button type="submit" disabled={ocupado || !fr.os_id} style={btn(ESP, '#fff')} data-testid="obra-rdo-salvar">{ocupado ? 'Salvando…' : editando === 'novo' ? 'Salvar diário' : 'Atualizar diário'}</button>
                  <AjudaCampo chave="projetos.os_obra.rdo_salvar" rota={ROTA_OS} />
                  <button type="button" onClick={fechar} style={btn('#fff', ESP)}>Cancelar</button>
                </div>
              </form>
            )}

            <h2 style={{ fontSize: 15, fontWeight: 700, margin: '4px 0 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
              Histórico de diários <AjudaCampo chave="projetos.obra_rdo.historico" rota={ROTA} /> <span style={{ color: MUT, fontWeight: 400 }}>({lista.length})</span>
            </h2>
            {lista.length === 0
              ? <p style={{ color: MUT, fontSize: 14 }}>{filtrando ? 'Nenhum diário encontrado para a busca. Ajuste a palavra-chave, o dia ou a OS — ou toque em Limpar.' : 'Nenhum diário lançado ainda.'}</p>
              : <div style={{ display: 'grid', gap: 10 }}>
                  {lista.map((r) => {
                    const o = osMap.get(r.os_id)
                    const editavel = o ? OS_LANCAVEL(o.status) : false
                    const regData = dataDeTs(r.criado_em)
                    const retroativo = !!(regData && r.data && r.data < regData)
                    return (
                      <div key={r.id} style={card} data-testid="obra-rdo-item">
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                          <strong style={{ fontSize: 15 }}>{dataBR(r.data)}</strong>
                          <span style={{ fontSize: 12, color: MUT }}>{rotuloOs(o)}</span>
                        </div>
                        {regData && (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: MUT, marginTop: 2 }} data-testid="obra-rdo-registrado">
                            <span style={rot}>Registrado em {dataBR(regData)} <AjudaCampo chave="projetos.obra_rdo.registrado_em" rota={ROTA} /></span>
                            {retroativo && (
                              <span style={{ background: '#FDF0D5', color: '#92610A', border: `1px solid ${GOLD}`, borderRadius: 999, padding: '1px 8px', fontWeight: 600 }}>Registro retroativo</span>
                            )}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 13, color: MUT, margin: '6px 0' }}>
                          <span>Clima: <b style={{ color: ESP }}>{rotuloClima(r.clima)}</b></span>
                          <span>Efetivo: <b style={{ color: ESP }}>{r.efetivo}</b></span>
                          <span style={{ color: r.praticavel ? VERDE : VERM }}>{r.praticavel ? 'Deu para trabalhar' : 'Dia não praticável'}</span>
                          {r.quantidade_executada != null && <span>Executado: <b style={{ color: ESP }}>{String(r.quantidade_executada).replace('.', ',')}</b></span>}
                        </div>
                        {r.atividades && <p style={{ margin: '4px 0', fontSize: 14 }}><span style={{ color: MUT }}>Feito: </span>{r.atividades}</p>}
                        {r.ocorrencias && <p style={{ margin: '4px 0', fontSize: 14 }}><span style={{ color: MUT }}>Ocorrências: </span>{r.ocorrencias}</p>}
                        {totalItens(r.blocos) > 0 && (
                          <div style={{ display: 'grid', gap: 4, margin: '6px 0', fontSize: 14 }} data-testid="obra-rdo-blocos">
                            {r.blocos.equipamentos.length > 0 && (
                              <p style={{ margin: 0 }}><span style={{ color: MUT }}>Equipamentos: </span>
                                {r.blocos.equipamentos.map((e) => (e.quantidade ? `${e.nome} (${e.quantidade})` : e.nome)).join(' · ')}</p>
                            )}
                            {r.blocos.materiais.length > 0 && (
                              <p style={{ margin: 0 }}><span style={{ color: MUT }}>Materiais: </span>
                                {r.blocos.materiais.map((m) => `${m.nome}${m.quantidade ? ` ${m.quantidade}` : ''} — ${m.movimento === 'usado' ? 'usado' : 'recebido'}${m.fornecedor ? ` (${m.fornecedor})` : ''}`).join(' · ')}</p>
                            )}
                            {r.blocos.servicos.length > 0 && (
                              <p style={{ margin: 0 }}><span style={{ color: MUT }}>Serviços: </span>
                                {r.blocos.servicos.map((s) => `${s.descricao} — ${rotuloSituacao(s.situacao)}`).join(' · ')}</p>
                            )}
                          </div>
                        )}
                        {r.fotos.length > 0 && (
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '6px 0' }}>
                            {r.fotos.map((p) => <button key={p} type="button" onClick={() => verFoto(p)} style={{ ...btn('#fff', ESP), fontSize: 12 }}>Ver foto</button>)}
                          </div>
                        )}
                        {foiAlterado(r) && (
                          <p style={{ margin: '6px 0 0', fontSize: 12, color: MUT }} data-testid="obra-rdo-alterado">
                            Alterado em {dataHoraBR(r.atualizado_em)}{r.atualizado_por_nome ? ` por ${r.atualizado_por_nome}` : ''} · lançado em {dataHoraBR(r.criado_em)}
                          </p>
                        )}
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          {editavel && <span style={rot}><button type="button" onClick={() => abrirEdicao(r)} style={btn('#fff', ESP)} data-testid="obra-rdo-editar">Editar</button><AjudaCampo chave="projetos.obra_rdo.editar" rota={ROTA} /></span>}
                          <span style={rot}>
                            <button type="button" onClick={() => excluir(r)} disabled={excluindo === r.id} style={btn('#fff', VERM)} data-testid="obra-rdo-excluir">{excluindo === r.id ? 'Excluindo…' : 'Excluir'}</button>
                            <AjudaCampo chave="projetos.obra_rdo.excluir" rota={ROTA} />
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>}
          </>
        )}
      </div>
    </div>
  )
}
