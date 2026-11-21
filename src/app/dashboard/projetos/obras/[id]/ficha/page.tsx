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

type Ficha = { ok: boolean; numero?: string; nome?: string | null; cliente_nome?: string | null; tipo_execucao?: string | null; modelo_contratacao?: string | null; matricula?: string | null; inscricao_imobiliaria?: string | null; tipo_edificacao?: string | null; area_construida_m2?: number | null; area_terreno_m2?: number | null; endereco?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null; cep?: string | null; erro?: string }

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
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [busyId, setBusyId] = useState(false)
  const [busyEnd, setBusyEnd] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [okId, setOkId] = useState(false)
  const [okEnd, setOkEnd] = useState(false)

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
    setEndereco(j.endereco ?? ''); setBairro(j.bairro ?? ''); setCidade(j.cidade ?? '')
    setUf(j.uf ?? ''); setCep(j.cep ?? '')
  }, [id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

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

              {erro && <div role="alert" data-testid="ficha-erro" style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: 10, fontSize: 13 }}>{erro}</div>}
            </div>
          )}
      </div>
    </div>
  )
}
