# ADR-0016: SSR Shell with Client Islands for Dashboard

**Status:** Accepted
**Date:** 2026-07-15

## Context
The dashboard (`/`) was fully client-rendered (`'use client'` at the top of page.tsx). This meant the server sent an empty HTML shell + all JS had to load before any content rendered. LCP was poor — especially on slow connections.

## Decision
Split into a server component shell + client islands:
- `page.tsx` is a server component that fetches the session + renders the layout shell (sidebar, topbar) as SSR HTML
- `DashboardClient` is a client component (dynamically imported) that handles interactivity (view switching, keyboard shortcuts, command palette)
- Sidebar + Topbar are client components imported from the server shell — they render their initial HTML server-side, then hydrate

## Consequences
- **Positive:** Faster LCP — layout HTML renders immediately in SSR
- **Positive:** Session is available server-side (no client-side auth check flash)
- **Positive:** SEO crawlers see the layout structure (even though `/` is noindex)
- **Negative:** More complex file structure (page.tsx + dashboard-client.tsx)
- **Negative:** Session is passed as prop (slightly larger initial HTML)
