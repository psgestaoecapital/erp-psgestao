'use client'

// Anexo do comprovante da receita (contas a receber) — recount aud8 23/11, gap de paridade:
// a tela de nova receita não deixava anexar o recibo/contrato/nota da venda. O arquivo vai para o
// bucket PRIVADO 'receber-comprovantes' em <empresa>/<arquivo> (1º segmento = company_id → RLS por
// empresa) e o caminho segue no erp_receber.anexo_path do lançamento. Quem é da empresa abre por link
// assinado de 5 min; o perfil de consulta de outra empresa não alcança o arquivo (policy do bucket).
//
// Mesmo padrão já provado do comprovante da despesa (financeiro/ComprovantePagar.tsx) e do bucket
// 'obra-documentos' (RLS por empresa no 1º segmento do path).
import { useState } from 'react'
import { Camera, FileText, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

export const BUCKET_RECEBER_COMPROVANTE = 'receber-comprovantes'
const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
const MAX_BYTES = 20 * 1024 * 1024

// Campo de upload. Sobe o arquivo para o storage (não depende do id do título — o 1º segmento do
// path é a empresa, que é o que a RLS confere) e devolve o caminho + nome original pelo onChange.
// O caminho é persistido em erp_receber.anexo_path: no CRIAR, no bloco pós-insert; no EDITAR, na hora.
export function CampoComprovanteReceber({
  empresa,
  anexoPath,
  anexoNome,
  onChange,
  onRemover,
}: {
  empresa: string
  anexoPath: string
  anexoNome: string
  onChange: (path: string, nome: string) => void
  onRemover: () => void
}) {
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  async function enviar(f: File | undefined) {
    if (!f) return
    setErro('')
    if (!TIPOS.includes(f.type)) { setErro('Envie foto (JPG, PNG, WEBP, HEIC) ou PDF.'); return }
    if (f.size > MAX_BYTES) { setErro('Arquivo acima de 20 MB. Reduza e tente de novo.'); return }
    setEnviando(true)
    const ext = (f.name.split('.').pop() || 'dat').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)
    const path = `${empresa}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage
      .from(BUCKET_RECEBER_COMPROVANTE)
      .upload(path, f, { contentType: f.type, upsert: false })
    setEnviando(false)
    if (error) { setErro('Não foi possível enviar o comprovante agora. Tente novamente.'); return }
    onChange(path, f.name.slice(0, 180))
  }

  return (
    // data-ajuda: o "?" (RD-95) deste campo é renderizado pelo <Campo ajuda="financeiro.receita.comprovante">
    // que envolve o componente na tela — este marcador evita um "?" duplicado e cobre os inputs no gate.
    <div data-ajuda="financeiro.receita.comprovante" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {anexoPath ? (
        // Já tem comprovante: mostra o link para ver + botão de remover (RD-98 · incluir/ver/excluir).
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <VerComprovanteReceber path={anexoPath} nome={anexoNome} />
          <button
            type="button"
            data-testid="receita-comprovante-remover"
            onClick={onRemover}
            aria-label="Remover comprovante"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, color: '#9a3412', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            <X size={14} aria-hidden /> Remover
          </button>
          <label data-ajuda="financeiro.receita.comprovante" style={{ fontSize: 13, color: '#8a6d00', fontWeight: 600, cursor: 'pointer' }}>
            Trocar
            <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} disabled={enviando} onChange={(e) => enviar(e.target.files?.[0])} />
          </label>
        </div>
      ) : (
        <label
          data-testid="receita-comprovante-campo"
          data-ajuda="financeiro.receita.comprovante"
          style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 8, border: '1px dashed rgba(61,35,20,0.3)', padding: '8px 10px', fontSize: 14, cursor: enviando ? 'wait' : 'pointer', background: '#fff' }}
        >
          <Camera size={16} aria-hidden />
          <input type="file" accept="image/*,application/pdf" style={{ width: '100%', fontSize: 13 }} disabled={enviando} onChange={(e) => enviar(e.target.files?.[0])} />
        </label>
      )}
      {enviando && <span style={{ fontSize: 12, opacity: 0.6 }}>Enviando…</span>}
      {erro && <span role="alert" style={{ fontSize: 12, color: '#b91c1c' }}>{erro}</span>}
    </div>
  )
}

// Abre o comprovante por link assinado de curta duração (não expõe o bucket).
export function VerComprovanteReceber({ path, nome }: { path: string; nome?: string }) {
  const [erro, setErro] = useState(false)
  async function abrir() {
    setErro(false)
    const { data, error } = await supabase.storage.from(BUCKET_RECEBER_COMPROVANTE).createSignedUrl(path, 300)
    if (error || !data?.signedUrl) { setErro(true); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 13 }}>
      <button
        type="button"
        data-testid="receita-comprovante-ver"
        aria-label="Ver comprovante anexado"
        onClick={abrir}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, color: '#1f6f3f', fontWeight: 600, textDecoration: 'underline', cursor: 'pointer' }}
      >
        <FileText size={14} aria-hidden />{nome ? nome : 'Ver comprovante'}
      </button>
      {erro && <span role="alert" style={{ marginLeft: 6, color: '#b91c1c' }}>não abriu — tente de novo</span>}
    </span>
  )
}
