#!/usr/bin/env bash
#
# Gangway on-device E2E harness. Automates the scenarios in E2E.md against the
# demo app running in the iOS simulator (Expo Go), driven by `agent-device`,
# and reports pass/fail per scenario.
#
# Prereqs: an iOS simulator booted; agent-device >= 0.19.1 on PATH; the app's
# Expo SDK matching the installed Expo Go. The harness owns the BFF (restarts
# it for a deterministic reseed and to capture its request log). Metro is
# reused if already on :8081, else started.
#
# Usage:   scripts/e2e-device.sh [--keep]   (--keep leaves servers running)
# Exit:    0 if every scenario passed, 1 otherwise.
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="host.exp.Exponent"
BFF_PORT=3939
METRO_PORT=8081
BFF_URL="http://localhost:${BFF_PORT}"
DEEP_LINK="exp://127.0.0.1:${METRO_PORT}"
BFF_LOG="/tmp/gangway-e2e-bff.log"
METRO_LOG="/tmp/gangway-e2e-expo.log"
GANGWAY_TS="${ROOT}/apps/mobile/src/gangway.ts"
KEEP=0
[[ "${1:-}" == "--keep" ]] && KEEP=1

# ---- output ---------------------------------------------------------------
if [[ -t 1 ]]; then RED=$'\e[31m'; GRN=$'\e[32m'; YLW=$'\e[33m'; DIM=$'\e[2m'; RST=$'\e[0m'
else RED=; GRN=; YLW=; DIM=; RST=; fi
PASS=0; FAIL=0; declare -a RESULTS=()
info() { echo "${DIM}· $*${RST}"; }
step() { echo "${YLW}▶ $*${RST}"; }
pass() { PASS=$((PASS+1)); RESULTS+=("${GRN}PASS${RST}  $1"); echo "  ${GRN}✓ $1${RST}"; }
fail() { FAIL=$((FAIL+1)); RESULTS+=("${RED}FAIL${RST}  $1"); echo "  ${RED}✗ $1${RST}${2:+  ${DIM}($2)${RST}}"; }

# ---- agent-device helpers -------------------------------------------------
ad()   { agent-device "$@" 2>/dev/null; }
snap() { agent-device snapshot -i 2>/dev/null; }
# @ref of the first *interactive* node at or after the line containing the
# given substring. A FlatList row is a [scroll-area] carrying the label with a
# child [cell] that reads "same label as parent" — pressing the scroll-area
# doesn't fire onPress, and the cell line lacks the text — so we match the
# label line, then take the next cell/button/other/switch ref (same line if the
# label node is itself interactive, e.g. a plain button).
ref_containing() {
  snap | awk -v pat="$1" '
    index($0, pat) { seen = 1 }
    seen && /\[(cell|button|other|switch)\]/ { print $1; exit }
  '
}
# first @ref that is a [button] with the exact label (used for the back button)
ref_button() { snap | grep -E "\[button\] \"$1\"" | grep -oE '@e[0-9]+' | head -1; }
# Nth [text-field] ref (1-based)
ref_field() { snap | grep -F '[text-field]' | sed -n "${1}p" | grep -oE '@e[0-9]+' | head -1; }

press_containing() {
  local r i
  for i in 1 2 3; do          # snapshots can catch a transitional frame; retry the lookup
    r="$(ref_containing "$1")"
    [[ -n "$r" ]] && { ad press "$r" --settle >/dev/null; return 0; }
    sleep 1
  done
  echo "no element containing: $1" >&2; return 1
}
# press toward a screen, verifying arrival by a body text; retries the press once.
press_until() { # <label-substr> <expect-text> [timeout_ms]
  local i
  for i in 1 2; do
    press_containing "$1" >/dev/null 2>&1
    assert_text "$2" "${3:-6000}" && return 0
  done
  return 1
}
press_back() {
  local r; r="$(ref_button 'Gangway')"
  [[ -n "$r" ]] || { echo "no back button" >&2; return 1; }
  ad press "$r" --settle >/dev/null
}
# assert body text appears (polls); returns non-zero on timeout
assert_text() {
  if agent-device wait text "$1" "${2:-5000}" >/dev/null 2>&1; then return 0; else return 1; fi
}
# assert body text is ABSENT right now (single snapshot)
refute_text() { ! snap | grep -qF "$1"; }

# ---- BFF log helpers ------------------------------------------------------
bff_mark() { wc -l < "$BFF_LOG" 2>/dev/null | tr -d ' '; }
bff_since() { tail -n +"$(( ${1:-0} + 1 ))" "$BFF_LOG" 2>/dev/null; }
# request lines look like:  <-- GET /orders   and   --> GET /orders 200
bff_saw()      { bff_since "$1" | grep -qE "$2"; }
bff_no_reqs()  { [[ -z "$(bff_since "$1" | grep -E '<-- (GET|POST|PUT|PATCH|DELETE) ')" ]]; }

