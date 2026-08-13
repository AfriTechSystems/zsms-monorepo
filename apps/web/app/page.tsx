import { getCountryConfig } from '@zsms/config'

export default function HomePage() {
  const country = getCountryConfig()
  return (
    <main>
      <h1>ZSMS</h1>
      <p>
        {country.name} ({country.code}) · {country.currency.code}
      </p>
      <p>Phase 0 scaffold. No application features are built yet.</p>
    </main>
  )
}
