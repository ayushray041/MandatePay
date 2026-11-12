'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ApiClientError } from '@/lib/api/client';
import {
  addMarketplaceOrganizationMember,
  createMarketplaceOrganization,
  createMarketplaceService,
  getAgentCapabilityDocument,
  getMarketplaceAgent,
  getMarketplaceListingHistory,
  getMarketplacePreferences,
  getMarketplaceProfileSettings,
  listMarketplaceOrganizations,
  listMarketplaceOrganizationMembers,
  listMyMarketplaceServices,
  pauseMarketplaceService,
  removeMarketplaceOrganizationMember,
  searchMarketplace,
  updateMarketplaceDirectorySettings,
  updateMarketplacePreferences,
  updateMarketplaceService,
  type MarketplaceSearchFilters,
} from '@/lib/marketplace/client';
import {
  marketplaceDirectorySettingsSchema,
  marketplaceServiceListingInputSchema,
  type MarketplaceDirectorySettings,
  type MarketplaceServiceListing,
} from '@/models/marketplace';
import { agentCategories } from '@/models/agent';

type SearchResult = Awaited<ReturnType<typeof searchMarketplace>>;
type OwnerListing = Awaited<ReturnType<typeof listMyMarketplaceServices>>[number];
type Organization = Awaited<ReturnType<typeof listMarketplaceOrganizations>>[number];
type OrganizationMember = Awaited<ReturnType<typeof listMarketplaceOrganizationMembers>>[number];

const comparisonRows: Array<{
  label: string;
  value: (listing: MarketplaceServiceListing) => string;
}> = [
  { label: 'Agent', value: (listing) => listing.agentName },
  { label: 'Price', value: (listing) => formatPrice(listing.pricing) },
  { label: 'Availability', value: (listing) => listing.availability },
  { label: 'Rating', value: ratingLabel },
  {
    label: 'Reliability',
    value: (listing) => listing.reliabilityPercent === null ? 'No data' : `${listing.reliabilityPercent}%`,
  },
  { label: 'Completed transactions', value: (listing) => String(listing.completedTransactions) },
];

const initialFilters: MarketplaceSearchFilters = {
  sort: 'recommended',
  page: 1,
  pageSize: 12,
};

const initialForm = {
  title: '',
  description: '',
  category: 'software',
  actions: '',
  pricingModel: 'fixed',
  amountMinor: '',
  minimumMinor: '',
  maximumMinor: '',
  currency: 'USD',
  availability: 'available',
  responseTimeHours: '24',
  deliveryTimeDays: '7',
  includedRevisions: '1',
  authenticationRequirements: ['scoped_agent_api_key'],
  protocolVersions: 'v1.0',
  status: 'draft',
};

function priceScale(currency: string): number {
  try {
    const fractionDigits = new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
    return 10 ** fractionDigits;
  } catch {
    return 100;
  }
}

function formatPrice(pricing: MarketplaceServiceListing['pricing']): string {
  if (pricing.model === 'quote') {
    return `Quote in ${pricing.currency}`;
  }
  const scale = priceScale(pricing.currency);
  const format = (amount: number) => new Intl.NumberFormat('en', {
    style: 'currency',
    currency: pricing.currency,
  }).format(amount / scale);
  if (pricing.model === 'dynamic') {
    return `${format(pricing.minimumMinor)}–${format(pricing.maximumMinor)} · dynamic`;
  }
  const suffix = pricing.model === 'hourly' ? ' / hour' : pricing.model === 'from' ? ' starting' : '';
  return `${format(pricing.amountMinor)}${suffix}`;
}

function idsFromText(value: string): string[] {
  return value.split(/[\s,]+/).map((id) => id.trim()).filter(Boolean);
}

function joinIds(values: string[]): string {
  return values.join(', ');
}

function ratingLabel(listing: MarketplaceServiceListing): string {
  return listing.reviewCount > 0
    ? `${listing.averageRating.toFixed(1)} / 5 · ${listing.reviewCount} reviews`
    : 'No verified reviews yet';
}

async function loadMarketplaceOwnerState() {
  const [listings, profile, organizations, preferences] = await Promise.all([
    listMyMarketplaceServices(),
    getMarketplaceProfileSettings().catch((caughtError: unknown) => {
      if (caughtError instanceof ApiClientError && caughtError.status === 404) {
        return null;
      }
      throw caughtError;
    }),
    listMarketplaceOrganizations(),
    getMarketplacePreferences(),
  ]);
  return { listings, profile, organizations, preferences };
}

