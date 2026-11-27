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
  // §321 cabeçalho do diário: endereço completo da obra e responsável (colunas já existentes em projetos_obras)
  endereco: string | null; numero_endereco: string | null; bairro: string | null; uf: string | null; cep: string | null; responsavel_nome: string | null
}
// "Rua X, 100 — Centro — Chapecó/SC — CEP 89802-000" (só o que estiver preenchido)
const enderecoCompleto = (o: Obra) => {
  const rua = [o.endereco, o.numero_endereco].filter(Boolean).join(', ')
  const cidUf = [o.cidade, o.uf].filter(Boolean).join('/')
  const cep = o.cep && /^\d{8}$/.test(o.cep) ? `CEP ${o.cep.slice(0, 5)}-${o.cep.slice(5)}` : o.cep ? `CEP ${o.cep}` : ''
  return [rua, o.bairro, cidUf, cep].filter(Boolean).join(' — ')
}
type Os = { id: string; numero: string | null; descricao: string | null; status: string }
type Rdo = {
  id: string; os_id: string; data: string; clima: Clima; praticavel: boolean; efetivo: number
  atividades: string | null; ocorrencias: string | null; quantidade_executada: number | null; fotos: string[]; criado_em: string
}
const VAZIO = { os_id: '', data: '', clima: 'sol' as Clima, praticavel: true, efetivo: '', quantidade: '', atividades: '', ocorrencias: '', fotos: [] as string[] }

export default function RdoObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [obra, setObra] = useState<Obra | null>(null)
  const [organizacao, setOrganizacao] = useState<string | null>(null)
  const [oss, setOss] = useState<Os[]>([])
  const [rdos, setRdos] = useState<Rdo[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtroOs, setFiltroOs] = useState('')
  const [busca, setBusca] = useState('')
  const [editando, setEditando] = useState<string | null>(null) // id do RDO em edição, 'novo' para incluir, ou null
  const [fr, setFr] = useState({ ...VAZIO })
  const [novasFotos, setNovasFotos] = useState<File[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [excluindo, setExcluindo] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!ehUuid(id)) { setLoading(false); setErro('Obra não encontrada. Abra pela lista de obras.'); return }
    setLoading(true); setErro(null)
    let carregou = false
    try {
      const [o, os, rd] = await comPrazo(async () => await Promise.all([
        supabase.from('projetos_obras').select('company_id,numero,nome,cliente_nome,cidade,endereco,numero_endereco,bairro,uf,cep,responsavel_nome').eq('id', id).maybeSingle(),
        supabase.from('projetos_obra_os').select('id,numero,descricao,status').eq('obra_id', id).is('excluido_em', null).order('numero', { ascending: true }),
        supabase.from('projetos_obra_rdo').select('id,os_id,data,clima,praticavel,efetivo,atividades,ocorrencias,quantidade_executada,fotos,criado_em')
          .eq('obra_id', id).is('excluido_em', null).order('data', { ascending: false }).order('criado_em', { ascending: false }),
      ]), { ms: 9000, tentativas: 1, label: 'obra-rdo' })
      if (o.error) { setLoading(false); setErro(erroAmigavel(o.error, 'Não foi possível carregar a obra. Tente de novo.')); return }
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
      setRdos(((rd.data ?? []) as Rdo[]))
      carregou = true
      setLoading(false)
    } catch { setLoading(false); if (!carregou) setErro(MSG_CARREGAMENTO_FALHOU) }
  }, [id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const osMap = useMemo(() => new Map(oss.map((o) => [o.id, o])), [oss])
  const osLancaveis = useMemo(() => oss.filter((o) => OS_LANCAVEL(o.status)), [oss])
  // Lista do histórico: filtro por OS + busca livre (data, serviço/OS ou palavra-chave nas
  // atividades/ocorrências) — tudo client-side sobre os diários já carregados (escopo 15 · req 7f49b919).
  const lista = useMemo(() => {
    let l = filtroOs ? rdos.filter((r) => r.os_id === filtroOs) : rdos
    const q = busca.trim().toLowerCase()
    if (q) {
      l = l.filter((r) => {
        const os = osMap.get(r.os_id)
        const dataBR = r.data ? new Date(r.data + 'T12:00:00').toLocaleDateString('pt-BR') : ''
        const hay = [r.data, dataBR, r.atividades, r.ocorrencias, r.clima, os?.numero, os?.descricao]
          .filter(Boolean).join(' ').toLowerCase()
        return hay.includes(q)
      })
    }
    return l
  }, [rdos, filtroOs, busca, osMap])
  const rotuloOs = (o: Os | undefined) => o ? `OS ${o.numero ?? '—'}${o.descricao ? ` · ${o.descricao}` : ''}` : 'OS removida'

  const abrirNovo = () => {
    setErro(null); setNovasFotos([])
    setFr({ ...VAZIO, os_id: osLancaveis[0]?.id ?? '', data: hoje() })
    setEditando('novo')
  }
  const abrirEdicao = (r: Rdo) => {
    setErro(null); setNovasFotos([])
    setFr({ os_id: r.os_id, data: r.data, clima: r.clima, praticavel: r.praticavel, efetivo: String(r.efetivo),
      quantidade: r.quantidade_executada == null ? '' : String(r.quantidade_executada).replace('.', ','),
      atividades: r.atividades ?? '', ocorrencias: r.ocorrencias ?? '', fotos: r.fotos })
    setEditando(r.id)
  }
  const fechar = () => { setEditando(null); setFr({ ...VAZIO }); setNovasFotos([]) }

  const verFoto = async (path: string) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600)
    if (error || !data) { setErro('Não foi possível abrir a foto.'); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setErro(null)
    if (!obra) return
    if (!fr.os_id) { setErro('Escolha a OS do diário.'); return }
    if (!fr.atividades.trim() && !fr.ocorrencias.trim()) { setErro('Conte o que foi feito ou o que aconteceu no dia.'); return }
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
      quantidade_executada: qtd, atividades: fr.atividades, ocorrencias: fr.ocorrencias, fotos: [...fr.fotos, ...enviadas] } })
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
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginBottom: 14 }}>
              <label style={{ ...lab, flex: '1 1 220px' }}>
                <span style={rot}>Filtrar por OS <AjudaCampo chave="projetos.obra_rdo.filtro_os" rota={ROTA} /></span>
                <select value={filtroOs} onChange={(e) => setFiltroOs(e.target.value)} style={inp} data-testid="obra-rdo-filtro-os">
                  <option value="">Todas as OS</option>
                  {oss.map((o) => <option key={o.id} value={o.id}>{rotuloOs(o)}</option>)}
                </select>
              </label>
              <label style={{ ...lab, flex: '1 1 220px' }}>
                <span style={rot}>Buscar no diário <AjudaCampo chave="projetos.obra_rdo.busca" rota={ROTA} /></span>
                <input value={busca} onChange={(e) => setBusca(e.target.value)} style={inp} data-testid="obra-rdo-busca"
                  placeholder="Data, serviço (OS) ou palavra-chave" inputMode="search" />
              </label>
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
              ? <p style={{ color: MUT, fontSize: 14 }}>{busca.trim() ? 'Nenhum diário encontrado para esta busca. Limpe o campo para ver todos.' : `Nenhum diário lançado${filtroOs ? ' para esta OS' : ''} ainda.`}</p>
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
                        {r.fotos.length > 0 && (
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '6px 0' }}>
                            {r.fotos.map((p) => <button key={p} type="button" onClick={() => verFoto(p)} style={{ ...btn('#fff', ESP), fontSize: 12 }}>Ver foto</button>)}
                          </div>
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
