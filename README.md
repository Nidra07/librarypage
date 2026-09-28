# librarypage

This is a [Next.js](https://nextjs.org) project bootstrapped with [v0](https://v0.app).

## Built with v0

This repository is linked to a [v0](https://v0.app) project. You can continue developing by visiting the link below -- start new chats to make changes, and v0 will push commits directly to this repo. Every merge to `main` will automatically deploy.

[Continue working on v0 →](https://v0.app/chat/projects/prj_sINpBkqqTzqDtLaa2ldMvMdhMp1p)

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Learn More

To learn more, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [v0 Documentation](https://v0.app/docs) - learn about v0 and how to use it.

## Student and booking management

Before using the student portal or the management panels, apply the SQL
migrations in supabase/migrations in filename order to the Supabase project
connected to this app, or use the Supabase CLI. The student-management
migration creates the student, slot, booking, and attendance tables. The
registration migrations add a one-time student registration form and change
booking slots to 4, 6, 8, or 12-hour durations. Students enter their entry
time; the database calculates the exit time automatically.

The admin dashboard recognizes administrators through the trusted
app_metadata.role = "admin" claim. Assign that claim only from a trusted
server-side Supabase Admin API workflow; never put a service-role key in the
browser. After signing up and confirming their email, students complete the
one-time registration before they can access the student portal. Active,
registered students can book visits and check in on the visit date.

## Email confirmation setup

In Supabase, set the Auth **Site URL** to the live website's primary HTTPS domain.
In **Authentication → Email Templates → Confirm signup**, use a link that opens
the app's confirmation page without consuming the one-time token on the initial
GET request:

```html
<h2>Confirm your email address</h2>
<p>Tap the button below to confirm your email and finish signing up.</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email">Confirm email</a></p>
```

The student then presses **Confirm email** on the website. The form submits the
token for verification and sends the student to registration. Set the Supabase
Auth **Site URL** to the site's primary HTTPS domain and add its callback URL to
the Auth redirect allow list. Production signup links use the same hostname
where the student opened the form; the development-only redirect variable is
ignored in production.

For reliable delivery to students, configure a custom SMTP provider in Supabase
Auth settings. The built-in email sender has low rate limits; avoid repeated
signup attempts and use the in-app resend action after waiting for its timer.
