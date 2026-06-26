'use client'
import ModuloPreview from '@/components/pm/ModuloPreview'
import { PM_MODULOS } from '@/components/pm/modulos-conteudo'

export default function Page() {
  const c = PM_MODULOS['margem-job']
  return <ModuloPreview {...c} icone={<span>{c.icone}</span>} />
}
