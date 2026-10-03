import Icon from '@/components/Icon';

export default function VerifyRequest() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 text-center shadow-lg">
        <span className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-500/10 text-accent dark:text-primary-400">
          <Icon name="mail" size={28} />
        </span>
        <h1 className="mb-3 text-3xl font-semibold tracking-tight text-foreground">
          Check your email
        </h1>
        <p className="mb-3 text-muted-foreground">
          A sign in link has been sent to your email address.
        </p>
        <p className="text-sm text-muted-foreground">
          Click the link in the email to sign in. You can close this window.
        </p>
      </div>
    </div>
  );
}
