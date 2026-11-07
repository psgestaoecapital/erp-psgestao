'use client'
// Aprovações dos sócios (CEO 06/11/2026): "nada deve ficar parado; deve fluir com OK de qualquer um de nós".
// Gilberto, Rodrigo e Jordana aprovam igual: (1) PRs que o revisor mandou para a bandeja (documento fiscal, financeiro de
// cliente, permissão…) — a decisão vai para o GitHub em até 15 min (bandeja-socios.yml) como `ceo-aprovado` + comentário
// com quem decidiu; (2) pedidos de núcleo da caixa (requer_ok_ceo). Quem não é aprovador não vê este bloco.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { quando } from '@/lib/dev/painelCodes'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/dev/codes'
const ESP = '#3D2314', DOU = '#C8941A', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F', VERDE = '#3F7A2A', VERM = '#B23A2E'

type Item = { pr_numero: number; titulo: string; code: string | null; url: string | null; patch_id: string | null; motivo: string | null; entrou_em: string }
type Decidida = { pr_numero: number; decisao: string; justificativa: string; aprovado_nome: string; aprovado_em: string; sincronizado_em: string | null; sincronizado_resultado: string | null; titulo: string | null }
type Nucleo = { id: string; para: string; de: string; assunto: string | null; criado_em: string; corpo: string | null }
type Dados = { ok: boolean; eu: string; aguardando: Item[]; decididas: Decidida[]; nucleo: Nucleo[] }

const ERROS: Record<string, string> = {
  justificativa_curta: 'Escreva a justificativa (mínimo 10 letras).',
  pr_fora_da_bandeja: 'Essa PR já saiu da bandeja (decidida ou publicada). A lista foi atualizada.',
  versao_mudou: 'O código da PR mudou depois do parecer do revisor. Espere a nova revisão.',
}

