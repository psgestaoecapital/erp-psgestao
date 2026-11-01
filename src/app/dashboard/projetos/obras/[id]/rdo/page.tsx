'use client'
// HBF-4.2 · Diário de Obra (RDO) — tela dedicada por obra (Livro de Ordem, CONFEA 1.094/2017).
// Histórico diário da obra (todas as OS), novo/editar o diário do dia por OS e exclusão rastreável.
// Backend já existente: fn_obra_rdo_salvar (upsert por OS+dia) e fn_obra_rdo_excluir (soft-delete + audit).
// Leitura direta de projetos_obra_rdo / projetos_obra_os (RLS por empresa). Fotos no bucket privado com URL assinada.
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ehUuid, erroAmigavel } from '@/lib/erroAmigavel'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/projetos/obras/[id]/rdo'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', VERM = '#B91C1C'

type Clima = 'sol' | 'nublado' | 'chuva' | 'chuva_forte'
const CLIMAS: [Clima, string][] = [['sol', 'Sol'], ['nublado', 'Nublado'], ['chuva', 'Chuva'], ['chuva_forte', 'Chuva forte']]
const rotuloClima = (c: string) => CLIMAS.find(([v]) => v === c)?.[1] ?? c
const hoje = () => new Date().toISOString().slice(0, 10)
const dataBR = (d: string | null) => (d ? d.split('-').reverse().join('/') : '')
const BUCKET = 'projetos-plantas'
const OS_LANCAVEL = (s: string) => s === 'aberta' || s === 'em_execucao'

type Obra = { company_id: string; numero: string | null; nome: string | null; cliente_nome: string | null; cidade: string | null }
type Os = { id: string; numero: string | null; descricao: string | null; status: string }
type Rdo = {
  id: string; os_id: string; data: string; clima: Clima; praticavel: boolean; efetivo: number
  atividades: string | null; ocorrencias: string | null; quantidade_executada: number | null; fotos: string[]; criado_em: string
}
const VAZIO = { os_id: '', data: '', clima: 'sol' as Clima, praticavel: true, efetivo: '', quantidade: '', atividades: '', ocorrencias: '', fotos: [] as string[] }

