// src/app/sign/contrato/[token]/page.tsx
// #2936 etapa 2 · Rota PÚBLICA (sem login): o signatário abre o link (WhatsApp ou e-mail), confere o contrato,
// confirma o CPF/CNPJ, recebe o código no e-mail e assina (Lei 14.063/2020, assinatura eletrônica avançada por
// link pessoal + 2º fator). Tudo passa pela rota do servidor /api/contratos/assinatura/publico — o navegador nunca
// fala direto com as funções do banco e nunca recebe o código.
'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

const C = {
  espresso: '#3D2314', espressoM: '#6B5D4F', offwhite: '#FAF7F2', cream: '#F0ECE3',
  gold: '#C8941A', borderLt: '#E0D8CC', muted: 'rgba(61,35,20,0.6)',
  green: '#16A34A', red: '#B42318', redSoft: '#FEE4E2',
}

interface Doc {
  ok: boolean; nome: string; papel: string; ja_assinado: boolean
  contrato_numero: string | null; contrato_nome: string | null; empresa: string | null
  documento_url: string | null; documento_hash: string; versao: number; expira_em: string
}

const fmtDT = (s: string) => { try { return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return s } }

function mascaraDoc(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14)
  const partes = (cortes: number[], seps: string[]) => {
    let s = '', i = 0
    cortes.forEach((c, k) => { const p = d.slice(i, c); if (p) s += (k ? seps[k - 1] : '') + p; i = c })
    return s
  }
  return d.length <= 11 ? partes([3, 6, 9, 11], ['.', '.', '-']) : partes([2, 5, 8, 12, 14], ['.', '.', '/', '-'])
}

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const r = await fetch('/api/contratos/assinatura/publico', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  const j = await r.json().catch(() => ({ ok: false, erro: 'Falha de comunicação' }))
  if (!j?.ok) throw new Error(j?.erro || 'Falha de comunicação')
  return j as T
}