export function MarketplaceWorkspace() {
  const [draftFilters, setDraftFilters] = useState<MarketplaceSearchFilters>(initialFilters);
  const [activeFilters, setActiveFilters] = useState<MarketplaceSearchFilters>(initialFilters);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [ownerListings, setOwnerListings] = useState<OwnerListing[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [marketplaceProfile, setMarketplaceProfile] = useState<Awaited<ReturnType<typeof getMarketplaceProfileSettings>> | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Awaited<ReturnType<typeof getMarketplaceAgent>> | null>(null);
  const [capabilityDocument, setCapabilityDocument] = useState<Awaited<ReturnType<typeof getAgentCapabilityDocument>> | null>(null);
  const [listingHistory, setListingHistory] = useState<Awaited<ReturnType<typeof getMarketplaceListingHistory>>>([]);
  const [comparedIds, setComparedIds] = useState<string[]>([]);
  const [editingListingId, setEditingListingId] = useState<string | null>(null);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('');
  const [organizationMembers, setOrganizationMembers] = useState<OrganizationMember[]>([]);
  const [form, setForm] = useState(initialForm);
  const [privateAllowlistText, setPrivateAllowlistText] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [newMemberUid, setNewMemberUid] = useState('');
  const [preferencesAllowText, setPreferencesAllowText] = useState('');
  const [preferencesBlockText, setPreferencesBlockText] = useState('');
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const applyOwnerData = useCallback((data: Awaited<ReturnType<typeof loadMarketplaceOwnerState>>) => {
    setOwnerListings(data.listings);
    setMarketplaceProfile(data.profile);
    setOrganizations(data.organizations);
    setPreferencesAllowText(joinIds(data.preferences.allowlistedAgentIds));
    setPreferencesBlockText(joinIds(data.preferences.blocklistedAgentIds));
    if (data.profile?.directorySettings.visibility === 'private') {
      setPrivateAllowlistText(joinIds(data.profile.directorySettings.allowlistedAgentIds));
    }
    if (data.profile?.directorySettings.visibility === 'organization') {
      setSelectedOrganizationId(data.profile.directorySettings.organizationId);
    }
  }, []);

  const refreshOwnerData = useCallback(async () => {
    applyOwnerData(await loadMarketplaceOwnerState());
  }, [applyOwnerData]);

  useEffect(() => {
    let active = true;
    searchMarketplace(activeFilters)
      .then((result) => {
        if (active) {
          setSearchResult(result);
          setError(null);
        }
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : 'Marketplace search failed.');
        }
      })
      .finally(() => {
        if (active) {
          setSearching(false);
        }
      });
    return () => {
      active = false;
    };
  }, [activeFilters]);

  useEffect(() => {
    let active = true;
    void loadMarketplaceOwnerState()
      .then((data) => {
        if (active) {
          applyOwnerData(data);
        }
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : 'Marketplace controls could not be loaded.');
        }
      });
    return () => {
      active = false;
    };
  }, [applyOwnerData]);

  useEffect(() => {
    const organization = organizations.find((item) => item.organizationId === selectedOrganizationId);
    if (!organization || organization.role !== 'owner') {
      return;
    }
    let active = true;
    listMarketplaceOrganizationMembers(selectedOrganizationId)
      .then((members) => {
        if (active) {
          setOrganizationMembers(members);
        }
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : 'Organization members could not be loaded.');
        }
      });
    return () => {
      active = false;
    };
  }, [organizations, selectedOrganizationId]);

  const runOwnerAction = async (action: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await refreshOwnerData();
      setNotice(successMessage);
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Marketplace action failed.');
    } finally {
      setBusy(false);
    }
  };

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearching(true);
    setActiveFilters({ ...draftFilters, page: 1, pageSize: 12 });
  };

  const toggleCompare = (listingId: string) => {
    setComparedIds((current) => current.includes(listingId)
      ? current.filter((id) => id !== listingId)
      : current.length < 3 ? [...current, listingId] : current);
  };

  const loadAgent = async (agentId: string) => {
    setBusy(true);
    setError(null);
    try {
      const [agent, capability] = await Promise.all([
        getMarketplaceAgent(agentId),
        getAgentCapabilityDocument(agentId),
      ]);
      setSelectedAgent(agent);
      setCapabilityDocument(capability);
      setListingHistory([]);
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Agent details could not be loaded.');
    } finally {
      setBusy(false);
    }
  };

  const showListingHistory = async (listingId: string) => {
    setBusy(true);
    setError(null);
    try {
      setListingHistory(await getMarketplaceListingHistory(listingId));
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Listing history could not be loaded.');
    } finally {
      setBusy(false);
    }
  };

  const setFormField = (field: keyof typeof initialForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const saveListing = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const currency = form.currency.trim().toUpperCase();
    const amount = Number(form.amountMinor);
    const pricing = form.pricingModel === 'dynamic'
      ? {
        model: 'dynamic',
        minimumMinor: Number(form.minimumMinor),
        maximumMinor: Number(form.maximumMinor),
        currency,
      }
      : form.pricingModel === 'quote'
        ? { model: 'quote', currency }
        : {
          model: form.pricingModel,
          amountMinor: amount,
          currency,
        };
    const parsed = marketplaceServiceListingInputSchema.safeParse({
      title: form.title,
      description: form.description,
      category: form.category,
      actions: idsFromText(form.actions),
      pricing,
      availability: form.availability,
      serviceLevelAgreement: {
        responseTimeHours: Number(form.responseTimeHours),
        deliveryTimeDays: Number(form.deliveryTimeDays),
        includedRevisions: Number(form.includedRevisions),
      },
      authenticationRequirements: form.authenticationRequirements,
      protocolVersions: idsFromText(form.protocolVersions),
      status: form.status,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Review the service listing fields.');
      return;
    }
    await runOwnerAction(async () => {
      if (editingListingId) {
        await updateMarketplaceService(editingListingId, parsed.data);
      } else {
        await createMarketplaceService(parsed.data);
      }
      setForm(initialForm);
      setEditingListingId(null);
    }, editingListingId ? 'Service listing updated.' : 'Service listing created.');
  };

  const startEditing = (item: OwnerListing) => {
    const listing = item.listing;
    const pricing = listing.pricing;
    setEditingListingId(listing.listingId);
    setForm({
      title: listing.title,
      description: listing.description,
      category: listing.category,
      actions: listing.actions.join(', '),
      pricingModel: pricing.model,
      amountMinor: 'amountMinor' in pricing ? String(pricing.amountMinor) : '',
      minimumMinor: pricing.model === 'dynamic' ? String(pricing.minimumMinor) : '',
      maximumMinor: pricing.model === 'dynamic' ? String(pricing.maximumMinor) : '',
      currency: pricing.currency,
      availability: listing.availability,
      responseTimeHours: String(listing.serviceLevelAgreement.responseTimeHours),
      deliveryTimeDays: String(listing.serviceLevelAgreement.deliveryTimeDays),
      includedRevisions: String(listing.serviceLevelAgreement.includedRevisions),
      authenticationRequirements: listing.authenticationRequirements,
      protocolVersions: listing.protocolVersions.join(', '),
      status: item.status,
    });
    setNotice(`Editing “${listing.title}”.`);
  };

  const saveDirectorySettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const visibility = String(new FormData(event.currentTarget).get('directoryVisibility') ?? 'public');
    let settings: MarketplaceDirectorySettings;
    if (visibility === 'private') {
      settings = {
        visibility: 'private',
        allowlistedAgentIds: idsFromText(privateAllowlistText),
      };
    } else if (visibility === 'organization') {
      settings = {
        visibility: 'organization',
        organizationId: selectedOrganizationId,
      };
    } else {
      settings = { visibility: 'public' };
    }
    const parsed = marketplaceDirectorySettingsSchema.safeParse(settings);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Directory settings are invalid.');
      return;
    }
    await runOwnerAction(
      async () => setMarketplaceProfile(await updateMarketplaceDirectorySettings(parsed.data)),
      'Directory visibility updated.',
    );
  };

  const savePreferences = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = {
      allowlistedAgentIds: idsFromText(preferencesAllowText),
      blocklistedAgentIds: idsFromText(preferencesBlockText),
    };
    await runOwnerAction(async () => {
      await updateMarketplacePreferences(next);
    }, 'Marketplace allowlist and blocklist saved.');
  };

  const createOrganization = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await runOwnerAction(async () => {
      const created = await createMarketplaceOrganization(organizationName);
      setOrganizationName('');
      setSelectedOrganizationId(created.organizationId);
    }, 'Organization created.');
  };

  const addOrganizationMember = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedOrganizationId) {
      return;
    }
    await runOwnerAction(async () => {
      await addMarketplaceOrganizationMember(selectedOrganizationId, newMemberUid);
      setNewMemberUid('');
    }, 'Member added to the organization.');
  };

  const editDirectoryVisibility = marketplaceProfile?.directorySettings.visibility ?? 'public';
  const comparisonListings = searchResult?.listings.filter((listing) => comparedIds.includes(listing.listingId)) ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="border-b border-mp-warm-grey pb-6">
        <p className="mp-kicker">Agent network</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Agent Marketplace</h1>
            <p className="mp-copy mt-2 max-w-3xl">
              Discover real agent services, compare terms, and inspect verified capabilities.
              Listings appear only after an agent publishes them.
            </p>
          </div>
          <span className="border border-mp-warm-grey px-3 py-2 text-xs font-medium text-mp-medium-grey">
            No seeded or demo listings
          </span>
        </div>
      </header>

      {error && <p className="border-l-2 border-mp-orange px-4 py-2 text-sm" role="alert">{error}</p>}
      {notice && <p className="border-l-2 border-mp-green px-4 py-2 text-sm" role="status">{notice}</p>}

      <section aria-labelledby="marketplace-search-title" className="space-y-4">
        <div>
          <p className="mp-kicker">Discovery</p>
          <h2 id="marketplace-search-title" className="mt-1 text-xl font-semibold">Find a service</h2>
        </div>
        <form onSubmit={submitSearch} className="grid gap-3 border border-mp-warm-grey bg-mp-surface p-4 md:grid-cols-4">
          <label className="md:col-span-2">
            <span className="mp-label">Search services and capabilities</span>
            <input
              value={draftFilters.q ?? ''}
              maxLength={100}
              onChange={(event) => setDraftFilters((current) => ({ ...current, q: event.target.value }))}
              className="mp-input mt-1"
              placeholder="Describe the work or action"
            />
          </label>
          <label>
            <span className="mp-label">Category</span>
            <select
              value={draftFilters.category ?? ''}
              onChange={(event) => setDraftFilters((current) => ({ ...current, category: event.target.value || undefined }))}
              className="mp-input mt-1"
            >
              <option value="">All categories</option>
              {agentCategories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <label>
            <span className="mp-label">Supported action</span>
            <input
              value={draftFilters.action ?? ''}
              maxLength={64}
              onChange={(event) => setDraftFilters((current) => ({ ...current, action: event.target.value || undefined }))}
              className="mp-input mt-1"
              placeholder="e.g. data-analysis"
            />
          </label>
          <label>
            <span className="mp-label">Currency</span>
            <input
              value={draftFilters.currency ?? ''}
              maxLength={3}
              onChange={(event) => setDraftFilters((current) => ({ ...current, currency: event.target.value.toUpperCase() || undefined }))}
              className="mp-input mt-1"
              placeholder="USD"
            />
          </label>
          <label>
            <span className="mp-label">Minimum price (minor units)</span>
            <input
              type="number"
              min="0"
              value={draftFilters.minPriceMinor ?? ''}
              onChange={(event) => setDraftFilters((current) => ({
                ...current,
                minPriceMinor: event.target.value ? Number(event.target.value) : undefined,
              }))}
              className="mp-input mt-1"
            />
          </label>
          <label>
            <span className="mp-label">Maximum price (minor units)</span>
            <input
              type="number"
              min="0"
              value={draftFilters.maxPriceMinor ?? ''}
              onChange={(event) => setDraftFilters((current) => ({
                ...current,
                maxPriceMinor: event.target.value ? Number(event.target.value) : undefined,
              }))}
              className="mp-input mt-1"
            />
          </label>
          <label>
            <span className="mp-label">Availability</span>
            <select
              value={draftFilters.availability ?? ''}
              onChange={(event) => setDraftFilters((current) => ({
                ...current,
                availability: (event.target.value || undefined) as MarketplaceSearchFilters['availability'],
              }))}
              className="mp-input mt-1"
            >
              <option value="">Any availability</option>
              <option value="available">Available</option>
              <option value="busy">Busy</option>
              <option value="paused">Paused</option>
            </select>
          </label>
          <label>
            <span className="mp-label">Verification</span>
            <select
              value={draftFilters.verified === undefined ? '' : String(draftFilters.verified)}
              onChange={(event) => setDraftFilters((current) => ({
                ...current,
                verified: event.target.value === '' ? undefined : event.target.value === 'true',
              }))}
              className="mp-input mt-1"
            >
              <option value="">All agents</option>
              <option value="true">Verified</option>
              <option value="false">Not verified</option>
            </select>
          </label>
          <label>
            <span className="mp-label">Sort by</span>
            <select
              value={draftFilters.sort ?? 'recommended'}
              onChange={(event) => setDraftFilters((current) => ({
                ...current,
                sort: event.target.value as MarketplaceSearchFilters['sort'],
              }))}
              className="mp-input mt-1"
            >
              <option value="recommended">Recommended</option>
              <option value="newest">Newest</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
              <option value="rating">Highest rated</option>
              <option value="reliability">Most reliable</option>
              <option value="completed">Most completed transactions</option>
            </select>
          </label>
          <div className="flex items-end">
            <Button type="submit" disabled={searching} className="w-full">
              {searching ? 'Searching…' : 'Search marketplace'}
            </Button>
          </div>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-mp-medium-grey" aria-live="polite">
            {searchResult ? `${searchResult.total} matching services` : 'Loading marketplace…'}
            {searchResult?.truncated ? ' · Showing a bounded discovery window' : ''}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={searching || !searchResult || searchResult.page <= 1}
              onClick={() => {
                setSearching(true);
                setActiveFilters((current) => ({ ...current, page: Math.max(1, (current.page ?? 1) - 1) }));
              }}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={searching || !searchResult?.hasMore}
              onClick={() => {
                setSearching(true);
                setActiveFilters((current) => ({ ...current, page: (current.page ?? 1) + 1 }));
              }}
            >
              Next
            </Button>
          </div>
        </div>

        {searchResult?.listings.length === 0 && !searching ? (
          <div className="border border-dashed border-mp-warm-grey bg-mp-surface px-6 py-12 text-center">
            <h3 className="text-lg font-semibold">No published services match these filters</h3>
            <p className="mp-copy mt-2">Try changing your search, or return when an agent publishes a real service.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {searchResult?.listings.map((listing) => (
              <article key={listing.listingId} className="flex flex-col border border-mp-warm-grey bg-mp-surface p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="mp-kicker">{listing.category}</p>
                    <h3 className="mt-1 text-lg font-semibold">{listing.title}</h3>
                    <button
                      type="button"
                      onClick={() => void loadAgent(listing.agentId)}
                      className="mt-1 text-left text-sm font-medium text-mp-medium-grey underline decoration-mp-warm-grey underline-offset-4 hover:text-mp-ink"
                    >
                      {listing.agentName}
                    </button>
                  </div>
                  {listing.verificationStatus === 'verified' && (
                    <span className="shrink-0 border border-mp-green px-2 py-1 text-xs font-semibold text-mp-green">
                      Verified
                    </span>
                  )}
                </div>
                <p className="mp-copy mt-4 line-clamp-4">{listing.description}</p>
                <p className="mt-4 text-sm font-semibold">{formatPrice(listing.pricing)}</p>
                <div className="mt-3 space-y-1 text-xs text-mp-medium-grey">
                  <p>{listing.availability} · {ratingLabel(listing)}</p>
                  <p>{listing.completedTransactions} completed transactions</p>
                  <p>
                    Reliability: {listing.reliabilityPercent === null
                      ? 'Not enough payment history'
                      : `${listing.reliabilityPercent.toFixed(1)}%`}
                  </p>
                  <p>
                    SLA: responds within {listing.serviceLevelAgreement.responseTimeHours}h ·
                    delivery {listing.serviceLevelAgreement.deliveryTimeDays}d ·
                    {listing.serviceLevelAgreement.includedRevisions} revisions
                  </p>
                </div>
                <div className="mt-auto flex flex-wrap gap-2 pt-5">
                  <Button type="button" variant="outline" onClick={() => void loadAgent(listing.agentId)}>
                    Agent profile
                  </Button>
                  <Button
                    type="button"
                    variant={comparedIds.includes(listing.listingId) ? 'secondary' : 'outline'}
                    onClick={() => toggleCompare(listing.listingId)}
                    disabled={!comparedIds.includes(listing.listingId) && comparedIds.length >= 3}
                  >
                    {comparedIds.includes(listing.listingId) ? 'Compared' : 'Compare'}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {comparisonListings.length > 1 && (
        <section aria-labelledby="compare-title" className="space-y-4 border-t border-mp-warm-grey pt-6">
          <div className="flex items-center justify-between">
            <h2 id="compare-title" className="text-xl font-semibold">Service comparison</h2>
            <Button type="button" variant="outline" onClick={() => setComparedIds([])}>Clear comparison</Button>
          </div>
          <div className="overflow-x-auto border border-mp-warm-grey bg-mp-surface">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-mp-warm-grey">
                <tr>
                  <th scope="col" className="p-3">Service</th>
                  {comparisonListings.map((listing) => (
                    <th scope="col" key={listing.listingId} className="min-w-52 p-3">{listing.title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map(({ label, value }) => (
                  <tr key={String(label)} className="border-b border-mp-warm-grey last:border-0">
                    <th scope="row" className="p-3 font-medium">{label}</th>
                    {comparisonListings.map((listing) => (
                      <td key={listing.listingId} className="p-3">
                        {value(listing)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {selectedAgent && (
        <section aria-labelledby="agent-detail-title" className="space-y-4 border-t border-mp-warm-grey pt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="mp-kicker">Agent profile · {selectedAgent.profile.agentId}</p>
              <h2 id="agent-detail-title" className="mt-1 text-2xl font-semibold">{selectedAgent.profile.displayName}</h2>
              <p className="mp-copy mt-1">{selectedAgent.profile.headline}</p>
            </div>
            <Button type="button" variant="outline" onClick={() => setSelectedAgent(null)}>Close profile</Button>
          </div>
          <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
            <div className="space-y-4">
              <p className="mp-copy">{selectedAgent.profile.bio}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <MetricCard
                  label="Rating"
                  value={selectedAgent.profile.reviewCount > 0
                    ? `${selectedAgent.profile.averageRating.toFixed(1)} / 5 · ${selectedAgent.profile.reviewCount} reviews`
                    : 'No verified reviews yet'}
                />
                <MetricCard label="Completed transactions" value={String(selectedAgent.profile.completedTransactions)} />
                <MetricCard label="Capture reliability" value={selectedAgent.profile.reliabilityPercent === null ? 'Not enough data' : `${selectedAgent.profile.reliabilityPercent}%`} />
              </div>
              <h3 className="text-lg font-semibold">Published services</h3>
              <div className="grid gap-3 md:grid-cols-2">
                {selectedAgent.listings.map((listing) => (
                  <article key={listing.listingId} className="border border-mp-warm-grey bg-mp-surface p-4">
                    <h4 className="font-semibold">{listing.title}</h4>
                    <p className="mp-copy mt-2">{listing.description}</p>
                    <p className="mt-3 text-sm font-semibold">{formatPrice(listing.pricing)}</p>
                    <p className="mt-1 text-xs text-mp-medium-grey">{listing.actions.join(' · ')}</p>
                  </article>
                ))}
                {selectedAgent.listings.length === 0 && (
                  <p className="text-sm text-mp-medium-grey">This agent has no published services visible to you.</p>
                )}
              </div>
              <h3 className="text-lg font-semibold">Verified-customer reviews</h3>
              <div className="space-y-3">
                {selectedAgent.reviews.map((review) => (
                  <blockquote key={review.id} className="border-l-2 border-mp-orange bg-mp-surface px-4 py-3">
                    <p className="text-sm font-semibold">{review.rating} / 5 · {review.reviewerLabel}</p>
                    <p className="mp-copy mt-1">{review.comment}</p>
                  </blockquote>
                ))}
                {selectedAgent.reviews.length === 0 && (
                  <p className="text-sm text-mp-medium-grey">No verified reviews have been submitted.</p>
                )}
              </div>
            </div>
            <aside className="space-y-4 border border-mp-warm-grey bg-mp-surface p-4">
              <h3 className="font-semibold">Capability document</h3>
              <p className="text-xs text-mp-medium-grey">
                Schema v{capabilityDocument?.schemaVersion ?? '—'} · version {capabilityDocument?.version ?? '—'}
              </p>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words bg-mp-app-bg p-3 text-xs">
                {capabilityDocument ? JSON.stringify(capabilityDocument, null, 2) : 'Loading capability data…'}
              </pre>
            </aside>
          </div>
        </section>
      )}

      {listingHistory.length > 0 && (
        <section aria-labelledby="listing-history-title" className="space-y-3 border-t border-mp-warm-grey pt-6">
          <h2 id="listing-history-title" className="text-xl font-semibold">Service listing history</h2>
          <ol className="space-y-2">
            {listingHistory.map((version) => (
              <li key={version.version} className="border border-mp-warm-grey bg-mp-surface p-3">
                <span className="font-semibold">Version {version.version}</span>
                <span className="ml-3 text-sm text-mp-medium-grey">{version.listing.title} · {version.createdAt ?? 'time unavailable'}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section id="marketplace-owner" aria-labelledby="owner-tools-title" className="space-y-6 border-t border-mp-warm-grey pt-8">
        <div>
          <p className="mp-kicker">Owner tools</p>
          <h2 id="owner-tools-title" className="mt-1 text-2xl font-semibold">Manage your marketplace presence</h2>
          <p className="mp-copy mt-2">Only agent profiles and listings you own can be changed here.</p>
        </div>

        {!marketplaceProfile ? (
          <div className="border border-mp-warm-grey bg-mp-surface p-5">
            <p className="font-semibold">Register an agent profile first</p>
            <p className="mp-copy mt-1">Marketplace publishing is available to active registered agents.</p>
          </div>
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-2">
              <form onSubmit={(event) => void saveDirectorySettings(event)} className="space-y-4 border border-mp-warm-grey bg-mp-surface p-5">
                <div>
                  <h3 className="font-semibold">Directory visibility</h3>
                  <p className="mt-1 text-xs text-mp-medium-grey">
                    Verification status: {marketplaceProfile.verificationStatus}
                    {marketplaceProfile.verificationReason ? ` · ${marketplaceProfile.verificationReason}` : ''}
                  </p>
                </div>
                <label>
                  <span className="mp-label">Directory</span>
                  <select
                    name="directoryVisibility"
                    defaultValue={editDirectoryVisibility}
                    className="mp-input mt-1"
                  >
                    <option value="public">Public</option>
                    <option value="private">Private · allowlisted agents only</option>
                    <option value="organization">Organization members</option>
                  </select>
                </label>
                <label>
                  <span className="mp-label">Private directory allowlist (agent IDs)</span>
                  <textarea
                    value={privateAllowlistText}
                    onChange={(event) => setPrivateAllowlistText(event.target.value)}
                    className="mp-input mt-1"
                    rows={2}
                    placeholder="agt_…"
                  />
                </label>
                <label>
                  <span className="mp-label">Organization directory</span>
                  <select
                    value={selectedOrganizationId}
                    onChange={(event) => setSelectedOrganizationId(event.target.value)}
                    className="mp-input mt-1"
                  >
                    <option value="">Select an organization</option>
                    {organizations.map((organization) => (
                      <option key={organization.organizationId} value={organization.organizationId}>
                        {organization.name} · {organization.role}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit" disabled={busy}>Save directory settings</Button>
              </form>

              <form onSubmit={(event) => void savePreferences(event)} className="space-y-4 border border-mp-warm-grey bg-mp-surface p-5">
                <div>
                  <h3 className="font-semibold">Your marketplace access preferences</h3>
                  <p className="mt-1 text-xs text-mp-medium-grey">
                    A non-empty allowlist limits search results to those agents. Blocklisted agents are always excluded.
                  </p>
                </div>
                <label>
                  <span className="mp-label">Allowlisted agent IDs</span>
                  <textarea value={preferencesAllowText} onChange={(event) => setPreferencesAllowText(event.target.value)} className="mp-input mt-1" rows={2} placeholder="agt_…" />
                </label>
                <label>
                  <span className="mp-label">Blocklisted agent IDs</span>
                  <textarea value={preferencesBlockText} onChange={(event) => setPreferencesBlockText(event.target.value)} className="mp-input mt-1" rows={2} placeholder="agt_…" />
                </label>
                <Button type="submit" disabled={busy}>Save access preferences</Button>
              </form>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="space-y-4 border border-mp-warm-grey bg-mp-surface p-5">
                <h3 className="font-semibold">Private organizations</h3>
                <form onSubmit={(event) => void createOrganization(event)} className="flex flex-wrap gap-2">
                  <label className="min-w-48 flex-1">
                    <span className="sr-only">New organization name</span>
                    <input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} className="mp-input" minLength={2} maxLength={100} placeholder="Organization name" required />
                  </label>
                  <Button type="submit" disabled={busy}>Create organization</Button>
                </form>
                <label>
                  <span className="mp-label">Manage members</span>
                  <select value={selectedOrganizationId} onChange={(event) => setSelectedOrganizationId(event.target.value)} className="mp-input mt-1">
                    <option value="">Select an organization</option>
                    {organizations.filter((organization) => organization.role === 'owner').map((organization) => (
                      <option key={organization.organizationId} value={organization.organizationId}>{organization.name}</option>
                    ))}
                  </select>
                </label>
                {organizations.find((organization) => organization.organizationId === selectedOrganizationId)?.role === 'owner' && (
                  <>
                    <form onSubmit={(event) => void addOrganizationMember(event)} className="flex flex-wrap gap-2">
                      <label className="min-w-48 flex-1">
                        <span className="sr-only">Member Firebase UID</span>
                        <input value={newMemberUid} onChange={(event) => setNewMemberUid(event.target.value)} className="mp-input" maxLength={128} placeholder="Existing account UID" required />
                      </label>
                      <Button type="submit" disabled={busy}>Add member</Button>
                    </form>
                    <ul className="space-y-2">
                      {organizationMembers.map((member) => (
                        <li key={member.uid} className="flex items-center justify-between gap-2 border-t border-mp-warm-grey pt-2 text-sm">
                          <span>{member.displayName} · {member.role}</span>
                          {member.role !== 'owner' && (
                            <Button
                              type="button"
                              variant="outline"
                              disabled={busy}
                              onClick={() => void runOwnerAction(
                                () => removeMarketplaceOrganizationMember(selectedOrganizationId, member.uid),
                                'Organization member removed.',
                              )}
                            >
                              Remove
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>

              <form onSubmit={(event) => void saveListing(event)} className="space-y-4 border border-mp-warm-grey bg-mp-surface p-5">
                <div>
                  <h3 className="font-semibold">{editingListingId ? 'Edit service listing' : 'Create a service listing'}</h3>
                  <p className="mt-1 text-xs text-mp-medium-grey">Drafts stay out of discovery until published.</p>
                </div>
                <label>
                  <span className="mp-label">Service title</span>
                  <input value={form.title} onChange={(event) => setFormField('title', event.target.value)} className="mp-input mt-1" minLength={3} maxLength={120} required />
                </label>
                <label>
                  <span className="mp-label">Description</span>
                  <textarea value={form.description} onChange={(event) => setFormField('description', event.target.value)} className="mp-input mt-1" rows={3} minLength={20} maxLength={3000} required />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label>
                    <span className="mp-label">Category</span>
                    <select value={form.category} onChange={(event) => setFormField('category', event.target.value)} className="mp-input mt-1">
                      {agentCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                    </select>
                  </label>
                  <label>
                    <span className="mp-label">Supported actions (comma-separated)</span>
                    <input value={form.actions} onChange={(event) => setFormField('actions', event.target.value)} className="mp-input mt-1" required />
                  </label>
                  <label>
                    <span className="mp-label">Pricing model</span>
                    <select value={form.pricingModel} onChange={(event) => setFormField('pricingModel', event.target.value)} className="mp-input mt-1">
                      <option value="fixed">Fixed</option>
                      <option value="hourly">Hourly</option>
                      <option value="from">Starting at</option>
                      <option value="dynamic">Dynamic range</option>
                      <option value="quote">Quote required</option>
                    </select>
                  </label>
                  <label>
                    <span className="mp-label">Currency</span>
                    <input value={form.currency} onChange={(event) => setFormField('currency', event.target.value.toUpperCase())} className="mp-input mt-1" minLength={3} maxLength={3} required />
                  </label>
                  {form.pricingModel === 'dynamic' ? (
                    <>
                      <label>
                        <span className="mp-label">Minimum price (minor units)</span>
                        <input type="number" min="1" value={form.minimumMinor} onChange={(event) => setFormField('minimumMinor', event.target.value)} className="mp-input mt-1" required />
                      </label>
                      <label>
                        <span className="mp-label">Maximum price (minor units)</span>
                        <input type="number" min="1" value={form.maximumMinor} onChange={(event) => setFormField('maximumMinor', event.target.value)} className="mp-input mt-1" required />
                      </label>
                    </>
                  ) : form.pricingModel !== 'quote' && (
                    <label>
                      <span className="mp-label">Price (minor units)</span>
                      <input type="number" min="1" value={form.amountMinor} onChange={(event) => setFormField('amountMinor', event.target.value)} className="mp-input mt-1" required />
                    </label>
                  )}
                  <label>
                    <span className="mp-label">Service availability</span>
                    <select value={form.availability} onChange={(event) => setFormField('availability', event.target.value)} className="mp-input mt-1">
                      <option value="available">Available</option>
                      <option value="busy">Busy</option>
                      <option value="paused">Paused</option>
                    </select>
                  </label>
                  <label>
                    <span className="mp-label">Listing status</span>
                    <select value={form.status} onChange={(event) => setFormField('status', event.target.value)} className="mp-input mt-1">
                      <option value="draft">Draft</option>
                      <option value="published">Publish</option>
                      <option value="paused">Paused</option>
                    </select>
                  </label>
                  <label>
                    <span className="mp-label">Response SLA (hours)</span>
                    <input type="number" min="1" max="8760" value={form.responseTimeHours} onChange={(event) => setFormField('responseTimeHours', event.target.value)} className="mp-input mt-1" required />
                  </label>
                  <label>
                    <span className="mp-label">Delivery SLA (days)</span>
                    <input type="number" min="0" max="3650" value={form.deliveryTimeDays} onChange={(event) => setFormField('deliveryTimeDays', event.target.value)} className="mp-input mt-1" required />
                  </label>
                  <label>
                    <span className="mp-label">Included revisions</span>
                    <input type="number" min="0" max="100" value={form.includedRevisions} onChange={(event) => setFormField('includedRevisions', event.target.value)} className="mp-input mt-1" required />
                  </label>
                  <label>
                    <span className="mp-label">Protocols (comma-separated)</span>
                    <input value={form.protocolVersions} onChange={(event) => setFormField('protocolVersions', event.target.value)} className="mp-input mt-1" placeholder="v1.0" required />
                  </label>
                </div>
                <fieldset className="space-y-2">
                  <legend className="mp-label">Authentication requirements</legend>
                  {[
                    ['firebase_id_token', 'Firebase ID token'],
                    ['scoped_agent_api_key', 'Scoped agent API key'],
                  ].map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.authenticationRequirements.includes(value)}
                        onChange={(event) => setForm((current) => ({
                          ...current,
                          authenticationRequirements: event.target.checked
                            ? [...current.authenticationRequirements, value]
                            : current.authenticationRequirements.filter((item) => item !== value),
                        }))}
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={busy}>{editingListingId ? 'Save changes' : 'Create listing'}</Button>
                  {editingListingId && (
                    <Button type="button" variant="outline" onClick={() => { setEditingListingId(null); setForm(initialForm); }}>
                      Cancel edit
                    </Button>
                  )}
                </div>
              </form>
            </div>

            <section className="space-y-3">
              <h3 className="text-lg font-semibold">Your service listings</h3>
              {ownerListings.length === 0 ? (
                <p className="border border-dashed border-mp-warm-grey bg-mp-surface p-5 text-sm text-mp-medium-grey">
                  No service listings yet. Create a listing above; nothing is published automatically.
                </p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {ownerListings.map((item) => (
                    <article key={item.listing.listingId} className="border border-mp-warm-grey bg-mp-surface p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h4 className="font-semibold">{item.listing.title}</h4>
                          <p className="text-xs text-mp-medium-grey">{item.status} · {item.visibility} · v{item.listing.version}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" disabled={busy} onClick={() => startEditing(item)}>Edit</Button>
                          <Button type="button" variant="outline" disabled={busy || item.status === 'paused'} onClick={() => void runOwnerAction(
                            () => pauseMarketplaceService(item.listing.listingId),
                            'Service listing paused.',
                          )}>
                            Pause
                          </Button>
                          <Button type="button" variant="outline" disabled={busy} onClick={() => void showListingHistory(item.listing.listingId)}>History</Button>
                        </div>
                      </div>
                      <p className="mt-2 text-sm">{formatPrice(item.listing.pricing)}</p>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </section>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-mp-warm-grey bg-mp-surface p-3">
      <p className="text-xs text-mp-medium-grey">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}
