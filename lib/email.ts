import nodemailer from 'nodemailer';

// Create SMTP transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

export async function sendMagicLinkEmail(email: string, magicLink: string) {
  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@wishlist.app',
    to: email,
    subject: 'Sign in to Wishlist',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .button { 
              display: inline-block; 
              padding: 12px 24px; 
              background-color: #ec4899; 
              color: white; 
              text-decoration: none; 
              border-radius: 8px; 
              margin: 20px 0;
            }
            .footer { margin-top: 30px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🎁 Sign in to Wishlist</h1>
            <p>Click the button below to sign in to your wishlist account:</p>
            <a href="${magicLink}" class="button">Sign In</a>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #666;">${magicLink}</p>
            <div class="footer">
              <p>This link will expire in 24 hours.</p>
              <p>If you didn't request this email, you can safely ignore it.</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Sign in to Wishlist\n\nClick the link below to sign in:\n${magicLink}\n\nThis link will expire in 24 hours.\nIf you didn't request this email, you can safely ignore it.`,
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
  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@wishlist.app',
    to: email,
    subject: 'You\'ve been invited to a Wishlist!',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .button { 
              display: inline-block; 
              padding: 12px 24px; 
              background-color: #ec4899; 
              color: white; 
              text-decoration: none; 
              border-radius: 8px; 
              margin: 20px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🎁 You've been invited!</h1>
            <p>${invitedBy} has invited you to join their wishlist.</p>
            <p>You can now sign in to view and book items:</p>
            <a href="${process.env.NEXTAUTH_URL}/auth/signin" class="button">Sign In</a>
            <p>When you sign in, use this email address: <strong>${email}</strong></p>
          </div>
        </body>
      </html>
    `,
    text: `You've been invited!\n\n${invitedBy} has invited you to join their wishlist.\n\nSign in at: ${process.env.NEXTAUTH_URL}/auth/signin\n\nUse this email address: ${email}`,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Invitation email sent to:', email);
  } catch (error) {
    console.error('Error sending invitation email:', error);
    throw error;
  }
}
