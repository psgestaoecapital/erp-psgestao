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

type Ficha = { ok: boolean; numero?: string; nome?: string | null; cliente_nome?: string | null; tipo_execucao?: string | null; modelo_contratacao?: string | null; matricula?: string | null; inscricao_imobiliaria?: string | null; tipo_edificacao?: string | null; area_construida_m2?: number | null; area_terreno_m2?: number | null; endereco?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null; cep?: string | null; latitude?: number | null; longitude?: number | null; erro?: string }

export default function FichaObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [numero, setNumero] = useState<string | null>(null)
  const [nome, setNome] = useState<string | null>(null)
  const [cliente, setCliente] = useState<string | null>(null)
  const [tipo, setTipo] = useState('')
  const [modelo, setModelo] = useState('')
  // Identidade do imóvel
  const [matricula, setMatricula] = useState('')
  const [inscricao, setInscricao] = useState('')
  const [tipoEdif, setTipoEdif] = useState('')
  const [areaConstruida, setAreaConstruida] = useState('')
  const [areaTerreno, setAreaTerreno] = useState('')
  // Endereço da obra
  const [endereco, setEndereco] = useState('')
  const [bairro, setBairro] = useState('')
  const [cidade, setCidade] = useState('')
  const [uf, setUf] = useState('')
  const [cep, setCep] = useState('')
  // Ponto no mapa (tela 314 "ficha da obra" — latitude/longitude)
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [busyId, setBusyId] = useState(false)
  const [busyEnd, setBusyEnd] = useState(false)
  const [busyMapa, setBusyMapa] = useState(false)
  const [locBusy, setLocBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [okId, setOkId] = useState(false)
  const [okEnd, setOkEnd] = useState(false)
  const [okMapa, setOkMapa] = useState(false)
  // Regularização na ficha (tela 314: "Na ficha: alvará e licenças com validade, CNO, ARTs e RRTs").
  // Resumo a partir do dado real já existente (fn_obra_licenca_listar); sem migration, só leitura.
  const [reg, setReg] = useState<{ total: number; vencidos: number; vence30: number; proxima: string | null } | null>(null)

  // Área: aceita "1250" ou "1.250,50"; vira número só na hora de salvar (null quando vazio).
  const areaNum = (s: string): number | null => {
    const t = String(s).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
    if (t.trim() === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }

  // Coordenada: aceita "-27,1005" ou "-27.1005"; null quando vazio.
  const coordNum = (s: string): number | null => {
    const t = String(s).trim().replace(',', '.')
    if (t === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  const latN = coordNum(lat)
  const lngN = coordNum(lng)
  const temPonto = latN != null && lngN != null
  // Mini-mapa OpenStreetMap (embed, sem dependência): bbox ~1km ao redor do pino.
  const mapaSrc = temPonto
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${(lngN - 0.01).toFixed(6)}%2C${(latN - 0.01).toFixed(6)}%2C${(lngN + 0.01).toFixed(6)}%2C${(latN + 0.01).toFixed(6)}&layer=mapnik&marker=${latN.toFixed(6)}%2C${lngN.toFixed(6)}`
    : null

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
    // Endereço vem de um leitor próprio (collision-free; fn_obra_ficha_ler não é tocado por esta fatia)
    const { data: endData } = await supabase.rpc('fn_obra_ficha_endereco_ler', { p_obra_id: id })
    const e = endData as Ficha | null
    if (e && e.ok) {
      setEndereco(e.endereco ?? ''); setBairro(e.bairro ?? ''); setCidade(e.cidade ?? '')
      setUf(e.uf ?? ''); setCep(e.cep ?? '')
    }
    // Ponto no mapa: leitor próprio (collision-free; não toca fn_obra_ficha_ler)
    const { data: mapaData } = await supabase.rpc('fn_obra_ficha_mapa_ler', { p_obra_id: id })
    const m = mapaData as Ficha | null
    if (m && m.ok) {
      setLat(m.latitude != null ? String(m.latitude) : '')
      setLng(m.longitude != null ? String(m.longitude) : '')
    }
    // Resumo da regularização (alvará e licenças) a partir do dado real. Falha aqui não derruba a ficha.
    try {
      const { data: licData } = await supabase.rpc('fn_obra_licenca_listar', { p_obra_id: id })
      const lic = licData as { ok?: boolean; itens?: { validade: string | null; situacao: string }[] } | null
      if (lic && lic.ok) {
        const itens = lic.itens ?? []
        const vencidos = itens.filter((l) => l.situacao === 'vencido').length
        const vence30 = itens.filter((l) => l.situacao === 'vence_30').length
        const proxima = itens
          .filter((l) => l.validade && l.situacao !== 'vencido')
          .map((l) => l.validade as string)
          .sort()[0] ?? null
        setReg({ total: itens.length, vencidos, vence30, proxima })
      } else {
        setReg({ total: 0, vencidos: 0, vence30: 0, proxima: null })
      }
    } catch { setReg({ total: 0, vencidos: 0, vence30: 0, proxima: null }) }
  }, [id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  // Sugestão de ponto: deriva lat/long do CEP pela BrasilAPI v2 (mesmo provedor do helper
  // buscarCEP). Só PRÉ-PREENCHE quando a obra ainda não tem ponto salvo/digitado — nunca
  // sobrescreve o que o usuário fixou; o ponto salvo é a fonte da verdade (RD-51). Só-leitura.
  useEffect(() => {
    const clean = cep.replace(/\D/g, '')
    if (clean.length !== 8) return
    let vivo = true
    void (async () => {
      try {
        const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${clean}`)
        if (!vivo || !res.ok) return
        const data = await res.json()
        const c = data?.location?.coordinates
        const la = Number(c?.latitude), lo = Number(c?.longitude)
        if (!vivo || !Number.isFinite(la) || !Number.isFinite(lo) || (la === 0 && lo === 0)) return
        setLat((prev: string) => (prev.trim() === '' ? String(la) : prev))
        setLng((prev: string) => (prev.trim() === '' ? String(lo) : prev))
      } catch { /* sem sugestão de ponto — o usuário digita ou usa a localização do aparelho */ }
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

  const usarLocalizacao = () => {
    setErro(null); setOkMapa(false)
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setErro('Este aparelho não informa a localização. Digite a latitude e a longitude, ou use o celular na obra.'); return
    }
    setLocBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLat(String(pos.coords.latitude)); setLng(String(pos.coords.longitude)); setLocBusy(false); setOkMapa(false) },
      () => { setLocBusy(false); setErro('Não foi possível obter a localização. Autorize o acesso no navegador ou digite as coordenadas.') },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const salvarMapa = async () => {
    setBusyMapa(true); setErro(null); setOkMapa(false)
    const { data, error } = await supabase.rpc('fn_obra_ficha_mapa_salvar', {
      p_obra_id: id, p_latitude: coordNum(lat), p_longitude: coordNum(lng),
    })
    setBusyMapa(false)
    const j = data as Ficha | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível salvar o ponto no mapa.')); return }
    setOkMapa(true)
  }

  // dd/mm/aaaa a partir de 'YYYY-MM-DD' (sem fuso: a validade é uma data, não um instante).
  const fmtData = (iso: string | null): string => {
    if (!iso) return '—'
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
  }

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
              </div>

              {/* Ponto no mapa — latitude/longitude + mini-mapa (tela 314 "ficha da obra") */}
              <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, display: 'grid', gap: 14 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: GOLD, fontWeight: 700 }}>Ponto no mapa</div>
                <div style={{ fontSize: 11, color: MUT }}>Marque onde fica a obra: digite as coordenadas ou, no celular dentro da obra, use a localização do aparelho.</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                    <span>Latitude<AjudaCampo chave="projetos.obra_ficha.latitude" rota={ROTA} /></span>
                    <input data-testid="ficha-latitude" inputMode="decimal" style={campo} value={lat} placeholder="-27.100500" onChange={(e) => { setLat(e.target.value); setOkMapa(false) }} />
                  </label>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                    <span>Longitude<AjudaCampo chave="projetos.obra_ficha.longitude" rota={ROTA} /></span>
                    <input data-testid="ficha-longitude" inputMode="decimal" style={campo} value={lng} placeholder="-52.615200" onChange={(e) => { setLng(e.target.value); setOkMapa(false) }} />
                  </label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button data-testid="ficha-usar-localizacao" type="button" disabled={locBusy} onClick={usarLocalizacao}
                    style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: ESP, fontSize: 13, fontWeight: 600, cursor: locBusy ? 'wait' : 'pointer' }}>
                    {locBusy ? 'Localizando…' : '📍 Usar minha localização'}
                  </button>
                  <AjudaCampo chave="projetos.obra_ficha.usar_localizacao" rota={ROTA} />
                </div>
                {temPonto && mapaSrc
                  ? (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <iframe data-testid="ficha-mapa" title="Mapa da obra" src={mapaSrc}
                        style={{ width: '100%', height: 200, border: `1px solid ${LINE}`, borderRadius: 8 }} loading="lazy" />
                      <a data-testid="ficha-mapa-link" href={`https://www.openstreetmap.org/?mlat=${latN!.toFixed(6)}&mlon=${lngN!.toFixed(6)}#map=16/${latN!.toFixed(6)}/${lngN!.toFixed(6)}`}
                        target="_blank" rel="noreferrer" style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>Abrir no mapa ↗</a>
                    </div>
                  )
                  : <div data-testid="ficha-mapa-vazio" style={{ fontSize: 12, color: MUT, background: BG, border: `1px dashed ${LINE}`, borderRadius: 8, padding: 16, textAlign: 'center' }}>Sem ponto marcado. Informe latitude e longitude para ver a obra no mapa.</div>}
                {okMapa && <div data-testid="ficha-mapa-ok" style={{ background: '#EAF6EC', color: VERDE, borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 600 }}>Ponto no mapa salvo.</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button data-testid="ficha-salvar-mapa" disabled={busyMapa} onClick={() => void salvarMapa()}
                    style={{ flex: 1, padding: '12px 16px', borderRadius: 8, border: 'none', background: ESP, color: '#fff', fontSize: 14, fontWeight: 700, cursor: busyMapa ? 'wait' : 'pointer' }}>
                    {busyMapa ? 'Salvando…' : 'Salvar ponto no mapa'}
                  </button>
                  <AjudaCampo chave="projetos.obra_ficha.salvar_mapa" rota={ROTA} />
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
