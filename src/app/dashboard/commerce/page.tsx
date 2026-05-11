import { Store } from 'lucide-react'
import AreaRootPlaceholder from '@/components/area/AreaRootPlaceholder'

export default function CommerceRootPage() {
  return <AreaRootPlaceholder areaId="commerce" fallbackNome="Comércio" fallbackIcon={<Store size={24} />} />
}