export default function AssinarContratoPage() {
  const params = useParams()
  const token = (params?.token as string) || ''
  const [carregando, setCarregando] = useState(true)
  const [doc, setDoc] = useState<Doc | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [documento, setDocumento] = useState('')
  const [leu, setLeu] = useState(false)
  const [aceite, setAceite] = useState(false)
  const [geoConsent, setGeoConsent] = useState(false)
  const [geo, setGeo] = useState<{ lat: number; lng: number; precisao: number } | null>(null)
  const [codigoPara, setCodigoPara] = useState<string | null>(null)
  const [codigo, setCodigo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [feito, setFeito] = useState<{ codigo_verificacao?: string; documento_hash: string; todos_assinaram: boolean } | null>(null)

  useEffect(() => {
    if (!token) return
    let vivo = true
    chamar<Doc>({ acao: 'abrir', token })
      .then((d) => { if (vivo) setDoc(d) })
      .catch((e: Error) => { if (vivo) setErro(e.message) })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [token])

  // geolocalização só depois do consentimento expresso (LGPD); negar não impede assinar
  useEffect(() => {
    if (!geoConsent) { setGeo(null); return }
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (p) => setGeo({ lat: p.coords.latitude, lng: p.coords.longitude, precisao: Math.round(p.coords.accuracy) }),
      () => setGeo(null), { enableHighAccuracy: false, timeout: 6000, maximumAge: 0 },
    )
  }, [geoConsent])

  const docOk = [11, 14].includes(documento.replace(/\D/g, '').length)

  async function pedirCodigo() {
    setOcupado(true); setErro(null)
    try { const r = await chamar<{ enviado_para: string }>({ acao: 'codigo', token }); setCodigoPara(r.enviado_para); setCodigo('') }
    catch (e) { setErro((e as Error).message) }
    finally { setOcupado(false) }
  }

  async function assinar() {
    setOcupado(true); setErro(null)
    try {
      const r = await chamar<{ codigo_verificacao?: string; documento_hash: string; todos_assinaram: boolean }>({
        acao: 'assinar', token, codigo, documento, aceite, geo_consentido: geoConsent && !!geo, geo: geoConsent ? geo : null,
      })
      setFeito(r)
    } catch (e) { setErro((e as Error).message) }
    finally { setOcupado(false) }
  }

  if (carregando) return <Moldura><p style={{ textAlign: 'center', color: C.muted }}>Carregando o documento…</p></Moldura>
  if (!doc) return <Moldura><div style={caixaErro}>{erro || 'Link inválido'}</div></Moldura>

  if (feito || doc.ja_assinado) return (
    <Moldura>
      <div style={{ textAlign: 'center', padding: '12px 4px' }}>
        <div style={{ fontSize: 52, marginBottom: 8 }}>✅</div>
        <h1 style={titulo}>Assinatura registrada</h1>
        <p style={{ color: C.espressoM, fontSize: 15, lineHeight: 1.5, margin: '0 0 16px' }}>
          {feito?.todos_assinaram ? 'Todos já assinaram. A empresa recebe o contrato assinado.' : 'Obrigado! Sua assinatura foi registrada. A empresa acompanha as demais assinaturas.'}
        </p>
        {feito?.codigo_verificacao && (
          <div style={{ background: C.cream, borderRadius: 10, padding: 14, textAlign: 'left', fontSize: 13, color: C.espresso }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Código de verificação do documento</div>
            <div style={{ fontFamily: 'monospace', fontSize: 16, letterSpacing: 1 }}>{feito.codigo_verificacao}</div>
            <div style={{ fontSize: 11, color: C.muted, margin: '10px 0 4px' }}>Hash SHA-256 do arquivo assinado</div>
            <div style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{feito.documento_hash}</div>
            <a href={`/verificar/contrato?c=${encodeURIComponent(feito.codigo_verificacao)}`} style={{ ...botaoSecundario, marginTop: 12, fontSize: 14 }}>
              Conferir este contrato
            </a>
          </div>
        )}
      </div>
    </Moldura>
  )

  return (
    <Moldura>
      <div style={{ fontSize: 12, color: C.gold, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase' }}>{doc.empresa ?? 'Contrato'}</div>
      <h1 style={{ ...titulo, marginTop: 6 }}>{doc.contrato_nome || 'Contrato'}{doc.contrato_numero ? ` · ${doc.contrato_numero}` : ''}</h1>
      <p style={{ color: C.espressoM, fontSize: 14, margin: '0 0 16px', lineHeight: 1.5 }}>
        Olá, {doc.nome.split(' ')[0]}. Confira o documento e assine em 3 passos. O link vale até {fmtDT(doc.expira_em)}.
      </p>

      <Passo n={1} titulo="Leia o contrato">
        {doc.documento_url ? (
          <a href={doc.documento_url} target="_blank" rel="noopener noreferrer" onClick={() => setLeu(true)} style={botaoSecundario}>
            Abrir o contrato (PDF)
          </a>
        ) : <div style={caixaErro}>Documento indisponível; fale com a empresa.</div>}
        <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>Versão {doc.versao} · hash {doc.documento_hash.slice(0, 16)}…</div>
      </Passo>

      <Passo n={2} titulo="Confirme quem você é">
        <label style={rotulo} htmlFor="assin-doc">Seu CPF ou CNPJ</label>
        <input id="assin-doc" inputMode="numeric" autoComplete="off" value={documento} onChange={(e) => setDocumento(mascaraDoc(e.target.value))}
          placeholder="000.000.000-00" style={entrada} />
        <label style={linhaCheck}>
          <input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} style={{ width: 20, height: 20 }} />
          <span>Li o contrato{leu ? '' : ' (abra o PDF acima)'} e concordo em assiná-lo eletronicamente, com o mesmo valor da assinatura no papel (Lei 14.063/2020).</span>
        </label>
        <label style={linhaCheck}>
          <input type="checkbox" checked={geoConsent} onChange={(e) => setGeoConsent(e.target.checked)} style={{ width: 20, height: 20 }} />
          <span>Opcional: autorizo registrar a minha localização aproximada junto com a assinatura.</span>
        </label>
      </Passo>

      <Passo n={3} titulo="Código e assinatura">
        {!codigoPara ? (
          <button type="button" disabled={!docOk || !aceite || ocupado} onClick={() => void pedirCodigo()} style={botaoPrincipal(!docOk || !aceite || ocupado)}>
            {ocupado ? 'Enviando…' : 'Receber o código no e-mail'}
          </button>
        ) : (
          <>
            <p style={{ fontSize: 13, color: C.espressoM, margin: '0 0 8px' }}>Enviamos um código de 6 números para {codigoPara}. Ele vale 10 minutos.</p>
            <label style={rotulo} htmlFor="assin-codigo">Código recebido</label>
            <input id="assin-codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000"
              style={{ ...entrada, fontSize: 22, letterSpacing: 6, textAlign: 'center' }} />
            <button type="button" disabled={codigo.length !== 6 || !docOk || !aceite || ocupado} onClick={() => void assinar()}
              style={botaoPrincipal(codigo.length !== 6 || !docOk || !aceite || ocupado)}>
              {ocupado ? 'Assinando…' : 'Assinar o contrato'}
            </button>
            <button type="button" disabled={ocupado} onClick={() => void pedirCodigo()} style={{ ...botaoLink, marginTop: 10 }}>Não chegou? Enviar outro código</button>
          </>
        )}
      </Passo>

      {erro && <div style={{ ...caixaErro, marginTop: 12 }}>{erro}</div>}
      <p style={{ fontSize: 11, color: C.muted, marginTop: 18, lineHeight: 1.5 }}>
        Registramos data, hora, IP e aparelho da assinatura e o código do documento, para provar que foi você quem assinou esta versão.
        Se o contrato mudar, este link deixa de valer e você recebe um novo.
      </p>
    </Moldura>
  )
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ minHeight: '100vh', background: C.offwhite, padding: '24px 16px 40px', fontFamily: 'Segoe UI, Arial, sans-serif', color: C.espresso }}>
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: C.gold, fontWeight: 700, marginBottom: 10 }}>Assinatura eletrônica · PS Gestão</div>
        <div style={{ background: '#fff', border: `1px solid ${C.borderLt}`, borderRadius: 16, padding: '22px 18px' }}>{children}</div>
      </div>
    </main>
  )
}

