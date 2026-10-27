import { Route, Routes } from 'react-router'

import { Layout } from './components/Layout.js'
import { CompaniesPage } from './pages/CompaniesPage.js'
import { CompanyPage } from './pages/CompanyPage.js'
import { NotFoundPage } from './pages/NotFoundPage.js'
import { ProposalsPage } from './pages/ProposalsPage.js'

export function App() {
  return (
    <Layout>
      <Routes>
        <Route index element={<CompaniesPage />} />
        <Route path="empresas/:nif" element={<CompanyPage />} />
        <Route path="propostas" element={<ProposalsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  )
}
