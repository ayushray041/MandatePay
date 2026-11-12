'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { registerAgentProfile } from '@/lib/agents/client';
import { agentCategories, agentProfileCreateSchema } from '@/models/agent';
import type { AgentProfile } from '@/models/agent';

export function AgentRegistrationForm({
  onRegistered,
}: {
  onRegistered: (profile: AgentProfile) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const category = String(formData.get('category') ?? '');
    const capabilityDescription = String(formData.get('capabilityDescription') ?? '');
    const payload = {
      headline: String(formData.get('headline') ?? ''),
      bio: String(formData.get('bio') ?? ''),
      categories: [category],
      capabilities: [{ category, description: capabilityDescription }],
      supportedCurrencies: String(formData.get('supportedCurrencies') ?? '')
        .split(',')
        .map((currency) => currency.trim().toUpperCase())
        .filter(Boolean),
      availability: String(formData.get('availability') ?? ''),
    };
    const parsed = agentProfileCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Review your agent profile details.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      onRegistered(await registerAgentProfile(parsed.data));
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Agent profile could not be saved.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5 border border-mp-warm-grey bg-mp-surface p-5 sm:p-7">
      <div>
        <p className="mp-kicker">Agent registration</p>
        <h2 className="mt-2 text-xl font-semibold">Publish your capabilities</h2>
        <p className="mp-copy mt-2">
          Your verified account identity is attached by the server. Only freelancer accounts can
          register as agents.
        </p>
      </div>
      {error && <p className="border-l-2 border-mp-orange px-4 py-2 text-sm" role="alert">{error}</p>}
      <fieldset disabled={loading} className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className="mp-label">Professional headline</span>
          <input name="headline" required minLength={3} maxLength={120} className="mp-input mt-1" />
        </label>
        <label>
          <span className="mp-label">Service category</span>
          <select name="category" className="mp-input mt-1" defaultValue={agentCategories[0]}>
            {agentCategories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </label>
        <label className="sm:col-span-2">
          <span className="mp-label">Capability description</span>
          <textarea
            name="capabilityDescription"
            required
            minLength={10}
            maxLength={500}
            rows={3}
            className="mp-input mt-1"
          />
        </label>
        <label className="sm:col-span-2">
          <span className="mp-label">Profile bio</span>
          <textarea name="bio" required minLength={20} maxLength={1500} rows={4} className="mp-input mt-1" />
        </label>
        <label>
          <span className="mp-label">Supported currencies</span>
          <input name="supportedCurrencies" defaultValue="USD" className="mp-input mt-1" aria-describedby="currency-format" />
          <span id="currency-format" className="mt-1 block text-xs text-mp-medium-grey">Comma-separated ISO 4217 codes.</span>
        </label>
        <label>
          <span className="mp-label">Availability</span>
          <select name="availability" className="mp-input mt-1" defaultValue="available">
            <option value="available">Available</option>
            <option value="busy">Busy</option>
          </select>
        </label>
      </fieldset>
      <Button type="submit" disabled={loading}>
        {loading ? 'Registering…' : 'Register as an agent'}
      </Button>
    </form>
  );
}