export default function RdoObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [obra, setObra] = useState<Obra | null>(null)
  const [oss, setOss] = useState<Os[]>([])
  const [rdos, setRdos] = useState<Rdo[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtroOs, setFiltroOs] = useState('')
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
        supabase.from('projetos_obras').select('company_id,numero,nome,cliente_nome,cidade').eq('id', id).maybeSingle(),
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
      setOss(((os.data ?? []) as Os[]))
      setRdos(((rd.data ?? []) as Rdo[]))
      carregou = true
      setLoading(false)
    } catch { setLoading(false); if (!carregou) setErro(MSG_CARREGAMENTO_FALHOU) }
  }, [id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const osMap = useMemo(() => new Map(oss.map((o) => [o.id, o])), [oss])
  const osLancaveis = useMemo(() => oss.filter((o) => OS_LANCAVEL(o.status)), [oss])
  const lista = useMemo(() => filtroOs ? rdos.filter((r) => r.os_id === filtroOs) : rdos, [rdos, filtroOs])
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
    const qtd = fr.quantidade.trim() === '' ? null : Number(fr.quantidade.replace(/\./g, '').replace(',', '.'))
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
          {obra && <> {' '}<b style={{ color: ESP }}>Obra {obra.numero ?? ''}{obra.nome ? ` · ${obra.nome}` : ''}</b>{obra.cliente_nome ? ` — ${obra.cliente_nome}` : ''}{obra.cidade ? ` (${obra.cidade})` : ''}.</>}
        </p>

        {loading && <p style={{ color: MUT }}>Carregando…</p>}
        {erro && <div style={{ ...card, borderColor: VERM, color: VERM, marginBottom: 14 }} role="alert">{erro}</div>}

        {!loading && obra && (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginBottom: 14 }}>
              <label style={{ ...lab, flex: '1 1 220px' }}>
                <span style={rot}>Filtrar por OS <AjudaCampo chave="projetos.obra_rdo.filtro_os" /></span>
                <select value={filtroOs} onChange={(e) => setFiltroOs(e.target.value)} style={inp} data-testid="obra-rdo-filtro-os">
                  <option value="">Todas as OS</option>
                  {oss.map((o) => <option key={o.id} value={o.id}>{rotuloOs(o)}</option>)}
                </select>
              </label>
              <span style={rot}>
                <button type="button" onClick={() => (editando === 'novo' ? fechar() : abrirNovo())} disabled={osLancaveis.length === 0}
                  style={btn(ESP, '#fff')} data-testid="obra-rdo-novo">
                  {editando === 'novo' ? 'Fechar' : '+ Novo diário'}
                </button>
                <AjudaCampo chave="projetos.obra_rdo.novo" />
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
                  <span style={rot}>OS do diário <AjudaCampo chave="projetos.obra_rdo.os" /></span>
                  <select value={fr.os_id} onChange={(e) => setFr({ ...fr, os_id: e.target.value })} disabled={editando !== 'novo'} style={inp} data-testid="obra-rdo-os">
                    {editando !== 'novo'
                      ? <option value={fr.os_id}>{rotuloOs(osMap.get(fr.os_id))}</option>
                      : <>{osLancaveis.length === 0 && <option value="">Sem OS ativa</option>}
                         {osLancaveis.map((o) => <option key={o.id} value={o.id}>{rotuloOs(o)}</option>)}</>}
                  </select>
                </label>
                <label style={lab}>
                  <span style={rot}>Dia <AjudaCampo chave="projetos.os_obra.rdo_data" /></span>
                  <input type="date" value={fr.data} max={hoje()} onChange={(e) => setFr({ ...fr, data: e.target.value })} style={inp} data-testid="obra-rdo-data" />
                </label>
                <label style={lab}>
                  <span style={rot}>Clima <AjudaCampo chave="projetos.os_obra.rdo_clima" /></span>
                  <select value={fr.clima} onChange={(e) => setFr({ ...fr, clima: e.target.value as Clima })} style={inp} data-testid="obra-rdo-clima">
                    {CLIMAS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                  </select>
                </label>
                <label style={lab}>
                  <span style={rot}>Efetivo (pessoas) <AjudaCampo chave="projetos.os_obra.rdo_efetivo" /></span>
                  <input inputMode="numeric" value={fr.efetivo} onChange={(e) => setFr({ ...fr, efetivo: e.target.value.replace(/\D/g, '') })} placeholder="Ex.: 4" style={inp} data-testid="obra-rdo-efetivo" />
                </label>
                <label style={{ ...lab, alignSelf: 'end' }}>
                  <span style={rot}>
                    <input type="checkbox" checked={fr.praticavel} onChange={(e) => setFr({ ...fr, praticavel: e.target.checked })} style={{ width: 20, height: 20 }} data-testid="obra-rdo-praticavel" />
                    Deu para trabalhar <AjudaCampo chave="projetos.os_obra.rdo_praticavel" />
                  </span>
                </label>
                <label style={{ ...lab, gridColumn: '1 / -1' }}>
                  <span style={rot}>Quantidade executada no dia <AjudaCampo chave="projetos.os_obra.rdo_quantidade" /></span>
                  <input inputMode="decimal" value={fr.quantidade} onChange={(e) => setFr({ ...fr, quantidade: e.target.value.replace(/[^\d.,]/g, '') })} placeholder="Ex.: 34 (na unidade do serviço, como m²)" style={inp} data-testid="obra-rdo-quantidade" />
                </label>
                <label style={{ ...lab, gridColumn: '1 / -1' }}>
                  <span style={rot}>O que foi feito <AjudaCampo chave="projetos.os_obra.rdo_atividades" /></span>
                  <textarea value={fr.atividades} onChange={(e) => setFr({ ...fr, atividades: e.target.value })} rows={2} placeholder="Ex.: forro fechado nas salas 201 e 202 (34 m²)" style={{ ...inp, resize: 'vertical' }} data-testid="obra-rdo-atividades" />
                </label>
                <label style={{ ...lab, gridColumn: '1 / -1' }}>
                  <span style={rot}>Ocorrências <AjudaCampo chave="projetos.os_obra.rdo_ocorrencias" /></span>
                  <textarea value={fr.ocorrencias} onChange={(e) => setFr({ ...fr, ocorrencias: e.target.value })} rows={2} placeholder="Ex.: faltou perfil de 3 m; chuva parou o serviço às 14h" style={{ ...inp, resize: 'vertical' }} data-testid="obra-rdo-ocorrencias" />
                </label>
                <label style={{ ...lab, gridColumn: '1 / -1' }}>
                  <span style={rot}>Fotos ({fr.fotos.length + novasFotos.length}/10) <AjudaCampo chave="projetos.os_obra.rdo_fotos" /></span>
                  <input type="file" accept="image/*" capture="environment" multiple onChange={(e) => setNovasFotos(Array.from(e.target.files ?? []))} style={{ ...inp, padding: 8 }} data-testid="obra-rdo-fotos" />
                </label>
                {fr.fotos.length > 0 && (
                  <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {fr.fotos.map((p) => <button key={p} type="button" onClick={() => verFoto(p)} style={{ ...btn('#fff', ESP), fontSize: 12 }}>Ver foto</button>)}
                  </div>
                )}
                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button type="submit" disabled={ocupado || !fr.os_id} style={btn(ESP, '#fff')} data-testid="obra-rdo-salvar">{ocupado ? 'Salvando…' : editando === 'novo' ? 'Salvar diário' : 'Atualizar diário'}</button>
                  <AjudaCampo chave="projetos.os_obra.rdo_salvar" />
                  <button type="button" onClick={fechar} style={btn('#fff', ESP)}>Cancelar</button>
                </div>
              </form>
            )}

            <h2 style={{ fontSize: 15, fontWeight: 700, margin: '4px 0 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
              Histórico de diários <AjudaCampo chave="projetos.obra_rdo.historico" /> <span style={{ color: MUT, fontWeight: 400 }}>({lista.length})</span>
            </h2>
            {lista.length === 0
              ? <p style={{ color: MUT, fontSize: 14 }}>Nenhum diário lançado{filtroOs ? ' para esta OS' : ''} ainda.</p>
              : <div style={{ display: 'grid', gap: 10 }}>
                  {lista.map((r) => {
                    const o = osMap.get(r.os_id)
                    const editavel = o ? OS_LANCAVEL(o.status) : false
                    return (
                      <div key={r.id} style={card} data-testid="obra-rdo-item">
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                          <strong style={{ fontSize: 15 }}>{dataBR(r.data)}</strong>
                          <span style={{ fontSize: 12, color: MUT }}>{rotuloOs(o)}</span>
                        </div>
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
                          {editavel && <button type="button" onClick={() => abrirEdicao(r)} style={btn('#fff', ESP)} data-testid="obra-rdo-editar">Editar</button>}
                          <span style={rot}>
                            <button type="button" onClick={() => excluir(r)} disabled={excluindo === r.id} style={btn('#fff', VERM)} data-testid="obra-rdo-excluir">{excluindo === r.id ? 'Excluindo…' : 'Excluir'}</button>
                            <AjudaCampo chave="projetos.obra_rdo.excluir" />
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
