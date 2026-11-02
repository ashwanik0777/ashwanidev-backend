# DB Setup and Troubleshooting Guide

This guide helps you avoid recurring local DB issues for current frontend APIs:

- /api/v1/announcements
- /api/v1/news
- /api/v1/events
- /api/v1/tenders
- /recruitments

## 1. Prerequisites

- PostgreSQL is installed and running on localhost:5432
- You know the `postgres` password
- Database exists (example: `gbu-db`)

If database does not exist:

```sql
CREATE DATABASE "gbu-db";
```

## 2. Run Schema Safely (PowerShell)

Use call operator `&` when path has spaces:

```powershell
Set-Location "<path-to>/gbu-website-backend"
$env:PGPASSWORD = "<postgres_password>"
& "C:/Program Files/PostgreSQL/18/bin/psql.exe" -h localhost -p 5432 -U postgres -d gbu-db -f "src/db/schema.sql"
Remove-Item Env:PGPASSWORD
```

## 3. Confirm Seed Data

```powershell
$env:PGPASSWORD = "<postgres_password>"
& "C:/Program Files/PostgreSQL/18/bin/psql.exe" -h localhost -p 5432 -U postgres -d gbu-db -c "SELECT 'notices' AS table_name, COUNT(*) FROM notices UNION ALL SELECT 'news', COUNT(*) FROM news UNION ALL SELECT 'events', COUNT(*) FROM events UNION ALL SELECT 'media_gallery', COUNT(*) FROM media_gallery UNION ALL SELECT 'newsletters', COUNT(*) FROM newsletters UNION ALL SELECT 'tenders', COUNT(*) FROM tenders UNION ALL SELECT 'recruitments', COUNT(*) FROM recruitments UNION ALL SELECT 'recruitment_documents', COUNT(*) FROM recruitment_documents;"
Remove-Item Env:PGPASSWORD
```

Expected counts from current seed:

- notices: 1
- news: 1
- events: 1
- media_gallery: 8
- newsletters: 1
- tenders: 3
- recruitments: 8
- recruitment_documents: 13

## 4. Fix the Common 500 Error

If API returns:

- `permission denied for table notices`

Then grant permissions to backend role (`gbu-user` by default):

```powershell
$env:PGPASSWORD = "<postgres_password>"
& "C:/Program Files/PostgreSQL/18/bin/psql.exe" -h localhost -p 5432 -U postgres -d gbu-db -c "GRANT USAGE ON SCHEMA public TO \"gbu-user\"; GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notices, public.news, public.events TO \"gbu-user\";"
Remove-Item Env:PGPASSWORD
```

If you are also testing tenders/recruitments, grant on those tables as well:

```powershell
$env:PGPASSWORD = "<postgres_password>"
& "C:/Program Files/PostgreSQL/18/bin/psql.exe" -h localhost -p 5432 -U postgres -d gbu-db -c "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenders, public.recruitments, public.recruitment_documents TO \"gbu-user\";"
Remove-Item Env:PGPASSWORD
```

## 5. Verify Backend Role Access

```powershell
& "C:/Program Files/PostgreSQL/18/bin/psql.exe" "postgresql://gbu-user:<gbu_user_password>@localhost:5432/gbu-db" -c "SELECT current_user, current_database(), has_table_privilege(current_user, 'public.notices', 'SELECT') AS can_select_notices;"
```

Expected: `can_select_notices = t`

## 6. Final API Check

Start backend and test:

```powershell
npm run dev
curl.exe -i "http://localhost:3000/api/v1/announcements"
curl.exe -i "http://localhost:3000/api/v1/tenders"
curl.exe -i "http://localhost:3000/recruitments"
```

Expected:

- HTTP 200
- `success: true`
- data array in JSON response

## 7. Notes

- Keep DB name and user aligned with `DATABASE_URL` in backend environment.
- `schema.sql` is destructive for public tables (drops and recreates).
- Run schema only on local/dev DB unless you know exactly what you are doing.
