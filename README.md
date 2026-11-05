# SDLE Prep

Free, offline-capable Saudi Dental Licensure Examination study app. Not affiliated with SCFHS or Prometric, and not medical advice.

- Website: https://0xcydia-source.github.io/sdle-prep/
- Issues: https://github.com/0xcydia-source/sdle-prep/issues

## Run locally

```sh
python3 -m http.server 8765
```

Open http://localhost:8765. No build step or account is needed. Progress stays in this browser; export a backup before changing devices or site origins. The new website cannot automatically access progress from the previous website.

## Release scope

This repository is a new, history-free runtime export of SDLE Study Path. It deliberately excludes raw textbooks, generated processing artifacts, credentials, private work files, and the prior Git history. Software attribution is retained in LICENSE. Study-content redistribution permission was confirmed by the project owner for this publication; see NOTICE.md for rights-holder contact and limitations.

Structural checks do not establish clinical correctness. There are 16,738 bank records (15,513 usable), and 8,030 Flash inventory records, including archived/needs-review items. Do not interpret these totals as a new independent textbook verification.

## Feedback and privacy

External ntfy/email delivery is disabled in this release; use GitHub issues, or save a local draft. Do not submit patient information. Fonts load from Google; optional video/reference links open external services. A complete first online visit is required before offline use; external resources are not available offline.

## Hosting

GitHub Pages serves the main branch root. Runtime files use relative asset URLs. Service-worker caches are scoped to this app; local progress remains browser-local.
