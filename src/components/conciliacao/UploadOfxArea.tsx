'use client'

// Upload OFX/QFX · PR 14 V2 (CEO 26/05/2026)
// Parser pure JS (ofx-js) · cria lote via fn_conciliacao_criar_lote
// (RPC ja recebe array de movimentos no payload jsonb).
//
// Banco real: Sicoob/Nubank/Itau/Bradesco/BB/Santander/Inter
// (qualquer instituicao que gera OFX padrao).

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseSync } from 'ofx-js'
import { supabase } from '@/lib/supabase'

type Estado = 'idle' | 'lendo' | 'parseando' | 'enviando' | 'sucesso' | 'erro'

interface MovimentoOfx {
  data_transacao: string
  valor: number
  natureza: 'credit' | 'debit'
  descricao: string
  id_externo: string | null
  documento: string | null
}

function parseDataOfx(s: string): string {
  // OFX date: YYYYMMDD[HHMMSS][.XXX][TZ]
  const ano = s.substring(0, 4)
  const mes = s.substring(4, 6)
  const dia = s.substring(6, 8)
  return `${ano}-${mes}-${dia}`
}

function hashSimples(texto: string): string {
  let h = 0
  for (let i = 0; i < texto.length; i++) {
    h = ((h << 5) - h) + texto.charCodeAt(i)
    h |= 0
  }
  return `ofx_${Math.abs(h).toString(16)}_${texto.length}`
}

function extrairMovimentos(parsed: { OFX: Record<string, unknown> }): {
  movimentos: MovimentoOfx[]
  banco: string
  conta: string
  periodo_inicio: string | null
  periodo_fim: string | null
} {
  const ofx = parsed.OFX as Record<string, unknown>
  const bankMsg = ofx?.BANKMSGSRSV1 as Record<string, unknown> | undefined
  const stmtTrnRs = bankMsg?.STMTTRNRS as Record<string, unknown> | undefined
  const stmtRs = stmtTrnRs?.STMTRS as Record<string, unknown> | undefined

  const acctFrom = stmtRs?.BANKACCTFROM as Record<string, string> | undefined
  const banco = acctFrom?.BANKID ?? acctFrom?.ORG ?? 'OFX'
  const conta = acctFrom?.ACCTID ?? ''

  const tranList = stmtRs?.BANKTRANLIST as Record<string, unknown> | undefined
  const periodo_inicio = tranList?.DTSTART ? parseDataOfx(tranList.DTSTART as string) : null
  const periodo_fim = tranList?.DTEND ? parseDataOfx(tranList.DTEND as string) : null

  const trns = tranList?.STMTTRN
  const trnsArr = Array.isArray(trns) ? trns : trns ? [trns] : []

  const movimentos: MovimentoOfx[] = trnsArr.map((t: Record<string, string>) => {
    const valorRaw = parseFloat((t.TRNAMT ?? '0').replace(',', '.'))
    return {
      data_transacao: parseDataOfx(t.DTPOSTED ?? ''),
      valor: Math.abs(valorRaw),
      natureza: valorRaw >= 0 ? 'credit' : 'debit',
      descricao: (t.MEMO ?? t.NAME ?? '(sem descrição)').trim(),
      id_externo: t.FITID ?? null,
      documento: t.CHECKNUM ?? null,
    }
  })

  return { movimentos, banco, conta, periodo_inicio, periodo_fim }
}

