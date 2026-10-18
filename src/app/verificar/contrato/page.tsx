// src/app/verificar/contrato/page.tsx
// #2936 etapa 4 · Página PÚBLICA (sem login): qualquer pessoa confere se um contrato foi assinado pela PS Gestão,
// digitando o código de verificação impresso na página de evidências ou escolhendo o arquivo PDF. O arquivo não sai do
// aparelho: o navegador calcula a impressão digital (SHA-256) e só ela vai para /api/contratos/assinatura/verificar.
'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { normalizarConsulta, veredito, type ResultadoVerificacao } from '@/lib/contratos/verificacao'

const C = {
  espresso: '#3D2314', espressoM: '#6B5D4F', offwhite: '#FAF7F2', cream: '#F0ECE3',
  gold: '#C8941A', borderLt: '#E0D8CC', muted: 'rgba(61,35,20,0.6)',
  green: '#16A34A', greenSoft: '#DCFCE7', red: '#B42318', redSoft: '#FEE4E2', amber: '#92400E', amberSoft: '#FEF3C7',
}

const PAPEL: Record<string, string> = { cliente: 'Cliente', empresa: 'Pela empresa', testemunha: 'Testemunha' }

const fmtDT = (s: string | null | undefined) => {
  if (!s) return '-'
  try { return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return s }
}

async function hashArquivo(f: File): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', await f.arrayBuffer())
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

type Resposta = ResultadoVerificacao & { consulta?: 'codigo' | 'hash' }

export default function VerificarContratoPage() {
  return (
    <Suspense fallback={<Moldura><p style={{ color: C.muted, textAlign: 'center' }}>Carregando…</p></Moldura>}>
      <Verificar />
    </Suspense>
  )
}

