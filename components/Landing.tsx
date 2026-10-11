import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import Badge from '@/components/Badge';
import GlobalSearch from '@/components/GlobalSearch';
import Icon, { type IconName } from '@/components/Icon';
import LandingCta from '@/components/LandingCta';
import { MOCK_ITEMS, MOCK_RESERVED, MockThumb, mockPrice } from '@/components/MockList';
import { coverGradient } from '@/lib/utils/cover';
import { statusMeta } from '@/lib/utils/itemStatus';
import { plural } from '@/lib/utils/plural';

/**
 * The signed-out home page (WIS-269), a server component: its HTML is complete
 * on the server, for visitors and crawlers alike, with only the call to action
 * and the search as client islands. It leads with the promise (nobody sees
 * what's been reserved on their own list, and nobody buys a gift twice), has
 * one call to action, puts the search for someone's list right under it, for a
 * visitor who was told to find someone here, then shows the two views of one
 * list playing out (WIS-406) and a three-step story strip. The header keeps
 * its own Sign in.
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
          <div className="mt-14 text-left sm:mt-16">
            <TwoViews />
          </div>
        </section>

        <StoryStrip />
      </main>
    </div>
  );
}

const STORY: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'list',
    title: 'Make a list',
    body: 'Birthday, holidays, the new place. Add what you’d love.',
  },
  {
    icon: 'users',
    title: 'Share the link',
    body: 'Friends open it and can suggest ideas of their own.',
  },
  {
    icon: 'sparkles',
    title: 'Stay surprised',
    body: 'They quietly reserve gifts. You never see what’s taken.',
  },
];

/**
 * The story strip (WIS-406): the three steps as one connected panel, in place
 * of the generic feature cards. SPOT: each step's icon tile is where a spot
 * illustration (WIS-408) can swap in.
 */
function StoryStrip() {
  return (
    <section aria-labelledby="landing-story-title">
      <h2 id="landing-story-title" className="sr-only">
        How it works
      </h2>
      <ol className="grid grid-cols-1 divide-y divide-border overflow-hidden rounded-3xl border border-border bg-surface shadow-md md:grid-cols-3 md:divide-x md:divide-y-0">
        {STORY.map((step, i) => (
          <li key={step.title} className="flex gap-4 p-6 sm:p-7 md:flex-col">
            <span
              aria-hidden
              className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-primary-500/12 text-accent"
            >
              <Icon name={step.icon} size={18} />
            </span>
            <div>
              <h3 className="mb-1 text-lg font-semibold text-foreground">
                <span aria-hidden className="text-muted-foreground">
                  {i + 1}.{' '}
                </span>
                {step.title}
              </h3>
              <p className="text-body leading-relaxed text-muted-foreground">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * One list, two views (WIS-406), in server markup with a CSS-only loop: a
 * friend's view of the list, where a Reserve tap swaps the first item to
 * Reserved, beside the owner's view of the same item, which never changes.
 * Made-up data, no fetches, no script. The resting state is the finished
 * moment (Reserved on the friend's side); the loop (`.landing-demo-*` rules in
 * `globals.css`) only plays without `prefers-reduced-motion`, as in
 * `lib/utils/motion.ts`. The badge comes from the status map, as on a real
 * card (`statusMeta`: a member seeing someone else's reservation).
 */
function TwoViews() {
  return (
    <section aria-labelledby="landing-mock-title">
      <h2
        id="landing-mock-title"
        className="mb-6 text-center text-xl font-semibold tracking-tight text-foreground"
      >
        One list, two views
      </h2>
      <div className="mx-auto grid max-w-3xl grid-cols-1 items-start gap-8 md:grid-cols-2 md:gap-5">
        <figure className="min-w-0">
          <MockCaption icon="user">What Maya sees</MockCaption>
          <MockCard friend={false} />
          <MockNote>No badge, no hint: nothing tells her what’s been reserved.</MockNote>
        </figure>

        <figure className="min-w-0">
          <MockCaption icon="users">What her friends see</MockCaption>
          <MockCard friend />
          <MockNote>Someone’s already giving it, so nobody buys it twice.</MockNote>
        </figure>
      </div>
    </section>
  );
}

function MockCard({ friend }: { friend: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-md">
      <div
        aria-hidden
        className="flex h-16 items-center justify-center text-white/90"
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
          {MOCK_ITEMS.map((item) => {
            const reserved = friend && item === MOCK_RESERVED;
            return (
              <li
                key={item.name}
                className={`flex items-center gap-3 py-2.5 ${reserved ? 'landing-demo-row' : ''}`}
              >
                <MockThumb name={item.name} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {item.name}
                </span>
                <span className="text-sm text-muted-foreground">{mockPrice(item.cents)}</span>
                {friend && (
                  <span className="landing-demo-slot grid w-[5.5rem] justify-items-end">
                    {reserved ? (
                      <>
                        <span
                          aria-hidden
                          className="landing-demo-reserve rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground"
                        >
                          Reserve
                        </span>
                        <span className="landing-demo-reserved">
                          <Badge status={statusMeta('booked', 'member')} />
                        </span>
                      </>
                    ) : (
                      <span
                        aria-hidden
                        className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground"
                      >
                        Reserve
                      </span>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
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
