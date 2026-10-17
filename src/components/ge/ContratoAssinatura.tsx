'use client'

// #2936 etapa 2 · "Enviar para assinatura" dentro do contrato: escolhe o PDF anexado, os signatários (cliente, empresa,
// testemunha), a validade do link, e envia. O link vai por e-mail sozinho; o WhatsApp abre com a mensagem pronta (wa.me,
// sem provedor pago). Abaixo, o andamento de cada envio (quem já abriu / assinou) e o cancelamento com motivo.
// O hash do documento é calculado no servidor a partir do arquivo guardado (rota /api/contratos/assinatura/enviar).

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA_AJUDA = '/dashboard/cadastros/contratos-recorrentes'

interface Props {
  contratoId: string
  cliente?: { nome?: string | null; documento?: string | null; email?: string | null; telefone?: string | null }
}

type Papel = 'cliente' | 'empresa' | 'testemunha'
interface SigForm { nome: string; documento: string; email: string; telefone: string; papel: Papel }
interface Arquivo { id: string; nome_arquivo: string; enviado_em: string }
interface Envio {
  id: string; versao: number; status: string; criado_em: string; expira_em: string; codigo_verificacao: string; cancelado_motivo: string | null
  documento_assinado_path: string | null
  erp_contrato_assinatura_signatario: { id: string; nome: string; papel: string; status: string; visualizado_em: string | null; assinado_em: string | null }[]
}
interface Resultado { signatario_id: string; nome: string; link: string; email_enviado: boolean; whatsapp: string | null }

