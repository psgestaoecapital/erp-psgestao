import { Wrench } from 'lucide-react'
import AreaRootPlaceholder from '@/components/area/AreaRootPlaceholder'

export default function OficinaRootPage() {
  return <AreaRootPlaceholder areaId="oficina" fallbackNome="Oficina" fallbackIcon={<Wrench size={24} />} />
}
