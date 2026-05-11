import { Briefcase } from 'lucide-react'
import AreaRootPlaceholder from '@/components/area/AreaRootPlaceholder'

export default function ServicesRootPage() {
  return <AreaRootPlaceholder areaId="services" fallbackNome="Serviços" fallbackIcon={<Briefcase size={24} />} />
}
