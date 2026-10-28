# Agent Note: The 2026-10-28 pet intake round

Status: implemented

## Problem

Three PRs were open with no review record on any of them: the picker-refill fix #25, the red-whale-girl pet #23 with its matching plugin code, and the frames2d gameplay layer #20. All three are fork PRs whose workflow runs were parked at `action_required`, so a missing required check meant an unapproved run rather than a failing build, and two of the three had drifted into conflict with `main`.

## Decision

**#25 merges.** The refill effect reads `enabled`, `hasChoices` and `refreshPets` and nothing else, so its dependency array is complete; on a cold start its immediate refresh meets the constructor's 0ms load behind the loading guard and the two collapse into one request; the regression case fails against the pre-fix retry budget (three attempts 3s apart, exhausted by the 10s the case advances) so it does catch the bug it names. Two follow-ups are recorded on the thread rather than held against the merge: the case should also assert that a fresh `/api/pet/pets` request happened, because raising the retry count later turns it green against broken code, and the `cache: 'no-store'` semantics are only asserted as an argument since jsdom stubs fetch without reading init.

**#23 returns for evidence, not for provenance.** The Local Feature Evidence section is empty and the only image in the PR is `assets/whale-red/previews/idle.gif`, which is the asset itself rather than the pet appearing in the settings picker and animating through its states; the typecheck/test checkbox is unticked and the branch conflicts with `main`. The rights record is in order: `assets/whale-red/README.md` and the README source table name the character line and the recolour relation, and the MIT licence matches whale-refined.

**#20 stays on changes requested.** All four items from 2026-10-20 are unanswered on a head that has not moved since 2026-10-18, and the branch now conflicts with fifty commits of `main`.

## Consequences

One of three merged. #23's remainder is a two-mode capture plus a rebase, and the maintainer question it raises (bundled into the npm whitelist versus distributed through the market) is answered once that evidence arrives.

## Alternatives considered

Closing #20 as stale was rejected: this repository has no stale policy, and the feedback it waits on is ours to restate rather than a reason to discard a 2,900-line gameplay layer.

Accepting the in-repo preview GIF as user-visible evidence was rejected for the same reason its skin counterpart was: the gate asks for the feature as the user meets it, and a preview of the asset is the asset.