const vazio = (papel: Papel = 'cliente'): SigForm => ({ nome: '', documento: '', email: '', telefone: '', papel })
const fmtDT = (s: string | null) => (s ? new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
const ROTULO_STATUS: Record<string, string> = {
  aguardando: 'Aguardando assinaturas', assinado: 'Assinado por todos', cancelado: 'Cancelado', expirado: 'Vencido',
  pendente: 'Ainda não abriu', visualizado: 'Abriu o link',
}
const COR_STATUS: Record<string, string> = { assinado: '#16A34A', aguardando: '#B45309', visualizado: '#B45309', pendente: '#6B5D4F', cancelado: '#A32D2D', expirado: '#A32D2D' }

export default function ContratoAssinatura({ contratoId, cliente }: Props) {
  const [arquivos, setArquivos] = useState<Arquivo[]>([])
  const [envios, setEnvios] = useState<Envio[]>([])
  const [aberto, setAberto] = useState(false)
  const [arquivoId, setArquivoId] = useState('')
  const [sigs, setSigs] = useState<SigForm[]>([vazio()])
  const [validade, setValidade] = useState(15)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Resultado[] | null>(null)
  const [baixando, setBaixando] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const [a, e] = await Promise.all([
      supabase.from('erp_contratos_arquivos').select('id, nome_arquivo, enviado_em')
        .eq('contrato_id', contratoId).eq('mime_type', 'application/pdf').order('enviado_em', { ascending: false }),
      supabase.from('erp_contrato_assinatura_envio')
        .select('id, versao, status, criado_em, expira_em, codigo_verificacao, cancelado_motivo, documento_assinado_path, erp_contrato_assinatura_signatario(id, nome, papel, status, visualizado_em, assinado_em)')
        .eq('contrato_id', contratoId).order('criado_em', { ascending: false }).limit(5),
    ])
    const lista = (a.data as Arquivo[]) ?? []
    setArquivos(lista)
    setArquivoId((atual) => atual || lista[0]?.id || '')
    setEnvios((e.data as Envio[]) ?? [])
  }, [contratoId])

  useEffect(() => { void carregar() }, [carregar])

  function abrir() {
    setErro(null); setResultado(null)
    void carregar() // pega o PDF que acabou de ser anexado acima
    setSigs([{ ...vazio('cliente'), nome: cliente?.nome ?? '', documento: cliente?.documento ?? '', email: cliente?.email ?? '', telefone: cliente?.telefone ?? '' }])
    setAberto(true)
  }

  const alterar = (i: number, campo: keyof SigForm, v: string) => setSigs((l) => l.map((s, k) => (k === i ? { ...s, [campo]: v } : s)))

  async function enviar() {
    setErro(null)
    if (!arquivoId) { setErro('Anexe o contrato em PDF acima e escolha o arquivo.'); return }
    setEnviando(true)
    try {
      const { data: s } = await supabase.auth.getSession()
      const r = await fetch('/api/contratos/assinatura/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token ?? ''}` },
        body: JSON.stringify({ contrato_id: contratoId, arquivo_id: arquivoId, signatarios: sigs, validade_dias: validade }),
      })
      const j = await r.json().catch(() => ({ ok: false, erro: 'Falha de comunicação' }))
      if (!j.ok) { setErro(j.erro || j.error || 'Não consegui enviar'); return }
      setResultado(j.signatarios as Resultado[])
      await carregar()
    } finally { setEnviando(false) }
  }

  async function cancelar(envio: Envio) {
    const motivo = prompt('Motivo do cancelamento (o link deixa de valer para todos):')
    if (!motivo || motivo.trim().length < 3) return
    const { data, error } = await supabase.rpc('fn_contrato_assinatura_cancelar', { p_envio_id: envio.id, p_motivo: motivo.trim() })
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Não consegui cancelar'); return }
    await carregar()
  }

  // etapa 3: baixa o PDF assinado (gera na hora se a geração da última assinatura não tiver saído)
  async function baixarAssinado(envio: Envio) {
    setErro(null); setBaixando(envio.id)
    try {
      const { data: s } = await supabase.auth.getSession()
      const r = await fetch('/api/contratos/assinatura/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token ?? ''}` },
        body: JSON.stringify({ envio_id: envio.id }),
      })
      const j = await r.json().catch(() => ({ ok: false, erro: 'Falha de comunicação' }))
      if (!j.ok) { setErro(j.erro || 'Não consegui baixar o contrato assinado'); return }
      window.open(j.url as string, '_blank', 'noopener')
      if (!envio.documento_assinado_path) await carregar()
    } finally { setBaixando(null) }
  }

  async function copiar(link: string) {
    try { await navigator.clipboard.writeText(link) } catch { prompt('Copie o link:', link) }
  }

  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: '0.5px solid rgba(61,35,20,0.12)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={tituloSecao}>Assinatura eletrônica</span>
          <AjudaCampo chave="ge.contrato.assinatura.enviar" rota={ROTA_AJUDA} />
        </div>
        {!aberto && (
          <button type="button" onClick={abrir} style={botaoOuro}>
            Enviar para assinatura
          </button>
        )}
      </div>
      {arquivos.length === 0 && !aberto && (
        <div style={dica}>Anexe o contrato em PDF acima para enviar para assinatura pelo celular.</div>
      )}

      {aberto && (
        <div style={{ background: 'rgba(200,148,26,0.05)', border: '0.5px solid rgba(200,148,26,0.4)', borderRadius: 8, padding: 14, marginTop: 10 }}>
          <label style={rotulo}>
            <span style={linhaRotulo}>Documento a assinar <AjudaCampo chave="ge.contrato.assinatura.arquivo" rota={ROTA_AJUDA} /></span>
            <select value={arquivoId} onChange={(e) => setArquivoId(e.target.value)} style={entrada}>
              {arquivos.map((a) => <option key={a.id} value={a.id}>{a.nome_arquivo} · {fmtDT(a.enviado_em)}</option>)}
            </select>
          </label>

          {sigs.map((s, i) => (
            <div key={i} style={{ background: '#fff', border: '0.5px solid rgba(61,35,20,0.18)', borderRadius: 8, padding: 12, marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#3D2314' }}>Signatário {i + 1}</span>
                {sigs.length > 1 && (
                  <button type="button" onClick={() => setSigs((l) => l.filter((_, k) => k !== i))} style={botaoTexto}>Remover</button>
                )}
              </div>
              <div style={grade}>
                <label style={rotulo}>
                  <span style={linhaRotulo}>Nome completo <AjudaCampo chave="ge.contrato.assinatura.nome" rota={ROTA_AJUDA} /></span>
                  <input value={s.nome} onChange={(e) => alterar(i, 'nome', e.target.value)} style={entrada} />
                </label>
                <label style={rotulo}>
                  <span style={linhaRotulo}>CPF ou CNPJ <AjudaCampo chave="ge.contrato.assinatura.documento" rota={ROTA_AJUDA} /></span>
                  <input value={s.documento} inputMode="numeric" onChange={(e) => alterar(i, 'documento', e.target.value)} style={entrada} />
                </label>
                <label style={rotulo}>
                  <span style={linhaRotulo}>E-mail <AjudaCampo chave="ge.contrato.assinatura.email" rota={ROTA_AJUDA} /></span>
                  <input type="email" value={s.email} onChange={(e) => alterar(i, 'email', e.target.value)} style={entrada} />
                </label>
                <label style={rotulo}>
                  <span style={linhaRotulo}>WhatsApp (opcional) <AjudaCampo chave="ge.contrato.assinatura.whatsapp" rota={ROTA_AJUDA} /></span>
                  <input value={s.telefone} inputMode="tel" onChange={(e) => alterar(i, 'telefone', e.target.value)} placeholder="(54) 99999-0000" style={entrada} />
                </label>
                <label style={rotulo}>
                  <span style={linhaRotulo}>Assina como <AjudaCampo chave="ge.contrato.assinatura.papel" rota={ROTA_AJUDA} /></span>
                  <select value={s.papel} onChange={(e) => alterar(i, 'papel', e.target.value)} style={entrada}>
                    <option value="cliente">Cliente</option>
                    <option value="empresa">Pela empresa</option>
                    <option value="testemunha">Testemunha</option>
                  </select>
                </label>
              </div>
            </div>
          ))}
          {sigs.length < 10 && (
            <button type="button" onClick={() => setSigs((l) => [...l, vazio(l.length === 1 ? 'empresa' : 'testemunha')])} style={{ ...botaoTexto, marginTop: 8 }}>
              + Adicionar signatário
            </button>
          )}

          <label style={{ ...rotulo, marginTop: 12, maxWidth: 260 }}>
            <span style={linhaRotulo}>Link vale por <AjudaCampo chave="ge.contrato.assinatura.validade" rota={ROTA_AJUDA} /></span>
            <select value={validade} onChange={(e) => setValidade(Number(e.target.value))} style={entrada}>
              {[3, 7, 15, 30, 60].map((d) => <option key={d} value={d}>{d} dias</option>)}
            </select>
          </label>

          {erro && <div style={caixaErro}>{erro}</div>}

          {resultado ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#16A34A', marginBottom: 8 }}>Enviado. Agora mande pelo WhatsApp quem tiver:</div>
              {resultado.map((r) => (
                <div key={r.signatario_id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderTop: '0.5px solid rgba(61,35,20,0.1)' }}>
                  <span style={{ flex: 1, minWidth: 160, fontSize: 13 }}>
                    {r.nome} · {r.email_enviado ? 'e-mail enviado' : 'e-mail não saiu (copie o link)'}
                  </span>
                  {r.whatsapp && <a href={r.whatsapp} target="_blank" rel="noopener noreferrer" style={botaoVerde}>Enviar no WhatsApp</a>}
                  <button type="button" onClick={() => void copiar(r.link)} style={botaoContorno}>Copiar link</button>
                </div>
              ))}
              <button type="button" onClick={() => { setAberto(false); setResultado(null) }} style={{ ...botaoTexto, marginTop: 8 }}>Fechar</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setAberto(false)} style={botaoContorno} disabled={enviando}>Voltar</button>
              <button type="button" onClick={() => void enviar()} style={botaoOuro} disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar agora'}</button>
            </div>
          )}
        </div>
      )}

      {envios.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#3D2314' }}>Andamento</span>
            <AjudaCampo chave="ge.contrato.assinatura.andamento" rota={ROTA_AJUDA} />
          </div>
          {envios.map((e) => (
            <div key={e.id} style={{ background: '#fff', border: '0.5px solid rgba(61,35,20,0.18)', borderRadius: 6, padding: '10px 12px', marginBottom: 6 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: COR_STATUS[e.status] ?? '#3D2314' }}>Versão {e.versao} · {ROTULO_STATUS[e.status] ?? e.status}</span>
                <span style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', flex: 1 }}>enviado {fmtDT(e.criado_em)} · código {e.codigo_verificacao}</span>
                {e.status === 'aguardando' && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <button type="button" onClick={() => void cancelar(e)} style={botaoTextoVermelho}>Cancelar envio</button>
                    <AjudaCampo chave="ge.contrato.assinatura.cancelar" rota={ROTA_AJUDA} />
                  </span>
                )}
              </div>
              {e.status === 'assinado' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => void baixarAssinado(e)} style={botaoVerdeBotao} disabled={baixando === e.id}>
                    {baixando === e.id ? 'Preparando…' : e.documento_assinado_path ? 'Baixar contrato assinado' : 'Gerar PDF assinado'}
                  </button>
                  {e.documento_assinado_path
                    ? <AjudaCampo chave="ge.contrato.assinatura.pdf_assinado" rota={ROTA_AJUDA} />
                    : <AjudaCampo chave="ge.contrato.assinatura.gerar_pdf" rota={ROTA_AJUDA} />}
                  {e.documento_assinado_path && <span style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)' }}>também está nos anexos do contrato</span>}
                </div>
              )}
              {e.cancelado_motivo && <div style={{ fontSize: 11, color: '#A32D2D', marginTop: 4 }}>Motivo: {e.cancelado_motivo}</div>}
              <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
                {[...e.erp_contrato_assinatura_signatario].sort((a, b) => a.nome.localeCompare(b.nome)).map((s) => (
                  <li key={s.id} style={{ fontSize: 12, color: '#3D2314', padding: '2px 0' }}>
                    {s.nome} ({s.papel}) · <span style={{ color: COR_STATUS[s.status] ?? '#3D2314' }}>
                      {s.status === 'assinado' ? `assinou ${fmtDT(s.assinado_em)}` : s.status === 'visualizado' ? `abriu ${fmtDT(s.visualizado_em)}` : ROTULO_STATUS[s.status] ?? s.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const tituloSecao: React.CSSProperties = { fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6 }
const rotulo: React.CSSProperties = { display: 'block', fontSize: 12, color: '#3D2314' }
const linhaRotulo: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, fontWeight: 500 }
const entrada: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '9px 10px', fontSize: 14, border: '0.5px solid rgba(61,35,20,0.3)', borderRadius: 6, background: '#fff', color: '#3D2314' }
const grade: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }
const dica: React.CSSProperties = { fontSize: 12, color: 'rgba(61,35,20,0.6)', fontStyle: 'italic', marginTop: 6 }
const caixaErro: React.CSSProperties = { background: '#FCEBEB', color: '#A32D2D', padding: '8px 12px', borderRadius: 6, marginTop: 10, fontSize: 12 }
const botaoOuro: React.CSSProperties = { background: '#C8941A', color: '#3D2314', border: 'none', padding: '9px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const botaoVerde: React.CSSProperties = { background: '#16A34A', color: '#fff', padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: 'none' }
const botaoVerdeBotao: React.CSSProperties = { ...botaoVerde, border: 'none', cursor: 'pointer' }
const botaoContorno: React.CSSProperties = { background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.3)', padding: '7px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }
const botaoTexto: React.CSSProperties = { background: 'none', border: 'none', color: '#6B5D4F', fontSize: 12, cursor: 'pointer', textDecoration: 'underline', padding: 0 }
const botaoTextoVermelho: React.CSSProperties = { ...botaoTexto, color: '#A32D2D' }
