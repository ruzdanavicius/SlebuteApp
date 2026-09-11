<!-- Merging this PR deploys to production (GitHub Pages, ~1 min). See slebute-ops/docs/16. -->

## What & why


## Rollback
<!-- REQUIRED. Last known-good commit SHA + the revert command. -->
Last good SHA: `______`

```
git revert -m 1 <merge-commit-sha> && git push
```

## Checklist
- [ ] Read the full diff in **Files changed**, top to bottom
- [ ] No secret, internal note, or `slebute-ops` content in this diff (repo is **public**)
- [ ] Shared functions touched? checked the other callers (CLAUDE.md §5)
- [ ] Desktop **and** mobile checked, or the intentional difference is stated
- [ ] Deploying outside trading hours (Sun, or Mon–Fri before 09:00 / after 20:00 — never Sat)
- [ ] Three lenses + stakeholder bar applied (CLAUDE.md §2–3)