function Passo({ n, titulo: t, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <section style={{ borderTop: `1px solid ${C.borderLt}`, padding: '16px 0 6px' }}>
      <h2 style={{ fontSize: 15, margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 24, height: 24, borderRadius: 12, background: C.gold, color: C.espresso, fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{n}</span>
        {t}
      </h2>
      {children}
    </section>
  )
}

const titulo: React.CSSProperties = { fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, margin: '0 0 8px', color: C.espresso, lineHeight: 1.25 }
const rotulo: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, margin: '4px 0 6px' }
const entrada: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: 16, border: `1px solid ${C.borderLt}`, borderRadius: 10, marginBottom: 12, background: '#fff', color: C.espresso }
const linhaCheck: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.45, margin: '6px 0 12px', color: C.espressoM }
const caixaErro: React.CSSProperties = { background: C.redSoft, color: C.red, padding: '10px 12px', borderRadius: 10, fontSize: 14 }
const botaoSecundario: React.CSSProperties = { display: 'block', textAlign: 'center', padding: '12px 16px', borderRadius: 10, border: `1px solid ${C.gold}`, color: C.espresso, fontWeight: 600, textDecoration: 'none', fontSize: 15 }
const botaoLink: React.CSSProperties = { background: 'none', border: 'none', color: C.espressoM, textDecoration: 'underline', fontSize: 13, cursor: 'pointer', padding: 0, display: 'block', margin: '0 auto' }
const botaoPrincipal = (off: boolean): React.CSSProperties => ({
  width: '100%', padding: '14px 16px', borderRadius: 10, border: 'none', fontSize: 16, fontWeight: 700,
  background: off ? C.cream : C.gold, color: off ? C.muted : C.espresso, cursor: off ? 'not-allowed' : 'pointer',
})