# ---- environment ----------------------------------------------------------
ensure_bff() {
  step "Restarting BFF (deterministic reseed + request log)"
  pkill -f "tsx watch src/index.ts" 2>/dev/null
  pkill -f "apps/server" 2>/dev/null
  sleep 1
  ( cd "$ROOT" && npm run dev:server > "$BFF_LOG" 2>&1 & )
  local n=0
  until curl -s -m 2 "$BFF_URL/" -o /dev/null 2>/dev/null; do
    sleep 1; n=$((n+1)); [[ $n -gt 30 ]] && { echo "BFF never came up" >&2; exit 2; }
  done
  info "BFF on :$BFF_PORT, log → $BFF_LOG"
}
ensure_metro() {
  if curl -s -m 2 "http://localhost:${METRO_PORT}/status" 2>/dev/null | grep -q "running"; then
    info "Metro already on :$METRO_PORT (reusing)"
    return
  fi
  step "Starting Metro on :$METRO_PORT"
  ( cd "$ROOT/apps/mobile" && npx expo start > "$METRO_LOG" 2>&1 & )
  local n=0
  until curl -s -m 2 "http://localhost:${METRO_PORT}/status" 2>/dev/null | grep -q "running"; do
    sleep 2; n=$((n+1)); [[ $n -gt 60 ]] && { echo "Metro never came up" >&2; exit 2; }
  done
}
dismiss_dev_menu() {
  local r
  r="$(ref_containing 'Close')"; [[ -z "$r" ]] && r="$(ref_containing 'Continue')"
  [[ -n "$r" ]] && ad press "$r" --settle >/dev/null && info "dismissed Expo dev menu"
  return 0
}
# (Re)attach an agent-device session to the booted app. A stale session makes
# snapshots return empty, so always clear it first, then verify snap works.
attach_session() {
  local n=0
  agent-device close --session default >/dev/null 2>&1
  until agent-device open "$APP" >/dev/null 2>&1 && [[ -n "$(snap | head -1)" ]]; do
    agent-device close --session default >/dev/null 2>&1
    sleep 3; n=$((n+1)); [[ $n -gt 15 ]] && { echo "could not attach agent-device session" >&2; return 1; }
  done
}
cold_boot() {
  step "Cold-booting the app (fresh client store)"
  xcrun simctl terminate booted "$APP" >/dev/null 2>&1
  sleep 2
  xcrun simctl openurl booted "$DEEP_LINK" >/dev/null 2>&1
  sleep 6                       # let Expo Go relaunch and start bundling
  attach_session || return 1
  # poll until Home renders or the Expo dev menu appears
  local n=0
  until snap | grep -qF "Gangway demo BFF" || snap | grep -qE '"Close"|"Continue"'; do
    sleep 2; n=$((n+1)); [[ $n -gt 20 ]] && { echo "app never reached Home" >&2; return 1; }
  done
  dismiss_dev_menu
  assert_text "Gangway demo BFF" 8000 || return 1
}

cleanup() {
  agent-device close >/dev/null 2>&1
  # restore gangway.ts if a rehydration scenario touched it
  [[ -n "${GANGWAY_TS_BAK:-}" && -f "$GANGWAY_TS_BAK" ]] && cp "$GANGWAY_TS_BAK" "$GANGWAY_TS" && rm -f "$GANGWAY_TS_BAK"
  if [[ $KEEP -eq 0 ]]; then
    pkill -f "tsx watch src/index.ts" 2>/dev/null
    pkill -f "apps/server" 2>/dev/null
    [[ -n "${METRO_STARTED:-}" ]] && pkill -f "expo start" 2>/dev/null
  fi
}
trap cleanup EXIT

# ---- scenarios ------------------------------------------------------------
# Each scenario prints its own pass/fail lines and returns to the caller.