export default function UploadOfxArea({ companyId }: { companyId: string }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [estado, setEstado] = useState<Estado>('idle')
  const [progresso, setProgresso] = useState<string>('')
  const [erro, setErro] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  async function processarArquivo(file: File) {
    setErro(null)
    setEstado('lendo')
    setProgresso(`Lendo ${file.name}...`)

    try {
      const texto = await file.text()

      setEstado('parseando')
      setProgresso('Parseando OFX...')
      const parsed = parseSync(texto)

      const { movimentos, banco, conta, periodo_inicio, periodo_fim } = extrairMovimentos(parsed)

      if (movimentos.length === 0) {
        throw new Error('Nenhuma transação encontrada no arquivo. Verifique se é um OFX válido.')
      }

      setEstado('enviando')
      setProgresso(`Criando lote com ${movimentos.length} movimentos...`)

      const nomeLote = `${banco}${conta ? ' · ' + conta : ''} · ${file.name}`
      const arquivoHash = hashSimples(texto)

      const { data: ret, error } = await supabase.rpc('fn_conciliacao_criar_lote', {
        p_company_id: companyId,
        p_tipo: 'bancario',
        p_origem: 'ofx',
        p_nome: nomeLote,
        p_arquivo_nome: file.name,
        p_arquivo_hash: arquivoHash,
        p_storage_path: '',
        p_movimentos: movimentos,
        p_periodo_inicio: periodo_inicio,
        p_periodo_fim: periodo_fim,
        p_conta_bancaria_id: null,
        p_cartao_id: null,
        p_operadora: null,
      })

      if (error) throw error

      const loteId = typeof ret === 'object' && ret !== null
        ? (ret as Record<string, unknown>).lote_id ?? (ret as Record<string, unknown>).id
        : ret

      setEstado('sucesso')
      setProgresso(`✓ Lote criado · ${movimentos.length} movimentos importados`)

      setTimeout(() => {
        if (loteId) {
          router.push(`/dashboard/financeiro/conciliacao/${loteId}`)
        } else {
          router.refresh()
        }
      }, 800)
    } catch (e) {
      console.error('Erro upload OFX:', e)
      setEstado('erro')
      setErro(e instanceof Error ? e.message : String(e))
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processarArquivo(file)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processarArquivo(file)
  }

  const loading = estado === 'lendo' || estado === 'parseando' || estado === 'enviando'

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      style={{
        border: `2px dashed ${dragOver ? '#C8941A' : 'rgba(61,35,20,0.25)'}`,
        background: dragOver ? '#FFF8E7' : '#FFFFFF',
        borderRadius: 12,
        padding: '32px 20px',
        textAlign: 'center',
        transition: 'all 0.15s ease',
        cursor: loading ? 'wait' : 'pointer',
      }}
      onClick={() => !loading && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".ofx,.qfx,.OFX,.QFX"
        onChange={handleChange}
        disabled={loading}
        style={{ display: 'none' }}
      />

      {estado === 'idle' && (
        <>
          <div style={{ fontSize: 36, marginBottom: 12 }} aria-hidden>📤</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#3D2314', marginBottom: 6 }}>
            Arraste um arquivo OFX/QFX aqui · ou clique para selecionar
          </div>
          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', maxWidth: 420, margin: '0 auto' }}>
            Aceita extratos OFX/QFX de Sicoob, Nubank, Itaú, Bradesco, Banco do Brasil, Santander, Inter.
            Parser local · nenhum dado enviado a terceiros.
          </div>
        </>
      )}

      {loading && (
        <>
          <div style={{ fontSize: 28, marginBottom: 12 }} aria-hidden>⏳</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#3D2314' }}>
            {progresso}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 6 }}>
            Aguarde · não feche a janela
          </div>
        </>
      )}

      {estado === 'sucesso' && (
        <>
          <div style={{ fontSize: 28, marginBottom: 12 }} aria-hidden>✅</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#3B6D11' }}>
            {progresso}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 6 }}>
            Redirecionando para o lote…
          </div>
        </>
      )}

      {estado === 'erro' && (
        <>
          <div style={{ fontSize: 28, marginBottom: 12 }} aria-hidden>⚠</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#A32D2D', marginBottom: 6 }}>
            Não foi possível importar
          </div>
          <div style={{ fontSize: 11, color: '#A32D2D', maxWidth: 500, margin: '0 auto', wordBreak: 'break-word' }}>
            {erro}
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setEstado('idle'); setErro(null); setProgresso('') }}
            style={{ marginTop: 12, background: 'transparent', border: '0.5px solid rgba(61,35,20,0.2)', padding: '6px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: '#3D2314' }}
          >
            Tentar novamente
          </button>
        </>
      )}
    </div>
  )
}
