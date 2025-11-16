import nodemailer from 'nodemailer';
import { getEnvVars } from './env';

// Helper function to convert hex to rgba
function hexToRgb(hex: string, alpha?: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return alpha !== undefined ? `rgba(0, 0, 0, ${alpha})` : '0, 0, 0';
  }

  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);

  if (alpha !== undefined) {
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  return `${r}, ${g}, ${b}`;
}

// Get validated environment variables
const env = getEnvVars();

// Create SMTP transporter
const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: parseInt(env.SMTP_PORT),
  secure: env.SMTP_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASSWORD,
  },
});

/**
 * Generate beautiful HTML email template
 */
function getEmailTemplate(options: {
  title: string;
  greeting: string;
  content: string;
  buttonText?: string;
  buttonUrl?: string;
  footerText?: string;
  showLinkFallback?: boolean;
  linkUrl?: string;
}) {
  const siteTitle = 'Wishlist';

  // Default colors (indigo)
  const primaryColor = '#6366f1';
  const foregroundColor = '#111827';
  const primaryLight = hexToRgb(primaryColor, 0.1);
  const primaryMedium = hexToRgb(primaryColor, 0.5);
  const primaryDark = hexToRgb(primaryColor, 0.8);

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="X-UA-Compatible" content="IE=edge">
        <style>
          /* Reset styles */
          body, table, td, p, a, li, blockquote {
            -webkit-text-size-adjust: 100%;
            -ms-text-size-adjust: 100%;
          }
          table, td {
            mso-table-lspace: 0pt;
            mso-table-rspace: 0pt;
          }
          img {
            -ms-interpolation-mode: bicubic;
            border: 0;
            outline: none;
            text-decoration: none;
          }
          
          /* Main styles */
          body {
            margin: 0;
            padding: 0;
            width: 100% !important;
            height: 100% !important;
            background-color: ${primaryLight};
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }
          
          .email-wrapper {
            width: 100%;
            background-color: ${primaryLight};
            padding: 40px 0;
          }
          
          .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px ${hexToRgb(primaryColor, 0.1)};
          }
          
          .email-header {
            background: ${primaryColor};
            padding: 40px 30px;
            text-align: center;
          }
          
          .email-header h1 {
            margin: 0;
            color: #ffffff;
            font-size: 28px;
            font-weight: 600;
            letter-spacing: -0.5px;
          }
          
          .email-body {
            padding: 40px 30px;
            color: ${foregroundColor};
            line-height: 1.6;
            font-size: 16px;
          }
          
          .email-body h2 {
            margin: 0 0 20px 0;
            color: ${foregroundColor};
            font-size: 24px;
            font-weight: 600;
            line-height: 1.3;
          }
          
          .email-body p {
            margin: 0 0 16px 0;
            color: ${foregroundColor};
            opacity: 0.85;
          }
          
          .email-body p:last-child {
            margin-bottom: 0;
          }
          
          .button-container {
            text-align: center;
            margin: 32px 0;
          }
          
          .email-button {
            display: inline-block;
            padding: 16px 32px;
            background: ${primaryColor};
            color: #ffffff !important;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            box-shadow: 0 4px 12px ${hexToRgb(primaryColor, 0.3)};
            transition: all 0.3s ease;
          }
          
          .email-button:hover {
            background: ${primaryDark};
            box-shadow: 0 6px 16px ${hexToRgb(primaryColor, 0.4)};
            transform: translateY(-2px);
          }
          
          .link-fallback {
            margin-top: 24px;
            padding: 16px;
            background-color: ${primaryLight};
            border-radius: 8px;
            border-left: 4px solid ${primaryColor};
          }
          
          .link-fallback p {
            margin: 0 0 8px 0;
            font-size: 14px;
            color: ${foregroundColor};
            opacity: 0.7;
          }
          
          .link-fallback a {
            color: ${primaryColor};
            word-break: break-all;
            text-decoration: none;
            font-size: 14px;
          }
          
          .email-footer {
            padding: 30px;
            background-color: ${primaryLight};
            text-align: center;
            border-top: 1px solid ${primaryMedium};
          }
          
          .email-footer p {
            margin: 0 0 8px 0;
            font-size: 13px;
            color: ${foregroundColor};
            opacity: 0.6;
            line-height: 1.5;
          }
          
          .email-footer p:last-child {
            margin-bottom: 0;
          }
          
          /* Responsive */
          @media only screen and (max-width: 600px) {
            .email-wrapper {
              padding: 20px 0;
            }
            
            .email-container {
              border-radius: 0;
            }
            
            .email-header {
              padding: 30px 20px;
            }
            
            .email-header h1 {
              font-size: 24px;
            }
            
            .email-body {
              padding: 30px 20px;
              font-size: 15px;
            }
            
            .email-body h2 {
              font-size: 20px;
            }
            
            .email-button {
              padding: 14px 28px;
              font-size: 15px;
            }
            
            .email-footer {
              padding: 20px;
            }
          }
        </style>
      </head>
      <body>
        <div class="email-wrapper">
          <div class="email-container">
            <!-- Header -->
            <div class="email-header">
              <h1>${options.title}</h1>
            </div>
            
            <!-- Body -->
            <div class="email-body">
              <h2>${options.greeting}</h2>
              ${options.content}
              
              ${
                options.buttonText && options.buttonUrl
                  ? `
                <div class="button-container">
                  <a href="${options.buttonUrl}" class="email-button">${options.buttonText}</a>
                </div>
              `
                  : ''
              }
              
              ${
                options.showLinkFallback && options.linkUrl
                  ? `
                <div class="link-fallback">
                  <p><strong>Or copy and paste this link into your browser:</strong></p>
                  <a href="${options.linkUrl}">${options.linkUrl}</a>
                </div>
              `
                  : ''
              }
            </div>
            
            <!-- Footer -->
            <div class="email-footer">
              ${options.footerText ? `<p>${options.footerText}</p>` : ''}
              <p>This email was sent by <strong>${siteTitle}</strong></p>
              <p>If you didn't request this email, you can safely ignore it.</p>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
}

