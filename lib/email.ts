import nodemailer from 'nodemailer';
import { getThemeConfig, hexToRgba } from './theme';
import { getEnvVars } from './env';

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
  const theme = getThemeConfig();
  const siteTitle = theme.siteTitle;
  
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
            background-color: ${theme.primary50};
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }
          
          .email-wrapper {
            width: 100%;
            background-color: ${theme.primary50};
            padding: 40px 0;
          }
          
          .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px ${hexToRgba(theme.primary900, 0.1)};
          }
          
          .email-header {
            background: linear-gradient(135deg, ${theme.primary500} 0%, ${theme.primary700} 100%);
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
            color: rgb(${theme.foregroundRgb});
            line-height: 1.6;
            font-size: 16px;
          }
          
          .email-body h2 {
            margin: 0 0 20px 0;
            color: rgb(${theme.foregroundRgb});
            font-size: 24px;
            font-weight: 600;
            line-height: 1.3;
          }
          
          .email-body p {
            margin: 0 0 16px 0;
            color: rgb(${theme.foregroundRgb});
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
            background: linear-gradient(135deg, ${theme.primary600} 0%, ${theme.primary700} 100%);
            color: #ffffff !important;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            box-shadow: 0 4px 12px ${hexToRgba(theme.primary600, 0.3)};
            transition: all 0.3s ease;
          }
          
          .email-button:hover {
            background: linear-gradient(135deg, ${theme.primary700} 0%, ${theme.primary800} 100%);
            box-shadow: 0 6px 16px ${hexToRgba(theme.primary700, 0.4)};
            transform: translateY(-2px);
          }
          
          .link-fallback {
            margin-top: 24px;
            padding: 16px;
            background-color: ${theme.primary50};
            border-radius: 8px;
            border-left: 4px solid ${theme.primary500};
          }
          
          .link-fallback p {
            margin: 0 0 8px 0;
            font-size: 14px;
            color: rgb(${theme.foregroundRgb});
            opacity: 0.7;
          }
          
          .link-fallback a {
            color: ${theme.primary600};
            word-break: break-all;
            text-decoration: none;
            font-size: 14px;
          }
          
          .email-footer {
            padding: 30px;
            background-color: ${theme.primary50};
            text-align: center;
            border-top: 1px solid ${theme.primary200};
          }
          
          .email-footer p {
            margin: 0 0 8px 0;
            font-size: 13px;
            color: rgb(${theme.foregroundRgb});
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
              
              ${options.buttonText && options.buttonUrl ? `
                <div class="button-container">
                  <a href="${options.buttonUrl}" class="email-button">${options.buttonText}</a>
                </div>
              ` : ''}
              
              ${options.showLinkFallback && options.linkUrl ? `
                <div class="link-fallback">
                  <p><strong>Or copy and paste this link into your browser:</strong></p>
                  <a href="${options.linkUrl}">${options.linkUrl}</a>
                </div>
              ` : ''}
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
  const theme = getThemeConfig();
  const siteTitle = theme.siteTitle;
  
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
  const theme = getThemeConfig();
  const siteTitle = theme.siteTitle;
  const signInUrl = `${env.NEXTAUTH_URL}/auth/signin`;
  
  const html = getEmailTemplate({
    title: '🎁 You\'ve Been Invited!',
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
