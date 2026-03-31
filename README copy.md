# TestPro — QA Test Management

A modern, real-time QA test management platform built with React, TypeScript, Nhost (Hasura + Auth), and TailwindCSS.

## Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: TailwindCSS + GSAP animations
- **Backend**: Nhost (Hasura GraphQL + Authentication)
- **Export**: jsPDF + jspdf-autotable

## Features

- Module → Test → Step hierarchy
- Real-time multi-user sync via GraphQL subscriptions
- Test locking system (TTL-based, admins bypass)
- Role-based access control (Admin / Tester)
- Audit log
- CSV & PDF export
- Mobile-responsive layout

## Setup

1. Clone the repo
2. Copy `.env.example` to `.env` and fill in your Nhost credentials
3. Run the SQL migration in `hasura/migrations/001_init.sql` via Nhost Console
4. Set permissions per `hasura/metadata/permissions.md`
5. Install dependencies: `npm install`
6. Start dev server: `npm run dev`

## Deploy

Deploy to Netlify — the `netlify.toml` is pre-configured.
