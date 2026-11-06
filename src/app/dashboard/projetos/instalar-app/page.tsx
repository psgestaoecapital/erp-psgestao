'use client'

// App de campo do vendedor (Hub). Reusa <InstalarApp> (RD-52). O QR/link abre o Funil de
// Oportunidades. offline=false: o funil NÃO tem cache offline como o rebanho do Agro (RD-51 —
// não prometemos "sem internet"). Limitação aceita (RD-98 p3): o manifest PWA é global
// (um único start_url para todas as superfícies de instalação), então o ícone instalado abre
// a home do app, não o funil direto. O QR/link abrem o funil; o usuário toca em Oportunidades
// para voltar — é honesto para o usuário na prop `nota` abaixo.
// RD-98 pilar 3: esta tela OPTA por rastrear a instalação (prop `rastrear`) — registra por empresa e
// mostra "pessoas que já instalaram" (fn_app_instalacao_*), para a tela consumir/gravar dado real.
import InstalarApp from '@/components/comum/InstalarApp'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ROTA = '/dashboard/projetos/instalar-app'

export default function InstalarAppHubPage() {
  const { companyIds } = useCompanyIds()
  const companyId = companyIds[0] // empresa selecionada (consolidado usa a primeira) — o tracking é por empresa

  return (
    <InstalarApp
      destino="/dashboard/projetos/oportunidades?area=hub"
      titulo="Instalar o PS Gestão no celular"
      subtitulo="App de campo do vendedor: abra rápido e trabalhe o funil de qualquer lugar."
      offline={false}
      rastrear={companyId ? { companyId, rota: ROTA, area: 'hub' } : undefined}
      ajuda={{
        instalar: 'projetos.instalar_app.instalar_agora',
        qr: 'projetos.instalar_app.qr',
        whatsapp: 'projetos.instalar_app.whatsapp',
        copiar: 'projetos.instalar_app.copiar_link',
        link: 'projetos.instalar_app.link',
        versao: 'projetos.instalar_app.versao',
        instalacoes: 'projetos.instalar_app.instalacoes',
      }}
      nota="O QR e o link abrem direto o Funil de Oportunidades. Depois de instalado, o ícone abre a home do app — é só tocar em Oportunidades pra voltar ao funil."
    />
  )
}
