/**
 * The look of `Button` and `IconButton`, as class strings, so a link that acts
 * as a page's button (`<Link className={buttonClassName()}>`) matches them. A
 * plain module, not a client one, so a server component can call it too
 * (`app/not-found.tsx`).
 *
 * Every control is sized from one scale, and a control matches the fields
 * beside it (a row of controls shares one height):
 * - `sm` 36px: toolbars and filters, page-header actions, actions in list rows
 *   and compact cards.
 * - `md` 40px: card action rows, dialogs without fields, round header buttons.
 * - `lg` 44px, the default: every form field and form button, a page's primary
 *   call to action.
 * - `xl` 48px: the landing page only.
 */

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'soft'
  | 'danger'
  | 'danger-ghost'
  | 'destructive'
  | 'warning'
  | 'cancel'
  | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';
/** `rounded` (`rounded-xl`) by default; `pill` for page chrome and header actions. */
export type ButtonShape = 'rounded' | 'pill';

/** The icon size that goes with each control size. */
export const CONTROL_ICON_SIZE: Record<ButtonSize, number> = { sm: 16, md: 16, lg: 18, xl: 18 };

/** The one disabled look of every control. */
const DISABLED = 'disabled:cursor-not-allowed disabled:opacity-50';

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-primary-600 text-white shadow-[0_8px_22px_-10px_rgba(94,92,230,0.9)] hover:bg-primary-500 hover:-translate-y-px hover:shadow-[0_12px_28px_-10px_rgba(94,92,230,0.95)] active:translate-y-0 active:scale-[0.98] disabled:hover:translate-y-0 disabled:hover:bg-primary-600',
  secondary:
    'bg-surface text-foreground border border-border-strong shadow-xs hover:bg-surface-hover active:scale-[0.98] disabled:hover:bg-surface',
  soft: 'bg-primary-500/12 text-accent hover:bg-primary-500/18 active:scale-[0.98] dark:text-primary-300',
  /** Starts something destructive: soft red. */
  danger:
    'bg-red-500/10 text-red-600 hover:bg-red-500/16 active:scale-[0.98] dark:text-red-400 disabled:hover:bg-red-500/10',
  /** A destructive action in a row of quiet ones: red text, tinted on hover. */
  'danger-ghost':
    'text-red-600 hover:bg-red-500/10 active:scale-[0.98] dark:text-red-400 disabled:hover:bg-transparent',
  /** Confirms something destructive (a confirmation dialog's button): solid red. */
  destructive:
    'bg-red-600 text-white shadow-sm hover:bg-red-700 active:bg-red-800 active:scale-[0.98] disabled:hover:bg-red-600',
  /** Confirms something that needs care: solid amber. */
  warning:
    'bg-amber-600 text-white shadow-sm hover:bg-amber-700 active:bg-amber-800 active:scale-[0.98] disabled:hover:bg-amber-600',
  cancel: 'bg-muted text-foreground hover:bg-surface-2 active:scale-[0.98] disabled:hover:bg-muted',
  ghost: 'text-foreground hover:bg-muted active:scale-[0.98] disabled:hover:bg-transparent',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-1.5',
  lg: 'h-11 px-5 text-[15px] gap-2',
  xl: 'h-12 px-6 text-base gap-2',
};

const shapeStyles: Record<ButtonShape, string> = {
  rounded: 'rounded-xl',
  pill: 'rounded-full',
};

const baseStyles = `inline-flex flex-shrink-0 items-center justify-center font-semibold transition-all duration-200 cursor-pointer disabled:active:scale-100 ${DISABLED}`;

export function buttonClassName({
  variant = 'primary',
  size = 'lg',
  shape = 'rounded',
  fullWidth = false,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: ButtonShape;
  fullWidth?: boolean;
} = {}): string {
  return `${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${shapeStyles[shape]}${
    fullWidth ? ' w-full' : ''
  }`;
}

/** `xs` is 32px, for a close or clear button inline with text; otherwise square at the row's height. */
export type IconButtonSize = 'xs' | ButtonSize;
export type IconButtonVariant = 'ghost' | 'secondary' | 'chrome' | 'glass' | 'danger-ghost';

/** Every icon button's icon. */
export const ICON_BUTTON_ICON_SIZE = 18;

const iconSizeStyles: Record<IconButtonSize, string> = {
  xs: 'h-8 w-8',
  sm: 'h-9 w-9',
  md: 'h-10 w-10',
  lg: 'h-11 w-11',
  xl: 'h-12 w-12',
};

const iconVariantStyles: Record<IconButtonVariant, string> = {
  ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground disabled:hover:bg-transparent',
  /** Beside a secondary `Button`: a card's squares, a page header's back button. */
  secondary:
    'border border-border-strong bg-surface text-muted-foreground shadow-xs hover:bg-surface-hover hover:text-foreground',
  /** The app header's round buttons. */
  chrome:
    'border border-border bg-surface text-muted-foreground shadow-xs hover:bg-surface-hover hover:text-foreground',
  /** Over a photo or cover. */
  glass: 'border border-border bg-surface/90 text-muted-foreground shadow-sm backdrop-blur hover:bg-surface',
  'danger-ghost':
    'text-muted-foreground hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 disabled:hover:bg-transparent',
};

export function iconButtonClassName({
  variant = 'ghost',
  size = 'xs',
  shape = 'rounded',
}: {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  shape?: ButtonShape;
} = {}): string {
  // A small square reads best with a smaller radius.
  const radius = shape === 'pill' ? 'rounded-full' : size === 'xs' ? 'rounded-lg' : 'rounded-xl';
  return `inline-flex flex-shrink-0 items-center justify-center transition-colors ${DISABLED} ${iconSizeStyles[size]} ${radius} ${iconVariantStyles[variant]}`;
}