export default function AprovacoesSocios() {
  const [dados, setDados] = useState<Dados | null>(null)
  const [texto, setTexto] = useState<Record<number, string>>({})
  const [aberto, setAberto] = useState<number | null>(null)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [agora, setAgora] = useState(() => new Date())

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_pr_bandeja_listar')
    if (!error && data) { setDados(data as Dados); setAgora(new Date()) } else setDados(null)
  }, [])
  useEffect(() => { void carregar(); const t = setInterval(() => { void carregar() }, 60000); return () => clearInterval(t) }, [carregar])

  async function decidir(it: Item, decisao: 'aprovada' | 'recusada') {
    setEnviando(true); setAviso(null)
    const { data, error } = await supabase.rpc('fn_pr_bandeja_aprovar', {
      p_pr_numero: it.pr_numero, p_patch_id: it.patch_id, p_decisao: decisao, p_justificativa: texto[it.pr_numero] ?? '',
    })
    setEnviando(false)
    const r = data as { ok: boolean; erro?: string } | null
    if (error || !r?.ok) { setAviso({ ok: false, texto: ERROS[r?.erro ?? ''] ?? `Não gravou: ${error?.message ?? r?.erro}` }); void carregar(); return }
    setAviso({ ok: true, texto: `#${it.pr_numero} ${decisao === 'aprovada' ? 'aprovada' : 'recusada'}. Vai para o GitHub em até 15 min.` })
    setAberto(null); void carregar()
  }

  async function okNucleo(m: Nucleo) {
    setEnviando(true); setAviso(null)
    const { data, error } = await supabase.rpc('fn_aprovador_ok_mensagem', { p_mensagem_id: m.id })
    setEnviando(false)
    const r = data as { ok: boolean; erro?: string } | null
    setAviso(error || !r?.ok ? { ok: false, texto: `Não gravou: ${error?.message ?? r?.erro}` } : { ok: true, texto: `OK dado para "${m.assunto ?? m.id}". O Code executa na próxima rodada.` })
    void carregar()
  }

  if (!dados?.ok) return null
  const total = dados.aguardando.length + dados.nucleo.length

  return (
    <div style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 16, marginBottom: 12, color: ESP }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, fontSize: 16 }}>Aprovações dos sócios</span><AjudaCampo chave="dev.aprovar.bandeja" rota={ROTA} />
        <span style={{ fontSize: 12, color: total ? VERM : VERDE, fontWeight: 700 }}>{total ? `${total} esperando` : 'nada parado'}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: TXM }}>você: {dados.eu} · qualquer sócio aprova</span>
      </div>
      {aviso && <div style={{ marginTop: 8, fontSize: 13, color: aviso.ok ? VERDE : VERM }}>{aviso.texto}</div>}

      {dados.aguardando.map((it) => (
        <div key={it.pr_numero} style={{ borderTop: `1px solid ${BD}`, marginTop: 10, paddingTop: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <a href={it.url ?? '#'} target="_blank" rel="noreferrer" style={{ fontWeight: 700, color: ESP }}>#{it.pr_numero} {it.titulo}</a>
            <span style={{ fontSize: 12, color: TXM }}>{it.code ?? 'Code?'} · na bandeja desde {quando(it.entrou_em, agora)}</span>
            <button onClick={() => setAberto(aberto === it.pr_numero ? null : it.pr_numero)} style={btnSec}>{aberto === it.pr_numero ? 'Fechar' : 'Ler e decidir'}</button>
          </div>
          {aberto === it.pr_numero && (
            <div style={{ marginTop: 8 }}>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, background: '#FAF7F2', border: `1px solid ${BD}`, borderRadius: 8, padding: 10, maxHeight: 260, overflowY: 'auto' }}>{it.motivo ?? 'Sem resumo do revisor.'}</div>
              <label style={{ display: 'grid', gap: 4, marginTop: 8 }}>
                <span style={{ fontSize: 12, color: TXM, display: 'flex', alignItems: 'center', gap: 4 }}>Justificativa <AjudaCampo chave="dev.aprovar.justificativa" rota={ROTA} /></span>
                <textarea rows={2} value={texto[it.pr_numero] ?? ''} onChange={(e) => setTexto({ ...texto, [it.pr_numero]: e.target.value })}
                  placeholder="Por que aprova ou recusa (fica gravado com o seu nome)" style={{ border: `1px solid ${BD}`, borderRadius: 8, padding: 8, fontSize: 13, fontFamily: 'inherit' }} />
              </label>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                <button disabled={enviando} onClick={() => void decidir(it, 'aprovada')} style={btnPri}>Aprovar</button>
                <button disabled={enviando} onClick={() => void decidir(it, 'recusada')} style={btnDel}>Recusar</button>
                <AjudaCampo chave="dev.aprovar.botao" rota={ROTA} />
              </div>
            </div>
          )}
        </div>
      ))}

      {dados.nucleo.length > 0 && (
        <div style={{ borderTop: `1px solid ${BD}`, marginTop: 10, paddingTop: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>Pedidos de núcleo da caixa <AjudaCampo chave="dev.aprovar.nucleo" rota={ROTA} /></div>
          {dados.nucleo.map((m) => (
            <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', marginTop: 6, fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>{m.assunto ?? '(sem assunto)'}</span>
              <span style={{ fontSize: 12, color: TXM }}>{m.de} → {m.para} · {quando(m.criado_em, agora)}</span>
              <button disabled={enviando} onClick={() => void okNucleo(m)} style={btnPri}>Dar OK</button>
            </div>
          ))}
        </div>
      )}

      {dados.decididas.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ fontSize: 12, color: TXM, cursor: 'pointer' }}>Últimas decisões ({dados.decididas.length})</summary>
          {dados.decididas.map((d, i) => (
            <div key={i} style={{ fontSize: 12, marginTop: 4 }}>
              <b style={{ color: d.decisao === 'aprovada' ? VERDE : VERM }}>#{d.pr_numero} {d.decisao}</b> por {d.aprovado_nome} · {quando(d.aprovado_em, agora)} — {d.justificativa}
              <span style={{ color: TXM }}> · {d.sincronizado_em ? d.sincronizado_resultado : 'indo para o GitHub'}</span>
            </div>
          ))}
        </details>
      )}
    </div>
  )
}

const btnPri: React.CSSProperties = { padding: '6px 14px', background: DOU, color: ESP, border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 13 }
const btnSec: React.CSSProperties = { padding: '4px 10px', background: 'transparent', color: ESP, border: `1px solid ${BD}`, borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 12 }
const btnDel: React.CSSProperties = { padding: '6px 14px', background: 'transparent', color: VERM, border: `1px solid ${VERM}55`, borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 13 }
