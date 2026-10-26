import { Compass } from 'lucide-react'
import { Link } from 'react-router'

import { Card, EmptyState } from '../components/ui.js'

export function NotFoundPage() {
  return (
    <Card>
      <title>Página não encontrada · Data Integrity Agent</title>
      <EmptyState
        icon={<Compass />}
        title="Página não encontrada"
        description="O endereço não corresponde a nenhuma página."
        action={
          <Link to="/" className="text-sm font-medium text-accent hover:underline">
            Ir para as empresas
          </Link>
        }
      />
    </Card>
  )
}
