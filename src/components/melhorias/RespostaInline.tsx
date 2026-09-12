'use client'
// #61 (Jordana · Central de Melhorias) · substitui os window.prompt de resposta/motivo por um textarea
// INLINE com rascunho salvo em localStorage. window.prompt é de UMA linha e some (perde o texto) se a
// pessoa troca de janela pra conferir algo — foi o que silenciava chamado (ela desistia de reescrever).
// Aqui: várias linhas, e o rascunho persiste por chave (tela+ação+id). Só limpa ao ENVIAR; cancelar
// preserva (nada se perde). localStorage em try/catch (aba privada/bloqueado não quebra a tela · RD-51).
//
// O botão 🎙️ (ditar, #63) entra DEPOIS, aqui neste mesmo componente — um lugar só serve os dois lados.
import { useEffect, useRef, useState } from 'react'

function lerRascunho(key: string): string {
  try { return localStorage.getItem(key) ?? '' } catch { return '' }
}
function salvarRascunho(key: string, v: string) {
  try { if (v) localStorage.setItem(key, v); else localStorage.removeItem(key) } catch { /* private mode */ }
}

export function RespostaInline({
  draftKey, placeholder, submitLabel = 'Enviar', initial = '', obrigatorio = true, busy = false,
  onSubmit, onCancel,
}: {
  draftKey: string
  placeholder: string
  submitLabel?: string
  initial?: string
  obrigatorio?: boolean
  busy?: boolean
  onSubmit: (texto: string) => void | Promise<void>
  onCancel: () => void
}) {
  // rascunho salvo vence o initial (se a pessoa já tinha escrito e saiu, volta com o texto dela)
  const [texto, setTexto] = useState(() => lerRascunho(draftKey) || initial)
  const [erro, setErro] = useState(false)
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => { ref.current?.focus() }, [])
  useEffect(() => { salvarRascunho(draftKey, texto) }, [draftKey, texto])

  const enviar = async () => {
    if (obrigatorio && !texto.trim()) { setErro(true); ref.current?.focus(); return }
    await onSubmit(texto.trim())
    salvarRascunho(draftKey, '') // só limpa o rascunho quando envia de fato
  }

  return (
    <div style={{ marginTop: 8, background: '#FFFDF8', border: '1px solid #E7DED3', borderRadius: 10, padding: 10 }}>
      <textarea
        ref={ref}
        value={texto}
        onChange={(e) => { setTexto(e.target.value); if (erro) setErro(false) }}
        placeholder={placeholder}
        rows={4}
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 72,
          fontSize: 13, lineHeight: 1.45, color: '#3D2314', padding: '9px 11px',
          borderRadius: 8, border: `1px solid ${erro ? '#EF4444' : '#E7DED3'}`, background: '#fff', fontFamily: 'inherit',
        }}
      />
      {erro && <div style={{ fontSize: 11, color: '#EF4444', marginTop: 4 }}>Escreva algo antes de enviar.</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
        <button type="button" onClick={() => void enviar()} disabled={busy}
          style={{ background: busy ? '#B9A98F' : '#C8941A', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 12.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
          {busy ? 'Enviando…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}
          style={{ background: 'transparent', color: '#7A6A57', border: '1px solid #E7DED3', borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          Cancelar
        </button>
        <span style={{ fontSize: 10.5, color: '#918C82' }}>rascunho salvo — trocar de janela não perde o texto</span>
      </div>
    </div>
  )
}
