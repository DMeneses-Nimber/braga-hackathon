import type { Field } from '../api.js'
import { Activity, Globe, Hash, MapPin } from 'lucide-react'

const ICONS = {
  address: MapPin,
  cae: Hash,
  site: Globe,
  status: Activity,
} as const

export function FieldIcon({ field, className = 'size-4' }: { field: Field; className?: string }) {
  const Icon = ICONS[field]
  return <Icon className={className} aria-hidden />
}