export async function sendMagicLinkEmail(email: string, magicLink: string) {
  const siteTitle = 'Wishlist';

  const html = getEmailTemplate({
    title: '🎁 Sign In',
    greeting: 'Hello!',
    content: `
      <p>Click the button below to sign in to your <strong>${siteTitle}</strong> account. This magic link will securely log you in without needing a password.</p>
    `,
    buttonText: 'Sign In to Wishlist',
    buttonUrl: magicLink,
    showLinkFallback: true,
    linkUrl: magicLink,
    footerText: 'This link will expire in 24 hours for security reasons.',
  });

  const mailOptions = {
    from: env.EMAIL_FROM,
    to: email,
    subject: `Sign in to ${siteTitle}`,
    html,
    text: `Sign in to ${siteTitle}\n\nHello!\n\nClick the link below to sign in to your ${siteTitle} account:\n${magicLink}\n\nThis link will expire in 24 hours.\n\nIf you didn't request this email, you can safely ignore it.`,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Magic link email sent to:', email);
  } catch (error) {
    console.error('Error sending magic link email:', error);
    throw error;
  }
}

export async function sendInvitationEmail(email: string, invitedBy: string) {
  const siteTitle = 'Wishlist';
  const signInUrl = `${env.NEXTAUTH_URL}/auth/signin`;

  const html = getEmailTemplate({
    title: "🎁 You've Been Invited!",
    greeting: `Hello!`,
    content: `
      <p><strong>${invitedBy}</strong> has invited you to join <strong>${siteTitle}</strong>!</p>
      <p>You can now sign in to view the wishlist and book items you'd like to gift. No password needed—just use your email address to get started.</p>
    `,
    buttonText: 'Sign In Now',
    buttonUrl: signInUrl,
    footerText: `When you sign in, use this email address: <strong>${email}</strong>`,
  });

  const mailOptions = {
    from: env.EMAIL_FROM,
    to: email,
    subject: `You've been invited to ${siteTitle}!`,
    html,
    text: `You've been invited!\n\n${invitedBy} has invited you to join ${siteTitle}.\n\nSign in at: ${signInUrl}\n\nWhen you sign in, use this email address: ${email}`,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Invitation email sent to:', email);
  } catch (error) {
    console.error('Error sending invitation email:', error);
    throw error;
  }
}

export async function sendWishlistInvitationEmail(
  email: string,
  wishlistName: string,
  invitedBy: string,
  wishlistId: string
) {
  const siteTitle = 'Wishlist';
  const signInUrl = `${env.NEXTAUTH_URL}/auth/signin?callbackUrl=${encodeURIComponent(`/wishlists/${wishlistId}`)}`;

  const html = getEmailTemplate({
    title: '🎁 Wishlist Invitation',
    greeting: `Hello!`,
    content: `
      <p><strong>${invitedBy}</strong> has invited you to join their wishlist: <strong>${wishlistName}</strong>!</p>
      <p>You can now sign in to view the wishlist and book items you'd like to gift. No password needed—just use your email address to get started.</p>
    `,
    buttonText: 'Sign In Now',
    buttonUrl: signInUrl,
    footerText: `When you sign in, use this email address: <strong>${email}</strong>`,
  });

  const mailOptions = {
    from: env.EMAIL_FROM,
    to: email,
    subject: `You've been invited to ${wishlistName} on ${siteTitle}!`,
    html,
    text: `Wishlist Invitation\n\n${invitedBy} has invited you to join their wishlist: ${wishlistName}.\n\nSign in at: ${signInUrl}\n\nWhen you sign in, use this email address: ${email}`,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Wishlist invitation email sent to:', email);
  } catch (error) {
    console.error('Error sending wishlist invitation email:', error);
    throw error;
  }
}
