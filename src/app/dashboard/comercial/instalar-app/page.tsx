'use client'

// App de vendas no celular (CEO 12/11). Reusa o componente genérico <InstalarApp> (RD-26/RD-52,
// mesma fonte do Agro e do Hub): QR + WhatsApp + copiar link + passos Android/iPhone + "Instalar app".
// O QR/link abrem o painel de vendas. RD-98 pilar 3: OPTA por rastrear a instalação por empresa
// (fn_app_instalacao_*), mostrando quantas pessoas já instalaram.
import InstalarApp from '@/components/comum/InstalarApp'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ROTA = '/dashboard/comercial/instalar-app'

export default function InstalarAppVendasPage() {
  const { companyIds } = useCompanyIds()
  const companyId = companyIds[0] // empresa selecionada (consolidado usa a primeira) — o tracking é por empresa

  return (
    <InstalarApp
      destino="/dashboard/comercial/meu-painel"
      titulo="App de vendas"
      subtitulo="Abra o painel de vendas no celular: suas vendas, preços e metas na palma da mão, onde você estiver."
      offline={false}
      rastrear={companyId ? { companyId, rota: ROTA, area: 'comercial' } : undefined}
      ajuda={{
        instalar: 'comercial.instalar_app.instalar_agora',
        qr: 'comercial.instalar_app.qr',
        whatsapp: 'comercial.instalar_app.whatsapp',
        copiar: 'comercial.instalar_app.copiar_link',
        link: 'comercial.instalar_app.link',
        versao: 'comercial.instalar_app.versao',
        instalacoes: 'comercial.instalar_app.instalacoes',
      }}
      nota="O QR e o link abrem o painel de vendas. Depois de instalado, o app abre no início do seu usuário — o vendedor cai direto no painel."
    />
  )
}