function Verificar() {
  const sp = useSearchParams()
  const [codigo, setCodigo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [res, setRes] = useState<Resposta | null>(null)
  const [arquivo, setArquivo] = useState<string | null>(null)

  const conferir = useCallback(async (consulta: string, nomeArquivo: string | null) => {
    setOcupado(true); setErro(null); setRes(null); setArquivo(nomeArquivo)
    try {
      const r = await fetch('/api/contratos/assinatura/verificar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consulta }) })
      const j = await r.json().catch(() => ({ ok: false, erro: 'Falha de comunicação' }))
      if (!j?.ok) throw new Error(j?.erro || 'Falha de comunicação')
      setRes(j as Resposta)
    } catch (e) { setErro((e as Error).message) }
    finally { setOcupado(false) }
  }, [])

  // link do PDF assinado: /verificar/contrato?c=CODIGO já confere ao abrir
  useEffect(() => {
    const c = sp?.get('c') ?? ''
    if (c && normalizarConsulta(c)) { setCodigo(c.toUpperCase()); void conferir(c, null) }
  }, [sp, conferir])

  async function escolherArquivo(f: File | undefined) {
    if (!f) return
    if (f.size > 50 * 1024 * 1024) { setErro('Arquivo grande demais (máximo 50 MB)'); return }
    setOcupado(true); setErro(null)
    try { await conferir(await hashArquivo(f), f.name) }
    catch { setErro('Não consegui ler o arquivo'); setOcupado(false) }
  }

  const codigoOk = !!normalizarConsulta(codigo)
  const v = res ? veredito(res) : null
  const corTom = v?.tom === 'ok' ? { bg: C.greenSoft, fg: C.green, icone: '✅' } : v?.tom === 'aviso' ? { bg: C.amberSoft, fg: C.amber, icone: '⏳' } : { bg: C.redSoft, fg: C.red, icone: '⚠️' }

  return (
    <Moldura>
      <h1 style={titulo}>Conferir contrato assinado</h1>
      <p style={{ color: C.espressoM, fontSize: 14, margin: '0 0 16px', lineHeight: 1.5 }}>
        Confira se um contrato foi assinado eletronicamente e se o arquivo que você tem é o mesmo que as partes assinaram.
      </p>

      <section style={secao}>
        <label style={rotulo} htmlFor="verif-codigo">Código de verificação</label>
        <p style={dica}>Está na última página do PDF assinado (12 letras e números), por exemplo AB12CD34EF56.</p>
        <input id="verif-codigo" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={codigo}
          onChange={(e) => setCodigo(e.target.value.toUpperCase().slice(0, 80))}
          onKeyDown={(e) => { if (e.key === 'Enter' && codigoOk && !ocupado) void conferir(codigo, null) }}
          placeholder="AB12CD34EF56" style={{ ...entrada, fontFamily: 'monospace', letterSpacing: 2 }} />
        <button type="button" disabled={!codigoOk || ocupado} onClick={() => void conferir(codigo, null)} style={botaoPrincipal(!codigoOk || ocupado)}>
          {ocupado ? 'Conferindo…' : 'Conferir código'}
        </button>
      </section>

      <section style={secao}>
        <label style={rotulo} htmlFor="verif-arquivo">Ou confira o arquivo</label>
        <p style={dica}>Escolha o PDF assinado (ou o contrato original). Ele não sai do seu aparelho: só a impressão digital do arquivo é conferida.</p>
        <input id="verif-arquivo" type="file" accept="application/pdf,.pdf" disabled={ocupado}
          onChange={(e) => { void escolherArquivo(e.target.files?.[0]); e.target.value = '' }}
          style={{ ...entrada, padding: 10, fontSize: 14 }} />
      </section>

      {erro && <div style={{ ...caixa, background: C.redSoft, color: C.red, marginTop: 12 }}>{erro}</div>}

      {res && v && (
        <section data-testid="verif-resultado" style={{ ...caixa, background: corTom.bg, marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 26, lineHeight: 1 }}>{corTom.icone}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 17, color: corTom.fg }}>{v.titulo}</div>
              <div style={{ fontSize: 14, color: C.espresso, marginTop: 4, lineHeight: 1.45 }}>{v.texto}</div>
              {arquivo && <div style={{ fontSize: 12, color: C.muted, marginTop: 6, wordBreak: 'break-all' }}>Arquivo conferido: {arquivo}</div>}
            </div>
          </div>
          {res.encontrado && (
            <div style={{ marginTop: 14, background: '#fff', borderRadius: 10, padding: 12, fontSize: 13 }}>
              <div style={{ color: C.muted, fontSize: 11 }}>Versão {res.versao} · concluído em {fmtDT(res.concluido_em)}</div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
                {(res.signatarios ?? []).map((s, i) => (
                  <li key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderTop: i ? `1px solid ${C.borderLt}` : 'none' }}>
                    <span><b>{s.nome}</b> <span style={{ color: C.muted }}>· {PAPEL[s.papel] ?? s.papel}</span></span>
                    <span style={{ color: s.status === 'assinado' ? C.green : C.muted, whiteSpace: 'nowrap' }}>
                      {s.status === 'assinado' ? `assinou ${fmtDT(s.assinado_em)}` : 'não assinou'}
                    </span>
                  </li>
                ))}
              </ul>
              <div style={{ color: C.muted, fontSize: 11, margin: '10px 0 2px' }}>Impressão digital (SHA-256) do documento assinado</div>
              <div style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{res.documento_hash}</div>
            </div>
          )}
        </section>
      )}

      <p style={{ fontSize: 11, color: C.muted, marginTop: 18, lineHeight: 1.5 }}>
        Por privacidade, mostramos só o primeiro nome e a inicial do sobrenome de quem assinou. CPF, e-mail e demais registros
        ficam com a empresa, na página de evidências do PDF assinado.
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

const titulo: React.CSSProperties = { fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, margin: '0 0 8px', color: C.espresso, lineHeight: 1.25 }
const secao: React.CSSProperties = { borderTop: `1px solid ${C.borderLt}`, padding: '16px 0 4px' }
const rotulo: React.CSSProperties = { display: 'block', fontSize: 15, fontWeight: 700, margin: '0 0 4px' }
const dica: React.CSSProperties = { fontSize: 12, color: C.muted, margin: '0 0 8px', lineHeight: 1.45 }
const entrada: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: 16, border: `1px solid ${C.borderLt}`, borderRadius: 10, marginBottom: 12, background: '#fff', color: C.espresso }
const caixa: React.CSSProperties = { padding: '12px 14px', borderRadius: 12, fontSize: 14 }
const botaoPrincipal = (off: boolean): React.CSSProperties => ({
  width: '100%', padding: '14px 16px', borderRadius: 10, border: 'none', fontSize: 16, fontWeight: 700,
  background: off ? C.cream : C.gold, color: off ? C.muted : C.espresso, cursor: off ? 'not-allowed' : 'pointer',
})
