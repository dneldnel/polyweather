## [ERR-20260325-001] next_typecheck_stale_dev_route_types

**Logged**: 2026-03-25T15:36:13Z
**Priority**: medium
**Status**: pending
**Area**: config

### Summary
`tsc --noEmit` failed after deleting App Router route files because `.next/dev/types` still referenced removed routes.

### Error
```text
.next/dev/types/validator.ts(71,39): error TS2307: Cannot find module '../../../app/api/comparison/jobs/[jobId]/route.js'
.next/dev/types/validator.ts(80,39): error TS2307: Cannot find module '../../../app/api/comparison/jobs/route.js'
.next/dev/types/validator.ts(89,39): error TS2307: Cannot find module '../../../app/api/comparison/route.js'
```

### Context
- Operation attempted: `npm run typecheck`
- Cause: `tsconfig.json` included both `.next/types/**/*.ts` and `.next/dev/types/**/*.ts`
- After deleting route files, Next type generation refreshed `.next/types` but stale `.next/dev/types` remained in the compiler input set

### Suggested Fix
Keep `tsc` input limited to `.next/types/**/*.ts` and exclude `.next/dev/types/**/*.ts` from `tsconfig.json`.

### Metadata
- Reproducible: yes
- Related Files: tsconfig.json

---
## [ERR-20260326-001] next_docs_missing_in_vite_workspace

**Logged**: 2026-03-26T09:00:35Z
**Priority**: low
**Status**: pending
**Area**: docs

### Summary
Workspace AGENTS instructions still point to `node_modules/next/dist/docs/`, but this repository is currently Vite/React and has no `next` dependency or local Next docs.

### Error
```text
find: node_modules/next/dist/docs: No such file or directory
```

### Context
- Operation attempted: inspect the required local Next.js docs before editing UI code
- Current package manager metadata shows a Vite/React Router app with no `next` package in `package.json`
- The mismatch can cause avoidable setup checks to fail before normal frontend work begins

### Suggested Fix
Update `AGENTS.md` to reflect the current stack, or gate the Next-docs instruction on the presence of the `next` package.

### Metadata
- Reproducible: yes
- Related Files: AGENTS.md, package.json

---
