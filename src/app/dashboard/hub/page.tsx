import { Building2 } from 'lucide-react'
import AreaRootPlaceholder from '@/components/area/AreaRootPlaceholder'

export default function HubRootPage() {
  return <AreaRootPlaceholder areaId="hub" fallbackNome="Hub Projetos" fallbackIcon={<Building2 size={24} />} />
}
