'use client'
// Hub · Gestão de Obras · Ficha da obra — classificação (blueprint vivo tela 314).
// Duas classificações que definem como o financeiro da obra é tratado:
//  • Execução: obra própria × gerenciada para terceiros. [escopo 2]
//  • Modelo de contratação: administração, empreitada global, empreitada por preço unitário, outro.
// Leitura/gravação guardadas por empresa (fn_obra_ficha_ler / fn_obra_ficha_salvar). Aberta pelo cockpit.
import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ehUuid, erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/projetos/obras/[id]/ficha'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', VERM = '#B91C1C'
const campo = { width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${LINE}`, fontSize: 14, background: '#fff', color: ESP, boxSizing: 'border-box' as const }

const EXECUCAO = [
  { v: 'propria', l: 'Própria — da própria empresa' },
  { v: 'terceiros', l: 'Para terceiros — gerenciada para o contratante' },
]
const MODELOS = [
  { v: 'administracao', l: 'Administração (taxa sobre o custo)' },
  { v: 'empreitada_global', l: 'Empreitada global (preço fechado)' },
  { v: 'empreitada_preco_unitario', l: 'Empreitada por preço unitário (por item medido)' },
  { v: 'outro', l: 'Outro' },
]

const EDIFICACAO = [
  { v: 'residencial', l: 'Residencial' },
  { v: 'comercial', l: 'Comercial' },
  { v: 'industrial', l: 'Industrial' },
  { v: 'misto', l: 'Misto' },
]

// Situação da obra — domínio existente da coluna projetos_obras.status (não inventar valor: há CHECK no banco).
const SITUACAO = [
  { v: 'em_andamento', l: 'Em andamento' },
  { v: 'pausada', l: 'Pausada' },
  { v: 'concluida', l: 'Concluída' },
  { v: 'cancelada', l: 'Cancelada' },
]

// Dados técnicos da obra (tela 314 · escopo 5): padrão construtivo e sistema estrutural.
const PADRAO = [
  { v: 'popular', l: 'Popular' },
  { v: 'normal', l: 'Normal' },
  { v: 'alto', l: 'Alto' },
  { v: 'luxo', l: 'Luxo' },
]
const SISTEMA = [
  { v: 'alvenaria_estrutural', l: 'Alvenaria estrutural' },
  { v: 'concreto_armado', l: 'Concreto armado' },
  { v: 'estrutura_metalica', l: 'Estrutura metálica' },
  { v: 'madeira', l: 'Madeira' },
  { v: 'pre_moldado', l: 'Pré-moldado' },
  { v: 'misto', l: 'Misto' },
  { v: 'outro', l: 'Outro' },
]

type Ficha = { ok: boolean; numero?: string; nome?: string | null; cliente_nome?: string | null; tipo_execucao?: string | null; modelo_contratacao?: string | null; matricula?: string | null; inscricao_imobiliaria?: string | null; tipo_edificacao?: string | null; area_construida_m2?: number | null; area_terreno_m2?: number | null; endereco?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null; cep?: string | null; erro?: string }

export default function FichaObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [numero, setNumero] = useState<string | null>(null)
  const [nome, setNome] = useState<string | null>(null)
  const [cliente, setCliente] = useState<string | null>(null)
  const [tipo, setTipo] = useState('')
  const [modelo, setModelo] = useState('')
  // Andamento da obra — situação, datas e % de conclusão (tela 314 gaps 1-3; colunas já existentes)
  const [status, setStatus] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataPrevistaFim, setDataPrevistaFim] = useState('')
  const [dataConclusao, setDataConclusao] = useState('')
  const [pctConclusao, setPctConclusao] = useState('')
  const [busyAnd, setBusyAnd] = useState(false)
  const [okAnd, setOkAnd] = useState(false)
  // Identidade do imóvel
  const [matricula, setMatricula] = useState('')
  const [inscricao, setInscricao] = useState('')
  const [tipoEdif, setTipoEdif] = useState('')
  const [areaConstruida, setAreaConstruida] = useState('')
  const [areaTerreno, setAreaTerreno] = useState('')
  // Dados técnicos
  const [padrao, setPadrao] = useState('')
  const [sistema, setSistema] = useState('')
  // Endereço da obra
  const [endereco, setEndereco] = useState('')
  const [bairro, setBairro] = useState('')
  const [cidade, setCidade] = useState('')
  const [uf, setUf] = useState('')
  const [cep, setCep] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [busyId, setBusyId] = useState(false)
  const [busyTec, setBusyTec] = useState(false)
  const [busyEnd, setBusyEnd] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [okId, setOkId] = useState(false)
  const [okTec, setOkTec] = useState(false)
  const [okEnd, setOkEnd] = useState(false)
  // Localização no mapa (tela 314 crit. h): pino lat/long derivado do CEP, sem migration.
  const [coord, setCoord] = useState<{ lat: number; lon: number } | null>(null)
  const [mapaMsg, setMapaMsg] = useState<string | null>(null)
  // Regularização na ficha (tela 314: "Na ficha: alvará e licenças com validade, CNO, ARTs e RRTs").
  // Resumo a partir do dado real já existente (fn_obra_licenca_listar); sem migration, só leitura.
  const [reg, setReg] = useState<{
    total: number; vencidos: number; vence30: number; proxima: string | null
    cno: string[]; artRrt: { tipo: string; numero: string; responsavel: string | null }[]; tecnicos: string[]
  } | null>(null)

  // Área: aceita "1250" ou "1.250,50"; vira número só na hora de salvar (null quando vazio).
  const areaNum = (s: string): number | null => {
    const t = String(s).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
    if (t.trim() === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }

  const carregar = useCallback(async () => {
    if (!ehUuid(id)) { setLoading(false); setErro('Obra não encontrada. Abra pela lista de obras.'); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_ficha_ler', { p_obra_id: id })
    setLoading(false)
    const j = data as Ficha | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível carregar a ficha da obra.')); return }
    setNumero(j.numero ?? null); setNome(j.nome ?? null); setCliente(j.cliente_nome ?? null)
    setTipo(j.tipo_execucao ?? ''); setModelo(j.modelo_contratacao ?? '')
    setMatricula(j.matricula ?? ''); setInscricao(j.inscricao_imobiliaria ?? ''); setTipoEdif(j.tipo_edificacao ?? '')
    setAreaConstruida(j.area_construida_m2 != null ? String(j.area_construida_m2) : '')
    setAreaTerreno(j.area_terreno_m2 != null ? String(j.area_terreno_m2) : '')
    // Andamento vem de leitor próprio (collision-free; fn_obra_ficha_ler não é tocado por esta fatia)
    const { data: andData } = await supabase.rpc('fn_obra_ficha_andamento_ler', { p_obra_id: id })
    const a = andData as { ok?: boolean; status?: string | null; data_inicio?: string | null; data_prevista_fim?: string | null; data_conclusao?: string | null; pct_conclusao?: number | null } | null
    if (a && a.ok) {
      setStatus(a.status ?? ''); setDataInicio(a.data_inicio ?? ''); setDataPrevistaFim(a.data_prevista_fim ?? '')
      setDataConclusao(a.data_conclusao ?? ''); setPctConclusao(a.pct_conclusao != null ? String(a.pct_conclusao) : '')
    }
    // Dados técnicos — leitor próprio (não depende de fn_obra_ficha_ler); falha aqui não derruba a ficha.
    const { data: t } = await supabase.rpc('fn_obra_ficha_tecnica_ler', { p_obra_id: id })
    const jt = t as { ok?: boolean; padrao_construtivo?: string | null; sistema_estrutural?: string | null } | null
    if (jt?.ok) { setPadrao(jt.padrao_construtivo ?? ''); setSistema(jt.sistema_estrutural ?? '') }
    // Endereço vem de um leitor próprio (collision-free; fn_obra_ficha_ler não é tocado por esta fatia)
    const { data: endData } = await supabase.rpc('fn_obra_ficha_endereco_ler', { p_obra_id: id })
    const e = endData as Ficha | null
    if (e && e.ok) {
      setEndereco(e.endereco ?? ''); setBairro(e.bairro ?? ''); setCidade(e.cidade ?? '')
      setUf(e.uf ?? ''); setCep(e.cep ?? '')
    }
    // Resumo da regularização (alvará e licenças) a partir do dado real. Falha aqui não derruba a ficha.
    try {
      const { data: licData } = await supabase.rpc('fn_obra_licenca_listar', { p_obra_id: id })
      const lic = licData as { ok?: boolean; itens?: { tipo: string; numero: string | null; responsavel: string | null; validade: string | null; situacao: string }[] } | null
      if (lic && lic.ok) {
        const itens = lic.itens ?? []
        const vencidos = itens.filter((l) => l.situacao === 'vencido').length
        const vence30 = itens.filter((l) => l.situacao === 'vence_30').length
        const proxima = itens
          .filter((l) => l.validade && l.situacao !== 'vencido')
          .map((l) => l.validade as string)
          .sort()[0] ?? null
        // Gap 5 (requisito 167f8e9c): CNO, ART/RRT e responsáveis técnicos à vista na ficha (só leitura).
        const cno = itens.filter((l) => l.tipo === 'cno' && l.numero).map((l) => l.numero as string)
        const artRrt = itens
          .filter((l) => (l.tipo === 'art' || l.tipo === 'rrt') && (l.numero || l.responsavel))
          .map((l) => ({ tipo: l.tipo, numero: l.numero ?? '', responsavel: l.responsavel }))
        const tecnicos = Array.from(new Set(itens.map((l) => (l.responsavel ?? '').trim()).filter((r) => r !== '')))
        setReg({ total: itens.length, vencidos, vence30, proxima, cno, artRrt, tecnicos })
      } else {
        setReg({ total: 0, vencidos: 0, vence30: 0, proxima: null, cno: [], artRrt: [], tecnicos: [] })
      }
    } catch { setReg({ total: 0, vencidos: 0, vence30: 0, proxima: null, cno: [], artRrt: [], tecnicos: [] }) }
  }, [id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  // Deriva lat/long do CEP pela BrasilAPI v2 (mesmo provedor do helper buscarCEP). A v2 traz
  // location.coordinates quando o CEP tem geolocalização; sem coordenada o mapa cai no modo
  // "abrir por endereço" — nunca um pino falso (RD-51). Só-leitura, sem migration.
  useEffect(() => {
    const clean = cep.replace(/\D/g, '')
    if (clean.length !== 8) { setCoord(null); setMapaMsg(null); return }
    let vivo = true
    setMapaMsg('Localizando o CEP no mapa…')
    void (async () => {
      try {
        const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${clean}`)
        if (!vivo) return
        if (!res.ok) { setCoord(null); setMapaMsg(null); return }
        const data = await res.json()
        const c = data?.location?.coordinates
        const lat = Number(c?.latitude), lon = Number(c?.longitude)
        if (!vivo) return
        if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) { setCoord({ lat, lon }); setMapaMsg(null) }
        else { setCoord(null); setMapaMsg(null) }
      } catch { if (vivo) { setCoord(null); setMapaMsg(null) } }
    })()
    return () => { vivo = false }
  }, [cep])

  const salvar = async () => {
    setBusy(true); setErro(null); setOk(false)
    const { data, error } = await supabase.rpc('fn_obra_ficha_salvar', {
      p_obra_id: id, p_tipo_execucao: tipo || null, p_modelo_contratacao: modelo || null,
    })
    setBusy(false)
    const j = data as Ficha | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível salvar a ficha.')); return }
    setOk(true)
  }

  // % aceita "0".."100" (vírgula ou ponto); vazio → null
  const pctNum = (s: string): number | null => {
    const t = String(s).replace(/[^\d,.-]/g, '').replace(',', '.')
    if (t.trim() === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }

  const salvarAndamento = async () => {
    setBusyAnd(true); setErro(null); setOkAnd(false)
    const { data, error } = await supabase.rpc('fn_obra_ficha_andamento_salvar', {
      p_obra_id: id, p_status: status || null,
      p_data_inicio: dataInicio || null, p_data_prevista_fim: dataPrevistaFim || null,
      p_data_conclusao: dataConclusao || null, p_pct_conclusao: pctNum(pctConclusao),
    })
    setBusyAnd(false)
    const j = data as Ficha | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível salvar o andamento da obra.')); return }
    setOkAnd(true)
  }

  const salvarIdentidade = async () => {
    setBusyId(true); setErro(null); setOkId(false)
    const { data, error } = await supabase.rpc('fn_obra_ficha_identidade_salvar', {
      p_obra_id: id, p_matricula: matricula || null, p_inscricao_imobiliaria: inscricao || null,
      p_tipo_edificacao: tipoEdif || null, p_area_construida_m2: areaNum(areaConstruida), p_area_terreno_m2: areaNum(areaTerreno),
    })
    setBusyId(false)
    const j = data as Ficha | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível salvar a identidade da obra.')); return }
    setOkId(true)
  }

  const salvarTecnica = async () => {
    setBusyTec(true); setErro(null); setOkTec(false)
    const { data, error } = await supabase.rpc('fn_obra_ficha_tecnica_salvar', {
      p_obra_id: id, p_padrao_construtivo: padrao || null, p_sistema_estrutural: sistema || null,
    })
    setBusyTec(false)
    const j = data as Ficha | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível salvar os dados técnicos.')); return }
    setOkTec(true)
  }

  const salvarEndereco = async () => {
    setBusyEnd(true); setErro(null); setOkEnd(false)
    const { data, error } = await supabase.rpc('fn_obra_ficha_endereco_salvar', {
      p_obra_id: id, p_endereco: endereco || null, p_bairro: bairro || null,
      p_cidade: cidade || null, p_uf: uf || null, p_cep: cep || null,
    })
    setBusyEnd(false)
    const j = data as Ficha | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível salvar o endereço da obra.')); return }
    setOkEnd(true)
  }

  // dd/mm/aaaa a partir de 'YYYY-MM-DD' (sem fuso: a validade é uma data, não um instante).
  const fmtData = (iso: string | null): string => {
    if (!iso) return '—'
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
  }

  const enderecoBusca = [endereco, bairro, cidade, uf, cep].map((s) => (s ?? '').trim()).filter(Boolean).join(', ')
  const temEndereco = enderecoBusca.length > 0
  const D = 0.004 // ~400 m de janela ao redor do ponto
  const mapaEmbed = coord ? `https://www.openstreetmap.org/export/embed.html?bbox=${coord.lon - D},${coord.lat - D},${coord.lon + D},${coord.lat + D}&layer=mapnik&marker=${coord.lat},${coord.lon}` : null
  const mapaLink = coord
    ? `https://www.openstreetmap.org/?mlat=${coord.lat}&mlon=${coord.lon}#map=17/${coord.lat}/${coord.lon}`
    : (temEndereco ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(enderecoBusca)}` : null)

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }} data-testid="hub-obra-ficha">
        <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Cockpit da obra</Link>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 8 }}>Hub · Obra</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: ESP, margin: '2px 0 4px' }}>Ficha da obra</h1>
        {(numero || nome || cliente) && (
          <div style={{ fontSize: 13, color: MUT, marginBottom: 14 }}>{[numero && `${numero}${nome ? ` — ${nome}` : ''}`, cliente].filter(Boolean).join(' · ')}</div>
        )}

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div>
          : (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, display: 'grid', gap: 14 }}>
                <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                  <span>Execução da obra<AjudaCampo chave="projetos.obra_ficha.tipo_execucao" rota={ROTA} /></span>
                  <select data-testid="ficha-tipo-execucao" style={campo} value={tipo} onChange={(e) => { setTipo(e.target.value); setOk(false) }}>
                    <option value="">Não classificada</option>
                    {EXECUCAO.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                  <span>Modelo de contratação<AjudaCampo chave="projetos.obra_ficha.modelo_contratacao" rota={ROTA} /></span>
                  <select data-testid="ficha-modelo-contratacao" style={campo} value={modelo} onChange={(e) => { setModelo(e.target.value); setOk(false) }}>
                    <option value="">Não informado</option>
                    {MODELOS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </label>
                <div style={{ fontSize: 11, color: MUT }}>A classificação alimenta o resultado por obra e orienta como medir e faturar. Pode ser ajustada a qualquer momento.</div>
                {ok && <div data-testid="ficha-ok" style={{ background: '#EAF6EC', color: VERDE, borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 600 }}>Classificação salva.</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button data-testid="ficha-salvar" disabled={busy} onClick={() => void salvar()}
                    style={{ flex: 1, padding: '12px 16px', borderRadius: 8, border: 'none', background: ESP, color: '#fff', fontSize: 14, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
                    {busy ? 'Salvando…' : 'Salvar classificação'}
                  </button>
                  <AjudaCampo chave="projetos.obra_ficha.salvar" rota={ROTA} />
                </div>
              </div>

              {/* Andamento da obra — situação, datas e % de conclusão (tela 314 gaps 1-3; colunas já existentes) */}
              <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, display: 'grid', gap: 14 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: GOLD, fontWeight: 700 }}>Andamento da obra</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                    <span>Situação da obra<AjudaCampo chave="projetos.obra_ficha.status" rota={ROTA} /></span>
                    <select data-testid="ficha-status" style={campo} value={status} onChange={(e) => { setStatus(e.target.value); setOkAnd(false) }}>
                      <option value="">Não informada</option>
                      {SITUACAO.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                    <span>% de conclusão<AjudaCampo chave="projetos.obra_ficha.pct_conclusao" rota={ROTA} /></span>
                    <input data-testid="ficha-pct-conclusao" inputMode="decimal" style={campo} value={pctConclusao} placeholder="0 a 100" onChange={(e) => { setPctConclusao(e.target.value); setOkAnd(false) }} />
                  </label>
                </div>
                <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                  <span>Início (efetivo)<AjudaCampo chave="projetos.obra_ficha.data_inicio" rota={ROTA} /></span>
                  <input data-testid="ficha-data-inicio" type="date" style={campo} value={dataInicio} onChange={(e) => { setDataInicio(e.target.value); setOkAnd(false) }} />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                    <span>Previsão de término<AjudaCampo chave="projetos.obra_ficha.data_prevista_fim" rota={ROTA} /></span>
                    <input data-testid="ficha-data-prevista-fim" type="date" style={campo} value={dataPrevistaFim} onChange={(e) => { setDataPrevistaFim(e.target.value); setOkAnd(false) }} />
                  </label>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                    <span>Conclusão (efetiva)<AjudaCampo chave="projetos.obra_ficha.data_conclusao" rota={ROTA} /></span>
                    <input data-testid="ficha-data-conclusao" type="date" style={campo} value={dataConclusao} onChange={(e) => { setDataConclusao(e.target.value); setOkAnd(false) }} />
                  </label>
                </div>
                <div style={{ fontSize: 11, color: MUT }}>A situação e o avanço aparecem nos painéis e nas listas de obras. Preencha a conclusão só quando a obra terminar.</div>
                {okAnd && <div data-testid="ficha-andamento-ok" style={{ background: '#EAF6EC', color: VERDE, borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 600 }}>Andamento salvo.</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button data-testid="ficha-salvar-andamento" disabled={busyAnd} onClick={() => void salvarAndamento()}
                    style={{ flex: 1, padding: '12px 16px', borderRadius: 8, border: 'none', background: ESP, color: '#fff', fontSize: 14, fontWeight: 700, cursor: busyAnd ? 'wait' : 'pointer' }}>
                    {busyAnd ? 'Salvando…' : 'Salvar andamento'}
                  </button>
                  <AjudaCampo chave="projetos.obra_ficha.salvar_andamento" rota={ROTA} />
                </div>
              </div>

              {/* Identidade do imóvel — matrícula, inscrição, tipo e áreas (tela 314 "ficha da obra") */}
              <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, display: 'grid', gap: 14 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: GOLD, fontWeight: 700 }}>Identidade do imóvel</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                    <span>Matrícula<AjudaCampo chave="projetos.obra_ficha.matricula" rota={ROTA} /></span>
                    <input data-testid="ficha-matricula" style={campo} value={matricula} placeholder="Matrícula do imóvel" onChange={(e) => { setMatricula(e.target.value); setOkId(false) }} />
                  </label>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                    <span>Inscrição imobiliária<AjudaCampo chave="projetos.obra_ficha.inscricao_imobiliaria" rota={ROTA} /></span>
                    <input data-testid="ficha-inscricao" style={campo} value={inscricao} placeholder="Cadastro na prefeitura" onChange={(e) => { setInscricao(e.target.value); setOkId(false) }} />
                  </label>
                </div>
                <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                  <span>Tipo de edificação<AjudaCampo chave="projetos.obra_ficha.tipo_edificacao" rota={ROTA} /></span>
                  <select data-testid="ficha-tipo-edificacao" style={campo} value={tipoEdif} onChange={(e) => { setTipoEdif(e.target.value); setOkId(false) }}>
                    <option value="">Não informado</option>
                    {EDIFICACAO.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                    <span>Área construída (m²)<AjudaCampo chave="projetos.obra_ficha.area_construida" rota={ROTA} /></span>
                    <input data-testid="ficha-area-construida" inputMode="decimal" style={campo} value={areaConstruida} placeholder="m²" onChange={(e) => { setAreaConstruida(e.target.value); setOkId(false) }} />
                  </label>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                    <span>Área do terreno (m²)<AjudaCampo chave="projetos.obra_ficha.area_terreno" rota={ROTA} /></span>
                    <input data-testid="ficha-area-terreno" inputMode="decimal" style={campo} value={areaTerreno} placeholder="m²" onChange={(e) => { setAreaTerreno(e.target.value); setOkId(false) }} />
                  </label>
                </div>
                {okId && <div data-testid="ficha-identidade-ok" style={{ background: '#EAF6EC', color: VERDE, borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 600 }}>Identidade salva.</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button data-testid="ficha-salvar-identidade" disabled={busyId} onClick={() => void salvarIdentidade()}
                    style={{ flex: 1, padding: '12px 16px', borderRadius: 8, border: 'none', background: ESP, color: '#fff', fontSize: 14, fontWeight: 700, cursor: busyId ? 'wait' : 'pointer' }}>
                    {busyId ? 'Salvando…' : 'Salvar identidade'}
                  </button>
                  <AjudaCampo chave="projetos.obra_ficha.salvar_identidade" rota={ROTA} />
                </div>
              </div>

              {/* Dados técnicos da obra — padrão construtivo e sistema estrutural (tela 314 · escopo 5) */}
              <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, display: 'grid', gap: 14 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: GOLD, fontWeight: 700 }}>Dados técnicos da obra</div>
                <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                  <span>Padrão construtivo<AjudaCampo chave="projetos.obra_ficha.padrao_construtivo" rota={ROTA} /></span>
                  <select data-testid="ficha-padrao-construtivo" style={campo} value={padrao} onChange={(e) => { setPadrao(e.target.value); setOkTec(false) }}>
                    <option value="">Não informado</option>
                    {PADRAO.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                  <span>Sistema estrutural<AjudaCampo chave="projetos.obra_ficha.sistema_estrutural" rota={ROTA} /></span>
                  <select data-testid="ficha-sistema-estrutural" style={campo} value={sistema} onChange={(e) => { setSistema(e.target.value); setOkTec(false) }}>
                    <option value="">Não informado</option>
                    {SISTEMA.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </label>
                {okTec && <div data-testid="ficha-tecnica-ok" style={{ background: '#EAF6EC', color: VERDE, borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 600 }}>Dados técnicos salvos.</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button data-testid="ficha-salvar-tecnica" disabled={busyTec} onClick={() => void salvarTecnica()}
                    style={{ flex: 1, padding: '12px 16px', borderRadius: 8, border: 'none', background: ESP, color: '#fff', fontSize: 14, fontWeight: 700, cursor: busyTec ? 'wait' : 'pointer' }}>
                    {busyTec ? 'Salvando…' : 'Salvar dados técnicos'}
                  </button>
                  <AjudaCampo chave="projetos.obra_ficha.salvar_tecnica" rota={ROTA} />
                </div>
              </div>

              {/* Endereço da obra — logradouro, bairro, cidade, UF e CEP (tela 314 "ficha da obra") */}
              <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, display: 'grid', gap: 14 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: GOLD, fontWeight: 700 }}>Endereço da obra</div>
                <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                  <span>Endereço<AjudaCampo chave="projetos.obra_ficha.endereco" rota={ROTA} /></span>
                  <input data-testid="ficha-endereco" style={campo} value={endereco} placeholder="Logradouro e número" onChange={(e) => { setEndereco(e.target.value); setOkEnd(false) }} />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                    <span>Bairro<AjudaCampo chave="projetos.obra_ficha.bairro" rota={ROTA} /></span>
                    <input data-testid="ficha-bairro" style={campo} value={bairro} placeholder="Bairro" onChange={(e) => { setBairro(e.target.value); setOkEnd(false) }} />
                  </label>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                    <span>CEP<AjudaCampo chave="projetos.obra_ficha.cep" rota={ROTA} /></span>
                    <input data-testid="ficha-cep" inputMode="numeric" style={campo} value={cep} placeholder="00000-000" onChange={(e) => { setCep(e.target.value); setOkEnd(false) }} />
                  </label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                    <span>Cidade<AjudaCampo chave="projetos.obra_ficha.cidade" rota={ROTA} /></span>
                    <input data-testid="ficha-cidade" style={campo} value={cidade} placeholder="Município" onChange={(e) => { setCidade(e.target.value); setOkEnd(false) }} />
                  </label>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                    <span>UF<AjudaCampo chave="projetos.obra_ficha.uf" rota={ROTA} /></span>
                    <input data-testid="ficha-uf" maxLength={2} style={{ ...campo, textTransform: 'uppercase' }} value={uf} placeholder="SC" onChange={(e) => { setUf(e.target.value.toUpperCase()); setOkEnd(false) }} />
                  </label>
                </div>
                {okEnd && <div data-testid="ficha-endereco-ok" style={{ background: '#EAF6EC', color: VERDE, borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 600 }}>Endereço salvo.</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button data-testid="ficha-salvar-endereco" disabled={busyEnd} onClick={() => void salvarEndereco()}
                    style={{ flex: 1, padding: '12px 16px', borderRadius: 8, border: 'none', background: ESP, color: '#fff', fontSize: 14, fontWeight: 700, cursor: busyEnd ? 'wait' : 'pointer' }}>
                    {busyEnd ? 'Salvando…' : 'Salvar endereço'}
                  </button>
                  <AjudaCampo chave="projetos.obra_ficha.salvar_endereco" rota={ROTA} />
                </div>

                {/* Localização no mapa — pino lat/long (tela 314, critério h). Sem coordenada do CEP, abre pela busca do endereço; nunca um pino falso. */}
                <div data-testid="ficha-mapa" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 12, display: 'grid', gap: 8 }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: GOLD, fontWeight: 700 }}>Localização no mapa</div>
                  {mapaEmbed && coord ? (
                    <>
                      <iframe title="Mapa da obra" data-testid="ficha-mapa-embed" src={mapaEmbed} loading="lazy" referrerPolicy="no-referrer"
                        style={{ width: '100%', height: 220, border: `1px solid ${LINE}`, borderRadius: 8 }} />
                      <div style={{ fontSize: 11, color: MUT }}>Ponto aproximado pelo CEP: {coord.lat.toFixed(5)}, {coord.lon.toFixed(5)}.</div>
                    </>
                  ) : (
                    <div style={{ fontSize: 12, color: MUT }}>
                      {mapaMsg
                        ? mapaMsg
                        : temEndereco
                          ? 'Este CEP não tem coordenada para fixar o pino. Use “Abrir no mapa” para ver pelo endereço.'
                          : 'Informe o endereço e o CEP acima para localizar a obra no mapa.'}
                    </div>
                  )}
                  {mapaLink && (
                    <a data-testid="ficha-mapa-link" href={mapaLink} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 13, color: GOLD, fontWeight: 600, textDecoration: 'none' }}>Abrir no mapa →</a>
                  )}
                </div>
              </div>

              {/* Regularização (alvará e licenças) — tela 314 "Na ficha: alvará e licenças com validade, CNO, ARTs e RRTs".
                  Resumo do dado real (fn_obra_licenca_listar); o detalhe e o cadastro ficam na Regularização da obra. */}
              <div data-testid="ficha-regularizacao" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: GOLD, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    Regularização (alvará e licenças)<AjudaCampo chave="projetos.cockpit.regularizacao" rota={ROTA} />
                  </span>
                  <Link href={`/dashboard/projetos/obras/${id}/regularizacao?area=hub`} data-testid="ficha-regularizacao-link"
                    style={{ fontSize: 13, color: GOLD, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                    Abrir →
                  </Link>
                </div>
                {reg === null ? (
                  <div style={{ fontSize: 12, color: MUT }}>Carregando…</div>
                ) : reg.total === 0 ? (
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div style={{ fontSize: 13, color: MUT }}>Nenhum documento de regularização cadastrado. Cadastre alvará, licenças, CNO, ART/RRT e habite-se com validade para acompanhar o que vence.</div>
                    <Link href={`/dashboard/projetos/obras/${id}/regularizacao?area=hub`} data-testid="ficha-regularizacao-cta"
                      style={{ justifySelf: 'start', padding: '10px 14px', borderRadius: 8, background: ESP, color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
                      Cadastrar documento
                    </Link>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      <span data-testid="ficha-reg-total" style={{ fontSize: 13, color: ESP, fontWeight: 600 }}>{reg.total} {reg.total === 1 ? 'documento' : 'documentos'}</span>
                      {reg.vencidos > 0 && (
                        <span data-testid="ficha-reg-vencidos" style={{ fontSize: 12, fontWeight: 700, color: VERM, background: '#FBEAEA', borderRadius: 999, padding: '2px 10px' }}>{reg.vencidos} vencido{reg.vencidos === 1 ? '' : 's'}</span>
                      )}
                      {reg.vence30 > 0 && (
                        <span data-testid="ficha-reg-vence30" style={{ fontSize: 12, fontWeight: 700, color: '#92600A', background: '#FBF1DD', borderRadius: 999, padding: '2px 10px' }}>{reg.vence30} vence em 30 dias</span>
                      )}
                      {reg.vencidos === 0 && reg.vence30 === 0 && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: VERDE, background: '#EAF6EC', borderRadius: 999, padding: '2px 10px' }}>Em dia</span>
                      )}
                    </div>
                    {reg.proxima && <div style={{ fontSize: 12, color: MUT }}>Próxima validade: {fmtData(reg.proxima)}.</div>}
                    {/* Gap 5 (requisito 167f8e9c): CNO, ART/RRT e responsáveis técnicos à vista (só leitura) */}
                    {(reg.cno.length > 0 || reg.artRrt.length > 0 || reg.tecnicos.length > 0) && (
                      <div data-testid="ficha-reg-tecnicos" style={{ display: 'grid', gap: 6, marginTop: 2, paddingTop: 10, borderTop: `0.5px solid ${LINE}` }}>
                        <div style={{ fontSize: 11, color: MUT, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          CNO, ART/RRT e responsáveis técnicos<AjudaCampo chave="projetos.obra_ficha.reg_tecnicos" rota={ROTA} />
                        </div>
                        {reg.cno.length > 0 && (
                          <div data-testid="ficha-reg-cno" style={{ fontSize: 13, color: ESP }}>
                            <strong style={{ fontWeight: 700 }}>CNO:</strong> {reg.cno.join(' · ')}
                          </div>
                        )}
                        {reg.artRrt.map((a, i) => (
                          <div key={i} data-testid="ficha-reg-artrrt" style={{ fontSize: 13, color: ESP }}>
                            <strong style={{ fontWeight: 700 }}>{a.tipo.toUpperCase()}</strong>
                            {a.numero ? ` ${a.numero}` : ''}{a.responsavel ? ` — ${a.responsavel}` : ''}
                          </div>
                        ))}
                        {reg.tecnicos.length > 0 && (
                          <div data-testid="ficha-reg-responsaveis" style={{ fontSize: 12, color: MUT }}>
                            Responsáveis técnicos: {reg.tecnicos.join(', ')}.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {erro && <div role="alert" data-testid="ficha-erro" style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: 10, fontSize: 13 }}>{erro}</div>}
            </div>
          )}
      </div>
    </div>
  )
}
