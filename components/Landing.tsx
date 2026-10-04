import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import Badge from '@/components/Badge';
import GlobalSearch from '@/components/GlobalSearch';
import Icon, { type IconName } from '@/components/Icon';
import LandingCta from '@/components/LandingCta';
import { coverGradient, coverInitial } from '@/lib/utils/cover';
import { formatPrice } from '@/lib/utils/currency';
import { statusMeta } from '@/lib/utils/itemStatus';
import { plural } from '@/lib/utils/plural';

/**
 * The signed-out home page (WIS-269), a server component: its HTML is complete
 * on the server, for visitors and crawlers alike, with only the call to action
 * and the search as client islands. It leads with the promise (nobody sees
 * what's been reserved on their own list, and nobody buys a gift twice), has
 * one call to action, and puts the search for someone's list right under it,
 * for a visitor who was told to find someone here. The header keeps its own
 * Sign in.
 */
export default function Landing() {
  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
        <section className="mb-14 text-center sm:mb-20">
          <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Wishlists your friends can shop from&nbsp;—{' '}
            <span className="text-accent">no spoilers, no duplicate gifts.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Make a list for any occasion and share the link. Friends reserve what they’ll give, and
            you never see what’s been reserved.
          </p>
          <div className="mt-9 flex justify-center" data-testid="landing-cta">
            <LandingCta />
          </div>
          <div className="mx-auto mt-8 max-w-md text-left" data-testid="landing-search">
            <p className="mb-2 text-center text-sm text-muted-foreground">
              Looking for someone’s list? Search by username
            </p>
            <GlobalSearch variant="inline" />
          </div>
        </section>

        <ProductMock />

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-3xl border border-border bg-surface p-7 shadow-md"
            >
              <span className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-500/12 text-accent">
                <Icon name={f.icon} size={18} />
              </span>
              <h3 className="mb-2 text-lg font-semibold text-foreground">{f.title}</h3>
              <p className="text-body leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'list',
    title: 'Create wishlists',
    body: 'Organize your wishes into lists for any occasion — birthdays, holidays, the new place.',
  },
  {
    icon: 'users',
    title: 'Share & collaborate',
    body: 'Invite people to view your lists and let them propose items you might love.',
  },
  {
    icon: 'sparkles',
    title: 'Keep it a surprise',
    body: 'Friends quietly reserve gifts — you never see what’s been reserved on your own list.',
  },
];

/** The made-up list the mock shows: no real account's data, ever. */
const MOCK_ITEMS = [
  { name: 'Ceramic pour-over set', cents: 4800 },
  { name: 'Linen apron', cents: 3200 },
  { name: 'Hiking day pack', cents: 8900 },
];
const MOCK_RESERVED = MOCK_ITEMS[0];

const price = (cents: number) => formatPrice({ value: cents, currency: 'usd' });

/**
 * One list, two views, in static markup: the owner's card, where the item a
 * friend reserved looks like any other, beside a friend's view of that same
 * item marked Reserved. The badge comes from the status map, as on a real
 * card (`statusMeta`: a member seeing someone else's reservation).
 */
function ProductMock() {
  return (
    <section aria-labelledby="landing-mock-title" className="mb-14 sm:mb-20">
      <h2
        id="landing-mock-title"
        className="mb-6 text-center text-xl font-semibold tracking-tight text-foreground"
      >
        One list, two views
      </h2>
      <div className="mx-auto grid max-w-3xl grid-cols-1 items-start gap-8 md:grid-cols-2 md:gap-5">
        <figure className="min-w-0">
          <MockCaption icon="user">What Maya sees</MockCaption>
          <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
            <div
              aria-hidden
              className="flex h-20 items-center justify-center text-white/90"
              style={{ background: coverGradient('landing-mock-list') }}
            >
              <Icon name="gift" size={28} />
            </div>
            <div className="p-5">
              <p className="text-title font-semibold text-foreground">Maya’s birthday</p>
              <p className="mt-0.5 text-meta text-muted-foreground">
                {plural(MOCK_ITEMS.length, 'item')}
              </p>
              <ul className="mt-4 divide-y divide-border">
                {MOCK_ITEMS.map((item) => (
                  <li key={item.name} className="flex items-center gap-3 py-2.5">
                    <MockThumb name={item.name} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {item.name}
                    </span>
                    <span className="text-sm text-muted-foreground">{price(item.cents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <MockNote>No badge, no hint: nothing tells her what’s been reserved.</MockNote>
        </figure>

        <figure className="min-w-0">
          <MockCaption icon="users">What her friends see</MockCaption>
          <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
            <div
              aria-hidden
              className="flex aspect-[2/1] items-center justify-center text-4xl font-semibold text-white/90"
              style={{ background: coverGradient(MOCK_RESERVED.name) }}
            >
              {coverInitial(MOCK_RESERVED.name)}
            </div>
            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-title font-semibold text-foreground">
                  {MOCK_RESERVED.name}
                </p>
                <Badge status={statusMeta('booked', 'member')} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{price(MOCK_RESERVED.cents)}</p>
            </div>
          </div>
          <MockNote>Someone’s already giving it, so nobody buys it twice.</MockNote>
        </figure>
      </div>
    </section>
  );
}

function MockCaption({ icon, children }: { icon: IconName; children: string }) {
  return (
    <figcaption className="mb-3 flex items-center justify-center gap-1.5 text-sm font-medium text-muted-foreground">
      <Icon name={icon} size={16} />
      {children}
    </figcaption>
  );
}

function MockNote({ children }: { children: string }) {
  return <p className="mt-3 px-1 text-center text-sm text-muted-foreground">{children}</p>;
}

function MockThumb({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white/90"
      style={{ background: coverGradient(name) }}
    >
      {coverInitial(name)}
    </span>
  );
}
