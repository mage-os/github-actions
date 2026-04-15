---
name: add-supported-version
description: >
  Add a new Mage-OS or Magento Open Source release to the supported-version CI matrix.
  Use this skill when the user wants to add a new release version, update the version matrix,
  or register a new patch/minor release for either Mage-OS or Magento Open Source.
  Triggers on phrases like "add version", "new release", "add 2.2.1", "add 2.4.8-p5",
  "update supported versions", or any mention of adding a release to the CI matrix.
---

# Add Supported Version

This skill walks through adding a new release to the `supported-version` CI matrix in the `mage-os.github-actions` repository.

## What you need from the user

Before starting, confirm these inputs:

1. **Project**: `mage-os` or `magento-open-source` (or both, if releasing simultaneously)
2. **Version string**: e.g. `2.2.1`, `2.4.8-p5`
3. **Release date**: defaults to today if not specified
4. **Service versions**: same as previous release unless the user specifies otherwise
5. **Upstream version** (Mage-OS only): the `upstream` field value (e.g. `2.4.8-p4`)

If the user doesn't specify service versions, copy them from the most recent version in the same minor line.

## File locations

All paths are relative to the repo root (`supported-version/src/versions/`):

| File | Purpose |
|------|---------|
| `<project>/individual.json` | One entry per exact version with full service config, release date, and EOL |
| `<project>/composite.json` | Version range entries (`>=X.Y <X.Z`), plus `default` and `next` entries |
| `../kind/get-currently-supported.spec.ts` | Tests that verify which versions are supported at given dates |
| `../dist/index.js` | Built output — regenerated via `npm run build` |

Where `<project>` is `mage-os` or `magento-open-source`.

## Step-by-step process

### 1. Read current state

Read both `individual.json` and `composite.json` for the relevant project. Identify:
- The most recent version **in the same minor line** (this is the "previous version")
- Its service versions, release date, and EOL

The "same minor line" means the same `X.Y` — for example, when adding `2.2.2`, the previous version is `2.2.1` (not `2.2.0` or `2.1.0`). Scan all entries to find the highest patch number within the minor. For Magento, this means the highest `-pN` suffix (e.g. `2.4.8-p4` is previous when adding `2.4.8-p5`).

### 2. Update individual.json

**a. Set the previous version's EOL** to the new release date. This marks it as superseded. Only change this one entry — the immediately preceding patch in the same minor line. Do not touch any other version's EOL.

**b. Add the new version entry** immediately after the previous version, with:
- All service fields copied from the previous version (unless the user specifies different ones)
- `release`: the new release date formatted as `YYYY-MM-DDT00:00:00+0000`
- `eol`: release date + 3 years, same format
- For Mage-OS entries, include the `upstream` field

### Scope rules — what NOT to change

Each version only affects its own minor line (`X.Y`). When adding a version:
- Only update the EOL of the immediately prior patch in the **same** minor line
- Never modify entries in other minor lines. For example, adding `2.3.0` must NOT change anything about `2.2.x` entries — they have their own independent lifecycle and EOL dates
- A new minor line (e.g. `2.3.0` when only `2.2.x` exists) has no "previous version" to update — just add the new entry

### 3. Update composite.json

The composite file has three kinds of entries that may need updating:

**a. Version range entry** (e.g. `>=2.2 <2.3`):
- If the range already exists (adding a patch): update only the `eol` to match the new version's EOL. Do NOT change the `release` date — it reflects when the minor line first shipped.
- If this is a new minor line (e.g. adding `2.3.0`): add a new range entry with the new release and EOL dates. Do NOT modify the existing range for the previous minor line.

**b. Default entry** (bare package name, e.g. `mage-os/project-community-edition`):
- Update `release` to the new release date
- Update `eol` to the new EOL date
- Update service versions if they changed

**c. Next entry** (`package:next`):
- Same updates as the default entry

### 4. Update tests

Edit `supported-version/src/kind/get-currently-supported.spec.ts`:
- Add a test case for the new version's release date showing it as the currently supported version
- The pattern is: `['YYYY-MM-DDT00:00:01Z', 'Release of X.Y.Z', ['project:X.Y.Z']]`

### 5. Build and test

```bash
cd supported-version
npm run build   # rebuilds dist/index.js
npm test        # all tests must pass
```

If tests fail, diagnose and fix before proceeding.

### 6. Git workflow

```bash
git checkout main
git pull
git checkout -b chore/<project>-<version>   # e.g. chore/mage-os-2.2.1
git add supported-version/src/versions/<project>/individual.json \
       supported-version/src/versions/<project>/composite.json \
       supported-version/src/kind/get-currently-supported.spec.ts \
       supported-version/dist/index.js
git commit -m "Add supported version for <Project> <Version>"
git push -u origin <branch>
```

## Date formatting

All dates use the format `YYYY-MM-DDT00:00:00+0000`. EOL is always release date + 3 years exactly (same month and day).

## Key differences between projects

| | Mage-OS | Magento Open Source |
|---|---------|---------------------|
| Package prefix | `mage-os/project-community-edition` | `magento/project-community-edition` |
| Has `upstream` field | Yes | No |
| Version format | `X.Y.Z` (e.g. `2.2.1`) | `X.Y.Z-pN` (e.g. `2.4.8-p5`) |
| Search key (2.4.8+) | `opensearch` | `opensearch` |
| Search key (older) | `elasticsearch` | `elasticsearch` |

## Multiple simultaneous releases

When adding multiple versions at once (e.g. a Magento patch round releasing 2.4.7-p9 + 2.4.8-p4 simultaneously), process each version independently following the same steps. They typically share the same release date. Each version only affects its own minor line's entries.