scn_A1_home() {
  step "A1 · cold boot → Home"
  assert_text "Gangway demo BFF" && assert_text "Open orders: 2" \
    && pass "A1 Home renders via boot visit" || fail "A1 Home"
}
scn_A2_orders() {
  step "A2 · Home → Orders (push)"
  local m; m="$(bff_mark)"
  press_containing "View orders" || { fail "A2 tap View orders"; return; }
  if assert_text "Orders" && assert_text "M5 hex bolts (x500)"; then
    bff_saw "$m" "GET /orders" && pass "A2 Orders list (push, GET /orders)" || fail "A2 no GET /orders in log"
  else fail "A2 Orders list not shown"; fi
}
scn_A3_detail() {
  step "A3 · order detail (push)"
  local m; m="$(bff_mark)"
  press_containing "Aluminum extrusions" || { fail "A3 tap order"; return; }
  if assert_text "Amount: ¥1,200" && assert_text "Archive"; then
    bff_saw "$m" "GET /orders/1" && pass "A3 detail (GET /orders/1)" || fail "A3 no GET /orders/1"
  else fail "A3 detail not shown"; fi
}
scn_B1_archive() {
  step "B1 · Archive (POST → 303 → replace)"
  local m; m="$(bff_mark)"
  press_containing "Archive" || { fail "B1 tap Archive"; return; }
  # lands on the list; archived order gone
  if assert_text "New order" && refute_text "Aluminum extrusions"; then
    if bff_saw "$m" "POST /orders/1/archive" && bff_saw "$m" "GET /orders"; then
      pass "B1 archive POST→303→list, order gone"
    else fail "B1 missing POST/redirect in log"; fi
  else fail "B1 list after archive (order still present?)"; fi
}
scn_B2_modal() {
  step "B2 · New order opens as native modal"
  local m; m="$(bff_mark)"
  press_containing "New order" || { fail "B2 tap New order"; return; }
  if assert_text "Amount (¥)" && assert_text "Create order"; then
    bff_saw "$m" "GET /orders/new" && pass "B2 modal (server nav intent, GET /orders/new)" || fail "B2 no GET /orders/new"
  else fail "B2 modal form not shown"; fi
}
scn_B3_validation() {
  step "B3 · empty submit → 422 inline errors, stays put"
  local m; m="$(bff_mark)"
  press_containing "Create order" || { fail "B3 tap Create order"; return; }
  if assert_text "Title is required." && assert_text "Amount must be a positive number."; then
    bff_saw "$m" "POST /orders" && pass "B3 422 validation errors inline" || fail "B3 no POST /orders"
  else fail "B3 validation errors not shown"; fi
}
scn_B4_create() {
  step "B4 · valid submit → 303 → new detail"
  local rt ra m
  rt="$(ref_field 1)"; [[ -n "$rt" ]] && ad fill "$rt" "Steel plate 3mm" --settle >/dev/null
  ra="$(ref_field 2)"; [[ -n "$ra" ]] && ad fill "$ra" "480" --settle >/dev/null
  m="$(bff_mark)"
  press_containing "Create order" || { fail "B4 tap Create order"; return; }
  if assert_text "Steel plate 3mm" && assert_text "Amount: ¥480"; then
    bff_saw "$m" "POST /orders" && pass "B4 create → 303 → new detail" || fail "B4 no POST /orders"
  else fail "B4 new detail not shown"; fi
}
scn_C1_cache() {
  step "C1 · back-nav renders from cache (no refetch)"
  local m; m="$(bff_mark)"
  press_back || { fail "C1 press back"; return; }
  sleep 1
  if bff_no_reqs "$m"; then pass "C1 back served from cache (0 requests)"; else fail "C1 back issued a request"; fi
}
scn_D1_missing_component() {
  step "D1 · missing-component fallback (Labs)"
  cold_boot >/dev/null 2>&1 || true
  local m; m="$(bff_mark)"
  press_containing "Labs (screen" || { fail "D1 tap Labs"; return; }
  if assert_text "Update available" && assert_text "Labs/Future"; then
    bff_saw "$m" "GET /labs" && pass "D1 missing-component fallback" || fail "D1 no GET /labs"
  else fail "D1 fallback not shown"; fi
}
scn_D2_update_required() {
  step "D2 · 409 update-required fallback (VIP)"
  press_back || true
  assert_text "View orders" 5000 || cold_boot >/dev/null 2>&1
  local m; m="$(bff_mark)"
  press_containing "VIP (server gate" || { fail "D2 tap VIP"; return; }
  if assert_text "This feature needs app bundle 2 or later."; then
    bff_saw "$m" "GET /vip" && pass "D2 409 update-required fallback" || fail "D2 no GET /vip"
  else fail "D2 fallback not shown"; fi
}

