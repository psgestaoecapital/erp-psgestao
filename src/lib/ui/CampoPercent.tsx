'use client'
// #5660 — campo de percentual/decimal padrão BR: aceita vírgula (e ponto) como
// separador decimal. Use no lugar de <input type="number"> para campos de % e de
// quantidade decimal. Emite o número já parseado (ou null quando vazio); o texto
// digitado fica num rascunho interno para a vírgula não "sumir" enquanto se digita.
import { useEffect, useState, type CSSProperties } from 'react'
import { parseNumBR } from '@/lib/num'

function textoDe(value: number | null | undefined): string {
  // Mantém o "vazio para zero" do comportamento antigo (value||'' / value??'').
  if (value == null || value === 0) return ''
  return String(value).replace('.', ',')
}

export function CampoPercent({
  value, onChange, placeholder, style, className, id, disabled, readOnly, title, testId,
}: {
  value: number | null | undefined
  onChange: (n: number | null) => void
  placeholder?: string
  style?: CSSProperties
  className?: string
  id?: string
  disabled?: boolean
  readOnly?: boolean
  title?: string
  testId?: string
}) {
  const [draft, setDraft] = useState<string>(textoDe(value))

  // Ressincroniza o texto quando o valor externo muda (carregar/limpar o formulário,
  // trocar de item), sem atropelar a digitação: só quando o número externo diverge do
  // que o texto já representa.
  useEffect(() => {
    const atual = parseNumBR(draft)
    const externo = value == null ? null : Number(value)
    const vazioOk = draft.trim() === '' && (externo == null || externo === 0)
    if (!vazioOk && atual !== externo) setDraft(textoDe(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <input
      id={id}
      data-testid={testId}
      value={draft}
      disabled={disabled}
      readOnly={readOnly}
      title={title}
      onChange={(e) => {
        if (readOnly) return
        setDraft(e.target.value)
        onChange(parseNumBR(e.target.value))
      }}
      placeholder={placeholder}
      inputMode="decimal"
      autoComplete="off"
      className={className}
      style={style}
    />
  )
}
