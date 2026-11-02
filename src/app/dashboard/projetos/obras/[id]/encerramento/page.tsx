'use client'

// Hub · Gestão de Obras · Encerramento da obra (H8 · HBF-7.x) — aba DOCUMENTOS.
// V1 desta fatia: anexos da obra por tipo (termo de entrega, ART/RRT, as built, laudo, foto, nota…),
// em storage PRIVADO (bucket 'obra-documentos', prefixo obra_id/...), com exclusão rastreável (soft-delete).
// Espelha o padrão provado de ClienteArquivos/ContratoArquivos (RD-52): .from()+storage direto com RLS.
// As próximas fatias (termo assinado, status->entregue, retenção, garantia) entram em PRs próprias.
// Dados: erp_obra_arquivos (#3752) · bucket: obra-documentos (#3754). RD-95: "?" em todo campo/ação.
// RD-100: linguagem de arquiteto/engenheiro, sem nome de terceiros.

import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

// A camada de dados desta aba (tabela erp_obra_arquivos + bucket obra-documentos) entra por migration
// própria, que pode chegar à produção DEPOIS desta tela. Enquanto não chegar, a tabela/bucket não
// existem e o PostgREST/Storage respondem "relation does not exist" / "Bucket not found". RD-98: a tela
// NUNCA mostra esse erro cru — degrada para um aviso de "recurso sendo liberado" (tela viva, não morta).
function recursoEmLiberacao(e: unknown): boolean {
  const err = (e && typeof e === 'object' ? e : {}) as { code?: unknown; message?: unknown }
  const code = typeof err.code === 'string' ? err.code : ''
  const msg = typeof err.message === 'string' ? err.message.toLowerCase() : ''
  if (['42P01', 'PGRST205', 'PGRST202', 'PGRST204'].includes(code)) return true
  return /does not exist|not found|schema cache|bucket not found/.test(msg)
}

const ROTA = '/dashboard/projetos/obras/[id]/encerramento'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = 'rgba(61,35,20,0.18)', MUT = 'rgba(61,35,20,0.55)', VERM = '#A32D2D'
const BUCKET = 'obra-documentos'
const MIME_OK = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 10 * 1024 * 1024

const TIPOS: { v: string; l: string }[] = [
  { v: 'termo_entrega', l: 'Termo de entrega' },
  { v: 'art_rrt', l: 'ART / RRT' },
  { v: 'as_built', l: 'As built' },
  { v: 'laudo', l: 'Laudo' },
  { v: 'foto', l: 'Foto' },
  { v: 'nota', l: 'Nota / documento' },
  { v: 'outro', l: 'Outro' },
]
const tipoLabel = (v: string) => TIPOS.find((t) => t.v === v)?.l ?? v

type ArquivoRow = {
  id: string; obra_id: string; company_id: string; tipo: string
  nome_arquivo: string; storage_path: string; tamanho_bytes: number | null
  mime_type: string | null; enviado_em: string
}
type Obra = { id: string; nome: string | null; company_id: string }

function fmtTamanho(b: number | null): string {
  if (!b) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}