scn_E1_rehydrate() {
  step "E1 · restored stack self-heals after JS reload"
  # Reseed the BFF first: earlier scenarios archive order 1 / create order 3,
  # so without this E1 can't find "Aluminum extrusions" in the open list.
  ensure_bff >/dev/null 2>&1
  cold_boot >/dev/null 2>&1 || { fail "E1 cold boot"; return; }
  # Build a 2-deep stack (Home → Orders → detail), gating each hop so a flaky
  # tap fails as "setup" rather than silently testing rehydration on Home.
  press_until "View orders" "M5 hex bolts (x500)" || { fail "E1 setup: reach Orders"; return; }
  press_until "Aluminum extrusions" "Amount: ¥1,200" || { fail "E1 setup: reach detail"; return; }
  # force a full JS reload (wipes store, Expo Router restores the stack)
  GANGWAY_TS_BAK="$(mktemp)"; cp "$GANGWAY_TS" "$GANGWAY_TS_BAK"
  printf '\n// e2e-reload-trigger\n' >> "$GANGWAY_TS"
  local m; m="$(bff_mark)"
  info "forcing reload…"; sleep 8
  if assert_text "Amount: ¥1,200" 15000; then
    if bff_saw "$m" "GET /orders/1"; then pass "E1 detail rehydrated after reload (GET /orders/1)"
    else fail "E1 no rehydration GET in log"; fi
  else fail "E1 detail did not rehydrate (missing-page fallback?)"; fi
  cp "$GANGWAY_TS_BAK" "$GANGWAY_TS"; rm -f "$GANGWAY_TS_BAK"; GANGWAY_TS_BAK=""
  sleep 6  # let the revert reload settle
}
scn_E2_cache_after_rehydrate() {
  step "E2 · back-nav after rehydration stays cache-only"
  assert_text "Amount: ¥1,200" 8000 || { fail "E2 not on detail"; return; }
  local m; m="$(bff_mark)"
  press_back || { fail "E2 press back"; return; }
  sleep 1
  if bff_no_reqs "$m"; then pass "E2 back after rehydrate served from cache"; else fail "E2 back issued a request"; fi
}

# G — the cost of cache-on-back: staleness. Documents a real UX limitation.
scn_G1_stale_cache() {
  step "G1 · stale cache on back (known limitation)"
  ensure_bff >/dev/null 2>&1                 # reseed so order 1 is open
  cold_boot >/dev/null 2>&1 || { fail "G1 cold boot"; return; }
  press_until "View orders" "Aluminum extrusions" || { fail "G1 setup: reach Orders"; return; }
  press_until "Aluminum extrusions" "Amount: ¥1,200" || { fail "G1 setup: reach detail"; return; }
  # Archive → 303 → replace to a FRESH list (Aluminum gone). Confirm it's gone.
  press_until "Archive" "New order" || { fail "G1 archive"; return; }
  refute_text "Aluminum extrusions" || { fail "G1 fresh list still shows archived order"; return; }
  # Press back → land on the ORIGINAL cached list, rendered from the store.
  local m; m="$(bff_mark)"
  press_back || { fail "G1 press back"; return; }
  sleep 1
  # The archived order is STILL visible (stale) AND no request was made. Both
  # true = the cache-on-back win and its staleness cost, in one assertion.
  if assert_text "Aluminum extrusions" 4000 && bff_no_reqs "$m"; then
    pass "G1 back shows STALE cached list (archived order still visible, 0 requests)"
  else
    fail "G1 expected a stale cached list on back"
  fi
}

# H — client-only animation: a tap-to-reveal that never touches the server.
scn_H1_client_animation() {
  step "H1 · client-only animation (tap-to-reveal, no server)"
  ensure_bff >/dev/null 2>&1
  cold_boot >/dev/null 2>&1 || { fail "H1 cold boot"; return; }
  press_until "View orders" "Aluminum extrusions" || { fail "H1 setup: reach Orders"; return; }
  press_until "Aluminum extrusions" "Amount: ¥1,200" || { fail "H1 setup: reach detail"; return; }
  local m; m="$(bff_mark)"
  # Reveal: animated section appears; then hide: it animates out and unmounts.
  press_until "Show timeline" "Order timeline" || { fail "H1 reveal did not appear"; return; }
  press_containing "Hide timeline" >/dev/null 2>&1; sleep 1
  if refute_text "Order timeline" && bff_no_reqs "$m"; then
    pass "H1 tap-to-reveal animates in/out with 0 server requests (pure client)"
  else
    fail "H1 reveal did not hide, or it hit the server"
  fi
}

# ---- run ------------------------------------------------------------------
echo "${YLW}=== Gangway on-device E2E ===${RST}"
ensure_bff
ensure_metro
cold_boot || { echo "${RED}cold boot failed — aborting${RST}"; exit 2; }

# ONLY="A1 A2" limits the run to those scenarios (fast iteration); default = all.
ALL_SCN=(A1_home A2_orders A3_detail B1_archive B2_modal B3_validation B4_create \
         C1_cache D1_missing_component D2_update_required E1_rehydrate E2_cache_after_rehydrate \
         G1_stale_cache H1_client_animation)
for s in "${ALL_SCN[@]}"; do
  if [[ -n "${ONLY:-}" ]]; then
    key="${s%%_*}"; [[ " $ONLY " == *" $key "* ]] || continue
  fi
  "scn_${s}"
done

# ---- summary --------------------------------------------------------------
echo
echo "${YLW}=== Summary ===${RST}"
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo
echo "  ${GRN}${PASS} passed${RST}, ${RED}${FAIL} failed${RST}"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
