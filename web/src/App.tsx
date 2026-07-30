import AppLayout from './components/AppLayout'
import PRListPage from './pages/PRListPage'
import POListPage from './pages/POListPage'
import InvoicePage from './pages/InvoicePage'
import AuditPage from './pages/AuditPage'
import { DocumentProvider, useDocument } from './contexts/DocumentContext'
import { LanguageProvider } from './i18n/LanguageContext'
import type { DocumentPage } from './contexts/documentModel'

export type Page = DocumentPage

function AppInner() {
  const { state, dispatch } = useDocument()
  const page = state.activePage

  function handleNavigate(p: Page) {
    dispatch({ type: 'NAVIGATE', page: p })
  }

  const content = {
    prs:      <PRListPage />,
    pos:      <POListPage />,
    invoices: <InvoicePage />,
    audit:    <AuditPage />,
  }[page]

  return <AppLayout page={page} onNavigate={handleNavigate}>{content}</AppLayout>
}

export default function App() {
  return (
    <LanguageProvider>
      <DocumentProvider>
        <AppInner />
      </DocumentProvider>
    </LanguageProvider>
  )
}
