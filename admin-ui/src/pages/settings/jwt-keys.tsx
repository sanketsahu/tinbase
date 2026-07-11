import { SettingsRow, SettingsSection } from './shared'

const Code = ({ children }: { children: string }) => (
  <code className="rounded bg-code px-1 py-px font-mono text-foreground/90">{children}</code>
)

/** How JWT signing works in tinbase and how to rotate the secret. */
export function JwtSettings() {
  return (
    <SettingsSection
      title="JWT keys"
      description="All tokens — anon key, service_role key, and user sessions — are HS256 JWTs signed with one secret."
    >
      <SettingsRow label="Secret" description="Never exposed over the API. Configured where tinbase starts.">
        <div className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
          <p>
            <Code>TINBASE_JWT_SECRET</Code> environment variable, or the <Code>--jwt-secret</Code> CLI flag.
          </p>
          <p>
            Without either, a well-known development default is used — fine locally, but set a real secret before exposing the
            server to anything.
          </p>
        </div>
      </SettingsRow>
      <SettingsRow label="Rotation" description="Rotating the secret invalidates every existing token.">
        <ol className="list-inside list-decimal space-y-1.5 text-xs leading-relaxed text-muted-foreground">
          <li>
            Restart with the new secret: <Code>TINBASE_JWT_SECRET=… tinbase start</Code>
          </li>
          <li>
            Grab the re-derived keys from the startup banner or <Code>tinbase keys</Code>
          </li>
          <li>Update every client using the old keys — and sign back in to this studio</li>
        </ol>
      </SettingsRow>
    </SettingsSection>
  )
}
