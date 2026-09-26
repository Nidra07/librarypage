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