function fmtData(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function sanitizar(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

export default function EncerramentoObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [obra, setObra] = useState<Obra | null>(null)
  const [lista, setLista] = useState<ArquivoRow[]>([])
  const [carregando, setCarregando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [tipoUpload, setTipoUpload] = useState<string>('termo_entrega')
  const [filtro, setFiltro] = useState<string>('todos')
  const [arrastando, setArrastando] = useState(false)
  // true quando a camada de dados (tabela/bucket) ainda não chegou à produção — mostra aviso, não erro cru.
  const [emLiberacao, setEmLiberacao] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null); setEmLiberacao(false)
    const { data: o, error: eo } = await supabase
      .from('projetos_obras').select('id, nome, company_id').eq('id', id).maybeSingle()
    if (eo) { setCarregando(false); setErro(erroAmigavel(eo, 'Não foi possível abrir a obra. Tente de novo.')); return }
    if (!o) { setCarregando(false); setObra(null); return }
    setObra(o as Obra)
    const { data, error } = await supabase
      .from('erp_obra_arquivos')
      .select('id, obra_id, company_id, tipo, nome_arquivo, storage_path, tamanho_bytes, mime_type, enviado_em')
      .eq('obra_id', id).is('deleted_at', null).order('enviado_em', { ascending: false })
    setCarregando(false)
    if (error) {
      if (recursoEmLiberacao(error)) { setEmLiberacao(true); return }
      setErro(erroAmigavel(error, 'Não foi possível carregar os documentos. Tente de novo.'))
      return
    }
    setLista((data as ArquivoRow[]) ?? [])
  }, [id])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  async function anexar(file: File) {
    setErro(null)
    if (!obra) { setErro('Obra não encontrada ou sem acesso.'); return }
    if (!MIME_OK.includes(file.type)) { setErro('Aceita só PDF, JPG, PNG ou WebP.'); return }
    if (file.size > MAX_BYTES) { setErro(`Arquivo grande demais (${fmtTamanho(file.size)}) — máximo 10 MB.`); return }
    setEnviando(true)
    const path = `${id}/${Date.now()}_${sanitizar(file.name)}`
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
    if (up.error) {
      setEnviando(false)
      if (recursoEmLiberacao(up.error)) { setEmLiberacao(true); return }
      setErro(erroAmigavel(up.error, 'Não consegui anexar o documento. Tente de novo.'))
      return
    }
    const ins = await supabase.from('erp_obra_arquivos').insert({
      obra_id: id, company_id: obra.company_id, tipo: tipoUpload,
      nome_arquivo: file.name, storage_path: path, tamanho_bytes: file.size, mime_type: file.type,
    })
    setEnviando(false)
    if (ins.error) {
      await supabase.storage.from(BUCKET).remove([path]) // rollback do blob órfão
      if (recursoEmLiberacao(ins.error)) { setEmLiberacao(true); return }
      setErro(erroAmigavel(ins.error, 'Não consegui registrar o anexo. Tente de novo.'))
      return
    }
    await carregar()
  }

  async function baixar(row: ArquivoRow) {
    setErro(null)
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(row.storage_path, 60)
    if (error || !data?.signedUrl) { setErro(erroAmigavel(error, 'Não consegui gerar o link do documento. Tente de novo.')); return }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function remover(row: ArquivoRow) {
    if (!confirm(`Excluir "${row.nome_arquivo}"? Sai da lista (exclusão rastreável — o arquivo não é apagado de vez).`)) return
    setErro(null)
    const { error } = await supabase.from('erp_obra_arquivos').update({ deleted_at: new Date().toISOString() }).eq('id', row.id)
    if (error) { setErro(erroAmigavel(error, 'Não consegui excluir o documento. Tente de novo.')); return }
    await carregar()
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault(); setArrastando(false)
    const f = e.dataTransfer.files?.[0]; if (f) void anexar(f)
  }

  const visiveis = filtro === 'todos' ? lista : lista.filter((r) => r.tipo === filtro)

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 18px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>← Voltar ao cockpit da obra</Link>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 10 }}>Hub · Gestão de Obras</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: ESP, margin: '2px 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
          Encerramento da obra <AjudaCampo chave="projetos.encerramento.aba" rota={ROTA} />
        </h1>
        {obra?.nome && <div style={{ fontSize: 13, color: MUT, marginBottom: 16 }}>{obra.nome}</div>}

        {carregando ? (
          <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div>
        ) : !obra ? (
          <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Obra não encontrada ou sem acesso.</div>
        ) : emLiberacao ? (
          <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🗂️</div>
            <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, color: ESP, marginBottom: 6 }}>Documentos da obra — em liberação</div>
            <div style={{ fontSize: 13, color: MUT, lineHeight: 1.5, maxWidth: 440, margin: '0 auto' }}>
              Esta área está sendo habilitada para a sua empresa. Em breve você poderá anexar e consultar
              termo de entrega, ART/RRT, as built, laudos e fotos da obra, tudo em arquivo privado.
            </div>
          </div>
        ) : (
          <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginBottom: 12 }}>
              Documentos da obra <AjudaCampo chave="projetos.encerramento.documentos" rota={ROTA} />
            </div>

            {/* enviar: escolher o tipo e anexar */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: MUT, textTransform: 'uppercase', letterSpacing: 0.6, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  Tipo do documento <AjudaCampo chave="projetos.encerramento.tipo" rota={ROTA} />
                </span>
                <select value={tipoUpload} onChange={(e) => setTipoUpload(e.target.value)} style={inp}>
                  {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
              </label>

              <div style={{ flex: 1, minWidth: 220 }}>
                <span style={{ fontSize: 11, color: MUT, textTransform: 'uppercase', letterSpacing: 0.6, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  Enviar documento <AjudaCampo chave="projetos.encerramento.upload" rota={ROTA} />
                </span>
                <div
                  data-ajuda="projetos.encerramento.upload"
                  onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
                  onDragLeave={() => setArrastando(false)}
                  onDrop={handleDrop}
                  onClick={() => inputRef.current?.click()}
                  role="button" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
                  style={{ border: `1.5px dashed ${arrastando ? GOLD : 'rgba(61,35,20,0.3)'}`, borderRadius: 8, padding: '14px', textAlign: 'center', background: arrastando ? 'rgba(200,148,26,0.08)' : 'rgba(61,35,20,0.02)', cursor: enviando ? 'wait' : 'pointer', opacity: enviando ? 0.6 : 1 }}
                >
                  <div style={{ fontSize: 13, color: ESP, fontWeight: 500 }}>{enviando ? 'Anexando…' : '📎 Anexar — arraste ou clique'}</div>
                  <div style={{ fontSize: 11, color: MUT, marginTop: 4 }}>PDF, JPG, PNG ou WebP — até 10 MB</div>
                  <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void anexar(f); e.target.value = '' }} />
                </div>
              </div>
            </div>

            {erro && <div style={{ background: '#FCEBEB', color: VERM, padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 12 }}>{erro}</div>}

            {/* filtrar por tipo */}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              <span style={{ fontSize: 11, color: MUT, textTransform: 'uppercase', letterSpacing: 0.6, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                Filtrar por tipo <AjudaCampo chave="projetos.encerramento.filtro" rota={ROTA} />
              </span>
              <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={inp}>
                <option value="todos">Todos</option>
                {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </label>

            {/* lista */}
            {visiveis.length === 0 ? (
              <div style={{ fontSize: 12.5, color: MUT, padding: '10px 0', fontStyle: 'italic' }}>
                {lista.length === 0 ? 'Nenhum documento anexado ainda.' : 'Nenhum documento deste tipo.'}
              </div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {visiveis.map((row) => (
                  <li key={row.id} style={{ background: BG, border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: GOLD, textTransform: 'uppercase', letterSpacing: 0.5, minWidth: 92 }}>{tipoLabel(row.tipo)}</span>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ fontSize: 13, color: ESP, fontWeight: 500, wordBreak: 'break-word' }}>{row.nome_arquivo}</div>
                      <div style={{ fontSize: 11, color: MUT, marginTop: 2 }}>{fmtTamanho(row.tamanho_bytes)} · enviado em {fmtData(row.enviado_em)}</div>
                    </div>
                    <button type="button" onClick={() => void baixar(row)} style={{ background: GOLD, color: ESP, border: 'none', padding: '6px 14px', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Baixar</button>
                    <button type="button" onClick={() => void remover(row)} style={{ background: 'transparent', color: VERM, border: `0.5px solid rgba(163,45,45,0.4)`, padding: '6px 12px', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}>Excluir</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const inp: React.CSSProperties = { fontSize: 13, padding: '7px 10px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#FFF', color: ESP }
