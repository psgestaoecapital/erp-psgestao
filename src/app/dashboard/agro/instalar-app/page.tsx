'use client'

// Reusa o componente genérico <InstalarApp> (RD-52). Comportamento idêntico ao anterior:
// QR + WhatsApp + copiar link + instruções, apontando pro rebanho. Agro cacheia o rebanho
// offline (rebanhoOffline + SW) → offline honesto.
import InstalarApp from '@/components/comum/InstalarApp'

export default function InstalarAppPage() {
  return (
    <InstalarApp
      destino="/dashboard/agro/rebanho"
      titulo="Instalar o PS Gestão no celular"
      subtitulo="Instale como app pra abrir rápido e consultar o rebanho até sem internet."
      offline
    />
  )
}
