'use client'

// <Modal> CENTRAL — fonte única de comportamento de diálogo (regra da Jordana: NUNCA fecha no clique-fora).
// Fecha só por X (sempre visível), Esc (= Cancelar) ou ações explícitas do rodapé. aria-modal, scroll-lock,
// retorno de foco ao elemento anterior, mobile-first (full-height em telas pequenas). Identidade PS.
// Migração incremental: os modais bespoke trocam o wrapper por este, um a um (RD-53 — só muda o clique-fora).
import React, { useEffect, useRef } from 'react'

const ESP = '#3D2314', BG = '#FAF7F2', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'

interface ModalProps {
  open: boolean
  onClose: () => void            // disparado pelo X e pelo Esc (= Cancelar)
  title: React.ReactNode
  subtitle?: React.ReactNode
  children: React.ReactNode      // corpo (rolável)
  footer?: React.ReactNode       // ações explícitas (Cancelar/Confirmar/Salvar)
  maxWidth?: number
}

export default function Modal({ open, onClose, title, subtitle, children, footer, maxWidth = 480 }: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const prevFocus = useRef<Element | null>(null)

  // onClose costuma ser uma arrow inline no pai (nova identidade a cada render). Guardamos numa ref
  // para o efeito abaixo NÃO depender dela — senão a cada tecla o pai re-renderiza, o efeito faz
  // cleanup e devolve o foco ao elemento anterior (prevFocus), fechando o teclado no tablet.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!open) return
    prevFocus.current = document.activeElement
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden' // scroll-lock
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current() } // Esc = Cancelar
    document.addEventListener('keydown', onKey)
    // foco inicial no diálogo (acessibilidade); retorna ao elemento anterior no unmount
    const t = setTimeout(() => cardRef.current?.focus(), 0)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      clearTimeout(t)
      if (prevFocus.current instanceof HTMLElement) prevFocus.current.focus()
    }
    // Só [open]: abrir/fechar. NÃO re-executa a cada render do pai (ver onCloseRef acima).
  }, [open])

  if (!open) return null

  return (
    // backdrop SEM onClick — clicar fora NÃO fecha (regra da Jordana)
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1000 }}>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        style={{
          background: BG, borderRadius: 12, width: '100%', maxWidth,
          maxHeight: '92vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)', outline: 'none',
        }}
      >
        <div style={{ padding: '14px 18px', borderBottom: `0.5px solid ${LINE}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: ESP }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: MUT, marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button type="button" aria-label="Fechar" onClick={onClose} style={{ background: 'transparent', border: 'none', color: MUT, fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 2 }}>✕</button>
        </div>

        <div style={{ padding: 18, overflowY: 'auto' }}>{children}</div>

        {footer && (
          <div style={{ padding: '12px 18px', borderTop: `0.5px solid ${LINE}`, display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>{footer}</div>
        )}
      </div>
    </div>
  )
}
