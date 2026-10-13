'use client'

// App de campo do vendedor (Hub). Reusa <InstalarApp> (RD-52). O QR/link abre o Funil de
// Oportunidades. offline=false: o funil NÃO tem cache offline como o rebanho do Agro (RD-51 —
// não prometemos "sem internet"). Nota honesta: o ícone instalado abre a home do app
// (start_url do manifest), não o funil direto — ajuste do manifest fica pra depois.
import InstalarApp from '@/components/comum/InstalarApp'

export default function InstalarAppHubPage() {
  return (
    <InstalarApp
      destino="/dashboard/projetos/oportunidades?area=hub"
      titulo="Instalar o PS Gestão no celular"
      subtitulo="App de campo do vendedor: abra rápido e trabalhe o funil de qualquer lugar."
      offline={false}
      nota="O QR e o link abrem direto o Funil de Oportunidades. Depois de instalado, o ícone abre a home do app — é só tocar em Oportunidades pra voltar ao funil."
    />
  )
}
