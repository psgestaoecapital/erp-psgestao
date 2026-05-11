import { PaintBucket } from 'lucide-react'
import AreaRootPlaceholder from '@/components/area/AreaRootPlaceholder'

export default function PmRootPage() {
  return <AreaRootPlaceholder areaId="pm" fallbackNome="P&M" fallbackIcon={<PaintBucket size={24} />} />
}
