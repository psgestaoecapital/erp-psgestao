'use client'
// #5660 — campo numérico (valor/percentual/quantidade) que ACEITA vírgula E ponto como
// separador decimal, no lugar de <input type="number"> (que, no locale en-US, nem deixa
// digitar vírgula). Mantém um buffer de texto local para o usuário poder digitar "1,5"
// sem o número controlado reescrever o campo no meio da digitação; emite o número já
// normalizado via parseNumBR (fonte única RD-52, a mesma do importador #4946 e dos %).
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { parseNumBR } from '@/lib/num'

// número → texto BR para preencher o campo (valor já gravado / edição). Sem separador de
// milhar para não brigar com a digitação; "1234.5" → "1234,5".
function paraTextoBR(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'string') return v
  if (!Number.isFinite(v)) return ''
  return String(v).replace('.', ',')
}

export function CampoDecimal({
  value,
  onChange,
  placeholder,
  style,
  className,
  id,
  disabled,
  readOnly,
  title,
  testId,
  ariaLabel,
  step,
  min,
  max,
}: {
  value: number | string | null | undefined
  onChange: (n: number | null) => void
  placeholder?: string
  style?: CSSProperties
  className?: string
  id?: string
  disabled?: boolean
  readOnly?: boolean
  title?: string
  testId?: string
  ariaLabel?: string
  // dicas (o input é texto; min/max/step não são impostos pelo navegador, ficam como metadados)
  step?: string | number
  min?: number
  max?: number
}) {
  const [txt, setTxt] = useState<string>(() => paraTextoBR(value))
  // último número que ESTE campo emitiu — para só re-sincronizar quando o valor externo muda
  // por outro motivo (carregar registro, reset), e não logo após o próprio onChange.
  const ultimoEmitido = useRef<number | null>(typeof value === 'number' ? value : parseNumBR(value ?? null))

  useEffect(() => {
    const externo = typeof value === 'number' ? value : parseNumBR(value ?? null)
    const digitado = parseNumBR(txt)
    // re-sincroniza o buffer só se o valor externo difere do que temos e do que acabamos de emitir
    if (externo !== digitado && externo !== ultimoEmitido.current) {
      setTxt(paraTextoBR(value))
      ultimoEmitido.current = externo
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <input
      id={id}
      data-testid={testId}
      aria-label={ariaLabel}
      value={txt}
      disabled={disabled}
      readOnly={readOnly}
      title={title}
      placeholder={placeholder}
      inputMode="decimal"
      autoComplete="off"
      data-step={step}
      data-min={min}
      data-max={max}
      onChange={(e) => {
        if (readOnly) return
        const raw = e.target.value
        setTxt(raw)
        const n = parseNumBR(raw)
        ultimoEmitido.current = n
        onChange(n)
      }}
      className={className}
      style={style}
    />
  )
}
