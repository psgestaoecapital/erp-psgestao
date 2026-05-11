import { Wheat } from 'lucide-react'
import AreaRootPlaceholder from '@/components/area/AreaRootPlaceholder'

export default function AgroRootPage() {
  return <AreaRootPlaceholder areaId="agro" fallbackNome="Agro" fallbackIcon={<Wheat size={24} />} />
}
