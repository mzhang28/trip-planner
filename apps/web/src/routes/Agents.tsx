import { Button, Card, TextField, ThemeToggle } from '@trip/ui';
import { ArrowLeft, Bot, Check, Copy, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ApiError, api, type AgentClient, type NewAgentClient } from '../lib/api';

/**
 * Where an agent is given credentials to connect with.
 *
 * The server does not hand these out to anything that asks for them, so this
 * screen is the only way one comes into existence. What it produces goes into
 * the agent's own configuration, and the agent then runs the ordinary consent
 * flow against it — this decides that a client may ask, not what it may see.
 */
export function Agents() {
  const [clients, setClients] = useState<AgentClient[] | null>(null);
  const [name, setName] = useState('');
  const [redirect, setRedirect] = useState('');
  const [confidential, setConfidential] = useState(true);
  const [created, setCreated] = useState<NewAgentClient | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .listClients()
      .then(({ clients: rows }) => setClients(rows))
      .catch(() => setClients([]));
  }, []);

  async function create() {
    setSaving(true);
    setFailure(null);

    try {
      const client = await api.createClient({
        name: name.trim(),
        redirectUris: [redirect.trim()],
        confidential,
      });

      setCreated(client);
      setName('');
      setRedirect('');
      setClients(await api.listClients().then((r) => r.clients));
    } catch (error) {
      setFailure(
        error instanceof ApiError && error.code === 'invalid_client_metadata'
          ? 'That redirect address will not do. It has to be https, or http back to your own machine.'
          : 'The agent could not be created.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove(clientId: string) {
    await api.deleteClient(clientId);
    setClients(await api.listClients().then((r) => r.clients));
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-page text-ink">
      <header className="shrink-0 border-b border-line">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <Link
              to="/"
              aria-label="Back to trips"
              className="rounded-md p-1 text-ink-secondary hover:bg-sunken hover:text-ink"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
            </Link>
            <h1 className="text-lg">Agents</h1>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-y-auto px-4 py-8 sm:px-6">
        <p className="mb-6 text-sm text-ink-secondary">
          An agent needs credentials from here before it can ask for anything. Give it these, and the
          next time it connects you will be asked which trips it may see.
        </p>

        {created && <Credentials client={created} onDismiss={() => setCreated(null)} />}

        <Card className="mb-8 p-4 sm:p-5">
          <h2 className="mb-4 text-sm font-medium text-ink">New agent</h2>

          <div className="mb-4 flex flex-col gap-4">
            <TextField
              label="Name"
              placeholder="Gemini Spark"
              value={name}
              onChange={setName}
              description="Shown on the consent screen when it asks for access."
            />
            <TextField
              label="Redirect address"
              placeholder="https://example.com/oauth/callback"
              value={redirect}
              onChange={setRedirect}
              description="Where it is sent back after you approve. Its own documentation gives this."
            />
          </div>

          <label className="mb-4 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--accent)]"
              checked={confidential}
              onChange={(event) => setConfidential(event.target.checked)}
            />
            <span className="min-w-0">
              <span className="block text-sm text-ink">It runs on a server</span>
              <span className="mt-0.5 block text-xs text-ink-muted">
                A hosted agent gets a secret, because it can keep one. Leave this off for something
                running on your own machine, where the secret would sit in every copy.
              </span>
            </span>
          </label>

          {failure && <p className="mb-4 text-sm text-danger-text">{failure}</p>}

          <Button
            variant="primary"
            isDisabled={saving || name.trim() === '' || redirect.trim() === ''}
            onPress={() => void create()}
          >
            Create agent
          </Button>
        </Card>

        <h2 className="mb-2 text-sm font-medium text-ink">Agents you have made</h2>

        {clients === null ? (
          <p className="text-sm text-ink-muted" aria-busy="true">
            Loading…
          </p>
        ) : clients.length === 0 ? (
          <p className="text-sm text-ink-muted">None yet.</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="agent-clients">
            {clients.map((client) => (
              <li key={client.clientId}>
                <Card className="flex items-start gap-3 p-3 sm:p-4">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-sunken text-ink-secondary">
                    <Bot aria-hidden="true" className="size-4" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{client.name}</p>
                    <p className="truncate font-mono text-2xs text-ink-muted">{client.clientId}</p>
                    <p className="mt-1 text-2xs text-ink-muted">
                      {client.confidential ? 'Has a secret' : 'Uses PKCE'} ·{' '}
                      {client.grants === 0
                        ? 'not connected'
                        : `${client.grants} live ${client.grants === 1 ? 'grant' : 'grants'}`}
                    </p>
                  </div>

                  <Button
                    size="sm"
                    variant="danger"
                    aria-label={`Remove ${client.name}`}
                    onPress={() => void remove(client.clientId)}
                  >
                    <Trash2 aria-hidden="true" className="size-3.5" />
                    Remove
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

/** Shown once. The secret is stored hashed, so there is no second showing. */
function Credentials({ client, onDismiss }: { client: NewAgentClient; onDismiss: () => void }) {
  return (
    <Card raised className="mb-8 border-accent p-4 sm:p-5" data-testid="new-agent-credentials">
      <h2 className="mb-1 text-sm font-medium text-ink">{client.name} is ready</h2>
      <p className="mb-4 text-xs text-ink-secondary">
        {client.clientSecret
          ? 'Copy these into the agent now. The secret is not stored anywhere it can be read back, so this is the only time it is shown.'
          : 'Copy this into the agent. It has no secret, and proves itself with PKCE instead.'}
      </p>

      <Field label="Client ID" value={client.clientId} />
      {client.clientSecret && <Field label="Client secret" value={client.clientSecret} />}

      <Button size="sm" className="mt-4" onPress={onDismiss}>
        <Check aria-hidden="true" className="size-3.5" />
        Done
      </Button>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mb-2">
      <p className="mb-1 text-2xs text-ink-muted">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-sunken px-2 py-1.5 font-mono text-xs text-ink">
          {value}
        </code>
        <Button
          size="sm"
          aria-label={`Copy ${label}`}
          onPress={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? (
            <Check aria-hidden="true" className="size-3.5" />
          ) : (
            <Copy aria-hidden="true" className="size-3.5" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}
